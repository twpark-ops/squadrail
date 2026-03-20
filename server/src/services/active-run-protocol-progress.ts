import { resolveProtocolRunRequirement, type ProtocolRunRequirement } from "@squadrail/shared";
import { hasRequiredProtocolProgress } from "./heartbeat.js";

export interface ActiveRunProtocolProgressMessage {
  messageType: string | null;
  senderActorType: string | null;
  senderActorId: string | null;
  senderRole: string | null;
  createdAt: Date | string | null;
}

export interface ActiveRunProtocolProgressSummary {
  required: boolean;
  requirementKey: ProtocolRunRequirement["key"] | null;
  protocolMessageType: string | null;
  recipientRole: string | null;
  requiredMessageTypes: string[];
  intermediateMessageTypes: string[];
  messageWindowStartedAt: string | null;
  totalMessagesAfterRunStart: number;
  roleMessageCount: number;
  actorMessageCount: number;
  actorAttemptedAfterRunStart: boolean;
  observedActorMessageTypes: string[];
  latestActorMessageType: string | null;
  latestActorMessageAt: string | null;
  latestDecisionMessageType: string | null;
  latestDecisionMessageAt: string | null;
  latestIntermediateMessageType: string | null;
  latestIntermediateMessageAt: string | null;
  intermediateOnly: boolean;
  requiredProgressRecorded: boolean;
  humanOverrideCount: number;
  latestHumanOverrideMessageType: string | null;
  latestHumanOverrideMessageAt: string | null;
}

export interface ActiveRunProtocolHelperTraceSummary {
  adapterInvokeCaptured: boolean;
  adapterInvokeAt: string | null;
  helperPathInjected: boolean;
  helperContextInjected: boolean;
  promptMentionsProtocolHelper: boolean;
  commandNotesMentionProtocolHelper: boolean;
  transportContractInjected: boolean;
}

interface ObservedProtocolProgressMessage {
  messageType: string;
  createdAt: Date | string | null;
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function toEpochMillis(value: Date | string | null | undefined) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : null;
}

function toIsoString(value: Date | string | null | undefined) {
  const millis = toEpochMillis(value);
  return millis == null ? null : new Date(millis).toISOString();
}

function uniqueMessageTypes(messages: ActiveRunProtocolProgressMessage[]) {
  return Array.from(
    new Set(
      messages
        .map((message) => readNonEmptyString(message.messageType))
        .filter((messageType): messageType is string => Boolean(messageType)),
    ),
  );
}

function isIntermediateMessage(
  requirement: ProtocolRunRequirement | null,
  messageType: string | null,
) {
  if (!requirement || !messageType) return false;
  return requirement.intermediateMessageTypes.includes(
    messageType as ProtocolRunRequirement["intermediateMessageTypes"][number],
  );
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
      .map((entry) => readNonEmptyString(entry))
      .filter((entry): entry is string => Boolean(entry))
    : [];
}

export function summarizeActiveRunHelperTrace(input: {
  adapterInvokePayload?: unknown;
  adapterInvokeCreatedAt?: Date | string | null;
  protocolMessageType?: string | null;
  protocolRecipientRole?: string | null;
}): ActiveRunProtocolHelperTraceSummary | null {
  const payload = asRecord(input.adapterInvokePayload);
  if (!payload) return null;

  const env = asRecord(payload.env) ?? {};
  const context = asRecord(payload.context) ?? {};
  const prompt = readNonEmptyString(payload.prompt);
  const commandNotes = asStringArray(payload.commandNotes);
  const helperPathInjected = Boolean(readNonEmptyString(env.SQUADRAIL_PROTOCOL_HELPER_PATH));
  const helperContextInjected =
    readNonEmptyString(context.protocolMessageType) === readNonEmptyString(input.protocolMessageType)
    && readNonEmptyString(context.protocolRecipientRole) === readNonEmptyString(input.protocolRecipientRole);
  const promptMentionsProtocolHelper =
    Boolean(prompt?.includes("Use the local helper"))
    || Boolean(prompt?.includes("Exact helper command form"))
    || Boolean(prompt?.includes("SQUADRAIL_PROTOCOL_HELPER_PATH"));
  const commandNotesMentionProtocolHelper = commandNotes.some((note) => {
    const normalized = note.toLowerCase();
    return normalized.includes("protocol") || normalized.includes("helper");
  });

  return {
    adapterInvokeCaptured: true,
    adapterInvokeAt: toIsoString(input.adapterInvokeCreatedAt),
    helperPathInjected,
    helperContextInjected,
    promptMentionsProtocolHelper,
    commandNotesMentionProtocolHelper,
    transportContractInjected:
      helperPathInjected || helperContextInjected || promptMentionsProtocolHelper || commandNotesMentionProtocolHelper,
  };
}

