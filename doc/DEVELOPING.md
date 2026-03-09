# Developing

This project can run fully in local dev without setting up PostgreSQL manually.

## Deployment Modes

For mode definitions and intended CLI behavior, see `doc/DEPLOYMENT-MODES.md`.

Current implementation status:

- canonical model: `local_trusted` and `authenticated` (with `private/public` exposure)

## Prerequisites

- Node.js 20+
- pnpm 9+

## Start Dev

From repo root:

```sh
pnpm install
pnpm dev
```

This starts:

- API server: `http://localhost:3100`
- UI: served by the API server in dev middleware mode (same origin as API)

Tailscale/private-auth dev mode:

```sh
pnpm dev --tailscale-auth
```

This runs dev as `authenticated/private` and binds the server to `0.0.0.0` for private-network access.

Allow additional private hostnames (for example custom Tailscale hostnames):

```sh
pnpm squadrail allowed-hostname dotta-macbook-pro
```

## One-Command Local Run

For a first-time local install, you can bootstrap and run in one command:

```sh
pnpm squadrail run
```

`squadrail run` does:

1. auto-onboard if config is missing
2. `squadrail doctor` with repair enabled
3. starts the server when checks pass

## Docker Quickstart (No local Node install)

Build and run Squadrail in Docker:

```sh
docker build -t squadrail-local .
docker run --name squadrail \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e SQUADRAIL_HOME=/squadrail \
  -v "$(pwd)/data/docker-squadrail:/squadrail" \
  squadrail-local
```

Or use Compose:

```sh
docker compose -f docker-compose.quickstart.yml up --build
```

See `doc/DOCKER.md` for API key wiring (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) and persistence details.

## Database in Dev (Auto-Handled)

For local development, leave `DATABASE_URL` unset.
The server will automatically use embedded PostgreSQL and persist data at:

- `~/.squadrail/instances/default/db`

Override home and instance:

```sh
SQUADRAIL_HOME=/custom/path SQUADRAIL_INSTANCE_ID=dev pnpm squadrail run
```

No Docker or external database is required for this mode.

## Storage in Dev (Auto-Handled)

For local development, the default storage provider is `local_disk`, which persists uploaded images/attachments at:

- `~/.squadrail/instances/default/data/storage`

Configure storage provider/settings:

```sh
pnpm squadrail configure --section storage
```

## Default Agent Workspaces

When a local agent run has no resolved project/session workspace, Squadrail falls back to an agent home workspace under the instance root:

- `~/.squadrail/instances/default/workspaces/<agent-id>`

This path honors `SQUADRAIL_HOME` and `SQUADRAIL_INSTANCE_ID` in non-default setups.

## Quick Health Checks

In another terminal:

```sh
curl http://localhost:3100/api/health
curl http://localhost:3100/api/companies
```

Expected:

- `/api/health` returns `{"status":"ok"}`
- `/api/companies` returns a JSON array

## Reset Local Dev Database

To wipe local dev data and start fresh:

```sh
rm -rf ~/.squadrail/instances/default/db
pnpm dev
```

## Optional: Use External Postgres

If you set `DATABASE_URL`, the server will use that instead of embedded PostgreSQL.

## Automatic DB Backups

Squadrail can run automatic DB backups on a timer. Defaults:

- enabled
- every 60 minutes
- retain 30 days
- backup dir: `~/.squadrail/instances/default/data/backups`

Configure these in:

```sh
pnpm squadrail configure --section database
```

Run a one-off backup manually:

```sh
pnpm squadrail db:backup
# or:
pnpm db:backup
```

Environment overrides:

- `SQUADRAIL_DB_BACKUP_ENABLED=true|false`
- `SQUADRAIL_DB_BACKUP_INTERVAL_MINUTES=<minutes>`
- `SQUADRAIL_DB_BACKUP_RETENTION_DAYS=<days>`
- `SQUADRAIL_DB_BACKUP_DIR=/absolute/or/~/path`

## Secrets in Dev

Agent env vars now support secret references. By default, secret values are stored with local encryption and only secret refs are persisted in agent config.

