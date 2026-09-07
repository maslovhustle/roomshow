import { describe, expect, it } from 'vitest';
import { msg } from '../../src/sync';
import type { StageState } from '../../src/types';

const state: StageState = {
  engine: 'shader',
  aiStatus: 'off',
  prompt: '',
  // Measured against moving footage, not a still. Strength is how far the model
  // may depart from the frame, and past about 0.5 it stops tracking the camera
  // at all: it denoises away the input and generates from the prompt, so every
  // frame invents a new scene and the result reads as a flicker book. Flicker
  // rose 1.6 -> 2.0 -> 3.0 -> 4.3 across 0.25 / 0.35 / 0.5 / 0.8 while distance
  // from the source went 5 -> 8 -> 13 -> 29.
  //
  // A setting that flatters a single photograph is the wrong setting for video.
  aiStrength: 0.35,
  preset: 'comic',
  intensity: 0.65,
  source: 'shapes',
  mirror: 0,
  audio: false,
  recording: false,
};

describe('the wire format', () => {
  it('tags every message so the receiver can switch on one field', () => {
    expect(msg.state(state).t).toBe('state');
    expect(msg.patch({ preset: 'neon' }).t).toBe('patch');
    expect(msg.action('record').t).toBe('action');
    expect(msg.hello('remote').t).toBe('hello');
    expect(msg.rtc({ kind: 'need-offer' }, 'stage').t).toBe('rtc');
  });

  it('marks who sent a signal, so a peer never answers itself', () => {
    const fromStage = msg.rtc({ kind: 'need-offer' }, 'stage');
    const fromRemote = msg.rtc({ kind: 'offer', sdp: 'v=0' }, 'remote');
    expect(fromStage).toMatchObject({ from: 'stage' });
    expect(fromRemote).toMatchObject({ from: 'remote' });
  });

  it('survives the structured clone that BroadcastChannel performs', () => {
    // Compare against the same object: every message stamps Date.now(), so two
    // calls are never equal.
    const original = msg.state(state);
    expect(structuredClone(original)).toEqual(original);
  });

  it('carries only the changed keys in a patch, since the stage owns the state', () => {
    const patch = msg.patch({ intensity: 0.4 });
    expect(patch.t === 'patch' && Object.keys(patch.patch)).toEqual(['intensity']);
  });
});
