<p align="center">
  <img src="doc/assets/header.svg" alt="Squadrail" width="720" />
</p>

<p align="center">
  <a href="#quickstart"><strong>Quickstart</strong></a> &middot;
  <a href="docs/start/architecture.md"><strong>Architecture</strong></a> &middot;
  <a href="docs/api/overview.md"><strong>API</strong></a> &middot;
  <a href="docs/cli/overview.md"><strong>CLI</strong></a> &middot;
  <a href="doc/DEVELOPING.md"><strong>Development</strong></a>
</p>

<p align="center">
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" />
  </a>
  <a href="https://github.com/twpark-ops/squadrail/stargazers">
    <img src="https://img.shields.io/github/stars/twpark-ops/squadrail?style=flat" alt="Stars" />
  </a>
</p>

<br/>

## Overview

# Protocol-first orchestration for autonomous software delivery

Squadrail is an open-source control plane for AI agent teams working on real engineering tasks.

Issues, protocol messages, reviews, runtime recovery, and knowledge retrieval are all treated as first-class operating surfaces.

At the product level, Squadrail focuses on five things:

- turning work into explicit protocol state instead of loose chat
- giving different agents distinct roles in the delivery loop
- attaching retrieval-backed context directly to the task
- making review, approval, and closure auditable
- surfacing runtime health and recovery from one UI

<br/>

## What Squadrail actually runs

Squadrail is built for teams that want agents to operate inside a delivery system rather than as isolated coding terminals.

It is a good fit when you need:

- structured issue assignment and handoff
- engineer, reviewer, QA, and board-style roles
- repository-aware retrieval instead of prompt dumping
- company or team isolation in one deployment
- live visibility into active runs, queues, and recovery work

<br/>

## Core operating surfaces

### 1. Delivery protocol

Issues move through typed protocol messages, validated transitions, evidence requirements, and review gates.

### 2. Role-based execution

Leads, engineers, reviewers, QA, and operators have different capabilities and different responsibilities in the workflow.

### 3. Retrieval-backed task context

Context is assembled from repository knowledge, document links, revisions, and role-aware retrieval signals instead of broad copy-pasted code blocks.

### 4. Runtime and recovery

Live runs, heartbeats, recovery queues, and operator actions are visible from the control plane UI.

### 5. Governance and audit

Review handoffs, approvals, protocol violations, closures, and recovery decisions remain inspectable after the fact.

<br/>

## How a task moves through Squadrail

```text
Issue Created
    ↓
ASSIGN_TASK
    ↓
Hybrid Retrieval
    ↓
Task Brief + Context Pack
    ↓
Implementation Run
    ↓
SUBMIT_FOR_REVIEW
    ↓
Approval / Change Request
    ↓
CLOSE_TASK or Recovery
```

Every protocol step can enforce:

- state validation
- recipient and role validation
- required evidence
- retrieval refresh
- runtime dispatch
- review and closure rules

Current core messages include:

```text
ASSIGN_TASK
ACK_ASSIGNMENT
PROPOSE_PLAN
START_IMPLEMENTATION
REPORT_PROGRESS
SUBMIT_FOR_REVIEW
START_REVIEW
REQUEST_CHANGES
APPROVE_IMPLEMENTATION
CLOSE_TASK
```

<br/>

## Product shape

Squadrail is not meant to be a generic chatbot shell. It is shaped around software delivery:

- work begins from issues, projects, and company context
- execution is routed through protocol messages
- review uses structured handoff data instead of freeform summaries
- knowledge is attached to delivery artifacts and repository state
- runtime operations and recovery live beside the workflow, not outside it

That gives the product a more operational feel than most agent wrappers.

<br/>

## Technical highlights

- **Protocol over chat.** Work is driven by typed messages and explicit transitions, not loosely-scoped conversation history.
- **Structured review handoff.** `SUBMIT_FOR_REVIEW` expects implementation summary, diff summary, changed files, test results, checklist, residual risk, and review artifacts.
- **Graph-assisted retrieval.** The current stack is graph-assisted, temporal, and role-aware, with document versioning, retrieval cache, incremental reindex, and explainable personalization. See [docs/rag-current-architecture.md](docs/rag-current-architecture.md).
- **Knowledge stays attached to delivery.** Retrieval is grounded in issues, projects, runs, and evolving repository knowledge instead of being a detached chatbot layer.
- **Local-first development.** Embedded PostgreSQL is auto-managed in development, and the CLI can bootstrap and diagnose a local instance quickly.
- **Pluggable adapters.** The repository already includes adapters for Claude local, Codex local, Cursor local, OpenClaw, and OpenCode local.

<br/>

## Monorepo structure

Squadrail is a `pnpm` workspace with dedicated packages for the control plane, UI, CLI, adapters, and shared contracts.

