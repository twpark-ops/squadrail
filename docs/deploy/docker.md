---
title: Docker
summary: Docker Compose quickstart
---

Run Squadrail in Docker without installing Node or pnpm locally.

## Compose Quickstart

```sh
docker compose -f docker-compose.quickstart.yml up --build
```

Open [http://localhost:3100](http://localhost:3100).

Defaults:

- Host port: `3100`
- Data directory: `./data/docker-squadrail`

Override with environment variables:

```sh
SQUADRAIL_PORT=3200 SQUADRAIL_DATA_DIR=./data/squadrail \
  docker compose -f docker-compose.quickstart.yml up --build
```

## Manual Docker Build

```sh
docker build -t squadrail-local .
docker run --name squadrail \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e SQUADRAIL_HOME=/squadrail \
  -v "$(pwd)/data/docker-squadrail:/squadrail" \
  squadrail-local
```

## Data Persistence

All data is persisted under the bind mount (`./data/docker-squadrail`):

- Embedded PostgreSQL data
- Uploaded assets
- Local secrets key
- Agent workspace data

## Claude and Codex Adapters in Docker

The Docker image pre-installs:

- `claude` (Anthropic Claude Code CLI)
- `codex` (OpenAI Codex CLI)

Pass API keys to enable local adapter runs inside the container:

```sh
docker run --name squadrail \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e SQUADRAIL_HOME=/squadrail \
  -e OPENAI_API_KEY=sk-... \
  -e ANTHROPIC_API_KEY=sk-... \
  -v "$(pwd)/data/docker-squadrail:/squadrail" \
  squadrail-local
```

Without API keys, the app still boots normally; doctor checks will surface missing prerequisites.
