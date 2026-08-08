// Microphone -> two smoothed numbers the renderer can lean on.
//
// Deliberately local: the FFT never leaves the machine, so audio reactivity has
// zero latency and works even when the network is gone. In a club the mic picks
// up the room, which is exactly what we want — it tracks what people hear, not
// what the laptop is playing.

import type { AudioLevels } from './types';

const BASS_HZ = 200;
const MID_HZ = 2000;

export const SILENCE: AudioLevels = { bass: 0, energy: 0 };

export class AudioReactor {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  // Explicit buffer type: getByteFrequencyData rejects a view that might sit on
  // a SharedArrayBuffer, which is what the bare `Uint8Array` alias widens to.
  private bins: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private bass = 0;
  private energy = 0;
  // Rolling peak so a quiet room still produces full-range movement.
  private peakBass = 0.15;
  private peakEnergy = 0.15;

  active = false;

  async start(): Promise<void> {
    if (this.active) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.ctx = new AudioContext();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.72;
    source.connect(this.analyser);
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    this.active = true;
  }

  stop(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
    this.active = false;
    this.bass = 0;
    this.energy = 0;
  }

  /** Call once per frame. */
  sample(): AudioLevels {
    const { analyser, ctx } = this;
    if (!this.active || !analyser || !ctx) return SILENCE;

    analyser.getByteFrequencyData(this.bins);
    const binHz = ctx.sampleRate / 2 / this.bins.length;
    const bassEnd = Math.max(1, Math.floor(BASS_HZ / binHz));
    const midEnd = Math.max(bassEnd + 1, Math.floor(MID_HZ / binHz));

    let bassSum = 0;
    for (let i = 0; i < bassEnd; i++) bassSum += this.bins[i] ?? 0;
    let allSum = 0;
    for (let i = 0; i < midEnd; i++) allSum += this.bins[i] ?? 0;

    const rawBass = bassSum / bassEnd / 255;
    const rawEnergy = allSum / midEnd / 255;

    // Track peaks upward fast, decay slowly — auto-gain without a gain node.
    this.peakBass = Math.max(rawBass, this.peakBass * 0.995);
    this.peakEnergy = Math.max(rawEnergy, this.peakEnergy * 0.995);

    const targetBass = rawBass / Math.max(0.08, this.peakBass);
    const targetEnergy = rawEnergy / Math.max(0.08, this.peakEnergy);

    // Attack fast on a kick, release smooth so trails do not stutter.
    this.bass += (targetBass - this.bass) * (targetBass > this.bass ? 0.55 : 0.12);
    this.energy += (targetEnergy - this.energy) * (targetEnergy > this.energy ? 0.4 : 0.09);

    return { bass: clamp01(this.bass), energy: clamp01(this.energy) };
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
