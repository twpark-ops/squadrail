import { and, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import {
  agentWakeupRequests,
  heartbeatRuns,
  issueProtocolArtifacts,
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

type DispatchCandidate = {
  issueId: string;
  companyId: string;
  projectId: string | null;
  issueStatus: string;
  workflowState: string;
  lastProtocolMessageId: string;
  blockedByMessageId: string | null;
};

type HydratedProtocolMessage = CreateIssueProtocolMessage & {
  id: string;
};

type ReconciliationDeps = {
  listCandidates?: () => Promise<DispatchCandidate[]>;
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
  applyPreRetrievalReroute?: typeof maybeApplyPreRetrievalSupervisorReroute;
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

  const listCandidates = deps?.listCandidates ?? (async () => {
    const rows = await db
      .select({
        issueId: issueProtocolState.issueId,
        companyId: issueProtocolState.companyId,
        projectId: issues.projectId,
        issueStatus: issues.status,
        workflowState: issueProtocolState.workflowState,
        lastProtocolMessageId: issueProtocolState.lastProtocolMessageId,
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

    return rows
      .filter((row): row is DispatchCandidate => Boolean(row.lastProtocolMessageId))
      .filter((row) => !(row.workflowState === "blocked" && row.blockedByMessageId === row.lastProtocolMessageId));
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

  return {
    reconcilePendingDispatches: async () => {
      const candidates = await listCandidates();
      if (candidates.length === 0) {
        return {
          scanned: 0,
          reconciled: 0,
          skippedBlocked: 0,
          skippedWithEvidence: 0,
          skippedNoWakeTargets: 0,
          reconciledIssueIds: [] as string[],
        };
      }

      const messagesById = await loadMessages(candidates.map((candidate) => candidate.lastProtocolMessageId));
      let reconciled = 0;
      let skippedBlocked = 0;
      let skippedWithEvidence = 0;
      let skippedNoWakeTargets = 0;
      const reconciledIssueIds: string[] = [];

      for (const candidate of candidates) {
        if (candidate.blockedByMessageId === candidate.lastProtocolMessageId) {
          skippedBlocked += 1;
          continue;
        }

        const message = messagesById.get(candidate.lastProtocolMessageId);
        if (!message) continue;

        const issueContext = await loadIssueContext(candidate.companyId, candidate.issueId);
        const plan = buildProtocolExecutionDispatchPlan({
          issueId: candidate.issueId,
          protocolMessageId: candidate.lastProtocolMessageId,
          message,
          senderAgentId: message.sender.actorType === "agent" ? message.sender.actorId : null,
          issueContext: issueContext as never,
        });
        if (!plan.some((item) => item.kind === "wakeup")) {
          skippedNoWakeTargets += 1;
          continue;
        }

        const alreadyQueued = await hasDispatchEvidence({
          companyId: candidate.companyId,
          protocolMessageId: candidate.lastProtocolMessageId,
        });
        if (alreadyQueued) {
          skippedWithEvidence += 1;
          continue;
        }

        const actor = buildProtocolDispatchReconciliationActor(message);
        let dispatchResult: { queued: number; notifyOnly: number; skipped: number } | null = null;
        let reconciledMessageId = candidate.lastProtocolMessageId;

        if (shouldDispatchBeforeProtocolRetrieval(message)) {
          const rerouted = await applyPreRetrievalReroute({
            db,
            protocolSvc,
            issue: {
              id: candidate.issueId,
              companyId: candidate.companyId,
              projectId: candidate.projectId,
            },
            protocolMessageId: candidate.lastProtocolMessageId,
            message,
          });
          if (rerouted) {
            dispatchResult = await dispatchMessage({
              issueId: candidate.issueId,
              companyId: candidate.companyId,
              protocolMessageId: rerouted.rerouteProtocolMessageId,
              message: rerouted.rerouteMessage,
              recipientHints: [],
              actor: rerouted.actor,
            });
            reconciledMessageId = rerouted.rerouteProtocolMessageId;
          }
        }

        if (!dispatchResult) {
          const recipientHints = await buildRecipientHints({
            issueId: candidate.issueId,
            message,
          });
          dispatchResult = await dispatchMessage({
            issueId: candidate.issueId,
            companyId: candidate.companyId,
            protocolMessageId: candidate.lastProtocolMessageId,
            message,
            recipientHints,
            actor,
          });
        }

        if (dispatchResult.queued <= 0) {
          skippedNoWakeTargets += 1;
          continue;
        }

        await logActivity(db, {
          companyId: candidate.companyId,
          actorType: "system",
          actorId: "protocol_dispatch_reconciliation",
          agentId: null,
          runId: null,
          action: "issue.protocol_dispatch.reconciled",
          entityType: "issue",
          entityId: candidate.issueId,
          details: {
            protocolMessageId: candidate.lastProtocolMessageId,
            reconciledProtocolMessageId: reconciledMessageId,
            protocolMessageType: message.messageType,
            queued: dispatchResult.queued,
            notifyOnly: dispatchResult.notifyOnly,
            skipped: dispatchResult.skipped,
          },
        });

        reconciled += 1;
        reconciledIssueIds.push(candidate.issueId);
      }

      if (reconciled > 0) {
        logger.warn(
          {
            scanned: candidates.length,
            reconciled,
            issueIds: reconciledIssueIds,
          },
          "reconciled pending protocol dispatch gap after protocol message commit",
        );
      }

      return {
        scanned: candidates.length,
        reconciled,
        skippedBlocked,
        skippedWithEvidence,
        skippedNoWakeTargets,
        reconciledIssueIds,
      };
    },
  };
}
