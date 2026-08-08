export type RGB = readonly [number, number, number];

export type BankId = 'ink' | 'neon' | 'trail' | 'optic' | 'signal';

export type SourceKind = 'camera' | 'screen' | 'shapes';

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
  tintA: RGB;
  tintB: RGB;
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
  | { t: 'hello'; role: 'stage' | 'remote'; ts: number };

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
