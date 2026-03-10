CREATE TABLE "issue_merge_candidates" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "issue_id" uuid NOT NULL REFERENCES "issues"("id") ON DELETE CASCADE,
  "close_message_id" uuid REFERENCES "issue_protocol_messages"("id") ON DELETE SET NULL,
  "state" text NOT NULL DEFAULT 'pending',
  "source_branch" text,
  "workspace_path" text,
  "head_sha" text,
  "diff_stat" text,
  "target_base_branch" text,
  "merge_commit_sha" text,
  "operator_actor_type" text,
  "operator_actor_id" text,
  "operator_note" text,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX "issue_merge_candidates_issue_idx" ON "issue_merge_candidates" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "issue_merge_candidates_company_state_idx" ON "issue_merge_candidates" USING btree ("company_id","state","updated_at");--> statement-breakpoint

ALTER TABLE "issue_merge_candidates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_select_access ON "issue_merge_candidates";--> statement-breakpoint
DROP POLICY IF EXISTS tenant_update_access ON "issue_merge_candidates";--> statement-breakpoint
DROP POLICY IF EXISTS tenant_delete_access ON "issue_merge_candidates";--> statement-breakpoint
DROP POLICY IF EXISTS tenant_insert_access ON "issue_merge_candidates";--> statement-breakpoint
CREATE POLICY tenant_select_access ON "issue_merge_candidates"
  FOR SELECT
  USING (app.company_allowed(company_id));--> statement-breakpoint
CREATE POLICY tenant_update_access ON "issue_merge_candidates"
  FOR UPDATE
  USING (app.company_allowed(company_id))
  WITH CHECK (app.company_allowed(company_id));--> statement-breakpoint
CREATE POLICY tenant_delete_access ON "issue_merge_candidates"
  FOR DELETE
  USING (app.company_allowed(company_id));--> statement-breakpoint
CREATE POLICY tenant_insert_access ON "issue_merge_candidates"
  FOR INSERT
  WITH CHECK (app.company_allowed(company_id) OR app.can_create_company());--> statement-breakpoint
