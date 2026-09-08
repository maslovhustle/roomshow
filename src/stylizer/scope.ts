// The AI engine, second attempt: a video track goes out, a restyled track
// comes back.
//
// The first attempt (see diffusion.ts) sent one JPEG per frame over a socket
// and drew whatever came back. It worked, but it could never look like video:
// the model saw each frame alone, with no memory of the one before, so every
// frame was a fresh invention of the same scene and the result read as a
// flicker book. Capping strength hid the worst of it by keeping the model
// close to the source, which is another way of saying it hid the effect too.
//
// This talks to Daydream Scope, which runs an autoregressive video model
// (StreamDiffusionV2 on Wan2.1) that carries state from frame to frame. The
// continuity is the model's job now, not something we approximate by refusing
// to let it stray far from the input.
//
// Two consequences shape this file:
//
//   - Transport is WebRTC, not a socket of JPEGs. The browser hands over a
//     MediaStreamTrack and gets one back. There is no frame queue to manage,
//     no in-flight cap, no JPEG quality to trade off; congestion control is the
//     browser's problem, which it is far better at than we were.
//
//   - The stylised picture arrives as a <video>, not as decoded frames. So
//     render() is a blit, and the Stylizer contract's rule that it must never
//     block holds trivially.

import { BUILT_IN_DIFFUSION_URL } from '../config';
import { Upscaler } from './upscale';
import type { AiStatus, Params, Stylizer } from '../types';

/**
 * What we send upstream — and, because Scope returns the picture at whatever
 * resolution it arrives in, also what comes back.
 *
 * 832x480 is the resolution StreamDiffusionV2 was trained at, and it is
 * landscape, which is what a camera and a projector both are. The square 512
 * this used to send was wrong twice over: off-distribution for the model, and
 * padded with black bars, so a third of every frame was spent computing
 * nothing. That is most of why the picture came back soft.
 */
const SEND_WIDTH = 832;
const SEND_HEIGHT = 480;
/**
 * Capture rate of the outbound track.
 *
 * This wants to sit at or just below what the pipeline can actually generate,
 * not above it. Sending faster does not produce more output — it fills the
 * queue in front of the model, and a queue that never drains is latency you
 * can watch: seconds of it, growing for as long as the session runs.
 */
const SEND_FPS = 10;
const RECONNECT_MS = 3000;

/**
 * Which model Scope should run. StreamDiffusionV2 is the video-to-video one:
 * autoregressive on Wan2.1, ~20GB of VRAM, and it carries state from frame to
 * frame. Its sibling `longlive` defaults to text-to-video, and
 * `krea-realtime-video` wants 32GB, which a 24GB card cannot give it.
 */
const PIPELINE = 'streamdiffusionv2';

/**
 * Chained after the model to fill in the frames it has no time to draw.
 *
 * RIFE synthesises an intermediate frame between each pair the model produces,
 * from the optical flow between them. It costs almost nothing next to a
 * diffusion step, and the difference is not subtle: measured over the same
 * thirty seconds of the same footage, 9 frames arrived without it and 46 with,
 * while the receive buffer fell from 0.29s to 0.01s. Smoother and closer to
 * live at once, because the picture stops arriving in clumps.
 */
const INTERPOLATOR = 'rife';

/**
 * Stands for "nothing has reached the server yet". Written as an escape rather
 * than the raw byte it used to be: a literal NUL in a source file makes every
 * text tool treat it as binary, and grep silently returns nothing at all.
 */
const UNSENT = '\u0000';

/**
 * How far the model may depart from the frame. Scope calls this noise scale.
 *
 * Measured on real footage through this pipeline: at 0.7 the frame-to-frame
 * difference averaged 8.7, at 0.95 it rose to 14.0 — and the higher setting did
 * not buy a stronger style, it just made the picture less settled. Same lesson
 * as the old socket engine, where 0.8 looked good on one still and read as a
 * flicker book in motion.
 *
 * 0.45 rather than 0.7 because the first thing anyone says about the live
 * picture is that it has nothing to do with the room they are standing in.
 * Style is worth little if the audience cannot find themselves in it.
 */
const DEFAULT_NOISE = 0.45;
/**
 * Generation calls to spread a prompt change over. An instant switch snaps the
 * whole picture at once, which looks like a cut; interpolating across a few
 * frames reads as the room dissolving into the new style.
 */
const TRANSITION_STEPS = 6;

interface OfferResponse {
  sdp: string;
  type: string;
  sessionId: string;
}

