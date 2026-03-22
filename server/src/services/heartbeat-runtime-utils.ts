import type { AdapterExecutionResult, AdapterSessionCodec } from "../adapters/index.js";
import { getServerAdapter } from "../adapters/index.js";
import { asNumber, parseObject } from "../adapters/utils.js";
import type { ResolvedWorkspaceForRun } from "./heartbeat-workspace.js";

const HEARTBEAT_MAX_CONCURRENT_RUNS_DEFAULT = 1;
const HEARTBEAT_MAX_CONCURRENT_RUNS_MAX = 10;
const RUN_LEASE_TTL_MS = 45_000;
const WORKSPACE_CONTEXT_KEY = "squadrailWorkspace";
const WORKSPACES_CONTEXT_KEY = "squadrailWorkspaces";

type TaskSessionUpsertSetInput = {
  sessionParamsJson: Record<string, unknown> | null;
  sessionDisplayId: string | null;
  lastRunId: string | null;
  lastError: string | null;
};

type RunLeaseLike = {
  status?: string | null;
  checkpointJson?: Record<string, unknown> | null;
  leaseExpiresAt?: Date | string | null;
  releasedAt?: Date | string | null;
};

export function mergeRunResultJson(
  base: Record<string, unknown> | null | undefined,
  additions: Record<string, unknown> | null,
) {
  if (!additions || Object.keys(additions).length === 0) return base ?? null;
  if (!base) return additions;
  return {
    ...base,
    ...additions,
  };
}

export function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function attachResolvedWorkspaceContextToRunContext(input: {
  contextSnapshot: Record<string, unknown>;
  resolvedWorkspace: ResolvedWorkspaceForRun;
}) {
  const { contextSnapshot, resolvedWorkspace } = input;
  const workspaceContext = {
    cwd: resolvedWorkspace.cwd,
    source: resolvedWorkspace.source,
    projectId: resolvedWorkspace.projectId,
    workspaceId: resolvedWorkspace.workspaceId,
    repoUrl: resolvedWorkspace.repoUrl,
    repoRef: resolvedWorkspace.repoRef,
    executionPolicy: resolvedWorkspace.executionPolicy,
    workspaceUsage: resolvedWorkspace.workspaceUsage,
    branchName: resolvedWorkspace.branchName,
    workspaceState: resolvedWorkspace.workspaceState,
    hasLocalChanges: resolvedWorkspace.hasLocalChanges,
  };

  contextSnapshot[WORKSPACE_CONTEXT_KEY] = workspaceContext;
  contextSnapshot.squadrailWorkspace = workspaceContext;
  contextSnapshot[WORKSPACES_CONTEXT_KEY] = resolvedWorkspace.workspaceHints;
  contextSnapshot.squadrailWorkspaces = resolvedWorkspace.workspaceHints;

  if (resolvedWorkspace.projectId && !readNonEmptyString(contextSnapshot.projectId)) {
    contextSnapshot.projectId = resolvedWorkspace.projectId;
  }

  return contextSnapshot;
}

export function buildTaskSessionUpsertSet(
  input: TaskSessionUpsertSetInput,
  updatedAt: Date = new Date(),
) {
  return {
    sessionParamsJson: input.sessionParamsJson,
    sessionDisplayId: input.sessionDisplayId,
    lastRunId: input.lastRunId,
    lastError: input.lastError,
    updatedAt,
  };
}

export async function insertOrRefetchSingleton<T>(input: {
  insert: () => Promise<T | null>;
  refetch: () => Promise<T | null>;
}) {
  const inserted = await input.insert();
  if (inserted) return inserted;
  return input.refetch();
}

export function normalizeMaxConcurrentRuns(value: unknown) {
  const parsed = Math.floor(asNumber(value, HEARTBEAT_MAX_CONCURRENT_RUNS_DEFAULT));
  if (!Number.isFinite(parsed)) return HEARTBEAT_MAX_CONCURRENT_RUNS_DEFAULT;
  return Math.max(HEARTBEAT_MAX_CONCURRENT_RUNS_DEFAULT, Math.min(HEARTBEAT_MAX_CONCURRENT_RUNS_MAX, parsed));
}

