import { loadConfig, saveConfig, hasSupabase, makeSessionCode, normaliseCode } from './config.js';

const els = {
  code: document.getElementById('code'),
  openStage: document.getElementById('openStage'),
  openRemote: document.getElementById('openRemote'),
  newCode: document.getElementById('newCode'),
  settings: document.getElementById('settings'),
  supabaseUrl: document.getElementById('supabaseUrl'),
  supabaseAnonKey: document.getElementById('supabaseAnonKey'),
  saveKeys: document.getElementById('saveKeys'),
  keyStatus: document.getElementById('keyStatus'),
};

const LAST_CODE = 'roomshow.lastCode';

const cfg = loadConfig();
els.supabaseUrl.value = cfg.supabaseUrl;
els.supabaseAnonKey.value = cfg.supabaseAnonKey;
els.code.value = localStorage.getItem(LAST_CODE) || makeSessionCode();
// Nudge the panel open the first time, so nobody wires up a projector and only
// then discovers the phone cannot reach it.
els.settings.open = !hasSupabase(cfg);
showKeyStatus();

els.code.addEventListener('input', () => {
  els.code.value = normaliseCode(els.code.value);
});

els.newCode.onclick = () => {
  els.code.value = makeSessionCode();
};

els.openStage.onclick = () => go('stage.html');
els.openRemote.onclick = () => go('remote.html');

els.saveKeys.onclick = () => {
  saveConfig({
    supabaseUrl: els.supabaseUrl.value.trim().replace(/\/+$/, ''),
    supabaseAnonKey: els.supabaseAnonKey.value.trim(),
  });
  showKeyStatus();
};

function go(page) {
  const code = normaliseCode(els.code.value) || makeSessionCode();
  localStorage.setItem(LAST_CODE, code);
  location.href = `${page}?code=${code}`;
}

function showKeyStatus() {
  const ok = hasSupabase(loadConfig());
  els.keyStatus.textContent = ok
    ? 'Saved. The remote will reach the stage from any device.'
    : 'Not set. The remote only works inside this browser.';
  els.keyStatus.style.color = ok ? 'var(--accent-2)' : 'var(--muted)';
}
