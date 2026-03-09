import { describe, expect, it } from "vitest";
import { enrichProtocolMessageArtifactsFromRun } from "../services/protocol-run-artifacts.js";

describe("enrichProtocolMessageArtifactsFromRun", () => {
  it("adds workspace binding metadata for START_IMPLEMENTATION", () => {
    const message = enrichProtocolMessageArtifactsFromRun({
      issueId: "issue-1",
      run: {
        id: "run-1",
        companyId: "company-1",
        agentId: "eng-1",
        invocationSource: "automation",
        status: "running",
        startedAt: new Date("2026-03-10T00:00:00.000Z"),
        finishedAt: null,
        stdoutExcerpt: null,
        stderrExcerpt: null,
        contextSnapshot: {
          issueId: "issue-1",
          squadrailWorkspace: {
            cwd: "/workspace/repo",
            source: "project_isolated",
            projectId: "project-1",
            workspaceId: "workspace-1",
            repoUrl: "git@github.com:org/repo.git",
            repoRef: "main",
            workspaceUsage: "implementation",
            branchName: "squadrail/issue-1-eng-1",
          },
        },
      },
      message: {
        messageType: "START_IMPLEMENTATION",
        sender: {
          actorType: "agent",
          actorId: "eng-1",
          role: "engineer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "eng-1",
            role: "engineer",
          },
        ],
        workflowStateBefore: "planning",
        workflowStateAfter: "implementing",
        summary: "start implementation",
        payload: {
          implementationMode: "code_change",
          activeHypotheses: ["isolate the worktree"],
        },
        artifacts: [],
      },
    });

    expect(message.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "run",
          uri: "run://run-1",
        }),
        expect.objectContaining({
          kind: "doc",
          uri: "workspace://workspace-1/binding",
          metadata: expect.objectContaining({
            bindingType: "implementation_workspace",
            branchName: "squadrail/issue-1-eng-1",
          }),
        }),
      ]),
    );
  });

  it("captures reported test and build evidence as protocol artifacts", () => {
    const message = enrichProtocolMessageArtifactsFromRun({
      issueId: "issue-2",
      run: {
        id: "run-2",
        companyId: "company-1",
        agentId: "eng-1",
        invocationSource: "automation",
        status: "running",
        startedAt: new Date("2026-03-10T00:01:00.000Z"),
        finishedAt: null,
        stdoutExcerpt: "pnpm test:run\npnpm build",
        stderrExcerpt: null,
        contextSnapshot: {
          issueId: "issue-2",
          squadrailWorkspace: {
            cwd: "/workspace/repo",
            source: "project_isolated",
            projectId: "project-1",
            workspaceId: "workspace-1",
            workspaceUsage: "implementation",
          },
        },
      },
      message: {
        messageType: "SUBMIT_FOR_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "eng-1",
          role: "engineer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "rev-1",
            role: "reviewer",
          },
        ],
        workflowStateBefore: "implementing",
        workflowStateAfter: "submitted_for_review",
        summary: "submit for review",
        payload: {
          implementationSummary: "done",
          evidence: ["pnpm build"],
          diffSummary: "updated retry handling",
          changedFiles: ["server/src/retry.ts"],
          testResults: ["pnpm test:run"],
          reviewChecklist: ["reviewed retry flow"],
          residualRisks: ["monitor production queue depth"],
        },
        artifacts: [],
      },
    });

    expect(message.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "run",
          uri: "run://run-2",
        }),
        expect.objectContaining({
          kind: "test_run",
          uri: "run://run-2/test",
          metadata: expect.objectContaining({
            evidenceLines: ["pnpm test:run"],
          }),
        }),
        expect.objectContaining({
          kind: "build_run",
          uri: "run://run-2/build",
          metadata: expect.objectContaining({
            evidenceLines: ["pnpm build"],
          }),
        }),
      ]),
    );
  });
});
