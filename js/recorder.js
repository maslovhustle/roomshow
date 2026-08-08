// Records the visible canvas straight to a file. No upload, no encode queue —
// the point of the feature is that the set exists on disk before the lights
// come up.

const CODECS = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

export class CanvasRecorder {
  constructor(canvas, fps = 30) {
    this.canvas = canvas;
    this.fps = fps;
    this.recorder = null;
    this.chunks = [];
    this.startedAt = 0;
  }

  get recording() {
    return this.recorder?.state === 'recording';
  }

  get elapsed() {
    return this.recording ? (Date.now() - this.startedAt) / 1000 : 0;
  }

  start() {
    if (this.recording) return;
    const mimeType = CODECS.find((c) => MediaRecorder.isTypeSupported(c));
    if (!mimeType) throw new Error('This browser cannot record canvas video');

    const stream = this.canvas.captureStream(this.fps);
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.recorder.start(1000);
    this.startedAt = Date.now();
  }

  // Resolves once the file has been handed to the browser's download flow.
  stop() {
    return new Promise((resolve) => {
      if (!this.recording) return resolve(null);
      this.recorder.onstop = () => {
        const type = this.recorder.mimeType.split(';')[0];
        const blob = new Blob(this.chunks, { type });
        this.chunks = [];
        download(blob, `roomshow-${stamp()}.${type.includes('mp4') ? 'mp4' : 'webm'}`);
        resolve(blob);
      };
      this.recorder.stop();
    });
  }
}

export function snapshot(canvas) {
  canvas.toBlob((blob) => {
    if (blob) download(blob, `roomshow-${stamp()}.png`);
  }, 'image/png');
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
