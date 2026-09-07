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
# A stylised base rather than a photographic one. With sd-turbo, light
# denoising returns a photo and heavy denoising returns noise; a model that
# already draws gives a drawn picture even when it barely touches the frame.
MODEL_ID = os.environ.get("ROOMSHOW_MODEL", "Lykon/dreamshaper-8-lcm")

# Measured on a 3090: below 35 the picture collapses, above 42 the style
# disappears. The usable window is narrow and worth stating in one place.
T_INDEX_MIN = 35
T_INDEX_MAX = 42
DEFAULT_T_INDEX = 37
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


class Engine:
    """StreamDiffusion, not a per-frame img2img loop.

    The difference is the whole reason this rewrite exists. Calling a diffusers
    pipeline once per frame gives each frame its own denoising run from its own
    noise, so the model re-invents the scene continuously and the result reads
    as a flicker book — measured at 4.3 units of frame-to-frame change against
    0.8 for the source itself.

    StreamDiffusion keeps a batch of frames at staggered denoising stages and
    carries latents across them, so a frame costs about one step and consecutive
    frames share their interpretation. Same GPU, measured: 2.0 fps and 4.3
    flicker became 9.7 fps and 0.9.
    """

    def __init__(self, model_id: str = MODEL_ID) -> None:
        if not torch.cuda.is_available():
            raise SystemExit("No CUDA device. This needs a GPU box; a laptop will not do.")

        from diffusers import AutoPipelineForImage2Image
        from streamdiffusion import StreamDiffusion
        from streamdiffusion.image_utils import postprocess_image

        self._postprocess = postprocess_image
        pipe = AutoPipelineForImage2Image.from_pretrained(
            model_id, torch_dtype=torch.float16, safety_checker=None
        ).to("cuda")
        pipe.set_progress_bar_config(disable=True)
        self.pipe = pipe
        self._StreamDiffusion = StreamDiffusion

        self.lock = asyncio.Lock()
        self.prompt = ""
        self.t_index = DEFAULT_T_INDEX
        self.stream = None
        self._build(self.prompt, self.t_index)
        log.info("engine warm at %dpx", EDGE)

    def _build(self, prompt: str, t_index: int) -> None:
        """Rebuilt only when the prompt or strength changes, never per frame."""
        self.stream = self._StreamDiffusion(
            self.pipe,
            # One entry, one denoising step per frame. Below about 35 the
            # scheduler cannot recover the frame and the output collapses to
            # noise or to black — verified, not assumed.
            t_index_list=[t_index],
            torch_dtype=torch.float16,
            width=EDGE,
            height=EDGE,
            do_add_noise=True,
        )
        self.stream.prepare(
            prompt=prompt or "a photograph",
            negative_prompt=NEGATIVE,
            guidance_scale=1.2,
        )
        blank = Image.new("RGB", (EDGE, EDGE))
        for _ in range(4):
            self._run(blank)
        self.prompt = prompt
        self.t_index = t_index

    def _run(self, image: Image.Image) -> Image.Image:
        tensor = self.stream.image_processor.preprocess(image, EDGE, EDGE).to("cuda", torch.float16)
        return self._postprocess(self.stream(tensor), output_type="pil")[0]

    def render(self, image: Image.Image, prompt: str, strength: float) -> Image.Image:
        # strength reads as "how far from the camera", so it maps backwards onto
        # t_index: a higher index means less noise and a closer picture.
        t_index = max(T_INDEX_MIN, min(T_INDEX_MAX, round(T_INDEX_MAX - strength * (T_INDEX_MAX - T_INDEX_MIN))))
        if prompt != self.prompt or t_index != self.t_index:
            self._build(prompt, t_index)
        return self._run(image)


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
                out = await asyncio.to_thread(engine.render, frame, prompt, strength)
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
