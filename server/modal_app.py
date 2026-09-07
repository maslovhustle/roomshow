"""roomshow diffusion on Modal.

Modal is serverless, so this is not the same shape as stream_server.py: there is
no long-lived process to start, and the container can disappear between sets.
Two consequences drive the whole file.

First, weights are baked into the image at build time. A cold start that also
has to pull 2.5GB from Hugging Face takes minutes, and the operator experiences
that as the app being broken.

Second, the model is loaded once per container in @modal.enter() rather than per
request. Loading it per connection would put a thirty-second stall in front of
the first frame of every set.

Deploy:

    pip install modal
    modal setup
    modal deploy server/modal_app.py

Modal prints a URL like https://you--roomshow-diffusion-web.modal.run — give the
app wss://you--roomshow-diffusion-web.modal.run/ws?token=YOUR_TOKEN
"""

from __future__ import annotations

import io
import json
import os

import modal

MODEL_ID = "stabilityai/sd-turbo"
EDGE = 512
NEGATIVE = "blurry, low quality, distorted, deformed, watermark, text, extra limbs"


def _fetch_weights() -> None:
    """Runs at image build time so a cold start never waits on a download."""
    from diffusers import AutoPipelineForImage2Image
    import torch

    AutoPipelineForImage2Image.from_pretrained(
        MODEL_ID, torch_dtype=torch.float16, variant="fp16"
    )


image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch==2.4.1",
        "diffusers==0.31.0",
        "transformers==4.44.2",
        "accelerate==0.34.2",
        "pillow==10.4.0",
        "fastapi[standard]==0.115.4",
    )
    .run_function(_fetch_weights)
)

app = modal.App("roomshow-diffusion", image=image)


@app.cls(
    gpu="L4",
    # A cold start costs roughly a minute of wall clock and a chunk of the free
    # credit, so the container is kept alive five minutes past the last frame —
    # long enough to survive a set change, short enough not to bill overnight.
    scaledown_window=300,
    max_containers=1,
)
class Diffuser:
    @modal.enter()
    def load(self) -> None:
        import torch
        from diffusers import AutoPipelineForImage2Image

        self.pipe = AutoPipelineForImage2Image.from_pretrained(
            MODEL_ID, torch_dtype=torch.float16, variant="fp16", safety_checker=None
        ).to("cuda")
        self.pipe.set_progress_bar_config(disable=True)
        self.pipe.vae.enable_slicing()

        from PIL import Image

        # Compile kernels and allocate workspace now, so the first frame of a
        # set is not the slow one.
        self._render(Image.new("RGB", (EDGE, EDGE)), "warmup", 0.5)

    def _render(self, frame, prompt: str, strength: float):
        # num_inference_steps * strength must reach 1 or the scheduler returns
        # the input untouched, which looks like the model doing nothing.
        steps = max(2, int(round(2 / max(strength, 0.15))))
        return self.pipe(
            prompt=prompt or "a photograph",
            negative_prompt=NEGATIVE,
            image=frame,
            num_inference_steps=steps,
            strength=strength,
            guidance_scale=0.0,  # turbo models are trained without guidance
        ).images[0]

    @modal.asgi_app()
    def web(self):
        from fastapi import FastAPI, WebSocket, WebSocketDisconnect
        from PIL import Image

        api = FastAPI()
        secret = os.environ.get("ROOMSHOW_TOKEN", "")

        def fit(picture: "Image.Image") -> "Image.Image":
            side = min(picture.size)
            left = (picture.width - side) // 2
            top = (picture.height - side) // 2
            return picture.crop((left, top, left + side, top + side)).resize(
                (EDGE, EDGE), Image.BILINEAR
            )

        @api.websocket("/ws")
        async def stream(websocket: WebSocket) -> None:
            # Modal web endpoints are public. This streams someone's camera, so
            # an unguarded URL is a real problem, not a theoretical one.
            if secret and websocket.query_params.get("token") != secret:
                await websocket.close(code=4401)
                return

            await websocket.accept()
            prompt, strength, busy = "", 0.6, False

            try:
                while True:
                    message = await websocket.receive()

                    if (text := message.get("text")) is not None:
                        try:
                            payload = json.loads(text)
                        except json.JSONDecodeError:
                            continue
                        if payload.get("type") == "config":
                            prompt = str(payload.get("prompt", ""))[:400]
                            strength = min(0.95, max(0.15, float(payload.get("strength", 0.6))))
                        continue

                    data = message.get("bytes")
                    if data is None:
                        continue

                    # Drop rather than queue. The client already holds one frame
                    # in flight, so anything arriving mid-render describes a
                    # moment that has already passed — and a queue would trade
                    # latency, which the room sees, for throughput, which it
                    # does not.
                    if busy:
                        continue
                    busy = True
                    try:
                        frame = fit(Image.open(io.BytesIO(data)).convert("RGB"))
                        out = self._render(frame, prompt, strength)
                        buffer = io.BytesIO()
                        out.save(buffer, format="JPEG", quality=80)
                        await websocket.send_bytes(buffer.getvalue())
                    finally:
                        busy = False
            except WebSocketDisconnect:
                return

        return api
