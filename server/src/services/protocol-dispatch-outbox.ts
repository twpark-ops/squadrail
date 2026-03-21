import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import {
  issueProtocolDispatchOutbox,
  type Db,
} from "@squadrail/db";

export const PROTOCOL_DISPATCH_OUTBOX_GRACE_MS = 5_000;
export const PROTOCOL_DISPATCH_OUTBOX_RETRY_MS = 5_000;
export const PROTOCOL_DISPATCH_OUTBOX_BATCH_SIZE = 50;

function truncateError(value: string | null | undefined) {
  if (!value) return null;
  return value.length > 1_000 ? value.slice(0, 1_000) : value;
}

export function shouldPersistProtocolDispatchOutbox(messageType: string) {
  return messageType !== "CANCEL_TASK";
}

export function computeProtocolDispatchOutboxNotBefore(now = new Date(), delayMs = PROTOCOL_DISPATCH_OUTBOX_GRACE_MS) {
  return new Date(now.getTime() + delayMs);
}

export async function enqueueProtocolDispatchOutboxTx(
  tx: Pick<Db, "insert">,
  input: {
    companyId: string;
    issueId: string;
    protocolMessageId: string;
    notBefore?: Date;
  },
) {
  await tx
    .insert(issueProtocolDispatchOutbox)
    .values({
      companyId: input.companyId,
      issueId: input.issueId,
      protocolMessageId: input.protocolMessageId,
      status: "pending",
      notBefore: input.notBefore ?? computeProtocolDispatchOutboxNotBefore(),
      dispatchResult: {},
    })
    .onConflictDoNothing();
}

export function protocolDispatchOutboxService(db: Db) {
  return {
    listDuePending: async (input?: { now?: Date; limit?: number }) =>
      db
        .select()
        .from(issueProtocolDispatchOutbox)
        .where(
          and(
            inArray(issueProtocolDispatchOutbox.status, ["pending", "failed"]),
            lte(issueProtocolDispatchOutbox.notBefore, input?.now ?? new Date()),
          ),
        )
        .orderBy(asc(issueProtocolDispatchOutbox.notBefore), asc(issueProtocolDispatchOutbox.createdAt))
        .limit(input?.limit ?? PROTOCOL_DISPATCH_OUTBOX_BATCH_SIZE),

    markDispatched: async (input: {
      protocolMessageId: string;
      dispatchResult?: Record<string, unknown>;
    }) => {
      const now = new Date();
      await db
        .update(issueProtocolDispatchOutbox)
        .set({
          status: "dispatched",
          dispatchedAt: now,
          settledAt: now,
          lastAttemptAt: now,
          lastError: null,
          dispatchResult: input.dispatchResult ?? {},
          updatedAt: now,
        })
        .where(eq(issueProtocolDispatchOutbox.protocolMessageId, input.protocolMessageId));
    },

    markNoAction: async (input: {
      protocolMessageId: string;
      dispatchResult?: Record<string, unknown>;
    }) => {
      const now = new Date();
      await db
        .update(issueProtocolDispatchOutbox)
        .set({
          status: "no_action",
          settledAt: now,
          lastAttemptAt: now,
          lastError: null,
          dispatchResult: input.dispatchResult ?? {},
          updatedAt: now,
        })
        .where(eq(issueProtocolDispatchOutbox.protocolMessageId, input.protocolMessageId));
    },

    markFailed: async (input: {
      protocolMessageId: string;
      error: string;
      retryAt?: Date;
      dispatchResult?: Record<string, unknown>;
    }) => {
      const now = new Date();
      await db
        .update(issueProtocolDispatchOutbox)
        .set({
          status: "failed",
          attemptCount: sql`${issueProtocolDispatchOutbox.attemptCount} + 1`,
          lastAttemptAt: now,
          notBefore: input.retryAt ?? computeProtocolDispatchOutboxNotBefore(now, PROTOCOL_DISPATCH_OUTBOX_RETRY_MS),
          lastError: truncateError(input.error),
          dispatchResult: input.dispatchResult ?? {},
          updatedAt: now,
        })
        .where(eq(issueProtocolDispatchOutbox.protocolMessageId, input.protocolMessageId));
    },

    markPendingRetryNow: async (input: {
      protocolMessageId: string;
      error: string;
      dispatchResult?: Record<string, unknown>;
    }) => {
      const now = new Date();
      await db
        .update(issueProtocolDispatchOutbox)
        .set({
          status: "pending",
          attemptCount: sql`${issueProtocolDispatchOutbox.attemptCount} + 1`,
          lastAttemptAt: now,
          notBefore: now,
          lastError: truncateError(input.error),
          dispatchResult: input.dispatchResult ?? {},
          updatedAt: now,
        })
        .where(eq(issueProtocolDispatchOutbox.protocolMessageId, input.protocolMessageId));
    },
  };
}
