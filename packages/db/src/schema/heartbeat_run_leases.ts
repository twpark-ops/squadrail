import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export const heartbeatRunLeases = pgTable(
  "heartbeat_run_leases",
  {
    runId: uuid("run_id").primaryKey().references(() => heartbeatRuns.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("launching"),
    checkpointJson: jsonb("checkpoint_json").$type<Record<string, unknown>>(),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyUpdatedIdx: index("heartbeat_run_leases_company_updated_idx").on(table.companyId, table.updatedAt),
    companyStatusIdx: index("heartbeat_run_leases_company_status_idx").on(table.companyId, table.status, table.leaseExpiresAt),
    agentStatusIdx: index("heartbeat_run_leases_agent_status_idx").on(table.agentId, table.status, table.leaseExpiresAt),
  }),
);
