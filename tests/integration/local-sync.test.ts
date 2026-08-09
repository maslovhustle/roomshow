import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveConfig } from '../../src/config';
import { createSync, msg } from '../../src/sync';
import type { Sync, SyncMessage } from '../../src/types';

const open: Sync[] = [];

async function connect(code: string): Promise<Sync> {
  const sync = await createSync(code);
  open.push(sync);
  return sync;
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  localStorage.clear();
  // Force the BroadcastChannel path: with keys present createSync would try to
  // reach a real Supabase project and spend its timeout doing it.
  saveConfig({ transport: 'local' });
});

afterEach(() => {
  for (const sync of open.splice(0)) sync.close();
});

describe('the local transport', () => {
  it('reports which transport it actually got, not which was wanted', async () => {
    const sync = await connect('AAAA');
    expect(sync.name).toBe('local');
  });

  it('carries a message between two peers on the same code', async () => {
    const stage = await connect('BBBB');
    const remote = await connect('BBBB');

    const seen: SyncMessage[] = [];
    stage.onMessage((message) => seen.push(message));

    remote.send(msg.patch({ preset: 'neon' }));
    await settle();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ t: 'patch', patch: { preset: 'neon' } });
  });

  it('keeps sessions apart, so two rooms on one network do not cross', async () => {
    const stage = await connect('CCCC');
    const stranger = await connect('DDDD');

    const seen: SyncMessage[] = [];
    stage.onMessage((message) => seen.push(message));

    stranger.send(msg.patch({ preset: 'neon' }));
    await settle();

    expect(seen).toHaveLength(0);
  });

  it('does not deliver a peer its own message, which would loop the state', async () => {
    const stage = await connect('EEEE');
    const seen: SyncMessage[] = [];
    stage.onMessage((message) => seen.push(message));

    stage.send(msg.hello('stage'));
    await settle();

    expect(seen).toHaveLength(0);
  });

  it('stops delivering once unsubscribed', async () => {
    const stage = await connect('FFFF');
    const remote = await connect('FFFF');

    const seen: SyncMessage[] = [];
    const off = stage.onMessage((message) => seen.push(message));
    off();

    remote.send(msg.hello('remote'));
    await settle();

    expect(seen).toHaveLength(0);
  });
});
