// The AI engine: a frame goes out over a socket, a redrawn frame comes back.
//
// Implements the same Stylizer contract as the shader, so the stage can hold
// both and switch between them. The contract's one hard rule matters more here
// than anywhere else: render() must never block. It draws whatever came back
// most recently and returns immediately, so a stalled GPU or a dropped venue
// wifi freezes the picture instead of freezing the machine.

import type { Params, Stylizer } from '../types';

export type AiStatus = 'idle' | 'connecting' | 'live' | 'offline';

/** Encoded upload size. The model works at 512 anyway, so sending more is waste. */
const SEND_EDGE = 512;
const JPEG_QUALITY = 0.72;
/**
 * A frame that has not come back by now is treated as lost. Without this the
 * in-flight guard latches and the picture stops forever after one dropped
 * packet.
 */
const FRAME_TIMEOUT_MS = 4000;
const RECONNECT_MS = 2500;

export class DiffusionStylizer implements Stylizer {
  private ctx: CanvasRenderingContext2D | null = null;
  private encoder = document.createElement('canvas');
  private encoderCtx: CanvasRenderingContext2D | null = null;
  private socket: WebSocket | null = null;
  private source: CanvasImageSource | null = null;
  private sourceSize = { w: 1, h: 1 };
  private latest: ImageBitmap | null = null;
  private inFlight = false;
  private sentAt = 0;
  private reconnectTimer = 0;
  private closing = false;
  private sentPrompt = '\u0000';
  private prompt = '';
  private strength = 0.6;

  status: AiStatus = 'idle';
  onStatus?: (status: AiStatus, detail?: string) => void;

  constructor(private canvas: HTMLCanvasElement, private endpoint: string) {}

  get live(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** True once a frame has actually come back, which is what the stage waits for. */
  get painting(): boolean {
    return this.latest !== null;
  }

  init(): void {
    this.ctx = this.canvas.getContext('2d');
    if (!this.ctx) throw new Error('2D canvas is not available for the AI engine');
    this.encoderCtx = this.encoder.getContext('2d');
    this.connect();
  }

  setSource(source: TexImageSource, width: number, height: number): void {
    // ImageData is a valid texture source but cannot be drawn with drawImage,
    // and the encoder needs drawImage. The typeof guard is not redundant:
    // ImageData is absent in some non-browser environments, and referencing it
    // there throws rather than returning false.
    const isPixelBuffer = typeof ImageData !== 'undefined' && source instanceof ImageData;
    this.source = isPixelBuffer ? null : (source as CanvasImageSource);
    this.sourceSize = { w: Math.max(1, width), h: Math.max(1, height) };
  }

  resize(width: number, height: number): void {
    this.canvas.width = Math.max(2, Math.floor(width));
    this.canvas.height = Math.max(2, Math.floor(height));
  }

  /**
   * The prompt is deliberately not part of Params. Params is the shader's
   * uniform set — every entry is a number the GPU reads — and threading a
   * string through it would make that untrue for one consumer's benefit.
   */
  setPrompt(prompt: string, strength: number): void {
    this.prompt = prompt;
    this.strength = strength;
  }

  render(_params: Params, _timeSeconds: number): void {
    this.paint();
    this.maybeSend();
  }

  dispose(): void {
    this.closing = true;
    clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
    this.latest?.close();
    this.latest = null;
  }

  private paint(): void {
    const { ctx, latest } = this;
    if (!ctx) return;
    const { width: w, height: h } = this.canvas;
    if (!latest) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      return;
    }
    // Cover, matching the shader path, so switching engines does not reframe.
    const scale = Math.max(w / latest.width, h / latest.height);
    const dw = latest.width * scale;
    const dh = latest.height * scale;
    ctx.drawImage(latest, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  private maybeSend(): void {
    if (!this.live || !this.source || !this.encoderCtx) return;

    if (this.inFlight) {
      if (performance.now() - this.sentAt < FRAME_TIMEOUT_MS) return;
      this.inFlight = false;
    }

    // One frame in flight at a time. Sending faster than the GPU returns would
    // not raise the frame rate — it would only grow a queue, and latency is the
    // whole product here: a visual that lags the room by two seconds is worse
    // than one that runs at half the rate.
    this.inFlight = true;
    this.sentAt = performance.now();

    const { w, h } = this.sourceSize;
    const scale = SEND_EDGE / Math.max(w, h);
    this.encoder.width = Math.max(64, Math.round(w * scale));
    this.encoder.height = Math.max(64, Math.round(h * scale));
    this.encoderCtx.drawImage(this.source, 0, 0, this.encoder.width, this.encoder.height);

    this.encoder.toBlob((blob) => {
      if (!blob || !this.live) {
        this.inFlight = false;
        return;
      }
      void blob.arrayBuffer().then((buffer) => {
        if (this.live) this.socket?.send(buffer);
        else this.inFlight = false;
      });
    }, 'image/jpeg', JPEG_QUALITY);

    this.sendPrompt();
  }

  /** Prompt travels as JSON, frames as binary — one socket, two message kinds. */
  private sendPrompt(): void {
    if (this.prompt === this.sentPrompt) return;
    this.sentPrompt = this.prompt;
    this.socket?.send(JSON.stringify({
      type: 'config',
      prompt: this.prompt,
      strength: this.strength,
    }));
  }

  private connect(): void {
    if (this.closing || !this.endpoint) return;
    this.setStatus('connecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.endpoint);
    } catch (err) {
      this.setStatus('offline', err instanceof Error ? err.message : String(err));
      this.scheduleReconnect();
      return;
    }
    socket.binaryType = 'blob';
    this.socket = socket;

    socket.onopen = () => {
      this.inFlight = false;
      // Force the prompt to be resent: the server that had it is not this one.
      this.sentPrompt = '\u0000';
      this.setStatus('live');
    };

    socket.onmessage = (event: MessageEvent<Blob | string>) => {
      this.inFlight = false;
      if (typeof event.data === 'string') return;
      void createImageBitmap(event.data).then((bitmap) => {
        this.latest?.close();
        this.latest = bitmap;
      }).catch(() => {});
    };

    socket.onerror = () => this.setStatus('offline', 'Could not reach the AI endpoint');
    socket.onclose = () => {
      this.socket = null;
      this.inFlight = false;
      this.setStatus('offline');
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.closing) return;
    clearTimeout(this.reconnectTimer);
    // A rented GPU box reboots, a tunnel drops, a laptop sleeps. Reconnecting
    // on a timer means the operator never has to reload mid-set.
    this.reconnectTimer = window.setTimeout(() => this.connect(), RECONNECT_MS);
  }

  private setStatus(status: AiStatus, detail?: string): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatus?.(status, detail);
  }
}
