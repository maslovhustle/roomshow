"""Real-time diffusion server for roomshow.

One WebSocket per stage. Binary messages in are JPEG frames from the camera;
binary messages out are the redrawn frames. JSON messages carry the prompt.

The design decision that matters: this holds at most one frame per client and
drops anything that arrives while a frame is being denoised. A queue would raise
throughput on paper and ruin the product, because latency is what people in the
room actually perceive — a visual that lags the dancefloor by two seconds is
worse than one running at half the rate.

Run it on any box with an NVIDIA GPU:

    pip install -r requirements.txt
    ROOMSHOW_TOKEN=something-secret python stream_server.py

Then point the app at wss://<host>/?token=something-secret from its home page.
"""

from __future__ import annotations

import argparse
import asyncio
import io
import json
import logging
import os
import time

import torch
from diffusers import AutoPipelineForImage2Image
from PIL import Image
from websockets.asyncio.server import serve

log = logging.getLogger("roomshow")

# SD-Turbo distils the denoising schedule down to one or two steps, which is the
# only reason any of this runs at interactive rates. A standard SD1.5 checkpoint
# needs 20+ steps and lands around one frame per second.
MODEL_ID = "stabilityai/sd-turbo"
EDGE = 512
NEGATIVE = "blurry, low quality, distorted, deformed, watermark, text, extra limbs"

# The idle watchdog reads this file's mtime. Touched from the frame loop rather
# than on connect, because a browser tab left open on a locked laptop holds a
# socket open for hours without asking for a single frame.
HEARTBEAT = os.environ.get("ROOMSHOW_HEARTBEAT", "/workspace/last_frame")
_last_touch = 0.0


def touch_heartbeat() -> None:
    global _last_touch
    now = time.monotonic()
    if now - _last_touch < 5:
        return
    _last_touch = now
    try:
        with open(HEARTBEAT, "w") as handle:
            handle.write(str(time.time()))
    except OSError:
        pass


class Engine:
    def __init__(self, model_id: str = MODEL_ID) -> None:
        if not torch.cuda.is_available():
            raise SystemExit("No CUDA device. This needs a GPU box; a laptop will not do.")
        self.pipe = AutoPipelineForImage2Image.from_pretrained(
            model_id, torch_dtype=torch.float16, variant="fp16", safety_checker=None
        ).to("cuda")
        self.pipe.set_progress_bar_config(disable=True)
        # The VAE decode dominates the frame budget at this resolution.
        self.pipe.vae.enable_slicing()
        self.lock = asyncio.Lock()
        self._warm()

    def _warm(self) -> None:
        # The first call compiles kernels and allocates workspace, which takes
        # seconds. Doing it at boot means the first frame of a set is not the
        # slow one.
        blank = Image.new("RGB", (EDGE, EDGE))
        self.render(blank, "warmup", 0.5)
        log.info("engine warm")

    def render(self, image: Image.Image, prompt: str, strength: float) -> Image.Image:
        # strength drives how far the model may depart from the frame, and it
        # also sets the step count: num_inference_steps * strength must be >= 1
        # or the scheduler returns the input untouched.
        steps = max(2, int(round(2 / max(strength, 0.15))))
        result = self.pipe(
            prompt=prompt or "a photograph",
            negative_prompt=NEGATIVE,
            image=image,
            num_inference_steps=steps,
            strength=strength,
            guidance_scale=0.0,  # turbo models are trained without guidance
        )
        return result.images[0]


def fit(image: Image.Image, edge: int = EDGE) -> Image.Image:
    """Centre-crop to square at the model's native size."""
    side = min(image.size)
    left = (image.width - side) // 2
    top = (image.height - side) // 2
    return image.crop((left, top, left + side, top + side)).resize((edge, edge), Image.BILINEAR)


async def handle(websocket, engine: Engine) -> None:
    # The RunPod proxy URL is public and unguessable only by obscurity, and what
    # travels over it is somebody's camera. A shared token is the minimum.
    secret = os.environ.get("ROOMSHOW_TOKEN", "")
    if secret:
        supplied = ""
        _, _, query = websocket.request.path.partition("?")
        for part in query.split("&"):
            key, _, value = part.partition("=")
            if key == "token":
                supplied = value
        if supplied != secret:
            await websocket.close(code=4401, reason="bad token")
            return

    peer = websocket.remote_address
    log.info("connected %s", peer)
    prompt = ""
    strength = 0.6
    busy = False
    frames = 0
    started = time.monotonic()

    async for message in websocket:
        if isinstance(message, str):
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                continue
            if payload.get("type") == "config":
                prompt = str(payload.get("prompt", ""))[:400]
                strength = min(0.95, max(0.15, float(payload.get("strength", 0.6))))
                log.info("prompt=%r strength=%.2f", prompt, strength)
            continue

        # Drop rather than queue. The client already sends one frame at a time,
        # so anything arriving mid-render is a duplicate of a moment that has
        # already passed.
        if busy:
            continue
        busy = True
        try:
            frame = fit(Image.open(io.BytesIO(message)).convert("RGB"))
            async with engine.lock:
                out = await asyncio.to_thread(engine.render, frame, prompt, strength)
            buffer = io.BytesIO()
            out.save(buffer, format="JPEG", quality=80)
            await websocket.send(buffer.getvalue())
            touch_heartbeat()
            frames += 1
            if frames % 60 == 0:
                log.info("%.1f fps", frames / (time.monotonic() - started))
        except Exception:
            log.exception("frame failed")
        finally:
            busy = False

    log.info("disconnected %s", peer)


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    # 8888 by default: RunPod only proxies ports declared when the pod was
    # created. Its ComfyUI templates expose 8888, 3000 and 22, so this takes
    # the Jupyter slot and leaves ComfyUI running on 3000.
    parser.add_argument("--port", type=int, default=8888)
    parser.add_argument("--model", default=MODEL_ID)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    engine = Engine(args.model)

    async with serve(lambda ws: handle(ws, engine), args.host, args.port, max_size=8 * 1024 * 1024):
        log.info("listening on ws://%s:%d", args.host, args.port)
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
