// A "look" is a full parameter set plus an audio routing table.
//
// params  — static values, 0..1 unless noted.
// audio   — how much bass/energy adds on top of the static value at full
//           intensity. Negative values pull a parameter down on a hit.
//
// Looks are grouped into banks of eight, the way a DJ controller is. Forty in a
// flat list means twenty rows of scrolling on a phone in a dark room, which
// defeats the point of having a remote at all. Eight fits one thumb-reach
// screen, and the number keys map onto the current bank.
//
// Everything the remote can touch lives here, so adding a look is a data
// change, never a code change.

export const PARAM_DEFAULTS = {
  mirror: 0,     // horizontal mirror, 0 or 1
  kaleido: 0,    // segment count driver
  pixel: 0,      // pixelation
  chroma: 0,     // rgb split
  edge: 0,       // sobel mix
  poster: 0,     // colour quantisation
  hue: 0,        // hue rotation speed
  duotone: 0,    // luminance -> two-colour ramp
  feedback: 0,   // trail retention
  warp: 0,       // feedback zoom
  spin: 0,       // feedback rotation
  glow: 0,
  vignette: 0.25,
  invert: 0,
  halftone: 0,   // print dot screen
  scanline: 0,
  grain: 0,
  slice: 0,      // horizontal band displacement
  // These two are neutral at 0.5, not 0 — a look that says nothing about them
  // must leave the image alone.
  sat: 0.5,
  contrast: 0.5,
  tintA: [0.05, 0.02, 0.12],
  tintB: [0.98, 0.42, 0.86],
};

const look = (id, name, params, audio = {}) => ({
  id,
  name,
  params: { ...PARAM_DEFAULTS, ...params },
  audio: { bass: {}, energy: {}, ...audio },
});

// Ink — print and graphic arts. Flat, high-contrast, no motion smear. These are
// the looks that survive a bad projector in a bright room.
const INK = [
  look('raw', 'Raw', {
    vignette: 0.35,
    contrast: 0.55,
  }, {
    energy: { glow: 0.3 },
  }),

  look('inkposter', 'Ink Poster', {
    poster: 0.8,
    edge: 0.45,
    duotone: 0.95,
    contrast: 0.6,
    vignette: 0.5,
    tintA: [0.06, 0.05, 0.04],
    tintB: [0.96, 0.91, 0.78],
  }, {
    bass: { poster: -0.35 },
    energy: { edge: 0.25 },
  }),

  look('blueprint', 'Blueprint', {
    invert: 1,
    edge: 0.7,
    duotone: 0.9,
    sat: 0.3,
    contrast: 0.6,
    tintA: [0.02, 0.08, 0.32],
    tintB: [0.88, 0.94, 1.0],
  }, {
    bass: { edge: 0.25 },
    energy: { contrast: 0.15 },
  }),

  look('halftone', 'Halftone', {
    halftone: 0.7,
    poster: 0.55,
    duotone: 0.8,
    contrast: 0.62,
    tintA: [0.08, 0.06, 0.05],
    tintB: [0.97, 0.89, 0.72],
  }, {
    bass: { halftone: -0.35 },
    energy: { contrast: 0.2 },
  }),

  look('woodcut', 'Woodcut', {
    edge: 0.9,
    poster: 0.9,
    contrast: 0.85,
    sat: 0,
    vignette: 0.45,
  }, {
    bass: { contrast: -0.25 },
    energy: { edge: 0.1 },
  }),

  look('newsprint', 'Newsprint', {
    halftone: 0.45,
    grain: 0.35,
    sat: 0.15,
    contrast: 0.6,
    vignette: 0.4,
  }, {
    bass: { halftone: 0.3 },
    energy: { grain: 0.3 },
  }),

  look('chalk', 'Chalk', {
    invert: 1,
    edge: 0.8,
    duotone: 0.85,
    grain: 0.2,
    contrast: 0.6,
    tintA: [0.06, 0.09, 0.08],
    tintB: [0.94, 0.96, 0.92],
  }, {
    bass: { edge: 0.2 },
    energy: { grain: 0.25 },
  }),

  look('xerox', 'Xerox', {
    contrast: 0.95,
    poster: 0.95,
    sat: 0,
    grain: 0.4,
    vignette: 0.5,
  }, {
    bass: { contrast: -0.3 },
    energy: { grain: 0.35 },
  }),
];

