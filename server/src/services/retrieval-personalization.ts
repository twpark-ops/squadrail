import { and, desc, eq, gte, inArray, isNull, isNotNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "@squadrail/db";
import {
  issueProtocolMessages,
  issueTaskBriefs,
  issues,
  retrievalFeedbackEvents,
  retrievalRoleProfiles,
  retrievalRuns,
} from "@squadrail/db";
import { isKnowledgeSummarySourceType, type CreateIssueProtocolMessage } from "@squadrail/shared";
import { knowledgeService } from "./knowledge.js";

const PROFILE_WINDOW_DAYS = 120;
const MAX_PROFILE_KEYS = {
  source_type: 12,
  path: 24,
  symbol: 24,
} as const;

type RetrievalFeedbackType =
  | "approved"
  | "request_changes"
  | "merge_completed"
  | "merge_rejected"
  | "operator_pin"
  | "operator_hide";
type RetrievalFeedbackTargetType = "chunk" | "path" | "symbol" | "source_type";
type RetrievalPersonalizationScope = "global" | "project";

type RetrievalFeedbackAggregateEvent = {
  targetType: RetrievalFeedbackTargetType;
  targetId: string;
  weight: number;
  feedbackType: RetrievalFeedbackType;
  createdAt?: Date;
};

type RetrievalProfileBoostMap = Record<string, number>;

export interface RetrievalRoleProfileJson {
  version: 1;
  sourceTypeBoosts: RetrievalProfileBoostMap;
  pathBoosts: RetrievalProfileBoostMap;
  symbolBoosts: RetrievalProfileBoostMap;
  stats: {
    feedbackCount: number;
    positiveFeedbackCount: number;
    negativeFeedbackCount: number;
    mergeCompletedCount: number;
    mergeRejectedCount: number;
    operatorPinCount: number;
    operatorHideCount: number;
    lastFeedbackAt: string | null;
  };
  generatedAt: string;
}

export interface RetrievalPersonalizationProfile {
  applied: boolean;
  scopes: RetrievalPersonalizationScope[];
  feedbackCount: number;
  positiveFeedbackCount: number;
  negativeFeedbackCount: number;
  sourceTypeBoosts: RetrievalProfileBoostMap;
  pathBoosts: RetrievalProfileBoostMap;
  symbolBoosts: RetrievalProfileBoostMap;
}

export interface RetrievalPersonalizationBoost {
  applied: boolean;
  totalBoost: number;
  sourceTypeBoost: number;
  pathBoost: number;
  symbolBoost: number;
  scopes: RetrievalPersonalizationScope[];
  matchedSourceType: string | null;
  matchedPath: string | null;
  matchedSymbol: string | null;
}

type RetrievalFeedbackDescriptor = {
  feedbackType: RetrievalFeedbackType;
  baseWeight: number;
};

type RetrievalRunFeedbackContext = {
  id: string;
  issueId: string | null;
  actorRole: string;
  eventType: string;
  queryDebug: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizePath(value: string | null | undefined) {
  if (!value) return null;
  return value.replace(/\\/gu, "/").replace(/^\.\/+/u, "").trim() || null;
}

export function isPersonalizablePathTarget(path: string | null | undefined) {
  const normalizedPath = normalizePath(path);
  if (!normalizedPath) return false;
  if (normalizedPath.startsWith("issues/")) return false;
  if (normalizedPath.startsWith("docs/")) return false;
  if (normalizedPath.startsWith(".squadrail-")) return false;
  if (normalizedPath.endsWith(".md")) return false;
  if (normalizedPath.endsWith(".rst")) return false;
  if (normalizedPath.endsWith(".adoc")) return false;
  if (normalizedPath.endsWith(".txt")) return false;
  return true;
}

function isPathBoostEligibleSourceType(sourceType: string) {
  return sourceType === "code" || sourceType === "test_report" || isKnowledgeSummarySourceType(sourceType);
}

function sortBoostMap(input: Record<string, number>, limit: number) {
  return Object.fromEntries(
    Object.entries(input)
      .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
      .slice(0, limit),
  );
}

export function normalizeBoost(input: {
  targetType: "source_type" | "path" | "symbol";
  rawWeight: number;
}) {
  const magnitude = Math.sign(input.rawWeight) * Math.log1p(Math.abs(input.rawWeight));
  switch (input.targetType) {
    case "source_type":
      return clamp(magnitude * 0.24, -0.45, 0.65);
    case "path":
      return clamp(magnitude * 0.18, -0.55, 0.8);
    case "symbol":
      return clamp(magnitude * 0.16, -0.45, 0.72);
  }
}

export function mergeBoostMaps(input: {
  global: Record<string, number>;
  project: Record<string, number>;
  targetType: "source_type" | "path" | "symbol";
}) {
  const keys = new Set([...Object.keys(input.global), ...Object.keys(input.project)]);
  const merged: Record<string, number> = {};
  const bounds = {
    source_type: { min: -0.45, max: 0.65 },
    path: { min: -0.55, max: 0.8 },
    symbol: { min: -0.45, max: 0.72 },
  }[input.targetType];
  for (const key of keys) {
    const combined = (input.global[key] ?? 0) + (input.project[key] ?? 0) * 1.15;
    if (Math.abs(combined) < 0.02) continue;
    merged[key] = clamp(combined, bounds.min, bounds.max);
  }
  return sortBoostMap(merged, MAX_PROFILE_KEYS[input.targetType]);
}

export function parseRoleProfileJson(value: unknown): RetrievalRoleProfileJson {
  const record = asRecord(value);
  const stats = asRecord(record.stats);
  return {
    version: 1,
    sourceTypeBoosts: Object.fromEntries(
      Object.entries(asRecord(record.sourceTypeBoosts))
        .filter((entry): entry is [string, number] => typeof entry[0] === "string" && typeof entry[1] === "number"),
    ),
    pathBoosts: Object.fromEntries(
      Object.entries(asRecord(record.pathBoosts))
        .filter((entry): entry is [string, number] => typeof entry[0] === "string" && typeof entry[1] === "number"),
    ),
    symbolBoosts: Object.fromEntries(
      Object.entries(asRecord(record.symbolBoosts))
        .filter((entry): entry is [string, number] => typeof entry[0] === "string" && typeof entry[1] === "number"),
    ),
    stats: {
      feedbackCount: typeof stats.feedbackCount === "number" ? stats.feedbackCount : 0,
      positiveFeedbackCount: typeof stats.positiveFeedbackCount === "number" ? stats.positiveFeedbackCount : 0,
      negativeFeedbackCount: typeof stats.negativeFeedbackCount === "number" ? stats.negativeFeedbackCount : 0,
      mergeCompletedCount: typeof stats.mergeCompletedCount === "number" ? stats.mergeCompletedCount : 0,
      mergeRejectedCount: typeof stats.mergeRejectedCount === "number" ? stats.mergeRejectedCount : 0,
      operatorPinCount: typeof stats.operatorPinCount === "number" ? stats.operatorPinCount : 0,
      operatorHideCount: typeof stats.operatorHideCount === "number" ? stats.operatorHideCount : 0,
      lastFeedbackAt: readString(stats.lastFeedbackAt),
    },
    generatedAt: readString(record.generatedAt) ?? new Date(0).toISOString(),
  };
}

export function aggregateRetrievalFeedbackProfile(input: {
  events: RetrievalFeedbackAggregateEvent[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const positiveFeedbackCount = input.events.filter((event) => event.weight > 0).length;
  const negativeFeedbackCount = input.events.filter((event) => event.weight < 0).length;
  const mergeCompletedCount = input.events.filter((event) => event.feedbackType === "merge_completed").length;
  const mergeRejectedCount = input.events.filter((event) => event.feedbackType === "merge_rejected").length;
  const operatorPinCount = input.events.filter((event) => event.feedbackType === "operator_pin").length;
  const operatorHideCount = input.events.filter((event) => event.feedbackType === "operator_hide").length;
  const grouped = {
    source_type: new Map<string, number>(),
    path: new Map<string, number>(),
    symbol: new Map<string, number>(),
  };

  for (const event of input.events) {
    if (event.targetType === "chunk") continue;
    if (event.targetType === "path" && !isPersonalizablePathTarget(event.targetId)) continue;
    const current = grouped[event.targetType].get(event.targetId) ?? 0;
    grouped[event.targetType].set(event.targetId, current + event.weight);
  }

  const toBoostMap = (targetType: "source_type" | "path" | "symbol") => {
    const entries = Array.from(grouped[targetType].entries())
      .map(([targetId, rawWeight]) => [targetId, normalizeBoost({ targetType, rawWeight })] as const)
      .filter((entry) => Math.abs(entry[1]) >= 0.04)
      .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
      .slice(0, MAX_PROFILE_KEYS[targetType]);
    return Object.fromEntries(entries);
  };

  return {
    version: 1,
    sourceTypeBoosts: toBoostMap("source_type"),
    pathBoosts: toBoostMap("path"),
    symbolBoosts: toBoostMap("symbol"),
    stats: {
      feedbackCount: input.events.length,
      positiveFeedbackCount,
      negativeFeedbackCount,
      mergeCompletedCount,
      mergeRejectedCount,
      operatorPinCount,
      operatorHideCount,
      lastFeedbackAt: input.events
        .map((event) => event.createdAt?.toISOString() ?? null)
        .filter((value): value is string => value != null)
        .sort()
        .pop() ?? null,
    },
    generatedAt: now.toISOString(),
  } satisfies RetrievalRoleProfileJson;
}

export function mergeRetrievalPersonalizationProfiles(input: {
  globalProfile?: RetrievalRoleProfileJson | null;
  projectProfile?: RetrievalRoleProfileJson | null;
}): RetrievalPersonalizationProfile {
  const globalProfile = input.globalProfile ?? null;
  const projectProfile = input.projectProfile ?? null;
  const scopes: RetrievalPersonalizationScope[] = [];
  if (globalProfile && globalProfile.stats.feedbackCount > 0) scopes.push("global");
  if (projectProfile && projectProfile.stats.feedbackCount > 0) scopes.push("project");

  if (scopes.length === 0) {
    return {
      applied: false,
      scopes: [],
      feedbackCount: 0,
      positiveFeedbackCount: 0,
      negativeFeedbackCount: 0,
      sourceTypeBoosts: {},
      pathBoosts: {},
      symbolBoosts: {},
    };
  }

  return {
    applied: true,
    scopes,
    feedbackCount: (globalProfile?.stats.feedbackCount ?? 0) + (projectProfile?.stats.feedbackCount ?? 0),
    positiveFeedbackCount:
      (globalProfile?.stats.positiveFeedbackCount ?? 0) + (projectProfile?.stats.positiveFeedbackCount ?? 0),
    negativeFeedbackCount:
      (globalProfile?.stats.negativeFeedbackCount ?? 0) + (projectProfile?.stats.negativeFeedbackCount ?? 0),
    sourceTypeBoosts: mergeBoostMaps({
      global: globalProfile?.sourceTypeBoosts ?? {},
      project: projectProfile?.sourceTypeBoosts ?? {},
      targetType: "source_type",
    }),
    pathBoosts: mergeBoostMaps({
      global: globalProfile?.pathBoosts ?? {},
      project: projectProfile?.pathBoosts ?? {},
      targetType: "path",
    }),
    symbolBoosts: mergeBoostMaps({
      global: globalProfile?.symbolBoosts ?? {},
      project: projectProfile?.symbolBoosts ?? {},
      targetType: "symbol",
    }),
  };
}

export function computeRetrievalPersonalizationBoost(input: {
  hit: {
    sourceType: string;
    path: string | null;
    symbolName: string | null;
  };
  profile?: RetrievalPersonalizationProfile | null;
}): RetrievalPersonalizationBoost {
  const profile = input.profile;
  if (!profile?.applied) {
    return {
      applied: false,
      totalBoost: 0,
      sourceTypeBoost: 0,
      pathBoost: 0,
      symbolBoost: 0,
      scopes: [],
      matchedSourceType: null,
      matchedPath: null,
      matchedSymbol: null,
    };
  }

  const normalizedPath = normalizePath(input.hit.path);
  const sourceTypeBoost = profile.sourceTypeBoosts[input.hit.sourceType] ?? 0;
  const pathBoost =
    normalizedPath && isPathBoostEligibleSourceType(input.hit.sourceType) && isPersonalizablePathTarget(normalizedPath)
      ? (profile.pathBoosts[normalizedPath] ?? 0)
      : 0;
  const symbolBoost = input.hit.symbolName ? (profile.symbolBoosts[input.hit.symbolName] ?? 0) : 0;
  const totalBoost = sourceTypeBoost + pathBoost + symbolBoost;

  return {
    applied: Math.abs(totalBoost) >= 0.02,
    totalBoost,
    sourceTypeBoost,
    pathBoost,
    symbolBoost,
    scopes: profile.scopes,
    matchedSourceType: Math.abs(sourceTypeBoost) >= 0.02 ? input.hit.sourceType : null,
    matchedPath: Math.abs(pathBoost) >= 0.02 ? normalizedPath : null,
    matchedSymbol: Math.abs(symbolBoost) >= 0.02 ? input.hit.symbolName : null,
  };
}

export function describeProtocolFeedback(message: CreateIssueProtocolMessage): RetrievalFeedbackDescriptor | null {
  switch (message.messageType) {
    case "REQUEST_CHANGES":
      return { feedbackType: "request_changes", baseWeight: -1 };
    case "APPROVE_IMPLEMENTATION":
      return { feedbackType: "approved", baseWeight: 1 };
    case "CLOSE_TASK":
      return {
        feedbackType: readString((message.payload as Record<string, unknown>).mergeStatus) === "merged"
          ? "merge_completed"
          : "approved",
        baseWeight: readString((message.payload as Record<string, unknown>).mergeStatus) === "merged" ? 1.2 : 0.75,
      };
    default:
      return null;
  }
}

export function describeManualFeedback(feedbackType: "operator_pin" | "operator_hide"): RetrievalFeedbackDescriptor {
  return feedbackType === "operator_pin"
    ? { feedbackType, baseWeight: 1.05 }
    : { feedbackType, baseWeight: -0.9 };
}

export function describeMergeOutcomeFeedback(
  outcome: "merge_completed" | "merge_rejected",
): RetrievalFeedbackDescriptor {
  return outcome === "merge_completed"
    ? { feedbackType: outcome, baseWeight: 1.2 }
    : { feedbackType: outcome, baseWeight: -1.05 };
}

export function fallbackBriefScopes(input: {
  senderRole: string;
  messageType: CreateIssueProtocolMessage["messageType"];
}) {
  const byRole: Record<string, string[]> = {
    reviewer: ["reviewer"],
    qa: ["qa", "reviewer"],
    tech_lead: ["tech_lead", "reviewer"],
    cto: ["cto", "tech_lead", "reviewer"],
    pm: ["pm", "tech_lead", "reviewer"],
    human_board: ["global", "qa", "reviewer", "tech_lead", "pm", "cto"],
    engineer: ["engineer"],
  };
  const scopes = [...(byRole[input.senderRole] ?? ["reviewer"])];
  if (input.messageType === "CLOSE_TASK") {
    return Array.from(new Set(["closure", ...scopes, "qa", "reviewer", "tech_lead"]));
  }
  return Array.from(new Set(scopes));
}

export function buildFeedbackEvents(input: {
  companyId: string;
  projectId: string | null;
  issueId: string | null;
  retrievalRunId: string;
  feedbackMessageId: string | null;
  actorRole: string;
  eventType: string;
  feedbackType: RetrievalFeedbackType;
  baseWeight: number;
  hits: Array<{
    chunkId: string;
    finalRank: number | null;
    sourceType: string;
    documentPath: string | null;
    symbolName: string | null;
    rationale: string | null;
    fusedScore: number | null;
  }>;
}) {
  const events: Array<typeof retrievalFeedbackEvents.$inferInsert> = [];
  for (const hit of input.hits) {
    const rankFactor = hit.finalRank == null ? 0.32 : Math.max(0.2, 1.1 - (hit.finalRank - 1) * 0.14);
    const chunkWeight = input.baseWeight * rankFactor;
    const metadata = {
      finalRank: hit.finalRank,
      rationale: hit.rationale,
      fusedScore: hit.fusedScore,
    };
    events.push({
      companyId: input.companyId,
      projectId: input.projectId,
      issueId: input.issueId,
      retrievalRunId: input.retrievalRunId,
      feedbackMessageId: input.feedbackMessageId,
      actorRole: input.actorRole,
      eventType: input.eventType,
      feedbackType: input.feedbackType,
      targetType: "chunk",
      targetId: hit.chunkId,
      weight: chunkWeight,
      metadata,
    });
    events.push({
      companyId: input.companyId,
      projectId: input.projectId,
      issueId: input.issueId,
      retrievalRunId: input.retrievalRunId,
      feedbackMessageId: input.feedbackMessageId,
      actorRole: input.actorRole,
      eventType: input.eventType,
      feedbackType: input.feedbackType,
      targetType: "source_type",
      targetId: hit.sourceType,
      weight: chunkWeight * 0.45,
      metadata,
    });
    const normalizedPath = normalizePath(hit.documentPath);
    if (normalizedPath && isPathBoostEligibleSourceType(hit.sourceType) && isPersonalizablePathTarget(normalizedPath)) {
      events.push({
        companyId: input.companyId,
        projectId: input.projectId,
        issueId: input.issueId,
        retrievalRunId: input.retrievalRunId,
        feedbackMessageId: input.feedbackMessageId,
        actorRole: input.actorRole,
        eventType: input.eventType,
        feedbackType: input.feedbackType,
        targetType: "path",
        targetId: normalizedPath,
        weight: chunkWeight * 0.72,
        metadata,
      });
    }
    if (hit.symbolName) {
      events.push({
        companyId: input.companyId,
        projectId: input.projectId,
        issueId: input.issueId,
        retrievalRunId: input.retrievalRunId,
        feedbackMessageId: input.feedbackMessageId,
        actorRole: input.actorRole,
        eventType: input.eventType,
        feedbackType: input.feedbackType,
        targetType: "symbol",
        targetId: hit.symbolName,
        weight: chunkWeight * 0.58,
        metadata,
      });
    }
  }
  return events;
}

export function buildDirectTargetFeedbackEvents(input: {
  companyId: string;
  projectId: string | null;
  issueId: string | null;
  retrievalRunId: string;
  feedbackMessageId: string | null;
  actorRole: string;
  eventType: string;
  feedbackType: RetrievalFeedbackType;
  baseWeight: number;
  targetType: Exclude<RetrievalFeedbackTargetType, "chunk">;
  targetIds: string[];
  metadata: Record<string, unknown>;
}) {
  const events: Array<typeof retrievalFeedbackEvents.$inferInsert> = [];
  let emittedCodeSourceType = false;
  for (const targetId of input.targetIds) {
    if (targetId.trim().length === 0) continue;
    events.push({
      companyId: input.companyId,
      projectId: input.projectId,
      issueId: input.issueId,
      retrievalRunId: input.retrievalRunId,
      feedbackMessageId: input.feedbackMessageId,
      actorRole: input.actorRole,
      eventType: input.eventType,
      feedbackType: input.feedbackType,
      targetType: input.targetType,
      targetId,
      weight: input.baseWeight,
      metadata: input.metadata,
    });
    if (input.targetType === "path" && !emittedCodeSourceType && isPersonalizablePathTarget(targetId)) {
      events.push({
        companyId: input.companyId,
        projectId: input.projectId,
        issueId: input.issueId,
        retrievalRunId: input.retrievalRunId,
        feedbackMessageId: input.feedbackMessageId,
        actorRole: input.actorRole,
        eventType: input.eventType,
        feedbackType: input.feedbackType,
        targetType: "source_type",
        targetId: "code",
        weight: input.baseWeight * 0.72,
        metadata: {
          ...input.metadata,
          promotedByPathFeedback: true,
        },
      });
      emittedCodeSourceType = true;
    }
  }
  return events;
}

export function retrievalPersonalizationService(db: Db) {
  const knowledge = knowledgeService(db);

  async function rebuildRoleProfile(input: {
    companyId: string;
    projectId: string | null;
    role: string;
    eventType: string;
  }) {
    const since = new Date(Date.now() - PROFILE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        targetType: retrievalFeedbackEvents.targetType,
        targetId: retrievalFeedbackEvents.targetId,
        weight: retrievalFeedbackEvents.weight,
        feedbackType: retrievalFeedbackEvents.feedbackType,
        createdAt: retrievalFeedbackEvents.createdAt,
      })
      .from(retrievalFeedbackEvents)
      .where(
        and(
          eq(retrievalFeedbackEvents.companyId, input.companyId),
          eq(retrievalFeedbackEvents.actorRole, input.role),
          eq(retrievalFeedbackEvents.eventType, input.eventType),
          gte(retrievalFeedbackEvents.createdAt, since),
          input.projectId
            ? eq(retrievalFeedbackEvents.projectId, input.projectId)
            : sql`true`,
        ),
      )
      .orderBy(desc(retrievalFeedbackEvents.createdAt))
      .limit(4000);

    const profileJson = aggregateRetrievalFeedbackProfile({
      events: rows.map((row) => ({
        targetType: row.targetType as RetrievalFeedbackTargetType,
        targetId: row.targetId,
        weight: row.weight,
        feedbackType: row.feedbackType as RetrievalFeedbackType,
        createdAt: row.createdAt,
      })),
    });

    const existing = await db
      .select({ id: retrievalRoleProfiles.id })
      .from(retrievalRoleProfiles)
      .where(and(
        eq(retrievalRoleProfiles.companyId, input.companyId),
        eq(retrievalRoleProfiles.role, input.role),
        eq(retrievalRoleProfiles.eventType, input.eventType),
        input.projectId ? eq(retrievalRoleProfiles.projectId, input.projectId) : isNull(retrievalRoleProfiles.projectId),
      ))
      .then((result) => result[0] ?? null);

    if (!existing) {
      const [created] = await db
        .insert(retrievalRoleProfiles)
        .values({
          companyId: input.companyId,
          projectId: input.projectId,
          role: input.role,
          eventType: input.eventType,
          profileJson,
          feedbackCount: profileJson.stats.feedbackCount,
          lastFeedbackAt: profileJson.stats.lastFeedbackAt ? new Date(profileJson.stats.lastFeedbackAt) : null,
        })
        .returning();
      return created ?? null;
    }

    const [updated] = await db
      .update(retrievalRoleProfiles)
      .set({
        profileJson,
        feedbackCount: profileJson.stats.feedbackCount,
        lastFeedbackAt: profileJson.stats.lastFeedbackAt ? new Date(profileJson.stats.lastFeedbackAt) : null,
        updatedAt: new Date(),
      })
      .where(eq(retrievalRoleProfiles.id, existing.id))
      .returning();
    return updated ?? null;
  }

  async function updateRunFeedbackDebug(input: {
    retrievalRunId: string;
    feedbackType: RetrievalFeedbackType;
    feedbackMessageId: string | null;
    feedbackActorRole: string;
    feedbackEventCount: number;
    metadata?: Record<string, unknown>;
  }) {
    await knowledge.updateRetrievalRunDebug(input.retrievalRunId, {
      feedback: {
        lastFeedbackMessageId: input.feedbackMessageId,
        lastFeedbackType: input.feedbackType,
        lastFeedbackActorRole: input.feedbackActorRole,
        lastFeedbackAt: new Date().toISOString(),
        feedbackEventCount: input.feedbackEventCount,
        ...(input.metadata ?? {}),
      },
    });
  }

  async function loadRunsWithHits(runIds: string[]) {
    if (runIds.length === 0) return [] as Array<{
      run: RetrievalRunFeedbackContext;
      hits: Awaited<ReturnType<typeof knowledge.listRetrievalRunHits>>;
      runProjectId: string | null;
    }>;

    const runs = await db
      .select({
        id: retrievalRuns.id,
        issueId: retrievalRuns.issueId,
        actorRole: retrievalRuns.actorRole,
        eventType: retrievalRuns.eventType,
        queryDebug: retrievalRuns.queryDebug,
      })
      .from(retrievalRuns)
      .where(inArray(retrievalRuns.id, runIds));

    const withHits = await Promise.all(runs.map(async (run) => {
      const hits = await knowledge.listRetrievalRunHits(run.id);
      return {
        run: {
          id: run.id,
          issueId: run.issueId,
          actorRole: run.actorRole,
          eventType: run.eventType,
          queryDebug: asRecord(run.queryDebug),
        },
        hits,
        runProjectId:
          readString(asRecord(run.queryDebug).issueProjectId)
          ?? null,
      };
    }));

    return withHits;
  }

  async function rebuildProfileScopes(input: {
    companyId: string;
    projectId: string | null;
    role: string;
    eventType: string;
  }) {
    await rebuildRoleProfile({
      companyId: input.companyId,
      projectId: null,
      role: input.role,
      eventType: input.eventType,
    });
    if (input.projectId) {
      await rebuildRoleProfile({
        companyId: input.companyId,
        projectId: input.projectId,
        role: input.role,
        eventType: input.eventType,
      });
    }
  }

  async function rebuildAllProfiles(input: {
    companyId: string;
    projectIds?: string[];
  }) {
    const selectedProjectIds = Array.from(new Set((input.projectIds ?? []).filter(Boolean)));
    const projectScopes = await db
      .selectDistinct({
        projectId: retrievalFeedbackEvents.projectId,
        role: retrievalFeedbackEvents.actorRole,
        eventType: retrievalFeedbackEvents.eventType,
      })
      .from(retrievalFeedbackEvents)
      .where(and(
        eq(retrievalFeedbackEvents.companyId, input.companyId),
        selectedProjectIds.length > 0 ? inArray(retrievalFeedbackEvents.projectId, selectedProjectIds) : sql`true`,
      ));
    const globalScopes = await db
      .selectDistinct({
        role: retrievalFeedbackEvents.actorRole,
        eventType: retrievalFeedbackEvents.eventType,
      })
      .from(retrievalFeedbackEvents)
      .where(eq(retrievalFeedbackEvents.companyId, input.companyId));

    let rebuilt = 0;
    for (const scope of globalScopes) {
      await rebuildRoleProfile({
        companyId: input.companyId,
        projectId: null,
        role: scope.role,
        eventType: scope.eventType,
      });
      rebuilt += 1;
    }
    for (const scope of projectScopes) {
      await rebuildRoleProfile({
        companyId: input.companyId,
        projectId: scope.projectId ?? null,
        role: scope.role,
        eventType: scope.eventType,
      });
      rebuilt += 1;
    }

    return {
      rebuilt,
      scopes: globalScopes.length + projectScopes.length,
    };
  }

  async function resolveFeedbackRunIds(input: {
    issueId: string;
    currentMessageSeq: number;
    message: CreateIssueProtocolMessage;
  }) {
    if (input.message.retrievalRunId) return [input.message.retrievalRunId];
    const scopes = fallbackBriefScopes({
      senderRole: input.message.sender.role,
      messageType: input.message.messageType,
    });
    const rows = await db
      .select({
        retrievalRunId: issueTaskBriefs.retrievalRunId,
      })
      .from(issueTaskBriefs)
      .where(and(
        eq(issueTaskBriefs.issueId, input.issueId),
        inArray(issueTaskBriefs.briefScope, scopes),
        isNotNull(issueTaskBriefs.retrievalRunId),
        lte(issueTaskBriefs.generatedFromMessageSeq, input.currentMessageSeq),
      ))
      .orderBy(desc(issueTaskBriefs.generatedFromMessageSeq), desc(issueTaskBriefs.createdAt))
      .limit(6);
    const uniqueRunIds = Array.from(new Set(
      rows
        .map((row) => row.retrievalRunId)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ));
    return uniqueRunIds.slice(0, 1);
  }

  function buildManualTargetEvents(input: {
    companyId: string;
    issueId: string | null;
    projectId: string | null;
    retrievalRunId: string;
    actorRole: string;
    eventType: string;
    feedbackType: RetrievalFeedbackType;
    baseWeight: number;
    targetType: RetrievalFeedbackTargetType;
    targetIds: string[];
    hits: Array<{
      chunkId: string;
      sourceType: string;
      documentPath: string | null;
      symbolName: string | null;
      finalRank: number | null;
      rationale: string | null;
      fusedScore: number | null;
    }>;
    feedbackMessageId: string | null;
    noteBody?: string | null;
  }) {
    if (input.targetIds.length === 0) return [] as Array<typeof retrievalFeedbackEvents.$inferInsert>;

    const metadata = {
      targetIds: input.targetIds,
      noteBody: input.noteBody ?? null,
      manualFeedback: true,
    };

    if (input.targetType === "chunk") {
      const targetSet = new Set(input.targetIds);
      return buildFeedbackEvents({
        companyId: input.companyId,
        projectId: input.projectId,
        issueId: input.issueId,
        retrievalRunId: input.retrievalRunId,
        feedbackMessageId: input.feedbackMessageId,
        actorRole: input.actorRole,
        eventType: input.eventType,
        feedbackType: input.feedbackType,
        baseWeight: input.baseWeight,
        hits: input.hits.filter((hit) => targetSet.has(hit.chunkId)),
      }).map((event) => ({
        ...event,
        metadata: {
          ...(event.metadata ?? {}),
          ...metadata,
        },
      }));
    }

    const normalizedTargetIds =
      input.targetType === "path"
        ? input.targetIds.map((targetId) => normalizePath(targetId)).filter((value): value is string => value != null)
        : input.targetIds;
    return buildDirectTargetFeedbackEvents({
      companyId: input.companyId,
      projectId: input.projectId,
      issueId: input.issueId,
      retrievalRunId: input.retrievalRunId,
      feedbackMessageId: input.feedbackMessageId,
      actorRole: input.actorRole,
      eventType: input.eventType,
      feedbackType: input.feedbackType,
      baseWeight: input.baseWeight,
      targetType: input.targetType,
      targetIds: normalizedTargetIds,
      metadata,
    });
  }

  async function recordRunFeedback(input: {
    companyId: string;
    issueId: string | null;
    feedbackMessageId: string | null;
    feedbackActorRole: string;
    descriptor: RetrievalFeedbackDescriptor;
    runs: Array<{
      run: RetrievalRunFeedbackContext;
      hits: Awaited<ReturnType<typeof knowledge.listRetrievalRunHits>>;
      runProjectId: string | null;
    }>;
    manualTargetsByRunId?: Map<string, Array<typeof retrievalFeedbackEvents.$inferInsert>>;
    debugMetadata?: Record<string, unknown>;
    includeSelectedHits?: boolean;
  }) {
    let feedbackEventCount = 0;
    let profiledRunCount = 0;
    const retrievalRunIds: string[] = [];

    for (const entry of input.runs) {
      retrievalRunIds.push(entry.run.id);
      const selectedHits = entry.hits
        .filter((hit) => hit.selected)
        .map((hit) => ({
          chunkId: hit.chunkId,
          finalRank: hit.finalRank ?? null,
          sourceType: hit.sourceType,
          documentPath: hit.documentPath,
          symbolName: hit.symbolName,
          rationale: hit.rationale ?? null,
          fusedScore: hit.fusedScore ?? null,
        }));

      const events = [
        ...(input.includeSelectedHits === false
          ? []
          : buildFeedbackEvents({
            companyId: input.companyId,
            projectId: entry.runProjectId,
            issueId: entry.run.issueId ?? input.issueId,
            retrievalRunId: entry.run.id,
            feedbackMessageId: input.feedbackMessageId,
            actorRole: entry.run.actorRole,
            eventType: entry.run.eventType,
            feedbackType: input.descriptor.feedbackType,
            baseWeight: input.descriptor.baseWeight,
            hits: selectedHits,
          })),
        ...(input.manualTargetsByRunId?.get(entry.run.id) ?? []),
      ];
      if (events.length === 0) continue;

      await db.insert(retrievalFeedbackEvents).values(events);
      feedbackEventCount += events.length;

      await rebuildProfileScopes({
        companyId: input.companyId,
        projectId: entry.runProjectId,
        role: entry.run.actorRole,
        eventType: entry.run.eventType,
      });
      profiledRunCount += 1;

      await updateRunFeedbackDebug({
        retrievalRunId: entry.run.id,
        feedbackType: input.descriptor.feedbackType,
        feedbackMessageId: input.feedbackMessageId,
        feedbackActorRole: input.feedbackActorRole,
        feedbackEventCount: events.length,
        metadata: input.debugMetadata,
      });
    }

    return {
      ok: feedbackEventCount > 0,
      feedbackEventCount,
      profiledRunCount,
      retrievalRunIds,
    };
  }

  async function recordProtocolFeedbackInternal(input: {
    companyId: string;
    issueId: string;
    issueProjectId: string | null;
    feedbackMessageId: string;
    currentMessageSeq: number;
    message: CreateIssueProtocolMessage;
  }) {
    const descriptor = describeProtocolFeedback(input.message);
    if (!descriptor) {
      return {
        ok: false,
        feedbackEventCount: 0,
        profiledRunCount: 0,
        retrievalRunIds: [] as string[],
      };
    }

    const runIds = await resolveFeedbackRunIds({
      issueId: input.issueId,
      currentMessageSeq: input.currentMessageSeq,
      message: input.message,
    });
    if (runIds.length === 0) {
      return {
        ok: false,
        feedbackEventCount: 0,
        profiledRunCount: 0,
        retrievalRunIds: [],
      };
    }

    const runs = (await loadRunsWithHits(runIds)).map((entry) => ({
      ...entry,
      runProjectId: entry.runProjectId ?? input.issueProjectId ?? null,
    }));

    return recordRunFeedback({
      companyId: input.companyId,
      issueId: input.issueId,
      feedbackMessageId: input.feedbackMessageId,
      feedbackActorRole: input.message.sender.role,
      descriptor,
      runs,
    });
  }

  return {
    loadProfile: async (input: {
      companyId: string;
      projectId: string | null;
      role: string;
      eventType: string;
    }) => {
      const rows = await db
        .select({
          projectId: retrievalRoleProfiles.projectId,
          profileJson: retrievalRoleProfiles.profileJson,
        })
        .from(retrievalRoleProfiles)
        .where(and(
          eq(retrievalRoleProfiles.companyId, input.companyId),
          eq(retrievalRoleProfiles.role, input.role),
          eq(retrievalRoleProfiles.eventType, input.eventType),
          input.projectId
            ? or(isNull(retrievalRoleProfiles.projectId), eq(retrievalRoleProfiles.projectId, input.projectId))
            : isNull(retrievalRoleProfiles.projectId),
        ))
        .orderBy(desc(retrievalRoleProfiles.updatedAt));

      const globalProfile = parseRoleProfileJson(rows.find((row) => row.projectId == null)?.profileJson ?? {});
      const projectProfile = input.projectId
        ? parseRoleProfileJson(rows.find((row) => row.projectId === input.projectId)?.profileJson ?? {})
        : null;
      return mergeRetrievalPersonalizationProfiles({
        globalProfile,
        projectProfile,
      });
    },

    recordProtocolFeedback: recordProtocolFeedbackInternal,

    recordManualFeedback: async (input: {
      companyId: string;
      issueId?: string | null;
      issueProjectId: string | null;
      retrievalRunId: string;
      feedbackType: "operator_pin" | "operator_hide";
      targetType: RetrievalFeedbackTargetType;
      targetIds: string[];
      actorRole?: string;
      noteBody?: string | null;
    }) => {
      const descriptor = describeManualFeedback(input.feedbackType);
      const runs = await loadRunsWithHits([input.retrievalRunId]);
      if (runs.length === 0) {
        return {
          ok: false,
          feedbackEventCount: 0,
          profiledRunCount: 0,
          retrievalRunIds: [],
        };
      }

      const manualTargetsByRunId = new Map<string, Array<typeof retrievalFeedbackEvents.$inferInsert>>();
      for (const entry of runs) {
        const targetEvents = buildManualTargetEvents({
          companyId: input.companyId,
          issueId: entry.run.issueId ?? input.issueId ?? null,
          projectId: entry.runProjectId ?? input.issueProjectId ?? null,
          retrievalRunId: entry.run.id,
          actorRole: entry.run.actorRole,
          eventType: entry.run.eventType,
          feedbackType: descriptor.feedbackType,
          baseWeight: descriptor.baseWeight,
          targetType: input.targetType,
          targetIds: input.targetIds,
          hits: entry.hits
            .filter((hit) => hit.selected)
            .map((hit) => ({
              chunkId: hit.chunkId,
              sourceType: hit.sourceType,
              documentPath: hit.documentPath,
              symbolName: hit.symbolName,
              finalRank: hit.finalRank ?? null,
              rationale: hit.rationale ?? null,
              fusedScore: hit.fusedScore ?? null,
            })),
          feedbackMessageId: null,
          noteBody: input.noteBody ?? null,
        });
        if (targetEvents.length > 0) {
          manualTargetsByRunId.set(entry.run.id, targetEvents);
        }
      }

      return recordRunFeedback({
        companyId: input.companyId,
        issueId: runs[0]?.run.issueId ?? input.issueId ?? null,
        feedbackMessageId: null,
        feedbackActorRole: input.actorRole ?? "human_board",
        descriptor,
        runs: runs.map((entry) => ({
          ...entry,
          runProjectId: entry.runProjectId ?? input.issueProjectId ?? null,
        })),
        manualTargetsByRunId,
        debugMetadata: {
          manualFeedback: true,
          manualTargetType: input.targetType,
          manualTargetIds: input.targetIds,
          noteBody: input.noteBody ?? null,
        },
        includeSelectedHits: false,
      });
    },

    recordMergeCandidateOutcomeFeedback: async (input: {
      companyId: string;
      issueId: string;
      issueProjectId: string | null;
      closeMessageId: string | null;
      outcome: "merge_completed" | "merge_rejected";
      changedFiles?: string[];
      noteBody?: string | null;
      actorRole?: string;
      mergeCommitSha?: string | null;
      mergeStatus?: string | null;
    }) => {
      const descriptor = describeMergeOutcomeFeedback(input.outcome);
      if (input.closeMessageId) {
        const existingCount = await db
          .select({ count: sql<number>`count(*)` })
          .from(retrievalFeedbackEvents)
          .where(and(
            eq(retrievalFeedbackEvents.companyId, input.companyId),
            eq(retrievalFeedbackEvents.issueId, input.issueId),
            eq(retrievalFeedbackEvents.feedbackMessageId, input.closeMessageId),
            eq(retrievalFeedbackEvents.feedbackType, descriptor.feedbackType),
          ))
          .then((rows) => rows[0]?.count ?? 0);
        if (existingCount > 0) {
          return {
            ok: false,
            feedbackEventCount: 0,
            profiledRunCount: 0,
            retrievalRunIds: [],
          };
        }
      }

      const runs = await db
        .select({
          id: retrievalRuns.id,
        })
        .from(retrievalRuns)
        .where(and(
          eq(retrievalRuns.companyId, input.companyId),
          eq(retrievalRuns.issueId, input.issueId),
        ))
        .orderBy(desc(retrievalRuns.createdAt))
        .limit(24)
        .then((rows) => rows.map((row) => row.id));
      const runsWithHits = await loadRunsWithHits(runs);
      if (runsWithHits.length === 0) {
        return {
          ok: false,
          feedbackEventCount: 0,
          profiledRunCount: 0,
          retrievalRunIds: [],
        };
      }

      const normalizedChangedFiles = Array.from(new Set(
        (input.changedFiles ?? [])
          .map((value) => normalizePath(value))
          .filter((value): value is string => value != null),
      ));
      const manualTargetsByRunId = new Map<string, Array<typeof retrievalFeedbackEvents.$inferInsert>>();
      for (const entry of runsWithHits) {
        if (normalizedChangedFiles.length === 0) continue;
        const targetEvents = buildDirectTargetFeedbackEvents({
          companyId: input.companyId,
          projectId: entry.runProjectId ?? input.issueProjectId ?? null,
          issueId: input.issueId,
          retrievalRunId: entry.run.id,
          feedbackMessageId: input.closeMessageId,
          actorRole: entry.run.actorRole,
          eventType: entry.run.eventType,
          feedbackType: descriptor.feedbackType,
          baseWeight: descriptor.baseWeight * 0.88,
          targetType: "path",
          targetIds: normalizedChangedFiles,
          metadata: {
            mergeOutcome: input.outcome,
            mergeCommitSha: input.mergeCommitSha ?? null,
            mergeStatus: input.mergeStatus ?? null,
            noteBody: input.noteBody ?? null,
            source: "merge_candidate_resolution",
          },
        });
        if (targetEvents.length > 0) {
          manualTargetsByRunId.set(entry.run.id, targetEvents);
        }
      }

      return recordRunFeedback({
        companyId: input.companyId,
        issueId: input.issueId,
        feedbackMessageId: input.closeMessageId,
        feedbackActorRole: input.actorRole ?? "human_board",
        descriptor,
        runs: runsWithHits.map((entry) => ({
          ...entry,
          runProjectId: entry.runProjectId ?? input.issueProjectId ?? null,
        })),
        manualTargetsByRunId,
        debugMetadata: {
          mergeOutcome: input.outcome,
          mergeCommitSha: input.mergeCommitSha ?? null,
          mergeStatus: input.mergeStatus ?? null,
          changedFiles: normalizedChangedFiles,
          noteBody: input.noteBody ?? null,
        },
      });
    },

    summarizeIssueFeedback: async (input: {
      companyId: string;
      issueId: string;
    }) => {
      const rows = await db
        .select({
          feedbackType: retrievalFeedbackEvents.feedbackType,
          targetType: retrievalFeedbackEvents.targetType,
          targetId: retrievalFeedbackEvents.targetId,
          weight: retrievalFeedbackEvents.weight,
          createdAt: retrievalFeedbackEvents.createdAt,
        })
        .from(retrievalFeedbackEvents)
        .where(and(
          eq(retrievalFeedbackEvents.companyId, input.companyId),
          eq(retrievalFeedbackEvents.issueId, input.issueId),
        ))
        .orderBy(desc(retrievalFeedbackEvents.createdAt))
        .limit(500);

      const feedbackTypeCounts: Record<string, number> = {};
      let positiveCount = 0;
      let negativeCount = 0;
      let pinnedPathCount = 0;
      let hiddenPathCount = 0;
      let lastFeedbackAt: Date | null = null;

      for (const row of rows) {
        feedbackTypeCounts[row.feedbackType] = (feedbackTypeCounts[row.feedbackType] ?? 0) + 1;
        if (row.weight > 0) positiveCount += 1;
        if (row.weight < 0) negativeCount += 1;
        if (row.feedbackType === "operator_pin" && row.targetType === "path") pinnedPathCount += 1;
        if (row.feedbackType === "operator_hide" && row.targetType === "path") hiddenPathCount += 1;
        if (!lastFeedbackAt || row.createdAt.getTime() > lastFeedbackAt.getTime()) {
          lastFeedbackAt = row.createdAt;
        }
      }

      return {
        positiveCount,
        negativeCount,
        pinnedPathCount,
        hiddenPathCount,
        lastFeedbackAt,
        feedbackTypeCounts,
      };
    },

    backfillProtocolFeedback: async (input: {
      companyId: string;
      projectIds?: string[];
      limit?: number;
    }) => {
      const selectedProjectIds = Array.from(new Set((input.projectIds ?? []).filter(Boolean)));
      const processedMessageIds = new Set(
        await db
          .select({ feedbackMessageId: retrievalFeedbackEvents.feedbackMessageId })
          .from(retrievalFeedbackEvents)
          .where(and(
            eq(retrievalFeedbackEvents.companyId, input.companyId),
            isNotNull(retrievalFeedbackEvents.feedbackMessageId),
          ))
          .then((rows) => rows
            .map((row) => row.feedbackMessageId)
            .filter((value): value is string => typeof value === "string" && value.length > 0)),
      );

      const rows = await db
        .select({
          issueId: issueProtocolMessages.issueId,
          issueProjectId: issues.projectId,
          messageId: issueProtocolMessages.id,
          seq: issueProtocolMessages.seq,
          messageType: issueProtocolMessages.messageType,
          senderActorType: issueProtocolMessages.senderActorType,
          senderActorId: issueProtocolMessages.senderActorId,
          senderRole: issueProtocolMessages.senderRole,
          workflowStateBefore: issueProtocolMessages.workflowStateBefore,
          workflowStateAfter: issueProtocolMessages.workflowStateAfter,
          payload: issueProtocolMessages.payload,
          retrievalRunId: issueProtocolMessages.retrievalRunId,
        })
        .from(issueProtocolMessages)
        .innerJoin(issues, eq(issueProtocolMessages.issueId, issues.id))
        .where(and(
          eq(issueProtocolMessages.companyId, input.companyId),
          selectedProjectIds.length > 0 ? inArray(issues.projectId, selectedProjectIds) : sql`true`,
          inArray(issueProtocolMessages.messageType, ["REQUEST_CHANGES", "APPROVE_IMPLEMENTATION", "CLOSE_TASK"]),
        ))
        .orderBy(issueProtocolMessages.createdAt)
        .limit(Math.max(1, Math.min(5000, input.limit ?? 1000)));

      let scanned = 0;
      let replayed = 0;
      let feedbackEventCount = 0;
      let profiledRunCount = 0;
      for (const row of rows) {
        scanned += 1;
        if (processedMessageIds.has(row.messageId)) continue;
        const result = await recordProtocolFeedbackInternal({
          companyId: input.companyId,
          issueId: row.issueId,
          issueProjectId: row.issueProjectId ?? null,
          feedbackMessageId: row.messageId,
          currentMessageSeq: row.seq,
          message: {
            messageType: row.messageType as CreateIssueProtocolMessage["messageType"],
            sender: {
              actorType: row.senderActorType as CreateIssueProtocolMessage["sender"]["actorType"],
              actorId: row.senderActorId,
              role: row.senderRole as CreateIssueProtocolMessage["sender"]["role"],
            },
            recipients: [],
            workflowStateBefore: row.workflowStateBefore as CreateIssueProtocolMessage["workflowStateBefore"],
            workflowStateAfter: row.workflowStateAfter as CreateIssueProtocolMessage["workflowStateAfter"],
            summary: "",
            payload: row.payload as CreateIssueProtocolMessage["payload"],
            artifacts: [],
            retrievalRunId: row.retrievalRunId,
            requiresAck: false,
          } as CreateIssueProtocolMessage,
        });
        if (!result.ok) continue;
        replayed += 1;
        feedbackEventCount += result.feedbackEventCount;
        profiledRunCount += result.profiledRunCount;
      }

      return {
        scanned,
        replayed,
        feedbackEventCount,
        profiledRunCount,
      };
    },

    rebuildAllProfiles,
  };
}
