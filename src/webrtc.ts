// Phone camera -> laptop stage, over a direct peer connection.
//
// The control channel already exists, so signalling rides on it rather than
// standing up anything new. The phone holds the camera, so it is always the
// offerer and the stage always answers — a fixed role assignment means there is
// no glare case to resolve.
//
// Media does NOT go through Supabase. Only the SDP and ICE candidates do; the
// video takes the shortest path the two devices can negotiate, which on a venue
// wifi is usually straight across the LAN.

import { msg } from './sync';
import type { Facing, RtcSignal, Sync } from './types';

// STUN only. A TURN relay would cover symmetric NAT — typically a phone on
// cellular while the laptop sits behind a hotel router — but relays cost money
// per gigabyte, and this build has no server. Same-network is the supported
// path; `onFailed` exists so the failure is legible rather than a black screen.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

/** Runs on the phone. Captures the camera and pushes it to the stage. */
export class PhonePublisher {
  private pc: RTCPeerConnection | null = null;
  private stream: MediaStream | null = null;
  private sender: RTCRtpSender | null = null;

  facing: Facing = 'environment';
  onFailed?: (reason: string) => void;

  constructor(private sync: Sync) {}

  get active(): boolean {
    return this.stream !== null;
  }

  /** Back camera by default: the point is to film the room, not the operator. */
  async start(facing: Facing = this.facing): Promise<void> {
    this.facing = facing;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1280 }, frameRate: { ideal: 30 } },
      audio: false,
    });

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;

    const track = this.stream.getVideoTracks()[0];
    if (!track) throw new Error('Camera returned no video track');
    this.sender = pc.addTrack(track, this.stream);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.sync.send(msg.rtc({ kind: 'ice', candidate: candidate.toJSON() }, 'remote'));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        this.onFailed?.('Could not reach the stage directly. Put both devices on the same wifi.');
      }
    };

    await this.negotiate();
  }

  /** Swaps the track in place — renegotiating would drop the picture mid-set. */
  async flip(): Promise<void> {
    const next: Facing = this.facing === 'environment' ? 'user' : 'environment';
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: next, width: { ideal: 1280 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    if (!track || !this.sender) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    await this.sender.replaceTrack(track);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = stream;
    this.facing = next;
  }

  async handle(signal: RtcSignal): Promise<void> {
    const pc = this.pc;
    if (!pc) return;
    if (signal.kind === 'answer') {
      // An answer to a superseded offer arrives while the connection is already
      // `stable`; applying it throws and kills a working stream.
      if (pc.signalingState !== 'have-local-offer') return;
      await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
    } else if (signal.kind === 'ice') {
      await pc.addIceCandidate(signal.candidate).catch(() => {});
    } else if (signal.kind === 'need-offer') {
      // The stage restarted and lost the connection. Rebuild from scratch: its
      // old peer connection is gone, so reusing ours would negotiate against
      // nothing.
      if (this.stream) {
        const facing = this.facing;
        this.stop();
        await this.start(facing);
      }
    }
  }

  stop(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.sender = null;
    this.pc?.close();
    this.pc = null;
  }

  private async negotiate(): Promise<void> {
    const pc = this.pc;
    if (!pc) return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sync.send(msg.rtc({ kind: 'offer', sdp: offer.sdp ?? '' }, 'remote'));
  }
}

/** Runs on the laptop. Answers the phone and hands over the incoming stream. */
export class StageReceiver {
  private pc: RTCPeerConnection | null = null;
  // ICE can arrive before the offer is applied; addIceCandidate throws if the
  // remote description is not set yet, so hold them until it is.
  private pending: RTCIceCandidateInit[] = [];

  onStream?: (stream: MediaStream) => void;
  onFailed?: (reason: string) => void;

  constructor(private sync: Sync) {}

  /** Asks the phone for a fresh offer — used when the stage starts cold. */
  requestOffer(): void {
    this.sync.send(msg.rtc({ kind: 'need-offer' }, 'stage'));
  }

  async handle(signal: RtcSignal): Promise<void> {
    if (signal.kind === 'offer') {
      const pc = this.reset();
      await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
      for (const candidate of this.pending.splice(0)) {
        await pc.addIceCandidate(candidate).catch(() => {});
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sync.send(msg.rtc({ kind: 'answer', sdp: answer.sdp ?? '' }, 'stage'));
      return;
    }

    if (signal.kind === 'ice') {
      if (this.pc?.remoteDescription) await this.pc.addIceCandidate(signal.candidate).catch(() => {});
      else this.pending.push(signal.candidate);
    }
  }

  stop(): void {
    this.pc?.close();
    this.pc = null;
    this.pending = [];
  }

  private reset(): RTCPeerConnection {
    // Close the old peer but keep the queue: candidates routinely arrive ahead
    // of the offer that gives them somewhere to go, and calling stop() here
    // would discard exactly the ones this connection is about to need.
    this.pc?.close();
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.sync.send(msg.rtc({ kind: 'ice', candidate: candidate.toJSON() }, 'stage'));
    };
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) this.onStream?.(stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        this.onFailed?.('Phone camera could not connect. Put both devices on the same wifi.');
      }
    };
    return pc;
  }
}
