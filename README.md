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
  <a href="https://github.com/twpark-ops/squadrail/blob/master/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" />
  </a>
  <a href="https://github.com/twpark-ops/squadrail/stargazers">
    <img src="https://img.shields.io/github/stars/twpark-ops/squadrail?style=flat" alt="Stars" />
  </a>
</p>

<br/>

## What is Squadrail?

# Open-source orchestration for autonomous software delivery squads

Squadrail is a protocol-first control plane for AI agent teams working on real software delivery.

It combines:

- issue-driven execution
- typed protocol messages and state transitions
- role-based agent coordination
- graph-assisted, temporal, role-aware retrieval
- review and approval workflows
- runtime monitoring and recovery

The result is a system that feels less like "a pile of agent terminals" and more like an operating rail for engineering teams.

> **Inspiration**
> Squadrail started from the product framing introduced by **Paperclip**. Paperclip treats AI systems as something closer to a company than a chatbot, and Squadrail takes that same core idea into software delivery: if Paperclip is company-shaped orchestration, Squadrail is the delivery rail for protocol-governed engineering work.

<br/>

## Squadrail is right for you if

- You want AI agents to work through a defined delivery protocol instead of ad-hoc chat.
- You need engineers, reviewers, QA, and leads to have distinct roles and handoff rules.
- You want retrieval-backed task context without dumping an entire codebase into every prompt.
- You need auditability for approvals, protocol violations, runtime recovery, and task closure.
- You want one deployment to host multiple companies or teams with strict isolation.
- You are already using tools like Claude Code, Codex, Cursor, OpenClaw, or local adapters and need an orchestration layer above them.

<br/>

## Problems Squadrail solves

| Without Squadrail | With Squadrail |
| --- | --- |
| Agents receive vague tasks and improvise their own workflow. | Delivery is driven by explicit protocol messages, required evidence, and valid state transitions. |
| Review handoffs are inconsistent and missing critical context. | Review submission is structured around implementation summary, diff summary, tests, checklist, and residual risk. |
| Every agent session must be manually re-explained after a restart. | Task briefs, protocol history, runtime state, and retrieval context stay attached to the work. |
| "Knowledge" means pasting large code dumps into prompts. | Retrieval is hybrid, graph-assisted, version-aware, and role-aware. |
| Runtime failures are hidden inside terminal windows. | Runs, recovery queues, and live squad activity are surfaced in one control plane. |
| Multi-tenant delivery work becomes a data-isolation risk. | PostgreSQL Row-Level Security keeps company data scoped and isolated. |

<br/>

## Core capabilities

<table>
<tr>
<td align="center" width="33%">
<h3>Protocol-first execution</h3>
Issues move through typed messages, validated states, role authorization, and evidence-aware transitions.
</td>
<td align="center" width="33%">
<h3>Delivery-specific org model</h3>
Leads, engineers, reviewers, QA, and board actors each have distinct responsibilities and workflow powers.
</td>
<td align="center" width="33%">
<h3>Knowledge that follows the task</h3>
Hybrid retrieval generates focused task context instead of broad repository dumps.
</td>
</tr>
<tr>
<td align="center">
<h3>Runtime observability</h3>
Track live runs, queue state, heartbeats, recovery actions, and agent activity from one UI.
</td>
<td align="center">
<h3>Multi-company isolation</h3>
Run many companies or squads on one deployment with company-scoped resources and RLS enforcement.
</td>
<td align="center">
<h3>Audit and governance</h3>
Approvals, violations, recovery actions, reviews, and closures remain inspectable and reproducible.
</td>
</tr>
</table>

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

## Why Squadrail is technically distinct

- **Protocol over chat.** Work is driven by typed messages and explicit transitions, not loosely-scoped conversation history.
- **Review handoff is structured.** `SUBMIT_FOR_REVIEW` expects implementation summary, diff summary, changed files, test results, checklist, residual risk, and review artifacts.
- **Retrieval is not just vector search.** The current stack is graph-assisted, temporal, and role-aware, with document versioning, retrieval cache, incremental reindex, and explainable personalization. See [docs/rag-current-architecture.md](docs/rag-current-architecture.md).
- **Knowledge stays attached to delivery.** Retrieval is grounded in issues, projects, runs, and evolving repository knowledge instead of being a detached chatbot layer.
- **Local-first development is practical.** Embedded PostgreSQL is auto-managed in development, and the CLI can bootstrap and diagnose a local instance quickly.
- **Adapters are pluggable.** The repository already includes adapters for Claude local, Codex local, Cursor local, OpenClaw, and OpenCode local.

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
