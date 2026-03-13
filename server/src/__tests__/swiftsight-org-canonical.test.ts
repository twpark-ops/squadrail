import { describe, expect, it } from "vitest";
import {
  SWIFTSIGHT_CANONICAL_TEMPLATE_KEY,
  SWIFTSIGHT_CANONICAL_VERSION,
  buildCanonicalLookupMaps,
  buildSwiftsightCanonicalBlueprintAbsorptionPrep,
  canonicalTemplateForCompanyName,
  listCanonicalSwiftsightAgents,
  listCanonicalSwiftsightProjects,
} from "../services/swiftsight-org-canonical.js";
import {
  expandTeamBlueprintProjects,
  resolveTeamBlueprint,
  resolveTeamBlueprintPreviewParameters,
} from "../services/team-blueprints.js";

describe("swiftsight org canonical template", () => {
  it("lists the expected canonical projects with lead-agent slugs", () => {
    expect(listCanonicalSwiftsightProjects()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "swiftsight-cloud",
          leadAgentSlug: "swiftsight-cloud-tl",
        }),
        expect.objectContaining({
          slug: "swiftcl",
          leadAgentSlug: "swiftcl-tl",
        }),
      ]),
    );
  });

  it("builds top-level and per-project engineer pairs with adapter defaults", () => {
    const agents = listCanonicalSwiftsightAgents();

    expect(agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalSlug: "swiftsight-cto",
          adapterType: "claude_local",
          metadata: expect.objectContaining({
            canonicalTemplateKey: SWIFTSIGHT_CANONICAL_TEMPLATE_KEY,
            canonicalTemplateVersion: SWIFTSIGHT_CANONICAL_VERSION,
          }),
        }),
        expect.objectContaining({
          canonicalSlug: "swiftsight-cloud-codex-engineer",
          adapterType: "codex_local",
          deliveryLane: "implementation",
          legacySlugs: ["swiftsight-cloud-engineer"],
        }),
        expect.objectContaining({
          canonicalSlug: "swiftsight-cloud-claude-engineer",
          adapterType: "claude_local",
          deliveryLane: "analysis",
        }),
      ]),
    );
  });

  it("builds lookup maps for canonical, url-key, and legacy slug resolution", () => {
    const lookup = buildCanonicalLookupMaps();

    expect(lookup.bySlug.get("swiftsight-python-tl")).toMatchObject({
      canonicalSlug: "swiftsight-python-tl",
      legacySlugs: ["python-tl"],
    });
    expect(lookup.byUrlKey.get("swiftsight-python-tl")).toMatchObject({
      canonicalSlug: "swiftsight-python-tl",
    });
    expect(lookup.legacySlugMap.get("python-tl")).toMatchObject({
      canonicalSlug: "swiftsight-python-tl",
    });
  });

  it("only exposes the template for the exact cloud-swiftsight company name", () => {
    expect(canonicalTemplateForCompanyName("cloud-swiftsight")).toMatchObject({
      templateKey: SWIFTSIGHT_CANONICAL_TEMPLATE_KEY,
      canonicalVersion: SWIFTSIGHT_CANONICAL_VERSION,
      blueprintAbsorptionPrep: expect.objectContaining({
        blueprintKey: "delivery_plus_qa",
      }),
    });
    expect(canonicalTemplateForCompanyName("Cloud Swiftsight")).toBeNull();
    expect(canonicalTemplateForCompanyName(null)).toBeNull();
  });

  it("builds a generic blueprint absorption prep map for swiftsight", () => {
    const prep = buildSwiftsightCanonicalBlueprintAbsorptionPrep();
    const blueprint = resolveTeamBlueprint(prep.blueprintKey);
    expect(blueprint).not.toBeNull();
    const parameters = resolveTeamBlueprintPreviewParameters(blueprint!, prep.previewRequest);
    const projectSlots = expandTeamBlueprintProjects(blueprint!, parameters);

    expect(prep).toMatchObject({
      canonicalTemplateKey: SWIFTSIGHT_CANONICAL_TEMPLATE_KEY,
      canonicalVersion: SWIFTSIGHT_CANONICAL_VERSION,
      blueprintKey: "delivery_plus_qa",
      previewRequest: {
        projectCount: 5,
        engineerPairsPerProject: 1,
        includePm: true,
        includeQa: true,
        includeCto: true,
      },
    });
    expect(prep.projectMappings).toHaveLength(projectSlots.length);
    expect(prep.projectMappings.map((entry) => entry.blueprintSlotKey)).toEqual(projectSlots.map((slot) => slot.slotKey));
    expect(prep.projectMappings.map((entry) => entry.blueprintTemplateKey)).toEqual(projectSlots.map((slot) => slot.templateKey));
    expect(prep.projectMappings.map((entry) => entry.expectedLeadRoleKey)).toEqual(
      projectSlots.map((slot) => slot.defaultLeadRoleKey),
    );
    expect(prep.warnings.length).toBeGreaterThan(0);
  });
});