export function summarizeActiveRunProtocolProgress(input: {
  protocolMessageType?: string | null;
  protocolRecipientRole?: string | null;
  agentId?: string | null;
  startedAt?: Date | string | null;
  workflowState?: string | null;
  messages: ActiveRunProtocolProgressMessage[];
}): ActiveRunProtocolProgressSummary {
  const requirement = resolveProtocolRunRequirement({
    protocolMessageType: readNonEmptyString(input.protocolMessageType) ?? undefined,
    protocolRecipientRole: readNonEmptyString(input.protocolRecipientRole) ?? undefined,
  });
  const startedAtMs = toEpochMillis(input.startedAt);
  const windowStartMs = startedAtMs != null ? startedAtMs - 1_000 : null;
  const messagesAfterRunStart = input.messages.filter((message) => {
    if (windowStartMs == null) return true;
    const createdAtMs = toEpochMillis(message.createdAt);
    return createdAtMs != null && createdAtMs > windowStartMs;
  });
  const agentId = readNonEmptyString(input.agentId);
  const actorMessages = agentId
    ? messagesAfterRunStart.filter(
      (message) => message.senderActorType === "agent" && readNonEmptyString(message.senderActorId) === agentId,
    )
    : [];
  const roleMessages = requirement
    ? messagesAfterRunStart.filter((message) => readNonEmptyString(message.senderRole) === requirement.recipientRole)
    : [];
  const humanOverrides = messagesAfterRunStart.filter((message) => readNonEmptyString(message.senderRole) === "human_board");
  const latestActorMessage = actorMessages.at(-1) ?? null;
  const latestDecisionMessage = [...actorMessages]
    .reverse()
    .find((message) => !isIntermediateMessage(requirement, readNonEmptyString(message.messageType))) ?? null;
  const latestIntermediateMessage = [...actorMessages]
    .reverse()
    .find((message) => isIntermediateMessage(requirement, readNonEmptyString(message.messageType))) ?? null;
  const intermediateOnly = actorMessages.length > 0 && latestDecisionMessage == null;
  const observedProgressMessages: ObservedProtocolProgressMessage[] = actorMessages
    .map((message) => ({
      messageType: readNonEmptyString(message.messageType),
      createdAt: message.createdAt,
    }))
    .filter((message): message is ObservedProtocolProgressMessage => Boolean(message.messageType));

  return {
    required: Boolean(requirement),
    requirementKey: requirement?.key ?? null,
    protocolMessageType: requirement?.protocolMessageType ?? null,
    recipientRole: requirement?.recipientRole ?? null,
    requiredMessageTypes: [...(requirement?.requiredMessageTypes ?? [])],
    intermediateMessageTypes: [...(requirement?.intermediateMessageTypes ?? [])],
    messageWindowStartedAt: toIsoString(input.startedAt),
    totalMessagesAfterRunStart: messagesAfterRunStart.length,
    roleMessageCount: roleMessages.length,
    actorMessageCount: actorMessages.length,
    actorAttemptedAfterRunStart: actorMessages.length > 0,
    observedActorMessageTypes: uniqueMessageTypes(actorMessages),
    latestActorMessageType: readNonEmptyString(latestActorMessage?.messageType),
    latestActorMessageAt: toIsoString(latestActorMessage?.createdAt),
    latestDecisionMessageType: readNonEmptyString(latestDecisionMessage?.messageType),
    latestDecisionMessageAt: toIsoString(latestDecisionMessage?.createdAt),
    latestIntermediateMessageType: readNonEmptyString(latestIntermediateMessage?.messageType),
    latestIntermediateMessageAt: toIsoString(latestIntermediateMessage?.createdAt),
    intermediateOnly,
    requiredProgressRecorded: hasRequiredProtocolProgress({
      requirement,
      messages: observedProgressMessages,
      finalWorkflowState: readNonEmptyString(input.workflowState),
    }),
    humanOverrideCount: humanOverrides.length,
    latestHumanOverrideMessageType: readNonEmptyString(humanOverrides.at(-1)?.messageType),
    latestHumanOverrideMessageAt: toIsoString(humanOverrides.at(-1)?.createdAt),
  };
}
