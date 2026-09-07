import './styles/app.css';
import { loadConfig, makeSessionCode, normaliseCode, saveConfig } from './config';

const els = {
  code: must<HTMLInputElement>('code'),
  openStage: must<HTMLButtonElement>('openStage'),
  openRemote: must<HTMLButtonElement>('openRemote'),
  newCode: must<HTMLButtonElement>('newCode'),
  diffusionUrl: must<HTMLInputElement>('diffusionUrl'),
  saveDiffusion: must<HTMLButtonElement>('saveDiffusion'),
  diffusionStatus: must<HTMLParagraphElement>('diffusionStatus'),
};

const LAST_CODE = 'roomshow.lastCode';

els.code.value = localStorage.getItem(LAST_CODE) ?? makeSessionCode();

els.code.addEventListener('input', () => {
  els.code.value = normaliseCode(els.code.value);
});

els.newCode.onclick = () => {
  els.code.value = makeSessionCode();
};

els.diffusionUrl.value = loadConfig().diffusionUrl;
showDiffusion();

els.saveDiffusion.onclick = () => {
  saveConfig({ diffusionUrl: els.diffusionUrl.value.trim() });
  showDiffusion();
};

function showDiffusion(): void {
  const url = loadConfig().diffusionUrl;
  els.diffusionStatus.textContent = url
    ? `AI engine enabled. The stage will connect to ${url}.`
    : 'Not set. The app runs the shader engine only.';
  els.diffusionStatus.dataset.tone = url ? 'ok' : 'muted';
}

els.openStage.onclick = () => go('stage.html');
els.openRemote.onclick = () => go('remote.html');

function go(page: string): void {
  const code = normaliseCode(els.code.value) || makeSessionCode();
  localStorage.setItem(LAST_CODE, code);
  location.href = `${page}?code=${code}`;
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in the page`);
  return el as T;
}
