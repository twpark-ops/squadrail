import { describe, expect, it } from "vitest";
import { resolveDefaultAgentWorkspaceDir } from "../home-paths.js";
import {
  assertResolvedWorkspaceReadyForExecution,
  type ResolvedWorkspaceForRun,
  resolveRuntimeSessionParamsForWorkspace,
  requiresIsolatedProjectWorkspace,
  WorkspaceResolutionError,
} from "../services/heartbeat-workspace.js";
import {
  attachResolvedWorkspaceContextToRunContext,
  shouldResetTaskSessionForWake,
} from "../services/heartbeat.ts";

function buildResolvedWorkspace(overrides: Partial<ResolvedWorkspaceForRun> = {}): ResolvedWorkspaceForRun {
  return {
    cwd: "/tmp/project",
    source: "project_shared",
    projectId: "project-1",
    workspaceId: "workspace-1",
    repoUrl: null,
    repoRef: null,
    executionPolicy: null,
    workspaceUsage: null,
    branchName: null,
    workspaceState: null,
    hasLocalChanges: null,
    workspaceHints: [],
    warnings: [],
    ...overrides,
  };
}

describe("resolveRuntimeSessionParamsForWorkspace", () => {
  it("migrates fallback workspace sessions to project workspace when project cwd becomes available", () => {
    const agentId = "agent-123";
    const fallbackCwd = resolveDefaultAgentWorkspaceDir(agentId);

    const result = resolveRuntimeSessionParamsForWorkspace({
      agentId,
      previousSessionParams: {
        sessionId: "session-1",
        cwd: fallbackCwd,
        workspaceId: "workspace-1",
      },
      resolvedWorkspace: buildResolvedWorkspace({ cwd: "/tmp/new-project-cwd" }),
    });

    expect(result.sessionParams).toMatchObject({
      sessionId: "session-1",
      cwd: "/tmp/new-project-cwd",
      workspaceId: "workspace-1",
    });
    expect(result.warning).toContain("Attempting to resume session");
  });

  it("does not migrate when previous session cwd is not the fallback workspace", () => {
    const result = resolveRuntimeSessionParamsForWorkspace({
      agentId: "agent-123",
      previousSessionParams: {
        sessionId: "session-1",
        cwd: "/tmp/some-other-cwd",
        workspaceId: "workspace-1",
      },
      resolvedWorkspace: buildResolvedWorkspace({ cwd: "/tmp/new-project-cwd" }),
    });

    expect(result.sessionParams).toEqual({
      sessionId: "session-1",
      cwd: "/tmp/some-other-cwd",
      workspaceId: "workspace-1",
    });
    expect(result.warning).toBeNull();
  });

  it("does not migrate when resolved workspace id differs from previous session workspace id", () => {
    const agentId = "agent-123";
    const fallbackCwd = resolveDefaultAgentWorkspaceDir(agentId);

    const result = resolveRuntimeSessionParamsForWorkspace({
      agentId,
      previousSessionParams: {
        sessionId: "session-1",
        cwd: fallbackCwd,
        workspaceId: "workspace-1",
      },
      resolvedWorkspace: buildResolvedWorkspace({
        cwd: "/tmp/new-project-cwd",
        workspaceId: "workspace-2",
      }),
    });

    expect(result.sessionParams).toEqual({
      sessionId: "session-1",
      cwd: fallbackCwd,
      workspaceId: "workspace-1",
    });
    expect(result.warning).toBeNull();
  });
});

describe("attachResolvedWorkspaceContextToRunContext", () => {
  it("persists resolved workspace metadata onto the run context snapshot", () => {
    const contextSnapshot: Record<string, unknown> = {
      issueId: "issue-1",
      taskId: "issue-1",
    };

    attachResolvedWorkspaceContextToRunContext({
      contextSnapshot,
      resolvedWorkspace: buildResolvedWorkspace({
        source: "project_isolated",
        workspaceUsage: "implementation",
        branchName: "squadrail/issue-1-eng-1",
        workspaceState: "resumed_dirty",
        hasLocalChanges: true,
        workspaceHints: [
          {
            workspaceId: "workspace-1",
            cwd: "/tmp/project",
            repoUrl: null,
            repoRef: null,
            executionPolicy: null,
          },
        ],
      }),
    });

    expect(contextSnapshot).toMatchObject({
      projectId: "project-1",
      squadrailWorkspace: {
        cwd: "/tmp/project",
        source: "project_isolated",
        projectId: "project-1",
        workspaceId: "workspace-1",
        workspaceUsage: "implementation",
        branchName: "squadrail/issue-1-eng-1",
        workspaceState: "resumed_dirty",
        hasLocalChanges: true,
      },
      squadrailWorkspaces: [
        {
          workspaceId: "workspace-1",
          cwd: "/tmp/project",
        },
      ],
    });
  });
});