```text
cli/                      CLI for onboarding, diagnostics, and control-plane operations
server/                   Express + TypeScript API, realtime, auth, services
ui/                       React + Vite control-plane UI
packages/db/              Drizzle schema and migrations
packages/shared/          Shared types and contracts
packages/adapters/*       Runtime adapters (claude-local, codex-local, cursor-local, openclaw, opencode-local)
docs/                     Product, API, CLI, and architecture docs
doc/                      Development and asset docs
```

Architecture references:

- [Architecture](docs/start/architecture.md)
- [API Overview](docs/api/overview.md)
- [CLI Overview](docs/cli/overview.md)
- [Development Guide](doc/DEVELOPING.md)

<br/>

## Quickstart

### From source

```bash
git clone https://github.com/twpark-ops/squadrail.git
cd squadrail
pnpm install
pnpm squadrail run
```

This bootstraps a local instance if needed, runs diagnostics, and starts the server.

Default local address:

- `http://localhost:3100`

Requirements:

- Node.js 20+
- pnpm 9+

### Standard development mode

```bash
pnpm install
pnpm dev
```

This starts:

- API server at `http://localhost:3100`
- UI through the API server's dev middleware on the same origin

### Docker quickstart

```bash
docker build -t squadrail-local .
docker run --name squadrail \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e SQUADRAIL_HOME=/squadrail \
  -v "$(pwd)/data/docker-squadrail:/squadrail" \
  squadrail-local
```

Or with Compose:

```bash
docker compose -f docker-compose.quickstart.yml up --build
```

<br/>

## Supported working model

Squadrail is designed around software delivery, not generic chat orchestration.

Typical loop:

1. Create or import company, project, and issue context.
2. Seed role packs and configure agents.
3. Assign work through protocol messages.
4. Retrieve task-specific context from the knowledge system.
5. Execute through adapter-backed agents.
6. Review, approve, recover, or close through the control plane.

This makes Squadrail a better fit for delivery teams than for general-purpose personal assistant workflows.

<br/>

## Knowledge and review stack

The current retrieval and review model is broader than a simple "RAG + tasks" setup.

Knowledge side:

- hybrid dense + sparse retrieval
- graph-assisted chunk and document linking
- version-aware retrieval
- retrieval cache and incremental reindex
- role-specific personalization
- authority and source-type aware ranking

Review side:

- structured review handoff contracts
- diff and verification summaries
- rollback and residual risk capture
- merge-related review surfaces and protocol enforcement

Relevant docs:

- [docs/rag-current-architecture.md](docs/rag-current-architecture.md)
- [docs/b7-merge-automation.md](docs/b7-merge-automation.md)
- [docs/b8-version-aware-retrieval.md](docs/b8-version-aware-retrieval.md)
- [docs/b8-retrieval-cache-incremental-reindex.md](docs/b8-retrieval-cache-incremental-reindex.md)
- [docs/b8-role-specific-personalization.md](docs/b8-role-specific-personalization.md)
- [docs/b8-rag-graph-expansion.md](docs/b8-rag-graph-expansion.md)

<br/>

## Useful commands

```bash
pnpm dev                       # full-stack development
pnpm dev:server                # server only
pnpm dev:ui                    # UI only
pnpm build                     # build all workspaces
pnpm typecheck                 # typecheck all workspaces
pnpm test:run                  # run tests
pnpm squadrail run             # bootstrap + doctor + start
pnpm squadrail doctor          # diagnostics and repair hints
pnpm db:generate               # generate a migration
pnpm db:migrate                # apply migrations
pnpm smoke:local-ui-flow       # local browser smoke for the main UI flow
pnpm knowledge:rebuild-graph   # rebuild graph-oriented knowledge data
pnpm knowledge:rebuild-versions # rebuild document version state
```

<br/>

## Deployment modes

Squadrail supports three main deployment postures.

### Local trusted

- no authentication
- loopback binding only
- best for local development and solo testing

### Authenticated private

- authentication enabled
- private network exposure
- suitable for Tailscale or internal network access

### Authenticated public

- authentication enabled
- public hostname and public auth flow
- suitable for internet-facing self-hosted deployments

See [doc/DEVELOPING.md](doc/DEVELOPING.md) for environment details and bootstrap flow.

<br/>

## Documentation

- [Architecture](docs/start/architecture.md)
- [API Overview](docs/api/overview.md)
- [CLI Overview](docs/cli/overview.md)
- [Board Operator Guide](docs/guides/board-operator/dashboard.md)
- [Agent Developer Guide](docs/guides/agent-developer/how-agents-work.md)
- [Development Guide](doc/DEVELOPING.md)

<br/>

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

<br/>

## Community

- [GitHub Issues](https://github.com/twpark-ops/squadrail/issues)
- [GitHub Discussions](https://github.com/twpark-ops/squadrail/discussions)

<br/>

## License

MIT &copy; 2026 Squadrail

<br/>

---

<p align="center">
  <sub>Built for teams that want AI agents to deliver software with protocol, context, and accountability.</sub>
</p>
