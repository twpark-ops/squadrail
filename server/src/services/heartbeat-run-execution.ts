import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { enqueueAfterDbCommit, runWithoutDbContext, type Db } from "@squadrail/db";
import {
  agents,
  agentRuntimeState,
  agentTaskSessions,
  costEvents,
  heartbeatRuns,
  heartbeatRunEvents,
  issueProtocolMessages,
  issueProtocolState,
  issues,
} from "@squadrail/db";
import { resolveProtocolRunRequirement, type IssuePriority } from "@squadrail/shared";
import { getServerAdapter, runningProcesses } from "../adapters/index.js";
import type { AdapterExecutionResult, AdapterInvocationMeta } from "../adapters/index.js";
import { appendWithCap, MAX_EXCERPT_BYTES, parseObject } from "../adapters/utils.js";
import { createLocalAgentJwt } from "../agent-auth-jwt.js";
import { publishLiveEvent as globalPublishLiveEvent } from "./live-events.js";
import type { RunLogHandle } from "./run-log-store.js";
import { loadConfig } from "../config.js";
import {
  assertResolvedWorkspaceReadyForExecution,
  resolveRuntimeSessionParamsForWorkspace,
  resolveWorkspaceForRun,
  type ResolvedWorkspaceForRun,
  WorkspaceResolutionError,
} from "./heartbeat-workspace.js";
import { extractRunVerificationSignals } from "./run-verification-signals.js";
import { inspectWorkspaceGitSnapshot } from "./workspace-git-snapshot.js";
import {
  attachResolvedWorkspaceContextToRunContext,
  getAdapterSessionCodec,
  mergeRunResultJson,
  normalizeSessionParams,
  readNonEmptyString,
  resolveNextSessionState,
  truncateDisplayId,
} from "./heartbeat-runtime-utils.js";
import {
  normalizeIssuePriorityValue,
  prioritizeQueuedRunsForDispatch,
  shouldPreemptRunningRunForQueuedSelection,
  type HeartbeatQueuedRunPrioritySelection,
} from "./heartbeat-dispatch-priority.js";
import {
  deriveTaskKey,
  describeSessionResetReason,
  parseIssueAssigneeAdapterOverrides,
  shouldResetTaskSessionForWake,
} from "./heartbeat-wake-utils.js";
import {
  buildRequiredProtocolProgressError,
  hasRequiredProtocolProgress,
  isIdleProtocolWatchdogEligibleRequirement,
  mergeProtocolMessagesWithHelperInvocations,
  refreshProtocolRetryContextSnapshot,
  shouldEnqueueImplementationProgressFollowup,
  shouldEnqueueProtocolRequiredRetry,
  shouldEnqueueRetryableAdapterFailure,
  shouldSkipSupersededProtocolFollowup,
  scheduleDeferredRunDispatch,
} from "./heartbeat-protocol-watchdog.js";
import type { HeartbeatWakeupOptions } from "./heartbeat-wakeup-control.js";

const startLocksByAgent = new Map<string, Promise<void>>();

class SupersededProtocolFollowupError extends Error {
  readonly code = "superseded_followup";

  constructor(message: string) {
    super(message);
    this.name = "SupersededProtocolFollowupError";
  }
}

function appendExcerpt(prev: string, chunk: string) {
  return appendWithCap(prev, chunk, MAX_EXCERPT_BYTES);
}

function isRepoBackedWorkspaceSource(source: ResolvedWorkspaceForRun["source"] | null | undefined) {
  return source === "project_shared" || source === "project_isolated";
}

async function withAgentStartLock<T>(agentId: string, fn: () => Promise<T>) {
  const previous = startLocksByAgent.get(agentId) ?? Promise.resolve();
  const run = previous.then(() => runWithoutDbContext(fn));
  const marker = run.then(
    () => undefined,
    () => undefined,
  );
  startLocksByAgent.set(agentId, marker);
  try {
    return await run;
  } finally {
    if (startLocksByAgent.get(agentId) === marker) {
      startLocksByAgent.delete(agentId);
    }
  }
}

export function resolveHeartbeatRunOutcome(input: {
  latestRunStatus?: string | null;
  timedOut: boolean;
  exitCode?: number | null;
  errorMessage?: string | null;
  protocolProgressFailure?: {
    error: string;
    errorCode: string;
  } | null;
}) {
  if (input.latestRunStatus === "cancelled") return "cancelled" as const;
  if (input.timedOut) return "timed_out" as const;
  if ((input.exitCode ?? 0) === 0 && !input.errorMessage && !input.protocolProgressFailure) {
    return "succeeded" as const;
  }
  return "failed" as const;
}

export function buildHeartbeatOutcomePersistence(input: {
  outcome: "succeeded" | "failed" | "cancelled" | "timed_out";
  protocolProgressFailure?: {
    error: string;
    errorCode: string;
  } | null;
  adapterResult: {
    exitCode?: number | null;
    signal?: string | null;
    errorMessage?: string | null;
    errorCode?: string | null;
  };
  usageJson: Record<string, unknown> | null;
  resultJson: Record<string, unknown> | null;
  nextSessionDisplayId: string | null;
  nextSessionLegacyId: string | null;
  stdoutExcerpt: string;
  stderrExcerpt: string;
  logSummary?: { bytes: number; sha256?: string; compressed: boolean } | null;
  finishedAt?: Date;
}) {
  const finishedAt = input.finishedAt ?? new Date();
  const status =
    input.outcome === "succeeded"
      ? "succeeded"
      : input.outcome === "cancelled"
        ? "cancelled"
        : input.outcome === "timed_out"
          ? "timed_out"
          : "failed";
  const error =
    input.outcome === "succeeded"
      ? null
      : input.protocolProgressFailure?.error ??
        input.adapterResult.errorMessage ??
        (input.outcome === "timed_out" ? "Timed out" : "Adapter failed");
  const errorCode =
    input.outcome === "timed_out"
      ? "timeout"
      : input.outcome === "cancelled"
        ? "cancelled"
        : input.outcome === "failed"
          ? (input.protocolProgressFailure?.errorCode ?? input.adapterResult.errorCode ?? "adapter_failed")
          : null;

  return {
    status,
    runPatch: {
      finishedAt,
      error,
      errorCode,
      exitCode: input.adapterResult.exitCode ?? null,
      signal: input.adapterResult.signal ?? null,
      usageJson: input.usageJson,
      resultJson: input.resultJson,
      sessionIdAfter: input.nextSessionDisplayId ?? input.nextSessionLegacyId,
      stdoutExcerpt: input.stdoutExcerpt,
      stderrExcerpt: input.stderrExcerpt,
      logBytes: input.logSummary?.bytes,
      logSha256: input.logSummary?.sha256,
      logCompressed: input.logSummary?.compressed ?? false,
    },
    wakeupStatus: input.outcome === "succeeded" ? "completed" : status,
    wakeupPatch: {
      finishedAt,
      error: input.protocolProgressFailure?.error ?? input.adapterResult.errorMessage ?? null,
    },
  };
}

