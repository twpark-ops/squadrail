import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { issues, projectWorkspaces } from "@squadrail/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolveProjectWorkspaceByPolicy } = vi.hoisted(() => ({
  mockResolveProjectWorkspaceByPolicy: vi.fn(),
}));

vi.mock("../services/project-workspace-routing.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/project-workspace-routing.js")>();
  return {
    ...actual,
    resolveProjectWorkspaceByPolicy: mockResolveProjectWorkspaceByPolicy,
  };
});

import { resolveWorkspaceForRun } from "../services/heartbeat-workspace.js";

function shiftTableRows(queueMap: Map<unknown, unknown[][]>, table: unknown) {
  const queue = queueMap.get(table);
  return queue?.shift() ?? [];
}

function createResolvedSelectChain(selectRows: Map<unknown, unknown[][]>) {
  let selectedTable: unknown = null;
  const chain = {
    from: (table: unknown) => {
      selectedTable = table;
      return chain;
    },
    where: () => chain,
    orderBy: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
      Promise.resolve(shiftTableRows(selectRows, selectedTable)).then(resolve),
  };
  return chain;
}

function createHeartbeatWorkspaceDbMock(input?: {
  selectRows?: Map<unknown, unknown[][]>;
}) {
  const selectRows = input?.selectRows ?? new Map();
  return {
    db: {
      select: () => createResolvedSelectChain(selectRows),
    },
  };
}

function buildWorkspaceRow(overrides: Partial<typeof projectWorkspaces.$inferSelect> = {}) {
  return {
    id: "workspace-1",
    companyId: "company-1",
    projectId: "project-1",
    name: "runtime",
    cwd: null,
    repoUrl: "https://github.com/acme/runtime",
    repoRef: "main",
    metadata: null,
    isPrimary: true,
    createdAt: new Date("2026-03-13T10:00:00.000Z"),
    updatedAt: new Date("2026-03-13T10:00:00.000Z"),
    ...overrides,
  };
}

const agent = {
  id: "agent-1",
  companyId: "company-1",
  name: "Runtime Engineer",
};

