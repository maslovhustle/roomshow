import { describe, expect, it } from 'vitest';
import { BANKS, PARAM_DEFAULTS, PRESETS, bankOf, banksLooks, resolveParams } from '../../src/presets';
import { SILENCE } from '../../src/audio';

const NEUTRAL = { bass: 0, energy: 0 };

describe('the look catalogue', () => {
  it('gives every bank a full row of eight', () => {
    for (const bank of BANKS) expect(bank.looks, bank.id).toHaveLength(8);
    expect(PRESETS).toHaveLength(BANKS.length * 8);
  });

  it('keeps every id unique, since ids address looks over the wire', () => {
    const ids = PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('fills in every parameter the shader reads', () => {
    const expected = Object.keys(PARAM_DEFAULTS).sort();
    for (const preset of PRESETS) {
      expect(Object.keys(preset.params).sort(), preset.id).toEqual(expected);
    }
  });

  it('keeps parameters inside the range the shader assumes', () => {
    for (const preset of PRESETS) {
      for (const [key, value] of Object.entries(preset.params)) {
        if (typeof value !== 'number') continue;
        expect(value, `${preset.id}.${key}`).toBeGreaterThanOrEqual(0);
        expect(value, `${preset.id}.${key}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('only routes audio to parameters that exist', () => {
    for (const preset of PRESETS) {
      for (const band of ['bass', 'energy'] as const) {
        for (const key of Object.keys(preset.audio[band])) {
          expect(PARAM_DEFAULTS, `${preset.id}.${band}.${key}`).toHaveProperty(key);
        }
      }
    }
  });
});

describe('gradient stops', () => {
  // The four-stop map arrived long after most looks were written. Two-stop
  // looks must still render exactly as they did, or adding midtones silently
  // restyled half the catalogue.
  it('spaces the midtones along A->B when a look names only two colours', () => {
    const neon = PRESETS.find((preset) => preset.id === 'neon');
    expect(neon).toBeDefined();
    const { tintA, tintB, tintC, tintD } = neon!.params;
    expect(tintD).toEqual([0.02, 0.0, 0.09].map((v, i) => v + ([0.15, 0.95, 0.98][i]! - v) * 1));
    for (let channel = 0; channel < 3; channel++) {
      const a = tintA[channel]!;
      const d = tintD[channel]!;
      expect(tintB[channel]).toBeCloseTo(a + (d - a) / 3, 6);
      expect(tintC[channel]).toBeCloseTo(a + (d - a) * (2 / 3), 6);
    }
  });

  it('leaves a look that names four colours alone', () => {
    const kodak = PRESETS.find((preset) => preset.id === 'kodak');
    expect(kodak?.params.tintB).toEqual([0.32, 0.2, 0.1]);
    expect(kodak?.params.tintC).toEqual([0.78, 0.6, 0.32]);
  });
});

describe('bank lookup', () => {
  it('reports the bank a look belongs to', () => {
    expect(bankOf('comic')).toBe('cel');
    expect(bankOf('kodak')).toBe('film');
  });

  it('falls back to the first bank for an unknown id, rather than throwing', () => {
    expect(bankOf('not-a-look')).toBe(BANKS[0].id);
    expect(banksLooks(BANKS[0].id)).toHaveLength(8);
  });
});

describe('resolveParams', () => {
  it('returns the look untouched when the room is silent', () => {
    const comic = PRESETS.find((preset) => preset.id === 'comic')!;
    expect(resolveParams('comic', 1, SILENCE)).toEqual(comic.params);
  });

  it('falls back to a real look rather than returning undefined parameters', () => {
    const resolved = resolveParams('not-a-look', 0.5, NEUTRAL);
    expect(Object.keys(resolved).sort()).toEqual(Object.keys(PARAM_DEFAULTS).sort());
  });

  it('pushes routed parameters with the audio level', () => {
    const base = resolveParams('neon', 0.5, SILENCE);
    const loud = resolveParams('neon', 0.5, { bass: 1, energy: 1 });
    // Neon routes bass into glow, so a kick has to move it.
    expect(loud.glow).toBeGreaterThan(base.glow);
  });

  it('scales the push by intensity, which is what the fader is for', () => {
    const half = resolveParams('neon', 0.5, { bass: 1, energy: 0 });
    const full = resolveParams('neon', 1, { bass: 1, energy: 0 });
    expect(full.glow).toBeGreaterThan(half.glow);
  });

  it('clamps, so a loud room cannot drive a parameter out of range', () => {
    const resolved = resolveParams('neon', 1, { bass: 1, energy: 1 });
    for (const [key, value] of Object.entries(resolved)) {
      if (typeof value !== 'number') continue;
      expect(value, key).toBeGreaterThanOrEqual(0);
      expect(value, key).toBeLessThanOrEqual(1);
    }
  });

  it('never mutates the stored look, since resolve runs every frame', () => {
    const before = structuredClone(PRESETS.find((preset) => preset.id === 'neon')!.params);
    resolveParams('neon', 1, { bass: 1, energy: 1 });
    expect(PRESETS.find((preset) => preset.id === 'neon')!.params).toEqual(before);
  });
});
