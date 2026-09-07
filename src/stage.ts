// The machine plugged into the projector.
//
// The stage owns the state. The remote only ever sends patches; every applied
// patch is re-broadcast, so a phone that joins late, reconnects, or was locked
// in a pocket lands on the truth within one tick. Everything here also works
// with the keyboard alone — a demo must never be one dead phone away from
// a black screen.

import './styles/app.css';
import { hasSupabase, makeSessionCode, normaliseCode, pairingHash } from './config';
import { BANKS, PRESETS, bankOf, banksLooks, resolveParams } from './presets';
import { createSync, msg } from './sync';
import { WebGLStylizer } from './stylizer/webgl';
import { DiffusionStylizer } from './stylizer/diffusion';
import { loadConfig } from './config';
import { SourceManager } from './source';
import { CanvasRecorder, snapshot } from './recorder';
import { AudioReactor, SILENCE } from './audio';
import { StageReceiver } from './webrtc';
import type { StageAction, StageState, Sync, SyncMessage } from './types';

const MAX_WIDTH = 1920;
const PRESET_IDS = new Set<string>(PRESETS.map((preset) => preset.id));

const canvas = must<HTMLCanvasElement>('stage');
const aiCanvas = must<HTMLCanvasElement>('stageAi');
const hud = must<HTMLDivElement>('hud');
const els = {
  code: must<HTMLDivElement>('code'),
  remoteUrl: must<HTMLAnchorElement>('remoteUrl'),
  copy: must<HTMLButtonElement>('copyLink'),
  status: must<HTMLSpanElement>('status'),
  preset: must<HTMLSpanElement>('nowPreset'),
  fps: must<HTMLSpanElement>('fps'),
  rec: must<HTMLSpanElement>('recDot'),
  error: must<HTMLDivElement>('error'),
  ai: must<HTMLSpanElement>('aiStatus'),
};

const code = normaliseCode(new URLSearchParams(location.search).get('code')) || makeSessionCode();
const stylizer = new WebGLStylizer(canvas);
const source = new SourceManager();
const audio = new AudioReactor();
const recorder = new CanvasRecorder(canvas);

// The AI engine only exists when an endpoint is configured. Everything below
// treats it as optional, so an unconfigured install behaves exactly as before.
const diffusionUrl = loadConfig().diffusionUrl;
const diffusion = diffusionUrl ? new DiffusionStylizer(aiCanvas, diffusionUrl) : null;

// A look can be named in the URL, which is what the gallery links to. An
// unknown id falls through to the default rather than rendering nothing.
const wanted = new URLSearchParams(location.search).get('look');

const state: StageState = {
  engine: 'shader',
  aiStatus: 'off',
  prompt: '',
  // Measured: below about 0.7 the model barely departs from the frame and the
  // prompt looks broken. 0.8 is where a described style actually appears.
  aiStrength: 0.8,
  preset: wanted && PRESET_IDS.has(wanted) ? wanted : 'comic',
  intensity: 0.65,
  source: 'shapes',
  mirror: 0,
  audio: false,
  recording: false,
};

let sync: Sync | undefined;
let receiver: StageReceiver;

