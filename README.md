# roomshow

Point a camera at the room, restyle it live, project it back. Control it from a phone.

Live at **https://roomshow.vercel.app**

TypeScript and Vite, no backend, no GPU bill. Three static pages plus a free
Supabase Realtime channel for the phone-to-laptop link.

## Run it

```bash
npm install && npm run dev
```

Then open `http://localhost:5199`. `npm run build` typechecks before it bundles,
so a type error fails the build rather than the deploy. On the machine wired to the projector open the
**stage**; on your phone open the **remote** with the same session code.

`getUserMedia` needs a secure context, so camera and mic work on `localhost` and on
any `https://` deploy — but not over plain `http://` to a LAN IP. Testing on a real
phone means deploying first.

## Deploy

```bash
npx vercel deploy --prod
```

Vite builds three pages from one source tree. The stage and the remote never run
in the same tab, so they are separate entry points — the phone never downloads
the shader, and the Supabase client is a dynamic import that only arrives when a
page actually opens a channel.

## The phone remote

The remote reaches the stage over a Supabase Realtime broadcast channel. Without
keys it falls back to `BroadcastChannel`, which only reaches tabs in the same
browser — enough to develop against, useless in a room.

The project's own Supabase URL and publishable key ship in `.env`, so there is
no setup screen at all — the home page is a session code and two buttons. Both
values are publishable by design: Supabase sends them to every browser that
loads any app built on it, and they grant nothing on their own. A `localStorage`
entry still overrides them for anyone pointing at another project.

No tables, no row-level security, no schema: the channel is just a message bus,
and the stage holds the only copy of the state.

The stage's **copy link** button still emits a pairing URL carrying the config in
the fragment, which the remote stores and then scrubs. That only matters for a
custom project now that defaults ship in the bundle, but it is what keeps a
phone from ever needing a key typed into it.

Free tier ceilings are far above what one event needs — 200 concurrent connections
and 2M messages a month, against roughly 30 messages a minute for a busy set.

## How it fits together

```
phone (remote.html) ──patch──▶ Supabase Realtime ──▶ laptop (stage.html)
       ▲                       (control + SDP/ICE)          │
       └──────────────── state ─────────────────────────────┘
       │
       └── phone camera ══════ WebRTC, direct ═════════════▶ stage
                                (video never touches Supabase)

phone / laptop cam / screen / shapes ──▶ WebGL shader ──▶ canvas ──▶ projector
                                              ▲               │
                                       mic FFT (local)   MediaRecorder ──▶ .webm
```

The stage owns the state. The remote only sends patches, and every applied patch is
re-broadcast, so a phone that reconnects or was locked in a pocket resyncs within a
tick. The stage is also fully driveable from the keyboard — a demo must never be one
dead phone away from a black screen.

| Key | |
|---|---|
| `1`–`8` | looks in the current bank |
| `[` `]` | previous / next bank |
| `↑` `↓` | intensity |
| `C` | camera / shapes |
| `M` | mic reactivity |
| `R` / `S` | record / snapshot |
| `F` / `H` | fullscreen / hide HUD |

## Phone camera

Tapping **This phone** on the remote captures the phone's camera and sends it to
the stage over a direct peer connection. Only the handshake — the SDP and ICE
candidates — travels through Supabase; the video takes the shortest route the
two devices can negotiate, which on a venue wifi is straight across the LAN.

The phone holds the camera, so it is always the offerer and the stage always
answers. A fixed role assignment means there is no glare case to resolve. Two
consequences fell out of testing rather than design:

- The stage must **not** request an offer when a patch says `source: phone` —
  the phone has already sent one, and asking again races its own answer into a
  `stable` connection, which throws and kills the stream. It asks once at boot
  instead, which recovers a session where the stage reloaded mid-set: the phone
  re-offers and the picture returns without anyone touching it.
- **Flip camera** swaps the track on the sender rather than renegotiating, so
  the picture does not drop while switching between the crowd and the operator.

Back camera by default: the point is to film the room, not whoever is holding
the phone.

STUN only, no TURN. Same-network is the supported path. A relay would cover
symmetric NAT — typically a phone on cellular while the laptop sits behind a
hotel router — but relays bill per gigabyte and this build has no server, so
that case reports a legible failure on the phone instead of a black projector.

