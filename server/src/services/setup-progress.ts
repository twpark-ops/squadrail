import { and, count, eq } from "drizzle-orm";
import type { Db } from "@squadrail/db";
import { issues, knowledgeDocuments, rolePackSets, setupProgress } from "@squadrail/db";
import {
  SETUP_PROGRESS_STATES,
  type AgentAdapterType,
  type SetupProgress,
  type SetupProgressState,
  type SetupProgressView,
  type UpdateSetupProgress,
} from "@squadrail/shared";

type SetupProgressRow = typeof setupProgress.$inferSelect;

type SetupStepFlags = SetupProgressView["steps"];

function toSetupProgressRow(companyId: string, row: SetupProgressRow | null): SetupProgress {
  return {
    companyId,
    status: (row?.status ?? "not_started") as SetupProgressState,
    selectedEngine: (row?.selectedEngine ?? null) as AgentAdapterType | null,
    selectedWorkspaceId: row?.selectedWorkspaceId ?? null,
    metadata: (row?.metadata as Record<string, unknown> | null) ?? {},
    createdAt: row?.createdAt ?? new Date(0),
    updatedAt: row?.updatedAt ?? new Date(0),
  };
}

function readBooleanMetadata(metadata: Record<string, unknown>, key: string) {
  return metadata[key] === true;
}

export function buildSetupProgressSteps(input: {
  selectedEngine: AgentAdapterType | null;
  selectedWorkspaceId: string | null;
  metadata: Record<string, unknown>;
  publishedRolePackCount: number;
  knowledgeDocumentCount?: number;
  issueCount?: number;
}): SetupStepFlags {
  const squadReady =
    input.publishedRolePackCount > 0 || readBooleanMetadata(input.metadata, "rolePacksSeeded");
  const engineReady = Boolean(input.selectedEngine);
  const workspaceConnected = Boolean(input.selectedWorkspaceId);
  const knowledgeSeeded =
    workspaceConnected &&
    (readBooleanMetadata(input.metadata, "knowledgeSeeded") || (input.knowledgeDocumentCount ?? 0) > 0);
  const firstIssueReady =
    knowledgeSeeded &&
    (readBooleanMetadata(input.metadata, "firstIssueReady") || (input.issueCount ?? 0) > 0);

  return {
    companyReady: true,
    squadReady,
    engineReady,
    workspaceConnected,
    knowledgeSeeded,
    firstIssueReady,
  };
}

export function deriveSetupProgressState(steps: SetupStepFlags): SetupProgressState {
  if (!steps.companyReady) return "not_started";
  if (!steps.squadReady) return "company_ready";
  if (!steps.engineReady) return "squad_ready";
  if (!steps.workspaceConnected) return "engine_ready";
  if (!steps.knowledgeSeeded) return "workspace_connected";
  if (!steps.firstIssueReady) return "knowledge_seeded";
  if (steps.firstIssueReady) return "first_issue_ready";
  return "not_started";
}

function maxSetupProgressState(left: SetupProgressState, right: SetupProgressState): SetupProgressState {
  const leftIndex = SETUP_PROGRESS_STATES.indexOf(left);
  const rightIndex = SETUP_PROGRESS_STATES.indexOf(right);
  return rightIndex > leftIndex ? right : left;
}

async function countPublishedRolePacks(db: Db, companyId: string) {
  const rows = await db
    .select({ count: count() })
    .from(rolePackSets)
    .where(and(eq(rolePackSets.companyId, companyId), eq(rolePackSets.status, "published")));
  return Number(rows[0]?.count ?? 0);
}

async function countKnowledgeDocuments(db: Db, companyId: string) {
  const rows = await db
    .select({ count: count() })
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.companyId, companyId));
  return Number(rows[0]?.count ?? 0);
}

async function countCompanyIssues(db: Db, companyId: string) {
  const rows = await db
    .select({ count: count() })
    .from(issues)
    .where(eq(issues.companyId, companyId));
  return Number(rows[0]?.count ?? 0);
}

export function setupProgressService(db: Db) {
  async function getRaw(companyId: string) {
    return db
      .select()
      .from(setupProgress)
      .where(eq(setupProgress.companyId, companyId))
      .then((rows) => rows[0] ?? null);
  }

  async function getView(companyId: string): Promise<SetupProgressView> {
    const [row, publishedRolePackCount, knowledgeDocumentCount, issueCount] = await Promise.all([
      getRaw(companyId),
      countPublishedRolePacks(db, companyId),
      countKnowledgeDocuments(db, companyId),
      countCompanyIssues(db, companyId),
    ]);
    const base = toSetupProgressRow(companyId, row);
    const steps = buildSetupProgressSteps({
      selectedEngine: base.selectedEngine,
      selectedWorkspaceId: base.selectedWorkspaceId,
      metadata: base.metadata,
      publishedRolePackCount,
      knowledgeDocumentCount,
      issueCount,
    });
    const derivedStatus = deriveSetupProgressState(steps);
    return {
      ...base,
      status: maxSetupProgressState(base.status, derivedStatus),
      steps,
    };
  }

  async function update(companyId: string, patch: UpdateSetupProgress): Promise<SetupProgressView> {
    const current = await getView(companyId);
    const [publishedRolePackCount, knowledgeDocumentCount, issueCount] = await Promise.all([
      countPublishedRolePacks(db, companyId),
      countKnowledgeDocuments(db, companyId),
      countCompanyIssues(db, companyId),
    ]);
    const nextMetadata = patch.metadata
      ? {
          ...current.metadata,
          ...patch.metadata,
        }
      : current.metadata;
    const nextSelectedEngine = patch.selectedEngine === undefined ? current.selectedEngine : patch.selectedEngine;
    const nextSelectedWorkspaceId =
      patch.selectedWorkspaceId === undefined ? current.selectedWorkspaceId : patch.selectedWorkspaceId;
    const nextSteps = buildSetupProgressSteps({
      selectedEngine: nextSelectedEngine,
      selectedWorkspaceId: nextSelectedWorkspaceId,
      metadata: nextMetadata,
      publishedRolePackCount,
      knowledgeDocumentCount,
      issueCount,
    });
    const derivedStatus = deriveSetupProgressState(nextSteps);
    const nextStatus = maxSetupProgressState(
      maxSetupProgressState(current.status, derivedStatus),
      patch.status ?? current.status,
    );

    await db
      .insert(setupProgress)
      .values({
        companyId,
        status: nextStatus,
        selectedEngine: nextSelectedEngine,
        selectedWorkspaceId: nextSelectedWorkspaceId,
        metadata: nextMetadata,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: setupProgress.companyId,
        set: {
          status: nextStatus,
          selectedEngine: nextSelectedEngine,
          selectedWorkspaceId: nextSelectedWorkspaceId,
          metadata: nextMetadata,
          updatedAt: new Date(),
        },
      });

    return getView(companyId);
  }

  return {
    getView,
    update,
  };
}