describe("assertResolvedWorkspaceReadyForExecution", () => {
  it("rejects implementation runs that resolved to agent home", () => {
    expect(() =>
      assertResolvedWorkspaceReadyForExecution({
        resolvedWorkspace: buildResolvedWorkspace({
          cwd: resolveDefaultAgentWorkspaceDir("agent-123"),
          source: "agent_home",
          workspaceUsage: "implementation",
          warnings: ["Project workspace has no local cwd configured."],
        }),
      }),
    ).toThrowError(WorkspaceResolutionError);
  });

  it("allows analysis runs to continue in agent home", () => {
    expect(() =>
      assertResolvedWorkspaceReadyForExecution({
        resolvedWorkspace: buildResolvedWorkspace({
          cwd: resolveDefaultAgentWorkspaceDir("agent-123"),
          source: "agent_home",
          workspaceUsage: "analysis",
        }),
      }),
    ).not.toThrow();
  });
});

describe("requiresIsolatedProjectWorkspace", () => {
  it("returns true when implementation usage has an isolated execution policy", () => {
    expect(
      requiresIsolatedProjectWorkspace({
        usage: "implementation",
        workspaces: [
          {
            metadata: {
              executionPolicy: {
                mode: "isolated",
                applyFor: ["implementation"],
                isolationStrategy: "worktree",
                isolatedRoot: null,
                branchTemplate: null,
                writable: true,
              },
            },
          },
        ],
      }),
    ).toBe(true);
  });

  it("returns false for non-implementation usage", () => {
    expect(
      requiresIsolatedProjectWorkspace({
        usage: "review",
        workspaces: [
          {
            metadata: {
              executionPolicy: {
                mode: "isolated",
                applyFor: ["implementation"],
                isolationStrategy: "worktree",
                isolatedRoot: null,
                branchTemplate: null,
                writable: true,
              },
            },
          },
        ],
      }),
    ).toBe(false);
  });
});

describe("shouldResetTaskSessionForWake", () => {
  it("resets session context on assignment wake", () => {
    expect(shouldResetTaskSessionForWake({ wakeReason: "issue_assigned" })).toBe(true);
  });

  it("resets session context on reassignment wake", () => {
    expect(shouldResetTaskSessionForWake({ wakeReason: "issue_reassigned" })).toBe(true);
  });

  it("resets session context on reviewer watch assignment wakes", () => {
    expect(shouldResetTaskSessionForWake({ wakeReason: "issue_watch_assigned" })).toBe(true);
    expect(shouldResetTaskSessionForWake({ wakeReason: "issue_watch_reassigned" })).toBe(true);
  });

  it("resets session context on timer heartbeats", () => {
    expect(shouldResetTaskSessionForWake({ wakeSource: "timer" })).toBe(true);
  });

  it("resets session context on manual on-demand invokes", () => {
    expect(
      shouldResetTaskSessionForWake({
        wakeSource: "on_demand",
        wakeTriggerDetail: "manual",
      }),
    ).toBe(true);
  });

  it("does not reset session context on mention wake comment", () => {
    expect(
      shouldResetTaskSessionForWake({
        wakeReason: "issue_comment_mentioned",
        wakeCommentId: "comment-1",
      }),
    ).toBe(false);
  });

  it("does not reset session context when commentId is present", () => {
    expect(
      shouldResetTaskSessionForWake({
        wakeReason: "issue_commented",
        commentId: "comment-2",
      }),
    ).toBe(false);
  });

  it("does not reset for comment wakes", () => {
    expect(shouldResetTaskSessionForWake({ wakeReason: "issue_commented" })).toBe(false);
  });

  it("does not reset when wake reason is missing", () => {
    expect(shouldResetTaskSessionForWake({})).toBe(false);
  });

  it("does not reset session context on callback on-demand invokes", () => {
    expect(
      shouldResetTaskSessionForWake({
        wakeSource: "on_demand",
        wakeTriggerDetail: "callback",
      }),
    ).toBe(false);
  });
});