async function boot(): Promise<void> {
  els.code.textContent = code;

  // Two URLs on purpose: the readable one goes on screen, the one carrying the
  // Supabase config goes to the clipboard. Nobody should have to retype a
  // pairing payload off a projector.
  const base = `${location.origin}${location.pathname.replace(/stage\.html$/, '')}remote.html?code=${code}`;
  const paired = base + pairingHash();
  els.remoteUrl.textContent = base.replace(/^https?:\/\//, '');
  els.remoteUrl.href = paired;
  els.copy.onclick = async () => {
    await navigator.clipboard.writeText(paired);
    els.copy.textContent = hasSupabase() ? 'copied (with keys)' : 'copied';
    setTimeout(() => (els.copy.textContent = 'copy link'), 1800);
  };

  stylizer.init();
  if (diffusion) {
    state.aiStatus = 'connecting';
    diffusion.init();
    diffusion.onStatus = (status, detail) => {
      els.ai.hidden = false;
      els.ai.textContent = `ai: ${status}`;
      els.ai.dataset.state = status;
      // The phone is the only screen the operator is looking at, so the status
      // has to travel to it rather than sitting in the stage HUD.
      state.aiStatus = status;
      sync?.send(msg.state(state));
      if (status === 'offline' && detail) fail(detail);
      // Falling back rather than showing a frozen frame: a projector with a
      // stale picture is worse than one running the shader.
      if (status !== 'live' && state.engine === 'ai') showEngine('shader');
      else showEngine(state.engine);
    };
  }

  await source.use('shapes');
  stylizer.setSource(source.element, source.size.w, source.size.h);
  resize();

  sync = await createSync(code);
  els.status.textContent = sync.name === 'supabase' ? 'remote: online' : 'remote: same-device only';
  els.status.dataset.mode = sync.name;
  receiver = new StageReceiver(sync);
  receiver.onStream = (stream) => {
    state.source = 'phone';
    void source.usePhone(stream);
    sync?.send(msg.state(state));
  };
  receiver.onFailed = (reason) => fail(reason);

  sync.onMessage(onMessage);
  sync.send(msg.state(state));
  // If a phone was already publishing when this stage reloaded, its picture is
  // gone and only the phone can rebuild it. Asking once at boot is safe — there
  // is no offer in flight yet — and a phone that is not publishing ignores it.
  receiver.requestOffer();

  if (!hasSupabase()) {
    fail('No Supabase keys — the remote will only reach this browser. Add them on the home page.');
  }

  window.addEventListener('resize', resize);
  window.addEventListener('keydown', onKey);
  // A quiet stage still needs to prove it is alive to a phone that just woke up.
  setInterval(() => sync?.send(msg.state(state)), 2000);

  requestAnimationFrame(loop);
}

function onMessage(message: SyncMessage): void {
  switch (message.t) {
    case 'hello':
      sync?.send(msg.state(state));
      break;
    case 'patch':
      void applyPatch(message.patch);
      break;
    case 'action':
      void runAction(message.action);
      break;
    case 'rtc':
      if (message.from === 'remote') void receiver.handle(message.signal);
      break;
    case 'state':
      break;
  }
}

async function applyPatch(patch: Partial<StageState>): Promise<void> {
  if (patch.source && patch.source !== state.source) {
    if (patch.source === 'phone') {
      // Nothing to open locally, and nothing to ask for: the phone always sends
      // an offer as it starts publishing, so requesting one here would race its
      // own answer and leave the connection stuck in `stable`.
      state.source = 'phone';
    } else {
      if (state.source === 'phone') receiver.stop();
      try {
        await source.use(patch.source);
        state.source = patch.source;
      } catch (err) {
        fail(`camera: ${message(err)}`);
        // Never leave the projector dark because a permission was denied.
        await source.use('shapes');
        state.source = 'shapes';
      }
    }
  }
  if (patch.audio !== undefined && patch.audio !== state.audio) {
    try {
      if (patch.audio) await audio.start(); else audio.stop();
      state.audio = patch.audio;
    } catch (err) {
      fail(`mic: ${message(err)}`);
      state.audio = false;
    }
  }
  if (patch.engine !== undefined && patch.engine !== state.engine) {
    if (patch.engine === 'ai' && !diffusion) {
      fail('No AI endpoint configured — set one on the home page.');
    } else {
      state.engine = patch.engine;
      showEngine(patch.engine);
    }
  }
  if (patch.prompt !== undefined) state.prompt = patch.prompt;
  if (patch.aiStrength !== undefined) state.aiStrength = patch.aiStrength;
  diffusion?.setPrompt(state.prompt, state.aiStrength);
  if (patch.preset !== undefined) state.preset = patch.preset;
  if (patch.intensity !== undefined) state.intensity = patch.intensity;
  if (patch.mirror !== undefined) state.mirror = patch.mirror;

  sync?.send(msg.state(state));
}

async function runAction(action: StageAction): Promise<void> {
  if (action === 'record') {
    if (recorder.recording) {
      await recorder.stop();
      state.recording = false;
    } else {
      try {
        recorder.start();
        state.recording = true;
      } catch (err) {
        fail(message(err));
      }
    }
    els.rec.hidden = !state.recording;
    sync?.send(msg.state(state));
  }
  if (action === 'snapshot') snapshot(canvas);
  if (action === 'fullscreen') toggleFullscreen();
}

function onKey(event: KeyboardEvent): void {
  // Number keys address the current bank, so eight keys cover forty looks.
  const looks = banksLooks(bankOf(state.preset));
  const index = Number(event.key) - 1;
  const picked = looks[index];
  if (picked) {
    void applyPatch({ preset: picked.id });
    return;
  }

  const actions: Record<string, () => void> = {
    '[': () => stepBank(-1),
    ']': () => stepBank(1),
    f: () => toggleFullscreen(),
    r: () => void runAction('record'),
    s: () => void runAction('snapshot'),
    c: () => void applyPatch({ source: state.source === 'camera' ? 'shapes' : 'camera' }),
    m: () => void applyPatch({ audio: !state.audio }),
    h: () => hud.classList.toggle('hidden'),
    a: () => void applyPatch({ engine: state.engine === 'ai' ? 'shader' : 'ai' }),
    ArrowUp: () => void applyPatch({ intensity: Math.min(1, state.intensity + 0.05) }),
    ArrowDown: () => void applyPatch({ intensity: Math.max(0, state.intensity - 0.05) }),
  };
  const run = actions[event.key];
  if (run) {
    event.preventDefault();
    run();
  }
}

function stepBank(direction: number): void {
  const at = BANKS.findIndex((bank) => bank.id === bankOf(state.preset));
  const next = BANKS[(at + direction + BANKS.length) % BANKS.length];
  const first = next?.looks[0];
  if (first) void applyPatch({ preset: first.id });
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => {});
}