export class ScopeStylizer implements Stylizer {
  /**
   * The picture arrives at 832x480 and lands on a wall. How it gets there is
   * the difference between a projection that looks in focus and one that does
   * not, so it goes through a proper upscale rather than a canvas blit.
   */
  private upscaler: Upscaler | null = null;
  /**
   * The outbound frame buffer. Everything the stage can show — a phone track, a
   * laptop camera, a screen share, the procedural shapes — is a TexImageSource
   * but not necessarily a MediaStream. Drawing whatever it is into one canvas
   * and capturing that canvas gives a single uniform track, so the source kind
   * stops mattering here.
   */
  private feed = document.createElement('canvas');
  private feedCtx: CanvasRenderingContext2D | null = null;
  /** The restyled return track, parked in a video element so render() can blit it. */
  private sink = document.createElement('video');
  private pc: RTCPeerConnection | null = null;
  private sessionId = '';
  private source: CanvasImageSource | null = null;
  private sourceSize = { w: 1, h: 1 };
  private reconnectTimer = 0;
  private closing = false;
  private sentPrompt = UNSENT;
  private prompt = '';
  private noise = DEFAULT_NOISE;
  /** What the session was last told, so the fader is watched as well as the text. */
  private sentNoise = Number.NaN;

  status: AiStatus = 'off';
  onStatus?: (status: AiStatus, detail?: string) => void;

  /**
   * @param base Scope's HTTP origin, e.g. https://<pod>-8000.proxy.runpod.net
   * @param extraIceServers Relays to offer alongside whatever the server lists.
   *   Scope's own relay lookup goes to a domain that no longer resolves, so in
   *   practice it only ever returns STUN and the relay has to come from here.
   */
  constructor(
    private canvas: HTMLCanvasElement,
    private base: string,
    private extraIceServers: RTCIceServer[] = [],
  ) {}

  get live(): boolean {
    return this.pc?.connectionState === 'connected';
  }

  /**
   * Whether a stylised frame has actually arrived. The stage keeps the shader
   * on screen until this turns true, so switching engines does not flash black
   * for the length of the first round trip.
   */
  get painting(): boolean {
    return this.sink.videoWidth > 0;
  }

  init(): void {
    this.upscaler = new Upscaler(this.canvas);
    this.upscaler.init();
    this.feedCtx = this.feed.getContext('2d');
    this.feed.width = SEND_WIDTH;
    this.feed.height = SEND_HEIGHT;
    this.sink.muted = true;
    this.sink.playsInline = true;
    this.closing = false;
    void this.connect();
  }

