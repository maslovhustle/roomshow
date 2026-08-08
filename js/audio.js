// Microphone -> two smoothed numbers the renderer can lean on.
//
// Deliberately local: the FFT never leaves the machine, so audio reactivity has
// zero latency and works even when the network is gone. In a club the mic picks
// up the room, which is exactly what we want — it tracks what people hear, not
// what the laptop is playing.

const BASS_HZ = 200;
const MID_HZ = 2000;

export class AudioReactor {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
    this.bins = null;
    this.bass = 0;
    this.energy = 0;
    this.active = false;
    // Rolling peak so a quiet room still produces full-range movement.
    this.peakBass = 0.15;
    this.peakEnergy = 0.15;
  }

  async start() {
    if (this.active) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.72;
    src.connect(this.analyser);
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    this.active = true;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
    this.active = false;
    this.bass = 0;
    this.energy = 0;
  }

  // Call once per frame. Returns { bass, energy } in 0..1.
  sample() {
    if (!this.active) return { bass: 0, energy: 0 };

    this.analyser.getByteFrequencyData(this.bins);
    const nyquist = this.ctx.sampleRate / 2;
    const binHz = nyquist / this.bins.length;
    const bassEnd = Math.max(1, Math.floor(BASS_HZ / binHz));
    const midEnd = Math.max(bassEnd + 1, Math.floor(MID_HZ / binHz));

    let bassSum = 0;
    for (let i = 0; i < bassEnd; i++) bassSum += this.bins[i];
    let allSum = 0;
    for (let i = 0; i < midEnd; i++) allSum += this.bins[i];

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

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
