import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { rolePackRevisions } from "./role_pack_revisions.js";

export const rolePackFiles = pgTable(
  "role_pack_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    revisionId: uuid("revision_id").notNull().references(() => rolePackRevisions.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    content: text("content").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueRevisionFileIdx: uniqueIndex("role_pack_files_revision_file_idx").on(table.revisionId, table.filename),
    revisionIdx: index("role_pack_files_revision_idx").on(table.revisionId),
  }),
);
