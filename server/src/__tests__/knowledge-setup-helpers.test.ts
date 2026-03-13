import { describe, expect, it } from "vitest";
import {
  buildOrgSyncView,
  buildProjectSyncIssues,
  deriveProjectSyncStatus,
  normalizeAgentPatch,
  withKnowledgeSetupCacheMeta,
} from "../services/knowledge-setup.js";

describe("knowledge setup helpers", () => {
  it("annotates setup views with cache telemetry", () => {
    const view = withKnowledgeSetupCacheMeta({
      companyId: "company-1",
      companyName: "Acme",
      canonicalTemplateKey: null,
      canonicalVersion: null,
      generatedAt: "2026-03-13T09:00:00.000Z",
      projects: [],
      orgSync: null,
      recentJobs: [],
      activeJobCount: 0,
      setupProgress: null,
      cache: {
        state: "fresh",
        refreshInFlight: false,
        freshUntil: null,
        staleUntil: null,
        lastRefreshStartedAt: null,
        lastRefreshCompletedAt: null,
        lastRefreshErrorAt: null,
        lastRefreshError: null,
      },
    }, {
      state: "stale",
      refreshInFlight: true,
      freshUntil: Date.parse("2026-03-13T10:00:00.000Z"),
      staleUntil: Date.parse("2026-03-13T10:05:00.000Z"),
      lastRefreshStartedAt: Date.parse("2026-03-13T09:58:00.000Z"),
      lastRefreshCompletedAt: null,
      lastRefreshErrorAt: null,
      lastRefreshError: null,
    });

    expect(view.cache).toEqual({
      state: "stale",
      refreshInFlight: true,
      freshUntil: "2026-03-13T10:00:00.000Z",
      staleUntil: "2026-03-13T10:05:00.000Z",
      lastRefreshStartedAt: "2026-03-13T09:58:00.000Z",
      lastRefreshCompletedAt: null,
      lastRefreshErrorAt: null,
      lastRefreshError: null,
    });
  });

  it("derives project sync status and issue descriptions from workspace and revision state", () => {
    expect(deriveProjectSyncStatus({
      workspaceExists: false,
      workspaceCwd: null,
      currentHeadSha: null,
      documentCount: 0,
      revision: 0,
      lastHeadSha: null,
    })).toBe("missing_workspace");

    expect(deriveProjectSyncStatus({
      workspaceExists: true,
      workspaceCwd: "/repo/runtime",
      currentHeadSha: "sha-2",
      documentCount: 10,
      revision: 2,
      lastHeadSha: "sha-1",
    })).toBe("stale");

    expect(buildProjectSyncIssues({
      workspaceExists: true,
      workspaceCwd: "/repo/runtime",
      documentCount: 0,
      revision: 0,
      currentHeadSha: "sha-2",
      lastHeadSha: "sha-1",
    })).toEqual([
      "Knowledge documents have not been imported yet.",
      "Project knowledge revision has not been initialized.",
      "Workspace HEAD has moved since the last knowledge sync.",
    ]);
  });

  it("builds org sync mismatch views from canonical and live agent shapes", () => {
    const generated = buildOrgSyncView({
      companyId: "company-1",
      templateKey: "swiftsight",
      canonicalVersion: "1.0.0",
      canonicalAgents: [
        {
          canonicalSlug: "pm",
          legacySlugs: [],
          name: "PM",
          role: "pm",
          title: "Product Manager",
          reportsToSlug: null,
          projectSlug: "runtime",
          deliveryLane: "pm",
          adapterType: "codex_local",
          capabilities: "Plan work",
          adapterConfig: {},
          runtimeConfig: {},
          metadata: { projectSlug: "runtime", deliveryLane: "pm" },
        },
        {
          canonicalSlug: "qa",
          legacySlugs: ["quality"],
          name: "QA",
          role: "qa",
          title: "QA Engineer",
          reportsToSlug: "pm",
          projectSlug: "runtime",
          deliveryLane: "qa",
          adapterType: "codex_local",
          capabilities: "Verify work",
          adapterConfig: {},
          runtimeConfig: {},
          metadata: { projectSlug: "runtime", deliveryLane: "qa" },
        },
      ],
      liveAgents: [
        {
          id: "agent-pm",
          companyId: "company-1",
          name: "PM",
          urlKey: "pm",
          role: "pm",
          title: "Product Manager",
          reportsTo: null,
          adapterType: "codex_local",
          metadata: {
            bootstrapSlug: "pm",
            projectSlug: "runtime",
            deliveryLane: "pm",
            canonicalTemplateKey: "swiftsight",
          },
        },
        {
          id: "agent-qa",
          companyId: "company-1",
          name: "QA",
          urlKey: "quality",
          role: "qa",
          title: "QA Engineer",
          reportsTo: null,
          adapterType: "codex_local",
          metadata: {
            bootstrapSlug: "qa",
            projectSlug: "wrong-project",
            deliveryLane: "qa",
          },
        },
        {
          id: "agent-extra",
          companyId: "company-1",
          name: "Python TL",
          urlKey: "python-tl",
          role: "tech_lead",
          title: "Lead",
          reportsTo: null,
          adapterType: "codex_local",
          metadata: {},
        },
      ] as any,
    });

    expect(generated.status).toBe("repairable");
    expect(generated.missingAgents).toHaveLength(0);
    expect(generated.extraAgents).toEqual([
      expect.objectContaining({
        agentId: "agent-extra",
        reason: "legacy_python_tl_alias",
      }),
    ]);
    expect(generated.mismatchedAgents).toEqual([
      expect.objectContaining({
        canonicalSlug: "qa",
        mismatchKeys: expect.arrayContaining(["reportsToSlug", "projectSlug"]),
      }),
    ]);
  });

  it("normalizes canonical agent patches for create-or-update flows", () => {
    expect(normalizeAgentPatch({
      canonical: {
        canonicalSlug: "qa",
        legacySlugs: [],
        name: "QA",
        role: "qa",
        title: "QA Engineer",
        reportsToSlug: "pm",
        projectSlug: "runtime",
        deliveryLane: "qa",
        capabilities: "Verify work",
        adapterType: "codex_local",
        adapterConfig: { timeoutSec: 0 },
        runtimeConfig: { heartbeat: { intervalSec: 3600 } },
        metadata: { bootstrapSlug: "qa" },
      },
      managerId: "agent-pm",
    })).toEqual({
      name: "QA",
      role: "qa",
      title: "QA Engineer",
      reportsTo: "agent-pm",
      capabilities: "Verify work",
      adapterType: "codex_local",
      adapterConfig: { timeoutSec: 0 },
      runtimeConfig: { heartbeat: { intervalSec: 3600 } },
      metadata: { bootstrapSlug: "qa" },
    });
  });
});
