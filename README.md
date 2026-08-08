# roomshow

Point a camera at the room, restyle it live, project it back. Control it from a phone.

No build step, no bundler, no backend, no GPU bill. Static files plus a free Supabase
project for the phone-to-laptop link.

## Run it

```bash
python3 -m http.server 5199 --directory roomshow
```

Then open `http://localhost:5199`. On the machine wired to the projector open the
**stage**; on your phone open the **remote** with the same session code.

`getUserMedia` needs a secure context, so camera and mic work on `localhost` and on
any `https://` deploy — but not over plain `http://` to a LAN IP. Testing on a real
phone means deploying first.

## Deploy

```bash
npx vercel deploy --prod
```

Nothing is compiled and nothing is baked in at build time, so the same files run
locally and in production.

## The phone remote

The remote reaches the stage over a Supabase Realtime broadcast channel. Without
keys it falls back to `BroadcastChannel`, which only reaches tabs in the same
browser — enough to develop against, useless in a room.

Create a free Supabase project, then paste its URL and anon key into the panel on
the landing page. They are stored in `localStorage`, never committed. No tables, no
row-level security, no schema: the channel is just a message bus, and the stage
holds the only copy of the state.

`localStorage` is per-origin *and* per-device, so the phone starts with none of
that config, and nobody is hand-typing a 200-character anon key in a dark room.
The stage's **copy link** button therefore emits a pairing URL with the config in
the fragment; the remote stores it and scrubs the fragment on load. The fragment
never reaches a server, and the anon key is public by design — it is the value
shipped to every browser in any Supabase app.

Free tier ceilings are far above what one event needs — 200 concurrent connections
and 2M messages a month, against roughly 30 messages a minute for a busy set.

## How it fits together

```
phone (remote.html) ──patch──▶ Supabase Realtime ──▶ laptop (stage.html)
       ▲                                                    │
       └──────────────── state ─────────────────────────────┘

camera / screen / shapes ──▶ WebGL shader chain ──▶ canvas ──▶ projector
                                     ▲                   │
                              mic FFT (local)      MediaRecorder ──▶ .webm
```

The stage owns the state. The remote only sends patches, and every applied patch is
re-broadcast, so a phone that reconnects or was locked in a pocket resyncs within a
tick. The stage is also fully driveable from the keyboard — a demo must never be one
dead phone away from a black screen.

| Key | |
|---|---|
| `1`–`8` | looks |
| `↑` `↓` | intensity |
| `C` | camera / shapes |
| `M` | mic reactivity |
| `R` / `S` | record / snapshot |
| `F` / `H` | fullscreen / hide HUD |

## Layout

| Path | |
|---|---|
| `js/stylizer/webgl.js` | the engine — one shader, ping-pong framebuffers for feedback |
| `js/presets.js` | looks as data: parameters plus an audio routing table |
| `js/source.js` | camera, screen capture, and a procedural fallback |
| `js/audio.js` | mic FFT to two smoothed numbers, with rolling auto-gain |
| `js/sync.js` | Supabase Realtime, falling back to BroadcastChannel |
| `js/recorder.js` | canvas to a file on disk |

Adding a look is a data change in `presets.js`, never a code change. Everything the
remote can touch is a uniform, so switching looks mid-set cannot trigger a shader
recompile.

## What this is not

The visuals are a GPU shader chain, not a diffusion model. It runs at display
refresh rate on the laptop's own GPU, offline, for free — but it restyles what the
camera sees, it does not reimagine it, and there is no text prompt.

Prompt-driven restyling needs real-time img2img diffusion (StreamDiffusion / SD-Turbo,
1–4 denoise steps, 512px). That is a server with a GPU on it, which is the thing this
build deliberately avoids. The seam for it:

- `WebGLStylizer` exposes `init` / `setSource` / `render` / `resize` / `dispose`. A
  `DiffusionStylizer` implementing the same five methods drops into `stage.js` with
  no other change.
- `render` would push the source frame to a WebSocket and draw the most recent
  returned frame rather than rendering locally — the loop must never block on the
  network, or the stage stutters every time the venue wifi hiccups.
- `state` gains a `prompt` field; `remote.html` gains a text input that patches it.

Modal's free monthly credit covers roughly 10–15 GPU-hours, which is enough for a
demo night but is a hard ceiling, not a free tier. Keep the WebGL path as the
fallback: when the endpoint is cold, unreachable, or out of credit, the room should
still see something.
