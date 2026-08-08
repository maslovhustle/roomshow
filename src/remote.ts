// The phone. Sends patches, renders whatever the stage says is true.
//
// Optimistic UI on purpose: a tap must feel instant even on venue wifi, and the
// stage's next state broadcast corrects anything that did not land.

import './styles/app.css';
import { consumePairing, hasSupabase, normaliseCode } from './config';
import { BANKS, bankOf, banksLooks } from './presets';
import { createSync, msg } from './sync';
import { PhonePublisher } from './webrtc';
import type { BankId, Params, SourceKind, StageState, Sync } from './types';

// Before anything else: if the stage handed us its Supabase config in the URL
// fragment, store it and scrub the URL.
consumePairing();

const els = {
  code: must<HTMLDivElement>('code'),
  status: must<HTMLDivElement>('status'),
  notice: must<HTMLParagraphElement>('notice'),
  banks: must<HTMLDivElement>('banks'),
  grid: must<HTMLDivElement>('presets'),
  intensity: must<HTMLInputElement>('intensity'),
  intensityValue: must<HTMLSpanElement>('intensityValue'),
  sources: must<HTMLDivElement>('sources'),
  flip: must<HTMLButtonElement>('flip'),
  mirror: must<HTMLButtonElement>('mirror'),
  mic: must<HTMLButtonElement>('mic'),
  record: must<HTMLButtonElement>('record'),
  snapshot: must<HTMLButtonElement>('snapshot'),
};

const code = normaliseCode(new URLSearchParams(location.search).get('code'));

let sync: Sync | null = null;
let publisher: PhonePublisher | null = null;
let state: StageState = {
  preset: 'comic',
  intensity: 0.65,
  source: 'shapes',
  mirror: 0,
  audio: false,
  recording: false,
};
let lastSeen = 0;

// Which bank the phone is browsing. Deliberately local rather than shared: a VJ
// wants to scroll another bank before committing to it, and the stage
// re-broadcasts its state every two seconds, so a shared bank would yank the
// view back mid-scroll.
let bank: BankId = bankOf(state.preset);
let lastPreset = state.preset;

async function boot(): Promise<void> {
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

  publisher = new PhonePublisher(sync);
  publisher.onFailed = (reason) => showNotice(reason);

  sync.onMessage((message) => {
    if (message.t === 'rtc') {
      if (message.from === 'stage') void publisher?.handle(message.signal);
      return;
    }
    if (message.t !== 'state') return;
    lastSeen = Date.now();
    state = { ...state, ...message.state };
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

function buildBanks(): void {
  els.banks.replaceChildren(...BANKS.map((entry) => {
    const button = document.createElement('button');
    button.className = 'bank';
    button.dataset.bank = entry.id;
    button.textContent = entry.name;
    button.onclick = () => {
      bank = entry.id;
      buildPresets();
      render();
    };
    return button;
  }));
}

function buildPresets(): void {
  els.grid.replaceChildren(...banksLooks(bank).map((preset) => {
    const button = document.createElement('button');
    button.className = 'preset';
    button.dataset.id = preset.id;

    const chip = document.createElement('span');
    chip.className = 'swatch';
    chip.style.setProperty('--g', swatch(preset.params));

    const label = document.createElement('span');
    label.textContent = preset.name;

    button.append(chip, label);
    button.onclick = () => patch({ preset: preset.id });
    return button;
  }));
}

function wireControls(): void {
  // `input` not `change`: riding the fader should move the room, not wait for
  // the finger to lift.
  els.intensity.oninput = () => patch({ intensity: Number(els.intensity.value) / 100 });

  for (const button of els.sources.querySelectorAll('button')) {
    button.onclick = () => {
      const kind = button.dataset.source as SourceKind | undefined;
      if (!kind) return;
      if (kind === 'phone') void startPhone();
      else {
        publisher?.stop();
        els.flip.hidden = true;
        patch({ source: kind });
      }
    };
  }

  els.flip.onclick = () => void publisher?.flip().catch((err: unknown) => {
    showNotice(`Could not switch camera: ${describe(err)}`);
  });

  els.mirror.onclick = () => patch({ mirror: state.mirror ? 0 : 1 });
  els.mic.onclick = () => patch({ audio: !state.audio });
  els.record.onclick = () => sync?.send(msg.action('record'));
  els.snapshot.onclick = () => sync?.send(msg.action('snapshot'));
}

/**
 * The phone is the camera. Capture starts here and the picture reaches the
 * stage over a direct peer connection — only the handshake goes through
 * Supabase.
 */
async function startPhone(): Promise<void> {
  if (!publisher) return;
  try {
    // Always rebuild. Re-tapping is how a user recovers after the stage
    // reloaded, and starting on top of a live connection would leak the old one.
    publisher.stop();
    await publisher.start();
    els.flip.hidden = false;
    els.notice.hidden = true;
    patch({ source: 'phone' });
  } catch (err) {
    // A denied permission must not leave the button looking armed.
    publisher.stop();
    els.flip.hidden = true;
    showNotice(`Camera: ${describe(err)}`);
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function patch(next: Partial<StageState>): void {
  state = { ...state, ...next };
  if (next.preset) lastPreset = next.preset;
  render();
  sync?.send(msg.patch(next));
}

function render(): void {
  for (const button of els.banks.querySelectorAll<HTMLButtonElement>('.bank')) {
    button.classList.toggle('active', button.dataset.bank === bank);
    // The bank holding the live look gets a marker, so it stays findable while
    // browsing somewhere else.
    button.classList.toggle('live', button.dataset.bank === bankOf(state.preset));
  }
  for (const button of els.grid.querySelectorAll<HTMLButtonElement>('.preset')) {
    button.classList.toggle('active', button.dataset.id === state.preset);
  }
  els.intensity.value = String(Math.round(state.intensity * 100));
  els.intensityValue.textContent = `${Math.round(state.intensity * 100)}%`;
  for (const button of els.sources.querySelectorAll('button')) {
    button.classList.toggle('active', button.dataset.source === state.source);
  }
  els.mirror.classList.toggle('active', Boolean(state.mirror));
  els.mic.classList.toggle('active', state.audio);
  els.record.classList.toggle('recording', state.recording);
  els.record.textContent = state.recording ? 'Stop' : 'Record';
}

function showNotice(text: string): void {
  els.notice.textContent = text;
  els.notice.hidden = false;
}

/**
 * The swatch has to describe what the look actually does. A look that never
 * touches duotone still carries the default tint pair in its params, and
 * painting that on the button promises a palette it will never apply.
 */
function swatch(params: Params): string {
  if (params.duotone > 0.05) {
    return `linear-gradient(135deg, ${rgb(params.tintA)}, ${rgb(params.tintB)})`;
  }
  if (params.hue > 0.05) {
    return 'linear-gradient(135deg,#ff4d6a,#ffd166,#3ddc97,#4cc9f0,#b95cff)';
  }
  if (params.invert > 0.5) {
    return 'linear-gradient(135deg,#eceaf2,#15131d)';
  }
  return 'linear-gradient(135deg,#1b1926,#d8d4e4)';
}

function rgb([r, g, b]: readonly [number, number, number]): string {
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in the page`);
  return el as T;
}

void boot();
