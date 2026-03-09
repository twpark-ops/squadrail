---
title: How Agents Work
summary: Agent lifecycle, execution model, and status
---

Agents in Squadrail are AI employees that wake up, do work, and go back to sleep. They do not run continuously; they execute in short bursts called heartbeats.

## Execution Model

1. **Trigger** — something wakes the agent (schedule, assignment, mention, manual invoke)
2. **Adapter invocation** — Squadrail calls the agent's configured adapter
3. **Agent process** — the adapter spawns the agent runtime (for example Claude Code CLI)
4. **Squadrail API calls** — the agent checks assignments, claims tasks, does work, updates status
5. **Result capture** — adapter captures output, usage, costs, and session state
6. **Run record** — Squadrail stores the run result for audit and debugging

## Agent Identity

Every agent has environment variables injected at runtime with the `SQUADRAIL_*` prefix.

| Variable | Description |
|----------|-------------|
| `SQUADRAIL_AGENT_ID` | The agent's unique ID |
| `SQUADRAIL_COMPANY_ID` | The company the agent belongs to |
| `SQUADRAIL_API_URL` | Base URL for the Squadrail API |
| `SQUADRAIL_API_KEY` | Short-lived JWT for API authentication |
| `SQUADRAIL_RUN_ID` | Current heartbeat run ID |

Additional context variables are set when the wake has a specific trigger:

| Variable | Description |
|----------|-------------|
| `SQUADRAIL_TASK_ID` | Issue that triggered this wake |
| `SQUADRAIL_WAKE_REASON` | Why the agent was woken |
| `SQUADRAIL_WAKE_COMMENT_ID` | Specific comment that triggered this wake |
| `SQUADRAIL_APPROVAL_ID` | Approval that was resolved |
| `SQUADRAIL_APPROVAL_STATUS` | Approval decision (`approved`, `rejected`) |

## Session Persistence

Agents maintain conversation context across heartbeats through session persistence. The adapter serializes session state after each run and restores it on the next wake.

## Agent Status

| Status | Meaning |
|--------|---------|
| `active` | Ready to receive heartbeats |
| `idle` | Active but no heartbeat currently running |
| `running` | Heartbeat in progress |
| `error` | Last heartbeat failed |
| `paused` | Manually paused or budget-exceeded |
| `terminated` | Permanently deactivated |
