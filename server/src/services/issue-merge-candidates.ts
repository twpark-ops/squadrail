import { and, eq } from "drizzle-orm";
import type { Db } from "@squadrail/db";
import { issueMergeCandidates } from "@squadrail/db";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function issueMergeCandidateService(db: Db) {
  return {
    getByIssueId: async (issueId: string) =>
      db
        .select()
        .from(issueMergeCandidates)
        .where(eq(issueMergeCandidates.issueId, issueId))
        .then((rows) => rows[0] ?? null),

    upsertDecision: async (input: {
      companyId: string;
      issueId: string;
      closeMessageId?: string | null;
      state: "pending" | "merged" | "rejected";
      sourceBranch?: string | null;
      workspacePath?: string | null;
      headSha?: string | null;
      diffStat?: string | null;
      targetBaseBranch?: string | null;
      mergeCommitSha?: string | null;
      automationMetadata?: Record<string, unknown> | null;
      operatorActorType?: string | null;
      operatorActorId?: string | null;
      operatorNote?: string | null;
    }) => {
      const existing = await db
        .select()
        .from(issueMergeCandidates)
        .where(eq(issueMergeCandidates.issueId, input.issueId))
        .then((rows) => rows[0] ?? null);

      const values = {
        companyId: input.companyId,
        issueId: input.issueId,
        closeMessageId: input.closeMessageId ?? null,
        state: input.state,
        sourceBranch: input.sourceBranch ?? null,
        workspacePath: input.workspacePath ?? null,
        headSha: input.headSha ?? null,
        diffStat: input.diffStat ?? null,
        targetBaseBranch: input.targetBaseBranch ?? null,
        mergeCommitSha: input.mergeCommitSha ?? null,
        automationMetadata: input.automationMetadata ?? asRecord(existing?.automationMetadata),
        operatorActorType: input.operatorActorType ?? null,
        operatorActorId: input.operatorActorId ?? null,
        operatorNote: input.operatorNote ?? null,
        resolvedAt: input.state === "pending" ? null : new Date(),
        updatedAt: new Date(),
      };

      if (!existing) {
        const [created] = await db
          .insert(issueMergeCandidates)
          .values(values)
          .returning();
        return created;
      }

      const [updated] = await db
        .update(issueMergeCandidates)
        .set(values)
        .where(
          and(
            eq(issueMergeCandidates.id, existing.id),
            eq(issueMergeCandidates.issueId, input.issueId),
          ),
        )
        .returning();
      return updated ?? null;
    },

    patchAutomationMetadata: async (issueId: string, patch: Record<string, unknown>) => {
      const existing = await db
        .select()
        .from(issueMergeCandidates)
        .where(eq(issueMergeCandidates.issueId, issueId))
        .then((rows) => rows[0] ?? null);
      if (!existing) return null;

      const [updated] = await db
        .update(issueMergeCandidates)
        .set({
          automationMetadata: {
            ...asRecord(existing.automationMetadata),
            ...patch,
          },
          updatedAt: new Date(),
        })
        .where(eq(issueMergeCandidates.id, existing.id))
        .returning();
      return updated ?? null;
    },

    deleteByIssueId: async (issueId: string) => {
      const [deleted] = await db
        .delete(issueMergeCandidates)
        .where(eq(issueMergeCandidates.issueId, issueId))
        .returning();
      return deleted ?? null;
    },
  };
}
