---
title: Environment Variables
summary: Full environment variable reference
---

All environment variables that Squadrail uses for server configuration.

Primary env names use the `SQUADRAIL_*` prefix.

## Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Server port |
| `HOST` | `127.0.0.1` | Server host binding |
| `DATABASE_URL` | (embedded) | PostgreSQL connection string |
| `SQUADRAIL_HOME` | `~/.squadrail` | Base directory for all Squadrail data |
| `SQUADRAIL_INSTANCE_ID` | `default` | Instance identifier (for multiple local instances) |
| `SQUADRAIL_DEPLOYMENT_MODE` | `local_trusted` | Runtime mode override |

## Secrets

| Variable | Default | Description |
|----------|---------|-------------|
| `SQUADRAIL_SECRETS_MASTER_KEY` | (from file) | 32-byte encryption key (base64/hex/raw) |
| `SQUADRAIL_SECRETS_MASTER_KEY_FILE` | `~/.squadrail/.../secrets/master.key` | Path to key file |
| `SQUADRAIL_SECRETS_STRICT_MODE` | `false` | Require secret refs for sensitive env vars |

## Agent Runtime (Injected into agent processes)

These are set automatically by the server when invoking agents:

| Variable | Description |
|----------|-------------|
| `SQUADRAIL_AGENT_ID` | Agent's unique ID |
| `SQUADRAIL_COMPANY_ID` | Company ID |
| `SQUADRAIL_API_URL` | Squadrail API base URL |
| `SQUADRAIL_API_KEY` | Short-lived JWT for API auth |
| `SQUADRAIL_RUN_ID` | Current heartbeat run ID |
| `SQUADRAIL_TASK_ID` | Issue that triggered this wake |
| `SQUADRAIL_WAKE_REASON` | Wake trigger reason |
| `SQUADRAIL_WAKE_COMMENT_ID` | Comment that triggered this wake |
| `SQUADRAIL_APPROVAL_ID` | Resolved approval ID |
| `SQUADRAIL_APPROVAL_STATUS` | Approval decision |
| `SQUADRAIL_LINKED_ISSUE_IDS` | Comma-separated linked issue IDs |

## LLM Provider Keys (for adapters)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key (for Claude Local adapter) |
| `OPENAI_API_KEY` | OpenAI API key (for Codex Local adapter) |