// Neon — edge-driven and self-lit. Built for a dark room and a big throw.
const NEON = [
  look('neon', 'Neon Grid', {
    edge: 0.55,
    chroma: 0.35,
    duotone: 0.65,
    feedback: 0.55,
    glow: 0.55,
    tintA: [0.02, 0.0, 0.09],
    tintB: [0.15, 0.95, 0.98],
  }, {
    bass: { chroma: 0.5, glow: 0.5, warp: 0.35 },
    energy: { edge: 0.2 },
  }),

  look('wireframe', 'Wireframe', {
    edge: 0.95,
    contrast: 0.8,
    duotone: 0.85,
    glow: 0.5,
    tintA: [0.0, 0.01, 0.05],
    tintB: [0.35, 0.98, 1.0],
  }, {
    bass: { glow: 0.5 },
    energy: { edge: 0.05 },
  }),

  look('laser', 'Laser', {
    edge: 0.7,
    glow: 0.85,
    duotone: 0.9,
    feedback: 0.5,
    chroma: 0.3,
    tintA: [0.0, 0.02, 0.0],
    tintB: [0.62, 1.0, 0.2],
  }, {
    bass: { glow: 0.5, chroma: 0.45, warp: 0.4 },
    energy: { feedback: 0.12 },
  }),

  look('circuit', 'Circuit', {
    edge: 0.6,
    poster: 0.6,
    scanline: 0.5,
    duotone: 0.8,
    glow: 0.4,
    tintA: [0.0, 0.04, 0.02],
    tintB: [0.25, 1.0, 0.55],
  }, {
    bass: { scanline: 0.35 },
    energy: { edge: 0.25 },
  }),

  look('outline', 'Outline', {
    edge: 1,
    invert: 1,
    sat: 0,
    contrast: 0.7,
    vignette: 0.3,
  }, {
    bass: { contrast: 0.2 },
    energy: { grain: 0.15 },
  }),

  look('plasma', 'Plasma', {
    hue: 0.55,
    glow: 0.6,
    feedback: 0.55,
    warp: 0.3,
    sat: 0.75,
  }, {
    bass: { warp: 0.55, glow: 0.4 },
    energy: { hue: 0.4 },
  }),

  look('vapor', 'Vapor', {
    chroma: 0.5,
    duotone: 0.7,
    glow: 0.5,
    feedback: 0.4,
    sat: 0.7,
    tintA: [0.12, 0.02, 0.28],
    tintB: [1.0, 0.55, 0.85],
  }, {
    bass: { chroma: 0.5 },
    energy: { glow: 0.35 },
  }),

  look('signal', 'Signal', {
    edge: 0.6,
    scanline: 0.6,
    chroma: 0.45,
    glow: 0.5,
    grain: 0.15,
    duotone: 0.6,
    tintA: [0.02, 0.02, 0.08],
    tintB: [0.4, 0.92, 1.0],
  }, {
    bass: { chroma: 0.5, scanline: 0.3 },
    energy: { edge: 0.2 },
  }),
];

