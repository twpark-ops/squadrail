# Contributing to Squadrail

Thank you for your interest in contributing to Squadrail.

## Getting Started

```bash
git clone https://github.com/twpark-ops/squadrail.git
cd squadrail
pnpm install
pnpm dev
```

## Development Workflow

1. Create a feature branch from `master`.
2. Make your changes.
3. Validate before pushing:

```bash
pnpm typecheck      # type-check all workspaces
pnpm test:run       # run tests
pnpm build          # build all packages
```

## Pull Request Expectations

- Keep changes scoped and reviewable.
- Include tests for new behavior or regressions.
- Update docs when public behavior changes.
- Prefer protocol-first flows over ad-hoc comments or hidden side channels.
- Commit messages follow `<type>(<scope>): <subject>` convention.

## Project Structure

```text
cli/                  CLI for onboarding, diagnostics, and operations
server/               Express + TypeScript API, realtime, auth, services
ui/                   React + Vite control-plane UI
packages/db/          Drizzle schema and migrations
packages/shared/      Shared types and contracts
packages/adapters/*   Runtime adapters (claude-local, codex-local, etc.)
docs/                 Product, API, CLI, and architecture docs
doc/                  Development and asset docs
```

## Code Style

- TypeScript strict mode everywhere.
- Comments in English.
- Auto-format with project tooling (Prettier/ESLint where configured).
- Prefer explicit types over `any`.

## References

- [Development Guide](doc/DEVELOPING.md)
- [Architecture](docs/start/architecture.md)
- [API Overview](docs/api/overview.md)
- [CLI Overview](docs/cli/overview.md)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
