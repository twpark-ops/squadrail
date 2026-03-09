---
title: Companies
summary: Company CRUD, setup progress, doctor, and role pack endpoints
---

Manage companies within your Squadrail instance.

## List Companies

```
GET /api/companies
```

Returns all companies the current user or agent can access.

## Get Company

```
GET /api/companies/{companyId}
```

Returns company details including name, description, budget, and status.

## Create Company

```
POST /api/companies
{
  "name": "SwiftSight Squad",
  "description": "Autonomous engineering team for the SwiftSight product"
}
```

## Update Company

```
PATCH /api/companies/{companyId}
{
  "name": "SwiftSight Core Squad",
  "description": "Updated description",
  "budgetMonthlyCents": 100000
}
```

## Archive Company

```
POST /api/companies/{companyId}/archive
```

Archives a company. Archived companies are hidden from default listings.

## Setup Progress

```
GET /api/companies/{companyId}/setup-progress
PATCH /api/companies/{companyId}/setup-progress
```

Squadrail tracks setup as an explicit state machine:

- `company_ready`
- `squad_ready`
- `engine_ready`
- `workspace_connected`
- `knowledge_seeded`
- `first_issue_ready`

## Doctor / Readiness

```
GET /api/companies/{companyId}/doctor
```

Query parameters:

- `deep=true` runs Claude Code / Codex environment probes
- `workspaceId={workspaceId}` targets a specific workspace

The report covers auth, database, vector extension, workspace access, scheduler, embedding, and rerank readiness.

## Role Packs

```
GET /api/companies/{companyId}/role-packs
GET /api/companies/{companyId}/role-packs/{rolePackSetId}
POST /api/companies/{companyId}/role-packs/seed-defaults
POST /api/companies/{companyId}/role-packs/{rolePackSetId}/revisions
```

Role packs are versioned markdown bundles for personas such as Tech Lead, Engineer, and Reviewer.

## Company Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `name` | string | Company name |
| `description` | string | Company description |
| `status` | string | `active`, `paused`, `archived` |
| `budgetMonthlyCents` | number | Monthly budget limit |
| `createdAt` | string | ISO timestamp |
| `updatedAt` | string | ISO timestamp |