export function truncateDisplayId(value: string | null | undefined, max = 128) {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

export function toEpochMillis(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function computeLeaseExpiresAt(now = new Date()) {
  return new Date(now.getTime() + RUN_LEASE_TTL_MS);
}

export function buildProcessLostError(lease?: RunLeaseLike | null) {
  const checkpoint = parseObject(lease?.checkpointJson);
  const phase = readNonEmptyString(checkpoint.phase);
  if (phase) {
    return `Process lost during ${phase} -- server may have restarted`;
  }
  return "Process lost -- server may have restarted";
}

const defaultSessionCodec: AdapterSessionCodec = {
  deserialize(raw: unknown) {
    const asObj = parseObject(raw);
    if (Object.keys(asObj).length > 0) return asObj;
    const sessionId = readNonEmptyString((raw as Record<string, unknown> | null)?.sessionId);
    if (sessionId) return { sessionId };
    return null;
  },
  serialize(params: Record<string, unknown> | null) {
    if (!params || Object.keys(params).length === 0) return null;
    return params;
  },
  getDisplayId(params: Record<string, unknown> | null) {
    return readNonEmptyString(params?.sessionId);
  },
};

export function getAdapterSessionCodec(adapterType: string) {
  const adapter = getServerAdapter(adapterType);
  return adapter.sessionCodec ?? defaultSessionCodec;
}

export function normalizeSessionParams(params: Record<string, unknown> | null | undefined) {
  if (!params) return null;
  return Object.keys(params).length > 0 ? params : null;
}

export function resolveNextSessionState(input: {
  codec: AdapterSessionCodec;
  adapterResult: AdapterExecutionResult;
  previousParams: Record<string, unknown> | null;
  previousDisplayId: string | null;
  previousLegacySessionId: string | null;
}) {
  const { codec, adapterResult, previousParams, previousDisplayId, previousLegacySessionId } = input;

  if (adapterResult.clearSession) {
    return {
      params: null as Record<string, unknown> | null,
      displayId: null as string | null,
      legacySessionId: null as string | null,
    };
  }

  const explicitParams = adapterResult.sessionParams;
  const hasExplicitParams = adapterResult.sessionParams !== undefined;
  const hasExplicitSessionId = adapterResult.sessionId !== undefined;
  const explicitSessionId = readNonEmptyString(adapterResult.sessionId);
  const hasExplicitDisplay = adapterResult.sessionDisplayId !== undefined;
  const explicitDisplayId = readNonEmptyString(adapterResult.sessionDisplayId);
  const shouldUsePrevious = !hasExplicitParams && !hasExplicitSessionId && !hasExplicitDisplay;

  const candidateParams =
    hasExplicitParams
      ? explicitParams
      : hasExplicitSessionId
        ? (explicitSessionId ? { sessionId: explicitSessionId } : null)
        : previousParams;

  const serialized = normalizeSessionParams(codec.serialize(normalizeSessionParams(candidateParams) ?? null));
  const deserialized = normalizeSessionParams(codec.deserialize(serialized));

  const displayId = truncateDisplayId(
    explicitDisplayId ??
      (codec.getDisplayId ? codec.getDisplayId(deserialized) : null) ??
      readNonEmptyString(deserialized?.sessionId) ??
      (shouldUsePrevious ? previousDisplayId : null) ??
      explicitSessionId ??
      (shouldUsePrevious ? previousLegacySessionId : null),
  );

  const legacySessionId =
    explicitSessionId ??
    readNonEmptyString(deserialized?.sessionId) ??
    displayId ??
    (shouldUsePrevious ? previousLegacySessionId : null);

  return {
    params: serialized,
    displayId,
    legacySessionId,
  };
}

export function normalizeAgentNameKey(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}
