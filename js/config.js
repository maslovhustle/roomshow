// Runtime config. Nothing is baked in at build time, so the same static bundle
// works locally and on Vercel. Keys live in localStorage — the anon key is
// public by design, but keeping it out of git means one less thing to rotate.

const KEY = 'roomshow.config';

const DEFAULTS = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  // 'auto' picks Supabase when keys are present, BroadcastChannel otherwise.
  transport: 'auto',
  // Endpoint for the diffusion stylizer. Empty = feature off.
  diffusionUrl: '',
};

export function loadConfig() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    // Corrupted entry is not worth surfacing — fall back to defaults.
  }
  return { ...DEFAULTS, ...stored };
}

export function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function hasSupabase(cfg = loadConfig()) {
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

export function pairingHash(cfg = loadConfig()) {
  if (!hasSupabase(cfg)) return '';
  const json = JSON.stringify({ u: cfg.supabaseUrl, k: cfg.supabaseAnonKey });
  const b64 = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `#${PAIR_KEY}=${b64}`;
}

// Persists a pairing payload if the URL carries one, then scrubs the fragment so
// a shared screenshot or a back-button does not carry it around.
export function consumePairing() {
  const hash = location.hash.slice(1);
  if (!hash.startsWith(`${PAIR_KEY}=`)) return false;
  try {
    const b64 = hash.slice(PAIR_KEY.length + 1).replace(/-/g, '+').replace(/_/g, '/');
    const { u, k } = JSON.parse(atob(b64));
    if (!u || !k) return false;
    saveConfig({ supabaseUrl: u, supabaseAnonKey: k });
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  } catch {
    return false;
  }
}

// Session codes are typed on a phone in a dark room, so: no vowels (no accidental
// words), no 0/O/1/I/L.
const ALPHABET = '23456789BCDFGHJKMNPQRSTVWXZ';

export function makeSessionCode(len = 4) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function normaliseCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 8);
}
