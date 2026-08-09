import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhonePublisher, StageReceiver } from '../../src/webrtc';
import type { Sync, SyncMessage } from '../../src/types';

/**
 * Enough of RTCPeerConnection to exercise the handshake, including the state
 * machine — setRemoteDescription throwing on an answer that arrives outside
 * `have-local-offer` is the behaviour a real bug relied on.
 */
class FakePeerConnection {
  static instances: FakePeerConnection[] = [];

  signalingState = 'stable';
  connectionState = 'new';
  remoteDescription: { type: string; sdp: string } | null = null;
  onicecandidate: ((event: { candidate: unknown }) => void) | null = null;
  ontrack: ((event: { streams: unknown[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  readonly ice: unknown[] = [];
  readonly replaceTrack: (track: unknown) => Promise<void> = vi.fn(async () => {});
  closed = false;

  constructor() {
    FakePeerConnection.instances.push(this);
  }

  addTrack(): { replaceTrack: (track: unknown) => Promise<void> } {
    return { replaceTrack: this.replaceTrack };
  }

  async createOffer(): Promise<{ type: string; sdp: string }> {
    return { type: 'offer', sdp: 'offer-sdp' };
  }

  async createAnswer(): Promise<{ type: string; sdp: string }> {
    return { type: 'answer', sdp: 'answer-sdp' };
  }

  async setLocalDescription(description: { type: string }): Promise<void> {
    this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
  }

  async setRemoteDescription(description: { type: string; sdp: string }): Promise<void> {
    if (description.type === 'answer' && this.signalingState !== 'have-local-offer') {
      throw new Error(`Failed to set remote answer sdp: Called in wrong state: ${this.signalingState}`);
    }
    this.remoteDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
  }

  async addIceCandidate(candidate: unknown): Promise<void> {
    if (!this.remoteDescription) throw new Error('remote description not set');
    this.ice.push(candidate);
  }

  close(): void {
    this.closed = true;
  }
}

function fakeSync(): Sync & { sent: SyncMessage[] } {
  const sent: SyncMessage[] = [];
  return {
    name: 'local',
    sent,
    send: (message) => sent.push(message),
    onMessage: () => () => {},
    close: () => {},
  };
}

const track = { stop: vi.fn(), kind: 'video' };
const stream = { getVideoTracks: () => [track], getTracks: () => [track] };

beforeEach(() => {
  FakePeerConnection.instances = [];
  vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: { getUserMedia: vi.fn(async () => stream) },
  });
});

const signals = (sync: { sent: SyncMessage[] }) =>
  sync.sent.filter((message): message is Extract<SyncMessage, { t: 'rtc' }> => message.t === 'rtc');

describe('the phone publishing its camera', () => {
  it('offers as soon as it starts, so the stage never has to ask', async () => {
    const sync = fakeSync();
    const publisher = new PhonePublisher(sync);
    await publisher.start();

    const offers = signals(sync).filter((s) => s.signal.kind === 'offer');
    expect(offers).toHaveLength(1);
    expect(offers[0]?.from).toBe('remote');
  });

  it('asks for the back camera, because the point is to film the room', async () => {
    const sync = fakeSync();
    await new PhonePublisher(sync).start();
    const request = vi.mocked(navigator.mediaDevices.getUserMedia).mock.calls[0]?.[0];
    expect(request).toMatchObject({ video: { facingMode: 'environment' } });
  });

  // The bug this guards: the stage used to request an offer on every source
  // patch, so the answer to the superseded offer landed on a connection that
  // was already stable, threw, and killed a working stream.
  it('ignores an answer that arrives outside have-local-offer', async () => {
    const sync = fakeSync();
    const publisher = new PhonePublisher(sync);
    await publisher.start();

    await publisher.handle({ kind: 'answer', sdp: 'answer-sdp' });
    await expect(publisher.handle({ kind: 'answer', sdp: 'stale-sdp' })).resolves.toBeUndefined();
  });

  it('swaps the track in place when flipping, so the picture does not drop', async () => {
    const sync = fakeSync();
    const publisher = new PhonePublisher(sync);
    await publisher.start();
    const before = signals(sync).length;

    await publisher.flip();

    expect(FakePeerConnection.instances[0]?.replaceTrack).toHaveBeenCalledTimes(1);
    expect(publisher.facing).toBe('user');
    // Renegotiating would emit another offer; replacing a track must not.
    expect(signals(sync)).toHaveLength(before);
  });

  it('rebuilds from scratch when the stage asks, since its peer is gone', async () => {
    const sync = fakeSync();
    const publisher = new PhonePublisher(sync);
    await publisher.start();

    await publisher.handle({ kind: 'need-offer' });

    expect(signals(sync).filter((s) => s.signal.kind === 'offer')).toHaveLength(2);
    expect(FakePeerConnection.instances[0]?.closed).toBe(true);
  });

  it('stays quiet when nothing is publishing', async () => {
    const sync = fakeSync();
    await new PhonePublisher(sync).handle({ kind: 'need-offer' });
    expect(sync.sent).toHaveLength(0);
  });
});

describe('the stage receiving it', () => {
  it('answers an offer', async () => {
    const sync = fakeSync();
    await new StageReceiver(sync).handle({ kind: 'offer', sdp: 'offer-sdp' });

    const answers = signals(sync).filter((s) => s.signal.kind === 'answer');
    expect(answers).toHaveLength(1);
    expect(answers[0]?.from).toBe('stage');
  });

  it('hands the stream over when the track arrives', async () => {
    const sync = fakeSync();
    const receiver = new StageReceiver(sync);
    const seen: unknown[] = [];
    receiver.onStream = (incoming) => seen.push(incoming);

    await receiver.handle({ kind: 'offer', sdp: 'offer-sdp' });
    FakePeerConnection.instances[0]?.ontrack?.({ streams: [stream] });

    expect(seen).toEqual([stream]);
  });

  // Candidates routinely beat the offer through the channel, and
  // addIceCandidate throws before a remote description exists.
  it('queues candidates that arrive before the offer', async () => {
    const sync = fakeSync();
    const receiver = new StageReceiver(sync);

    await receiver.handle({ kind: 'ice', candidate: { candidate: 'early' } });
    await receiver.handle({ kind: 'offer', sdp: 'offer-sdp' });

    expect(FakePeerConnection.instances[0]?.ice).toEqual([{ candidate: 'early' }]);
  });

  it('asks for an offer when it starts cold', () => {
    const sync = fakeSync();
    new StageReceiver(sync).requestOffer();
    expect(signals(sync)[0]?.signal).toEqual({ kind: 'need-offer' });
  });
});
