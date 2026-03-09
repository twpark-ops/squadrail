import { pgTable, uuid, text, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issueProtocolMessages } from "./issue_protocol_messages.js";

export const issueProtocolRecipients = pgTable(
  "issue_protocol_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").notNull().references(() => issueProtocolMessages.id, { onDelete: "cascade" }),
    recipientType: text("recipient_type").notNull(),
    recipientId: text("recipient_id").notNull(),
    recipientRole: text("recipient_role").notNull(),
  },
  (table) => ({
    messageIdx: index("issue_protocol_recipients_message_idx").on(table.messageId),
    recipientIdx: index("issue_protocol_recipients_lookup_idx").on(
      table.companyId,
      table.recipientRole,
      table.recipientId,
    ),
  }),
);
