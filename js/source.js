// Whatever ends up in front of the shader.
//
// `camera` is the real product. `shapes` exists so the stage is never a black
// rectangle: no camera permission, no webcam, or a laptop wedged behind the
// booth with the lid shut still gives you something to project.

export class SourceManager {
  constructor() {
    this.kind = null;
    this.stream = null;
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
    this.proc = null;
    this.procRaf = 0;
  }

  get element() {
    return this.kind === 'shapes' ? this.proc.canvas : this.video;
  }

  get size() {
    if (this.kind === 'shapes') return { w: this.proc.canvas.width, h: this.proc.canvas.height };
    return { w: this.video.videoWidth, h: this.video.videoHeight };
  }

  async use(kind, deviceId) {
    if (kind === this.kind && kind === 'shapes') return;
    this.#teardown();

    if (kind === 'shapes') {
      this.proc = new ShapeField(640, 360);
      this.proc.start();
      this.kind = 'shapes';
      return;
    }

    const constraints = kind === 'screen'
      ? null
      : { video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user', width: { ideal: 1280 } }, audio: false };

    this.stream = constraints
      ? await navigator.mediaDevices.getUserMedia(constraints)
      : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });

    this.video.srcObject = this.stream;
    await this.video.play();
    this.kind = kind;
  }

  stop() {
    this.#teardown();
    this.kind = null;
  }

  #teardown() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.proc?.stop();
    this.proc = null;
  }
}

// Drifting metaballs plus a few hard-edged rings. Not trying to look like
// anything — it is raw material for the shader chain, which is where the look
// actually comes from. The rings matter: the edge pass is a sobel filter, and
// pure gradients give it nothing to bite on, so a blobs-only field renders
// almost black under the edge-heavy looks.
class ShapeField {
  constructor(w, h) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.raf = 0;
    this.t = 0;
    this.blobs = Array.from({ length: 7 }, (_, i) => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.09 + Math.random() * 0.13,
      vx: (Math.random() - 0.5) * 0.0018,
      vy: (Math.random() - 0.5) * 0.0018,
      hue: (i * 47) % 360,
    }));
  }

  start() {
    const draw = () => {
      const { ctx, canvas } = this;
      const { width: w, height: h } = canvas;
      this.t += 0.008;

      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#05040a';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      for (const b of this.blobs) {
        b.x += b.vx;
        b.y += b.vy;
        if (b.x < -0.2 || b.x > 1.2) b.vx *= -1;
        if (b.y < -0.2 || b.y > 1.2) b.vy *= -1;
        b.hue = (b.hue + 0.25) % 360;

        const g = ctx.createRadialGradient(b.x * w, b.y * h, 0, b.x * w, b.y * h, b.r * w);
        g.addColorStop(0, `hsla(${b.hue}, 95%, 66%, 1)`);
        g.addColorStop(0.45, `hsla(${b.hue}, 92%, 52%, 0.55)`);
        g.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }

      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(this.t * 0.35);
      for (let i = 0; i < 4; i++) {
        const r = (0.12 + i * 0.11) * w * (1 + 0.06 * Math.sin(this.t * 1.7 + i));
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 1.35);
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

  stop() {
    cancelAnimationFrame(this.raf);
  }
}

export async function listCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  } catch {
    return [];
  }
}
