// The phone. Sends patches, renders whatever the stage says is true.
//
// Optimistic UI on purpose: a tap must feel instant even on venue wifi, and the
// stage's next state broadcast corrects anything that did not land.

import { normaliseCode, consumePairing, hasSupabase } from './config.js';
import { createSync, msg } from './sync.js';
import { BANKS, banksLooks, bankOf } from './presets.js';

// Before anything else: if the stage handed us its Supabase config in the URL
// fragment, store it and scrub the URL.
consumePairing();

const code = normaliseCode(new URLSearchParams(location.search).get('code'));
const els = {
  code: document.getElementById('code'),
  status: document.getElementById('status'),
  notice: document.getElementById('notice'),
  banks: document.getElementById('banks'),
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

// Which bank the phone is browsing. Deliberately local rather than shared: a VJ
// wants to scroll another bank before committing to it, and the stage
// re-broadcasts its state every two seconds, so a shared bank would yank the
// view back mid-scroll.
let bank = bankOf(state.preset);
let lastPreset = state.preset;

async function boot() {
  if (!code) {
    els.status.textContent = 'no session';
    showNotice('This link has no session code. Open the stage and use its "copy link" button.');
    return;
  }
  els.code.textContent = code;

  buildBanks();
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
    // Follow the stage into another bank only when the look genuinely changed,
    // never on a routine state rebroadcast.
    if (state.preset !== lastPreset) {
      lastPreset = state.preset;
      if (bankOf(state.preset) !== bank) {
        bank = bankOf(state.preset);
        buildPresets();
      }
    }
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

function buildBanks() {
  els.banks.innerHTML = '';
  for (const entry of BANKS) {
    const button = document.createElement('button');
    button.className = 'bank';
    button.dataset.bank = entry.id;
    button.textContent = entry.name;
    button.onclick = () => {
      bank = entry.id;
      buildPresets();
      render();
    };
    els.banks.appendChild(button);
  }
}

function buildPresets() {
  els.grid.innerHTML = '';
  for (const preset of banksLooks(bank)) {
    const button = document.createElement('button');
    button.className = 'preset';
    button.dataset.id = preset.id;
    button.innerHTML = `<span class="swatch" style="--g:${swatch(preset.params)}"></span><span>${preset.name}</span>`;
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
  if (p.preset) lastPreset = p.preset;
  render();
  sync?.send(msg.patch(p));
}

function render() {
  els.banks.querySelectorAll('.bank').forEach((b) => {
    b.classList.toggle('active', b.dataset.bank === bank);
    // The bank holding the live look gets a marker, so it stays findable while
    // browsing somewhere else.
    b.classList.toggle('live', b.dataset.bank === bankOf(state.preset));
  });
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

// The swatch has to describe what the look actually does. A look that never
// touches duotone still carries the default tint pair in its params, and
// painting that on the button promises a palette it will never apply.
function swatch(p) {
  if (p.duotone > 0.05) {
    return `linear-gradient(135deg, ${rgb(p.tintA)}, ${rgb(p.tintB)})`;
  }
  if (p.hue > 0.05) {
    return 'linear-gradient(135deg,#ff4d6a,#ffd166,#3ddc97,#4cc9f0,#b95cff)';
  }
  if (p.invert > 0.5) {
    return 'linear-gradient(135deg,#eceaf2,#15131d)';
  }
  return 'linear-gradient(135deg,#1b1926,#d8d4e4)';
}

function rgb([r, g, b]) {
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}

boot();
