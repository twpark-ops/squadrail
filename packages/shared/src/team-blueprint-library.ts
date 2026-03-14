import { buildDefaultTeamBlueprintPreviewRequest } from "./team-blueprint-parameters.js";
import type {
  CompanySavedTeamBlueprint,
  SavedTeamBlueprintLifecycleState,
  SavedTeamBlueprintSourceMetadata,
} from "./types/team-blueprint.js";

export type SavedTeamBlueprintVersionInfo = {
  lineageKey: string;
  version: number;
  parentSavedBlueprintId: string | null;
  versionNote: string | null;
};

export type SavedTeamBlueprintVersionChange = {
  key: string;
  label: string;
  before: string;
  after: string;
};

export function canReplaceSavedTeamBlueprintFromImport(
  blueprint: Pick<CompanySavedTeamBlueprint, "id" | "sourceMetadata">,
): boolean {
  const lifecycleState = resolveSavedTeamBlueprintLifecycleState(blueprint);
  const metadata = blueprint.sourceMetadata as SavedTeamBlueprintSourceMetadata;
  return lifecycleState === "draft" && metadata.type === "import_bundle";
}

export function describeSavedTeamBlueprintImportReplaceRestriction(
  blueprint: Pick<CompanySavedTeamBlueprint, "id" | "sourceMetadata">,
): string | null {
  if (canReplaceSavedTeamBlueprintFromImport(blueprint)) return null;
  const lifecycleState = resolveSavedTeamBlueprintLifecycleState(blueprint);
  if (lifecycleState !== "draft") {
    return "Replace is only allowed for draft saved blueprints. Published or superseded versions must be imported as a new library entry or saved as a new version.";
  }
  return "Replace is only allowed for imported draft saved blueprints. Company-authored or versioned entries must be imported as a new library entry or saved as a new version.";
}

export function canDeleteSavedTeamBlueprint(
  blueprint: Pick<CompanySavedTeamBlueprint, "id" | "sourceMetadata">,
  lineageEntries: Array<Pick<CompanySavedTeamBlueprint, "id" | "sourceMetadata">>,
): boolean {
  if (resolveSavedTeamBlueprintLifecycleState(blueprint) !== "draft") return false;
  return !lineageEntries.some((entry) => {
    const versionInfo = resolveSavedTeamBlueprintVersionInfo(entry as Pick<CompanySavedTeamBlueprint, "id" | "sourceMetadata">);
    return versionInfo.parentSavedBlueprintId === blueprint.id;
  });
}

export function describeSavedTeamBlueprintDeleteRestriction(
  blueprint: Pick<CompanySavedTeamBlueprint, "id" | "sourceMetadata">,
  lineageEntries: Array<Pick<CompanySavedTeamBlueprint, "id" | "sourceMetadata">>,
): string | null {
  const lifecycleState = resolveSavedTeamBlueprintLifecycleState(blueprint);
  if (lifecycleState !== "draft") {
    return "Only draft saved blueprints can be deleted from the library. Published or superseded versions stay immutable to preserve version history.";
  }
  if (lineageEntries.some((entry) => {
    const versionInfo = resolveSavedTeamBlueprintVersionInfo(entry as Pick<CompanySavedTeamBlueprint, "id" | "sourceMetadata">);
    return versionInfo.parentSavedBlueprintId === blueprint.id;
  })) {
    return "Cannot delete a saved blueprint that already has child versions. Create a new draft or prune descendants first.";
  }
  return null;
}

export function resolveSavedTeamBlueprintVersionInfo(
  blueprint: Pick<CompanySavedTeamBlueprint, "id" | "sourceMetadata">,
): SavedTeamBlueprintVersionInfo {
  const metadata = blueprint.sourceMetadata as SavedTeamBlueprintSourceMetadata;
  return {
    lineageKey: metadata.lineageKey?.trim() || blueprint.id,
    version: metadata.version && metadata.version > 0 ? metadata.version : 1,
    parentSavedBlueprintId: metadata.parentSavedBlueprintId ?? null,
    versionNote: metadata.versionNote?.trim() || null,
  };
}

