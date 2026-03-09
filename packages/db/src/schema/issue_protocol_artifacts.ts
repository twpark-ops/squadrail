import { pgTable, uuid, text, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issueProtocolMessages } from "./issue_protocol_messages.js";

export const issueProtocolArtifacts = pgTable(
  "issue_protocol_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    messageId: uuid("message_id").notNull().references(() => issueProtocolMessages.id, { onDelete: "cascade" }),
    artifactKind: text("artifact_kind").notNull(),
    artifactUri: text("artifact_uri").notNull(),
    label: text("label"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => ({
    messageIdx: index("issue_protocol_artifacts_message_idx").on(table.messageId),
    kindIdx: index("issue_protocol_artifacts_kind_idx").on(table.companyId, table.artifactKind),
  }),
);
