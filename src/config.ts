// Runtime config. Nothing is baked in at build time, so the same bundle works
// locally and in production. Keys live in localStorage — the anon key is public
// by design, but keeping it out of git means one less thing to rotate.

const KEY = 'roomshow.config';

export interface Config {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** 'auto' picks Supabase when keys are present, BroadcastChannel otherwise. */
  transport: 'auto' | 'supabase' | 'local';
  /**
   * Origin of the AI engine. Empty means none is configured; stored as an
   * explicit null it means the operator turned the engine off deliberately.
   */
  diffusionUrl: string;
  /**
   * Extra ICE servers, as the JSON array RTCPeerConnection expects.
   *
   * STUN only tells each end its own public address; it cannot carry traffic.
   * That is enough between a phone and a laptop on one wifi, and never enough
   * to reach a rented GPU: the pod's proxy forwards HTTP but not the inbound
   * UDP that video needs, so the two ends can never meet directly and
   * something has to relay.
   *
   * A relay here fixes that on its own — the browser offers a relay candidate
   * with a publicly reachable address, and the pod, whose outbound path works
   * fine, connects to it. Nothing has to change on the pod.
   */
  turnServers: RTCIceServer[];
}

function parseIceServers(raw: string): RTCIceServer[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RTCIceServer[]) : [];
  } catch {
    // A malformed relay config must not take the whole app down with it; the
    // engine still works wherever a direct path exists.
    return [];
  }
}

// Baked in at build time so the app works with no setup screen. Both values are
// publishable by design; Supabase ships them to every browser that loads any app
// built on it. A user can still point the app at their own project, which is
// what the home page writes to localStorage.
const DEFAULTS: Config = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_KEY ?? '',
  transport: 'auto',
  // Rented GPUs change address every session, so this is set at runtime from
  // the home page rather than baked into the build.
  diffusionUrl: import.meta.env.VITE_DIFFUSION_URL ?? '',
  turnServers: parseIceServers(import.meta.env.VITE_TURN_SERVERS ?? ''),
};

/**
 * The endpoint baked in at build time, before any saved override. Exposed so
 * the home page can say which one is actually in use — a saved endpoint and a
 * shipped one look identical from the outside until one of them stops
 * answering.
 */
export const BUILT_IN_DIFFUSION_URL = DEFAULTS.diffusionUrl;

export function loadConfig(): Config {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Config>;
    // Empty stored strings must not erase the build-time defaults — that is how
    // a half-filled setup form used to silently disconnect a working app.
    const overrides = Object.fromEntries(
      Object.entries(stored).filter(([, value]) => value !== '' && value != null),
    ) as Partial<Config>;
    const merged = { ...DEFAULTS, ...overrides };
    // An explicit null is the one way to say "no AI engine, on purpose".
    //
    // Empty and absent both have to mean "use the built-in", because a
    // half-filled setup form used to wipe a working install. That left no way
    // to turn the engine off at all — the shipped default always won — which
    // matters for a venue with no GPU, and for a test that needs to state the
    // unconfigured case rather than hope the environment provides it.
    if (stored.diffusionUrl === null) merged.diffusionUrl = '';
    // Everything else in here is a string, so a corrupted entry is merely a
    // wrong string. This one is handed to RTCPeerConnection, which throws on
    // the wrong shape — and it would throw at connect time, far from the cause.
    if (!Array.isArray(merged.turnServers)) merged.turnServers = [];
    return merged;
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
