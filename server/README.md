# The AI engine

Two deployment shapes for the same protocol: binary WebSocket frames in, redrawn
frames out, prompt as JSON on the same socket.

| File | For |
|---|---|
| `stream_server.py` | a rented box you keep running — RunPod, Vast.ai, any GPU host |
| `modal_app.py` | Modal, which is serverless and scales to zero |
| `autostop.py` | shuts a rented pod down after it goes quiet |
| `deploy_runpod.sh` | pushes and starts the server on a running pod |

## Why not RunPod Serverless

It is the obvious-looking choice and it is the wrong one here. Serverless is a
request/response queue, and this needs a persistent bidirectional socket at
fifteen frames a second — that is nine hundred invocations a minute, each paying
queue overhead. Cold start for a container that also loads a checkpoint is tens
of seconds, not the two to five that gets quoted.

Serverless is right for generating single images on demand. It is wrong for a
live stream. A normal pod plus `autostop.py` is the cheap way to run this.

## RunPod, end to end

Start the pod, then:

```bash
RUNPOD_SSH="root@213.181.122.2 -p 47354" \
ROOMSHOW_TOKEN=pick-something-secret \
./server/deploy_runpod.sh
```

Point the app's home page at:

```
wss://<pod-id>-8888.proxy.runpod.net/?token=pick-something-secret
```

Port 8888 is deliberate. RunPod only proxies ports declared when the pod was
created, and a port it does not know about answers nothing at all — which looks
exactly like a dead server. Check first:

```bash
curl -s -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods \
  | python3 -c 'import json,sys; [print(p["id"], p["ports"]) for p in json.load(sys.stdin)]'
```

The ComfyUI template exposes `8888/http`, `3000/http` and `22/tcp`, so the
server takes the Jupyter slot and leaves ComfyUI alone. The proxy terminates
TLS, which also supplies the `wss://` that a page served over HTTPS requires.

The token is not optional. The proxy URL is public, and what travels over it is
somebody's camera.

### Do not leave it running

```bash
RUNPOD_API_KEY=... nohup python3 /workspace/autostop.py --idle 15 &
```

It measures idleness from the last rendered frame rather than the last open
socket, because a browser tab left open on a locked laptop holds a connection
for hours while asking for nothing.

Note that a *stopped* pod is not free: RunPod keeps billing for disk. Delete the
pod for that.

## Modal

```bash
pip install modal && modal setup
modal deploy server/modal_app.py
```

Weights are baked into the image at build time, because a cold start that also
pulls 2.5GB from Hugging Face reads as the app being broken.

## What the model choice costs

SD-Turbo runs at one to four steps, which is the only reason any of this is
interactive. A standard SD1.5 checkpoint wants twenty-plus steps and lands near
one frame per second — and a FLUX workflow, which is what ComfyUI templates
usually ship with, is slower still and generates from scratch rather than from
the camera frame.

ControlNet holds a silhouette far better and roughly halves the frame rate. At
six to ten frames a second a dancefloor reads it as a slideshow, so it is not
wired in by default.
