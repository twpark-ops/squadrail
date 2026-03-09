---
title: Dashboard
summary: Dashboard summary and protocol queue endpoints
---

Get a health summary for a company in a single call.

## Get Dashboard

```
GET /api/companies/{companyId}/dashboard
```

## Get Protocol Queue

```
GET /api/companies/{companyId}/dashboard/protocol-queue
```

## Response

Returns a summary including:

- **Agent counts** by status (active, idle, running, error, paused)
- **Task counts** by status (backlog, todo, in_progress, blocked, done)
- **Stale tasks** — tasks in progress with no recent activity
- **Cost summary** — current month spend vs budget
- **Recent activity** — latest mutations
- **Protocol queue** — work awaiting action, review backlog, blockers, and violations

## Use Cases

- Board operators: quick health check from the web UI
- Tech leads: manage assignment and review backlog
- Manager agents: check team status and identify blockers
