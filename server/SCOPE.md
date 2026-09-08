# Running the AI engine on Daydream Scope

The app's AI engine (`src/stylizer/scope.ts`) talks to a
[Daydream Scope](https://github.com/daydreamlive/scope) server over WebRTC.
Scope is not configured by the browser, so a fresh box needs these steps once.

## The pod

Image `daydreamlive/scope:<sha>-cloud` — the plain `:latest` tag is stale and is
**not** the cloud build, and a pod created from it exits immediately, leaving the
proxy returning 404 forever with no other symptom.

Use **Secure Cloud**. Community 4090 hosts repeatedly came up with the GPU
invisible to the container: the boot log says `CUDA is not available on this
system`, only 7 of 13 pipelines register, and every later symptom follows from
that. Check before doing anything else:

```bash
curl -s "$SCOPE/api/v1/pipelines/schemas" | python3 -c "import json,sys;print(len(json.load(sys.stdin)['pipelines']))"
```

Fewer than 12 means a broken host. Delete the pod and create another.

## Models and the pipeline

```bash
curl -X POST "$SCOPE/api/v1/models/download" -H 'Content-Type: application/json' \
  -d '{"pipeline_id":"streamdiffusionv2"}'
```

Do not trust `GET /api/v1/models/status`. On a host without CUDA it reports
`downloaded: true` with zero files present — `models_are_downloaded` iterates the
artifact list and returns True from an empty one. Confirm by loading the
pipeline instead.

Load it at the model's own resolution, and name the node after the pipeline so
the browser's `pipeline_ids` matches it:

```bash
curl -X POST "$SCOPE/api/v1/pipeline/load" -H 'Content-Type: application/json' -d '{
  "pipelines":[{"node_id":"streamdiffusionv2","pipeline_id":"streamdiffusionv2",
    "load_params":{"width":832,"height":480,"vae_type":"lighttae"}}]}'
```

**832x480 is not optional.** It is what StreamDiffusionV2 was trained at, and the
pipeline returns whatever it was loaded with. Left at the 512x512 default the
picture comes back soft and square, and frame-to-frame difference measured 8.71
against 1.85 at the right resolution — the same footage, the same prompt.

`lighttae` is a pruned VAE; the full `wan` VAE ran out of memory on a 24GB card
at this resolution when a previous pipeline was still resident. Restart the
server before loading if you hit that.

## Frame interpolation

The browser asks for `streamdiffusionv2` and `rife` as a chain, so both must be
loaded. RIFE synthesises a frame between each pair the model produces, which is
cheap next to a diffusion step and makes the difference between a picture that
arrives in clumps and one that moves: over the same thirty seconds of the same
footage, 9 frames arrived without it and 46 with, and the receive buffer fell
from 0.29s to 0.01s.

## The relay

Scope fetches TURN credentials from `turn.fastrtc.org`, **a domain that no longer
resolves anywhere**. `HF_TOKEN` cannot help: with a token set the code takes that
dead path, and without one it falls through to plain STUN, never reaching the
`CLOUDFLARE_TURN_KEY_ID` branch. So the pod cannot be given a relay at all.

The relay therefore comes from the browser, via `VITE_TURN_SERVERS` — see
`.env.example`. That is enough on its own: the pod's outbound path works, so it
dials the browser's relay candidate.

## Costs

A Secure Cloud 4090 is about $0.74/hr and bills while idle. Stopping a pod
usually loses the GPU ("not enough free GPUs on the host machine"), which costs a
fresh ~18 minute model download, so finish a session's work in one sitting
rather than stopping between experiments.
