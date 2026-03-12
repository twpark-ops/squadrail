import { and, eq, inArray, or } from "drizzle-orm";
import { issueProtocolState, issues, type Db } from "@squadrail/db";

export interface IssueDependencyGraphItem {
  reference: string;
  issueId: string | null;
  identifier: string | null;
  title: string | null;
  status: string | null;
  workflowState: string | null;
  resolved: boolean;
}

export interface IssueDependencyGraphMetadata {
  refs: string[];
  items: IssueDependencyGraphItem[];
  unresolvedCount: number;
  blockingIssueIds: string[];
  updatedAt: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeDependencyRef(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[0-9a-fA-F-]{36}$/.test(trimmed)) return trimmed;
  return trimmed.toUpperCase();
}

function detectExplicitDependencyDeclaration(payload: Record<string, unknown> | null) {
  if (!payload) return false;
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  return steps.some((step) => {
    const stepRecord = asRecord(step);
    return Boolean(stepRecord && Object.prototype.hasOwnProperty.call(stepRecord, "dependsOn"));
  });
}

export function extractIssueDependencyReferences(payload: unknown) {
  const payloadRecord = asRecord(payload);
  if (!payloadRecord) return [];
  const steps = Array.isArray(payloadRecord.steps) ? payloadRecord.steps : [];
  const refs = new Set<string>();

  for (const step of steps) {
    const stepRecord = asRecord(step);
    if (!stepRecord) continue;
    for (const ref of readStringArray(stepRecord.dependsOn)) {
      const normalized = normalizeDependencyRef(ref);
      if (normalized) refs.add(normalized);
    }
  }

  return [...refs];
}

export function readIssueDependencyGraphMetadata(
  metadata: Record<string, unknown> | null | undefined,
): IssueDependencyGraphMetadata | null {
  const root = asRecord(metadata);
  const dependencyGraph = asRecord(root?.dependencyGraph);
  if (!dependencyGraph) return null;

  const refs = readStringArray(dependencyGraph.refs).map(normalizeDependencyRef);
  const items = Array.isArray(dependencyGraph.items)
    ? dependencyGraph.items.flatMap((item) => {
        const record = asRecord(item);
        if (!record) return [];
        const reference = typeof record.reference === "string" ? normalizeDependencyRef(record.reference) : "";
        if (!reference) return [];
        return [{
          reference,
          issueId: typeof record.issueId === "string" ? record.issueId : null,
          identifier: typeof record.identifier === "string" ? record.identifier : null,
          title: typeof record.title === "string" ? record.title : null,
          status: typeof record.status === "string" ? record.status : null,
          workflowState: typeof record.workflowState === "string" ? record.workflowState : null,
          resolved: record.resolved === true,
        } satisfies IssueDependencyGraphItem];
      })
    : [];

  const unresolvedCount =
    typeof dependencyGraph.unresolvedCount === "number"
      ? dependencyGraph.unresolvedCount
      : items.filter((item) => item.resolved === false).length;
  const blockingIssueIds = readStringArray(dependencyGraph.blockingIssueIds);
  const updatedAt =
    typeof dependencyGraph.updatedAt === "string" && dependencyGraph.updatedAt.length > 0
      ? dependencyGraph.updatedAt
      : new Date(0).toISOString();

  return {
    refs,
    items,
    unresolvedCount,
    blockingIssueIds,
    updatedAt,
  };
}

export function hasBlockingIssueDependencies(metadata: IssueDependencyGraphMetadata | null | undefined) {
  if (!metadata) return false;
  return metadata.unresolvedCount > 0;
}

export function buildIssueDependencyBlockingSummary(metadata: IssueDependencyGraphMetadata | null | undefined) {
  if (!metadata || metadata.unresolvedCount === 0) return null;
  const labels = metadata.items
    .filter((item) => item.resolved === false)
    .map((item) => item.identifier ?? item.reference)
    .filter(Boolean);
  if (labels.length === 0) {
    return "Waiting for unresolved dependency issues.";
  }
  const summary = labels.slice(0, 3).join(", ");
  return labels.length > 3
    ? `Waiting for ${summary}, and ${labels.length - 3} more dependencies.`
    : `Waiting for ${summary}.`;
}

export async function resolveIssueDependencyGraphMetadata(
  dbOrTx: Pick<Db, "select">,
  input: {
    companyId: string;
    issueId: string;
    payload: unknown;
    existingMetadata?: Record<string, unknown> | null;
    now?: Date;
  },
): Promise<IssueDependencyGraphMetadata | null> {
  const payloadRecord = asRecord(input.payload);
  const explicitRefs = extractIssueDependencyReferences(payloadRecord);
  const existingGraph = readIssueDependencyGraphMetadata(input.existingMetadata);
  const explicitDeclaration = detectExplicitDependencyDeclaration(payloadRecord);

  const refs =
    explicitRefs.length > 0
      ? explicitRefs
      : explicitDeclaration
        ? []
        : existingGraph?.refs ?? [];

  if (refs.length === 0) {
    return explicitDeclaration ? {
      refs: [],
      items: [],
      unresolvedCount: 0,
      blockingIssueIds: [],
      updatedAt: (input.now ?? new Date()).toISOString(),
    } : existingGraph;
  }

  const idRefs = refs.filter((ref) => /^[0-9a-fA-F-]{36}$/.test(ref));
  const identifierRefs = refs.filter((ref) => !/^[0-9a-fA-F-]{36}$/.test(ref));
  const conditions = [];
  if (idRefs.length > 0) conditions.push(inArray(issues.id, idRefs));
  if (identifierRefs.length > 0) conditions.push(inArray(issues.identifier, identifierRefs));

  const rows = conditions.length === 0
    ? []
    : await dbOrTx
      .select({
        id: issues.id,
        identifier: issues.identifier,
        title: issues.title,
        status: issues.status,
        workflowState: issueProtocolState.workflowState,
      })
      .from(issues)
      .leftJoin(issueProtocolState, eq(issueProtocolState.issueId, issues.id))
      .where(
        and(
          eq(issues.companyId, input.companyId),
          conditions.length === 1 ? conditions[0]! : or(...conditions)!,
        ),
      );

  const issueById = new Map(rows.map((row) => [row.id, row]));
  const issueByIdentifier = new Map(
    rows
      .filter((row) => typeof row.identifier === "string" && row.identifier.length > 0)
      .map((row) => [row.identifier as string, row]),
  );

  const items = refs.map((reference) => {
    const row = issueById.get(reference) ?? issueByIdentifier.get(reference) ?? null;
    if (!row || row.id === input.issueId) {
      return {
        reference,
        issueId: row?.id ?? null,
        identifier: row?.identifier ?? (reference.includes("-") ? reference : null),
        title: row?.title ?? null,
        status: row?.status ?? null,
        workflowState: row?.workflowState ?? null,
        resolved: false,
      } satisfies IssueDependencyGraphItem;
    }

    return {
      reference,
      issueId: row.id,
      identifier: row.identifier ?? null,
      title: row.title ?? null,
      status: row.status ?? null,
      workflowState: row.workflowState ?? null,
      resolved: row.status === "done",
    } satisfies IssueDependencyGraphItem;
  });

  const blockingIssueIds = items
    .filter((item) => item.resolved === false && item.issueId)
    .map((item) => item.issueId as string);

  return {
    refs,
    items,
    unresolvedCount: items.filter((item) => item.resolved === false).length,
    blockingIssueIds,
    updatedAt: (input.now ?? new Date()).toISOString(),
  };
}
