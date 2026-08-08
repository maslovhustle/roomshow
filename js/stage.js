// The machine plugged into the projector.
//
// The stage owns the state. The remote only ever sends patches; every applied
// patch is re-broadcast, so a phone that joins late, reconnects, or was locked
// in a pocket lands on the truth within one tick. Everything here also works
// with the keyboard alone — a demo must never be one dead phone away from
// a black screen.

import { normaliseCode, makeSessionCode, pairingHash, hasSupabase } from './config.js';
import { createSync, msg } from './sync.js';
import { BANKS, banksLooks, bankOf, resolveParams } from './presets.js';
import { WebGLStylizer } from './stylizer/webgl.js';
import { SourceManager } from './source.js';
import { CanvasRecorder, snapshot } from './recorder.js';
import { AudioReactor } from './audio.js';

const MAX_WIDTH = 1920;

const canvas = document.getElementById('stage');
const hud = document.getElementById('hud');
const els = {
  code: document.getElementById('code'),
  remoteUrl: document.getElementById('remoteUrl'),
  copy: document.getElementById('copyLink'),
  status: document.getElementById('status'),
  preset: document.getElementById('nowPreset'),
  fps: document.getElementById('fps'),
  rec: document.getElementById('recDot'),
  error: document.getElementById('error'),
};

const code = normaliseCode(new URLSearchParams(location.search).get('code')) || makeSessionCode();
const stylizer = new WebGLStylizer(canvas);
const source = new SourceManager();
const audio = new AudioReactor();
const recorder = new CanvasRecorder(canvas);

const state = {
  preset: 'neon',
  intensity: 0.65,
  source: 'shapes',
  mirror: 0,
  audio: false,
  recording: false,
};

let sync = null;

async function boot() {
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

  if (!hasSupabase()) {
    fail('No Supabase keys — the remote will only reach this browser. Add them on the home page.');
  }

  try {
    stylizer.init();
  } catch (err) {
    return fail(err.message);
  }

  await source.use('shapes');
  stylizer.setSource(source.element, source.size.w, source.size.h);
  resize();

  sync = await createSync(code);
  els.status.textContent = sync.name === 'supabase' ? 'remote: online' : 'remote: same-device only';
  els.status.dataset.mode = sync.name;
  sync.onMessage(onMessage);
  sync.send(msg.state(state));

  window.addEventListener('resize', resize);
  window.addEventListener('keydown', onKey);
  // A quiet stage still needs to prove it is alive to a phone that just woke up.
  setInterval(() => sync.send(msg.state(state)), 2000);

  requestAnimationFrame(loop);
}

function onMessage(m) {
  if (m.t === 'hello') return sync.send(msg.state(state));
  if (m.t === 'patch') return applyPatch(m.patch);
  if (m.t === 'action') return runAction(m.action);
}

async function applyPatch(patch) {
  if (patch.source && patch.source !== state.source) {
    try {
      await source.use(patch.source);
      state.source = patch.source;
    } catch (err) {
      fail(`camera: ${err.message}`);
      // Never leave the projector dark because a permission was denied.
      await source.use('shapes');
      state.source = 'shapes';
    }
  }
  if (patch.audio !== undefined && patch.audio !== state.audio) {
    try {
      if (patch.audio) await audio.start(); else audio.stop();
      state.audio = patch.audio;
    } catch (err) {
      fail(`mic: ${err.message}`);
      state.audio = false;
    }
  }
  for (const key of ['preset', 'intensity', 'mirror']) {
    if (patch[key] !== undefined) state[key] = patch[key];
  }
  sync.send(msg.state(state));
}

async function runAction(action) {
  if (action === 'record') {
    if (recorder.recording) {
      await recorder.stop();
      state.recording = false;
    } else {
      try {
        recorder.start();
        state.recording = true;
      } catch (err) {
        fail(err.message);
      }
    }
    els.rec.hidden = !state.recording;
    sync.send(msg.state(state));
  }
  if (action === 'snapshot') snapshot(canvas);
  if (action === 'fullscreen') toggleFullscreen();
}

function onKey(e) {
  // Number keys address the current bank, so eight keys cover forty looks.
  const looks = banksLooks(bankOf(state.preset));
  const index = Number(e.key) - 1;
  if (index >= 0 && index < looks.length) return applyPatch({ preset: looks[index].id });

  const keys = {
    '[': () => stepBank(-1),
    ']': () => stepBank(1),
    f: () => toggleFullscreen(),
    r: () => runAction('record'),
    s: () => runAction('snapshot'),
    c: () => applyPatch({ source: state.source === 'camera' ? 'shapes' : 'camera' }),
    m: () => applyPatch({ audio: !state.audio }),
    h: () => hud.classList.toggle('hidden'),
    ArrowUp: () => applyPatch({ intensity: Math.min(1, state.intensity + 0.05) }),
    ArrowDown: () => applyPatch({ intensity: Math.max(0, state.intensity - 0.05) }),
  };
  const fn = keys[e.key];
  if (fn) {
    e.preventDefault();
    fn();
  }
}

function stepBank(direction) {
  const at = BANKS.findIndex((b) => b.id === bankOf(state.preset));
  const next = BANKS[(at + direction + BANKS.length) % BANKS.length];
  applyPatch({ preset: next.looks[0].id });
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.min(MAX_WIDTH, Math.floor(window.innerWidth * dpr));
  const height = Math.floor(width * (window.innerHeight / window.innerWidth));
  stylizer.resize(width, height);
}

let frames = 0;
let fpsMark = performance.now();

function loop(now) {
  requestAnimationFrame(loop);

  const size = source.size;
  if (size.w > 1) stylizer.setSource(source.element, size.w, size.h);

  const levels = state.audio ? audio.sample() : { bass: 0, energy: 0 };
  const params = resolveParams(state.preset, state.intensity, levels);
  params.mirror = state.mirror;

  stylizer.render(params, now / 1000);

  frames++;
  if (now - fpsMark > 1000) {
    els.fps.textContent = `${frames} fps`;
    els.preset.textContent = `${bankOf(state.preset)} · ${state.preset}`;
    frames = 0;
    fpsMark = now;
  }
}

function fail(message) {
  els.error.textContent = message;
  els.error.hidden = false;
  hud.classList.remove('hidden');
  setTimeout(() => (els.error.hidden = true), 6000);
}

boot();
