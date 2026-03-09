CREATE TABLE "issue_protocol_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"artifact_kind" text NOT NULL,
	"artifact_uri" text NOT NULL,
	"label" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_protocol_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"message_type" text NOT NULL,
	"sender_actor_type" text NOT NULL,
	"sender_actor_id" text NOT NULL,
	"sender_role" text NOT NULL,
	"workflow_state_before" text NOT NULL,
	"workflow_state_after" text NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_sha256" text,
	"causal_message_id" uuid,
	"retrieval_run_id" uuid,
	"requires_ack" boolean DEFAULT false NOT NULL,
	"previous_integrity_signature" text,
	"integrity_algorithm" text,
	"integrity_signature" text,
	"acked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_protocol_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"recipient_type" text NOT NULL,
	"recipient_id" text NOT NULL,
	"recipient_role" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_protocol_state" (
	"issue_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"workflow_state" text NOT NULL,
	"coarse_issue_status" text NOT NULL,
	"tech_lead_agent_id" uuid,
	"primary_engineer_agent_id" uuid,
	"reviewer_agent_id" uuid,
	"current_review_cycle" integer DEFAULT 0 NOT NULL,
	"last_protocol_message_id" uuid,
	"last_transition_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_phase" text,
	"blocked_code" text,
	"blocked_by_message_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_protocol_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"thread_type" text DEFAULT 'primary' NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_protocol_violations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"thread_id" uuid,
	"message_id" uuid,
	"violation_code" text NOT NULL,
	"severity" text NOT NULL,
	"detected_by_actor_type" text NOT NULL,
	"detected_by_actor_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "issue_review_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"cycle_number" integer NOT NULL,
	"reviewer_agent_id" uuid,
	"reviewer_user_id" text,
	"submitted_message_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"outcome" text,
	"outcome_message_id" uuid
);
--> statement-breakpoint
CREATE TABLE "issue_task_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"brief_scope" text NOT NULL,
	"brief_version" integer NOT NULL,
	"generated_from_message_seq" integer NOT NULL,
	"workflow_state" text NOT NULL,
	"content_markdown" text NOT NULL,
	"content_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retrieval_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunk_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"link_reason" text NOT NULL,
	"weight" double precision DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"heading_path" text,
	"symbol_name" text,
	"token_count" integer NOT NULL,
	"text_content" text NOT NULL,
	"search_tsv" "tsvector" NOT NULL,
	"embedding" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"authority_level" text NOT NULL,
	"repo_url" text,
	"repo_ref" text,
	"project_id" uuid,
	"issue_id" uuid,
	"message_id" uuid,
	"path" text,
	"title" text,
	"language" text,
	"content_sha256" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrieval_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"role" text NOT NULL,
	"event_type" text NOT NULL,
	"workflow_state" text NOT NULL,
	"top_k_dense" integer DEFAULT 20 NOT NULL,
	"top_k_sparse" integer DEFAULT 20 NOT NULL,
	"rerank_k" integer DEFAULT 20 NOT NULL,
	"final_k" integer DEFAULT 8 NOT NULL,
	"allowed_source_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_authority_levels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrieval_run_hits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"retrieval_run_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"dense_score" double precision,
	"sparse_score" double precision,
	"rerank_score" double precision,
	"fused_score" double precision,
	"final_rank" integer,
	"selected" boolean DEFAULT false NOT NULL,
	"rationale" text
);
--> statement-breakpoint
CREATE TABLE "retrieval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid,
	"triggering_message_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_role" text NOT NULL,
	"event_type" text NOT NULL,
	"workflow_state" text NOT NULL,
	"policy_id" uuid,
	"query_text" text NOT NULL,
	"query_debug" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"final_brief_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_pack_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content" text NOT NULL,
	"checksum_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_pack_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_pack_set_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"message" text,
	"created_by_user_id" text,
	"created_by_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "role_pack_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text DEFAULT '' NOT NULL,
	"role_key" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setup_progress" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"selected_engine" text,
	"selected_workspace_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_protocol_artifacts" ADD CONSTRAINT "issue_protocol_artifacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_protocol_artifacts" ADD CONSTRAINT "issue_protocol_artifacts_message_id_issue_protocol_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."issue_protocol_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_protocol_messages" ADD CONSTRAINT "issue_protocol_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_protocol_messages" ADD CONSTRAINT "issue_protocol_messages_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_protocol_messages" ADD CONSTRAINT "issue_protocol_messages_thread_id_issue_protocol_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."issue_protocol_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_protocol_messages" ADD CONSTRAINT "issue_protocol_messages_causal_message_id_issue_protocol_messages_id_fk" FOREIGN KEY ("causal_message_id") REFERENCES "public"."issue_protocol_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_protocol_recipients" ADD CONSTRAINT "issue_protocol_recipients_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_protocol_recipients" ADD CONSTRAINT "issue_protocol_recipients_message_id_issue_protocol_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."issue_protocol_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_protocol_state" ADD CONSTRAINT "issue_protocol_state_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_protocol_state" ADD CONSTRAINT "issue_protocol_state_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_protocol_state" ADD CONSTRAINT "issue_protocol_state_tech_lead_agent_id_agents_id_fk" FOREIGN KEY ("tech_lead_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_protocol_state" ADD CONSTRAINT "issue_protocol_state_primary_engineer_agent_id_agents_id_fk" FOREIGN KEY ("primary_engineer_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_protocol_state" ADD CONSTRAINT "issue_protocol_state_reviewer_agent_id_agents_id_fk" FOREIGN KEY ("reviewer_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_protocol_state" ADD CONSTRAINT "issue_protocol_state_last_protocol_message_id_issue_protocol_messages_id_fk" FOREIGN KEY ("last_protocol_message_id") REFERENCES "public"."issue_protocol_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_protocol_state" ADD CONSTRAINT "issue_protocol_state_blocked_by_message_id_issue_protocol_messages_id_fk" FOREIGN KEY ("blocked_by_message_id") REFERENCES "public"."issue_protocol_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_protocol_threads" ADD CONSTRAINT "issue_protocol_threads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_protocol_threads" ADD CONSTRAINT "issue_protocol_threads_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_protocol_violations" ADD CONSTRAINT "issue_protocol_violations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_protocol_violations" ADD CONSTRAINT "issue_protocol_violations_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_protocol_violations" ADD CONSTRAINT "issue_protocol_violations_thread_id_issue_protocol_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."issue_protocol_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_protocol_violations" ADD CONSTRAINT "issue_protocol_violations_message_id_issue_protocol_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."issue_protocol_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_review_cycles" ADD CONSTRAINT "issue_review_cycles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_review_cycles" ADD CONSTRAINT "issue_review_cycles_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_review_cycles" ADD CONSTRAINT "issue_review_cycles_reviewer_agent_id_agents_id_fk" FOREIGN KEY ("reviewer_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_review_cycles" ADD CONSTRAINT "issue_review_cycles_submitted_message_id_issue_protocol_messages_id_fk" FOREIGN KEY ("submitted_message_id") REFERENCES "public"."issue_protocol_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_review_cycles" ADD CONSTRAINT "issue_review_cycles_outcome_message_id_issue_protocol_messages_id_fk" FOREIGN KEY ("outcome_message_id") REFERENCES "public"."issue_protocol_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_task_briefs" ADD CONSTRAINT "issue_task_briefs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_task_briefs" ADD CONSTRAINT "issue_task_briefs_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunk_links" ADD CONSTRAINT "knowledge_chunk_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunk_links" ADD CONSTRAINT "knowledge_chunk_links_chunk_id_knowledge_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."knowledge_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_message_id_issue_protocol_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."issue_protocol_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_policies" ADD CONSTRAINT "retrieval_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_run_hits" ADD CONSTRAINT "retrieval_run_hits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_run_hits" ADD CONSTRAINT "retrieval_run_hits_retrieval_run_id_retrieval_runs_id_fk" FOREIGN KEY ("retrieval_run_id") REFERENCES "public"."retrieval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_run_hits" ADD CONSTRAINT "retrieval_run_hits_chunk_id_knowledge_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."knowledge_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_runs" ADD CONSTRAINT "retrieval_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_runs" ADD CONSTRAINT "retrieval_runs_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_runs" ADD CONSTRAINT "retrieval_runs_triggering_message_id_issue_protocol_messages_id_fk" FOREIGN KEY ("triggering_message_id") REFERENCES "public"."issue_protocol_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_runs" ADD CONSTRAINT "retrieval_runs_policy_id_retrieval_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."retrieval_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_pack_files" ADD CONSTRAINT "role_pack_files_revision_id_role_pack_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."role_pack_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_pack_revisions" ADD CONSTRAINT "role_pack_revisions_role_pack_set_id_role_pack_sets_id_fk" FOREIGN KEY ("role_pack_set_id") REFERENCES "public"."role_pack_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_pack_revisions" ADD CONSTRAINT "role_pack_revisions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_pack_sets" ADD CONSTRAINT "role_pack_sets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_progress" ADD CONSTRAINT "setup_progress_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_progress" ADD CONSTRAINT "setup_progress_selected_workspace_id_project_workspaces_id_fk" FOREIGN KEY ("selected_workspace_id") REFERENCES "public"."project_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_protocol_artifacts_message_idx" ON "issue_protocol_artifacts" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "issue_protocol_artifacts_kind_idx" ON "issue_protocol_artifacts" USING btree ("company_id","artifact_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_protocol_messages_thread_seq_idx" ON "issue_protocol_messages" USING btree ("thread_id","seq");--> statement-breakpoint
CREATE INDEX "issue_protocol_messages_issue_seq_idx" ON "issue_protocol_messages" USING btree ("company_id","issue_id","seq");--> statement-breakpoint
CREATE INDEX "issue_protocol_messages_issue_created_idx" ON "issue_protocol_messages" USING btree ("issue_id","created_at");--> statement-breakpoint
CREATE INDEX "issue_protocol_messages_type_idx" ON "issue_protocol_messages" USING btree ("company_id","message_type","created_at");--> statement-breakpoint
CREATE INDEX "issue_protocol_recipients_message_idx" ON "issue_protocol_recipients" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "issue_protocol_recipients_lookup_idx" ON "issue_protocol_recipients" USING btree ("company_id","recipient_role","recipient_id");--> statement-breakpoint
CREATE INDEX "issue_protocol_state_company_state_idx" ON "issue_protocol_state" USING btree ("company_id","workflow_state");--> statement-breakpoint
CREATE INDEX "issue_protocol_state_tech_lead_idx" ON "issue_protocol_state" USING btree ("company_id","tech_lead_agent_id","workflow_state");--> statement-breakpoint
CREATE INDEX "issue_protocol_state_engineer_idx" ON "issue_protocol_state" USING btree ("company_id","primary_engineer_agent_id","workflow_state");--> statement-breakpoint
CREATE INDEX "issue_protocol_state_reviewer_idx" ON "issue_protocol_state" USING btree ("company_id","reviewer_agent_id","workflow_state");--> statement-breakpoint
CREATE INDEX "issue_protocol_threads_company_issue_idx" ON "issue_protocol_threads" USING btree ("company_id","issue_id");--> statement-breakpoint
CREATE INDEX "issue_protocol_threads_issue_type_idx" ON "issue_protocol_threads" USING btree ("issue_id","thread_type");--> statement-breakpoint
CREATE INDEX "issue_protocol_violations_issue_status_idx" ON "issue_protocol_violations" USING btree ("company_id","issue_id","status");--> statement-breakpoint
CREATE INDEX "issue_protocol_violations_code_idx" ON "issue_protocol_violations" USING btree ("company_id","violation_code","created_at");--> statement-breakpoint
CREATE INDEX "issue_protocol_violations_message_idx" ON "issue_protocol_violations" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_review_cycles_issue_cycle_uq" ON "issue_review_cycles" USING btree ("issue_id","cycle_number");--> statement-breakpoint
CREATE INDEX "issue_review_cycles_issue_opened_idx" ON "issue_review_cycles" USING btree ("issue_id","opened_at");--> statement-breakpoint
CREATE INDEX "issue_review_cycles_reviewer_idx" ON "issue_review_cycles" USING btree ("company_id","reviewer_agent_id","closed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_task_briefs_issue_scope_version_idx" ON "issue_task_briefs" USING btree ("issue_id","brief_scope","brief_version");--> statement-breakpoint
CREATE INDEX "issue_task_briefs_issue_scope_idx" ON "issue_task_briefs" USING btree ("company_id","issue_id","brief_scope");--> statement-breakpoint
CREATE INDEX "knowledge_chunk_links_chunk_idx" ON "knowledge_chunk_links" USING btree ("chunk_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunk_links_entity_idx" ON "knowledge_chunk_links" USING btree ("company_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_document_chunk_idx" ON "knowledge_chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_document_idx" ON "knowledge_chunks" USING btree ("company_id","document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_symbol_idx" ON "knowledge_chunks" USING btree ("company_id","symbol_name");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_documents_unique_content_idx" ON "knowledge_documents" USING btree ("company_id","source_type","repo_url","repo_ref","path","content_sha256");--> statement-breakpoint
CREATE INDEX "knowledge_documents_issue_idx" ON "knowledge_documents" USING btree ("company_id","issue_id");--> statement-breakpoint
CREATE INDEX "knowledge_documents_project_idx" ON "knowledge_documents" USING btree ("company_id","project_id","source_type");--> statement-breakpoint
CREATE INDEX "knowledge_documents_source_idx" ON "knowledge_documents" USING btree ("company_id","source_type","authority_level");--> statement-breakpoint
CREATE UNIQUE INDEX "retrieval_policies_unique_idx" ON "retrieval_policies" USING btree ("company_id","role","event_type","workflow_state");--> statement-breakpoint
CREATE INDEX "retrieval_policies_company_role_idx" ON "retrieval_policies" USING btree ("company_id","role","workflow_state");--> statement-breakpoint
CREATE INDEX "retrieval_run_hits_run_idx" ON "retrieval_run_hits" USING btree ("retrieval_run_id","final_rank");--> statement-breakpoint
CREATE INDEX "retrieval_run_hits_chunk_idx" ON "retrieval_run_hits" USING btree ("chunk_id");--> statement-breakpoint
CREATE INDEX "retrieval_runs_issue_created_idx" ON "retrieval_runs" USING btree ("company_id","issue_id","created_at");--> statement-breakpoint
CREATE INDEX "retrieval_runs_policy_idx" ON "retrieval_runs" USING btree ("company_id","policy_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "role_pack_files_revision_file_idx" ON "role_pack_files" USING btree ("revision_id","filename");--> statement-breakpoint
CREATE INDEX "role_pack_files_revision_idx" ON "role_pack_files" USING btree ("revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_pack_revisions_version_idx" ON "role_pack_revisions" USING btree ("role_pack_set_id","version");--> statement-breakpoint
CREATE INDEX "role_pack_revisions_set_status_idx" ON "role_pack_revisions" USING btree ("role_pack_set_id","status","version");--> statement-breakpoint
CREATE UNIQUE INDEX "role_pack_sets_scope_role_idx" ON "role_pack_sets" USING btree ("company_id","scope_type","scope_id","role_key");--> statement-breakpoint
CREATE INDEX "role_pack_sets_company_scope_idx" ON "role_pack_sets" USING btree ("company_id","scope_type","role_key");--> statement-breakpoint
CREATE INDEX "setup_progress_status_idx" ON "setup_progress" USING btree ("status");--> statement-breakpoint
CREATE INDEX "setup_progress_workspace_idx" ON "setup_progress" USING btree ("selected_workspace_id");