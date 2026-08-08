// Transport between the phone (remote) and the laptop (stage).
//
// Two implementations behind one interface:
//   LocalSync    — BroadcastChannel. Same browser only. Zero setup, for dev.
//   SupabaseSync — Realtime broadcast. Crosses devices and networks. Free tier.
//
// Both are fire-and-forget: the stage owns the truth and re-broadcasts its state
// on every change, so a remote that joins late catches up on the next tick.

import { loadConfig, hasSupabase } from './config.js';

const SUPABASE_ESM = 'https://esm.sh/@supabase/supabase-js@2';

class LocalSync {
  constructor(code) {
    this.name = 'local';
    this.code = code;
    this.handlers = new Set();
    this.channel = new BroadcastChannel(`roomshow:${code}`);
    this.channel.onmessage = (ev) => this.#emit(ev.data);
  }

  async connect() {
    return this;
  }

  send(msg) {
    this.channel.postMessage(msg);
  }

  onMessage(fn) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  close() {
    this.channel.close();
    this.handlers.clear();
  }

  #emit(msg) {
    for (const fn of this.handlers) fn(msg);
  }
}

class SupabaseSync {
  constructor(code, cfg) {
    this.name = 'supabase';
    this.code = code;
    this.cfg = cfg;
    this.handlers = new Set();
    this.channel = null;
    this.client = null;
  }

  async connect() {
    const { createClient } = await import(/* @vite-ignore */ SUPABASE_ESM);
    this.client = createClient(this.cfg.supabaseUrl, this.cfg.supabaseAnonKey, {
      realtime: { params: { eventsPerSecond: 20 } },
    });

    this.channel = this.client.channel(`roomshow:${this.code}`, {
      config: { broadcast: { self: false } },
    });

    this.channel.on('broadcast', { event: 'msg' }, ({ payload }) => this.#emit(payload));

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Realtime subscribe timed out')), 10_000);
      this.channel.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timer);
          reject(err || new Error(`Realtime status: ${status}`));
        }
      });
    });

    return this;
  }

  send(msg) {
    if (!this.channel) return;
    this.channel.send({ type: 'broadcast', event: 'msg', payload: msg });
  }

  onMessage(fn) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  close() {
    if (this.channel) this.client.removeChannel(this.channel);
    this.handlers.clear();
  }

  #emit(msg) {
    for (const fn of this.handlers) fn(msg);
  }
}

// Picks the best available transport. Falls back to BroadcastChannel if Supabase
// is configured but unreachable — a dead remote should never take down the stage.
export async function createSync(code) {
  const cfg = loadConfig();
  const wantSupabase = cfg.transport === 'supabase' || (cfg.transport === 'auto' && hasSupabase(cfg));

  if (wantSupabase && hasSupabase(cfg)) {
    try {
      return await new SupabaseSync(code, cfg).connect();
    } catch (err) {
      console.warn('[sync] Supabase unavailable, falling back to local:', err.message);
    }
  }
  return new LocalSync(code).connect();
}

// Message helpers — keeps the wire format in one place.
export const msg = {
  state: (state) => ({ t: 'state', state, ts: Date.now() }),
  patch: (patch) => ({ t: 'patch', patch, ts: Date.now() }),
  action: (action, arg) => ({ t: 'action', action, arg, ts: Date.now() }),
  hello: (role) => ({ t: 'hello', role, ts: Date.now() }),
};
