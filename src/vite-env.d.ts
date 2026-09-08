/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_KEY?: string;
  readonly VITE_DIFFUSION_URL?: string;
  /** JSON array of RTCIceServer, for the relay the cloud path needs. */
  readonly VITE_TURN_SERVERS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
