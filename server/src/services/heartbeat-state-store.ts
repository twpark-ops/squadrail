import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@squadrail/db";
import {
  agents,
  agentRuntimeState,
  agentTaskSessions,
  agentWakeupRequests,
  heartbeatRunEvents,
  heartbeatRunLeases,
  heartbeatRuns,
} from "@squadrail/db";
import type { LiveEventType } from "@squadrail/shared";
import {
  buildTaskSessionUpsertSet,
  computeLeaseExpiresAt,
  getAdapterSessionCodec,
  insertOrRefetchSingleton,
  normalizeSessionParams,
  readNonEmptyString,
  truncateDisplayId,
} from "./heartbeat-runtime-utils.js";

type PublishHeartbeatLiveEvent = (input: {
  companyId: string;
  type: LiveEventType;
  payload?: Record<string, unknown>;
}) => unknown;

export function createHeartbeatStateStore(input: {
  db: Db;
  publishLiveEvent: PublishHeartbeatLiveEvent;
}) {
  const { db, publishLiveEvent } = input;

  async function getAgent(agentId: string) {
    return db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((rows) => rows[0] ?? null);
  }

  async function getRun(runId: string) {
    return db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
  }

  async function getRunLease(runId: string) {
    return db
      .select()
      .from(heartbeatRunLeases)
      .where(eq(heartbeatRunLeases.runId, runId))
      .then((rows) => rows[0] ?? null);
  }

  async function nextRunEventSeq(runId: string) {
    const latest = await db
      .select({ seq: heartbeatRunEvents.seq })
      .from(heartbeatRunEvents)
      .where(eq(heartbeatRunEvents.runId, runId))
      .orderBy(desc(heartbeatRunEvents.seq))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    return (latest?.seq ?? 0) + 1;
  }

  async function getRuntimeState(agentId: string) {
    return db
      .select()
      .from(agentRuntimeState)
      .where(eq(agentRuntimeState.agentId, agentId))
      .then((rows) => rows[0] ?? null);
  }

  async function getTaskSession(
    companyId: string,
    agentId: string,
    adapterType: string,
    taskKey: string,
  ) {
    return db
      .select()
      .from(agentTaskSessions)
      .where(
        and(
          eq(agentTaskSessions.companyId, companyId),
          eq(agentTaskSessions.agentId, agentId),
          eq(agentTaskSessions.adapterType, adapterType),
          eq(agentTaskSessions.taskKey, taskKey),
        ),
      )
      .then((rows) => rows[0] ?? null);
  }

  async function resolveSessionBeforeForWakeup(
    agent: typeof agents.$inferSelect,
    taskKey: string | null,
  ) {
    if (taskKey) {
      const codec = getAdapterSessionCodec(agent.adapterType);
      const existingTaskSession = await getTaskSession(
        agent.companyId,
        agent.id,
        agent.adapterType,
        taskKey,
      );
      const parsedParams = normalizeSessionParams(
        codec.deserialize(existingTaskSession?.sessionParamsJson ?? null),
      );
      return truncateDisplayId(
        existingTaskSession?.sessionDisplayId
          ?? (codec.getDisplayId ? codec.getDisplayId(parsedParams) : null)
          ?? readNonEmptyString(parsedParams?.sessionId),
      );
    }

    const runtimeForRun = await getRuntimeState(agent.id);
    return runtimeForRun?.sessionId ?? null;
  }

  async function upsertTaskSession(inputValue: {
    companyId: string;
    agentId: string;
    adapterType: string;
    taskKey: string;
    sessionParamsJson: Record<string, unknown> | null;
    sessionDisplayId: string | null;
    lastRunId: string | null;
    lastError: string | null;
  }) {
    const upsertSet = buildTaskSessionUpsertSet(inputValue);
    return db
      .insert(agentTaskSessions)
      .values({
        companyId: inputValue.companyId,
        agentId: inputValue.agentId,
        adapterType: inputValue.adapterType,
        taskKey: inputValue.taskKey,
        sessionParamsJson: inputValue.sessionParamsJson,
        sessionDisplayId: inputValue.sessionDisplayId,
        lastRunId: inputValue.lastRunId,
        lastError: inputValue.lastError,
      })
      .onConflictDoUpdate({
        target: [
          agentTaskSessions.companyId,
          agentTaskSessions.agentId,
          agentTaskSessions.adapterType,
          agentTaskSessions.taskKey,
        ],
        set: upsertSet,
      })
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  async function clearTaskSessions(
    companyId: string,
    agentId: string,
    opts?: { taskKey?: string | null; adapterType?: string | null },
  ) {
    const conditions = [
      eq(agentTaskSessions.companyId, companyId),
      eq(agentTaskSessions.agentId, agentId),
    ];
    if (opts?.taskKey) {
      conditions.push(eq(agentTaskSessions.taskKey, opts.taskKey));
    }
    if (opts?.adapterType) {
      conditions.push(eq(agentTaskSessions.adapterType, opts.adapterType));
    }

    return db
      .delete(agentTaskSessions)
      .where(and(...conditions))
      .returning()
      .then((rows) => rows.length);
  }

  async function ensureRuntimeState(agent: typeof agents.$inferSelect) {
    const existing = await getRuntimeState(agent.id);
    if (existing) return existing;

    return insertOrRefetchSingleton({
      insert: () =>
        db
          .insert(agentRuntimeState)
          .values({
            agentId: agent.id,
            companyId: agent.companyId,
            adapterType: agent.adapterType,
            stateJson: {},
          })
          .onConflictDoNothing()
          .returning()
          .then((rows) => rows[0] ?? null),
      refetch: () => getRuntimeState(agent.id),
    });
  }

  async function setRunStatus(
    runId: string,
    status: string,
    patch?: Partial<typeof heartbeatRuns.$inferInsert>,
  ) {
    const updated = await db
      .update(heartbeatRuns)
      .set({ status, ...patch, updatedAt: new Date() })
      .where(eq(heartbeatRuns.id, runId))
      .returning()
      .then((rows) => rows[0] ?? null);

    if (updated) {
      publishLiveEvent({
        companyId: updated.companyId,
        type: "heartbeat.run.status",
        payload: {
          runId: updated.id,
          agentId: updated.agentId,
          status: updated.status,
          invocationSource: updated.invocationSource,
          triggerDetail: updated.triggerDetail,
          error: updated.error ?? null,
          errorCode: updated.errorCode ?? null,
          startedAt: updated.startedAt ? new Date(updated.startedAt).toISOString() : null,
          finishedAt: updated.finishedAt ? new Date(updated.finishedAt).toISOString() : null,
        },
      });
    }

    return updated;
  }

  async function setWakeupStatus(
    wakeupRequestId: string | null | undefined,
    status: string,
    patch?: Partial<typeof agentWakeupRequests.$inferInsert>,
  ) {
    if (!wakeupRequestId) return;
    await db
      .update(agentWakeupRequests)
      .set({ status, ...patch, updatedAt: new Date() })
      .where(eq(agentWakeupRequests.id, wakeupRequestId));
  }

  async function upsertRunLease(inputValue: {
    run: typeof heartbeatRuns.$inferSelect;
    status: string;
    checkpointJson?: Record<string, unknown> | null;
    heartbeatAt?: Date;
    leaseExpiresAt?: Date;
    releasedAt?: Date | null;
    lastError?: string | null;
  }) {
    const heartbeatAt = inputValue.heartbeatAt ?? new Date();
    const leaseExpiresAt = inputValue.leaseExpiresAt ?? computeLeaseExpiresAt(heartbeatAt);

    await db
      .insert(heartbeatRunLeases)
      .values({
        runId: inputValue.run.id,
        companyId: inputValue.run.companyId,
        agentId: inputValue.run.agentId,
        status: inputValue.status,
        checkpointJson: inputValue.checkpointJson ?? null,
        heartbeatAt,
        leaseExpiresAt,
        releasedAt: inputValue.releasedAt ?? null,
        lastError: inputValue.lastError ?? null,
      })
      .onConflictDoUpdate({
        target: heartbeatRunLeases.runId,
        set: {
          status: inputValue.status,
          checkpointJson: inputValue.checkpointJson ?? null,
          heartbeatAt,
          leaseExpiresAt,
          releasedAt: inputValue.releasedAt ?? null,
          lastError: inputValue.lastError ?? null,
          updatedAt: new Date(),
        },
      });
  }

  async function appendRunEvent(
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
  ) {
    await db.insert(heartbeatRunEvents).values({
      companyId: run.companyId,
      runId: run.id,
      agentId: run.agentId,
      seq,
      eventType: event.eventType,
      stream: event.stream,
      level: event.level,
      color: event.color,
      message: event.message,
      payload: event.payload,
    });

    publishLiveEvent({
      companyId: run.companyId,
      type: "heartbeat.run.event",
      payload: {
        runId: run.id,
        agentId: run.agentId,
        seq,
        eventType: event.eventType,
        stream: event.stream ?? null,
        level: event.level ?? null,
        color: event.color ?? null,
        message: event.message ?? null,
        payload: event.payload ?? null,
      },
    });
  }

  async function countRunningRunsForAgent(agentId: string) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.agentId, agentId), eq(heartbeatRuns.status, "running")));
    return Number(count ?? 0);
  }

  return {
    getAgent,
    getRun,
    getRunLease,
    nextRunEventSeq,
    getRuntimeState,
    getTaskSession,
    resolveSessionBeforeForWakeup,
    upsertTaskSession,
    clearTaskSessions,
    ensureRuntimeState,
    setRunStatus,
    setWakeupStatus,
    upsertRunLease,
    appendRunEvent,
    countRunningRunsForAgent,
  };
}
