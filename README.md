<p align="center">
  <img src="doc/assets/header.svg" alt="Squadrail — protocol-first squad orchestration" width="720" />
</p>

<p align="center">
  <a href="#quickstart"><strong>Quickstart</strong></a> &middot;
  <a href="docs/"><strong>Docs</strong></a> &middot;
  <a href="https://github.com/twpark-ops/squadall"><strong>GitHub</strong></a> &middot;
  <a href=""><strong>Discord</strong></a>
</p>

<p align="center">
  <a href="https://github.com/twpark-ops/squadall/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
  <a href="https://github.com/twpark-ops/squadall/stargazers"><img src="https://img.shields.io/github/stars/twpark-ops/squadall?style=flat" alt="Stars" /></a>
  <a href=""><img src="https://img.shields.io/?label=discord" alt="Discord" /></a>
</p>

## What is Squadrail?

# Open-source orchestration for AI software squads

Squadrail is a Node.js server and React UI for running software-delivery squads made of AI agents. It provides:

- protocol-driven task handoff instead of free-form agent chatter
- role packs for Tech Lead, Engineer, Reviewer, and custom roles
- role-aware retrieval and task briefs for codebase/document context
- audit trails, governance, approvals, budgets, and live execution events
- Claude Code and Codex as the primary local execution engines

It looks like a dashboard, but the core is an orchestration kernel:

- org chart and ownership
- typed workflow state transitions
- execution routing
- retrieval and evidence gates
- review loops and escalation

## Why Squadrail exists

Most multi-agent setups fail because coordination degrades before model quality does. Squadrail focuses on:

- **deterministic workflow**: state machine, structured messages, review cycles
- **reliable execution**: explicit dispatch to Claude Code / Codex
- **context discipline**: task briefs and role-aware retrieval instead of dumping whole histories
- **operational visibility**: queue, blocker, evidence, violation, and cost projections

## Primary workflow

| Step | Action | Result |
| --- | --- | --- |
| 1 | Define the issue | Requirements and acceptance criteria become the protocol source of truth |
| 2 | Assign the work | Tech Lead hands off to Engineer with a typed message |
| 3 | Execute | Claude Code or Codex runs with Squadrail context and workspace hints |
| 4 | Review | Reviewer approves or requests changes with evidence |
| 5 | Close | Lead closes the issue only after review and evidence gates pass |

## Key features

- **Structured protocol messages**: `ASSIGN_TASK`, `SUBMIT_FOR_REVIEW`, `REQUEST_CHANGES`, `APPROVE_IMPLEMENTATION`, `CLOSE_TASK`
- **Role packs**: versioned markdown-based persona bundles for each role
- **Knowledge foundation**: workspace import, semantic chunking, hybrid retrieval, task briefs
- **Setup console**: doctor checks, setup progress, role pack seeding, workspace import
- **Ops console**: protocol queue, blocker queue, review backlog, live events
- **Squadrail-first runtime**: CLI, env vars, home paths, skills, and API headers use Squadrail names

## What Squadrail is not

- not a chatbot shell
- not a drag-and-drop workflow builder
- not a prompt textarea manager
- not a single-agent tool
- not a pull-request bot

## Quickstart

Open source. Self-hosted. No hosted Squadrail account required.

```bash
npx squadrail onboard --yes
```

Or from source:

```bash
git clone https://github.com/twpark-ops/squadall.git squadall
cd squadall
pnpm install
pnpm dev
```

This starts the API server at `http://localhost:3100`.

Requirements:

- Node.js 20+
- pnpm 9.15+

## Recommended local stack

- execution engines: Claude Code, Codex
- database:
  - embedded PostgreSQL for local bootstrap
  - external PostgreSQL for team or production deployments
- knowledge:
  - workspace import
  - hybrid retrieval
  - task briefs

## FAQ

**Which command and env names should I use?**  
Use `squadrail` and `SQUADRAIL_*` only.

**Does Squadrail require a hosted service?**  
No. Local embedded PostgreSQL mode still works for one-command bootstrap.

**Can I run multiple companies?**  
Yes. The control plane remains company-scoped with isolated state.

**Do I need all adapters?**  
No. The product surface is now optimized for Claude Code and Codex. Legacy adapters remain only for compatibility.

## Development

```bash
pnpm dev              # Full dev (API + UI)
pnpm dev:server       # Server only
pnpm dev:ui           # UI only
pnpm build            # Build all
pnpm typecheck        # Type checking
pnpm test:run         # Run tests
pnpm db:generate      # Generate DB migration
pnpm db:migrate       # Apply migrations
pnpm squadrail doctor # Environment / setup diagnostics
```

See [doc/DEVELOPING.md](doc/DEVELOPING.md) for the full development guide.

## Contributing

Contributions are welcome. See the [contributing guide](CONTRIBUTING.md) for details.

## Community

- [Discord]()
- [GitHub Issues](https://github.com/twpark-ops/squadall/issues)
- [GitHub Discussions](https://github.com/twpark-ops/squadall/discussions)

## License

MIT &copy; 2026 Squadrail

## Star History

[![Star History Chart](https://api.star-history.com/image?repos=twpark-ops/squadall&type=date&legend=top-left)](https://www.star-history.com/?repos=twpark-ops%2Fsquadall&type=date&legend=top-left)

<p align="center">
  <img src="doc/assets/footer.jpg" alt="" width="720" />
</p>

<p align="center">
  <sub>Open source under MIT. Built for teams that want agents to work like a real squad.</sub>
</p>