## Looks

Eighty looks in ten banks of eight: **Cel** (flat colour under ink lines),
**Film** (stock emulation), **Raster** (the frame rebuilt from a grid),
**Lens** (optics and sensor), **Medium** (the stock itself), **Ink** (print and
graphic), **Neon** (edge and glow), **Trail** (frame feedback), **Optic** (the
polar fold), **Signal** (glitch and analog).

Banks exist because a flat list of that length is two dozen rows of scrolling on
a phone in a dark room, which defeats the point of having a remote. Eight fits
one thumb-reach screen and maps onto the number keys.

**Medium** is the one that stops the output looking like a browser filter, and
the reason is worth stating plainly: every other operation here applies the same
arithmetic to every pixel. That is exactly what a CSS filter does, and exactly
why the result reads as one. A physical medium is uneven — paper has fibre, tape
has wear, emulsion clumps — and that unevenness is most of the impression.

So the medium is **drawn**, not noised. Paper is felted cellulose — long thin
strands lying across each other — and value noise is isotropic blur that never
produces a strand. The generator strokes several thousand fibres directly onto a
canvas with a bias toward one axis (which is why paper tears cleanly in one
direction), then lays in absorbency blotches, creases as a lit edge against a
shadowed one, and sparse speckle. Anything near an edge is drawn again on the
far side so the result tiles seamlessly at any projector size.

It goes on with **overlay**, not multiply: multiply only darkens, so a paper
layer applied that way reads as dirt, while overlay holds the midpoint neutral
and lets the stock both lift and deepen. `distress` displaces along the
texture's *gradient* rather than its raw value — a gradient points across
fibres and creases, so edges get pushed along structure that is actually there,
the same reason normal maps displace by slope and not by height.

Everything is generated at runtime; the project ships no texture assets.

The bank also fixed **VHS**, which had been uniform pixelation plus a flat RGB
shift — the failure in miniature. Real tape carries luminance and colour on
separate carriers with a fraction of the bandwidth on colour, so `bleed` splits
into YIQ and averages only the chroma across a horizontal run: detail stays put
while colour lags and overshoots. `tracking` jitters per scanline, and most
lines sit steady while a few tear badly, because uniform jitter reads as a
filter and unevenness reads as a machine struggling.

**Lens** is what the glass and the sensor do rather than what the paint does.
`aberration` grows with distance from centre, so the middle of frame stays clean
while the corners smear — that is dispersion, as opposed to `chroma`'s flat
sideways shift, which reads as a signal fault. `streak` keeps widening the bloom
horizontally only, because a cylindrical element compresses one axis; blurring
both axes equally is just a bigger bloom, and the blue tint is why real
anamorphic flares are blue. `motion` differences against the previous *source*
frame rather than the previous output — the output already carries trails and
vignettes, so differencing it would detect the effects instead of the room. On a
dancefloor that means the crowd draws itself and the furniture disappears.

**Raster** rebuilds the frame out of a grid. **ASCII** picks one glyph per cell
from a brightness ramp rendered into a texture atlas at startup — cheaper and
far sharper than any analytic glyph. **LED** is a square dot matrix with dark
gutters, which is a different thing from halftone's rotated, gapless screen.
Both read the cell's mean rather than the pixel beneath them, so they stay
legible while the room moves.

The bank also needed a real **bloom**, and that meant a second render chain:
extract what is bright, blur it separably at half resolution, screen it back.
The single-pass `glow` could never do this — it can only brighten a pixel using
itself, so light never spreads into its neighbours, which is the entire point.
Both still exist; they are different tools.

**Film** is where the four-stop **gradient map** earns its keep. A two-colour
ramp can only tint; a film stock's character lives in how its midtones drift,
which is what the middle stops describe. It arrived alongside **halation**
(highlights only — real halation is scattering in the film base, so touching the
shadows just makes the frame milky) and an **ordered Bayer dither**, which is a
different thing from `grain`: one is a regular screen, the other is noise.

Adding midtone stops could have restyled every look written before them, so a
look that names only two colours gets its middle stops spaced along the A→D line
and renders exactly as it did as a duotone.

