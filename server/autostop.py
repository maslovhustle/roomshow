"""Stop the pod when nobody is using it.

A GPU pod bills for every second it is running, whether or not it is rendering.
The single most expensive mistake with rented hardware is leaving one on
overnight after a test, so this watches for silence and shuts the machine down.

Idleness is measured from the last rendered frame, not from the last open
socket: a browser tab left open on a locked laptop keeps a connection alive for
hours while asking for nothing.

Run it beside the server:

    RUNPOD_API_KEY=... nohup python3 autostop.py --idle 15 &
"""

from __future__ import annotations

import argparse
import logging
import os
import time
import urllib.error
import urllib.request

log = logging.getLogger("autostop")
API = "https://rest.runpod.io/v1/pods/{pod}/stop"


def stop(pod_id: str, api_key: str) -> bool:
    request = urllib.request.Request(
        API.format(pod=pod_id),
        method="POST",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        data=b"{}",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            log.info("stop requested, HTTP %s", response.status)
            return True
    except urllib.error.HTTPError as err:
        log.error("stop failed: HTTP %s %s", err.code, err.read()[:200])
    except urllib.error.URLError as err:
        log.error("stop failed: %s", err.reason)
    return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--idle", type=float, default=15, help="minutes of silence before stopping")
    parser.add_argument("--heartbeat", default=os.environ.get("ROOMSHOW_HEARTBEAT", "/workspace/last_frame"))
    parser.add_argument("--pod", default=os.environ.get("RUNPOD_POD_ID", ""))
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    api_key = os.environ.get("RUNPOD_API_KEY", "")
    if not api_key or not args.pod:
        raise SystemExit("Need RUNPOD_API_KEY and a pod id (RUNPOD_POD_ID is set on every pod).")

    # Count from startup, so a pod that boots and is never used still stops.
    started = time.time()
    limit = args.idle * 60
    log.info("watching %s, stopping pod %s after %.0f min idle", args.heartbeat, args.pod, args.idle)

    while True:
        time.sleep(60)
        try:
            last = os.path.getmtime(args.heartbeat)
        except OSError:
            last = started

        idle = time.time() - last
        if idle < limit:
            continue

        log.info("idle %.1f min, stopping", idle / 60)
        if stop(args.pod, api_key):
            return
        # A failed stop must not spin: retry on the next tick rather than
        # hammering the API while the pod keeps billing.
        log.info("will retry next tick")


if __name__ == "__main__":
    main()
