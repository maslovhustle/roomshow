#!/usr/bin/env bash
# Bring up a Daydream Scope box and configure it the way this app needs.
#
# Every step here exists because skipping it cost an afternoon once. Read
# SCOPE.md for why each one matters; the short version is that a wrong image
# tag, a host without CUDA, or the default 512x512 resolution all fail in ways
# that look like something else entirely.
#
#   RUNPOD_API_KEY=... ./server/scope_up.sh
#
# Prints the pod id and the endpoint to put in .env.local.
set -euo pipefail

: "${RUNPOD_API_KEY:?set RUNPOD_API_KEY}"
IMAGE="${SCOPE_IMAGE:-daydreamlive/scope:01761a1-cloud}"
GPU="${SCOPE_GPU:-NVIDIA GeForce RTX 4090}"
# Secure rather than Community: community 4090 hosts repeatedly came up with
# the GPU invisible to the container, and every later symptom followed from it.
CLOUD="${SCOPE_CLOUD:-SECURE}"
WIDTH="${SCOPE_WIDTH:-832}"
HEIGHT="${SCOPE_HEIGHT:-480}"
VAE="${SCOPE_VAE:-lighttae}"
PIPELINE=streamdiffusionv2
API=https://rest.runpod.io/v1/pods
ATTEMPTS="${SCOPE_ATTEMPTS:-4}"

api() { curl -fsS -H "Authorization: Bearer $RUNPOD_API_KEY" "$@"; }
jqp() { python3 -c "import json,sys;d=json.load(sys.stdin);print(${1})"; }

wait_http() {  # $1 url, $2 tries
  local i
  for ((i = 0; i < $2; i++)); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$1")" = "200" ] && return 0
    sleep 20
  done
  return 1
}

for ((attempt = 1; attempt <= ATTEMPTS; attempt++)); do
  echo "== attempt $attempt: creating pod"
  POD=$(api -X POST -H 'Content-Type: application/json' "$API" -d "{
    \"name\":\"roomshow-scope\",\"imageName\":\"$IMAGE\",
    \"gpuTypeIds\":[\"$GPU\"],\"cloudType\":\"$CLOUD\",\"gpuCount\":1,
    \"containerDiskInGb\":30,\"volumeInGb\":50,\"volumeMountPath\":\"/workspace\",
    \"ports\":[\"8000/http\"]}" | jqp "d['id']")
  URL="https://$POD-8000.proxy.runpod.net"
  echo "   pod $POD, waiting for it to answer"

  if ! wait_http "$URL/health" 45; then
    echo "   never came up, deleting"; api -X DELETE "$API/$POD" >/dev/null; continue
  fi

  # The cheapest possible check for the failure that hides behind every other
  # failure: no CUDA means only the CPU-only pipelines register.
  N=$(curl -fsS -m 20 "$URL/api/v1/pipelines/schemas" | jqp "len(d['pipelines'])")
  if [ "$N" -lt 12 ]; then
    echo "   only $N pipelines — CUDA is not available on this host, deleting"
    api -X DELETE "$API/$POD" >/dev/null; continue
  fi
  echo "   $N pipelines, GPU is real"
  break
done

[ "${N:-0}" -ge 12 ] || { echo "no healthy host after $ATTEMPTS attempts"; exit 1; }

echo "== downloading models (about 18 minutes)"
curl -fsS -m 30 -X POST "$URL/api/v1/models/download" \
  -H 'Content-Type: application/json' -d "{\"pipeline_id\":\"$PIPELINE\"}" >/dev/null
# models/status is not trustworthy on its own — it reports "downloaded" from an
# empty artifact list — but on a healthy host its progress figures are real.
while :; do
  S=$(curl -fsS -m 20 "$URL/api/v1/models/status?pipeline_id=$PIPELINE")
  echo "$S" | grep -q '"downloaded":true' && break
  echo "   $(echo "$S" | jqp "(d.get('progress') or {}).get('percentage')")%"
  sleep 30
done

echo "== loading the pipeline at ${WIDTH}x${HEIGHT}"
# node_id matches the pipeline id because that is the name the browser asks for
# in initialParameters.pipeline_ids; anything else and the session starts with
# no model attached.
curl -fsS -m 60 -X POST "$URL/api/v1/pipeline/load" -H 'Content-Type: application/json' -d "{
  \"pipelines\":[{\"node_id\":\"$PIPELINE\",\"pipeline_id\":\"$PIPELINE\",
    \"load_params\":{\"width\":$WIDTH,\"height\":$HEIGHT,\"vae_type\":\"$VAE\"}}]}" >/dev/null
while :; do
  ST=$(curl -fsS -m 20 "$URL/api/v1/pipeline/status" | jqp "(d.get('status'), d.get('error'))")
  case "$ST" in
    "('loaded'"*) echo "   loaded"; break;;
    "('error'"*) echo "   $ST"; exit 1;;
  esac
  sleep 15
done

cat <<EOF

Ready. Put this in .env.local:

  VITE_DIFFUSION_URL=$URL

The relay still has to come from the browser — Scope cannot supply one, see
SCOPE.md. Mint a set of Cloudflare credentials into VITE_TURN_SERVERS.

Stop billing with:

  curl -X POST -H "Authorization: Bearer \$RUNPOD_API_KEY" $API/$POD/stop

Stopping usually loses the GPU, and starting again then fails with "not enough
free GPUs"; deleting and re-running this script is the normal recovery.
EOF
