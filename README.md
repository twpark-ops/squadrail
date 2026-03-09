<p align="center">
  <img src="doc/assets/header.svg" alt="Squadrail — AI Squads on Rails" width="720" />
</p>

<p align="center">
  <strong>Protocol-first orchestration for autonomous AI agent teams</strong>
</p>

<p align="center">
  <a href="https://github.com/twpark-ops/squadrail/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
  <a href="https://github.com/twpark-ops/squadrail/stargazers"><img src="https://img.shields.io/github/stars/twpark-ops/squadrail?style=flat" alt="Stars" /></a>
</p>

---

## What is Squadrail?

Squadrail is an open-source platform for orchestrating AI agent squads that execute software delivery tasks with structure and precision.

**Core capabilities:**
- 🎯 **Protocol-driven workflows** — State machines and typed messages instead of free-form chat
- 🤖 **Role-based agent teams** — Tech Lead, Engineer, Reviewer with clear responsibilities
- 📚 **RAG-powered context** — Hybrid retrieval with task briefs from your codebase
- 🔒 **Multi-tenant isolation** — PostgreSQL RLS for secure company data separation
- 📊 **Operational visibility** — Execution logs, approvals, budgets, live events

---

## Architecture

```
Issue Creation
    ↓
Protocol Message (ASSIGN_TASK)
    ↓
RAG Retrieval (semantic + keyword search)
    ↓
Task Brief Generation (context + evidence)
    ↓
Agent Execution (Claude Code / Codex)
    ↓
Review Cycle (Reviewer approval)
    ↓
Completion
```

**Key components:**
- **Express.js API** — REST endpoints with Zod validation
- **PostgreSQL + Drizzle ORM** — Type-safe database layer
- **React UI** — Dashboard for monitoring and control
- **WebSocket** — Real-time event streaming
- **Embedded PostgreSQL** — Zero-config local development

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

Open `http://localhost:3100` in your browser.

**Requirements:**
- Node.js 20+
- pnpm 9.15+

---

## Core Concepts

### Protocol Messages

Structured communication instead of unstructured chat:

```typescript
ASSIGN_TASK → ACK_ASSIGNMENT → PROPOSE_PLAN →
START_IMPLEMENTATION → SUBMIT_FOR_REVIEW →
START_REVIEW → APPROVE_IMPLEMENTATION → CLOSE_TASK
```

Each message triggers:
- State validation
- Role authorization
- RAG retrieval
- Evidence requirements
- Automated dispatch

### Agent Roles

- **Tech Lead** — Assigns work, resolves blockers, closes tasks
- **Engineer** — Implements features, submits for review
- **Reviewer** — Reviews code, approves or requests changes
- **QA** — Tests implementations, validates requirements
- **CTO/PM** — Strategic oversight, budget approval

### RAG System

**Hybrid retrieval pipeline:**
1. Dense search (vector embeddings via OpenAI)
2. Sparse search (PostgreSQL full-text search)
3. Fusion ranking (scores combined)
4. Reranking (signal-based boost: paths, symbols, tags)
5. Model reranking (optional LLM-based)
6. Task brief generation (markdown summary + evidence)

**Result:** Agents receive only relevant context, not entire codebase dumps.

---

## Key Features

### Multi-Tenancy
- Row-Level Security (RLS) for data isolation
- Company-scoped agents, issues, knowledge
- Embedded PostgreSQL for local dev

### Execution Control
- Concurrent execution limits per agent
- Queue management with automatic retry
- Timeout handling and orphan cleanup
- Execution logs and cost tracking

### Knowledge Management
- Document import from repositories
- Automatic chunking and embedding
- Version control for retrieval policies
- Authority levels (canonical, working, draft, deprecated)

### Governance
- Approval workflows for budget/agent changes
- Protocol violation tracking
- Evidence requirements for task completion
- Audit trail for all operations

---

## Development

```bash
# Development
pnpm dev              # Full stack (API + UI)
pnpm dev:server       # API only
pnpm dev:ui           # UI only

# Building
pnpm build            # Build all packages
pnpm typecheck        # Type checking

# Testing
pnpm test:run         # Run all tests

# Database
pnpm db:generate      # Generate migration
pnpm db:migrate       # Apply migrations

# Diagnostics
pnpm squadrail doctor # System checks
```

---

## Deployment Modes

### Local Trusted
```bash
# No authentication required
# Loopback binding only
SQUADRAIL_DEPLOYMENT_MODE=local_trusted
```

### Authenticated Private
```bash
# Better-auth authentication
# Internal network only
SQUADRAIL_DEPLOYMENT_MODE=authenticated
SQUADRAIL_DEPLOYMENT_EXPOSURE=private
BETTER_AUTH_SECRET=your-secret
```

### Authenticated Public
```bash
# Full authentication
# Internet-exposed
SQUADRAIL_DEPLOYMENT_MODE=authenticated
SQUADRAIL_DEPLOYMENT_EXPOSURE=public
SQUADRAIL_AUTH_PUBLIC_BASE_URL=https://your-domain.com
```

---

## Tech Stack

**Backend:**
- Express 5.1, TypeScript 5.7
- Drizzle ORM 0.38, PostgreSQL
- Better-auth 1.4 (authentication)
- ws 8.19 (WebSocket)

**Frontend:**
- React 19, TypeScript
- Tailwind CSS v4
- shadcn/ui, Radix UI
- Vite 6.1

**AI/ML:**
- Anthropic Claude SDK
- OpenAI (embeddings)
- LangChain (optional)

---

## Documentation

- [Architecture Overview](docs/start/architecture.md)
- [API Reference](docs/api/overview.md)
- [CLI Commands](docs/cli/overview.md)
- [Development Guide](doc/DEVELOPING.md)

---

## Community

- [GitHub Issues](https://github.com/twpark-ops/squadrail/issues) — Bug reports and feature requests
- [GitHub Discussions](https://github.com/twpark-ops/squadrail/discussions) — Questions and ideas
- [Discord]() — Community chat

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

MIT © 2026 Squadrail

---

<p align="center">
  <img src="doc/assets/footer.jpg" alt="" width="720" />
</p>

<p align="center">
  <sub>Built for teams that want AI agents to work like a real squad.</sub>
</p>
