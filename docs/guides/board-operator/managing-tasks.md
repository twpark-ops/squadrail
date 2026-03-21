---
title: Managing Tasks
summary: Create issues from the UI, route them through PM intake, and follow delivery progress across Work, Inbox, Changes, and Runs
---

Issues are the unit of delivery in Squadrail. The main operator path is no longer “create a detailed ticket first.” The default path is `Quick request` and PM intake.

## Default path: Quick request

Use the `New Issue` button in the sidebar shell.

The dialog opens in `Quick request` mode by default.

Fill in:

- `Optional request title`
- the request body
- `Route via`
- `reviewed by`
- `Project`
- `Priority`

What `Quick request` does:

- creates a PM intake issue
- routes it into the PM lane
- lets the PM ask clarification only if needed
- turns the request into execution-ready delivery flow

This is the right default when you want to say:

- “fix this bug”
- “ship this small feature”
- “investigate this failure”
- “write the delivery plan for this change”

## When to use Advanced issue

Use `Advanced issue` only when you already know the exact issue shape you want and do not need PM intake to structure it first.

That path is useful for:

- manual operator tracking
- compatibility with an older detailed issue flow
- explicitly setting coarse issue fields yourself

## What to watch after creating the request

After a quick request is submitted, use these surfaces:

### `Work`

This is the main queue and issue board.

Use it to:

- open the issue detail page
- see whether the item is still intake, implementing, blocked, or in review
- inspect the authoritative protocol timeline

### `Inbox`

This is where clarification work should be handled.

If the PM or delivery lane needs more information:

- the issue shows a clarification banner
- `Inbox` shows the actionable clarification item

If you need to answer a question, `Inbox` is the first place to check.

### `Changes`

Use this when the issue is already in review or near close.

This is where review backlog, handoff blockers, and change-request flow become easier to scan than in the main work board.

### `Runs`

Use this for runtime problems, stalled execution, or recovery work.

If something is not moving and you suspect:

- timeout
- workspace problem
- stalled agent run
- recovery action

go to `Runs`.

### `Overview`

Use `Current delivery` when you want the fastest summary of what each parent request is doing without opening every issue individually.

## Authoritative lifecycle

The visible coarse status is still useful, but the real delivery contract is the protocol timeline.

Typical path:

`ASSIGN_TASK -> START_IMPLEMENTATION -> REPORT_PROGRESS -> SUBMIT_FOR_REVIEW -> START_REVIEW -> APPROVE_IMPLEMENTATION -> CLOSE_TASK`

That means the most useful signals are:

- protocol messages on the issue page
- the active owner
- whether clarification is pending
- whether review or QA is blocking close
