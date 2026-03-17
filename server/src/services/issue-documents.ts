import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "@squadrail/db";
import { issueDocuments, issueDocumentRevisions } from "@squadrail/db";
import type {
  IssueDocument,
  IssueDocumentKey,
  IssueDocumentRevision,
  IssueDocumentSummary,
} from "@squadrail/shared";
import { ISSUE_DOCUMENT_KEYS } from "@squadrail/shared";
import { conflict, notFound, unprocessable } from "../errors.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidDocumentKey(key: string): key is IssueDocumentKey {
  return (ISSUE_DOCUMENT_KEYS as readonly string[]).includes(key);
}

function toSummary(
  row: typeof issueDocuments.$inferSelect,
): IssueDocumentSummary {
  return {
    id: row.id,
    issueId: row.issueId,
    key: row.key as IssueDocumentKey,
    title: row.title,
    format: row.format as "markdown",
    revisionNumber: row.revisionNumber,
    createdByAgentId: row.createdByAgentId,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDocument(
  row: typeof issueDocuments.$inferSelect,
): IssueDocument {
  return {
    ...toSummary(row),
    body: row.body,
  };
}

function toRevision(
  row: typeof issueDocumentRevisions.$inferSelect,
): IssueDocumentRevision {
  return {
    id: row.id,
    documentId: row.documentId,
    revisionNumber: row.revisionNumber,
    title: row.title,
    body: row.body,
    createdByAgentId: row.createdByAgentId,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createIssueDocumentService(db: Db) {
  return {
    /**
     * List all documents for an issue (summaries only — no body).
     */
    async listDocuments(issueId: string): Promise<IssueDocumentSummary[]> {
      const rows = await db
        .select({
          id: issueDocuments.id,
          issueId: issueDocuments.issueId,
          companyId: issueDocuments.companyId,
          key: issueDocuments.key,
          title: issueDocuments.title,
          format: issueDocuments.format,
          revisionNumber: issueDocuments.revisionNumber,
          createdByAgentId: issueDocuments.createdByAgentId,
          createdByUserId: issueDocuments.createdByUserId,
          createdAt: issueDocuments.createdAt,
          updatedAt: issueDocuments.updatedAt,
          // Intentionally exclude body for summary
          body: issueDocuments.body,
        })
        .from(issueDocuments)
        .where(eq(issueDocuments.issueId, issueId))
        .orderBy(asc(issueDocuments.key));

      return rows.map(toSummary);
    },

    /**
     * Get a single document by issue + key (includes body).
     */
    async getDocument(
      issueId: string,
      key: string,
    ): Promise<IssueDocument | null> {
      if (!isValidDocumentKey(key)) return null;

      const [row] = await db
        .select()
        .from(issueDocuments)
        .where(
          and(
            eq(issueDocuments.issueId, issueId),
            eq(issueDocuments.key, key),
          ),
        )
        .limit(1);

      return row ? toDocument(row) : null;
    },

    /**
     * Create or update a document. On update, validate baseRevisionNumber
     * against the current revision to detect conflicts (optimistic locking).
     */
    async upsertDocument(input: {
      issueId: string;
      companyId: string;
      key: string;
      title?: string;
      body: string;
      baseRevisionNumber?: number;
      authorAgentId?: string | null;
      authorUserId?: string | null;
    }): Promise<IssueDocument> {
      if (!isValidDocumentKey(input.key)) {
        throw unprocessable(
          `Invalid document key "${input.key}". Must be one of: ${ISSUE_DOCUMENT_KEYS.join(", ")}`,
        );
      }

      // Use a transaction for atomicity
      return await db.transaction(async (tx) => {
        // Check if document already exists
        const [existing] = await tx
          .select()
          .from(issueDocuments)
          .where(
            and(
              eq(issueDocuments.issueId, input.issueId),
              eq(issueDocuments.key, input.key),
            ),
          )
          .limit(1);

        if (existing) {
          // Conflict detection: if caller provided baseRevisionNumber, it must match
          if (
            input.baseRevisionNumber !== undefined &&
            input.baseRevisionNumber !== existing.revisionNumber
          ) {
            throw conflict(
              `Document "${input.key}" has been modified. Current revision: ${existing.revisionNumber}, your base: ${input.baseRevisionNumber}`,
            );
          }

          const nextRevision = existing.revisionNumber + 1;
          const title = input.title ?? existing.title;

          // Create revision snapshot of the NEW body
          await tx.insert(issueDocumentRevisions).values({
            documentId: existing.id,
            revisionNumber: nextRevision,
            title,
            body: input.body,
            createdByAgentId: input.authorAgentId ?? null,
            createdByUserId: input.authorUserId ?? null,
          });

          // Update the document
          const [updated] = await tx
            .update(issueDocuments)
            .set({
              title,
              body: input.body,
              revisionNumber: nextRevision,
              updatedAt: new Date(),
            })
            .where(eq(issueDocuments.id, existing.id))
            .returning();

          return toDocument(updated);
        }

        // Create new document
        const title =
          input.title ??
          input.key
            .replace(/-/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());

        const [created] = await tx
          .insert(issueDocuments)
          .values({
            issueId: input.issueId,
            companyId: input.companyId,
            key: input.key,
            title,
            format: "markdown",
            body: input.body,
            revisionNumber: 1,
            createdByAgentId: input.authorAgentId ?? null,
            createdByUserId: input.authorUserId ?? null,
          })
          .returning();

        // Create the initial revision snapshot
        await tx.insert(issueDocumentRevisions).values({
          documentId: created.id,
          revisionNumber: 1,
          title,
          body: input.body,
          createdByAgentId: input.authorAgentId ?? null,
          createdByUserId: input.authorUserId ?? null,
        });

        return toDocument(created);
      });
    },

    /**
     * Delete a document and all its revisions (cascade).
     */
    async deleteDocument(issueId: string, key: string): Promise<void> {
      if (!isValidDocumentKey(key)) return;

      const [deleted] = await db
        .delete(issueDocuments)
        .where(
          and(
            eq(issueDocuments.issueId, issueId),
            eq(issueDocuments.key, key),
          ),
        )
        .returning();

      if (!deleted) {
        throw notFound(`Document "${key}" not found for this issue`);
      }
    },

    /**
     * List all revisions for a document, newest first.
     */
    async listRevisions(
      issueId: string,
      key: string,
    ): Promise<IssueDocumentRevision[]> {
      if (!isValidDocumentKey(key)) return [];

      // First find the document to get its id
      const [doc] = await db
        .select({ id: issueDocuments.id })
        .from(issueDocuments)
        .where(
          and(
            eq(issueDocuments.issueId, issueId),
            eq(issueDocuments.key, key),
          ),
        )
        .limit(1);

      if (!doc) return [];

      const rows = await db
        .select()
        .from(issueDocumentRevisions)
        .where(eq(issueDocumentRevisions.documentId, doc.id))
        .orderBy(desc(issueDocumentRevisions.revisionNumber));

      return rows.map(toRevision);
    },
  };
}
