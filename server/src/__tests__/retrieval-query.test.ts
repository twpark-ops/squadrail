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
    expect(signals.preferredSourceTypes.slice(0, 3)).toEqual(["code", "test_report", "review"]);
    expect(signals.preferredSourceTypes).toContain("protocol_message");
    expect(signals.projectAffinityIds).toEqual(["project-1", "project-2"]);
    expect(signals.projectAffinityNames).toEqual(["runtime-core"]);
  });

  it("carries related issue aliases into dynamic signals", () => {
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
        linkedIssueIds: ["issue-b", "issue-e"],
      } as CreateIssueProtocolMessage["payload"] & {
        relatedIssueIds: string[];
        linkedIssueIds: string[];
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

    expect(signals.relatedIssueIds).toEqual(["issue-a", "issue-b", "issue-e", "issue-c", "issue-d"]);
  });
});
