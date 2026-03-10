CREATE TABLE "retrieval_feedback_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"issue_id" uuid,
	"retrieval_run_id" uuid NOT NULL,
	"feedback_message_id" uuid,
	"actor_role" text NOT NULL,
	"event_type" text NOT NULL,
	"feedback_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"weight" double precision NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrieval_role_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"role" text NOT NULL,
	"event_type" text NOT NULL,
	"profile_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"feedback_count" integer DEFAULT 0 NOT NULL,
	"last_feedback_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "retrieval_feedback_events" ADD CONSTRAINT "retrieval_feedback_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retrieval_feedback_events" ADD CONSTRAINT "retrieval_feedback_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retrieval_feedback_events" ADD CONSTRAINT "retrieval_feedback_events_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retrieval_feedback_events" ADD CONSTRAINT "retrieval_feedback_events_retrieval_run_id_retrieval_runs_id_fk" FOREIGN KEY ("retrieval_run_id") REFERENCES "public"."retrieval_runs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retrieval_feedback_events" ADD CONSTRAINT "retrieval_feedback_events_feedback_message_id_issue_protocol_messages_id_fk" FOREIGN KEY ("feedback_message_id") REFERENCES "public"."issue_protocol_messages"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retrieval_role_profiles" ADD CONSTRAINT "retrieval_role_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retrieval_role_profiles" ADD CONSTRAINT "retrieval_role_profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "retrieval_feedback_events_run_created_idx" ON "retrieval_feedback_events" USING btree ("retrieval_run_id","created_at");
--> statement-breakpoint
CREATE INDEX "retrieval_feedback_events_issue_created_idx" ON "retrieval_feedback_events" USING btree ("company_id","issue_id","created_at");
--> statement-breakpoint
CREATE INDEX "retrieval_feedback_events_scope_created_idx" ON "retrieval_feedback_events" USING btree ("company_id","project_id","actor_role","event_type","feedback_type","target_type","created_at");
--> statement-breakpoint
CREATE INDEX "retrieval_role_profiles_project_scope_idx" ON "retrieval_role_profiles" USING btree ("company_id","project_id","role","event_type","updated_at");
--> statement-breakpoint
CREATE INDEX "retrieval_role_profiles_global_scope_idx" ON "retrieval_role_profiles" USING btree ("company_id","role","event_type","updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "retrieval_role_profiles_company_role_event_global_idx"
  ON "retrieval_role_profiles" USING btree ("company_id","role","event_type")
  WHERE "project_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "retrieval_role_profiles_company_project_role_event_idx"
  ON "retrieval_role_profiles" USING btree ("company_id","project_id","role","event_type")
  WHERE "project_id" IS NOT NULL;
