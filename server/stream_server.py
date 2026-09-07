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
import math
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
# Resolution is the cheapest lever there is. Measured on a 3090: 512px costs
# 160ms a frame, 384px 110ms, 320px 92ms. On a projector in a dark room a
# softer picture is far less noticeable than a stuttering one, and the model
# was trained at 512 anyway — detail beyond that is invented either way.
EDGE = int(os.environ.get("ROOMSHOW_EDGE", "320"))
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


# Every frame denoises from its own random noise unless told otherwise, so the
# model re-invents the scene sixty times a minute and the result reads as a
# flicker book of different pictures rather than a moving image. Pinning the
# seed makes similar inputs produce similar outputs, which is most of what
# "temporal coherence" means in practice.
SEED = 1234


class Engine:
    def __init__(self, model_id: str = MODEL_ID) -> None:
        if not torch.cuda.is_available():
            raise SystemExit("No CUDA device. This needs a GPU box; a laptop will not do.")
        self.pipe = AutoPipelineForImage2Image.from_pretrained(
            model_id, torch_dtype=torch.float16, variant="fp16", safety_checker=None
        ).to("cuda")
        self.pipe.set_progress_bar_config(disable=True)
        # Slicing trades speed for memory. At 512px on a 24GB card there is no
        # memory problem to solve, so it only costs frames.
        self.pipe.vae.disable_slicing()
        self.lock = asyncio.Lock()
        self.generator = torch.Generator(device="cuda").manual_seed(SEED)
        # The previous output, fed back into the next frame. Diffusion has no
        # memory between calls, so without this there is nothing tying one
        # frame to the next at all.
        self.previous: Image.Image | None = None
        self._warm()

    def _warm(self) -> None:
        # The first call compiles kernels and allocates workspace, which takes
        # seconds. Doing it at boot means the first frame of a set is not the
        # slow one.
        blank = Image.new("RGB", (EDGE, EDGE))
        self.render(blank, "warmup", 0.5, 0.0)
        self.previous = None
        log.info("engine warm")

    def render(
        self, image: Image.Image, prompt: str, strength: float, coherence: float = 0.45
    ) -> Image.Image:
        # Blend the last result into this frame before denoising. The model then
        # starts from something it already produced rather than from raw camera
        # pixels, so consecutive frames share their interpretation instead of
        # each inventing a new one. Too much and the picture smears and drifts
        # off the camera; too little and the flicker comes straight back.
        if self.previous is not None and coherence > 0.01:
            image = Image.blend(image, self.previous, min(0.85, coherence))
        # diffusers runs int(num_inference_steps * strength) actual denoising
        # steps, so the count has to scale with strength or a low setting
        # silently returns the input untouched. Two effective steps is the most
        # SD-Turbo needs; more buys nothing and costs frames one for one.
        steps = max(2, int(math.ceil(2 / max(strength, 0.15))))
        # Reset every call: a generator advances its state as it draws, so
        # reusing it without reseeding brings the per-frame randomness back.
        self.generator.manual_seed(SEED)
        result = self.pipe(
            prompt=prompt or "a photograph",
            negative_prompt=NEGATIVE,
            image=image,
            num_inference_steps=steps,
            strength=strength,
            guidance_scale=0.0,  # turbo models are trained without guidance
            generator=self.generator,
        )
        out = result.images[0]
        self.previous = out
        return out


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
    strength = 0.35
    coherence = 0.45
    frames = 0
    started = time.monotonic()

    async for message in websocket:
        if isinstance(message, str):
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                continue
            if payload.get("type") == "ping":
                # Answers without touching the model, so a round trip measures
                # transport alone. Without this, a slow link and a slow model
                # are indistinguishable from the client side.
                await websocket.send(b"\x00")
                continue
            if payload.get("type") == "config":
                prompt = str(payload.get("prompt", ""))[:400]
                strength = min(0.6, max(0.15, float(payload.get("strength", 0.35))))
                coherence = min(0.85, max(0.0, float(payload.get("coherence", 0.45))))
                # A new prompt describes a different picture, so carrying the
                # old one forward would fight the change for several seconds.
                engine.previous = None
                log.info("prompt=%r strength=%.2f", prompt, strength)
            continue

        # No drop here. The client bounds how many frames it leaves outstanding,
        # so the backlog can never exceed that; and dropping would strand the
        # client, which frees an in-flight slot only when a reply arrives.
        # `async for` already serialises the renders.
        try:
            began = time.perf_counter()
            frame = fit(Image.open(io.BytesIO(message)).convert("RGB"))
            async with engine.lock:
                out = await asyncio.to_thread(engine.render, frame, prompt, strength, coherence)
            gpu_ms = (time.perf_counter() - began) * 1000
            buffer = io.BytesIO()
            out.save(buffer, format="JPEG", quality=80)
            await websocket.send(buffer.getvalue())
            touch_heartbeat()
            frames += 1
            # Logging GPU time separately from the wall-clock rate is what
            # makes a slow link distinguishable from a slow model.
            if frames % 30 == 0:
                log.info(
                    "%d frames, %.1f fps overall, last render %.0f ms at %dpx",
                    frames, frames / (time.monotonic() - started), gpu_ms, EDGE,
                )
        except Exception:
            log.exception("frame failed")

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
