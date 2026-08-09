// A gallery of every look, each previewed by the real engine.
//
// Eighty live previews cannot each own a WebGL context — browsers cap that at
// roughly sixteen and start dropping the oldest. So there is exactly one
// offscreen context, and tiles are plain 2D canvases that receive a blit of it.
// A round-robin walks the tiles that are actually on screen, which keeps the
// cost flat no matter how far the list grows.

import './styles/app.css';
import { BANKS, PRESETS, resolveParams } from './presets';
import { SILENCE } from './audio';
import { WebGLStylizer } from './stylizer/webgl';
import { SourceManager } from './source';
import type { BankId } from './types';

const TILE_W = 320;
const TILE_H = 180;
// Tiles refreshed per animation frame. Enough that a screenful stays alive,
// few enough that the browser never drops below display rate.
const TILES_PER_FRAME = 3;
// Feedback-based looks build their trails over successive frames, so a tile has
// to be rendered a few times in a row or every trail look would preview as a
// bare frame.
const WARMUP_FRAMES = 7;

const els = {
  grid: must<HTMLElement>('grid'),
  filters: must<HTMLElement>('filters'),
  count: must<HTMLElement>('count'),
  camera: must<HTMLButtonElement>('useCamera'),
};

interface Tile {
  id: string;
  bank: BankId;
  ctx: CanvasRenderingContext2D;
  card: HTMLElement;
  visible: boolean;
}

const engine = document.createElement('canvas');
engine.width = TILE_W;
engine.height = TILE_H;

const stylizer = new WebGLStylizer(engine);
const source = new SourceManager();
const tiles: Tile[] = [];
let filter: BankId | 'all' = 'all';
let cursor = 0;

async function boot(): Promise<void> {
  stylizer.init();
  await source.use('shapes');
  stylizer.setSource(source.element, source.size.w, source.size.h);

  buildFilters();
  buildTiles();
  applyFilter();

  els.camera.onclick = () => void useCamera();

  requestAnimationFrame(loop);
}

function buildFilters(): void {
  const entries: { id: BankId | 'all'; name: string }[] = [
    { id: 'all', name: 'All' },
    ...BANKS.map((bank) => ({ id: bank.id as BankId, name: bank.name })),
  ];
  els.filters.replaceChildren(...entries.map((entry) => {
    const button = document.createElement('button');
    button.className = 'bank';
    button.textContent = entry.name;
    button.dataset.bank = entry.id;
    button.onclick = () => {
      filter = entry.id;
      applyFilter();
    };
    return button;
  }));
}

function buildTiles(): void {
  // One observer for the whole grid: a tile that has scrolled away stops
  // costing anything, which is what keeps eighty of them affordable.
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const tile = tiles.find((t) => t.card === entry.target);
      if (tile) tile.visible = entry.isIntersecting;
    }
  }, { rootMargin: '200px' });

  els.grid.replaceChildren(...PRESETS.map((preset) => {
    const card = document.createElement('a');
    card.className = 'tile';
    card.dataset.bank = preset.bank;
    card.href = `stage.html?look=${preset.id}`;

    const canvas = document.createElement('canvas');
    canvas.width = TILE_W;
    canvas.height = TILE_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');

    const label = document.createElement('span');
    label.className = 'tile-label';
    label.innerHTML = `<strong>${preset.name}</strong><em>${preset.bank}</em>`;

    card.append(canvas, label);
    tiles.push({ id: preset.id, bank: preset.bank, ctx, card, visible: false });
    observer.observe(card);
    return card;
  }));
}

function applyFilter(): void {
  for (const button of els.filters.querySelectorAll<HTMLButtonElement>('.bank')) {
    button.classList.toggle('active', button.dataset.bank === filter);
  }
  let shown = 0;
  for (const tile of tiles) {
    const match = filter === 'all' || tile.bank === filter;
    tile.card.hidden = !match;
    if (match) shown++;
  }
  els.count.textContent = `${shown} looks`;
  cursor = 0;
}

async function useCamera(): Promise<void> {
  try {
    await source.use('camera');
    els.camera.textContent = 'Camera on';
    els.camera.disabled = true;
  } catch (err) {
    els.camera.textContent = err instanceof Error ? err.message : 'Camera blocked';
  }
}

function loop(now: number): void {
  requestAnimationFrame(loop);

  const size = source.size;
  if (size.w <= 1) return;
  stylizer.setSource(source.element, size.w, size.h);

  const live = tiles.filter((tile) => tile.visible && !tile.card.hidden);
  if (live.length === 0) return;

  for (let i = 0; i < TILES_PER_FRAME; i++) {
    const tile = live[cursor % live.length];
    cursor++;
    if (!tile) continue;

    const params = resolveParams(tile.id, 0.65, SILENCE);
    // The single engine carries one feedback buffer, so whatever the previous
    // tile left behind is still in it. Rendering a run of frames lets this
    // look's own trails take over before the result is copied out.
    for (let frame = 0; frame < WARMUP_FRAMES; frame++) {
      stylizer.render(params, now / 1000 + frame * 0.033);
    }
    tile.ctx.drawImage(engine, 0, 0);
  }
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in the page`);
  return el as T;
}

void boot();