export function resolveSavedTeamBlueprintLifecycleState(
  blueprint: Pick<CompanySavedTeamBlueprint, "sourceMetadata">,
): SavedTeamBlueprintLifecycleState {
  const metadata = blueprint.sourceMetadata as SavedTeamBlueprintSourceMetadata;
  return metadata.lifecycleState ?? "draft";
}

export function buildNextSavedTeamBlueprintVersionSlug(baseSlug: string, nextVersion: number) {
  return `${baseSlug}-v${nextVersion}`;
}

export function buildNextSavedTeamBlueprintVersionLabel(baseLabel: string, nextVersion: number) {
  return `${baseLabel} v${nextVersion}`;
}

export function describeSavedTeamBlueprintVersionChanges(
  current: Pick<CompanySavedTeamBlueprint, "definition" | "defaultPreviewRequest" | "sourceMetadata">,
  previous: Pick<CompanySavedTeamBlueprint, "definition" | "defaultPreviewRequest" | "sourceMetadata"> | null,
): SavedTeamBlueprintVersionChange[] {
  if (!previous) return [];

  const changes: SavedTeamBlueprintVersionChange[] = [];
  const pushIfChanged = (key: string, label: string, before: string | null | undefined, after: string | null | undefined) => {
    const normalizedBefore = before?.trim() || "none";
    const normalizedAfter = after?.trim() || "none";
    if (normalizedBefore !== normalizedAfter) {
      changes.push({
        key,
        label,
        before: normalizedBefore,
        after: normalizedAfter,
      });
    }
  };

  pushIfChanged("label", "Library label", previous.definition.label, current.definition.label);
  pushIfChanged("slug", "Slug", previous.definition.slug, current.definition.slug);
  pushIfChanged("description", "Description", previous.definition.description, current.definition.description);

  const previousVersionInfo = resolveSavedTeamBlueprintVersionInfo({
    id: "previous",
    sourceMetadata: previous.sourceMetadata,
  } as Pick<CompanySavedTeamBlueprint, "id" | "sourceMetadata">);
  const currentVersionInfo = resolveSavedTeamBlueprintVersionInfo({
    id: "current",
    sourceMetadata: current.sourceMetadata,
  } as Pick<CompanySavedTeamBlueprint, "id" | "sourceMetadata">);
  pushIfChanged("versionNote", "Version note", previousVersionInfo.versionNote, currentVersionInfo.versionNote);

  const previousDefaults = buildDefaultTeamBlueprintPreviewRequest(previous.definition, previous.defaultPreviewRequest);
  const currentDefaults = buildDefaultTeamBlueprintPreviewRequest(current.definition, current.defaultPreviewRequest);
  const parameterLabels = {
    projectCount: "Project slots",
    engineerPairsPerProject: "Engineer pair(s) per project",
    includePm: "Include PM lane",
    includeQa: "Include QA lane",
    includeCto: "Include CTO oversight",
  } as const;
  const parameterKeys = Object.keys(parameterLabels) as Array<keyof typeof parameterLabels>;
  for (const key of parameterKeys) {
    const before = String(previousDefaults[key]);
    const after = String(currentDefaults[key]);
    if (before !== after) {
      changes.push({
        key,
        label: parameterLabels[key],
        before,
        after,
      });
    }
  }

  if (previous.definition.projects.length !== current.definition.projects.length) {
    changes.push({
      key: "projectTemplates",
      label: "Project template count",
      before: String(previous.definition.projects.length),
      after: String(current.definition.projects.length),
    });
  }

  if (previous.definition.roles.length !== current.definition.roles.length) {
    changes.push({
      key: "roleTemplates",
      label: "Role template count",
      before: String(previous.definition.roles.length),
      after: String(current.definition.roles.length),
    });
  }

  return changes;
}
