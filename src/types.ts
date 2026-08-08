export type RGB = readonly [number, number, number];

export type BankId = 'cel' | 'film' | 'raster' | 'lens' | 'ink' | 'neon' | 'trail' | 'optic' | 'signal';

export type SourceKind = 'phone' | 'camera' | 'screen' | 'shapes';

export type Facing = 'user' | 'environment';

/**
 * WebRTC signalling, carried over the same Supabase channel as everything else.
 * The phone holds the camera so it is always the offerer; the stage answers.
 * `need-offer` covers the stage restarting mid-session — it has no way to
 * recover a stream on its own, so it asks for a fresh one.
 */
export type RtcSignal =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }
  | { kind: 'need-offer' };

export type StageAction = 'record' | 'snapshot' | 'fullscreen';

/** Every scalar the shader exposes, plus the duotone pair. 0..1 unless noted. */
export interface Params {
  mirror: number;
  kaleido: number;
  pixel: number;
  chroma: number;
  edge: number;
  poster: number;
  hue: number;
  duotone: number;
  feedback: number;
  warp: number;
  spin: number;
  glow: number;
  vignette: number;
  invert: number;
  halftone: number;
  scanline: number;
  grain: number;
  slice: number;
  /** Neutral at 0.5, not 0. */
  sat: number;
  /** Neutral at 0.5, not 0. */
  contrast: number;
  /** Flattens detail into regions before quantisation. */
  smooth: number;
  /** Ordered (Bayer) dither. Distinct from `grain`, which is random noise. */
  dither: number;
  threshold: number;
  /** Neutral at 0.5, not 0. */
  temp: number;
  /** Neutral at 0.5, not 0. */
  gamma: number;
  swirl: number;
  emboss: number;
  halation: number;
  /** Glyph raster from a brightness ramp. */
  ascii: number;
  /** Square dot grid with dark gutters. */
  led: number;
  ripple: number;
  /** Neutral at 0.5: below pinches inward, above bulges outward. */
  pinch: number;
  /** Multi-pass bloom, applied after the main shader. */
  bloom: number;
  /** Stretches the bloom horizontally into an anamorphic flare. Needs `bloom`. */
  streak: number;
  /** Colour fringing that grows toward the corners, the way a lens does. */
  aberration: number;
  /** Keeps only what changed since the previous frame. */
  motion: number;
  /** Four stops of the gradient map, dark to light. */
  tintA: RGB;
  tintB: RGB;
  tintC: RGB;
  tintD: RGB;
}

/** The scalar subset — everything except the two colour pairs. */
export type ScalarParam = {
  [K in keyof Params]: Params[K] extends number ? K : never;
}[keyof Params];

export interface AudioLevels {
  bass: number;
  energy: number;
}

/**
 * How much each band adds to a parameter at full intensity. Negative values
 * pull a parameter down on a hit.
 */
export type Routing = Partial<Record<ScalarParam, number>>;

export interface AudioRouting {
  bass: Routing;
  energy: Routing;
}

export interface Look<Id extends string = string> {
  id: Id;
  name: string;
  params: Params;
  audio: AudioRouting;
}

export interface StageState {
  preset: string;
  intensity: number;
  source: SourceKind;
  mirror: 0 | 1;
  audio: boolean;
  recording: boolean;
}

export type SyncMessage =
  | { t: 'state'; state: StageState; ts: number }
  | { t: 'patch'; patch: Partial<StageState>; ts: number }
  | { t: 'action'; action: StageAction; ts: number }
  | { t: 'hello'; role: 'stage' | 'remote'; ts: number }
  | { t: 'rtc'; signal: RtcSignal; from: 'stage' | 'remote'; ts: number };

export interface Sync {
  readonly name: 'local' | 'supabase';
  send(message: SyncMessage): void;
  /** Returns an unsubscribe function. */
  onMessage(handler: (message: SyncMessage) => void): () => void;
  close(): void;
}

/**
 * The seam a diffusion backend plugs into. A DiffusionStylizer implementing
 * these five methods drops into stage.ts with no other change — `render` would
 * push the frame to a socket and draw the most recent reply rather than
 * rendering locally, and must never block on the network.
 */
export interface Stylizer {
  init(): void;
  setSource(source: TexImageSource, width: number, height: number): void;
  resize(width: number, height: number): void;
  render(params: Params, timeSeconds: number): void;
  dispose(): void;
}
