import { beforeEach, describe, expect, it } from 'vitest';
import {
  consumePairing,
  hasSupabase,
  loadConfig,
  makeSessionCode,
  normaliseCode,
  pairingHash,
  saveConfig,
} from '../../src/config';

const KEY = 'roomshow.config';

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
});

describe('session codes', () => {
  it('strips anything that cannot be typed on a phone keypad', () => {
    expect(normaliseCode(' ab-3d ')).toBe('AB3D');
    expect(normaliseCode(null)).toBe('');
  });

  it('caps length, so a pasted URL cannot become a session code', () => {
    expect(normaliseCode('ABCDEFGHIJKLMNOP')).toHaveLength(8);
  });

  it('avoids characters that are misread in a dark room', () => {
    const forbidden = /[AEIOUY01LI]/;
    for (let i = 0; i < 200; i++) {
      expect(makeSessionCode(6)).not.toMatch(forbidden);
    }
  });

  it('survives its own output', () => {
    const code = makeSessionCode();
    expect(normaliseCode(code)).toBe(code);
  });
});

describe('config storage', () => {
  it('falls back to defaults rather than throwing on a corrupt entry', () => {
    localStorage.setItem(KEY, '{not json');
    expect(() => loadConfig()).not.toThrow();
    expect(loadConfig().transport).toBe('auto');
  });

  // A half-filled setup form used to write empty strings over working
  // build-time defaults and silently disconnect the app.
  it('ignores stored blanks instead of letting them erase the defaults', () => {
    const built = loadConfig();
    localStorage.setItem(KEY, JSON.stringify({ supabaseUrl: '', supabaseAnonKey: '' }));
    expect(loadConfig().supabaseUrl).toBe(built.supabaseUrl);
    expect(loadConfig().supabaseAnonKey).toBe(built.supabaseAnonKey);
  });

  it('lets a real value override the default', () => {
    saveConfig({ supabaseUrl: 'https://example.supabase.co' });
    expect(loadConfig().supabaseUrl).toBe('https://example.supabase.co');
  });
});

describe('pairing', () => {
  const cfg = {
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'sb_publishable_test-key_value',
    transport: 'auto' as const,
  };

  it('round-trips the config through a URL fragment', () => {
    const hash = pairingHash(cfg);
    expect(hash.startsWith('#k=')).toBe(true);

    history.replaceState(null, '', `/remote.html?code=ABCD${hash}`);
    expect(consumePairing()).toBe(true);

    const stored = loadConfig();
    expect(stored.supabaseUrl).toBe(cfg.supabaseUrl);
    expect(stored.supabaseAnonKey).toBe(cfg.supabaseAnonKey);
  });

  it('scrubs the fragment, so a screenshot or back-button does not carry keys', () => {
    history.replaceState(null, '', `/remote.html?code=ABCD${pairingHash(cfg)}`);
    consumePairing();
    expect(location.hash).toBe('');
    expect(location.search).toBe('?code=ABCD');
  });

  it('emits nothing when there is no config worth carrying', () => {
    expect(pairingHash({ supabaseUrl: '', supabaseAnonKey: '', transport: 'auto' })).toBe('');
  });

  it('reports a miss for an unrelated fragment and leaves storage alone', () => {
    history.replaceState(null, '', '/remote.html#section');
    expect(consumePairing()).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('does not throw on a corrupt payload', () => {
    history.replaceState(null, '', '/remote.html#k=!!!not-base64!!!');
    expect(consumePairing()).toBe(false);
  });
});

describe('hasSupabase', () => {
  it('needs both halves', () => {
    expect(hasSupabase({ supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: '', transport: 'auto' })).toBe(false);
    expect(hasSupabase({ supabaseUrl: '', supabaseAnonKey: 'k', transport: 'auto' })).toBe(false);
    expect(hasSupabase({ supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k', transport: 'auto' })).toBe(true);
  });
});
