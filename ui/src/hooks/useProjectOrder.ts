import { useCallback, useEffect, useMemo, useState } from "react";
import type { Project } from "@squadrail/shared";
import {
  getProjectOrderStorageKey,
  getLegacyProjectOrderStorageKey,
  PROJECT_ORDER_UPDATED_EVENT,
  LEGACY_PROJECT_ORDER_UPDATED_EVENT,
  readProjectOrder,
  readProjectOrderWithLegacy,
  sortProjectsByStoredOrder,
  writeProjectOrder,
} from "../lib/project-order";

type UseProjectOrderParams = {
  projects: Project[];
  companyId: string | null | undefined;
  userId: string | null | undefined;
};

type ProjectOrderUpdatedDetail = {
  storageKey: string;
  orderedIds: string[];
};

function areEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function buildOrderIds(projects: Project[], orderedIds: string[]) {
  return sortProjectsByStoredOrder(projects, orderedIds).map((project) => project.id);
}

export function useProjectOrder({ projects, companyId, userId }: UseProjectOrderParams) {
  const storageKey = useMemo(() => {
    if (!companyId) return null;
    return getProjectOrderStorageKey(companyId, userId);
  }, [companyId, userId]);
  const legacyStorageKey = useMemo(() => {
    if (!companyId) return null;
    return getLegacyProjectOrderStorageKey(companyId, userId);
  }, [companyId, userId]);

  const [orderedIds, setOrderedIds] = useState<string[]>(() => {
    if (!storageKey) return projects.map((project) => project.id);
    return buildOrderIds(projects, readProjectOrderWithLegacy(storageKey, legacyStorageKey ?? storageKey));
  });

  useEffect(() => {
    const nextIds = storageKey
      ? buildOrderIds(projects, readProjectOrderWithLegacy(storageKey, legacyStorageKey ?? storageKey))
      : projects.map((project) => project.id);
    setOrderedIds((current) => (areEqual(current, nextIds) ? current : nextIds));
  }, [projects, storageKey, legacyStorageKey]);

  useEffect(() => {
    if (!storageKey) return;

    const syncFromIds = (ids: string[]) => {
      const nextIds = buildOrderIds(projects, ids);
      setOrderedIds((current) => (areEqual(current, nextIds) ? current : nextIds));
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== legacyStorageKey) return;
      syncFromIds(readProjectOrderWithLegacy(storageKey, legacyStorageKey ?? storageKey));
    };
    const onCustomEvent = (event: Event) => {
      const detail = (event as CustomEvent<ProjectOrderUpdatedDetail>).detail;
      if (!detail || (detail.storageKey !== storageKey && detail.storageKey !== legacyStorageKey)) return;
      syncFromIds(detail.orderedIds);
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(PROJECT_ORDER_UPDATED_EVENT, onCustomEvent);
    window.addEventListener(LEGACY_PROJECT_ORDER_UPDATED_EVENT, onCustomEvent);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(PROJECT_ORDER_UPDATED_EVENT, onCustomEvent);
      window.removeEventListener(LEGACY_PROJECT_ORDER_UPDATED_EVENT, onCustomEvent);
    };
  }, [projects, storageKey, legacyStorageKey]);

  const orderedProjects = useMemo(
    () => sortProjectsByStoredOrder(projects, orderedIds),
    [projects, orderedIds],
  );

  const persistOrder = useCallback(
    (ids: string[]) => {
      const idSet = new Set(projects.map((project) => project.id));
      const filtered = ids.filter((id) => idSet.has(id));
      for (const project of projects) {
        if (!filtered.includes(project.id)) filtered.push(project.id);
      }

      setOrderedIds((current) => (areEqual(current, filtered) ? current : filtered));
      if (storageKey) {
        writeProjectOrder(storageKey, filtered, legacyStorageKey ?? undefined);
      }
    },
    [projects, storageKey, legacyStorageKey],
  );

  return {
    orderedProjects,
    orderedIds,
    persistOrder,
  };
}
