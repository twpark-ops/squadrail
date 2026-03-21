import { describe, expect, it } from "vitest";
import { resolveProtocolRunRequirement } from "@squadrail/shared";
import {
  buildDeterministicProtocolAutoAssistSteps,
  selectPreferredEngineerAgentId,
  shouldAutoAssistProtocolDispatch,
} from "../services/issue-protocol-auto-assist.js";

function buildIssueState(overrides?: Partial<Parameters<typeof buildDeterministicProtocolAutoAssistSteps>[0]["state"]>) {
  return {
    workflowState: "assigned",
    currentReviewCycle: 0,
    techLeadAgentId: "lead-1",
    primaryEngineerAgentId: "eng-1",
    reviewerAgentId: "reviewer-1",
    qaAgentId: "qa-1",
    ...overrides,
  };
}

function buildIssue(overrides?: Partial<Parameters<typeof buildDeterministicProtocolAutoAssistSteps>[0]["issue"]>) {
  return {
    id: "issue-1",
    companyId: "company-1",
    projectId: "project-1",
    identifier: "ISS-1",
    title: "Deterministic recovery test",
    status: "in_review",
    ...overrides,
  };
}

describe("buildDeterministicProtocolAutoAssistSteps", () => {
  it("routes supervisor lanes to a deterministic reassign target", () => {
    const requirement = resolveProtocolRunRequirement({
      protocolMessageType: "ASSIGN_TASK",
      protocolRecipientRole: "pm",
    });

    const steps = buildDeterministicProtocolAutoAssistSteps({
      requirement: requirement!,
      runAgentId: "pm-1",
      issue: buildIssue(),
      state: buildIssueState({ workflowState: "assigned", primaryEngineerAgentId: null }),
      projectLeadAgentId: "lead-1",
      degradedReason: "supervisory_invoke_stall",
      contextSnapshot: {},
    });

    expect(steps).toHaveLength(1);
    expect(steps?.[0]?.message).toMatchObject({
      messageType: "REASSIGN_TASK",
      sender: {
        actorId: "pm-1",
        role: "pm",
      },
      payload: {
        newAssigneeAgentId: "lead-1",
      },
    });
  });

  it("ignores a tech lead self-assignment when choosing a deterministic engineer target", () => {
    const requirement = resolveProtocolRunRequirement({
      protocolMessageType: "ASSIGN_TASK",
      protocolRecipientRole: "tech_lead",
    });

    const steps = buildDeterministicProtocolAutoAssistSteps({
      requirement: requirement!,
      runAgentId: "lead-1",
      issue: buildIssue(),
      state: buildIssueState({
        workflowState: "assigned",
        techLeadAgentId: "lead-1",
        primaryEngineerAgentId: "lead-1",
      }),
      projectLeadAgentId: "lead-1",
      preferredEngineerAgentId: "eng-impl",
      degradedReason: "supervisory_invoke_stall",
      contextSnapshot: {},
    });

    expect(steps).toHaveLength(1);
    expect(steps?.[0]?.message.payload).toMatchObject({
      newAssigneeAgentId: "eng-impl",
    });
  });

  it("acknowledges and starts implementation for stalled engineer assignment lanes", () => {
    const requirement = resolveProtocolRunRequirement({
      protocolMessageType: "ASSIGN_TASK",
      protocolRecipientRole: "engineer",
    });

    const steps = buildDeterministicProtocolAutoAssistSteps({
      requirement: requirement!,
      runAgentId: "eng-1",
      issue: buildIssue(),
      state: buildIssueState({ workflowState: "assigned" }),
      degradedReason: "adapter_retry",
      contextSnapshot: {},
    });

    expect(steps?.map((step) => step.message.messageType)).toEqual([
      "ACK_ASSIGNMENT",
      "START_IMPLEMENTATION",
    ]);
    expect(steps?.[1]?.message.workflowStateBefore).toBe("accepted");
  });

  it("builds a deterministic review submission for implementation stalls", () => {
    const requirement = resolveProtocolRunRequirement({
      protocolMessageType: "START_IMPLEMENTATION",
      protocolRecipientRole: "engineer",
    });

    const steps = buildDeterministicProtocolAutoAssistSteps({
      requirement: requirement!,
      runAgentId: "eng-1",
      issue: buildIssue(),
      state: buildIssueState({ workflowState: "implementing" }),
      degradedReason: "supervisory_invoke_stall",
      contextSnapshot: {
        squadrailWorkspace: {
          cwd: "/tmp/worktree/issue-1",
        },
        taskBrief: {
          evidence: [
            { path: "server/src/foo.ts" },
            { path: "server/src/bar.ts" },
          ],
        },
      },
    });

    expect(steps).toHaveLength(1);
    expect(steps?.[0]?.message).toMatchObject({
      messageType: "SUBMIT_FOR_REVIEW",
      payload: {
        changedFiles: ["server/src/foo.ts", "server/src/bar.ts"],
      },
    });
    expect(steps?.[0]?.message.artifacts.map((artifact) => artifact.kind)).toEqual([
      "doc",
      "diff",
      "test_run",
    ]);
  });

  it("falls back to the project implementation workspace when run workspace context is unavailable", () => {
    const requirement = resolveProtocolRunRequirement({
      protocolMessageType: "START_IMPLEMENTATION",
      protocolRecipientRole: "engineer",
    });

    const steps = buildDeterministicProtocolAutoAssistSteps({
      requirement: requirement!,
      runAgentId: "eng-1",
      issue: buildIssue(),
      state: buildIssueState({ workflowState: "implementing" }),
      implementationWorkspaceCwd: "/tmp/worktree/swiftsight-agent",
      implementationWorkspaceId: "workspace-impl",
      implementationWorkspaceIsolatedRoot: "/tmp/.squadrail-worktrees/swiftsight-agent",
      degradedReason: "supervisory_invoke_stall",
      contextSnapshot: {},
    });

    expect(steps?.[0]?.message.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "doc",
          metadata: expect.objectContaining({
            bindingType: "implementation_workspace",
            cwd: "/tmp/.squadrail-worktrees/swiftsight-agent/issue-1-eng-1-workspace-im",
          }),
        }),
      ]),
    );
  });

  it("starts review and approves reviewer lanes deterministically", () => {
    const requirement = resolveProtocolRunRequirement({
      protocolMessageType: "SUBMIT_FOR_REVIEW",
      protocolRecipientRole: "reviewer",
    });

    const steps = buildDeterministicProtocolAutoAssistSteps({
      requirement: requirement!,
      runAgentId: "reviewer-1",
      issue: buildIssue(),
      state: buildIssueState({ workflowState: "submitted_for_review", currentReviewCycle: 2 }),
      degradedReason: "supervisory_invoke_stall",
      contextSnapshot: {},
    });

    expect(steps?.map((step) => step.message.messageType)).toEqual([
      "START_REVIEW",
      "APPROVE_IMPLEMENTATION",
    ]);
    expect(steps?.[0]?.message.payload).toMatchObject({ reviewCycle: 3 });
    expect(steps?.[1]?.message.workflowStateAfter).toBe("qa_pending");
  });

  it("uses a system close for approved tech lead lanes", () => {
    const requirement = resolveProtocolRunRequirement({
      protocolMessageType: "APPROVE_IMPLEMENTATION",
      protocolRecipientRole: "tech_lead",
    });

    const steps = buildDeterministicProtocolAutoAssistSteps({
      requirement: requirement!,
      runAgentId: "lead-1",
      issue: buildIssue(),
      state: buildIssueState({ workflowState: "approved" }),
      degradedReason: "supervisory_invoke_stall",
      contextSnapshot: {},
    });

    expect(steps).toHaveLength(1);
    expect(steps?.[0]).toMatchObject({
      actor: {
        actorType: "system",
      },
      message: {
        messageType: "CLOSE_TASK",
        sender: {
          role: "system",
        },
      },
    });
  });
});

