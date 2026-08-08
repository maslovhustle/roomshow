// A "look" is a full parameter set plus an audio routing table.
//
// params  — static values, 0..1 unless noted.
// audio   — how much bass/energy adds on top of the static value at full
//           intensity. Negative values pull a parameter down on a hit.
//
// Everything the remote can touch lives here, so adding a look is a data change,
// never a code change.

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

export const PRESETS = [
  look('raw', 'Raw', {
    vignette: 0.35,
  }, {
    energy: { glow: 0.3 },
  }),

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

  look('ink', 'Ink Poster', {
    poster: 0.8,
    edge: 0.45,
    duotone: 0.95,
    vignette: 0.5,
    tintA: [0.06, 0.05, 0.04],
    tintB: [0.96, 0.91, 0.78],
  }, {
    bass: { poster: -0.35 },
    energy: { edge: 0.25 },
  }),

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

  look('vhs', 'VHS', {
    pixel: 0.45,
    chroma: 0.55,
    poster: 0.5,
    feedback: 0.3,
    vignette: 0.55,
  }, {
    bass: { chroma: 0.6, pixel: 0.25 },
    energy: { poster: -0.2 },
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
];

export const PRESET_BY_ID = Object.fromEntries(PRESETS.map((p) => [p.id, p]));

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