describe("heartbeat workspace service", () => {
  let tempRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockResolveProjectWorkspaceByPolicy.mockResolvedValue(null);
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "heartbeat-workspace-"));
    vi.stubEnv("SQUADRAIL_HOME", path.join(tempRoot, ".squadrail-home"));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("prefers a policy-resolved isolated workspace when available", async () => {
    mockResolveProjectWorkspaceByPolicy.mockResolvedValue({
      cwd: "/tmp/isolated/runtime",
      source: "project_isolated",
      workspaceId: "workspace-1",
      repoUrl: "https://github.com/acme/runtime",
      repoRef: "main",
      executionPolicy: {
        mode: "isolated",
        applyFor: ["implementation"],
        isolationStrategy: "worktree",
        isolatedRoot: null,
        branchTemplate: "squadrail/{issueId}",
        writable: true,
      },
      workspaceUsage: "implementation",
      warnings: ["resumed isolated workspace"],
      branchName: "squadrail/issue-1",
      workspaceState: "reused_clean",
      hasLocalChanges: false,
    });
    const { db } = createHeartbeatWorkspaceDbMock({
      selectRows: new Map([
        [issues, [[{ projectId: "project-1" }]]],
        [projectWorkspaces, [[buildWorkspaceRow()]]],
      ]),
    });

    const resolved = await resolveWorkspaceForRun({
      db: db as never,
      agent: agent as never,
      context: {
        issueId: "issue-1",
        protocolRecipientRole: "engineer",
        protocolMessageType: "START_IMPLEMENTATION",
        protocolWorkflowStateAfter: "implementing",
      },
      taskKey: "CLO-1",
      previousSessionParams: null,
    });

    expect(resolved).toMatchObject({
      cwd: "/tmp/isolated/runtime",
      source: "project_isolated",
      workspaceId: "workspace-1",
      projectId: "project-1",
      workspaceUsage: "implementation",
      branchName: "squadrail/issue-1",
      workspaceState: "reused_clean",
      hasLocalChanges: false,
    });
    expect(resolved.workspaceHints).toEqual([
      expect.objectContaining({
        workspaceId: "workspace-1",
        repoRef: "main",
      }),
    ]);
  });

  it("falls back to a configured shared project cwd when the policy resolver yields nothing", async () => {
    const projectCwd = path.join(tempRoot, "runtime-shared");
    await fs.mkdir(projectCwd, { recursive: true });
    const { db } = createHeartbeatWorkspaceDbMock({
      selectRows: new Map([
        [issues, [[{ projectId: "project-1" }]]],
        [projectWorkspaces, [[buildWorkspaceRow({ cwd: projectCwd })]]],
      ]),
    });

    const resolved = await resolveWorkspaceForRun({
      db: db as never,
      agent: agent as never,
      context: {
        issueId: "issue-1",
        protocolRecipientRole: "reviewer",
      },
      taskKey: "CLO-1",
      previousSessionParams: null,
    });

    expect(resolved).toMatchObject({
      cwd: projectCwd,
      source: "project_shared",
      workspaceId: "workspace-1",
      projectId: "project-1",
      workspaceUsage: "review",
      warnings: [],
    });
  });

  it("reuses an existing task session cwd when no project workspace exists", async () => {
    const sessionCwd = path.join(tempRoot, "session-workspace");
    await fs.mkdir(sessionCwd, { recursive: true });
    const { db } = createHeartbeatWorkspaceDbMock({
      selectRows: new Map([
        [projectWorkspaces, [[]]],
      ]),
    });

    const resolved = await resolveWorkspaceForRun({
      db: db as never,
      agent: agent as never,
      context: {},
      taskKey: "adhoc-run",
      previousSessionParams: {
        sessionId: "session-1",
        cwd: sessionCwd,
        workspaceId: "workspace-session",
        repoUrl: "https://github.com/acme/runtime",
        repoRef: "feature/test",
        branchName: "feature/test",
      },
      useProjectWorkspace: false,
    });

    expect(resolved).toMatchObject({
      cwd: sessionCwd,
      source: "task_session",
      workspaceId: "workspace-session",
      repoRef: "feature/test",
      branchName: "feature/test",
      warnings: [],
    });
  });

  it("uses blocked fallback workspace when implementation requires an isolated project workspace", async () => {
    const { db } = createHeartbeatWorkspaceDbMock({
      selectRows: new Map([
        [issues, [[{ projectId: "project-1" }]]],
        [projectWorkspaces, [[buildWorkspaceRow({
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
        })]]],
      ]),
    });

    const resolved = await resolveWorkspaceForRun({
      db: db as never,
      agent: agent as never,
      context: {
        issueId: "issue-1",
        protocolRecipientRole: "engineer",
        protocolMessageType: "START_IMPLEMENTATION",
        protocolWorkflowStateAfter: "implementing",
      },
      taskKey: "CLO-1",
      previousSessionParams: null,
    });

    expect(resolved.source).toBe("agent_home");
    expect(resolved.projectId).toBe("project-1");
    expect(resolved.workspaceUsage).toBe("implementation");
    expect(resolved.warnings[0]).toContain("isolated project workspace");
    expect(resolved.workspaceId).toBe("workspace-1");
  });

  it("falls back to agent home with a missing-session warning when saved cwd no longer exists", async () => {
    const missingCwd = path.join(tempRoot, "missing-session");
    const { db } = createHeartbeatWorkspaceDbMock({
      selectRows: new Map([
        [projectWorkspaces, [[]]],
      ]),
    });

    const resolved = await resolveWorkspaceForRun({
      db: db as never,
      agent: agent as never,
      context: {},
      taskKey: "adhoc-run",
      previousSessionParams: {
        sessionId: "session-1",
        cwd: missingCwd,
      },
      useProjectWorkspace: false,
    });

    expect(resolved.source).toBe("agent_home");
    expect(resolved.cwd).toContain(path.join("workspaces", "agent-1"));
    expect(resolved.warnings[0]).toContain("Saved session workspace");
  });
});
