import { describe, expect, it } from "vitest";
import {
  collectCleanupIssueIds,
  expandCleanupIssueIds,
  summarizePostRunCleanup,
} from "../summary-layer-proof-cleanup-utils.mjs";

describe("summary-layer-proof-cleanup-utils", () => {
  it("collects root, cleanup touched, and child delivery issue ids", () => {
    const ids = collectCleanupIssueIds({
      scenarioDetails: [
        {
          issueId: "ISS-1",
          cleanup: {
            touched: [{ issueId: "ISS-2" }],
          },
          delivery: {
            childResults: [{ issueId: "ISS-3" }, { issueId: "ISS-4" }],
          },
        },
      ],
    });

    expect([...ids]).toEqual(["ISS-1", "ISS-2", "ISS-3", "ISS-4"]);
  });

  it("expands tracked issue ids through descendant chains", () => {
    const tracked = expandCleanupIssueIds([
      { id: "ISS-1", parentId: null },
      { id: "ISS-2", parentId: "ISS-1" },
      { id: "ISS-3", parentId: "ISS-2" },
      { id: "ISS-4", parentId: null },
    ], new Set(["ISS-1"]));

    expect([...tracked]).toEqual(["ISS-1", "ISS-2", "ISS-3"]);
  });

  it("filters cleanup verification to tracked proof issues and active runs", () => {
    const summary = summarizePostRunCleanup({
      issues: [
        { id: "ISS-1", parentId: null, identifier: "CLO-1", title: "Org E2E: root", status: "done" },
        { id: "ISS-2", parentId: "ISS-1", identifier: "CLO-2", title: "Child delivery: fix", status: "done" },
        { id: "ISS-3", parentId: "ISS-2", identifier: "CLO-3", title: "Child delivery: hidden follow-up", status: "todo" },
        { id: "ISS-4", parentId: null, identifier: "OPS-1", title: "Unrelated operator issue", status: "todo" },
      ],
      heartbeatRuns: [
        { id: "run-1", status: "running", contextSnapshot: { issueId: "ISS-3" } },
        { id: "run-2", status: "running", contextSnapshot: { issueId: "ISS-4" } },
      ],
      visibleIssueIdsBefore: new Set(["ISS-1", "ISS-4"]),
      trackedIssueIds: new Set(["ISS-1"]),
    });

    expect(summary.trackedIssueCount).toBe(3);
    expect(summary.visibleNewIssueCount).toBe(0);
    expect(summary.activeRunCount).toBe(1);
    expect(summary.activeRuns).toEqual([
      {
        id: "run-1",
        status: "running",
        issueId: "ISS-3",
      },
    ]);
  });
});
