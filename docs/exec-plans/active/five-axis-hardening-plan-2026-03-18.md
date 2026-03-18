---
title: "Five-Axis Hardening Plan"
author: "Taewoong Park (park.taewoong@airsmed.com)"
date: "2026-03-18"
lang: "en"
mainfont: "Noto Sans"
---

# Overview

This batch hardens five cross-cutting product gaps that currently weaken Squadrail's issue-centric delivery model:

1. project/subtask consistency
2. knowledge metric accuracy
3. IssueDetail query weight
4. canonical full-delivery E2E realism
5. protocol-aware notifications

# Goals

- Keep project surfaces aligned with visible subtasks.
- Make retrieval quality metrics semantically correct.
- Reduce IssueDetail first-load cost without changing user-visible functionality.
- Turn the canonical full-delivery E2E into a true product-loop check:
  onboarding-like setup -> quick request -> PM intake -> projection -> implementation -> review -> close.
- Promote protocol events to first-class user notifications.

# Design Decisions

## 1. Project/Subtask Consistency

- `ProjectDetail` must request `includeSubtasks: true`.
- Project pages should match `Work` and parent/subtask progress semantics.

## 2. Knowledge Metric Accuracy

- `feedbackCoverageRate` must represent runs with at least one explicit feedback event divided by total runs.
- `profileAppliedRunRate` must be exposed separately from feedback.
- UI labels must distinguish human feedback from personalization/profile usage.

## 3. IssueDetail Performance

- Keep always-on queries only for data rendered above the fold or outside detail tabs.
- Lazy-load tab-only queries:
  - comments
  - activity
  - deliverables
  - documents
  - document revisions / active document
- Preserve current tab UX; use tab gating instead of structural rewrites.

## 4. Canonical Full E2E

- The canonical full-delivery E2E must no longer inject a delivery issue directly.
- It must create a company/project/workspace fixture, then:
  - submit a PM intake issue
  - preview/apply PM projection
  - follow the projected delivery issue through review and closure
- Input request must remain issue-centric, not protocol-message-centric.

## 5. Protocol Notifications

- Live activity toasts must recognize protocol and merge/deploy events, not just generic issue updates.
- Relevant issue-scoped queries must be invalidated when protocol events land:
  - change surface
  - deliverables
  - documents
- Clarification, merge, deploy, and timeout signals should produce direct user-facing toasts.

# Scope

## In Scope

- `ProjectDetail`
- `Knowledge` server/UI summary
- `IssueDetail` tab query gating
- `full-delivery.mjs`
- `LiveUpdatesProvider`
- focused tests, typecheck, smoke, canonical E2E

## Out of Scope

- new backend artifact schemas
- new notification center page
- full IssueDetail component split
- full Overview redesign

# Test Plan

1. Server tests
   - knowledge quality summary route/service
   - full-delivery scenario support tests if present
2. UI validation
   - `@squadrail/ui typecheck`
   - `@squadrail/ui build`
   - support smoke
   - full smoke
3. Canonical system validation
   - `scripts/e2e/full-delivery.mjs`
4. Diff hygiene
   - `git diff --check`

# Risks

- **MEDIUM**: lazy-loading tab counts may no longer be available before tab activation.
- **MEDIUM**: full-delivery E2E can become slower because it now exercises PM intake/projection.
- **LOW**: protocol toast copy may require tuning after real usage.

# Recommendation

Implement all five axes in one batch, but keep the refactor shallow:

- fix semantics
- gate expensive queries
- strengthen event invalidation and toast mapping
- align the canonical E2E with the actual product story
