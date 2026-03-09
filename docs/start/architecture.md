---
title: Architecture
summary: Stack overview, request flow, and adapter model
---

Squadrail is a monorepo with four main layers.

## Stack Overview

```
┌─────────────────────────────────────┐
│  React UI (Vite)                    │
│  Ops console, setup, issue workspace│
├─────────────────────────────────────┤
│  Express.js REST API (Node.js)      │
│  Routes, services, auth, adapters   │
├─────────────────────────────────────┤
│  PostgreSQL (Drizzle ORM)           │
│  Schema, migrations, embedded mode  │
├─────────────────────────────────────┤
│  Adapters                           │
│  Claude Local, Codex Local          │
└─────────────────────────────────────┘
```

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 6, React Router 7, Radix UI, Tailwind CSS 4, TanStack Query |
| Backend | Node.js 20+, Express.js 5, TypeScript |
| Database | PostgreSQL 17, Drizzle ORM |
| Auth | Better Auth (sessions + API keys) |
| Adapters | Claude Code CLI, Codex CLI |
| Package manager | pnpm 9 with workspaces |

## Repository Structure

```
squadrail/
├── ui/
├── server/
├── packages/
├── skills/
│   └── squadrail/               # Core heartbeat skill bundle
├── cli/
└── doc/
```

## Request Flow

When a heartbeat fires:

1. **Trigger** — scheduler, manual invoke, assignment, or mention
2. **Adapter invocation** — server calls the configured adapter's `execute()` function
3. **Agent process** — adapter spawns the agent with Squadrail env vars and a prompt
4. **Agent work** — the agent calls Squadrail's REST API to check assignments, claim tasks, do work, and update status
5. **Result capture** — adapter captures stdout, parses usage/cost data, and extracts session state
6. **Run record** — server records the run result, costs, and session state for the next heartbeat

## Adapter Model

Adapters are the bridge between Squadrail and agent runtimes. Each adapter has:

- **Server module** — `execute()` and environment diagnostics
- **UI module** — stdout parser and config helpers
- **CLI module** — terminal formatter for `squadrail run --watch`

Primary product adapters are `claude_local` and `codex_local`.

## Key Design Decisions

- **Control plane, not execution plane** — Squadrail orchestrates agents; it does not replace their runtime
- **Company-scoped** — all entities belong to exactly one company
- **Protocol-first work tracking** — structured handoffs drive the workflow
- **Embedded by default** — zero-config local mode with embedded PostgreSQL
