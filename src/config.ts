// Runtime config. Nothing is baked in at build time, so the same bundle works
// locally and in production. Keys live in localStorage — the anon key is public
// by design, but keeping it out of git means one less thing to rotate.

const KEY = 'roomshow.config';

export interface Config {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** 'auto' picks Supabase when keys are present, BroadcastChannel otherwise. */
  transport: 'auto' | 'supabase' | 'local';
}

// Baked in at build time so the app works with no setup screen. Both values are
// publishable by design; Supabase ships them to every browser that loads any app
// built on it. A user can still point the app at their own project, which is
// what the home page writes to localStorage.
const DEFAULTS: Config = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_KEY ?? '',
  transport: 'auto',
};

export function loadConfig(): Config {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Config>;
    // Empty stored strings must not erase the build-time defaults — that is how
    // a half-filled setup form used to silently disconnect a working app.
    const overrides = Object.fromEntries(
      Object.entries(stored).filter(([, value]) => value !== '' && value != null),
    ) as Partial<Config>;
    return { ...DEFAULTS, ...overrides };
  } catch {
    // A corrupted entry is not worth surfacing — fall back to defaults.
    return { ...DEFAULTS };
  }
}

export function saveConfig(patch: Partial<Config>): Config {
  const next = { ...loadConfig(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function hasSupabase(cfg: Config = loadConfig()): boolean {
  return Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
}

// Pairing: carry the Supabase config to a second device inside the URL fragment.
//
// Config lives in localStorage, which is per-origin AND per-device, so a phone
// opening the remote has none of it. Nobody is hand-typing a 200-character anon
// key on a phone in a dark room, so the stage hands it over in the link instead.
//
// The fragment is never sent to a server, and the anon key is public by design —
// it is the value shipped to every browser in any Supabase app. This is a
// convenience, not a secret channel.

const PAIR_KEY = 'k';

export function pairingHash(cfg: Config = loadConfig()): string {
  if (!hasSupabase(cfg)) return '';
  const json = JSON.stringify({ u: cfg.supabaseUrl, k: cfg.supabaseAnonKey });
  const b64 = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `#${PAIR_KEY}=${b64}`;
}

/**
 * Persists a pairing payload if the URL carries one, then scrubs the fragment
 * so a shared screenshot or a back-button does not carry it around.
 */
export function consumePairing(): boolean {
  const hash = location.hash.slice(1);
  if (!hash.startsWith(`${PAIR_KEY}=`)) return false;
  try {
    const b64 = hash.slice(PAIR_KEY.length + 1).replace(/-/g, '+').replace(/_/g, '/');
    const { u, k } = JSON.parse(atob(b64)) as { u?: string; k?: string };
    if (!u || !k) return false;
    saveConfig({ supabaseUrl: u, supabaseAnonKey: k });
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  } catch {
    return false;
  }
}

// Session codes are typed on a phone in a dark room, so: no vowels (no
// accidental words), no 0/O/1/I/L.
const ALPHABET = '23456789BCDFGHJKMNPQRSTVWXZ';

export function makeSessionCode(len = 4): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function normaliseCode(raw: string | null): string {
  return String(raw ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 8);
}
