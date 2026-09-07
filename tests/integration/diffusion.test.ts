import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiffusionStylizer } from '../../src/stylizer/diffusion';
import { PARAM_DEFAULTS } from '../../src/presets';

/** A WebSocket that stays under the test's control rather than the network's. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;

  readyState = 0;
  binaryType = 'blob';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: Blob | string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readonly sent: unknown[] = [];

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  send(payload: unknown): void {
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  return canvas;
}

const source = document.createElement('canvas');

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  // jsdom decodes no images; the engine only needs something bitmap-shaped to
  // hold on to, and what it draws is covered end to end by Playwright.
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 512, height: 512, close: vi.fn() })));
  // jsdom has no 2D canvas implementation; the engine only needs the calls to
  // exist, since what it draws is verified end to end by Playwright.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '',
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
  ) {
    callback(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }));
  });
});

function start(): { engine: DiffusionStylizer; socket: FakeSocket } {
  const engine = new DiffusionStylizer(makeCanvas(), 'ws://gpu.test:8765');
  engine.init();
  const socket = FakeSocket.instances[0]!;
  socket.open();
  engine.setSource(source, 1280, 720);
  return { engine, socket };
}

const binary = (socket: FakeSocket) => socket.sent.filter((item) => item instanceof ArrayBuffer);
const json = (socket: FakeSocket) => socket.sent
  .filter((item): item is string => typeof item === 'string')
  .map((item) => JSON.parse(item) as { type: string; prompt: string; strength: number });

describe('the AI engine', () => {
  it('reports offline until the socket opens', () => {
    const engine = new DiffusionStylizer(makeCanvas(), 'ws://gpu.test:8765');
    engine.init();
    expect(engine.live).toBe(false);
    FakeSocket.instances[0]!.open();
    expect(engine.live).toBe(true);
  });

  it('does nothing at all without an endpoint, rather than failing', () => {
    const engine = new DiffusionStylizer(makeCanvas(), '');
    engine.init();
    expect(FakeSocket.instances).toHaveLength(0);
    expect(() => engine.render(PARAM_DEFAULTS, 0)).not.toThrow();
  });

  // The whole point of the in-flight guard: latency is what the room sees, and
  // an unbounded send queue trades a visible lag for throughput nobody wants.
  it('keeps exactly one frame in flight', async () => {
    const { engine, socket } = start();

    engine.render(PARAM_DEFAULTS, 0);
    await settle();
    engine.render(PARAM_DEFAULTS, 0.016);
    engine.render(PARAM_DEFAULTS, 0.033);
    await settle();

    expect(binary(socket)).toHaveLength(1);
  });

  it('sends again once a frame comes back', async () => {
    const { engine, socket } = start();

    engine.render(PARAM_DEFAULTS, 0);
    await settle();
    socket.onmessage?.({ data: new Blob([new Uint8Array([9])], { type: 'image/jpeg' }) });
    engine.render(PARAM_DEFAULTS, 0.05);
    await settle();

    expect(binary(socket)).toHaveLength(2);
  });

  // Without this a single dropped reply latches the guard and the picture stops
  // for good.
  it('gives up on a lost frame instead of latching forever', async () => {
    const { engine, socket } = start();
    engine.render(PARAM_DEFAULTS, 0);
    await settle();

    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 10_000);
    engine.render(PARAM_DEFAULTS, 10);
    await settle();

    expect(binary(socket).length).toBeGreaterThan(1);
  });

  it('sends the prompt as JSON, and only when it changes', async () => {
    const { engine, socket } = start();

    engine.setPrompt('claymation', 0.6);
    engine.render(PARAM_DEFAULTS, 0);
    await settle();
    socket.onmessage?.({ data: new Blob([new Uint8Array([9])]) });
    engine.render(PARAM_DEFAULTS, 0.05);
    await settle();

    expect(json(socket)).toEqual([{ type: 'config', prompt: 'claymation', strength: 0.6 }]);
  });

  it('resends the prompt on every open, since a new server never saw it', async () => {
    const { engine, socket } = start();
    engine.setPrompt('anime', 0.5);
    engine.render(PARAM_DEFAULTS, 0);
    await settle();
    expect(json(socket)).toHaveLength(1);

    // What a reconnect does, without waiting out the backoff timer.
    socket.open();
    engine.render(PARAM_DEFAULTS, 1);
    await settle();

    expect(json(socket)).toHaveLength(2);
  });

  it('announces its state so the stage can fall back to the shader', () => {
    const engine = new DiffusionStylizer(makeCanvas(), 'ws://gpu.test:8765');
    const seen: string[] = [];
    engine.onStatus = (status) => seen.push(status);
    engine.init();
    FakeSocket.instances[0]!.open();
    FakeSocket.instances[0]!.close();
    expect(seen).toEqual(['connecting', 'live', 'offline']);
  });

  it('has nothing to paint before the first frame returns', () => {
    const { engine } = start();
    expect(engine.painting).toBe(false);
  });
});
