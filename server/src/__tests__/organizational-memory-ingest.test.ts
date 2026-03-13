import { describe, expect, it } from "vitest";
import {
  buildIssueSnapshotMarkdown,
  buildProtocolArtifactMarkdown,
  estimateTokenCount,
  extractChangedPaths,
  extractRelatedIssueIds,
  normalizePathLink,
  splitMarkdownSections,
  splitOversizedSection,
  truncateText,
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

  it("splits markdown sections and oversized paragraphs into bounded chunks", () => {
    const sections = splitMarkdownSections("# Context\n\nalpha\n\n## Detail\n\nbeta");
    const longParagraph = Array.from({ length: 120 }, (_, index) => `token-${index}`).join(" ");
    const chunks = splitOversizedSection({
      headingPath: "Context",
      textContent: Array.from({ length: 6 }, () => longParagraph).join("\n\n"),
      baseLinks: [
        { entityType: "issue", entityId: "issue-1", linkReason: "source" },
        { entityType: "path", entityId: "src/runtime.ts", linkReason: "changed_path" },
      ],
      metadata: { sectionKind: "issue_snapshot" },
    });

    expect(sections).toEqual([
      { headingPath: "Context", textContent: "# Context\n\nalpha" },
      { headingPath: "Detail", textContent: "## Detail\n\nbeta" },
    ]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toMatchObject({
      headingPath: "Context",
      metadata: expect.objectContaining({ chunkKind: "paragraph_window" }),
    });
  });

  it("extracts related issue ids and changed paths from protocol payloads", () => {
    expect(extractRelatedIssueIds({
      relatedIssueIds: ["issue-1"],
      followUpIssueIds: ["issue-2"],
      replacementIssueId: "issue-3",
    })).toEqual(["issue-1", "issue-2", "issue-3"]);

    expect(extractChangedPaths({
      changedFiles: ["./src/runtime.ts"],
      finalArtifacts: ["dist/report.txt", "summary"],
      changeRequests: [
        {
          affectedFiles: ["src/review.ts"],
        },
      ],
    })).toEqual([
      "src/runtime.ts",
      "dist/report.txt",
      "src/review.ts",
    ]);
    expect(normalizePathLink("./src/runtime.ts")).toBe("src/runtime.ts");
    expect(estimateTokenCount("hello world")).toBeGreaterThan(0);
    expect(truncateText("a".repeat(50000))).toContain("[truncated]");
  });

  it("renders assignment, clarification, and plan protocol artifacts", () => {
    const assign = buildProtocolArtifactMarkdown({
      issue: {
        id: "issue-1",
        identifier: "CLO-2",
        title: "Coordinate rollout",
      },
      projectName: "swiftsight-cloud",
      sourceType: "protocol_message",
      message: {
        id: "message-assign",
        seq: 2,
        messageType: "ASSIGN_TASK",
        senderActorType: "agent",
        senderActorId: "pm-1",
        senderRole: "pm",
        workflowStateBefore: "assigned",
        workflowStateAfter: "planning",
        summary: "Assign the rollout work",
        payload: {
          goal: "Ship safely",
          acceptanceCriteria: ["draft rollout plan"],
          definitionOfDone: ["handoff approved"],
          assigneeAgentId: "eng-1",
          reviewerAgentId: "reviewer-1",
        },
        createdAt: "2026-03-11T03:00:00.000Z",
      },
      recipients: [],
      artifacts: [],
    });
    const clarification = buildProtocolArtifactMarkdown({
      issue: {
        id: "issue-1",
        identifier: "CLO-2",
        title: "Coordinate rollout",
      },
      projectName: "swiftsight-cloud",
      sourceType: "protocol_message",
      message: {
        id: "message-clarify",
        seq: 3,
        messageType: "ASK_CLARIFICATION",
        senderActorType: "agent",
        senderActorId: "eng-1",
        senderRole: "engineer",
        workflowStateBefore: "planning",
        workflowStateAfter: "planning",
        summary: "Need architecture choice",
        payload: {
          questionType: "architecture",
          blocking: true,
          question: "Which queue do we keep?",
          proposedAssumptions: ["RabbitMQ remains"],
        },
        createdAt: "2026-03-11T03:05:00.000Z",
      },
      recipients: [],
      artifacts: [],
    });
    const plan = buildProtocolArtifactMarkdown({
      issue: {
        id: "issue-1",
        identifier: "CLO-2",
        title: "Coordinate rollout",
      },
      projectName: "swiftsight-cloud",
      sourceType: "protocol_message",
      message: {
        id: "message-plan",
        seq: 4,
        messageType: "PROPOSE_PLAN",
        senderActorType: "agent",
        senderActorId: "eng-1",
        senderRole: "engineer",
        workflowStateBefore: "planning",
        workflowStateAfter: "planning",
        summary: "Here is the plan",
        payload: {
          planSummary: "Three-stage rollout",
          risks: ["cache churn"],
          steps: [
            {
              title: "Prepare migration",
              expectedOutcome: "safe rollout",
              dependsOn: ["CLO-1"],
            },
          ],
        },
        createdAt: "2026-03-11T03:10:00.000Z",
      },
      recipients: [],
      artifacts: [],
    });

    expect(assign).toContain("## Assignment");
    expect(assign).toContain("draft rollout plan");
    expect(clarification).toContain("## Question");
    expect(clarification).toContain("RabbitMQ remains");
    expect(plan).toContain("## Plan Steps");
    expect(plan).toContain("dependsOn: CLO-1");
  });

  it("renders blocker, decision, review, approval, and closure protocol payload variants", () => {
    const blocker = buildProtocolArtifactMarkdown({
      issue: { id: "issue-2", identifier: "CLO-3", title: "Release" },
      projectName: "swiftsight-cloud",
      sourceType: "protocol_message",
      message: {
        id: "message-blocker",
        seq: 6,
        messageType: "ESCALATE_BLOCKER",
        senderActorType: "agent",
        senderActorId: "eng-1",
        senderRole: "engineer",
        workflowStateBefore: "implementing",
        workflowStateAfter: "blocked",
        summary: "Deployment is blocked",
        payload: {
          blockerCode: "deploy_failed",
          requestedAction: "manual_approval",
          blockingReason: "Need operator confirmation",
        },
        createdAt: "2026-03-11T04:00:00.000Z",
      },
      recipients: [],
      artifacts: [],
    });
    const decision = buildProtocolArtifactMarkdown({
      issue: { id: "issue-2", identifier: "CLO-3", title: "Release" },
      projectName: "swiftsight-cloud",
      sourceType: "protocol_message",
      message: {
        id: "message-decision",
        seq: 7,
        messageType: "REQUEST_HUMAN_DECISION",
        senderActorType: "agent",
        senderActorId: "pm-1",
        senderRole: "pm",
        workflowStateBefore: "blocked",
        workflowStateAfter: "awaiting_human_decision",
        summary: "Need final call",
        payload: {
          decisionType: "ship",
          recommendedOption: "wait",
          options: ["wait", "ship"],
          decisionQuestion: "Do we ship tonight?",
        },
        createdAt: "2026-03-11T04:05:00.000Z",
      },
      recipients: [],
      artifacts: [],
    });
    const review = buildProtocolArtifactMarkdown({
      issue: { id: "issue-2", identifier: "CLO-3", title: "Release" },
      projectName: "swiftsight-cloud",
      sourceType: "protocol_message",
      message: {
        id: "message-review",
        seq: 8,
        messageType: "SUBMIT_FOR_REVIEW",
        senderActorType: "agent",
        senderActorId: "eng-1",
        senderRole: "engineer",
        workflowStateBefore: "implementing",
        workflowStateAfter: "submitted_for_review",
        summary: "Ready for review",
        payload: {
          diffSummary: "Touched deploy flow",
          changedFiles: ["src/deploy.ts"],
          evidence: ["vitest ok"],
          testResults: ["unit passed"],
          reviewChecklist: ["rollback documented"],
          residualRisks: ["migration timing"],
          implementationSummary: "Deployment flow isolated",
        },
        createdAt: "2026-03-11T04:10:00.000Z",
      },
      recipients: [],
      artifacts: [],
    });
    const approval = buildProtocolArtifactMarkdown({
      issue: { id: "issue-2", identifier: "CLO-3", title: "Release" },
      projectName: "swiftsight-cloud",
      sourceType: "review",
      message: {
        id: "message-approve",
        seq: 9,
        messageType: "APPROVE_IMPLEMENTATION",
        senderActorType: "agent",
        senderActorId: "qa-1",
        senderRole: "qa",
        workflowStateBefore: "under_review",
        workflowStateAfter: "approved",
        summary: "Looks good",
        payload: {
          approvalMode: "qa_signoff",
          approvalChecklist: ["tests reviewed"],
          verifiedEvidence: ["deploy logs"],
          residualRisks: ["none"],
          followUpActions: ["monitor metrics"],
          approvalSummary: "Ready to close",
        },
        createdAt: "2026-03-11T04:15:00.000Z",
      },
      recipients: [],
      artifacts: [],
    });
    const close = buildProtocolArtifactMarkdown({
      issue: { id: "issue-2", identifier: "CLO-3", title: "Release" },
      projectName: "swiftsight-cloud",
      sourceType: "protocol_message",
      message: {
        id: "message-close",
        seq: 10,
        messageType: "CLOSE_TASK",
        senderActorType: "agent",
        senderActorId: "pm-1",
        senderRole: "pm",
        workflowStateBefore: "approved",
        workflowStateAfter: "done",
        summary: "Closed out",
        payload: {
          closeReason: "completed",
          finalTestStatus: "passed",
          mergeStatus: "merged",
          finalArtifacts: ["dist/report.txt"],
          remainingRisks: ["none"],
          followUpIssueIds: ["CLO-4"],
          closureSummary: "Rolled out successfully",
          verificationSummary: "Smoke checks green",
          rollbackPlan: "Revert release tag",
        },
        createdAt: "2026-03-11T04:20:00.000Z",
      },
      recipients: [],
      artifacts: [],
    });

    expect(blocker).toContain("## Blocking Reason");
    expect(decision).toContain("## Decision Question");
    expect(review).toContain("## Implementation Summary");
    expect(approval).toContain("## Approval Summary");
    expect(close).toContain("## Rollback Plan");
    expect(close).toContain("dist/report.txt");
  });

  it("renders cancellation, timeout escalation, and unknown payloads", () => {
    const cancel = buildProtocolArtifactMarkdown({
      issue: { id: "issue-3", identifier: "CLO-5", title: "Fallback" },
      projectName: "swiftsight-cloud",
      sourceType: "protocol_message",
      message: {
        id: "message-cancel",
        seq: 11,
        messageType: "CANCEL_TASK",
        senderActorType: "user",
        senderActorId: "user-1",
        senderRole: "human_board",
        workflowStateBefore: "blocked",
        workflowStateAfter: "cancelled",
        summary: "Cancel it",
        payload: {
          cancelType: "superseded",
          replacementIssueId: "CLO-6",
          reason: "Superseded by another plan",
        },
        createdAt: "2026-03-11T04:25:00.000Z",
      },
      recipients: [],
      artifacts: [],
    });
    const timeout = buildProtocolArtifactMarkdown({
      issue: { id: "issue-3", identifier: "CLO-5", title: "Fallback" },
      projectName: "swiftsight-cloud",
      sourceType: "protocol_message",
      message: {
        id: "message-timeout",
        seq: 12,
        messageType: "TIMEOUT_ESCALATION",
        senderActorType: "system",
        senderActorId: "system",
        senderRole: "system",
        workflowStateBefore: "under_review",
        workflowStateAfter: "blocked",
        summary: "Timeout escalated",
        payload: {
          timeoutCode: "review_timeout",
          expiredActorRole: "reviewer",
          nextEscalationTarget: "qa",
        },
        createdAt: "2026-03-11T04:30:00.000Z",
      },
      recipients: [],
      artifacts: [],
    });
    const unknown = buildProtocolArtifactMarkdown({
      issue: { id: "issue-3", identifier: "CLO-5", title: "Fallback" },
      projectName: "swiftsight-cloud",
      sourceType: "protocol_message",
      message: {
        id: "message-unknown",
        seq: 13,
        messageType: "REPORT_PROGRESS",
        senderActorType: "agent",
        senderActorId: "eng-1",
        senderRole: "engineer",
        workflowStateBefore: "implementing",
        workflowStateAfter: "implementing",
        summary: "status",
        payload: {
          progress: 40,
        },
        createdAt: "2026-03-11T04:35:00.000Z",
      },
      recipients: [],
      artifacts: [],
    });

    expect(cancel).toContain("## Reason");
    expect(timeout).toContain("nextEscalationTarget: qa");
    expect(unknown).toContain("## Payload");
    expect(unknown).toContain("\"progress\": 40");
  });
});
