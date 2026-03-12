FROM node:lts-trixie-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY cli/package.json cli/
COPY server/package.json server/
COPY ui/package.json ui/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/adapter-utils/package.json packages/adapter-utils/
COPY packages/adapters/claude-local/package.json packages/adapters/claude-local/
COPY packages/adapters/codex-local/package.json packages/adapters/codex-local/
COPY packages/adapters/cursor-local/package.json packages/adapters/cursor-local/
COPY packages/adapters/openclaw/package.json packages/adapters/openclaw/
COPY packages/adapters/opencode-local/package.json packages/adapters/opencode-local/
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app /app
COPY . .
RUN pnpm --filter @squadrail/ui build
RUN pnpm --filter @squadrail/server build
RUN test -f server/dist/index.js || (echo "ERROR: server build output missing" && exit 1)

FROM base AS production
WORKDIR /app
COPY --from=build /app /app
RUN npm install --global --omit=dev @anthropic-ai/claude-code@latest @openai/codex@latest \
  && groupadd --system squadrail \
  && useradd --system --gid squadrail --home-dir /squadrail --create-home squadrail \
  && install -d -o squadrail -g squadrail \
    /squadrail \
    /squadrail/.cache \
    /squadrail/.state \
    /squadrail/.npm \
    /squadrail/tmp \
    /squadrail/runtime

ENV NODE_ENV=production \
  HOME=/squadrail \
  HOST=0.0.0.0 \
  PORT=3100 \
  SERVE_UI=true \
  XDG_CACHE_HOME=/squadrail/.cache \
  XDG_STATE_HOME=/squadrail/.state \
  NPM_CONFIG_CACHE=/squadrail/.npm \
  TMPDIR=/squadrail/tmp \
  SQUADRAIL_HOME=/squadrail \
  SQUADRAIL_RUNTIME_DIR=/squadrail/runtime \
  SQUADRAIL_INSTANCE_ID=default \
  SQUADRAIL_CONFIG=/squadrail/instances/default/config.json \
  SQUADRAIL_DEPLOYMENT_MODE=authenticated \
  SQUADRAIL_DEPLOYMENT_EXPOSURE=private

VOLUME ["/squadrail"]
EXPOSE 3100
USER squadrail:squadrail

CMD ["node", "--import", "./server/node_modules/tsx/dist/loader.mjs", "server/dist/index.js"]
