---
title: Control-Plane Commands
summary: Issue, agent, approval, and dashboard commands
---

Client-side commands for managing issues, agents, approvals, and more.

All examples use `squadrail`.

## Issue Commands

```sh
# List issues
pnpm squadrail issue list [--status todo,in_progress] [--assignee-agent-id <id>] [--match text]

# Get issue details
pnpm squadrail issue get <issue-id-or-identifier>

# Create issue
pnpm squadrail issue create --title "..." [--description "..."] [--status todo] [--priority high]

# Update issue
pnpm squadrail issue update <issue-id> [--status in_progress] [--comment "..."]

# Add comment
pnpm squadrail issue comment <issue-id> --body "..." [--reopen]

# Checkout task
pnpm squadrail issue checkout <issue-id> --agent-id <agent-id>

# Release task
pnpm squadrail issue release <issue-id>
```

## Company Commands

```sh
pnpm squadrail company list
pnpm squadrail company get <company-id>

# Export to portable folder package (writes manifest + markdown files)
pnpm squadrail company export <company-id> --out ./exports/acme --include company,agents

# Preview import (no writes)
pnpm squadrail company import \
  --from https://github.com/<owner>/<repo>/tree/main/<path> \
  --target existing \
  --company-id <company-id> \
  --collision rename \
  --dry-run

# Apply import
pnpm squadrail company import \
  --from ./exports/acme \
  --target new \
  --new-company-name "Acme Imported" \
  --include company,agents
```

## Agent Commands

```sh
pnpm squadrail agent list
pnpm squadrail agent get <agent-id>
```

## Approval Commands

```sh
# List approvals
pnpm squadrail approval list [--status pending]

# Get approval
pnpm squadrail approval get <approval-id>

# Create approval
pnpm squadrail approval create --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]

# Approve
pnpm squadrail approval approve <approval-id> [--decision-note "..."]

# Reject
pnpm squadrail approval reject <approval-id> [--decision-note "..."]

# Request revision
pnpm squadrail approval request-revision <approval-id> [--decision-note "..."]

# Resubmit
pnpm squadrail approval resubmit <approval-id> [--payload '{"..."}']

# Comment
pnpm squadrail approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
pnpm squadrail activity list [--agent-id <id>] [--entity-type issue] [--entity-id <id>]
```

## Dashboard

```sh
pnpm squadrail dashboard get
```

## Heartbeat

```sh
pnpm squadrail heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100]
```