  private set(status: AiStatus, detail?: string): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatus?.(status, detail);
  }

  private url(path: string): string {
    return `${this.base.replace(/\/$/, '')}${path}`;
  }

  private async connect(): Promise<void> {
    this.set('connecting');
    try {
      const iceServers = await this.iceServers();
      const pc = new RTCPeerConnection({ iceServers });
      this.pc = pc;

      // Scope only ever sends one track back, but the transceiver has to exist
      // before the offer or there is nothing for it to answer into.
      pc.addTransceiver('video', { direction: 'sendrecv' });
      const [sender] = pc.getSenders();
      const track = this.feed.captureStream(SEND_FPS).getVideoTracks()[0];
      if (sender && track) await sender.replaceTrack(track);

      pc.ontrack = (event) => {
        const [stream] = event.streams;
        if (!stream) return;
        this.sink.srcObject = stream;
        void this.sink.play().catch(() => {
          /* autoplay is muted, so this only fails on teardown */
        });
      };

      pc.onconnectionstatechange = () => {
        if (this.closing) return;
        if (pc.connectionState === 'connected') this.set('live');
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          // Reaching here means the HTTP handshake already succeeded, so the
          // box is emphatically up and telling the operator to go check it
          // sends them after the wrong problem. What failed is the media path:
          // a rented pod sits behind a proxy that forwards HTTP but not the
          // inbound UDP the video needs, so the two ends can never meet
          // directly and a relay has to carry it.
          this.retry(
            this.relayed
              ? 'Video path failed even through the relay.'
              : 'The AI engine answers but video cannot reach it: no TURN relay. Set a HuggingFace token on the pod.',
          );
        }
      };

      // The handler goes on BEFORE setLocalDescription, because that call is
      // what starts ICE gathering. Attaching afterwards — and especially after
      // the round trip that fetches the answer — means every candidate has
      // already been emitted and dropped on the floor. The pod then never
      // learns how to reach us, and since its own candidates are unreachable
      // from outside, nothing connects and the failure looks like a network
      // problem rather than an ordering mistake.
      //
      // Candidates that arrive before the answer does have nowhere to go yet,
      // so they queue until the session has an id.
      const pending: RTCIceCandidateInit[] = [];
      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        const candidate = event.candidate.toJSON();
        if (this.sessionId) void this.sendCandidate(candidate);
        else pending.push(candidate);
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const answer = await this.postOffer(offer);
      await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
      this.sessionId = answer.sessionId;
      for (const candidate of pending.splice(0)) void this.sendCandidate(candidate);

      // The prompt the operator typed before the link came up would otherwise
      // sit unsent until they typed another one.
      this.sentPrompt = UNSENT;
      void this.pushPrompt();
    } catch (error) {
      // Distinct from the media failure above: nothing answered at all.
      //
      // The address is worth more than the reason here. "Failed to fetch" is
      // all the browser will say whether the box is down, an extension blocked
      // the request, or — the one that actually keeps happening — a saved
      // endpoint from an earlier session is still pointing at a pod that was
      // deleted days ago. Naming the host turns all three into one glance.
      const reason = error instanceof Error ? error.message : 'unreachable';
      const host = this.base.replace(/^https?:\/\//, '');

      // A saved endpoint that no longer answers is by far the likeliest cause,
      // because a rented pod is replaced far more often than a browser breaks —
      // and the address that does work is sitting right there in the build,
      // overridden by a value someone typed once and forgot.
      //
      // So fall back to it rather than only advising it. Telling an operator to
      // go and reset a setting is not help when the room is already full; this
      // has cost three separate evenings of chasing a GPU that was fine. The
      // override still wins whenever it answers, and the switch is announced,
      // so nobody is left wondering which box they are talking to.
      if (BUILT_IN_DIFFUSION_URL && this.base !== BUILT_IN_DIFFUSION_URL) {
        this.base = BUILT_IN_DIFFUSION_URL;
        this.set(
          'offline',
          `${host} did not answer — falling back to the endpoint this build ships with.`,
        );
        this.teardown();
        window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = window.setTimeout(() => void this.connect(), RECONNECT_MS);
        return;
      }

      // "Check that the box is running" is only good advice when the box might
      // not be. If it answered well enough to refuse us, say what it said.
      const answered = reason.startsWith('offer rejected');
      this.retry(
        answered
          ? `The AI engine at ${host} refused the connection: ${reason.replace('offer rejected ', '').replace(/^\(|\)$/g, '')}.`
          : `Cannot reach the AI engine at ${host} (${reason}). Check that the GPU box is running.`,
      );
    }
  }

  /**
   * True when the server handed back a relay, not just STUN.
   *
   * STUN alone only discovers each end's public address; it cannot carry
   * traffic. That is enough between a phone and a laptop on the same wifi, and
   * never enough to reach a container behind a cloud proxy. Knowing which we
   * got is what lets a failure name its own cause.
   */
  private relayed = false;

  /**
   * Why the server refused, when it can say.
   *
   * A box that is up but has not finished loading its model rejects every
   * offer, and "offer rejected (400)" alongside "check that the GPU box is
   * running" is doubly unhelpful: the box is plainly running, and there is
   * nothing to do but wait a quarter of an hour. Fetching a fresh pod's models
   * takes that long, and someone will otherwise spend it debugging.
   */
  private async why(): Promise<string> {
    try {
      const res = await fetch(this.url('/api/v1/pipeline/status'));
      const body = (await res.json()) as { status?: string; loading_stage?: string | null };
      if (body.status === 'loaded') return '';
      if (body.status === 'loading') {
        return `, still loading its model${body.loading_stage ? `: ${body.loading_stage}` : ''}`;
      }
      return ', its model is not loaded yet';
    } catch {
      return '';
    }
  }

  /** Scope takes candidates in batches on the session, so each is its own PATCH. */
  private async sendCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.sessionId) return;
    await fetch(this.url(`/api/v1/webrtc/offer/${this.sessionId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidates: [candidate] }),
    }).catch(() => {
      /* a lost candidate costs a connection path, not the connection */
    });
  }

  private async iceServers(): Promise<RTCIceServer[]> {
    let fromServer: RTCIceServer[] = [];
    try {
      const res = await fetch(this.url('/api/v1/webrtc/ice-servers'));
      const body = (await res.json()) as { iceServers?: RTCIceServer[] };
      fromServer = body.iceServers ?? [];
    } catch {
      /* fall through to the public STUN server */
    }
    const servers = [
      ...this.extraIceServers,
      ...fromServer,
      ...(fromServer.length ? [] : [{ urls: 'stun:stun.l.google.com:19302' }]),
    ];
    this.relayed = servers.some((server) =>
      [server.urls].flat().some((url) => String(url).startsWith('turn')),
    );
    return servers;
  }

  private async postOffer(offer: RTCSessionDescriptionInit): Promise<OfferResponse> {
    const res = await fetch(this.url('/api/v1/webrtc/offer'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sdp: offer.sdp,
        type: offer.type,
        initialParameters: {
          // Without this the server logs "No pipeline IDs provided, cannot
          // start" and builds a session with no model attached: the transport
          // connects, frames go up, and nothing ever comes back.
          //
          // Order is the chain: the model draws, then the interpolator fills
          // between. Both have to be loaded on the box — see server/SCOPE.md.
          pipeline_ids: [PIPELINE, INTERPOLATOR],
          input_mode: 'video',
          prompts: [{ text: this.prompt || 'a room, cinematic', weight: 1 }],
          noise_scale: this.noise,
          // Motion-aware noise: hold still and the picture settles instead of
          // simmering, move and the model is allowed to redraw more.
          noise_controller: true,
        },
      }),
    });
    if (!res.ok) throw new Error(`offer rejected (${res.status}${await this.why()})`);
    return (await res.json()) as OfferResponse;
  }

  private retry(detail: string): void {
    if (this.closing) return;
    this.set('offline', detail);
    this.teardown();
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => void this.connect(), RECONNECT_MS);
  }

  /**
   * The prompt and how far the model may stray, which the shader's Params has
   * no room for. Cheap to call on every keystroke: it only reaches the network
   * when the text actually changed.
   */
  setPrompt(prompt: string, strength: number): void {
    this.prompt = prompt;
    this.noise = strength;
    void this.pushPrompt();
  }

  private async pushPrompt(): Promise<void> {
    // Both halves are watched, not just the text. Checking only the prompt
    // meant the fader moved and nothing happened: the session kept whatever
    // noise it was opened with, so the one control for "how much of my room
    // survives" did nothing unless the operator also retyped the style.
    const changed = this.prompt !== this.sentPrompt || this.noise !== this.sentNoise;
    if (!this.live || !changed) return;
    const first = this.sentPrompt === UNSENT;
    const promptChanged = this.prompt !== this.sentPrompt;
    this.sentPrompt = this.prompt;
    this.sentNoise = this.noise;
    const prompts = [{ text: this.prompt || 'a room, cinematic', weight: 1 }];
    await fetch(this.url('/api/v1/session/parameters'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        noise_scale: this.noise,
        // On the first push there is nothing to interpolate from, so set the
        // prompt outright; after that, dissolve into it. A fader-only change
        // sends no prompt at all, so dragging it does not restart the style.
        ...(!promptChanged
          ? {}
          : first
            ? { prompts }
            : { transition: { target_prompts: prompts, num_steps: TRANSITION_STEPS } }),
      }),
    }).catch(() => {
      /* the next keystroke retries */
    });
  }

  setSource(source: TexImageSource, width: number, height: number): void {
    this.source = source as CanvasImageSource;
    this.sourceSize = { w: width || 1, h: height || 1 };
  }

  resize(width: number, height: number): void {
    // Back to the display's resolution, now that something worth doing happens
    // at it. Sizing to the frame avoided a bad stretch by leaving the work to
    // the compositor, which only does bilinear; rendering the upscale here
    // instead means one scale, done well, straight to the pixels on the wall.
    this.canvas.width = width;
    this.canvas.height = height;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- shader params do not apply
  render(_params: Params, _timeSeconds: number): void {
    // Outbound: fill the frame rather than fit inside it. Both the camera and
    // the model's own training resolution are landscape, so the crop is
    // slight — and every pixel spent on a black bar is a pixel the model
    // spends generating nothing while the room waits for it.
    const feedCtx = this.feedCtx;
    if (feedCtx && this.source) {
      const { w, h } = this.sourceSize;
      const scale = Math.max(SEND_WIDTH / w, SEND_HEIGHT / h);
      const dw = w * scale;
      const dh = h * scale;
      feedCtx.drawImage(this.source, (SEND_WIDTH - dw) / 2, (SEND_HEIGHT - dh) / 2, dw, dh);
    }

    // Inbound: whatever the model has produced most recently. Before the first
    // frame arrives the video has no dimensions, and sampling it would throw.
    if (this.sink.videoWidth === 0) return;
    this.upscaler?.draw(this.sink);
  }

  private teardown(): void {
    if (this.sessionId) {
      const id = this.sessionId;
      this.sessionId = '';
      void fetch(this.url(`/api/v1/webrtc/offer/${id}`), { method: 'DELETE' }).catch(() => {
        /* the pod reaps abandoned sessions on its own */
      });
    }
    this.pc?.close();
    this.pc = null;
    this.sink.srcObject = null;
  }

  dispose(): void {
    this.closing = true;
    this.upscaler?.dispose();
    window.clearTimeout(this.reconnectTimer);
    this.teardown();
    this.set('off');
  }
}