/**
 * Only the active engine's canvas is on screen. Both keep rendering: the shader
 * is what the room falls back to the moment the socket drops, and restarting it
 * cold at that point would show a black frame first.
 */
function showEngine(engine: 'shader' | 'ai'): void {
  const ai = engine === 'ai' && Boolean(diffusion);
  aiCanvas.hidden = !ai;
  canvas.hidden = ai;
}

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.min(MAX_WIDTH, Math.floor(window.innerWidth * dpr));
  const height = Math.floor(width * (window.innerHeight / window.innerWidth));
  stylizer.resize(width, height);
  diffusion?.resize(width, height);
}

let frames = 0;
let fpsMark = performance.now();

function loop(now: number): void {
  requestAnimationFrame(loop);

  const size = source.size;
  if (size.w > 1) stylizer.setSource(source.element, size.w, size.h);

  const levels = state.audio ? audio.sample() : SILENCE;
  const params = resolveParams(state.preset, state.intensity, levels);
  params.mirror = state.mirror;

  stylizer.render(params, now / 1000);
  if (diffusion) {
    diffusion.setSource(source.element, size.w, size.h);
    diffusion.render(params, now / 1000);
    // Hold the shader on screen until a real frame has arrived, or switching
    // engines flashes black for as long as the first round trip takes.
    if (state.engine === 'ai' && diffusion.live && diffusion.painting) showEngine('ai');
  }

  frames++;
  if (now - fpsMark > 1000) {
    els.fps.textContent = `${frames} fps`;
    els.preset.textContent = state.engine === 'ai' && diffusion?.painting
      ? 'ai'
      : `${bankOf(state.preset)} · ${state.preset}`;
    frames = 0;
    fpsMark = now;
  }
}

function fail(text: string): void {
  els.error.textContent = text;
  els.error.hidden = false;
  hud.classList.remove('hidden');
  setTimeout(() => (els.error.hidden = true), 6000);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in the page`);
  return el as T;
}

void boot();
