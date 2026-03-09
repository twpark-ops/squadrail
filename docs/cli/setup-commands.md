---
title: Setup Commands
summary: Onboard, run, doctor, and configure
---

Instance setup and diagnostics commands.

## `squadrail run`

One-command bootstrap and start:

```sh
pnpm squadrail run
```

Does:

1. Auto-onboards if config is missing
2. Runs `squadrail doctor` with repair enabled
3. Starts the server when checks pass

Choose a specific instance:

```sh
pnpm squadrail run --instance dev
```

## `squadrail onboard`

Interactive first-time setup:

```sh
pnpm squadrail onboard
```

First prompt:

1. `Quickstart` (recommended): local defaults (embedded database, no LLM provider, local disk storage, default secrets)
2. `Advanced setup`: full interactive configuration

Start immediately after onboarding:

```sh
pnpm squadrail onboard --run
```

Non-interactive defaults + immediate start (opens browser on server listen):

```sh
pnpm squadrail onboard --yes
```

## `squadrail doctor`

Health checks with optional auto-repair:

```sh
pnpm squadrail doctor
pnpm squadrail doctor --repair
```

Validates:

- Server configuration
- Database connectivity
- Secrets adapter configuration
- Storage configuration
- Missing key files

## `squadrail configure`

Update configuration sections:

```sh
pnpm squadrail configure --section server
pnpm squadrail configure --section secrets
pnpm squadrail configure --section storage
```

## `squadrail env`

Show resolved environment configuration:

```sh
pnpm squadrail env
```

## `squadrail allowed-hostname`

Allow a private hostname for authenticated/private mode:

```sh
pnpm squadrail allowed-hostname my-tailscale-host
```

## Local Storage Paths

| Data | Default Path |
|------|-------------|
| Config | `~/.squadrail/instances/default/config.json` |
| Database | `~/.squadrail/instances/default/db` |
| Logs | `~/.squadrail/instances/default/logs` |
| Storage | `~/.squadrail/instances/default/data/storage` |
| Secrets key | `~/.squadrail/instances/default/secrets/master.key` |

Override with:

```sh
SQUADRAIL_HOME=/custom/home SQUADRAIL_INSTANCE_ID=dev pnpm squadrail run
```

Or pass `--data-dir` directly on any command:

```sh
pnpm squadrail run --data-dir ./tmp/squadrail-dev
pnpm squadrail doctor --data-dir ./tmp/squadrail-dev
```
