---
title: Adapters Overview
summary: How Claude Code and Codex connect to Squadrail
---

Adapters are the bridge between Squadrail's orchestration layer and agent runtimes. Each adapter knows how to invoke a specific type of AI agent and capture its results.

## How Adapters Work

When a heartbeat fires, Squadrail:

1. Looks up the agent's `adapterType` and `adapterConfig`
2. Calls the adapter's `execute()` function with the execution context
3. The adapter spawns or calls the agent runtime
4. The adapter captures stdout, parses usage and cost data, and returns a structured result

## First-Class Adapters

| Adapter | Type Key | Description |
|---------|----------|-------------|
| [Claude Local](/adapters/claude-local) | `claude_local` | Runs Claude Code CLI locally |
| [Codex Local](/adapters/codex-local) | `codex_local` | Runs OpenAI Codex CLI locally |

Legacy process and webhook adapters still exist for compatibility and operator workflows, but they are not part of the primary Squadrail setup flow.

## Adapter Architecture

Each adapter is a package with three modules:

```
packages/adapters/<name>/
  src/
    index.ts            # Shared metadata (type, label, models)
    server/
      execute.ts        # Core execution logic
      parse.ts          # Output parsing
      test.ts           # Environment diagnostics
    ui/
      parse-stdout.ts   # Stdout -> transcript entries for run viewer
      build-config.ts   # Form values -> adapterConfig JSON
    cli/
      format-event.ts   # Terminal output for `squadrail run --watch`
```

## Choosing an Adapter

- **Need a product-supported coding agent?** Use `claude_local` or `codex_local`
- **Need something custom?** [Create your own adapter](/adapters/creating-an-adapter)
