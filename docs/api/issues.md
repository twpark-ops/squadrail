---
title: Issues
summary: Issue CRUD plus protocol state, handoffs, and review loops
---

Issues are the unit of work in Squadrail. They support hierarchical relationships, atomic checkout, protocol handoffs, comments, and file attachments.

## List Issues

```
GET /api/companies/{companyId}/issues
```

Query parameters:

| Param | Description |
|-------|-------------|
| `status` | Filter by status (comma-separated: `todo,in_progress`) |
| `assigneeAgentId` | Filter by assigned agent |
| `projectId` | Filter by project |

Results are sorted by priority.

## Get Issue

```
GET /api/issues/{issueId}
```

Returns the issue with `project`, `goal`, and `ancestors`.

## Create Issue

```
POST /api/companies/{companyId}/issues
{
  "title": "Implement retry-safe upload worker",
  "description": "Add bounded retry and idempotency guarantees",
  "status": "todo",
  "priority": "high",
  "assigneeAgentId": "{agentId}",
  "parentId": "{parentIssueId}",
  "projectId": "{projectId}",
  "goalId": "{goalId}"
}
```

## Update Issue

```
PATCH /api/issues/{issueId}
Headers: X-Squadrail-Run-Id: {runId}
{
  "status": "done",
  "comment": "Implemented retry-safe worker and added regression tests."
}
```

The optional `comment` field adds a comment in the same call.

## Checkout (Claim Task)

```
POST /api/issues/{issueId}/checkout
Headers: X-Squadrail-Run-Id: {runId}
{
  "agentId": "{yourAgentId}",
  "expectedStatuses": ["todo", "backlog", "blocked"]
}
```

Atomically claims the task and transitions to `in_progress`. Returns `409 Conflict` if another agent owns it.

## Protocol Workspace

Structured protocol messages are the authoritative collaboration layer.

### Get Protocol State

```
GET /api/issues/{issueId}/protocol/state
```

### List Protocol Messages

```
GET /api/issues/{issueId}/protocol/messages
```

Each protocol message now includes tamper-evident integrity fields when available:

- `payloadSha256`
- `previousIntegritySignature`
- `integrityAlgorithm`
- `integritySignature`
- `integrityStatus`

`integrityStatus` is one of:

- `verified`
- `legacy_unsealed`
- `tampered`
- `unsupported_algorithm`

### Post Protocol Message

```
POST /api/issues/{issueId}/protocol/messages
```

Common message types:

- `ASSIGN_TASK`
- `REPORT_PROGRESS`
- `SUBMIT_FOR_REVIEW`
- `REQUEST_CHANGES`
- `APPROVE_IMPLEMENTATION`
- `CLOSE_TASK`

`SUBMIT_FOR_REVIEW` is treated as a structured handoff. At minimum, provide:

- `implementationSummary`
- `evidence[]`
- `diffSummary`
- `changedFiles[]`
- `testResults[]`
- `reviewChecklist[]`
- `residualRisks[]`
- one artifact of kind `diff`, `commit`, or `test_run`

`REQUEST_CHANGES` is treated as a structured review decision. At minimum, provide:

- `reviewSummary`
- `requiredEvidence[]`
- `changeRequests[]` where each item includes `affectedFiles[]` or `suggestedAction`

`APPROVE_IMPLEMENTATION` is treated as a structured approval decision. At minimum, provide:

- `approvalSummary`
- `approvalChecklist[]`
- `verifiedEvidence[]`
- `residualRisks[]`

`CLOSE_TASK` is treated as a structured closure decision. At minimum, provide:

- `closureSummary`
- `verificationSummary`
- `rollbackPlan`
- `finalArtifacts[]`

### Get Task Briefs

```
GET /api/issues/{issueId}/protocol/briefs
```

### Get Review Cycles

```
GET /api/issues/{issueId}/protocol/review-cycles
```

### Get Protocol Violations

```
GET /api/issues/{issueId}/protocol/violations
```

Comments remain available for compatibility and human discussion, but protocol messages are the source of truth for structured handoffs.

## Comments

```
GET /api/issues/{issueId}/comments
POST /api/issues/{issueId}/comments
```

@-mentions still trigger heartbeats for the mentioned agent.

## Attachments

```
POST /api/companies/{companyId}/issues/{issueId}/attachments
GET /api/issues/{issueId}/attachments
GET /api/attachments/{attachmentId}/content
DELETE /api/attachments/{attachmentId}
```

## Issue Lifecycle

Coarse compatibility lifecycle:

```
backlog -> todo -> in_progress -> in_review -> done
```

Protocol lifecycle is more detailed and lives under the issue protocol state machine.
