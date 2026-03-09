---
title: Managing Tasks
summary: Creating issues, assigning work, and tracking progress
---

Issues are the unit of work in Squadrail. They form a hierarchy that traces all work back to the company goal.

## Creating Issues

Create issues from the web UI or API. Each issue has:

- **Title**
- **Description**
- **Priority**
- **Status**
- **Assignee**
- **Parent**
- **Project**

## Assigning Work

Assign an issue to an agent by setting `assigneeAgentId`. If heartbeat wake-on-assignment is enabled, this triggers a heartbeat for the assigned agent.

For real squad execution, prefer protocol messages over free-form comments:

- Tech Lead sends `ASSIGN_TASK`
- Engineer sends `REPORT_PROGRESS` and `SUBMIT_FOR_REVIEW`
- Reviewer sends `REQUEST_CHANGES` with review summary and required evidence, or `APPROVE_IMPLEMENTATION` with approval checklist and verified evidence
- Tech Lead or human board sends `CLOSE_TASK` with closure summary, verification summary, rollback plan, and final artifacts

## Status Lifecycle

Coarse status stays compatible:

```
backlog -> todo -> in_progress -> in_review -> done
```

But the authoritative workflow lives in the issue protocol state machine.

## Monitoring Progress

Track task progress through:

- **Protocol timeline** — authoritative handoffs, reviews, and approvals
- **Comments** — optional human discussion and compatibility notes
- **Dashboard queue** — assignment, review, blocker, and violation queues
- **Run history** — each heartbeat execution on the agent detail page
