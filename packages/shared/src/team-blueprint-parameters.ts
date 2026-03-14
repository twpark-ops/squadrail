import type {
  TeamBlueprint,
  TeamBlueprintParameterEditors,
  TeamBlueprintParameterHints,
  TeamBlueprintPreviewRequest,
} from "./types/team-blueprint.js";

function cloneEditors(editors: TeamBlueprintParameterEditors): TeamBlueprintParameterEditors {
  return {
    projectCount: { ...editors.projectCount },
    engineerPairsPerProject: { ...editors.engineerPairsPerProject },
    includePm: { ...editors.includePm },
    includeQa: { ...editors.includeQa },
    includeCto: { ...editors.includeCto },
  };
}

export function resolveTeamBlueprintParameterEditors(
  parameterHints: TeamBlueprintParameterHints,
): TeamBlueprintParameterEditors {
  if (parameterHints.editors) {
    return cloneEditors(parameterHints.editors);
  }

  return {
    projectCount: {
      label: "Project slots",
      description: "How many project lanes the preview/apply plan should cover.",
      min: 1,
      max: 20,
      step: 1,
    },
    engineerPairsPerProject: {
      label: "Engineer pair(s) per project",
      description: "How many implementation engineer slots to provision for each project lane.",
      min: 1,
      max: 10,
      step: 1,
    },
    includePm: {
      label: "Include PM lane",
      description: "Keep the PM planning and clarification lane in the generated team shape.",
      editable: parameterHints.supportsPm,
    },
    includeQa: {
      label: "Include QA lane",
      description: "Keep dedicated QA coverage in the generated team shape.",
      editable: parameterHints.supportsQa,
    },
    includeCto: {
      label: "Include CTO oversight",
      description: "Keep executive cross-project oversight in the generated team shape.",
      editable: parameterHints.supportsCto,
    },
  };
}

export function buildDefaultTeamBlueprintPreviewRequest(
  blueprintOrHints: Pick<TeamBlueprint, "parameterHints"> | TeamBlueprintParameterHints,
  overrides?: TeamBlueprintPreviewRequest,
): TeamBlueprintPreviewRequest {
  const parameterHints = "parameterHints" in blueprintOrHints
    ? blueprintOrHints.parameterHints
    : blueprintOrHints;
  const editors = resolveTeamBlueprintParameterEditors(parameterHints);

  return {
    projectCount: Math.max(
      editors.projectCount.min,
      Math.min(
        editors.projectCount.max,
        overrides?.projectCount ?? parameterHints.defaultProjectCount,
      ),
    ),
    engineerPairsPerProject: Math.max(
      editors.engineerPairsPerProject.min,
      Math.min(
        editors.engineerPairsPerProject.max,
        overrides?.engineerPairsPerProject ?? parameterHints.defaultEngineerPairsPerProject,
      ),
    ),
    includePm: parameterHints.supportsPm ? (overrides?.includePm ?? parameterHints.supportsPm) : false,
    includeQa: parameterHints.supportsQa ? (overrides?.includeQa ?? parameterHints.supportsQa) : false,
    includeCto: parameterHints.supportsCto ? (overrides?.includeCto ?? parameterHints.supportsCto) : false,
  };
}