- Default local key path: `~/.squadrail/instances/default/secrets/master.key`
- Override key material directly: `SQUADRAIL_SECRETS_MASTER_KEY`
- Override key file path: `SQUADRAIL_SECRETS_MASTER_KEY_FILE`

Strict mode (recommended outside local trusted machines):

```sh
SQUADRAIL_SECRETS_STRICT_MODE=true
```

When strict mode is enabled, sensitive env keys (for example `*_API_KEY`, `*_TOKEN`, `*_SECRET`) must use secret references instead of inline plain values.

CLI configuration support:

- `pnpm squadrail onboard` writes a default `secrets` config section (`local_encrypted`, strict mode off, key file path set) and creates a local key file when needed.
- `pnpm squadrail configure --section secrets` lets you update provider/strict mode/key path and creates the local key file when needed.
- `pnpm squadrail doctor` validates secrets adapter configuration and can create a missing local key file with `--repair`.

Migration helper for existing inline env secrets:

```sh
pnpm secrets:migrate-inline-env         # dry run
pnpm secrets:migrate-inline-env --apply # apply migration
```

## Company Deletion Toggle

Company deletion is intended as a dev/debug capability and can be disabled at runtime:

```sh
SQUADRAIL_ENABLE_COMPANY_DELETION=false
```

Default behavior:

- `local_trusted`: enabled
- `authenticated`: disabled

## CLI Client Operations

Squadrail CLI now includes client-side control-plane commands in addition to setup commands.

Quick examples:

```sh
pnpm squadrail issue list --company-id <company-id>
pnpm squadrail issue create --company-id <company-id> --title "Investigate checkout conflict"
pnpm squadrail issue update <issue-id> --status in_progress --comment "Started triage"
```

Set defaults once with context profiles:

```sh
pnpm squadrail context set --api-base http://localhost:3100 --company-id <company-id>
```

Then run commands without repeating flags:

```sh
pnpm squadrail issue list
pnpm squadrail dashboard get
```

See full command reference in `doc/CLI.md`.

## OpenClaw Invite Onboarding Endpoints

Agent-oriented invite onboarding now exposes machine-readable API docs:

- `GET /api/invites/:token` returns invite summary plus onboarding and skills index links.
- `GET /api/invites/:token/onboarding` returns onboarding manifest details (registration endpoint, claim endpoint template, skill install hints).
- `GET /api/invites/:token/onboarding.txt` returns a plain-text onboarding doc intended for both human operators and agents (llm.txt-style handoff).
- `GET /api/skills/index` lists available skill documents.
- `GET /api/skills/squadrail` returns the Squadrail heartbeat skill markdown.

## OpenClaw Join Smoke Test

Run the end-to-end OpenClaw join smoke harness:

```sh
pnpm smoke:openclaw-join
```

What it validates:

- invite creation for agent-only join
- agent join request using `adapterType=openclaw`
- board approval + one-time API key claim semantics
- callback delivery on wakeup to a dockerized OpenClaw-style webhook receiver

Required permissions:

- This script performs board-governed actions (create invite, approve join, wakeup another agent).
- In authenticated mode, run with board auth via `SQUADRAIL_AUTH_HEADER` or `SQUADRAIL_COOKIE`.

Optional auth flags (for authenticated mode):

- `SQUADRAIL_AUTH_HEADER` (for example `Bearer ...`)
- `SQUADRAIL_COOKIE` (session cookie header value)

## OpenClaw Docker UI One-Command Script

To boot OpenClaw in Docker and print a host-browser dashboard URL in one command:

```sh
pnpm smoke:openclaw-docker-ui
```

This script lives at `scripts/smoke/openclaw-docker-ui.sh` and automates clone/build/config/start for Compose-based local OpenClaw UI testing.

Pairing behavior for this smoke script:

- default `OPENCLAW_DISABLE_DEVICE_AUTH=1` (no Control UI pairing prompt for local smoke)
- set `OPENCLAW_DISABLE_DEVICE_AUTH=0` to require standard device pairing
