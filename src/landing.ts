import './styles/app.css';
import {
  BUILT_IN_DIFFUSION_URL as BUILT_IN_ENDPOINT,
  loadConfig,
  makeSessionCode,
  normaliseCode,
  saveConfig,
} from './config';

const els = {
  code: must<HTMLInputElement>('code'),
  openStage: must<HTMLButtonElement>('openStage'),
  openRemote: must<HTMLButtonElement>('openRemote'),
  newCode: must<HTMLButtonElement>('newCode'),
  diffusionUrl: must<HTMLInputElement>('diffusionUrl'),
  resetDiffusion: must<HTMLButtonElement>('resetDiffusion'),
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

// A rented GPU gets a new address every time it is created, so a saved endpoint
// outlives the box it named and then fails with nothing but "Failed to fetch" —
// while a working endpoint sits in the build the whole time, overridden by the
// stale one. This is the way back.
els.resetDiffusion.onclick = () => {
  saveConfig({ diffusionUrl: '' });
  els.diffusionUrl.value = loadConfig().diffusionUrl;
  showDiffusion();
};

function showDiffusion(): void {
  const url = loadConfig().diffusionUrl;
  const overridden = url !== '' && url !== BUILT_IN_ENDPOINT;
  els.diffusionStatus.textContent = !url
    ? 'Not set. The app runs the shader engine only.'
    : overridden
      ? `Using a saved endpoint: ${url}. The build ships with ${BUILT_IN_ENDPOINT || 'none'}.`
      : `AI engine enabled. The stage will connect to ${url}.`;
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