**Cel** is the illustration end of what a shader can honestly reach, and it
needed a new primitive: `smooth` blurs the frame before quantisation. Posterising
a sharp frame turns noise and texture into confetti, while flattening first gives
painted regions with clean boundaries. Edges are still taken from the sharp
source, so the ink lines stay crisp over the flattened colour.

The bank a phone is browsing is deliberately local, not shared: a VJ wants to
scroll another bank before committing to it, and the stage rebroadcasts its
state every two seconds, so a shared bank would yank the view back mid-scroll.
The remote follows the stage into a new bank only when the look actually
changes, and marks the bank holding the live look with a dot.

A look is a parameter set plus an audio routing table, both data. The shader
exposes thirty-nine scalars plus four gradient stops — geometry (`kaleido`,
`mirror`, `slice`, `swirl`, `ripple`, `pinch`), sampling (`pixel`, `chroma`,
`aberration`, `smooth`), tone (`poster`, `invert`, `sat`, `contrast`, `gamma`,
`temp`, `threshold`, `hue`, `duotone`), raster (`halftone`, `dither`,
`scanline`, `ascii`, `led`, `grain`, `emboss`), motion (`feedback`, `warp`,
`spin`, `motion`), medium (`paper`, `distress`, `bleed`, `tracking`), and finish
(`edge`, `glow`, `bloom`, `streak`, `halation`, `vignette`).

That vocabulary is deliberately the standard one — the same operations any
image-processing chain exposes. Quality here comes from having the right
primitives, not from a model.

## Explore

`explore.html` previews every look live, filtered by bank, and links each tile
into the stage.

Eighty live previews cannot each hold a WebGL context — browsers cap that near
sixteen and silently drop the oldest. There is one offscreen context; tiles are
plain 2D canvases receiving a blit of it, and a round-robin walks only the tiles
an IntersectionObserver reports on screen, so cost stays flat as the list grows.
Each visit renders a short run of frames rather than one, because the single
engine carries one feedback buffer and a trail look would otherwise preview with
whatever the previous tile left in it.

## Layout

| Path | |
|---|---|
| `src/types.ts` | the shared vocabulary, including the `Stylizer` seam |
| `src/stylizer/webgl.ts` | the engine — one shader, ping-pong framebuffers for feedback |
| `src/presets.ts` | looks as data: parameters plus an audio routing table |
| `src/source.ts` | camera, screen capture, and a procedural fallback |
| `src/audio.ts` | mic FFT to two smoothed numbers, with rolling auto-gain |
| `src/sync.ts` | Supabase Realtime, falling back to BroadcastChannel |
| `src/recorder.ts` | canvas to a file on disk |
| `public/boot-error.js` | classic script that surfaces module load failures |

Adding a look is a data change in `presets.ts`, never a code change. Everything the
remote can touch is a uniform, so switching looks mid-set cannot trigger a shader
recompile.

## What this is not

The visuals are a GPU shader chain, not a diffusion model. It runs at display
refresh rate on the laptop's own GPU, offline, for free — but it restyles what the
camera sees, it does not reimagine it, and there is no text prompt.

That is a hard ceiling, not a tuning problem. A shader computes each pixel from
its neighbours and has no idea there is a person in frame, so "Claymation" or an
anime portrait are not reachable at any parameter setting — those need the image
re-synthesised. The **Cel** bank goes as far as this approach can toward that
aesthetic, and stops well short of it: flat regions and ink outlines, not
characters.

Prompt-driven restyling needs real-time img2img diffusion (StreamDiffusion / SD-Turbo,
1–4 denoise steps, 512px). That is a server with a GPU on it, which is the thing this
build deliberately avoids. The seam for it:

- The `Stylizer` interface in `src/types.ts` is the seam: `init` / `setSource` /
  `render` / `resize` / `dispose`. A `DiffusionStylizer` implementing those five
  methods drops into `stage.ts` with no other change.
- `render` would push the source frame to a WebSocket and draw the most recent
  returned frame rather than rendering locally — the loop must never block on the
  network, or the stage stutters every time the venue wifi hiccups.
- `StageState` gains a `prompt` field; `remote.html` gains a text input that patches it.

Modal's free monthly credit covers roughly 10–15 GPU-hours, which is enough for a
demo night but is a hard ceiling, not a free tier. Keep the WebGL path as the
fallback: when the endpoint is cold, unreachable, or out of credit, the room should
still see something.
