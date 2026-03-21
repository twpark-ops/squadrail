import { and, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import {
  agentWakeupRequests,
  heartbeatRuns,
  issueProtocolArtifacts,
  issueProtocolDispatchOutbox,
  issueProtocolMessages,
  issueProtocolRecipients,
  issueProtocolState,
  issues,
  type Db,
} from "@squadrail/db";
import type { CreateIssueProtocolMessage } from "@squadrail/shared";
import { logger } from "../middleware/logger.js";
import { logActivity } from "./activity-log.js";
import {
  buildProtocolExecutionDispatchPlan,
  issueProtocolExecutionService,
  type ProtocolExecutionRecipientHint,
} from "./issue-protocol-execution.js";
import { issueProtocolService } from "./issue-protocol.js";
import { knowledgeService } from "./knowledge.js";
import { protocolDispatchOutboxService } from "./protocol-dispatch-outbox.js";
import {
  deriveBriefScope,
  deriveRetrievalEventType,
} from "./retrieval/query.js";
import {
  buildProtocolDispatchReconciliationActor,
  maybeApplyPreRetrievalSupervisorReroute,
  shouldDispatchBeforeProtocolRetrieval,
} from "./protocol-dispatch-routing.js";
import { loadInternalWorkItemSupervisorContext } from "./internal-work-item-supervision.js";

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

type IssueDispatchSnapshot = {
  issueId: string;
  companyId: string;
  projectId: string | null;
  issueStatus: string;
  workflowState: string;
  blockedByMessageId: string | null;
};

type LegacyDispatchCandidate = IssueDispatchSnapshot & {
  protocolMessageId: string;
};

type PendingOutboxEntry = typeof issueProtocolDispatchOutbox.$inferSelect;

type HydratedProtocolMessage = CreateIssueProtocolMessage & {
  id: string;
};

type ReconciliationDeps = {
  listPendingOutboxEntries?: () => Promise<PendingOutboxEntry[]>;
  listLegacyCandidates?: () => Promise<LegacyDispatchCandidate[]>;
  loadMessages?: (messageIds: string[]) => Promise<Map<string, HydratedProtocolMessage>>;
  hasDispatchEvidence?: (input: {
    companyId: string;
    protocolMessageId: string;
  }) => Promise<boolean>;
  buildRecipientHints?: (input: {
    issueId: string;
    message: CreateIssueProtocolMessage;
  }) => Promise<ProtocolExecutionRecipientHint[]>;
  dispatchMessage?: (input: Parameters<ReturnType<typeof issueProtocolExecutionService>["dispatchMessage"]>[0]) => Promise<{
    queued: number;
    notifyOnly: number;
    skipped: number;
  }>;
  loadIssueContext?: (companyId: string, issueId: string) => Promise<unknown>;
  loadIssueSnapshot?: (companyId: string, issueId: string) => Promise<IssueDispatchSnapshot | null>;
  applyPreRetrievalReroute?: typeof maybeApplyPreRetrievalSupervisorReroute;
  markOutboxDispatched?: (input: { protocolMessageId: string; dispatchResult?: Record<string, unknown> }) => Promise<void>;
  markOutboxNoAction?: (input: { protocolMessageId: string; dispatchResult?: Record<string, unknown> }) => Promise<void>;
  markOutboxFailed?: (input: { protocolMessageId: string; error: string; dispatchResult?: Record<string, unknown> }) => Promise<void>;
};

function buildHydratedProtocolMessage(input: {
  message: typeof issueProtocolMessages.$inferSelect;
  recipients: Array<typeof issueProtocolRecipients.$inferSelect>;
  artifacts: Array<typeof issueProtocolArtifacts.$inferSelect>;
}): HydratedProtocolMessage {
  return {
    id: input.message.id,
    messageType: input.message.messageType as CreateIssueProtocolMessage["messageType"],
    sender: {
      actorType: input.message.senderActorType as CreateIssueProtocolMessage["sender"]["actorType"],
      actorId: input.message.senderActorId,
      role: input.message.senderRole as CreateIssueProtocolMessage["sender"]["role"],
    },
    recipients: input.recipients.map((recipient) => ({
      recipientType: recipient.recipientType as CreateIssueProtocolMessage["recipients"][number]["recipientType"],
      recipientId: recipient.recipientId,
      role: recipient.recipientRole as CreateIssueProtocolMessage["recipients"][number]["role"],
    })),
    workflowStateBefore: input.message.workflowStateBefore as CreateIssueProtocolMessage["workflowStateBefore"],
    workflowStateAfter: input.message.workflowStateAfter as CreateIssueProtocolMessage["workflowStateAfter"],
    summary: input.message.summary,
    payload: (input.message.payload ?? {}) as CreateIssueProtocolMessage["payload"],
    requiresAck: input.message.requiresAck,
    artifacts: input.artifacts.map((artifact) => ({
      kind: artifact.artifactKind as CreateIssueProtocolMessage["artifacts"][number]["kind"],
      uri: artifact.artifactUri,
      label: artifact.label ?? undefined,
      metadata: artifact.metadata,
    })),
  } as HydratedProtocolMessage;
}

export function protocolDispatchReconciliationService(db: Db, deps?: ReconciliationDeps) {
  const protocolSvc = issueProtocolService(db);
  const execution = issueProtocolExecutionService(db);
  const knowledge = knowledgeService(db);
  const outbox = protocolDispatchOutboxService(db);

  const listPendingOutboxEntries = deps?.listPendingOutboxEntries ?? (() => outbox.listDuePending());

  const loadIssueSnapshot = deps?.loadIssueSnapshot ?? (async (companyId: string, issueId: string) =>
    db
      .select({
        issueId: issues.id,
        companyId: issues.companyId,
        projectId: issues.projectId,
        issueStatus: issues.status,
        workflowState: issueProtocolState.workflowState,
        blockedByMessageId: issueProtocolState.blockedByMessageId,
      })
      .from(issues)
      .leftJoin(
        issueProtocolState,
        and(eq(issueProtocolState.issueId, issues.id), eq(issueProtocolState.companyId, issues.companyId)),
      )
      .where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)))
      .limit(1)
      .then((rows) => {
        const row = rows[0];
        if (!row) return null;
        return {
          ...row,
          workflowState: row.workflowState ?? "backlog",
        };
      }));

  const listLegacyCandidates = deps?.listLegacyCandidates ?? (async () => {
    const rows = await db
      .select({
        issueId: issueProtocolState.issueId,
        companyId: issueProtocolState.companyId,
        projectId: issues.projectId,
        issueStatus: issues.status,
        workflowState: issueProtocolState.workflowState,
        protocolMessageId: issueProtocolState.lastProtocolMessageId,
        blockedByMessageId: issueProtocolState.blockedByMessageId,
      })
      .from(issueProtocolState)
      .innerJoin(
        issues,
        and(eq(issues.id, issueProtocolState.issueId), eq(issues.companyId, issueProtocolState.companyId)),
      )
      .where(
        and(
          isNotNull(issueProtocolState.lastProtocolMessageId),
          notInArray(issues.status, ["done", "cancelled"]),
        ),
      );

    const protocolMessageIds = rows
      .map((row) => row.protocolMessageId)
      .filter((value): value is string => Boolean(value));
    const trackedMessageIds = protocolMessageIds.length === 0
      ? new Set<string>()
      : new Set(
          await db
            .select({ protocolMessageId: issueProtocolDispatchOutbox.protocolMessageId })
            .from(issueProtocolDispatchOutbox)
            .where(inArray(issueProtocolDispatchOutbox.protocolMessageId, protocolMessageIds))
            .then((items) => items.map((item) => item.protocolMessageId)),
        );

    return rows
      .filter((row): row is LegacyDispatchCandidate => Boolean(row.protocolMessageId))
      .filter((row) => !trackedMessageIds.has(row.protocolMessageId))
      .filter((row) => !(row.workflowState === "blocked" && row.blockedByMessageId === row.protocolMessageId));
  });

  const loadMessages = deps?.loadMessages ?? (async (messageIds: string[]) => {
    if (messageIds.length === 0) return new Map<string, HydratedProtocolMessage>();

    const [messages, recipients, artifacts] = await Promise.all([
      db
        .select()
        .from(issueProtocolMessages)
        .where(inArray(issueProtocolMessages.id, messageIds)),
      db
        .select()
        .from(issueProtocolRecipients)
        .where(inArray(issueProtocolRecipients.messageId, messageIds)),
      db
        .select()
        .from(issueProtocolArtifacts)
        .where(inArray(issueProtocolArtifacts.messageId, messageIds)),
    ]);

    const recipientsByMessageId = new Map<string, Array<typeof issueProtocolRecipients.$inferSelect>>();
    for (const recipient of recipients) {
      const existing = recipientsByMessageId.get(recipient.messageId) ?? [];
      existing.push(recipient);
      recipientsByMessageId.set(recipient.messageId, existing);
    }

    const artifactsByMessageId = new Map<string, Array<typeof issueProtocolArtifacts.$inferSelect>>();
    for (const artifact of artifacts) {
      const existing = artifactsByMessageId.get(artifact.messageId) ?? [];
      existing.push(artifact);
      artifactsByMessageId.set(artifact.messageId, existing);
    }

    return new Map(
      messages.map((message) => [
        message.id,
        buildHydratedProtocolMessage({
          message,
          recipients: recipientsByMessageId.get(message.id) ?? [],
          artifacts: artifactsByMessageId.get(message.id) ?? [],
        }),
      ]),
    );
  });

  const hasDispatchEvidence = deps?.hasDispatchEvidence ?? (async (input: {
    companyId: string;
    protocolMessageId: string;
  }) => {
    const [queuedWakeup, activeRun] = await Promise.all([
      db
        .select({ id: agentWakeupRequests.id })
        .from(agentWakeupRequests)
        .where(
          and(
            eq(agentWakeupRequests.companyId, input.companyId),
            inArray(agentWakeupRequests.status, ["queued", "claimed", "deferred_issue_execution"]),
            sql`${agentWakeupRequests.payload} ->> 'protocolMessageId' = ${input.protocolMessageId}`,
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select({ id: heartbeatRuns.id })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, input.companyId),
            inArray(heartbeatRuns.status, ["queued", "claimed", "running"]),
            sql`${heartbeatRuns.contextSnapshot} ->> 'protocolMessageId' = ${input.protocolMessageId}`,
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);

    return Boolean(queuedWakeup || activeRun);
  });

  const buildRecipientHints = deps?.buildRecipientHints ?? (async (input: {
    issueId: string;
    message: CreateIssueProtocolMessage;
  }) => {
    const eventType = deriveRetrievalEventType(input.message.messageType);
    if (!eventType) return [];

    const hints: ProtocolExecutionRecipientHint[] = [];
    for (const recipient of input.message.recipients) {
      const briefScope = deriveBriefScope({
        eventType,
        recipientRole: recipient.role,
      });
      const latestBrief = await knowledge.getLatestTaskBrief(input.issueId, briefScope);
      if (!latestBrief) continue;
      const contentJson =
        latestBrief.contentJson && typeof latestBrief.contentJson === "object" && !Array.isArray(latestBrief.contentJson)
          ? latestBrief.contentJson
          : {};
      const executionLane = readNonEmptyString(contentJson.executionLane);
      const rawHits = Array.isArray(contentJson.hits) ? contentJson.hits : [];

      hints.push({
        recipientId: recipient.recipientId,
        recipientRole: recipient.role,
        executionLane: executionLane ?? undefined,
        retrievalRunId: latestBrief.retrievalRunId ?? undefined,
        briefId: latestBrief.id,
        briefScope: latestBrief.briefScope,
        briefContentMarkdown: latestBrief.contentMarkdown,
        briefEvidenceSummary: rawHits
          .slice(0, 6)
          .map((hit) => {
            if (!hit || typeof hit !== "object" || Array.isArray(hit)) return null;
            const row = hit as Record<string, unknown>;
            return {
              rank: typeof row.rank === "number" ? row.rank : undefined,
              sourceType: readNonEmptyString(row.sourceType),
              authorityLevel: readNonEmptyString(row.authorityLevel),
              path: readNonEmptyString(row.path),
              title: readNonEmptyString(row.title),
              symbolName: readNonEmptyString(row.symbolName),
              fusedScore: typeof row.fusedScore === "number" ? row.fusedScore : null,
            };
          })
          .filter((hit): hit is NonNullable<typeof hit> => Boolean(hit)),
      });
    }

    return hints;
  });

  const loadIssueContext = deps?.loadIssueContext ?? ((companyId: string, issueId: string) =>
    loadInternalWorkItemSupervisorContext(db, companyId, issueId));
  const dispatchMessage = deps?.dispatchMessage ?? ((input) => execution.dispatchMessage(input));
  const applyPreRetrievalReroute = deps?.applyPreRetrievalReroute ?? maybeApplyPreRetrievalSupervisorReroute;
  const markOutboxDispatched = deps?.markOutboxDispatched ?? outbox.markDispatched;
  const markOutboxNoAction = deps?.markOutboxNoAction ?? outbox.markNoAction;
  const markOutboxFailed = deps?.markOutboxFailed ?? outbox.markFailed;

  const processCandidate = async (input: {
    trackingMode: "outbox" | "legacy";
    issueSnapshot: IssueDispatchSnapshot;
    protocolMessageId: string;
    message: HydratedProtocolMessage;
  }) => {
    const settleNoAction = async (dispatchResult: Record<string, unknown>) => {
      if (input.trackingMode === "outbox") {
        await markOutboxNoAction({
          protocolMessageId: input.protocolMessageId,
          dispatchResult,
        });
      }
    };

    const settleDispatched = async (protocolMessageId: string, dispatchResult: Record<string, unknown>) => {
      if (input.trackingMode === "outbox") {
        await markOutboxDispatched({
          protocolMessageId,
          dispatchResult,
        });
      }
    };

    if (input.issueSnapshot.issueStatus === "done" || input.issueSnapshot.issueStatus === "cancelled") {
      await settleNoAction({
        reason: "terminal_issue",
        issueStatus: input.issueSnapshot.issueStatus,
      });
      return { outcome: "no_action" as const, reason: "terminal_issue" };
    }

    if (
      input.issueSnapshot.workflowState === "blocked"
      && input.issueSnapshot.blockedByMessageId === input.protocolMessageId
    ) {
      await settleNoAction({
        reason: "blocked_by_same_message",
      });
      return { outcome: "no_action" as const, reason: "blocked_by_same_message" };
    }

    const issueContext = await loadIssueContext(input.issueSnapshot.companyId, input.issueSnapshot.issueId);
    const plan = buildProtocolExecutionDispatchPlan({
      issueId: input.issueSnapshot.issueId,
      protocolMessageId: input.protocolMessageId,
      message: input.message,
      senderAgentId: input.message.sender.actorType === "agent" ? input.message.sender.actorId : null,
      issueContext: issueContext as never,
    });
    if (!plan.some((item) => item.kind === "wakeup")) {
      await settleNoAction({
        reason: "no_wakeup_targets",
      });
      return { outcome: "no_action" as const, reason: "no_wakeup_targets" };
    }

    const alreadyQueued = await hasDispatchEvidence({
      companyId: input.issueSnapshot.companyId,
      protocolMessageId: input.protocolMessageId,
    });
    if (alreadyQueued) {
      await settleDispatched(input.protocolMessageId, {
        reason: "existing_dispatch_evidence",
      });
      return { outcome: "existing_evidence" as const };
    }

    const actor = buildProtocolDispatchReconciliationActor(input.message);
    let dispatchResult: { queued: number; notifyOnly: number; skipped: number } | null = null;
    let effectiveProtocolMessageId = input.protocolMessageId;
    let originalSettledToNoAction = false;

    try {
      if (shouldDispatchBeforeProtocolRetrieval(input.message)) {
        const rerouted = await applyPreRetrievalReroute({
          db,
          protocolSvc,
          issue: {
            id: input.issueSnapshot.issueId,
            companyId: input.issueSnapshot.companyId,
            projectId: input.issueSnapshot.projectId,
          },
          protocolMessageId: input.protocolMessageId,
          message: input.message,
        });
        if (rerouted) {
          if (input.trackingMode === "outbox") {
            await markOutboxNoAction({
              protocolMessageId: input.protocolMessageId,
              dispatchResult: {
                reason: "rerouted_before_retrieval",
                rerouteProtocolMessageId: rerouted.rerouteProtocolMessageId,
              },
            });
            originalSettledToNoAction = true;
          }
          effectiveProtocolMessageId = rerouted.rerouteProtocolMessageId;
          dispatchResult = await dispatchMessage({
            issueId: input.issueSnapshot.issueId,
            companyId: input.issueSnapshot.companyId,
            protocolMessageId: rerouted.rerouteProtocolMessageId,
            message: rerouted.rerouteMessage,
            recipientHints: [],
            actor: rerouted.actor,
          });
        }
      }

      if (!dispatchResult) {
        const recipientHints = await buildRecipientHints({
          issueId: input.issueSnapshot.issueId,
          message: input.message,
        });
        dispatchResult = await dispatchMessage({
          issueId: input.issueSnapshot.issueId,
          companyId: input.issueSnapshot.companyId,
          protocolMessageId: input.protocolMessageId,
          message: input.message,
          recipientHints,
          actor,
        });
      }

      if (dispatchResult.queued <= 0) {
        if (!originalSettledToNoAction) {
          await settleNoAction({
            reason: "queued_zero",
            notifyOnly: dispatchResult.notifyOnly,
            skipped: dispatchResult.skipped,
          });
        }
        return { outcome: "no_action" as const, reason: "queued_zero" };
      }

      await settleDispatched(effectiveProtocolMessageId, {
        reason: "reconciled_dispatch",
        queued: dispatchResult.queued,
        notifyOnly: dispatchResult.notifyOnly,
        skipped: dispatchResult.skipped,
      });

      await logActivity(db, {
        companyId: input.issueSnapshot.companyId,
        actorType: "system",
        actorId: "protocol_dispatch_reconciliation",
        agentId: null,
        runId: null,
        action: "issue.protocol_dispatch.reconciled",
        entityType: "issue",
        entityId: input.issueSnapshot.issueId,
        details: {
          protocolMessageId: input.protocolMessageId,
          reconciledProtocolMessageId: effectiveProtocolMessageId,
          protocolMessageType: input.message.messageType,
          queued: dispatchResult.queued,
          notifyOnly: dispatchResult.notifyOnly,
          skipped: dispatchResult.skipped,
          trackingMode: input.trackingMode,
        },
      });

      return {
        outcome: "reconciled" as const,
        effectiveProtocolMessageId,
      };
    } catch (err) {
      if (input.trackingMode === "outbox") {
        await markOutboxFailed({
          protocolMessageId: effectiveProtocolMessageId,
          error: err instanceof Error ? err.message : String(err),
          dispatchResult: {
            reason: "reconciliation_failed",
            path: effectiveProtocolMessageId === input.protocolMessageId ? "direct" : "pre_retrieval_reroute",
          },
        });
      }
      throw err;
    }
  };

  return {
    reconcilePendingDispatches: async () => {
      const [pendingOutboxEntries, legacyCandidates] = await Promise.all([
        listPendingOutboxEntries(),
        listLegacyCandidates(),
      ]);
      const protocolMessageIds = [
        ...pendingOutboxEntries.map((entry) => entry.protocolMessageId),
        ...legacyCandidates.map((candidate) => candidate.protocolMessageId),
      ];
      const messagesById = await loadMessages(Array.from(new Set(protocolMessageIds)));

      let reconciled = 0;
      let skippedBlocked = 0;
      let skippedWithEvidence = 0;
      let skippedNoWakeTargets = 0;
      let settledNoAction = 0;
      const reconciledIssueIds: string[] = [];

      for (const entry of pendingOutboxEntries) {
        const message = messagesById.get(entry.protocolMessageId);
        if (!message) {
          await markOutboxNoAction({
            protocolMessageId: entry.protocolMessageId,
            dispatchResult: {
              reason: "missing_message",
            },
          });
          settledNoAction += 1;
          continue;
        }

        const issueSnapshot = await loadIssueSnapshot(entry.companyId, entry.issueId);
        if (!issueSnapshot) {
          await markOutboxNoAction({
            protocolMessageId: entry.protocolMessageId,
            dispatchResult: {
              reason: "missing_issue",
            },
          });
          settledNoAction += 1;
          continue;
        }

        const hadEvidence = await hasDispatchEvidence({
          companyId: issueSnapshot.companyId,
          protocolMessageId: entry.protocolMessageId,
        });
        if (hadEvidence) {
          await markOutboxDispatched({
            protocolMessageId: entry.protocolMessageId,
            dispatchResult: {
              reason: "existing_dispatch_evidence",
            },
          });
          skippedWithEvidence += 1;
          continue;
        }

        const result = await processCandidate({
          trackingMode: "outbox",
          issueSnapshot,
          protocolMessageId: entry.protocolMessageId,
          message,
        }).catch((err) => {
          logger.error(
            {
              err,
              issueId: entry.issueId,
              protocolMessageId: entry.protocolMessageId,
            },
            "protocol dispatch outbox reconciliation failed",
          );
          return { outcome: "failed" as const };
        });

        if (result.outcome === "reconciled") {
          reconciled += 1;
          reconciledIssueIds.push(issueSnapshot.issueId);
        } else if (result.outcome === "existing_evidence") {
          skippedWithEvidence += 1;
        } else if (result.outcome === "no_action") {
          settledNoAction += 1;
          if (result.reason === "blocked_by_same_message") skippedBlocked += 1;
          else skippedNoWakeTargets += 1;
        }
      }

      for (const candidate of legacyCandidates) {
        const message = messagesById.get(candidate.protocolMessageId);
        if (!message) continue;

        const result = await processCandidate({
          trackingMode: "legacy",
          issueSnapshot: candidate,
          protocolMessageId: candidate.protocolMessageId,
          message,
        }).catch((err) => {
          logger.error(
            {
              err,
              issueId: candidate.issueId,
              protocolMessageId: candidate.protocolMessageId,
            },
            "legacy protocol dispatch reconciliation failed",
          );
          return { outcome: "failed" as const };
        });

        if (result.outcome === "reconciled") {
          reconciled += 1;
          reconciledIssueIds.push(candidate.issueId);
        } else if (result.outcome === "existing_evidence") {
          skippedWithEvidence += 1;
        } else if (result.outcome === "no_action") {
          if (result.reason === "blocked_by_same_message") skippedBlocked += 1;
          else skippedNoWakeTargets += 1;
        }
      }

      if (reconciled > 0) {
        logger.warn(
          {
            scanned: pendingOutboxEntries.length + legacyCandidates.length,
            pendingOutbox: pendingOutboxEntries.length,
            legacyCandidates: legacyCandidates.length,
            reconciled,
            issueIds: reconciledIssueIds,
          },
          "reconciled pending protocol dispatch gap after protocol message commit",
        );
      }

      return {
        scanned: pendingOutboxEntries.length + legacyCandidates.length,
        pendingOutbox: pendingOutboxEntries.length,
        legacyCandidates: legacyCandidates.length,
        reconciled,
        skippedBlocked,
        skippedWithEvidence,
        skippedNoWakeTargets,
        settledNoAction,
        reconciledIssueIds,
      };
    },
  };
}