type PublishHeartbeatLiveEvent = typeof globalPublishLiveEvent;

export function createHeartbeatRunExecution(input: {
  db: Db;
  publishLiveEvent: PublishHeartbeatLiveEvent;
  runLogStore: {
    begin: (input: { companyId: string; agentId: string; runId: string }) => Promise<RunLogHandle>;
    append: (handle: RunLogHandle, input: { stream: "stdout" | "stderr" | "system"; chunk: string; ts: string }) => Promise<void>;
    finalize: (handle: RunLogHandle) => Promise<{ bytes: number; sha256?: string; compressed: boolean }>;
  };
  resolveAdapterConfigForRuntime: (
    companyId: string,
    config: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  getAgent: (agentId: string) => Promise<typeof agents.$inferSelect | null>;
  getRun: (runId: string) => Promise<typeof heartbeatRuns.$inferSelect | null>;
  getTaskSession: (
    companyId: string,
    agentId: string,
    adapterType: string,
    taskKey: string,
  ) => Promise<typeof agentTaskSessions.$inferSelect | null>;
  nextRunEventSeq: (runId: string) => Promise<number>;
  ensureRuntimeState: (agent: typeof agents.$inferSelect) => Promise<typeof agentRuntimeState.$inferSelect | null>;
  countRunningRunsForAgent: (agentId: string) => Promise<number>;
  clearTaskSessions: (
    companyId: string,
    agentId: string,
    opts?: { taskKey?: string | null; adapterType?: string | null },
  ) => Promise<number>;
  upsertTaskSession: (input: {
    companyId: string;
    agentId: string;
    adapterType: string;
    taskKey: string;
    sessionParamsJson: Record<string, unknown> | null;
    sessionDisplayId: string | null;
    lastRunId: string | null;
    lastError: string | null;
  }) => Promise<typeof agentTaskSessions.$inferSelect | null>;
  setRunStatus: (
    runId: string,
    status: string,
    patch?: Partial<typeof heartbeatRuns.$inferInsert>,
  ) => Promise<typeof heartbeatRuns.$inferSelect | null>;
  setWakeupStatus: (
    wakeupRequestId: string | null | undefined,
    status: string,
    patch?: Record<string, unknown>,
  ) => Promise<void>;
  upsertRunLease: (input: {
    run: typeof heartbeatRuns.$inferSelect;
    status: string;
    checkpointJson?: Record<string, unknown> | null;
    heartbeatAt?: Date;
    leaseExpiresAt?: Date;
    releasedAt?: Date | null;
    lastError?: string | null;
  }) => Promise<void>;
  appendRunEvent: (
    run: typeof heartbeatRuns.$inferSelect,
    seq: number,
    event: {
      eventType: string;
      stream?: "system" | "stdout" | "stderr";
      level?: "info" | "warn" | "error";
      color?: string;
      message?: string;
      payload?: Record<string, unknown>;
    },
  ) => Promise<void>;
  parseHeartbeatPolicy: (agent: typeof agents.$inferSelect) => { maxConcurrentRuns: number };
  claimQueuedRun: (
    run: typeof heartbeatRuns.$inferSelect,
  ) => Promise<typeof heartbeatRuns.$inferSelect | null>;
  applyDispatchPrioritySelection: (input: {
    run: typeof heartbeatRuns.$inferSelect;
    selection: HeartbeatQueuedRunPrioritySelection<typeof heartbeatRuns.$inferSelect>;
  }) => Promise<typeof heartbeatRuns.$inferSelect>;
  finalizeAgentStatus: (
    agentId: string,
    outcome: "succeeded" | "failed" | "cancelled" | "timed_out",
  ) => Promise<void>;
  dispatchAgentQueueStart: (agentId: string) => void;
  releaseIssueExecutionAndPromote: (run: typeof heartbeatRuns.$inferSelect) => Promise<void>;
  wakeLeadSupervisorForRunFailure: (input: {
    run: typeof heartbeatRuns.$inferSelect;
    status: "failed" | "timed_out";
    errorCode?: string | null;
    error?: string | null;
  }) => Promise<void>;
  cancelRunInternal: (
    runId: string,
    opts?: { message?: string; checkpointMessage?: string },
  ) => Promise<typeof heartbeatRuns.$inferSelect | null | undefined>;
  enqueueWakeup: (
    agentId: string,
    opts?: HeartbeatWakeupOptions,
  ) => Promise<typeof heartbeatRuns.$inferSelect | null>;
  clearDispatchWatchdog: (runId: string) => void;
  clearProtocolIdleWatchdog: (runId: string, opts?: { resetAttempts?: boolean }) => void;
  scheduleProtocolIdleWatchdog: (runId: string) => void;
  cancelSupersededProtocolRunIfNeeded: (input: {
    run: typeof heartbeatRuns.$inferSelect;
    context: Record<string, unknown>;
  }) => Promise<boolean>;
}) {
  const {
    db,
    publishLiveEvent,
    runLogStore,
    resolveAdapterConfigForRuntime,
    getAgent,
    getRun,
    getTaskSession,
    nextRunEventSeq,
    ensureRuntimeState,
    countRunningRunsForAgent,
    clearTaskSessions,
    upsertTaskSession,
    setRunStatus,
    setWakeupStatus,
    upsertRunLease,
    appendRunEvent,
    parseHeartbeatPolicy,
    claimQueuedRun,
    applyDispatchPrioritySelection,
    finalizeAgentStatus,
    dispatchAgentQueueStart,
    releaseIssueExecutionAndPromote,
    wakeLeadSupervisorForRunFailure,
    cancelRunInternal,
    enqueueWakeup,
    clearDispatchWatchdog,
    clearProtocolIdleWatchdog,
    scheduleProtocolIdleWatchdog,
    cancelSupersededProtocolRunIfNeeded,
  } = input;

  async function updateRuntimeState(
    agent: typeof agents.$inferSelect,
    run: typeof heartbeatRuns.$inferSelect,
    result: AdapterExecutionResult,
    session: { legacySessionId: string | null },
  ) {
    await ensureRuntimeState(agent);
    const usage = result.usage;
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    const cachedInputTokens = usage?.cachedInputTokens ?? 0;
    const additionalCostCents = Math.max(0, Math.round((result.costUsd ?? 0) * 100));
    const hasTokenUsage = inputTokens > 0 || outputTokens > 0 || cachedInputTokens > 0;

    await db
      .update(agentRuntimeState)
      .set({
        adapterType: agent.adapterType,
        sessionId: session.legacySessionId,
        lastRunId: run.id,
        lastRunStatus: run.status,
        lastError: result.errorMessage ?? null,
        totalInputTokens: sql`${agentRuntimeState.totalInputTokens} + ${inputTokens}`,
        totalOutputTokens: sql`${agentRuntimeState.totalOutputTokens} + ${outputTokens}`,
        totalCachedInputTokens: sql`${agentRuntimeState.totalCachedInputTokens} + ${cachedInputTokens}`,
        totalCostCents: sql`${agentRuntimeState.totalCostCents} + ${additionalCostCents}`,
        updatedAt: new Date(),
      })
      .where(eq(agentRuntimeState.agentId, agent.id));

    if (additionalCostCents > 0 || hasTokenUsage) {
      await db.insert(costEvents).values({
        companyId: agent.companyId,
        agentId: agent.id,
        provider: result.provider ?? "unknown",
        model: result.model ?? "unknown",
        inputTokens,
        outputTokens,
        costCents: additionalCostCents,
        occurredAt: new Date(),
      });
    }

    if (additionalCostCents > 0) {
      await db
        .update(agents)
        .set({
          spentMonthlyCents: sql`${agents.spentMonthlyCents} + ${additionalCostCents}`,
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agent.id));
    }
  }

  async function startNextQueuedRunForAgent(agentId: string) {
    return withAgentStartLock(agentId, async () => {
      const agent = await getAgent(agentId);
      if (!agent) return [];
      const policy = parseHeartbeatPolicy(agent);
      const queuedRuns = await db
        .select()
        .from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.agentId, agentId), eq(heartbeatRuns.status, "queued")))
        .orderBy(asc(heartbeatRuns.createdAt));
      if (queuedRuns.length === 0) return [];

      const missingPriorityIssueIds = Array.from(new Set(
        queuedRuns.flatMap((run) => {
          const contextSnapshot = parseObject(run.contextSnapshot);
          const issueId = readNonEmptyString(contextSnapshot.issueId);
          const issuePriority = normalizeIssuePriorityValue(contextSnapshot.issuePriority);
          return issueId && !issuePriority ? [issueId] : [];
        }),
      ));
      const issuePriorityByIssueId = new Map<string, IssuePriority>();
      if (missingPriorityIssueIds.length > 0) {
        const issuePriorityRows = await db
          .select({
            id: issues.id,
            priority: issues.priority,
          })
          .from(issues)
          .where(
            and(
              eq(issues.companyId, agent.companyId),
              inArray(issues.id, missingPriorityIssueIds),
            ),
          );
        for (const row of issuePriorityRows) {
          const priority = normalizeIssuePriorityValue(row.priority);
          if (priority) issuePriorityByIssueId.set(row.id, priority);
        }
      }

      const prioritizedRuns = prioritizeQueuedRunsForDispatch({
        runs: queuedRuns,
        issuePriorityByIssueId,
      });

      let runningCount = await countRunningRunsForAgent(agentId);
      let availableSlots = Math.max(0, policy.maxConcurrentRuns - runningCount);

      if (availableSlots <= 0 && prioritizedRuns.length > 0) {
        const runningRuns = await db
          .select()
          .from(heartbeatRuns)
          .where(and(eq(heartbeatRuns.agentId, agentId), eq(heartbeatRuns.status, "running")))
          .orderBy(asc(heartbeatRuns.createdAt));

        const queuedSelection = prioritizedRuns[0];
        const preemptableRun = runningRuns.find((runningRun) =>
          shouldPreemptRunningRunForQueuedSelection({
            selection: queuedSelection,
            runningContextSnapshot: parseObject(runningRun.contextSnapshot),
          }),
        );

        if (preemptableRun) {
          await cancelRunInternal(preemptableRun.id, {
            message: "Cancelled lower-priority timeout escalation to unblock an active protocol follow-up",
            checkpointMessage: "run cancelled to unblock a higher-priority protocol follow-up",
          });
          runningCount = await countRunningRunsForAgent(agentId);
          availableSlots = Math.max(0, policy.maxConcurrentRuns - runningCount);
        }
      }

      if (availableSlots <= 0) return [];

      const selectedRuns = prioritizedRuns.slice(0, availableSlots);
      const claimedRuns: Array<typeof heartbeatRuns.$inferSelect> = [];
      for (const queuedRun of selectedRuns) {
        const claimed = await claimQueuedRun(queuedRun.run);
        if (!claimed) continue;
        claimedRuns.push(await applyDispatchPrioritySelection({
          run: claimed,
          selection: queuedRun,
        }));
      }
      if (claimedRuns.length === 0) return [];

      for (const claimedRun of claimedRuns) {
        scheduleDeferredRunDispatch(() => {
          runWithoutDbContext(() => {
            void executeRun(claimedRun.id).catch((err) => {
              // Keep the error path attached to the dispatcher boundary.
              console.error(err);
            });
          });
        });
      }
      return claimedRuns;
    });
  }

  function dispatchQueuedStart(agentId: string) {
    const start = () => {
      runWithoutDbContext(() => {
        void startNextQueuedRunForAgent(agentId).catch((err) => {
          console.error(err);
        });
      });
    };

    if (enqueueAfterDbCommit(start)) return;
    start();
  }

  async function executeRun(runId: string) {
    clearDispatchWatchdog(runId);
    let run = await getRun(runId);
    if (!run) return;
    if (run.status !== "queued" && run.status !== "running") return;

    if (run.status === "queued") {
      const claimed = await claimQueuedRun(run);
      if (!claimed) return;
      run = claimed;
      clearDispatchWatchdog(run.id);
    }

    const agent = await getAgent(run.agentId);
    if (!agent) {
      await setRunStatus(runId, "failed", {
        error: "Agent not found",
        errorCode: "agent_not_found",
        finishedAt: new Date(),
      });
      await setWakeupStatus(run.wakeupRequestId, "failed", {
        finishedAt: new Date(),
        error: "Agent not found",
      });
      const failedRun = await getRun(runId);
      if (failedRun) await releaseIssueExecutionAndPromote(failedRun);
      return;
    }

    const context = parseObject(run.contextSnapshot);
    const taskKey = deriveTaskKey(context, null);
    const sessionCodec = getAdapterSessionCodec(agent.adapterType);
    const issueId = readNonEmptyString(context.issueId);
    let seq = 1;
    let handle: RunLogHandle | null = null;
    let stdoutExcerpt = "";
    let stderrExcerpt = "";
    let leaseHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let currentPhase = "preflight.init";
    let lastProgressAt = new Date();
    let eventRun = run;
    let taskSession: typeof agentTaskSessions.$inferSelect | null = null;
    let previousSessionParams: Record<string, unknown> | null = null;
    let previousSessionDisplayId: string | null = null;
    let runtimeWorkspaceWarnings: string[] = [];
    let resolvedWorkspace: ResolvedWorkspaceForRun | null = null;
    let runtimeForAdapter: {
      sessionId: string | null;
      sessionParams: Record<string, unknown> | null;
      sessionDisplayId: string | null;
      taskKey: string | null;
    } = {
      sessionId: null,
      sessionParams: null,
      sessionDisplayId: null,
      taskKey,
    };
    const idleWatchdogRequirement = resolveProtocolRunRequirement({
      protocolMessageType: readNonEmptyString(context.protocolMessageType),
      protocolRecipientRole: readNonEmptyString(context.protocolRecipientRole),
    });
    const idleWatchdogEligible =
      isIdleProtocolWatchdogEligibleRequirement(idleWatchdogRequirement)
      || idleWatchdogRequirement?.key === "implementation_engineer";
    const bumpProtocolIdleWatchdog = () => {
      if (!idleWatchdogEligible) return;
      scheduleProtocolIdleWatchdog(runId);
    };

    const appendCheckpoint = async (
      phase: string,
      message: string,
      payload?: Record<string, unknown>,
    ) => {
      currentPhase = phase;
      const progressAt = new Date();
      lastProgressAt = progressAt;
      await upsertRunLease({
        run: eventRun,
        status: phase.startsWith("finalize.") ? "finalizing" : phase.startsWith("adapter.") ? "executing" : "launching",
        checkpointJson: {
          phase,
          message,
          lastProgressAt: progressAt.toISOString(),
          ...(payload ?? {}),
        },
      });
      await appendRunEvent(eventRun, seq++, {
        eventType: "checkpoint",
        stream: "system",
        level: "info",
        message,
        payload,
      });
      if (phase.startsWith("adapter.")) {
        bumpProtocolIdleWatchdog();
      }
    };

    try {
      await appendCheckpoint("preflight.runtime_state", "loading runtime state");
      const runtime = await ensureRuntimeState(agent);

      const wakeReason = readNonEmptyString(context.wakeReason);
      const issueRuntimeConfig = issueId
        ? await db
            .select({
              assigneeAgentId: issues.assigneeAgentId,
              assigneeAdapterOverrides: issues.assigneeAdapterOverrides,
              status: issues.status,
              workflowState: issueProtocolState.workflowState,
            })
            .from(issues)
            .leftJoin(
              issueProtocolState,
              and(
                eq(issueProtocolState.issueId, issues.id),
                eq(issueProtocolState.companyId, issues.companyId),
              ),
            )
            .where(and(eq(issues.id, issueId), eq(issues.companyId, agent.companyId)))
            .then((rows) => rows[0] ?? null)
        : null;
      if (shouldSkipSupersededProtocolFollowup({
        wakeReason,
        issueStatus: issueRuntimeConfig?.status ?? null,
        workflowState: issueRuntimeConfig?.workflowState ?? null,
        protocolMessageType: readNonEmptyString(context.protocolMessageType),
        protocolRecipientRole: readNonEmptyString(context.protocolRecipientRole),
      })) {
        const message =
          issueRuntimeConfig?.status === "done" || issueRuntimeConfig?.status === "cancelled"
            ? `Skipping stale protocol follow-up because issue is already ${issueRuntimeConfig.status}.`
            : "Skipping stale protocol follow-up because issue workflow no longer matches this wake.";
        currentPhase = "preflight.followup_superseded";
        await appendCheckpoint("preflight.followup_superseded", message, {
          wakeReason,
          issueStatus: issueRuntimeConfig?.status ?? null,
          workflowState: issueRuntimeConfig?.workflowState ?? null,
          protocolMessageType: readNonEmptyString(context.protocolMessageType),
          protocolRecipientRole: readNonEmptyString(context.protocolRecipientRole),
        });
        throw new SupersededProtocolFollowupError(message);
      }

      const issueAssigneeConfig = issueRuntimeConfig
        ? {
            assigneeAgentId: issueRuntimeConfig.assigneeAgentId,
            assigneeAdapterOverrides: issueRuntimeConfig.assigneeAdapterOverrides,
          }
        : null;
      const issueAssigneeOverrides =
        issueAssigneeConfig && issueAssigneeConfig.assigneeAgentId === agent.id
          ? parseIssueAssigneeAdapterOverrides(issueAssigneeConfig.assigneeAdapterOverrides)
          : null;
      taskSession = taskKey
        ? await getTaskSession(agent.companyId, agent.id, agent.adapterType, taskKey)
        : null;
      const resetTaskSession = shouldResetTaskSessionForWake(context);
      const sessionResetReason = describeSessionResetReason(context);
      const taskSessionForRun = resetTaskSession ? null : taskSession;
      previousSessionParams = normalizeSessionParams(
        sessionCodec.deserialize(taskSessionForRun?.sessionParamsJson ?? null),
      );

      await appendCheckpoint("preflight.workspace_resolve", "resolving workspace");
      resolvedWorkspace = await resolveWorkspaceForRun({
        db,
        agent,
        context,
        taskKey,
        previousSessionParams,
        useProjectWorkspace: issueAssigneeOverrides?.useProjectWorkspace ?? null,
      });
      await appendCheckpoint("preflight.workspace_resolved", "workspace resolved", {
        source: resolvedWorkspace.source,
        workspaceId: resolvedWorkspace.workspaceId ?? null,
        projectId: resolvedWorkspace.projectId ?? null,
        workspaceUsage: resolvedWorkspace.workspaceUsage ?? null,
      });

      const runtimeSessionResolution = resolveRuntimeSessionParamsForWorkspace({
        agentId: agent.id,
        previousSessionParams,
        resolvedWorkspace,
      });
      const runtimeSessionParams = runtimeSessionResolution.sessionParams;
      runtimeWorkspaceWarnings = [
        ...resolvedWorkspace.warnings,
        ...(runtimeSessionResolution.warning ? [runtimeSessionResolution.warning] : []),
        ...(resetTaskSession && sessionResetReason
          ? [
              taskKey
                ? `Skipping saved session resume for task "${taskKey}" because ${sessionResetReason}.`
                : `Skipping saved session resume because ${sessionResetReason}.`,
            ]
          : []),
      ];
      attachResolvedWorkspaceContextToRunContext({
        contextSnapshot: context,
        resolvedWorkspace,
      });

      const runtimeSessionFallback = taskKey || resetTaskSession ? null : runtime?.sessionId ?? null;
      previousSessionDisplayId = truncateDisplayId(
        taskSessionForRun?.sessionDisplayId ??
          (sessionCodec.getDisplayId ? sessionCodec.getDisplayId(runtimeSessionParams) : null) ??
          readNonEmptyString(runtimeSessionParams?.sessionId) ??
          runtimeSessionFallback,
      );
      runtimeForAdapter = {
        sessionId: readNonEmptyString(runtimeSessionParams?.sessionId) ?? runtimeSessionFallback,
        sessionParams: runtimeSessionParams,
        sessionDisplayId: previousSessionDisplayId,
        taskKey,
      };
      await appendCheckpoint("preflight.runtime_session_ready", "runtime session resolved", {
        sessionDisplayId: runtimeForAdapter.sessionDisplayId,
        taskKey,
      });

      const startedAt = run.startedAt ?? new Date();
      lastProgressAt = startedAt;
      const runningWithSession = await db
        .update(heartbeatRuns)
        .set({
          startedAt,
          contextSnapshot: context,
          sessionIdBefore: runtimeForAdapter.sessionDisplayId ?? runtimeForAdapter.sessionId,
          updatedAt: new Date(),
        })
        .where(eq(heartbeatRuns.id, run.id))
        .returning()
        .then((rows) => rows[0] ?? null);
      if (runningWithSession) {
        run = runningWithSession;
        eventRun = runningWithSession;
      }

      const runningAgent = await db
        .update(agents)
        .set({ status: "running", updatedAt: new Date() })
        .where(eq(agents.id, agent.id))
        .returning()
        .then((rows) => rows[0] ?? null);

      if (runningAgent) {
        publishLiveEvent({
          companyId: runningAgent.companyId,
          type: "agent.status",
          payload: {
            agentId: runningAgent.id,
            status: runningAgent.status,
            outcome: "running",
          },
        });
      }

      await appendRunEvent(eventRun, seq++, {
        eventType: "lifecycle",
        stream: "system",
        level: "info",
        message: "run started",
      });

      handle = await runLogStore.begin({
        companyId: run.companyId,
        agentId: run.agentId,
        runId,
      });

      await db
        .update(heartbeatRuns)
        .set({
          logStore: handle.store,
          logRef: handle.logRef,
          updatedAt: new Date(),
        })
        .where(eq(heartbeatRuns.id, runId));
      await appendCheckpoint("preflight.log_store_ready", "run log store ready", {
        logStore: handle.store,
      });

      const onLog = async (stream: "stdout" | "stderr" | "system", chunk: string) => {
        lastProgressAt = new Date();
        bumpProtocolIdleWatchdog();
        if (stream === "stdout") stdoutExcerpt = appendExcerpt(stdoutExcerpt, chunk);
        if (stream === "stderr") stderrExcerpt = appendExcerpt(stderrExcerpt, chunk);

        if (handle) {
          await runLogStore.append(handle, {
            stream,
            chunk,
            ts: new Date().toISOString(),
          });
        }

        const payloadChunk =
          chunk.length > MAX_EXCERPT_BYTES
            ? chunk.slice(chunk.length - MAX_EXCERPT_BYTES)
            : chunk;

        publishLiveEvent({
          companyId: eventRun.companyId,
          type: "heartbeat.run.log",
          payload: {
            runId: eventRun.id,
            agentId: eventRun.agentId,
            stream,
            chunk: payloadChunk,
            truncated: payloadChunk.length !== chunk.length,
          },
        });
      };
      for (const warning of runtimeWorkspaceWarnings) {
        await onLog("system", `[squadrail] ${warning}\n`);
      }
      assertResolvedWorkspaceReadyForExecution({ resolvedWorkspace });
      await appendCheckpoint("preflight.workspace_ready", "workspace ready for execution", {
        source: resolvedWorkspace.source,
        workspaceUsage: resolvedWorkspace.workspaceUsage ?? null,
      });

      const config = parseObject(agent.adapterConfig);
      const mergedConfig = issueAssigneeOverrides?.adapterConfig
        ? { ...config, ...issueAssigneeOverrides.adapterConfig }
        : config;
      const resolvedConfig = await resolveAdapterConfigForRuntime(
        agent.companyId,
        mergedConfig,
      );
      const runtimeConfigWithDeployment = {
        ...resolvedConfig,
        deploymentMode: loadConfig().deploymentMode,
      };
      await appendCheckpoint("preflight.adapter_config_ready", "adapter runtime config resolved", {
        adapterType: agent.adapterType,
      });
      const onAdapterMeta = async (meta: AdapterInvocationMeta) => {
        currentPhase = "adapter.invoke";
        lastProgressAt = new Date();
        bumpProtocolIdleWatchdog();
        await appendRunEvent(eventRun, seq++, {
          eventType: "adapter.invoke",
          stream: "system",
          level: "info",
          message: "adapter invocation",
          payload: meta as unknown as Record<string, unknown>,
        });
      };

      const adapter = getServerAdapter(agent.adapterType);
      const authToken = adapter.supportsLocalAgentJwt
        ? createLocalAgentJwt(agent.id, agent.companyId, agent.adapterType, run.id)
        : null;
      await appendCheckpoint("adapter.execute_start", "starting adapter execution", {
        adapterType: agent.adapterType,
      });
      let supersededProtocolCheckInFlight = false;
      leaseHeartbeatTimer = setInterval(() => {
        void (async () => {
          await upsertRunLease({
            run: eventRun,
            status: "executing",
            checkpointJson: {
              phase: currentPhase,
              message: "lease heartbeat",
              lastProgressAt: lastProgressAt.toISOString(),
            },
          });

          if (supersededProtocolCheckInFlight) return;
          supersededProtocolCheckInFlight = true;
          try {
            await cancelSupersededProtocolRunIfNeeded({
              run: eventRun,
              context,
            });
          } finally {
            supersededProtocolCheckInFlight = false;
          }
        })();
      }, 10_000);
      leaseHeartbeatTimer.unref?.();
      const adapterResult = await adapter.execute({
        runId: run.id,
        agent,
        runtime: runtimeForAdapter,
        config: runtimeConfigWithDeployment,
        context,
        onLog,
        onMeta: onAdapterMeta,
        authToken: authToken ?? undefined,
      });
      const nextSessionState = resolveNextSessionState({
        codec: sessionCodec,
        adapterResult,
        previousParams: previousSessionParams,
        previousDisplayId: runtimeForAdapter.sessionDisplayId,
        previousLegacySessionId: runtimeForAdapter.sessionId,
      });
      const protocolRequirement = resolveProtocolRunRequirement({
        protocolMessageType: readNonEmptyString(context.protocolMessageType),
        protocolRecipientRole: readNonEmptyString(context.protocolRecipientRole),
      });
      const protocolRetryCount =
        typeof context.protocolRequiredRetryCount === "number" && Number.isFinite(context.protocolRequiredRetryCount)
          ? context.protocolRequiredRetryCount
          : 0;
      const protocolProgressFollowupCount =
        typeof context.protocolProgressFollowupCount === "number"
        && Number.isFinite(context.protocolProgressFollowupCount)
          ? context.protocolProgressFollowupCount
          : 0;
      const adapterRetryCount =
        typeof context.adapterRetryCount === "number" && Number.isFinite(context.adapterRetryCount)
          ? context.adapterRetryCount
          : 0;
      let protocolProgressResult: Record<string, unknown> | null = null;
      let protocolProgressFailure:
        | {
            error: string;
            errorCode: "protocol_required";
          }
        | null = null;
      let adapterRetryResult: Record<string, unknown> | null = null;
      let adapterRetryEnqueued = false;

      if (
        issueId
        && protocolRequirement
        && (adapterResult.exitCode ?? 0) === 0
        && !adapterResult.errorMessage
      ) {
        currentPhase = "finalize.protocol_progress_check";
        await appendCheckpoint("finalize.protocol_progress_check", "validating protocol progress", {
          protocolMessageType: protocolRequirement.protocolMessageType,
          recipientRole: protocolRequirement.recipientRole,
          requiredMessageTypes: protocolRequirement.requiredMessageTypes,
        });

        const protocolMessages = await db
          .select({
            id: issueProtocolMessages.id,
            messageType: issueProtocolMessages.messageType,
            createdAt: issueProtocolMessages.createdAt,
          })
          .from(issueProtocolMessages)
          .where(
            and(
              eq(issueProtocolMessages.companyId, run.companyId),
              eq(issueProtocolMessages.issueId, issueId),
              eq(issueProtocolMessages.senderActorType, "agent"),
              eq(issueProtocolMessages.senderActorId, agent.id),
              gt(issueProtocolMessages.createdAt, new Date(startedAt.getTime() - 1_000)),
            ),
          )
          .orderBy(asc(issueProtocolMessages.createdAt));
        const helperEvents = await db
          .select({
            eventType: heartbeatRunEvents.eventType,
            payload: heartbeatRunEvents.payload,
            createdAt: heartbeatRunEvents.createdAt,
          })
          .from(heartbeatRunEvents)
          .where(
            and(
              eq(heartbeatRunEvents.companyId, run.companyId),
              eq(heartbeatRunEvents.runId, run.id),
              eq(heartbeatRunEvents.agentId, agent.id),
              eq(heartbeatRunEvents.eventType, "protocol.helper_invocation"),
              gt(heartbeatRunEvents.createdAt, new Date(startedAt.getTime() - 1_000)),
            ),
          )
          .orderBy(asc(heartbeatRunEvents.createdAt));
        const effectiveProtocolMessages = mergeProtocolMessagesWithHelperInvocations({
          messages: protocolMessages,
          helperEvents,
        });

        const observedMessageTypes = Array.from(
          new Set(
            effectiveProtocolMessages
              .map((message) => readNonEmptyString(message.messageType))
              .filter((messageType): messageType is string => Boolean(messageType)),
          ),
        );
        const issueStateSnapshot = issueId
          ? await db
            .select({
              status: issues.status,
              workflowState: issueProtocolState.workflowState,
            })
            .from(issues)
            .leftJoin(
              issueProtocolState,
              and(
                eq(issueProtocolState.issueId, issues.id),
                eq(issueProtocolState.companyId, issues.companyId),
              ),
            )
            .where(and(eq(issues.id, issueId), eq(issues.companyId, agent.companyId)))
            .limit(1)
            .then((rows) => rows[0] ?? null)
          : null;
        const satisfied = hasRequiredProtocolProgress({
          requirement: protocolRequirement,
          messages: effectiveProtocolMessages,
          finalWorkflowState: issueStateSnapshot?.workflowState ?? null,
        });

        protocolProgressResult = {
          required: true,
          protocolMessageType: protocolRequirement.protocolMessageType,
          recipientRole: protocolRequirement.recipientRole,
          requiredMessageTypes: protocolRequirement.requiredMessageTypes,
          observedMessageTypes,
          retryCount: protocolRetryCount,
          satisfied,
        };

        if (!satisfied) {
          const retryEnqueued = shouldEnqueueProtocolRequiredRetry({
            protocolRetryCount,
            issueStatus: issueStateSnapshot?.status ?? null,
            workflowState: issueStateSnapshot?.workflowState ?? null,
            requirement: protocolRequirement,
          });
          if (retryEnqueued) {
            const retryContextSnapshot: Record<string, unknown> = refreshProtocolRetryContextSnapshot({
              contextSnapshot: {
                ...context,
                issueId,
                taskId: issueId,
                wakeReason: "protocol_required_retry",
                protocolOriginalWakeReason: readNonEmptyString(context.wakeReason),
                protocolRequiredRetryCount: protocolRetryCount + 1,
                protocolRequiredPreviousRunId: run.id,
                forceFollowupRun: true,
              },
              workflowState: issueStateSnapshot?.workflowState ?? null,
            });
            Object.assign(retryContextSnapshot, {
              issueId,
              taskId: issueId,
              wakeReason: "protocol_required_retry",
              protocolOriginalWakeReason: readNonEmptyString(context.wakeReason),
              protocolRequiredRetryCount: protocolRetryCount + 1,
              protocolRequiredPreviousRunId: run.id,
              forceFollowupRun: true,
            });
            await enqueueWakeup(agent.id, {
              source: "automation",
              triggerDetail: "system",
              reason: "protocol_required_retry",
              payload: {
                issueId,
                protocolRequiredPreviousRunId: run.id,
              },
              contextSnapshot: retryContextSnapshot,
            });
          }

          const error = buildRequiredProtocolProgressError({
            requirement: protocolRequirement,
            observedMessageTypes,
            retryEnqueued,
          });
          protocolProgressFailure = {
            error,
            errorCode: "protocol_required",
          };

          await appendRunEvent(eventRun, seq++, {
            eventType: "protocol.required",
            stream: "system",
            level: "error",
            message: error,
            payload: {
              protocolMessageType: protocolRequirement.protocolMessageType,
              recipientRole: protocolRequirement.recipientRole,
              requiredMessageTypes: protocolRequirement.requiredMessageTypes,
              observedMessageTypes,
              retryEnqueued,
              retryCount: protocolRetryCount,
            },
          });
        } else {
          const progressFollowupEnqueued = shouldEnqueueImplementationProgressFollowup({
            forceFollowupRun: context.forceFollowupRun === true,
            progressFollowupCount: protocolProgressFollowupCount,
            issueStatus: issueStateSnapshot?.status ?? null,
            workflowState: issueStateSnapshot?.workflowState ?? null,
            requirement: protocolRequirement,
            observedMessageTypes,
          });
          if (progressFollowupEnqueued) {
            const followupContextSnapshot: Record<string, unknown> = refreshProtocolRetryContextSnapshot({
              contextSnapshot: {
                ...context,
                issueId,
                taskId: issueId,
                wakeReason: "protocol_progress_followup",
                protocolOriginalWakeReason: readNonEmptyString(context.wakeReason),
                protocolProgressFollowupCount: protocolProgressFollowupCount + 1,
                protocolProgressPreviousRunId: run.id,
                forceFollowupRun: true,
                forceFreshAdapterSession: true,
              },
              workflowState: issueStateSnapshot?.workflowState ?? null,
            });
            Object.assign(followupContextSnapshot, {
              issueId,
              taskId: issueId,
              wakeReason: "protocol_progress_followup",
              protocolOriginalWakeReason: readNonEmptyString(context.wakeReason),
              protocolProgressFollowupCount: protocolProgressFollowupCount + 1,
              protocolProgressPreviousRunId: run.id,
              forceFollowupRun: true,
              forceFreshAdapterSession: true,
            });
            await enqueueWakeup(agent.id, {
              source: "automation",
              triggerDetail: "system",
              reason: "protocol_progress_followup",
              payload: {
                issueId,
                protocolProgressPreviousRunId: run.id,
              },
              contextSnapshot: followupContextSnapshot,
            });
            await appendRunEvent(eventRun, seq++, {
              eventType: "protocol.followup",
              stream: "system",
              level: "info",
              message: "queued implementation follow-up after progress-only completion",
              payload: {
                progressFollowupCount: protocolProgressFollowupCount,
                observedMessageTypes,
              },
            });
          }
        }
      }

      if (
        issueId
        && (adapterResult.exitCode ?? 0) !== 0
        && adapterResult.errorMessage
      ) {
        const issueStateSnapshot = await db
          .select({
            status: issues.status,
          })
          .from(issues)
          .where(and(eq(issues.id, issueId), eq(issues.companyId, agent.companyId)))
          .limit(1)
          .then((rows) => rows[0] ?? null);
        adapterRetryEnqueued = shouldEnqueueRetryableAdapterFailure({
          adapterErrorCode: adapterResult.errorCode ?? null,
          adapterRetryCount,
          issueStatus: issueStateSnapshot?.status ?? null,
        });
        adapterRetryResult = {
          required: Boolean(readNonEmptyString(adapterResult.errorCode)),
          errorCode: adapterResult.errorCode ?? null,
          retryCount: adapterRetryCount,
          retryEnqueued: adapterRetryEnqueued,
        };

        if (adapterRetryEnqueued) {
          const retryContextSnapshot: Record<string, unknown> = {
            ...context,
            issueId,
            taskId: issueId,
            wakeReason: "adapter_retry",
            adapterRetryCount: adapterRetryCount + 1,
            adapterRetryPreviousRunId: run.id,
            adapterRetryErrorCode: adapterResult.errorCode,
            forceFollowupRun: true,
            forceFreshAdapterSession: true,
          };
          await enqueueWakeup(agent.id, {
            source: "automation",
            triggerDetail: "system",
            reason: "adapter_retry",
            payload: {
              issueId,
              adapterRetryPreviousRunId: run.id,
              adapterRetryErrorCode: adapterResult.errorCode,
            },
            contextSnapshot: retryContextSnapshot,
          });
          await appendRunEvent(eventRun, seq++, {
            eventType: "adapter.retryable_failure",
            stream: "system",
            level: "warn",
            message: `queued retry follow-up after transient adapter failure (${adapterResult.errorCode})`,
            payload: {
              errorCode: adapterResult.errorCode,
              retryCount: adapterRetryCount,
            },
          });
        }
      }

      const latestRun = await getRun(run.id);
      const outcome = resolveHeartbeatRunOutcome({
        latestRunStatus: latestRun?.status ?? null,
        timedOut: adapterResult.timedOut,
        exitCode: adapterResult.exitCode,
        errorMessage: adapterResult.errorMessage,
        protocolProgressFailure,
      });

      let logSummary: { bytes: number; sha256?: string; compressed: boolean } | null = null;
      if (handle) {
        logSummary = await runLogStore.finalize(handle);
      }

      const usageJson =
        adapterResult.usage || adapterResult.costUsd != null
          ? ({
              ...(adapterResult.usage ?? {}),
              ...(adapterResult.costUsd != null ? { costUsd: adapterResult.costUsd } : {}),
              ...(adapterResult.billingType ? { billingType: adapterResult.billingType } : {}),
            } as Record<string, unknown>)
          : null;
      let workspaceGitSnapshot: Record<string, unknown> | null = null;
      if (
        resolvedWorkspace
        && isRepoBackedWorkspaceSource(resolvedWorkspace.source)
        && resolvedWorkspace.workspaceUsage === "implementation"
      ) {
        currentPhase = "finalize.workspace_snapshot";
        await appendCheckpoint("finalize.workspace_snapshot", "capturing workspace git snapshot", {
          source: resolvedWorkspace.source,
          workspaceId: resolvedWorkspace.workspaceId ?? null,
          branchName: resolvedWorkspace.branchName ?? null,
        });
        try {
          const snapshot = await inspectWorkspaceGitSnapshot({
            cwd: resolvedWorkspace.cwd,
            branchName: resolvedWorkspace.branchName,
          });
          if (snapshot) {
            workspaceGitSnapshot = snapshot as Record<string, unknown>;
            await appendRunEvent(eventRun, seq++, {
              eventType: "workspace.snapshot",
              stream: "system",
              level: "info",
              message: snapshot.hasChanges
                ? `workspace snapshot captured (${snapshot.changedFiles.length} changed file(s))`
                : "workspace snapshot captured (clean working tree)",
              payload: {
                branchName: snapshot.branchName,
                expectedBranchName: snapshot.expectedBranchName,
                branchMismatch: snapshot.branchMismatch,
                headSha: snapshot.headSha,
                hasChanges: snapshot.hasChanges,
                changedFiles: snapshot.changedFiles,
                diffStat: snapshot.diffStat,
              },
            });
          }
        } catch {
          await appendRunEvent(eventRun, seq++, {
            eventType: "workspace.snapshot",
            stream: "system",
            level: "warn",
            message: "failed to capture workspace git snapshot",
            payload: {
              source: resolvedWorkspace.source,
              workspaceId: resolvedWorkspace.workspaceId ?? null,
            },
          });
        }
      }
      const resultJson = mergeRunResultJson(
        adapterResult.resultJson ?? null,
        {
          ...(workspaceGitSnapshot ? { workspaceGitSnapshot } : {}),
          ...(protocolProgressResult ? { protocolProgress: protocolProgressResult } : {}),
          ...(adapterRetryResult ? { adapterRetry: adapterRetryResult } : {}),
        },
      );
      const verificationSignals = extractRunVerificationSignals({
        stdoutExcerpt,
        stderrExcerpt,
        resultJson,
      });
      const enrichedResultJson = mergeRunResultJson(
        resultJson,
        verificationSignals.length > 0 ? { verificationSignals } : null,
      );
      if (verificationSignals.length > 0) {
        await appendRunEvent(eventRun, seq++, {
          eventType: "verification.signals",
          stream: "system",
          level: "info",
          message: `captured ${verificationSignals.length} verification signal(s)`,
          payload: {
            verificationSignals,
          },
        });
      }

      const persistence = buildHeartbeatOutcomePersistence({
        outcome,
        protocolProgressFailure,
        adapterResult,
        usageJson,
        resultJson: enrichedResultJson,
        nextSessionDisplayId: nextSessionState.displayId,
        nextSessionLegacyId: nextSessionState.legacySessionId,
        stdoutExcerpt,
        stderrExcerpt,
        logSummary,
      });
      const status = persistence.status;
      await appendCheckpoint("finalize.persist_outcome", "persisting adapter outcome", {
        outcome,
        status,
      });

      await setRunStatus(run.id, status, persistence.runPatch);
      await setWakeupStatus(run.wakeupRequestId, persistence.wakeupStatus, persistence.wakeupPatch);

      const finalizedRun = await getRun(run.id);
      if (finalizedRun) {
        await appendRunEvent(finalizedRun, seq++, {
          eventType: "lifecycle",
          stream: "system",
          level: outcome === "succeeded" ? "info" : "error",
          message: `run ${outcome}`,
          payload: {
            status,
            exitCode: adapterResult.exitCode,
          },
        });
        await releaseIssueExecutionAndPromote(finalizedRun);
        if ((status === "failed" || status === "timed_out") && !adapterRetryEnqueued) {
          await wakeLeadSupervisorForRunFailure({
            run: finalizedRun,
            status,
            errorCode:
              status === "timed_out"
                ? "timeout"
                : status === "failed"
                  ? (adapterResult.errorCode ?? "adapter_failed")
                  : null,
            error:
              outcome === "succeeded"
                ? null
                : protocolProgressFailure?.error ??
                  adapterResult.errorMessage ??
                  (outcome === "timed_out" ? "Timed out" : "Adapter failed"),
          });
        }
        await upsertRunLease({
          run: finalizedRun,
          status: status === "succeeded" ? "released" : status,
          checkpointJson: {
            phase: "finalize.complete",
            message: `run ${outcome}`,
            status,
          },
          heartbeatAt: new Date(),
          leaseExpiresAt: new Date(),
          releasedAt: new Date(),
          lastError:
            outcome === "succeeded"
              ? null
              : (protocolProgressFailure?.error ?? adapterResult.errorMessage ?? "run_failed"),
        });
      }

      if (finalizedRun) {
        await updateRuntimeState(agent, finalizedRun, adapterResult, {
          legacySessionId: nextSessionState.legacySessionId,
        });
        if (taskKey) {
          if (adapterResult.clearSession || (!nextSessionState.params && !nextSessionState.displayId)) {
            await clearTaskSessions(agent.companyId, agent.id, {
              taskKey,
              adapterType: agent.adapterType,
            });
          } else {
            await upsertTaskSession({
              companyId: agent.companyId,
              agentId: agent.id,
              adapterType: agent.adapterType,
              taskKey,
              sessionParamsJson: nextSessionState.params,
              sessionDisplayId: nextSessionState.displayId,
              lastRunId: finalizedRun.id,
              lastError:
                outcome === "succeeded"
                  ? null
                  : (protocolProgressFailure?.error ?? adapterResult.errorMessage ?? "run_failed"),
            });
          }
        }
      }
      await finalizeAgentStatus(agent.id, outcome);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown adapter failure";
      const errorCode =
        err instanceof WorkspaceResolutionError
          ? err.code
          : err instanceof SupersededProtocolFollowupError
            ? err.code
            : "adapter_failed";

      let logSummary: { bytes: number; sha256?: string; compressed: boolean } | null = null;
      if (handle) {
        try {
          logSummary = await runLogStore.finalize(handle);
        } catch {
          logSummary = null;
        }
      }

      const failedRun = await setRunStatus(run.id, errorCode === "superseded_followup" ? "cancelled" : "failed", {
        error: message,
        errorCode,
        finishedAt: new Date(),
        stdoutExcerpt,
        stderrExcerpt,
        logBytes: logSummary?.bytes,
        logSha256: logSummary?.sha256,
        logCompressed: logSummary?.compressed ?? false,
      });
      await setWakeupStatus(run.wakeupRequestId, errorCode === "superseded_followup" ? "cancelled" : "failed", {
        finishedAt: new Date(),
        error: message,
      });
      await upsertRunLease({
        run: eventRun,
        status: errorCode === "superseded_followup" ? "cancelled" : "failed",
        checkpointJson: {
          phase: currentPhase,
          message,
        },
        heartbeatAt: new Date(),
        leaseExpiresAt: new Date(),
        releasedAt: new Date(),
        lastError: message,
      });

      if (failedRun) {
        await appendRunEvent(failedRun, seq++, {
          eventType: "error",
          stream: "system",
          level: "error",
          message,
          payload: {
            phase: currentPhase,
            taskKey,
            workspaceSource: resolvedWorkspace?.source ?? null,
            workspaceUsage: resolvedWorkspace?.workspaceUsage ?? null,
          },
        });
        await releaseIssueExecutionAndPromote(failedRun);
        if (errorCode !== "superseded_followup") {
          await wakeLeadSupervisorForRunFailure({
            run: failedRun,
            status: "failed",
            errorCode,
            error: message,
          });
        }

        await updateRuntimeState(agent, failedRun, {
          exitCode: null,
          signal: null,
          timedOut: false,
          errorMessage: message,
        }, {
          legacySessionId: runtimeForAdapter.sessionId,
        });

        if (taskKey && (previousSessionParams || previousSessionDisplayId || taskSession)) {
          await upsertTaskSession({
            companyId: agent.companyId,
            agentId: agent.id,
            adapterType: agent.adapterType,
            taskKey,
            sessionParamsJson: previousSessionParams,
            sessionDisplayId: previousSessionDisplayId,
            lastRunId: failedRun.id,
            lastError: message,
          });
        }
      }

      await finalizeAgentStatus(agent.id, errorCode === "superseded_followup" ? "cancelled" : "failed");
    } finally {
      clearDispatchWatchdog(runId);
      clearProtocolIdleWatchdog(runId);
      if (leaseHeartbeatTimer) {
        clearInterval(leaseHeartbeatTimer);
      }
      dispatchAgentQueueStart(agent.id);
    }
  }

  return {
    dispatchAgentQueueStart: dispatchQueuedStart,
    executeRun,
    startNextQueuedRunForAgent,
  };
}
