CREATE TABLE "heartbeat_run_leases" (
  "run_id" uuid PRIMARY KEY NOT NULL REFERENCES "heartbeat_runs"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'launching',
  "checkpoint_json" jsonb,
  "heartbeat_at" timestamp with time zone NOT NULL DEFAULT now(),
  "lease_expires_at" timestamp with time zone NOT NULL,
  "released_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX "heartbeat_run_leases_company_updated_idx" ON "heartbeat_run_leases" USING btree ("company_id","updated_at");--> statement-breakpoint
CREATE INDEX "heartbeat_run_leases_company_status_idx" ON "heartbeat_run_leases" USING btree ("company_id","status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "heartbeat_run_leases_agent_status_idx" ON "heartbeat_run_leases" USING btree ("agent_id","status","lease_expires_at");--> statement-breakpoint

ALTER TABLE "heartbeat_run_leases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_select_access ON "heartbeat_run_leases";--> statement-breakpoint
DROP POLICY IF EXISTS tenant_update_access ON "heartbeat_run_leases";--> statement-breakpoint
DROP POLICY IF EXISTS tenant_delete_access ON "heartbeat_run_leases";--> statement-breakpoint
DROP POLICY IF EXISTS tenant_insert_access ON "heartbeat_run_leases";--> statement-breakpoint
CREATE POLICY tenant_select_access ON "heartbeat_run_leases"
  FOR SELECT
  USING (app.company_allowed(company_id));--> statement-breakpoint
CREATE POLICY tenant_update_access ON "heartbeat_run_leases"
  FOR UPDATE
  USING (app.company_allowed(company_id))
  WITH CHECK (app.company_allowed(company_id));--> statement-breakpoint
CREATE POLICY tenant_delete_access ON "heartbeat_run_leases"
  FOR DELETE
  USING (app.company_allowed(company_id));--> statement-breakpoint
CREATE POLICY tenant_insert_access ON "heartbeat_run_leases"
  FOR INSERT
  WITH CHECK (app.company_allowed(company_id) OR app.can_create_company());--> statement-breakpoint