// Trail — everything here lives on frame feedback. Slow to react by nature, so
// the audio routing drives the warp rather than the colour.
const TRAIL = [
  look('trails', 'Ghost Trails', {
    feedback: 0.88,
    warp: 0.45,
    spin: 0.12,
    glow: 0.5,
    duotone: 0.4,
    tintA: [0.0, 0.02, 0.08],
    tintB: [0.99, 0.72, 0.25],
  }, {
    bass: { warp: 0.6, spin: 0.4 },
    energy: { feedback: 0.08 },
  }),

  look('melt', 'Liquid Melt', {
    feedback: 0.92,
    warp: 0.75,
    spin: 0.35,
    hue: 0.2,
    glow: 0.45,
  }, {
    bass: { spin: 0.65, warp: 0.4 },
    energy: { hue: 0.35 },
  }),

  look('slipstream', 'Slipstream', {
    feedback: 0.85,
    warp: 0.8,
    spin: 0.05,
    glow: 0.35,
    duotone: 0.5,
    tintA: [0.0, 0.03, 0.12],
    tintB: [0.5, 0.85, 1.0],
  }, {
    bass: { warp: 0.5 },
    energy: { glow: 0.35 },
  }),

  look('vortex', 'Vortex', {
    feedback: 0.9,
    spin: 0.8,
    warp: 0.3,
    glow: 0.4,
    sat: 0.65,
  }, {
    bass: { spin: 0.4, warp: 0.5 },
    energy: { glow: 0.3 },
  }),

  // No warp and no spin on purpose: pure ghosting, the one look in this bank
  // that holds the frame still.
  look('echo', 'Echo', {
    feedback: 0.8,
    poster: 0.5,
    contrast: 0.58,
    vignette: 0.4,
  }, {
    bass: { feedback: 0.14 },
    energy: { poster: -0.2 },
  }),

  look('smear', 'Smear', {
    feedback: 0.85,
    warp: 0.5,
    pixel: 0.35,
    chroma: 0.3,
  }, {
    bass: { pixel: 0.3, chroma: 0.4 },
    energy: { warp: 0.3 },
  }),

  look('comet', 'Comet', {
    feedback: 0.93,
    warp: 0.5,
    glow: 0.8,
    duotone: 0.8,
    tintA: [0.03, 0.0, 0.06],
    tintB: [1.0, 0.62, 0.18],
  }, {
    bass: { warp: 0.5, glow: 0.4 },
    energy: { feedback: 0.06 },
  }),

  look('undertow', 'Undertow', {
    feedback: 0.88,
    spin: 0.5,
    warp: 0.2,
    duotone: 0.75,
    sat: 0.4,
    tintA: [0.0, 0.04, 0.14],
    tintB: [0.3, 0.85, 0.82],
  }, {
    bass: { spin: 0.45 },
    energy: { warp: 0.35 },
  }),
];

// Optic — the polar fold and its relatives. Strongest on a busy frame; a static
// close-up gives them nothing to work with.
const OPTIC = [
  look('kaleido', 'Kaleidoscope', {
    kaleido: 0.6,
    hue: 0.35,
    feedback: 0.6,
    warp: 0.25,
    glow: 0.35,
    vignette: 0.4,
  }, {
    bass: { kaleido: 0.35, warp: 0.5 },
    energy: { hue: 0.4 },
  }),

  look('prism', 'Prism', {
    kaleido: 0.3,
    chroma: 0.7,
    glow: 0.45,
    sat: 0.7,
  }, {
    bass: { chroma: 0.3, kaleido: 0.3 },
    energy: { glow: 0.35 },
  }),

  look('mandala', 'Mandala', {
    kaleido: 1,
    feedback: 0.7,
    hue: 0.25,
    glow: 0.4,
  }, {
    bass: { warp: 0.55 },
    energy: { hue: 0.35 },
  }),

  look('fracture', 'Fracture', {
    kaleido: 0.5,
    slice: 0.5,
    edge: 0.5,
    contrast: 0.65,
    glow: 0.3,
  }, {
    bass: { slice: 0.45 },
    energy: { edge: 0.3 },
  }),

  look('tunnel', 'Tunnel', {
    feedback: 0.92,
    warp: 1,
    kaleido: 0.2,
    glow: 0.5,
  }, {
    bass: { spin: 0.5 },
    energy: { glow: 0.35 },
  }),

  look('lattice', 'Lattice', {
    kaleido: 0.45,
    poster: 0.7,
    halftone: 0.5,
    duotone: 0.7,
    tintA: [0.04, 0.03, 0.1],
    tintB: [0.92, 0.86, 0.5],
  }, {
    bass: { halftone: -0.3 },
    energy: { kaleido: 0.25 },
  }),

  look('mirrorhall', 'Mirror Hall', {
    mirror: 1,
    kaleido: 0.35,
    feedback: 0.75,
    warp: 0.35,
    glow: 0.35,
  }, {
    bass: { warp: 0.5, kaleido: 0.25 },
    energy: { feedback: 0.1 },
  }),

  look('spiral', 'Spiral', {
    kaleido: 0.55,
    spin: 0.7,
    feedback: 0.8,
    hue: 0.2,
    glow: 0.4,
  }, {
    bass: { spin: 0.3 },
    energy: { hue: 0.3 },
  }),
];

