---
title: Creating a Company
summary: Create the first company, connect the primary workspace, and launch the first quick request from the web UI
---

A company is the top-level operating boundary in Squadrail. Agents, projects, issues, budgets, and knowledge all live under a company.

## Where to start

Use one of these entry points:

- If you do not have any company yet, Squadrail opens the setup flow automatically.
- If you already have companies, use the left rail `Add company` button.
- If setup was interrupted, use the amber `Resume Setup` banner or go to `Settings`.

## Step 1: Profile

The first screen is `Tell us about your setup`.

Answer the four profile questions:

- `What are you building?`
- `How will you deploy?`
- `How much autonomy for agents?`
- `Preferred runtime engine?`

This step only drives recommendations. It does not lock anything in.

## Step 2: Company setup

The next screen is `Create the operating company`.

Fill in:

- `Company name`
- `Operating goal` (optional)

You do not need to create goals, budgets, or individual agents by hand before continuing.

## Step 3: Team blueprint

The next screen is `Select the starting team blueprint`.

What to do:

1. Pick the starting team shape.
2. Click `Preview blueprint`.
3. Review the diff.
4. Apply it.

This is the step that gives the company its initial PM/TL/engineer/reviewer/QA structure.

## Step 4: Workspace connection

The next screen is `Connect the primary execution workspace`.

What to fill:

1. `Execution engine`
  - Usually `Claude Code` or `Codex`
2. `Model`
  - Optional override
3. `Project`
4. `Workspace target`
  - use an existing workspace, or
  - choose `Create a new workspace`
5. If creating a new workspace:
  - `Workspace name`
  - `Working directory`
  - `Repository URL` if useful

Before continuing, click `Test now`.

That probe is the practical gate for first-run readiness. If it fails, fix the workspace path or engine environment here before moving on.

## Step 5: First quick request

The last setup screen is `Launch the first quick request`.

Fill in:

- `Optional title`
- `Request`
- `Priority`

The request should describe:

- the goal
- why it matters
- any obvious constraints

Keep it short. PM structuring and clarification will refine it later.

Click `Create Quick Request`.

## What happens next

After `Create Quick Request`:

1. Squadrail creates a PM intake issue.
2. The UI takes you directly to the new issue in `Work`.
3. The issue becomes the onboarding issue for first-success guidance.

From there:

- Watch the issue page for protocol progress.
- If clarification is needed, answer it in `Inbox`.
- If you return to `Overview`, `Current delivery` is the fastest summary of where the request is.

## When setup is considered complete

The layout banner tracks these checkpoints:

- `Company created`
- `Team blueprint applied`
- `Execution engine configured`
- `Primary workspace connected`
- `Knowledge base seeded`
- `First quick request submitted`
- `PM structuring complete`
- `First delivery closed`

If any item is still open, use `Resume Setup` or `Settings` to continue from the exact missing step.
