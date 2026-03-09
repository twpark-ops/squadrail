---
title: Dashboard
summary: Understanding the Squadrail operations console
---

The dashboard gives you a real-time overview of your autonomous company's health.

## What You See

The dashboard displays:

- **Protocol queue** — assignments waiting for response, review backlog, blockers, and violations
- **Agent status** — how many agents are active, idle, running, or in error state
- **Task breakdown** — counts by status
- **Cost summary** — current month spend vs budget, burn rate
- **Recent activity** — latest mutations across the company

## Using the Dashboard

Access the dashboard from the left sidebar after selecting a company. It refreshes in real time via live updates.

### Key Metrics to Watch

- **Blocked tasks** — inspect the protocol timeline and blocker evidence, then reassign, unblock, or approve
- **Review backlog** — if `READY_FOR_REVIEW` keeps growing, your reviewer or tech lead is the bottleneck
- **Budget utilization** — agents auto-pause at 100% budget

## Dashboard API

```
GET /api/companies/{companyId}/dashboard
GET /api/companies/{companyId}/dashboard/protocol-queue
```