// Signal — broken-transmission looks. Grain and slice carry these, so they read
// as deliberate rather than as a failing cable.
const SIGNAL = [
  look('vhs', 'VHS', {
    pixel: 0.45,
    chroma: 0.55,
    poster: 0.5,
    scanline: 0.45,
    feedback: 0.3,
    vignette: 0.55,
  }, {
    bass: { chroma: 0.6, pixel: 0.25 },
    energy: { poster: -0.2 },
  }),

  look('thermal', 'Thermal', {
    duotone: 1.0,
    poster: 0.65,
    edge: 0.3,
    glow: 0.3,
    feedback: 0.35,
    tintA: [0.02, 0.0, 0.22],
    tintB: [1.0, 0.85, 0.15],
  }, {
    bass: { poster: -0.4, glow: 0.5 },
    energy: { edge: 0.3 },
  }),

  look('datamosh', 'Datamosh', {
    slice: 0.8,
    chroma: 0.6,
    feedback: 0.6,
    poster: 0.4,
  }, {
    bass: { slice: 0.2, chroma: 0.4 },
    energy: { feedback: 0.2 },
  }),

  look('crt', 'CRT', {
    scanline: 0.8,
    chroma: 0.35,
    glow: 0.45,
    contrast: 0.6,
    vignette: 0.6,
  }, {
    bass: { chroma: 0.45 },
    energy: { scanline: 0.15 },
  }),

  look('lofi', 'Lo-Fi', {
    pixel: 0.7,
    poster: 0.7,
    grain: 0.3,
    sat: 0.6,
  }, {
    bass: { pixel: -0.3 },
    energy: { grain: 0.3 },
  }),

  look('infrared', 'Infrared', {
    duotone: 1,
    poster: 0.5,
    contrast: 0.7,
    glow: 0.4,
    tintA: [0.04, 0.0, 0.02],
    tintB: [1.0, 0.18, 0.1],
  }, {
    bass: { glow: 0.5, poster: -0.3 },
    energy: { contrast: 0.15 },
  }),

  look('bleach', 'Bleach', {
    contrast: 0.9,
    sat: 0.12,
    grain: 0.3,
    vignette: 0.5,
  }, {
    bass: { contrast: -0.25 },
    energy: { grain: 0.3 },
  }),

  look('static', 'Static', {
    grain: 0.8,
    slice: 0.35,
    poster: 0.6,
    scanline: 0.3,
    sat: 0.2,
  }, {
    bass: { slice: 0.4 },
    energy: { grain: 0.2 },
  }),
];

export const BANKS = [
  { id: 'ink', name: 'Ink', looks: INK },
  { id: 'neon', name: 'Neon', looks: NEON },
  { id: 'trail', name: 'Trail', looks: TRAIL },
  { id: 'optic', name: 'Optic', looks: OPTIC },
  { id: 'signal', name: 'Signal', looks: SIGNAL },
];

export const PRESETS = BANKS.flatMap((bank) =>
  bank.looks.map((entry) => ({ ...entry, bank: bank.id })));

export const PRESET_BY_ID = Object.fromEntries(PRESETS.map((p) => [p.id, p]));

export function banksLooks(bankId) {
  return (BANKS.find((b) => b.id === bankId) || BANKS[0]).looks;
}

export function bankOf(presetId) {
  return PRESET_BY_ID[presetId]?.bank || BANKS[0].id;
}

// Resolves a preset + live audio into the flat uniform set the renderer wants.
// `intensity` is the master fader on the remote: it scales how far audio is
// allowed to push each parameter, not the look itself.
export function resolveParams(presetId, intensity, audio) {
  const preset = PRESET_BY_ID[presetId] || PRESETS[0];
  const out = { ...preset.params };

  for (const [band, routes] of Object.entries({ bass: preset.audio.bass, energy: preset.audio.energy })) {
    const level = (audio?.[band] ?? 0) * intensity;
    for (const [param, amount] of Object.entries(routes || {})) {
      out[param] = clamp01(out[param] + amount * level);
    }
  }
  return out;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
