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
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  constructor(private canvas: HTMLCanvasElement, private fps = 30) {}

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  start(): void {
    if (this.recording) return;
    const mimeType = CODECS.find((codec) => MediaRecorder.isTypeSupported(codec));
    if (!mimeType) throw new Error('This browser cannot record canvas video');

    const stream = this.canvas.captureStream(this.fps);
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    this.recorder.ondataavailable = (event) => {
      if (event.data.size) this.chunks.push(event.data);
    };
    this.recorder.start(1000);
  }

  /** Resolves once the file has been handed to the browser's download flow. */
  stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const recorder = this.recorder;
      if (!recorder || recorder.state !== 'recording') return resolve(null);
      recorder.onstop = () => {
        const type = recorder.mimeType.split(';')[0] ?? 'video/webm';
        const blob = new Blob(this.chunks, { type });
        this.chunks = [];
        download(blob, `roomshow-${stamp()}.${type.includes('mp4') ? 'mp4' : 'webm'}`);
        resolve(blob);
      };
      recorder.stop();
    });
  }
}

export function snapshot(canvas: HTMLCanvasElement): void {
  canvas.toBlob((blob) => {
    if (blob) download(blob, `roomshow-${stamp()}.png`);
  }, 'image/png');
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
