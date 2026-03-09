---
title: Local Development
summary: Set up Squadrail for local development
---

Run Squadrail locally with zero external dependencies.

## Prerequisites

- Node.js 20+
- pnpm 9+

## Start Dev Server

```sh
pnpm install
pnpm dev
```

This starts:

- **API server** at `http://localhost:3100`
- **UI** served by the API server in dev middleware mode (same origin)

No Docker or external database required. Squadrail uses embedded PostgreSQL automatically.

## One-Command Bootstrap

For a first-time install:

```sh
pnpm squadrail run
```

This does:

1. Auto-onboards if config is missing
2. Runs `squadrail doctor` with repair enabled
3. Starts the server when checks pass

## Tailscale/Private Auth Dev Mode

To run in `authenticated/private` mode for network access:

```sh
pnpm dev --tailscale-auth
```

This binds the server to `0.0.0.0` for private-network access.

Allow additional private hostnames:

```sh
pnpm squadrail allowed-hostname dotta-macbook-pro
```

## Health Checks

```sh
curl http://localhost:3100/api/health
# -> {"status":"ok"}

curl http://localhost:3100/api/companies
# -> []
```

## Reset Dev Data

To wipe local data and start fresh:

```sh
rm -rf ~/.squadrail/instances/default/db
pnpm dev
```

## Data Locations

| Data | Path |
|------|------|
| Config | `~/.squadrail/instances/default/config.json` |
| Database | `~/.squadrail/instances/default/db` |
| Storage | `~/.squadrail/instances/default/data/storage` |
| Secrets key | `~/.squadrail/instances/default/secrets/master.key` |
| Logs | `~/.squadrail/instances/default/logs` |

Override with environment variables:

```sh
SQUADRAIL_HOME=/custom/path SQUADRAIL_INSTANCE_ID=dev pnpm squadrail run
```
