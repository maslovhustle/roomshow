#!/usr/bin/env bash
# Push the diffusion server to a running RunPod pod and start it.
#
# Usage:
#   RUNPOD_SSH="root@1.2.3.4 -p 47354" ROOMSHOW_TOKEN=secret ./server/deploy_runpod.sh
#
# The pod must be RUNNING. A stopped pod answers every proxied port with 404 and
# refuses SSH with "container not found", which looks like a broken deploy.
set -euo pipefail

: "${RUNPOD_SSH:?Set RUNPOD_SSH, e.g. 'root@213.181.122.2 -p 47354'}"
: "${ROOMSHOW_TOKEN:?Set ROOMSHOW_TOKEN to a secret string}"
KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC2086
ssh_pod() { ssh -o StrictHostKeyChecking=accept-new -i "$KEY" $RUNPOD_SSH "$@"; }

echo "→ copying server"
# shellcheck disable=SC2086
scp -o StrictHostKeyChecking=accept-new -i "$KEY" \
  $(echo "$RUNPOD_SSH" | sed -E 's/(.*) -p ([0-9]+)/-P \2 \1/' | awk '{print $1, $2}' | { read -r a b; echo "$a $b"; }) \
  "$HERE/stream_server.py" :/workspace/stream_server.py 2>/dev/null \
  || ssh_pod 'cat > /workspace/stream_server.py' < "$HERE/stream_server.py"

echo "→ installing dependencies"
ssh_pod 'pip install --quiet --no-input diffusers==0.31.0 transformers==4.44.2 accelerate==0.34.2 "websockets>=13" 2>&1 | tail -3'

# RunPod only proxies ports declared when the pod was created. This template
# exposes 8888, 3000 and 22, so the server takes 8888 and leaves ComfyUI alone
# on 3000 — worth checking with the API before assuming, since a port the proxy
# does not know about simply answers nothing and looks like a dead server.
PORT="${ROOMSHOW_PORT:-8888}"
echo "→ freeing port $PORT"
ssh_pod "fuser -k ${PORT}/tcp 2>/dev/null || true; sleep 2"

echo "→ starting on $PORT"
ssh_pod "ROOMSHOW_TOKEN='$ROOMSHOW_TOKEN' nohup python3 /workspace/stream_server.py --host 0.0.0.0 --port $PORT > /workspace/roomshow.log 2>&1 & sleep 1; echo started"

echo "→ waiting for the model to warm (first load pulls ~2.5GB)"
for _ in $(seq 1 60); do
  if ssh_pod 'grep -q "listening on" /workspace/roomshow.log 2>/dev/null'; then
    echo "✓ up"
    ssh_pod 'tail -5 /workspace/roomshow.log'
    exit 0
  fi
  sleep 10
done

echo "✗ did not come up in ten minutes; last log:"
ssh_pod 'tail -30 /workspace/roomshow.log'
exit 1
