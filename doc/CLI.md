# CLI Reference

Squadrail CLI now supports both:

- instance setup/diagnostics (`onboard`, `doctor`, `configure`, `env`, `allowed-hostname`)
- control-plane client operations (issues, approvals, agents, activity, dashboard)

## Base Usage

Use repo script in development:

```sh
pnpm squadrail --help
```

First-time local bootstrap + run:

```sh
pnpm squadrail run
```

Choose local instance:

```sh
pnpm squadrail run --instance dev
```

## Deployment Modes

Mode taxonomy and design intent are documented in `doc/DEPLOYMENT-MODES.md`.

Current CLI behavior:

- `squadrail onboard` and `squadrail configure --section server` set deployment mode in config
- runtime can override mode with `SQUADRAIL_DEPLOYMENT_MODE`
- `squadrail run` and `squadrail doctor` do not yet expose a direct `--mode` flag

Target behavior (planned) is documented in `doc/DEPLOYMENT-MODES.md` section 5.

Allow an authenticated/private hostname (for example custom Tailscale DNS):

```sh
pnpm squadrail allowed-hostname dotta-macbook-pro
```

All client commands support:

- `--data-dir <path>`
- `--api-base <url>`
- `--api-key <token>`
- `--context <path>`
- `--profile <name>`
- `--json`

Company-scoped commands also support `--company-id <id>`.

Use `--data-dir` on any CLI command to isolate all default local state (config/context/db/logs/storage/secrets) away from `~/.squadrail`:

```sh
pnpm squadrail run --data-dir ./tmp/squadrail-dev
pnpm squadrail issue list --data-dir ./tmp/squadrail-dev
```

## Context Profiles

Store local defaults in `~/.squadrail/context.json`:

```sh
pnpm squadrail context set --api-base http://localhost:3100 --company-id <company-id>
pnpm squadrail context show
pnpm squadrail context list
pnpm squadrail context use default
```

To avoid storing secrets in context, set `apiKeyEnvVarName` and keep the key in env:

```sh
pnpm squadrail context set --api-key-env-var-name SQUADRAIL_API_KEY
export SQUADRAIL_API_KEY=...
```

## Company Commands

```sh
pnpm squadrail company list
pnpm squadrail company get <company-id>
pnpm squadrail company delete <company-id-or-prefix> --yes --confirm <same-id-or-prefix>
```

Examples:

```sh
pnpm squadrail company delete PAP --yes --confirm PAP
pnpm squadrail company delete 5cbe79ee-acb3-4597-896e-7662742593cd --yes --confirm 5cbe79ee-acb3-4597-896e-7662742593cd
```

Notes:

- Deletion is server-gated by `SQUADRAIL_ENABLE_COMPANY_DELETION`.
- With agent authentication, company deletion is company-scoped. Use the current company ID/prefix (for example via `--company-id` or `SQUADRAIL_COMPANY_ID`), not another company.

## Issue Commands

```sh
pnpm squadrail issue list --company-id <company-id> [--status todo,in_progress] [--assignee-agent-id <agent-id>] [--match text]
pnpm squadrail issue get <issue-id-or-identifier>
pnpm squadrail issue create --company-id <company-id> --title "..." [--description "..."] [--status todo] [--priority high]
pnpm squadrail issue update <issue-id> [--status in_progress] [--comment "..."]
pnpm squadrail issue comment <issue-id> --body "..." [--reopen]
pnpm squadrail issue checkout <issue-id> --agent-id <agent-id> [--expected-statuses todo,backlog,blocked]
pnpm squadrail issue release <issue-id>
```

## Agent Commands

```sh
pnpm squadrail agent list --company-id <company-id>
pnpm squadrail agent get <agent-id>
```

## Approval Commands

```sh
pnpm squadrail approval list --company-id <company-id> [--status pending]
pnpm squadrail approval get <approval-id>
pnpm squadrail approval create --company-id <company-id> --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]
pnpm squadrail approval approve <approval-id> [--decision-note "..."]
pnpm squadrail approval reject <approval-id> [--decision-note "..."]
pnpm squadrail approval request-revision <approval-id> [--decision-note "..."]
pnpm squadrail approval resubmit <approval-id> [--payload '{"...":"..."}']
pnpm squadrail approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
pnpm squadrail activity list --company-id <company-id> [--agent-id <agent-id>] [--entity-type issue] [--entity-id <id>]
```

## Dashboard Commands

```sh
pnpm squadrail dashboard get --company-id <company-id>
```

## Heartbeat Command

`heartbeat run` now also supports context/api-key options and uses the shared client stack:

```sh
pnpm squadrail heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100] [--api-key <token>]
```

## Local Storage Defaults

Default local instance root is `~/.squadrail/instances/default`:

- config: `~/.squadrail/instances/default/config.json`
- embedded db: `~/.squadrail/instances/default/db`
- logs: `~/.squadrail/instances/default/logs`
- storage: `~/.squadrail/instances/default/data/storage`
- secrets key: `~/.squadrail/instances/default/secrets/master.key`

Override base home or instance with env vars:

```sh
SQUADRAIL_HOME=/custom/home SQUADRAIL_INSTANCE_ID=dev pnpm squadrail run
```

## Storage Configuration

Configure storage provider and settings:

```sh
pnpm squadrail configure --section storage
```

Supported providers:

- `local_disk` (default; local single-user installs)
- `s3` (S3-compatible object storage)
