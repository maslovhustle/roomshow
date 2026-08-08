// Transport between the phone (remote) and the laptop (stage).
//
// Two implementations behind one interface:
//   LocalSync    — BroadcastChannel. Same browser only. Zero setup, for dev.
//   SupabaseSync — Realtime broadcast. Crosses devices and networks. Free tier.
//
// Both are fire-and-forget: the stage owns the truth and re-broadcasts its state
// on every change, so a remote that joins late catches up on the next tick.

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { hasSupabase, loadConfig, type Config } from './config';
import type { StageAction, StageState, Sync, SyncMessage } from './types';

class Emitter {
  private handlers = new Set<(message: SyncMessage) => void>();

  onMessage(handler: (message: SyncMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  protected emit(message: SyncMessage): void {
    for (const handler of this.handlers) handler(message);
  }

  protected clear(): void {
    this.handlers.clear();
  }
}

class LocalSync extends Emitter implements Sync {
  readonly name = 'local' as const;
  private channel: BroadcastChannel;

  constructor(code: string) {
    super();
    this.channel = new BroadcastChannel(`roomshow:${code}`);
    this.channel.onmessage = (event: MessageEvent<SyncMessage>) => this.emit(event.data);
  }

  async connect(): Promise<this> {
    return this;
  }

  send(message: SyncMessage): void {
    this.channel.postMessage(message);
  }

  close(): void {
    this.channel.close();
    this.clear();
  }
}

class SupabaseSync extends Emitter implements Sync {
  readonly name = 'supabase' as const;
  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;

  constructor(private code: string, private cfg: Config) {
    super();
  }

  async connect(): Promise<this> {
    // Dynamic so the client only reaches a browser that actually has keys —
    // Vite splits it into its own chunk.
    const { createClient } = await import('@supabase/supabase-js');
    this.client = createClient(this.cfg.supabaseUrl, this.cfg.supabaseAnonKey, {
      realtime: { params: { eventsPerSecond: 20 } },
    });

    this.channel = this.client.channel(`roomshow:${this.code}`, {
      config: { broadcast: { self: false } },
    });

    this.channel.on('broadcast', { event: 'msg' }, ({ payload }) => {
      this.emit(payload as SyncMessage);
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Realtime subscribe timed out')), 10_000);
      this.channel!.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timer);
          reject(err ?? new Error(`Realtime status: ${status}`));
        }
      });
    });

    return this;
  }

  send(message: SyncMessage): void {
    void this.channel?.send({ type: 'broadcast', event: 'msg', payload: message });
  }

  close(): void {
    if (this.channel) this.client?.removeChannel(this.channel);
    this.clear();
  }
}

/**
 * Picks the best available transport, falling back to BroadcastChannel if
 * Supabase is configured but unreachable — a dead remote should never take
 * down the stage.
 */
export async function createSync(code: string): Promise<Sync> {
  const cfg = loadConfig();
  const wantSupabase = cfg.transport === 'supabase' || (cfg.transport === 'auto' && hasSupabase(cfg));

  if (wantSupabase && hasSupabase(cfg)) {
    try {
      return await new SupabaseSync(code, cfg).connect();
    } catch (err) {
      console.warn('[sync] Supabase unavailable, falling back to local:', err);
    }
  }
  return new LocalSync(code).connect();
}

/**
 * Joins a throwaway channel and leaves again, so the setup screen can prove the
 * keys work instead of leaving it to be discovered mid-event. Surfaces the real
 * error rather than falling back the way createSync does.
 */
export async function testSupabase(): Promise<{ ok: boolean; detail: string }> {
  const cfg = loadConfig();
  if (!hasSupabase(cfg)) return { ok: false, detail: 'Enter a project URL and anon key first.' };
  try {
    const probe = await new SupabaseSync(`probe-${crypto.randomUUID()}`, cfg).connect();
    probe.close();
    return { ok: true, detail: 'Connected. The remote will reach the stage from any device.' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

// Keeps the wire format in one place.
export const msg = {
  state: (state: StageState): SyncMessage => ({ t: 'state', state, ts: Date.now() }),
  patch: (patch: Partial<StageState>): SyncMessage => ({ t: 'patch', patch, ts: Date.now() }),
  action: (action: StageAction): SyncMessage => ({ t: 'action', action, ts: Date.now() }),
  hello: (role: 'stage' | 'remote'): SyncMessage => ({ t: 'hello', role, ts: Date.now() }),
};
