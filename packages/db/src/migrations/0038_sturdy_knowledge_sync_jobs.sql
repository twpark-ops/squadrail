CREATE TABLE "knowledge_sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"requested_by_actor_type" text NOT NULL,
	"requested_by_actor_id" text NOT NULL,
	"requested_by_agent_id" uuid,
	"selected_project_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"options_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_sync_project_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"workspace_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"step_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_sync_jobs" ADD CONSTRAINT "knowledge_sync_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_sync_project_runs" ADD CONSTRAINT "knowledge_sync_project_runs_job_id_knowledge_sync_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."knowledge_sync_jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_sync_project_runs" ADD CONSTRAINT "knowledge_sync_project_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_sync_project_runs" ADD CONSTRAINT "knowledge_sync_project_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_sync_project_runs" ADD CONSTRAINT "knowledge_sync_project_runs_workspace_id_project_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."project_workspaces"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "knowledge_sync_jobs_company_updated_idx" ON "knowledge_sync_jobs" USING btree ("company_id","updated_at");
--> statement-breakpoint
CREATE INDEX "knowledge_sync_jobs_company_status_idx" ON "knowledge_sync_jobs" USING btree ("company_id","status","updated_at");
--> statement-breakpoint
CREATE INDEX "knowledge_sync_project_runs_job_updated_idx" ON "knowledge_sync_project_runs" USING btree ("job_id","updated_at");
--> statement-breakpoint
CREATE INDEX "knowledge_sync_project_runs_company_project_idx" ON "knowledge_sync_project_runs" USING btree ("company_id","project_id","updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_sync_project_runs_job_project_idx" ON "knowledge_sync_project_runs" USING btree ("job_id","project_id");
