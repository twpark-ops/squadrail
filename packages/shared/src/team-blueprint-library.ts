import type { CompanySavedTeamBlueprint, SavedTeamBlueprintSourceMetadata } from "./types/team-blueprint.js";

export type SavedTeamBlueprintVersionInfo = {
  lineageKey: string;
  version: number;
  parentSavedBlueprintId: string | null;
  versionNote: string | null;
};

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

export function buildNextSavedTeamBlueprintVersionSlug(baseSlug: string, nextVersion: number) {
  return `${baseSlug}-v${nextVersion}`;
}

export function buildNextSavedTeamBlueprintVersionLabel(baseLabel: string, nextVersion: number) {
  return `${baseLabel} v${nextVersion}`;
}
