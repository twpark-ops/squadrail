import { describe, expect, it } from "vitest";
import {
  deriveNameFromCwd,
  deriveNameFromRepoUrl,
  deriveWorkspaceName,
  normalizeWorkspaceCwd,
  pickPrimaryWorkspace,
  resolveGoalIds,
  toWorkspace,
} from "../services/projects.js";

describe("project service helper exports", () => {
  it("normalizes workspace input and derives stable names", () => {
    expect(resolveGoalIds({ goalIds: ["goal-1"] })).toEqual(["goal-1"]);
    expect(resolveGoalIds({ goalId: "goal-2" })).toEqual(["goal-2"]);
    expect(resolveGoalIds({ goalId: null })).toEqual([]);
    expect(normalizeWorkspaceCwd("/__squadrail_repo_only__")).toBeNull();
    expect(normalizeWorkspaceCwd("  /repo/runtime  ")).toBe("/repo/runtime");
    expect(deriveNameFromCwd("/repo/runtime/")).toBe("runtime");
    expect(deriveNameFromRepoUrl("https://github.com/acme/runtime.git")).toBe("runtime");
    expect(deriveNameFromRepoUrl("not-a-url")).toBe("not-a-url");
    expect(deriveWorkspaceName({ name: " Explicit " })).toBe("Explicit");
    expect(deriveWorkspaceName({ cwd: "/repo/runtime" })).toBe("runtime");
    expect(deriveWorkspaceName({ repoUrl: "https://github.com/acme/platform.git" })).toBe("platform");
    expect(deriveWorkspaceName({})).toBe("Workspace");
  });

  it("converts workspace rows and picks explicit primaries", () => {
    const first = {
      id: "workspace-1",
      companyId: "company-1",
      projectId: "project-1",
      name: "runtime",
      cwd: "/repo/runtime",
      repoUrl: "https://github.com/acme/runtime.git",
      repoRef: "main",
      metadata: {
        note: "primary",
        executionPolicy: {
          mode: "shared",
          applyFor: ["analysis"],
          isolationStrategy: null,
          isolatedRoot: null,
          branchTemplate: null,
          writable: false,
        },
      },
      isPrimary: false,
      createdAt: new Date("2026-03-13T00:00:00.000Z"),
      updatedAt: new Date("2026-03-13T00:00:00.000Z"),
    };
    const second = {
      ...first,
      id: "workspace-2",
      name: "fallback",
      isPrimary: true,
    };

    expect(toWorkspace(first as never)).toEqual(expect.objectContaining({
      id: "workspace-1",
      metadata: { note: "primary" },
      executionPolicy: expect.objectContaining({ mode: "shared" }),
      isPrimary: false,
    }));
    expect(pickPrimaryWorkspace([])).toBeNull();
    expect(pickPrimaryWorkspace([first as never, second as never])).toEqual(expect.objectContaining({
      id: "workspace-2",
      isPrimary: true,
    }));
  });
});
