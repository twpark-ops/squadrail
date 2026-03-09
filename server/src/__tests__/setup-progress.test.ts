import { describe, expect, it } from "vitest";
import { buildSetupProgressSteps, deriveSetupProgressState } from "../services/setup-progress.js";

describe("setup progress helpers", () => {
  it("derives setup steps from engine, workspace, and metadata", () => {
    const steps = buildSetupProgressSteps({
      selectedEngine: "claude_local",
      selectedWorkspaceId: "workspace-1",
      metadata: {
        rolePacksSeeded: true,
        knowledgeSeeded: true,
      },
      publishedRolePackCount: 3,
    });

    expect(steps).toEqual({
      companyReady: true,
      squadReady: true,
      engineReady: true,
      workspaceConnected: true,
      knowledgeSeeded: true,
      firstIssueReady: false,
    });
  });

  it("picks the furthest setup state from step flags", () => {
    expect(deriveSetupProgressState({
      companyReady: true,
      squadReady: true,
      engineReady: true,
      workspaceConnected: true,
      knowledgeSeeded: true,
      firstIssueReady: true,
    })).toBe("first_issue_ready");

    expect(deriveSetupProgressState({
      companyReady: true,
      squadReady: false,
      engineReady: true,
      workspaceConnected: true,
      knowledgeSeeded: true,
      firstIssueReady: true,
    })).toBe("company_ready");

    expect(deriveSetupProgressState({
      companyReady: true,
      squadReady: true,
      engineReady: false,
      workspaceConnected: true,
      knowledgeSeeded: true,
      firstIssueReady: true,
    })).toBe("squad_ready");
  });

  it("keeps downstream steps pending until prerequisites are complete", () => {
    const steps = buildSetupProgressSteps({
      selectedEngine: "claude_local",
      selectedWorkspaceId: null,
      metadata: {
        rolePacksSeeded: true,
        knowledgeSeeded: true,
        firstIssueReady: true,
      },
      publishedRolePackCount: 3,
    });

    expect(steps).toEqual({
      companyReady: true,
      squadReady: true,
      engineReady: true,
      workspaceConnected: false,
      knowledgeSeeded: false,
      firstIssueReady: false,
    });
    expect(deriveSetupProgressState(steps)).toBe("engine_ready");
  });
});