describe("shouldAutoAssistProtocolDispatch", () => {
  it("enables local-trusted active protocol lanes", () => {
    expect(shouldAutoAssistProtocolDispatch({
      deploymentMode: "local_trusted",
      dispatchMode: "default",
      contextSnapshot: {
        protocolMessageType: "SUBMIT_FOR_REVIEW",
        protocolRecipientRole: "reviewer",
      },
    })).toBe(true);
  });

  it("skips reviewer watch lanes even in local-trusted mode", () => {
    expect(shouldAutoAssistProtocolDispatch({
      deploymentMode: "local_trusted",
      dispatchMode: "reviewer_watch",
      contextSnapshot: {
        protocolMessageType: "SUBMIT_FOR_REVIEW",
        protocolRecipientRole: "reviewer",
      },
    })).toBe(false);
  });

  it("skips lead supervisor watch lanes even in local-trusted mode", () => {
    expect(shouldAutoAssistProtocolDispatch({
      deploymentMode: "local_trusted",
      dispatchMode: "lead_supervisor",
      contextSnapshot: {
        protocolMessageType: "APPROVE_IMPLEMENTATION",
        protocolRecipientRole: "tech_lead",
      },
    })).toBe(false);
  });

  it("accepts direct protocol fields even when context snapshot is sparse", () => {
    expect(shouldAutoAssistProtocolDispatch({
      deploymentMode: "local_trusted",
      dispatchMode: "default",
      protocolMessageType: "ASSIGN_TASK",
      protocolRecipientRole: "tech_lead",
      contextSnapshot: {},
    })).toBe(true);
  });
});

describe("selectPreferredEngineerAgentId", () => {
  it("prefers same-project implementation engineers for a supervisor lane", () => {
    const selected = selectPreferredEngineerAgentId({
      managerAgentId: "tl-1",
      projectKeys: ["swiftsight-agent"],
      excludeAgentIds: ["tl-1"],
      candidates: [
        {
          id: "eng-analysis",
          reportsTo: "tl-1",
          adapterType: "claude_local",
          metadata: { projectSlug: "swiftsight-agent", deliveryLane: "analysis" },
        },
        {
          id: "eng-impl",
          reportsTo: "tl-1",
          adapterType: "codex_local",
          metadata: { projectSlug: "swiftsight-agent", deliveryLane: "implementation" },
        },
        {
          id: "eng-other-project",
          reportsTo: "tl-1",
          adapterType: "codex_local",
          metadata: { projectSlug: "swiftcl", deliveryLane: "implementation" },
        },
      ],
    });

    expect(selected).toBe("eng-impl");
  });

  it("falls back to the manager's direct implementation report when project metadata is missing", () => {
    const selected = selectPreferredEngineerAgentId({
      managerAgentId: "tl-1",
      projectKeys: [],
      excludeAgentIds: ["tl-1"],
      candidates: [
        {
          id: "eng-other-manager",
          reportsTo: "tl-2",
          adapterType: "codex_local",
          metadata: { projectSlug: "swiftsight-agent", deliveryLane: "implementation" },
        },
        {
          id: "eng-direct",
          reportsTo: "tl-1",
          adapterType: "codex_local",
          metadata: { deliveryLane: "implementation" },
        },
      ],
    });

    expect(selected).toBe("eng-direct");
  });
});
