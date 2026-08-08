import './styles/app.css';
import { hasSupabase, loadConfig, makeSessionCode, normaliseCode, saveConfig } from './config';
import { testSupabase } from './sync';

const els = {
  code: must<HTMLInputElement>('code'),
  openStage: must<HTMLButtonElement>('openStage'),
  openRemote: must<HTMLButtonElement>('openRemote'),
  newCode: must<HTMLButtonElement>('newCode'),
  supabaseUrl: must<HTMLInputElement>('supabaseUrl'),
  supabaseAnonKey: must<HTMLInputElement>('supabaseAnonKey'),
  saveKeys: must<HTMLButtonElement>('saveKeys'),
  testKeys: must<HTMLButtonElement>('testKeys'),
  keyStatus: must<HTMLParagraphElement>('keyStatus'),
  pill: must<HTMLSpanElement>('linkPill'),
};

const LAST_CODE = 'roomshow.lastCode';

const cfg = loadConfig();
els.supabaseUrl.value = cfg.supabaseUrl;
els.supabaseAnonKey.value = cfg.supabaseAnonKey;
els.code.value = localStorage.getItem(LAST_CODE) ?? makeSessionCode();
showKeyStatus();

els.code.addEventListener('input', () => {
  els.code.value = normaliseCode(els.code.value);
});

els.newCode.onclick = () => {
  els.code.value = makeSessionCode();
};

els.openStage.onclick = () => go('stage.html');
els.openRemote.onclick = () => go('remote.html');

function saveKeys(): void {
  saveConfig({
    supabaseUrl: els.supabaseUrl.value.trim().replace(/\/+$/, ''),
    supabaseAnonKey: els.supabaseAnonKey.value.trim(),
  });
  showKeyStatus();
}

els.saveKeys.onclick = saveKeys;

els.testKeys.onclick = async () => {
  // Test what is in the boxes, not what was saved earlier — otherwise pasting a
  // corrected key and hitting Test reports on the old one.
  saveKeys();
  els.testKeys.disabled = true;
  els.testKeys.textContent = 'Testing…';
  const result = await testSupabase();
  els.testKeys.disabled = false;
  els.testKeys.textContent = 'Test connection';
  els.keyStatus.textContent = result.detail;
  els.keyStatus.dataset.tone = result.ok ? 'ok' : 'bad';
};

function go(page: string): void {
  const code = normaliseCode(els.code.value) || makeSessionCode();
  localStorage.setItem(LAST_CODE, code);
  location.href = `${page}?code=${code}`;
}

function showKeyStatus(): void {
  const ok = hasSupabase(loadConfig());
  els.pill.textContent = ok ? 'linked' : 'not linked';
  els.pill.dataset.tone = ok ? 'ok' : 'bad';
  els.keyStatus.textContent = ok
    ? 'Saved on this device. Use "copy link" on the stage to carry it to your phone.'
    : 'Until these are set, the remote only works inside this browser.';
  els.keyStatus.dataset.tone = ok ? 'ok' : 'muted';
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in the page`);
  return el as T;
}
