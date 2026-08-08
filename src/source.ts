// Whatever ends up in front of the shader.
//
// `camera` is the real product. `shapes` exists so the stage is never a black
// rectangle: no camera permission, no webcam, or a laptop wedged behind the
// booth with the lid shut still gives you something to project.

import type { SourceKind } from './types';

export class SourceManager {
  kind: SourceKind | null = null;

  private stream: MediaStream | null = null;
  private video = document.createElement('video');
  private proc: ShapeField | null = null;

  constructor() {
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
  }

  get element(): TexImageSource {
    return this.proc ? this.proc.canvas : this.video;
  }

  get size(): { w: number; h: number } {
    if (this.proc) return { w: this.proc.canvas.width, h: this.proc.canvas.height };
    return { w: this.video.videoWidth, h: this.video.videoHeight };
  }

  async use(kind: SourceKind): Promise<void> {
    if (kind === this.kind && kind === 'shapes') return;
    this.teardown();

    if (kind === 'shapes') {
      this.proc = new ShapeField(640, 360);
      this.proc.start();
      this.kind = 'shapes';
      return;
    }

    this.stream = kind === 'screen'
      ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      : await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 } },
        audio: false,
      });

    this.video.srcObject = this.stream;
    await this.video.play();
    this.kind = kind;
  }

  stop(): void {
    this.teardown();
    this.kind = null;
  }

  private teardown(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.proc?.stop();
    this.proc = null;
  }
}

interface Blob2D {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  hue: number;
}

/**
 * Drifting metaballs plus a few hard-edged rings. Not trying to look like
 * anything — it is raw material for the shader chain, which is where the look
 * actually comes from. The rings matter: the edge pass is a sobel filter, and
 * pure gradients give it nothing to bite on, so a blobs-only field renders
 * almost black under the edge-heavy looks.
 */
class ShapeField {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private t = 0;
  private blobs: Blob2D[];

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    this.ctx = ctx;
    this.blobs = Array.from({ length: 7 }, (_, i) => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.09 + Math.random() * 0.13,
      vx: (Math.random() - 0.5) * 0.0018,
      vy: (Math.random() - 0.5) * 0.0018,
      hue: (i * 47) % 360,
    }));
  }

  start(): void {
    const draw = (): void => {
      const { ctx, canvas } = this;
      const { width: w, height: h } = canvas;
      this.t += 0.008;

      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#05040a';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      for (const blob of this.blobs) {
        blob.x += blob.vx;
        blob.y += blob.vy;
        if (blob.x < -0.2 || blob.x > 1.2) blob.vx *= -1;
        if (blob.y < -0.2 || blob.y > 1.2) blob.vy *= -1;
        blob.hue = (blob.hue + 0.25) % 360;

        const gradient = ctx.createRadialGradient(
          blob.x * w, blob.y * h, 0,
          blob.x * w, blob.y * h, blob.r * w,
        );
        gradient.addColorStop(0, `hsla(${blob.hue}, 95%, 66%, 1)`);
        gradient.addColorStop(0.45, `hsla(${blob.hue}, 92%, 52%, 0.55)`);
        gradient.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
      }

      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(this.t * 0.35);
      for (let i = 0; i < 4; i++) {
        const radius = (0.12 + i * 0.11) * w * (1 + 0.06 * Math.sin(this.t * 1.7 + i));
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 1.35);
        ctx.strokeStyle = `hsla(${(this.t * 40 + i * 55) % 360}, 100%, 70%, 0.9)`;
        ctx.lineWidth = 3 + i;
        ctx.stroke();
      }
      ctx.restore();

      ctx.globalCompositeOperation = 'source-over';
      this.raf = requestAnimationFrame(draw);
    };
    draw();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }
}
