import { describe, expect, it } from "vitest";
import {
  buildIssueSnapshotMarkdown,
  buildProtocolArtifactMarkdown,
} from "../services/organizational-memory-ingest.js";
import { deriveOrganizationalMemorySourceType } from "../services/organizational-memory-shared.js";

describe("organizational memory source mapping", () => {
  it("maps review messages to review source type", () => {
    expect(deriveOrganizationalMemorySourceType("SUBMIT_FOR_REVIEW")).toBe("review");
    expect(deriveOrganizationalMemorySourceType("REQUEST_CHANGES")).toBe("review");
    expect(deriveOrganizationalMemorySourceType("APPROVE_IMPLEMENTATION")).toBe("review");
  });

  it("maps coordination messages to protocol_message source type", () => {
    expect(deriveOrganizationalMemorySourceType("ASSIGN_TASK")).toBe("protocol_message");
    expect(deriveOrganizationalMemorySourceType("REASSIGN_TASK")).toBe("protocol_message");
    expect(deriveOrganizationalMemorySourceType("CLOSE_TASK")).toBe("protocol_message");
  });

  it("ignores low-signal protocol messages", () => {
    expect(deriveOrganizationalMemorySourceType("ACK_ASSIGNMENT")).toBeNull();
    expect(deriveOrganizationalMemorySourceType("REPORT_PROGRESS")).toBeNull();
  });
});

describe("organizational memory markdown rendering", () => {
  it("renders issue snapshots with delivery context", () => {
    const markdown = buildIssueSnapshotMarkdown({
      issue: {
        id: "issue-1",
        identifier: "CLO-1",
        title: "Stabilize review handoff",
        description: "Need a durable review loop for cloud changes.",
        status: "in_progress",
        priority: "high",
        requestDepth: 0,
        hiddenAt: null,
        createdAt: "2026-03-11T00:00:00.000Z",
        updatedAt: "2026-03-11T01:00:00.000Z",
        completedAt: null,
        cancelledAt: null,
      },
      projectName: "swiftsight-cloud",
      goalTitle: "Stability",
      parentLabel: null,
      assigneeLabel: "Cloud Engineer",
      workflowState: "implementing",
      labels: ["backend", "priority:high"],
      internalSummary: {
        total: 3,
        backlog: 0,
        todo: 1,
        inProgress: 1,
        inReview: 1,
        blocked: 0,
        done: 0,
        cancelled: 0,
      },
      mutation: "update",
    });

    expect(markdown).toContain("Issue Snapshot: CLO-1 Stabilize review handoff");
    expect(markdown).toContain("- workflowState: implementing");
    expect(markdown).toContain("## Internal Work Summary");
    expect(markdown).toContain("- inReview: 1");
  });

  it("renders review artifacts with changed files and evidence", () => {
    const markdown = buildProtocolArtifactMarkdown({
      issue: {
        id: "issue-1",
        identifier: "CLO-1",
        title: "Stabilize review handoff",
      },
      projectName: "swiftsight-cloud",
      sourceType: "review",
      message: {
        id: "message-1",
        seq: 14,
        messageType: "REQUEST_CHANGES",
        senderActorType: "agent",
        senderActorId: "qa-1",
        senderRole: "qa",
        workflowStateBefore: "under_review",
        workflowStateAfter: "changes_requested",
        summary: "Need stronger rollback coverage",
        payload: {
          reviewSummary: "Rollback evidence is too thin.",
          requiredEvidence: ["rollback test output"],
          severity: "high",
          mustFixBeforeApprove: true,
          changeRequests: [
            {
              title: "Add rollback test",
              reason: "Need proof that fallback path still works.",
              affectedFiles: ["internal/storage/path.go"],
            },
          ],
        },
        createdAt: "2026-03-11T02:00:00.000Z",
      },
      recipients: [
        {
          recipientType: "agent",
          recipientId: "eng-1",
          recipientRole: "engineer",
        },
      ],
      artifacts: [
        {
          artifactKind: "diff",
          artifactUri: "run://diff",
          label: "Workspace diff",
          metadata: {},
        },
      ],
    });

    expect(markdown).toContain("Review Artifact");
    expect(markdown).toContain("Need stronger rollback coverage");
    expect(markdown).toContain("affectedFiles: internal/storage/path.go");
    expect(markdown).toContain("rollback test output");
  });
});
