import { describe, expect, it } from "vitest";
import type { CreateIssueProtocolMessage } from "@squadrail/shared";
import {
  buildRetrievalQueryText,
  deriveBriefScope,
  deriveDynamicRetrievalSignals,
  deriveRetrievalEventType,
  selectProtocolRetrievalRecipients,
} from "../services/retrieval/query.js";

function buildMessage(message: CreateIssueProtocolMessage) {
  return message;
}

describe("retrieval query helpers", () => {
  it("derives brief scope from event type and recipient role", () => {
    expect(deriveBriefScope({ eventType: "on_close", recipientRole: "engineer" })).toBe("closure");
    expect(deriveBriefScope({ eventType: "on_assignment", recipientRole: "human_board" })).toBe("global");
    expect(deriveBriefScope({ eventType: "on_progress_report", recipientRole: "qa" })).toBe("qa");
    expect(deriveBriefScope({ eventType: "on_review_submit", recipientRole: "reviewer" })).toBe("reviewer");
    expect(deriveBriefScope({ eventType: "on_progress_report", recipientRole: "engineer" })).toBe("engineer");
  });

  it("filters and deduplicates recipients for assignment retrieval", () => {
    const recipients = selectProtocolRetrievalRecipients({
      messageType: "ASSIGN_TASK",
      recipients: [
        { recipientType: "agent", recipientId: "eng-1", role: "engineer" },
        { recipientType: "agent", recipientId: "eng-1", role: "engineer" },
        { recipientType: "agent", recipientId: "lead-1", role: "tech_lead" },
        { recipientType: "agent", recipientId: "review-1", role: "reviewer" },
        { recipientType: "user", recipientId: "board-1", role: "human_board" },
      ],
    });

    expect(recipients).toEqual([
      { recipientType: "agent", recipientId: "eng-1", role: "engineer" },
      { recipientType: "agent", recipientId: "lead-1", role: "tech_lead" },
    ]);
  });

  it("builds query text within the length budget while preserving key signals", () => {
    const query = buildRetrievalQueryText({
      issue: {
        identifier: "OPS-144",
        title: "Stabilize multi-tenant retry worker",
        description: "Retry worker must isolate company scope and prevent duplicate lease recovery.".repeat(20),
        labels: [{ name: "backend" }, { name: "reliability" }],
        mentionedProjects: [{ id: "project-1", name: "control-plane" }],
      },
      recipientRole: "engineer",
      message: buildMessage({
        messageType: "ASSIGN_TASK",
        sender: {
          actorType: "user",
          actorId: "board-1",
          role: "human_board",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "eng-1",
            role: "engineer",
          },
        ],
        workflowStateBefore: "backlog",
        workflowStateAfter: "assigned",
        summary: "Implement retry safety and restore idempotency",
        payload: {
          goal: "Prevent duplicate recovery",
          acceptanceCriteria: ["idempotency", "lease safety", "backoff telemetry"],
          definitionOfDone: ["tests added", "docs updated"],
          priority: "high",
          assigneeAgentId: "00000000-0000-0000-0000-000000000001",
          reviewerAgentId: "00000000-0000-0000-0000-000000000002",
          requiredKnowledgeTags: ["retry", "lease", "tenant"],
        },
        artifacts: [],
      }),
    });

    expect(query.length).toBeLessThanOrEqual(2400);
    expect(query).toContain("OPS-144");
    expect(query).toContain("Stabilize multi-tenant retry worker");
    expect(query).toContain("backend");
    expect(query).toContain("control-plane");
    expect(query).toContain("Prevent duplicate recovery");
  });

  it("derives dynamic signals for review flows with path, tag, and source hints", () => {
    const message = buildMessage({
      messageType: "REQUEST_CHANGES",
      sender: {
        actorType: "agent",
        actorId: "reviewer-1",
        role: "reviewer",
      },
      recipients: [
        {
          recipientType: "agent",
          recipientId: "eng-1",
          role: "engineer",
        },
      ],
      workflowStateBefore: "submitted_for_review",
      workflowStateAfter: "changes_requested",
      summary: "Patch retry flow in server/src/jobs/retry_worker.ts and refresh docs/runbooks/recovery.md",
      payload: {
        reviewSummary: "Retry loop still breaks in server/src/jobs/retry_worker.ts when lease is stale",
        changeRequests: [
          {
            title: "Fix runtime guard",
            reason: "Protect duplicate processing",
            affectedFiles: ["./server/src/jobs/retry_worker.ts", "server/src/jobs/retry_worker.test.ts"],
            suggestedAction: "Touch RetryWorkerGuard symbol",
          },
        ],
        severity: "high",
        mustFixBeforeApprove: true,
        requiredEvidence: ["RetryWorkerGuard", "tenant lease", "operator playbook"],
      },
      artifacts: [],
    });

    const signals = deriveDynamicRetrievalSignals({
      message,
      issue: {
        projectId: "project-1",
        title: "Retry worker regression",
        description: "See docs/runbooks/recovery.md for the recovery checklist.",
        mentionedProjects: [{ id: "project-2", name: "runtime-core" }],
      },
      recipientRole: "reviewer",
      eventType: "on_change_request",
      baselineSourceTypes: ["protocol_message"],
    });

    expect(signals.exactPaths).toEqual(expect.arrayContaining([
      "server/src/jobs/retry_worker.ts",
      "server/src/jobs/retry_worker.test.ts",
      "docs/runbooks/recovery.md",
    ]));
    expect(signals.fileNames).toEqual(expect.arrayContaining(["retry_worker.ts", "retry_worker.test.ts", "recovery.md"]));
    expect(signals.knowledgeTags).toEqual(expect.arrayContaining(["RetryWorkerGuard", "tenant lease", "operator playbook"]));
    expect(signals.symbolHints).toEqual(expect.arrayContaining(["RetryWorkerGuard", "retry_worker", "recovery"]));
    expect(signals.preferredSourceTypes).toEqual(expect.arrayContaining([
      "code",
      "code_summary",
      "symbol_summary",
      "test_report",
      "review",
    ]));
    expect(signals.preferredSourceTypes).toContain("protocol_message");
    expect(signals.projectAffinityIds).toEqual(["project-1", "project-2"]);
    expect(signals.projectAffinityNames).toEqual(["runtime-core"]);
  });

  it("splits hyphenated knowledge tags into retrieval-friendly semantic tokens", () => {
    const message = buildMessage({
      messageType: "ASSIGN_TASK",
      sender: {
        actorType: "agent",
        actorId: "pm-1",
        role: "pm",
      },
      recipients: [
        {
          recipientType: "agent",
          recipientId: "lead-1",
          role: "tech_lead",
        },
      ],
      workflowStateBefore: "todo",
      workflowStateAfter: "assigned",
      summary: "Route Siemens series_name persistence issue",
      payload: {
        goal: "Fix Siemens persistence mismatch",
        requiredKnowledgeTags: ["dicom-metadata", "series-name"],
      },
      artifacts: [],
    });

    const signals = deriveDynamicRetrievalSignals({
      message,
      issue: {
        projectId: "project-1",
        title: "Siemens series_name persistence issue",
        description: null,
        mentionedProjects: [],
      },
      recipientRole: "tech_lead",
      eventType: "on_assignment",
    });

    expect(signals.knowledgeTags).toEqual(expect.arrayContaining([
      "dicom-metadata",
      "series-name",
      "dicom",
      "metadata",
      "series",
      "name",
    ]));
    expect(signals.lexicalTerms).toEqual(expect.arrayContaining([
      "dicom metadata",
      "dicom",
      "series name",
      "series",
      "name",
    ]));
  });

  it("extracts lexical symptom terms from mixed Korean and English issue content", () => {
    const message = buildMessage({
      messageType: "ASSIGN_TASK",
      sender: {
        actorType: "agent",
        actorId: "pm-1",
        role: "pm",
      },
      recipients: [
        {
          recipientType: "agent",
          recipientId: "lead-1",
          role: "tech_lead",
        },
      ],
      workflowStateBefore: "todo",
      workflowStateAfter: "assigned",
      summary: "Siemens vendor DICOM의 series_name이 ProtocolName 대신 SeriesDescription 값으로 저장되는 문제 조사",
      payload: {
        goal: "Find why Siemens DICOM series_name persists SeriesDescription instead of ProtocolName",
        requiredKnowledgeTags: ["ProtocolName", "SeriesDescription", "series_name"],
      },
      artifacts: [],
    });

    const signals = deriveDynamicRetrievalSignals({
      message,
      issue: {
        projectId: null,
        title: "Siemens series_name 저장 이상",
        description: "series_name field stores SeriesDescription(0008,103E) instead of ProtocolName(0018,1030)",
        mentionedProjects: [],
      },
      recipientRole: "tech_lead",
      eventType: "on_assignment",
    });

    expect(signals.lexicalTerms).toEqual(expect.arrayContaining([
      "siemens",
      "dicom",
      "series name",
      "series",
      "protocolname",
      "protocol name",
      "seriesdescription",
      "series description",
    ]));
  });

  it("carries canonical related issue fields into dynamic signals", () => {
    const message = buildMessage({
      messageType: "CLOSE_TASK",
      sender: {
        actorType: "agent",
        actorId: "eng-1",
        role: "engineer",
      },
      recipients: [
        {
          recipientType: "user",
          recipientId: "board-1",
          role: "human_board",
        },
      ],
      workflowStateBefore: "approved",
      workflowStateAfter: "closed",
      summary: "Closed with follow-up reuse links",
      payload: {
        closeReason: "completed",
        closureSummary: "Done",
        verificationSummary: "Verified",
        rollbackPlan: "Revert patch",
        finalArtifacts: [],
        finalTestStatus: "passed",
        mergeStatus: "merged",
        followUpIssueIds: ["issue-c", "issue-d"],
        remainingRisks: [],
        relatedIssueIds: ["issue-a", "issue-b"],
      },
      artifacts: [],
    });

    const signals = deriveDynamicRetrievalSignals({
      message,
      issue: {
        projectId: null,
        title: "Close protocol",
        description: null,
        mentionedProjects: [],
      },
      recipientRole: "human_board",
      eventType: deriveRetrievalEventType("CLOSE_TASK") ?? "on_close",
    });

    expect(signals.relatedIssueIds).toEqual(["issue-a", "issue-b", "issue-c", "issue-d"]);
  });

  it("promotes evidence citation paths and source hints into retrieval signals", () => {
    const message = buildMessage({
      messageType: "APPROVE_IMPLEMENTATION",
      sender: {
        actorType: "agent",
        actorId: "reviewer-1",
        role: "reviewer",
      },
      recipients: [
        {
          recipientType: "agent",
          recipientId: "lead-1",
          role: "tech_lead",
        },
      ],
      workflowStateBefore: "under_review",
      workflowStateAfter: "approved",
      summary: "Approve implementation using retrieved module summary and code evidence",
      payload: {
        approvalSummary: "Verified against the retrieved module summary and code paths.",
        approvalMode: "agent_review",
        approvalChecklist: ["Acceptance criteria covered"],
        verifiedEvidence: ["Reviewed diff", "Reviewed regression test"],
        residualRisks: ["No unresolved blocker"],
        followUpActions: ["Monitor release dashboard"],
        evidenceCitations: [
          {
            retrievalRunId: "00000000-0000-0000-0000-000000000555",
            briefId: "00000000-0000-0000-0000-000000000556",
            citedHitRanks: [1],
            citedPaths: ["server/src/services/retrieval/query.ts"],
            citedSourceTypes: ["code", "code_summary"],
            citedSummaryKinds: ["module"],
            citationReason: "The module summary identified the relevant retrieval path.",
          },
        ],
      },
      artifacts: [],
    });

    const signals = deriveDynamicRetrievalSignals({
      message,
      issue: {
        projectId: "project-1",
        title: "Approve retrieval follow-up",
        description: "Close the review after verifying retrieval query behavior.",
        mentionedProjects: [{ id: "project-2", name: "retrieval-core" }],
      },
      recipientRole: "tech_lead",
      eventType: "on_approval",
    });

    expect(signals.exactPaths).toContain("server/src/services/retrieval/query.ts");
    expect(signals.preferredSourceTypes).toEqual(expect.arrayContaining(["code", "code_summary"]));
    expect(signals.knowledgeTags).toContain("module summary");
    expect(signals.lexicalTerms).toEqual(expect.arrayContaining([
      "server src services retrieval query ts",
      "code summary",
      "module",
      "retrieval",
      "path",
    ]));
  });
});
