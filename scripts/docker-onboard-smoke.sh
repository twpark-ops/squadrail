#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE_NAME="${IMAGE_NAME:-squadrail-onboard-smoke}"
HOST_PORT="${HOST_PORT:-3131}"
SQUADRAIL_VERSION="${SQUADRAIL_VERSION:-latest}"
DATA_DIR="${DATA_DIR:-$REPO_ROOT/data/docker-onboard-smoke}"
HOST_UID="${HOST_UID:-$(id -u)}"
SQUADRAIL_DEPLOYMENT_MODE="${SQUADRAIL_DEPLOYMENT_MODE:-authenticated}"
SQUADRAIL_DEPLOYMENT_EXPOSURE="${SQUADRAIL_DEPLOYMENT_EXPOSURE:-private}"
DOCKER_TTY_ARGS=()

if [[ -t 0 && -t 1 ]]; then
  DOCKER_TTY_ARGS=(-it)
fi

mkdir -p "$DATA_DIR"

echo "==> Building onboard smoke image"
docker build \
  --build-arg SQUADRAIL_VERSION="$SQUADRAIL_VERSION" \
  --build-arg HOST_UID="$HOST_UID" \
  -f "$REPO_ROOT/Dockerfile.onboard-smoke" \
  -t "$IMAGE_NAME" \
  "$REPO_ROOT"

echo "==> Running onboard smoke container"
echo "    UI should be reachable at: http://localhost:$HOST_PORT"
echo "    Data dir: $DATA_DIR"
echo "    Deployment: $SQUADRAIL_DEPLOYMENT_MODE/$SQUADRAIL_DEPLOYMENT_EXPOSURE"
echo "    Live output: onboard banner and server logs stream in this terminal (Ctrl+C to stop)"
docker run --rm \
  "${DOCKER_TTY_ARGS[@]}" \
  --name "${IMAGE_NAME//[^a-zA-Z0-9_.-]/-}" \
  -p "$HOST_PORT:3100" \
  -e HOST=0.0.0.0 \
  -e PORT=3100 \
  -e SQUADRAIL_DEPLOYMENT_MODE="$SQUADRAIL_DEPLOYMENT_MODE" \
  -e SQUADRAIL_DEPLOYMENT_EXPOSURE="$SQUADRAIL_DEPLOYMENT_EXPOSURE" \
  -v "$DATA_DIR:/squadrail" \
  "$IMAGE_NAME"
