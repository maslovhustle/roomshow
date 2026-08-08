// The phone. Sends patches, renders whatever the stage says is true.
//
// Optimistic UI on purpose: a tap must feel instant even on venue wifi, and the
// stage's next state broadcast corrects anything that did not land.

import { normaliseCode, consumePairing, hasSupabase } from './config.js';
import { createSync, msg } from './sync.js';
import { PRESETS } from './presets.js';

// Before anything else: if the stage handed us its Supabase config in the URL
// fragment, store it and scrub the URL.
consumePairing();

const code = normaliseCode(new URLSearchParams(location.search).get('code'));
const els = {
  code: document.getElementById('code'),
  status: document.getElementById('status'),
  notice: document.getElementById('notice'),
  grid: document.getElementById('presets'),
  intensity: document.getElementById('intensity'),
  intensityValue: document.getElementById('intensityValue'),
  sources: document.getElementById('sources'),
  mirror: document.getElementById('mirror'),
  mic: document.getElementById('mic'),
  record: document.getElementById('record'),
  snapshot: document.getElementById('snapshot'),
};

let sync = null;
let state = { preset: 'neon', intensity: 0.65, source: 'shapes', mirror: 0, audio: false, recording: false };
let lastSeen = 0;

async function boot() {
  if (!code) {
    els.status.textContent = 'no session';
    showNotice('This link has no session code. Open the stage and use its "copy link" button.');
    return;
  }
  els.code.textContent = code;

  buildPresets();
  wireControls();

  sync = await createSync(code);

  // The old failure mode was silent: no keys meant a BroadcastChannel that can
  // never reach another device, and a phone stuck on "waiting for stage" with
  // no way to know why.
  if (sync.name !== 'supabase') {
    showNotice(hasSupabase()
      ? 'Could not reach Supabase — check the network and reload.'
      : 'This device has no Supabase keys, so it cannot reach the stage. Open the stage, tap "copy link", and open that link here.');
  }

  sync.onMessage((m) => {
    if (m.t !== 'state') return;
    lastSeen = Date.now();
    state = { ...state, ...m.state };
    render();
  });
  sync.send(msg.hello('remote'));

  setInterval(() => {
    const alive = Date.now() - lastSeen < 5000;
    els.status.textContent = alive ? 'connected' : 'waiting for stage…';
    els.status.dataset.alive = String(alive);
  }, 1000);

  render();
}

function buildPresets() {
  els.grid.innerHTML = '';
  for (const preset of PRESETS) {
    const button = document.createElement('button');
    button.className = 'preset';
    button.dataset.id = preset.id;
    button.innerHTML = `<span class="swatch" style="--a:${rgb(preset.params.tintA)};--b:${rgb(preset.params.tintB)}"></span><span>${preset.name}</span>`;
    button.onclick = () => patch({ preset: preset.id });
    els.grid.appendChild(button);
  }
}

function wireControls() {
  // `input` not `change`: riding the fader should move the room, not wait for
  // the finger to lift.
  els.intensity.oninput = () => patch({ intensity: Number(els.intensity.value) / 100 });

  els.sources.querySelectorAll('button').forEach((button) => {
    button.onclick = () => patch({ source: button.dataset.source });
  });

  els.mirror.onclick = () => patch({ mirror: state.mirror ? 0 : 1 });
  els.mic.onclick = () => patch({ audio: !state.audio });
  els.record.onclick = () => sync.send(msg.action('record'));
  els.snapshot.onclick = () => sync.send(msg.action('snapshot'));
}

function patch(p) {
  state = { ...state, ...p };
  render();
  sync?.send(msg.patch(p));
}

function render() {
  els.grid.querySelectorAll('.preset').forEach((b) => {
    b.classList.toggle('active', b.dataset.id === state.preset);
  });
  els.intensity.value = String(Math.round(state.intensity * 100));
  els.intensityValue.textContent = `${Math.round(state.intensity * 100)}%`;
  els.sources.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b.dataset.source === state.source);
  });
  els.mirror.classList.toggle('active', Boolean(state.mirror));
  els.mic.classList.toggle('active', Boolean(state.audio));
  els.record.classList.toggle('recording', Boolean(state.recording));
  els.record.textContent = state.recording ? 'Stop' : 'Record';
}

function showNotice(text) {
  els.notice.textContent = text;
  els.notice.hidden = false;
}

function rgb([r, g, b]) {
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}

boot();
