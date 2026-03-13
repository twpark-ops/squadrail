import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockEnqueueAfterDbCommit,
  mockRunWithoutDbContext,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockEnqueueAfterDbCommit: vi.fn(),
  mockRunWithoutDbContext: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock("@squadrail/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@squadrail/db")>();
  return {
    ...actual,
    enqueueAfterDbCommit: mockEnqueueAfterDbCommit,
    runWithoutDbContext: mockRunWithoutDbContext,
  };
});

vi.mock("../middleware/logger.js", () => ({
  logger: {
    error: mockLoggerError,
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

import {
  canManageTaskAssignmentsLegacy,
  ensureIssueLabelsByNameHelper,
  scheduleIssueMemoryIngestHelper,
  scheduleProtocolMemoryIngestHelper,
} from "../routes/issues.js";

describe("issue route internal operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnqueueAfterDbCommit.mockReturnValue(false);
    mockRunWithoutDbContext.mockImplementation((fn: () => unknown) => fn());
  });

  it("schedules issue memory ingest immediately when there is no after-commit queue", async () => {
    const ingestIssueSnapshot = vi.fn().mockResolvedValue(undefined);

    scheduleIssueMemoryIngestHelper({
      organizationalMemory: {
        ingestIssueSnapshot,
      },
      issueId: "issue-1",
      mutation: "update",
    });

    await Promise.resolve();
    expect(ingestIssueSnapshot).toHaveBeenCalledWith({
      issueId: "issue-1",
      mutation: "update",
    });
  });

  it("defers protocol memory ingest to the after-commit queue and logs failures", async () => {
    let scheduled: (() => void) | null = null;
    mockEnqueueAfterDbCommit.mockImplementation((fn: () => void) => {
      scheduled = fn;
      return true;
    });
    const ingestProtocolMessage = vi.fn().mockRejectedValue(new Error("boom"));

    scheduleProtocolMemoryIngestHelper({
      organizationalMemory: {
        ingestProtocolMessage,
      },
      messageId: "message-1",
      issueId: "issue-1",
      messageType: "ASSIGN_TASK",
    });

    expect(ingestProtocolMessage).not.toHaveBeenCalled();
    scheduled?.();
    await Promise.resolve();
    expect(ingestProtocolMessage).toHaveBeenCalledWith({ messageId: "message-1" });
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "issue-1",
        messageId: "message-1",
        messageType: "ASSIGN_TASK",
      }),
      "protocol organizational memory ingest failed",
    );
  });

  it("ensures reserved labels, falling back to a fresh list after create conflicts", async () => {
    const svc = {
      listLabels: vi.fn()
        .mockResolvedValueOnce([{ name: "workflow:intake" }])
        .mockResolvedValueOnce([{ name: "workflow:intake" }, { name: "lane:pm" }]),
      createLabel: vi.fn().mockRejectedValueOnce(new Error("duplicate")),
    };

    const labels = await ensureIssueLabelsByNameHelper({
      svc,
      companyId: "company-1",
      specs: [
        { name: "workflow:intake", color: "#2563EB" },
        { name: "lane:pm", color: "#0F766E" },
      ],
    });

    expect(labels).toEqual([
      { name: "workflow:intake" },
      { name: "lane:pm" },
    ]);
    expect(svc.createLabel).toHaveBeenCalledWith("company-1", { name: "lane:pm", color: "#0F766E" });
  });

  it("throws when a reserved label still cannot be resolved and evaluates legacy assignment permissions", async () => {
    await expect(ensureIssueLabelsByNameHelper({
      svc: {
        listLabels: vi.fn().mockResolvedValue([]),
        createLabel: vi.fn().mockRejectedValue(new Error("boom")),
      },
      companyId: "company-1",
      specs: [{ name: "workflow:intake", color: "#2563EB" }],
    })).rejects.toThrow("Failed to create reserved label workflow:intake");

    expect(canManageTaskAssignmentsLegacy({ role: "ceo", permissions: null })).toBe(true);
    expect(canManageTaskAssignmentsLegacy({ role: "engineer", title: "Tech Lead", permissions: null })).toBe(true);
    expect(canManageTaskAssignmentsLegacy({ role: "engineer", permissions: { canAssignTasks: true } })).toBe(true);
    expect(canManageTaskAssignmentsLegacy({ role: "engineer", permissions: {} })).toBe(false);
  });
});
