import { describe, expect, it } from "vitest";
import {
  buildTeamBlueprintPreview,
  listTeamBlueprints,
  resolveTeamBlueprintPreviewParameters,
  teamBlueprintService,
} from "../services/team-blueprints.js";

describe("team blueprints", () => {
  it("lists reusable delivery blueprints with readiness metadata", () => {
    const blueprints = listTeamBlueprints();

    expect(blueprints.map((blueprint) => blueprint.key)).toEqual([
      "small_delivery_team",
      "standard_product_squad",
      "delivery_plus_qa",
    ]);
    expect(blueprints[0]).toMatchObject({
      presetKey: "squadrail_default_v1",
      readiness: {
        requiredWorkspaceCount: 1,
        knowledgeRequired: true,
      },
    });
    expect(blueprints[2]?.parameterHints).toMatchObject({
      supportsPm: true,
      supportsQa: true,
      supportsCto: true,
    });
  });

  it("returns an isolated catalog view per company", () => {
    const service = teamBlueprintService();
    const view = service.getCatalog("company-1");

    expect(view).toMatchObject({
      companyId: "company-1",
      canonicalAbsorptionPrep: null,
    });
    expect(view.blueprints).toHaveLength(3);

    view.blueprints[0]!.projects[0]!.label = "Mutated";
    const second = service.getCatalog("company-1");
    expect(second.blueprints[0]!.projects[0]!.label).toBe("Primary Product");
  });

  it("includes canonical absorption guidance for the swiftsight company name", () => {
    const service = teamBlueprintService();
    const view = service.getCatalog("company-1", "cloud-swiftsight");

    expect(view.canonicalAbsorptionPrep).toMatchObject({
      blueprintKey: "delivery_plus_qa",
      previewRequest: {
        projectCount: 5,
        engineerPairsPerProject: 1,
        includePm: true,
        includeQa: true,
        includeCto: true,
      },
    });
    expect(view.canonicalAbsorptionPrep?.projectMappings).toHaveLength(5);
  });

  it("derives preview parameters from blueprint defaults and request overrides", () => {
    const blueprint = listTeamBlueprints()[1]!;
    const parameters = resolveTeamBlueprintPreviewParameters(blueprint, {
      projectCount: 3,
      engineerPairsPerProject: 2,
      includeQa: true,
    });

    expect(parameters).toEqual({
      projectCount: 3,
      engineerPairsPerProject: 2,
      includePm: true,
      includeQa: true,
      includeCto: false,
    });
  });

  it("builds preview diff with readiness warnings and missing roles", () => {
    const blueprint = listTeamBlueprints()[1]!;
    const preview = buildTeamBlueprintPreview({
      companyId: "company-1",
      blueprint,
      currentProjects: [
        {
          id: "project-1",
          name: "Product App",
          urlKey: "product-app",
          workspaces: [{ id: "workspace-1" }],
        },
      ],
      currentAgents: [
        {
          id: "agent-1",
          name: "Product PM",
          urlKey: "product-pm",
          role: "pm",
          title: "PM",
          metadata: { deliveryLane: "planning" },
        },
        {
          id: "agent-2",
          name: "Reviewer",
          urlKey: "reviewer",
          role: "engineer",
          title: "Reviewer",
          metadata: { deliveryLane: "review" },
        },
      ],
      setupProgress: {
        companyId: "company-1",
        status: "workspace_connected",
        selectedEngine: "claude_local",
        selectedWorkspaceId: null,
        metadata: {},
        createdAt: new Date("2026-03-14T00:00:00.000Z"),
        updatedAt: new Date("2026-03-14T00:00:00.000Z"),
        steps: {
          companyReady: true,
          squadReady: false,
          engineReady: true,
          workspaceConnected: true,
          knowledgeSeeded: false,
          firstIssueReady: false,
        },
      },
      request: {
        projectCount: 2,
      },
    });

    expect(preview.parameters.projectCount).toBe(2);
    expect(preview.previewHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.projectDiff).toEqual([
      expect.objectContaining({
        templateKey: "product_app",
        status: "adopt_existing",
      }),
      expect.objectContaining({
        templateKey: "product_api",
        status: "create_new",
      }),
    ]);
    expect(preview.roleDiff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          templateKey: "pm",
          status: "ready",
          existingCount: 1,
        }),
        expect.objectContaining({
          templateKey: "engineer",
          status: "missing",
        }),
      ]),
    );
    expect(preview.readinessChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "knowledge_seeded",
          status: "warning",
        }),
        expect.objectContaining({
          key: "selected_workspace",
          status: "warning",
        }),
      ]),
    );
    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Seed knowledge sources"),
        expect.stringContaining("required project slot"),
        expect.stringContaining("Apply should be reviewed"),
      ]),
    );
  });

  it("does not adopt unrelated projects when no positive match exists", () => {
    const blueprint = listTeamBlueprints()[1]!;
    const preview = buildTeamBlueprintPreview({
      companyId: "company-1",
      blueprint,
      currentProjects: [
        {
          id: "project-1",
          name: "Data Pipeline",
          urlKey: "data-pipeline",
          workspaces: [{ id: "workspace-1" }],
        },
      ],
      currentAgents: [],
      setupProgress: {
        companyId: "company-1",
        status: "workspace_connected",
        selectedEngine: "claude_local",
        selectedWorkspaceId: null,
        metadata: {},
        createdAt: new Date("2026-03-14T00:00:00.000Z"),
        updatedAt: new Date("2026-03-14T00:00:00.000Z"),
        steps: {
          companyReady: true,
          squadReady: false,
          engineReady: true,
          workspaceConnected: true,
          knowledgeSeeded: false,
          firstIssueReady: false,
        },
      },
      request: {
        projectCount: 2,
      },
    });

    expect(preview.projectDiff).toEqual([
      expect.objectContaining({
        templateKey: "product_app",
        status: "create_new",
        existingProjectId: null,
      }),
      expect.objectContaining({
        templateKey: "product_api",
        status: "create_new",
        existingProjectId: null,
      }),
    ]);
    expect(preview.summary.adoptedProjectCount).toBe(0);
    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Existing projects beyond the preview match set are left untouched"),
      ]),
    );
  });

  it("computes workspace readiness by covered project slots instead of total workspace count", () => {
    const blueprint = listTeamBlueprints()[1]!;
    const preview = buildTeamBlueprintPreview({
      companyId: "company-1",
      blueprint,
      currentProjects: [
        {
          id: "project-1",
          name: "Product App",
          urlKey: "product-app",
          workspaces: [{ id: "workspace-1" }, { id: "workspace-2" }],
        },
      ],
      currentAgents: [],
      setupProgress: {
        companyId: "company-1",
        status: "workspace_connected",
        selectedEngine: "claude_local",
        selectedWorkspaceId: null,
        metadata: {},
        createdAt: new Date("2026-03-14T00:00:00.000Z"),
        updatedAt: new Date("2026-03-14T00:00:00.000Z"),
        steps: {
          companyReady: true,
          squadReady: false,
          engineReady: true,
          workspaceConnected: true,
          knowledgeSeeded: false,
          firstIssueReady: false,
        },
      },
      request: {
        projectCount: 2,
      },
    });

    expect(preview.summary.currentWorkspaceCount).toBe(2);
    expect(preview.projectDiff[0]).toMatchObject({
      templateKey: "product_app",
      status: "adopt_existing",
      workspaceCount: 2,
    });
    expect(preview.projectDiff[1]).toMatchObject({
      templateKey: "product_api",
      status: "create_new",
      workspaceCount: 0,
    });
    expect(preview.readinessChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "workspace_count",
          status: "warning",
          detail: expect.stringContaining("1/2 required project slot(s)"),
        }),
      ]),
    );
  });

  it("rewires reports and readiness when optional roles are disabled", () => {
    const blueprint = listTeamBlueprints()[1]!;
    const preview = buildTeamBlueprintPreview({
      companyId: "company-1",
      blueprint,
      currentProjects: [],
      currentAgents: [],
      setupProgress: {
        companyId: "company-1",
        status: "company_ready",
        selectedEngine: "claude_local",
        selectedWorkspaceId: null,
        metadata: {},
        createdAt: new Date("2026-03-14T00:00:00.000Z"),
        updatedAt: new Date("2026-03-14T00:00:00.000Z"),
        steps: {
          companyReady: true,
          squadReady: false,
          engineReady: true,
          workspaceConnected: false,
          knowledgeSeeded: false,
          firstIssueReady: false,
        },
      },
      request: {
        includePm: false,
      },
    });

    expect(preview.blueprint.roles.map((role) => role.key)).not.toContain("pm");
    expect(preview.blueprint.roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "app_tech_lead",
          reportsToKey: null,
        }),
        expect.objectContaining({
          key: "backend_tech_lead",
          reportsToKey: null,
        }),
        expect.objectContaining({
          key: "reviewer",
          reportsToKey: null,
        }),
      ]),
    );
    expect(preview.blueprint.readiness.approvalRequiredRoleKeys).not.toContain("pm");
    expect(preview.roleDiff.map((role) => role.templateKey)).not.toContain("pm");
    expect(preview.readinessChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "role_graph",
          status: "warning",
          detail: expect.stringContaining("rewired manager links"),
        }),
      ]),
    );
    });
  });

  it("expands per-project lead requirements when project count exceeds the base template size", () => {
    const blueprint = listTeamBlueprints()[1]!;
    const preview = buildTeamBlueprintPreview({
      companyId: "company-1",
      blueprint,
      currentProjects: [],
      currentAgents: [],
      setupProgress: {
        companyId: "company-1",
        status: "engine_ready",
        selectedEngine: "claude_local",
        selectedWorkspaceId: null,
        metadata: {},
        createdAt: new Date("2026-03-14T00:00:00.000Z"),
        updatedAt: new Date("2026-03-14T00:00:00.000Z"),
        steps: {
          companyReady: true,
          squadReady: false,
          engineReady: true,
          workspaceConnected: false,
          knowledgeSeeded: false,
          firstIssueReady: false,
        },
      },
      request: {
        projectCount: 4,
      },
    });

    expect(preview.projectDiff.map((project) => project.slotKey)).toEqual([
      "product_app",
      "product_api",
      "product_app_2",
      "product_api_2",
    ]);
    expect(preview.roleDiff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          templateKey: "app_tech_lead",
          requiredCount: 2,
          missingCount: 2,
        }),
        expect.objectContaining({
          templateKey: "backend_tech_lead",
          requiredCount: 2,
          missingCount: 2,
        }),
        expect.objectContaining({
          templateKey: "engineer",
          requiredCount: 4,
          missingCount: 4,
        }),
      ]),
    );
  });
