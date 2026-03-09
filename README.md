<p align="center">
  <img src="doc/assets/header.svg" alt="Squadrail" width="720" />
</p>

<p align="center">
  <strong>Protocol-first orchestration for autonomous AI agent teams</strong>
</p>

<p align="center">
  <a href="https://github.com/twpark-ops/squadrail/blob/master/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" />
  </a>
  <a href="https://github.com/twpark-ops/squadrail/stargazers">
    <img src="https://img.shields.io/github/stars/twpark-ops/squadrail?style=flat" alt="Stars" />
  </a>
</p>

---

## Overview

Squadrail orchestrates AI agent squads that execute software delivery tasks with structure and precision. Built on protocol-driven workflows, role-based teams, and RAG-powered context retrieval.

**Core capabilities**

- Protocol-driven workflows with state machines and typed messages
- Role-based agent teams (Tech Lead, Engineer, Reviewer, QA)
- RAG-powered context with hybrid retrieval and task briefs
- Multi-tenant isolation using PostgreSQL Row-Level Security
- Real-time execution monitoring with WebSocket events

---

## Quick Start

### One-command setup

```bash
npx squadrail onboard --yes
```

### From source

```bash
git clone https://github.com/twpark-ops/squadrail.git
cd squadrail
pnpm install
pnpm dev
```

Open `http://localhost:3100`

**Requirements:** Node.js 20+, pnpm 9.15+

---

## How It Works

```
Issue Creation
    ↓
ASSIGN_TASK (protocol message)
    ↓
RAG Retrieval (semantic + keyword)
    ↓
Task Brief Generation
    ↓
Agent Execution (Claude Code / Codex)
    ↓
SUBMIT_FOR_REVIEW
    ↓
Reviewer Approval
    ↓
CLOSE_TASK
```

Each protocol message triggers:
- State validation
- Role authorization
- Context retrieval
- Evidence requirements
- Automated dispatch

`SUBMIT_FOR_REVIEW` now uses a structured handoff contract. Review submission should include:
- implementation summary
- diff summary
- changed files
- test results
- review checklist
- residual risks
- at least one `diff`, `commit`, or `test_run` artifact

---

## Protocol Messages

Structured communication replaces unstructured chat:

```typescript
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

---

## Agent Roles

**Tech Lead** — Task assignment, blocker resolution, completion
**Engineer** — Implementation, testing, review submission
**Reviewer** — Code review, approval, change requests
**QA** — Quality validation, test execution
**CTO/PM** — Strategic oversight, budget approval

---

## RAG System

**Hybrid retrieval pipeline:**

1. Dense search (vector embeddings via OpenAI)
2. Sparse search (PostgreSQL full-text)
3. Fusion ranking
4. Signal-based reranking (paths, symbols, tags)
5. Optional LLM reranking
6. Task brief generation

**Result:** Agents receive relevant context, not entire codebases.

---

## Architecture

**Backend**
- Express 5.1, TypeScript 5.7
- Drizzle ORM 0.38, PostgreSQL
- Better-auth 1.4
- WebSocket (ws 8.19)

**Frontend**
- React 19, TypeScript
- Tailwind CSS v4
- shadcn/ui, Radix UI
- Vite 6.1

**AI/ML**
- Anthropic Claude SDK
- OpenAI embeddings
- LangChain (optional)

---

## Key Features

**Multi-Tenancy**
Row-Level Security for data isolation, company-scoped resources, embedded PostgreSQL for local development

**Execution Control**
Concurrent limits per agent, queue management, timeout handling, execution logs, cost tracking

**Knowledge Management**
Repository import, automatic chunking and embedding, retrieval policy versioning, authority levels

**Governance**
Approval workflows, protocol violation tracking, evidence requirements, complete audit trails

---

## Development

```bash
pnpm dev              # Full stack (API + UI)
pnpm dev:server       # API only
pnpm dev:ui           # UI only
pnpm build            # Build all packages
pnpm typecheck        # Type checking
pnpm test:run         # Run tests
pnpm db:generate      # Generate migration
pnpm db:migrate       # Apply migrations
pnpm squadrail doctor # System diagnostics
```

---

## Deployment

### Local Trusted

```bash
SQUADRAIL_DEPLOYMENT_MODE=local_trusted
```

No authentication, loopback binding only.

### Authenticated Private

```bash
SQUADRAIL_DEPLOYMENT_MODE=authenticated
SQUADRAIL_DEPLOYMENT_EXPOSURE=private
BETTER_AUTH_SECRET=your-secret
```

Better-auth authentication, internal network only.

### Authenticated Public

```bash
SQUADRAIL_DEPLOYMENT_MODE=authenticated
SQUADRAIL_DEPLOYMENT_EXPOSURE=public
SQUADRAIL_AUTH_PUBLIC_BASE_URL=https://your-domain.com
```

Full authentication, internet-exposed.

---

## Documentation

- [Architecture](docs/start/architecture.md)
- [API Reference](docs/api/overview.md)
- [CLI Commands](docs/cli/overview.md)
- [Development Guide](doc/DEVELOPING.md)

---

## Community

- [GitHub Issues](https://github.com/twpark-ops/squadrail/issues)
- [GitHub Discussions](https://github.com/twpark-ops/squadrail/discussions)

---

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

MIT © 2026 Squadrail

---

<p align="center">
  <sub>Built for teams that want AI agents to work like a real squad.</sub>
</p>
