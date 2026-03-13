import { describe, expect, it } from "vitest";
import { listTeamBlueprints, teamBlueprintService } from "../services/team-blueprints.js";

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
});
