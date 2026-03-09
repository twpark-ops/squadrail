import type { Project } from "@squadrail/shared";
import { readJsonStorageAlias, writeJsonStorageAlias } from "./storage-aliases";

export const PROJECT_ORDER_UPDATED_EVENT = "squadrail:project-order-updated";
export const LEGACY_PROJECT_ORDER_UPDATED_EVENT = "squadrail:project-order-updated";
const PROJECT_ORDER_STORAGE_PREFIX = "squadrail.projectOrder";
const LEGACY_PROJECT_ORDER_STORAGE_PREFIX = "squadrail.projectOrder";
const ANONYMOUS_USER_ID = "anonymous";

type ProjectOrderUpdatedDetail = {
  storageKey: string;
  orderedIds: string[];
};

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function resolveUserId(userId: string | null | undefined): string {
  if (!userId) return ANONYMOUS_USER_ID;
  const trimmed = userId.trim();
  return trimmed.length > 0 ? trimmed : ANONYMOUS_USER_ID;
}

export function getProjectOrderStorageKey(companyId: string, userId: string | null | undefined): string {
  return `${PROJECT_ORDER_STORAGE_PREFIX}:${companyId}:${resolveUserId(userId)}`;
}

export function getLegacyProjectOrderStorageKey(companyId: string, userId: string | null | undefined): string {
  return `${LEGACY_PROJECT_ORDER_STORAGE_PREFIX}:${companyId}:${resolveUserId(userId)}`;
}

export function readProjectOrder(storageKey: string): string[] {
  return normalizeIdList(readJsonStorageAlias(storageKey, undefined, []));
}

export function readProjectOrderWithLegacy(storageKey: string, legacyStorageKey: string): string[] {
  return normalizeIdList(readJsonStorageAlias(storageKey, legacyStorageKey, []));
}

export function writeProjectOrder(storageKey: string, orderedIds: string[], legacyStorageKey?: string) {
  const normalized = normalizeIdList(orderedIds);
  writeJsonStorageAlias(storageKey, legacyStorageKey, normalized);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<ProjectOrderUpdatedDetail>(PROJECT_ORDER_UPDATED_EVENT, {
        detail: { storageKey, orderedIds: normalized },
      }),
    );
    window.dispatchEvent(
      new CustomEvent<ProjectOrderUpdatedDetail>(LEGACY_PROJECT_ORDER_UPDATED_EVENT, {
        detail: { storageKey: legacyStorageKey ?? storageKey, orderedIds: normalized },
      }),
    );
  }
}

export function sortProjectsByStoredOrder(projects: Project[], orderedIds: string[]): Project[] {
  if (projects.length === 0) return [];
  if (orderedIds.length === 0) return projects;

  const byId = new Map(projects.map((project) => [project.id, project]));
  const sorted: Project[] = [];

  for (const id of orderedIds) {
    const project = byId.get(id);
    if (!project) continue;
    sorted.push(project);
    byId.delete(id);
  }
  for (const project of byId.values()) {
    sorted.push(project);
  }
  return sorted;
}
