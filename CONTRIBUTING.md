# Contributing

## Development Workflow

1. Install dependencies.
2. Run the local development stack.
3. Validate typecheck, tests, and UI build before opening a change.

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test:run
pnpm build
```

## Pull Request Expectations

- Keep changes scoped and reviewable.
- Include tests for new behavior or regressions.
- Update docs when public behavior changes.
- Prefer protocol-first flows over ad-hoc comments or hidden side channels.

## References

- Development guide: [doc/DEVELOPING.md](doc/DEVELOPING.md)
- Architecture overview: [docs/start/architecture.md](docs/start/architecture.md)
- API overview: [docs/api/overview.md](docs/api/overview.md)
