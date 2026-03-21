---
title: Quickstart
summary: Install Squadrail, boot the local control plane, and run the first protocol workflow
---

Use this page as the single install and first-run path.

## 1. Prerequisites

- Node.js 20+
- pnpm 9+
- Claude Code or Codex available on the local machine
- Google Chrome if you want to run the browser smoke harness

## 2. Install

```sh
pnpm install
```

## 3. Bootstrap Local Config

Recommended local bootstrap:

```sh
pnpm squadrail onboard --yes
```

This creates a local `~/.squadrail` instance, generates the agent JWT secret, provisions the embedded PostgreSQL directories, and writes the default config.

## 4. Start Squadrail

```sh
pnpm squadrail run
```

This runs doctor checks, repairs missing local defaults where possible, and starts the API server plus UI.

Default local URL:

```txt
http://127.0.0.1:3100
```

## 5. Complete The First-Run Flow

Inside the web UI:

1. Click `Add company` if the onboarding flow did not open automatically
2. Complete `Tell us about your setup`
3. Complete `Create the operating company`
4. Complete `Select the starting team blueprint`
5. Complete `Connect the primary execution workspace`
6. Click `Test now` on the adapter environment check
7. Complete `Launch the first quick request`
8. Click `Create Quick Request`

The first-run UI path is intentionally opinionated:

- do not hand-create the first squad member-by-member
- do not start with `Advanced issue`
- start from blueprint + primary workspace + `Quick request`

After the quick request is submitted:

- Squadrail routes you to the onboarding issue in `Work`
- `Inbox` becomes the place to answer clarification
- `Overview > Current delivery` becomes the fastest high-level progress view
- `Resume Setup` stays visible until the company clears:
  - team blueprint applied
  - workspace connected
  - knowledge seeded
  - first quick request submitted
  - PM structuring complete
  - first delivery closed

## 6. Doctor And Runtime Hardening

The Company Settings page shows the operational checks that must be green before real execution:

- auth readiness
- database connection
- protocol integrity sealing
- engine environment probes
- workspace access
- retrieval and reranking readiness
- timeout and backfill worker state

For a deeper probe:

```sh
pnpm squadrail doctor
```

## 7. Local Development

If you are actively changing code:

```sh
pnpm dev
```

This starts the API server and UI at [http://localhost:3100](http://localhost:3100).

No external database is required for local development. Squadrail uses embedded PostgreSQL by default.

## 8. Automated Browser Smoke

Run the end-to-end local smoke harness for settings and issue protocol surfaces:

```sh
pnpm smoke:local-ui-flow
```

The smoke harness:

- starts a temporary local Squadrail server
- creates a company and seeds role packs
- opens the settings page and issue page in headless Chrome
- verifies `Role Studio`, `Side-by-side diff`, `Protocol Action Console`, and `Escalations & Recovery`
- saves a screenshot under `/tmp` by default

<Card title="Core Concepts" href="/start/core-concepts">
  Learn the key concepts behind Squadrail
</Card>
