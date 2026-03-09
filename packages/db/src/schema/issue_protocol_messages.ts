import {
  type AnyPgColumn,
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { issueProtocolThreads } from "./issue_protocol_threads.js";

export const issueProtocolMessages = pgTable(
  "issue_protocol_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").notNull().references(() => issueProtocolThreads.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    messageType: text("message_type").notNull(),
    senderActorType: text("sender_actor_type").notNull(),
    senderActorId: text("sender_actor_id").notNull(),
    senderRole: text("sender_role").notNull(),
    workflowStateBefore: text("workflow_state_before").notNull(),
    workflowStateAfter: text("workflow_state_after").notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    payloadSha256: text("payload_sha256"),
    causalMessageId: uuid("causal_message_id").references(
      (): AnyPgColumn => issueProtocolMessages.id,
      { onDelete: "set null" },
    ),
    retrievalRunId: uuid("retrieval_run_id"),
    requiresAck: boolean("requires_ack").notNull().default(false),
    previousIntegritySignature: text("previous_integrity_signature"),
    integrityAlgorithm: text("integrity_algorithm"),
    integritySignature: text("integrity_signature"),
    ackedAt: timestamp("acked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    threadSeqIdx: uniqueIndex("issue_protocol_messages_thread_seq_idx").on(table.threadId, table.seq),
    issueSeqIdx: index("issue_protocol_messages_issue_seq_idx").on(table.companyId, table.issueId, table.seq),
    issueCreatedIdx: index("issue_protocol_messages_issue_created_idx").on(table.issueId, table.createdAt),
    typeIdx: index("issue_protocol_messages_type_idx").on(table.companyId, table.messageType, table.createdAt),
  }),
);
