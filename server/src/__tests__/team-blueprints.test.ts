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
    });
    expect(view.blueprints).toHaveLength(3);

    view.blueprints[0]!.projects[0]!.label = "Mutated";
    const second = service.getCatalog("company-1");
    expect(second.blueprints[0]!.projects[0]!.label).toBe("Primary Product");
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
        expect.stringContaining("required workspace slot"),
        expect.stringContaining("Apply should be reviewed"),
      ]),
    );
  });
});
