CREATE TABLE "issue_task_briefs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "issue_id" uuid NOT NULL REFERENCES "issues"("id") ON DELETE CASCADE,
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
CREATE TABLE "knowledge_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "source_type" text NOT NULL,
  "authority_level" text NOT NULL,
  "repo_url" text,
  "repo_ref" text,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
  "issue_id" uuid REFERENCES "issues"("id") ON DELETE SET NULL,
  "message_id" uuid REFERENCES "issue_protocol_messages"("id") ON DELETE SET NULL,
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
CREATE TABLE "knowledge_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "document_id" uuid NOT NULL REFERENCES "knowledge_documents"("id") ON DELETE CASCADE,
  "chunk_index" integer NOT NULL,
  "heading_path" text,
  "symbol_name" text,
  "token_count" integer NOT NULL,
  "text_content" text NOT NULL,
  "search_tsv" tsvector NOT NULL DEFAULT to_tsvector('simple', ''),
  "embedding" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunk_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "chunk_id" uuid NOT NULL REFERENCES "knowledge_chunks"("id") ON DELETE CASCADE,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "link_reason" text NOT NULL,
  "weight" double precision DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrieval_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
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
CREATE TABLE "retrieval_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "issue_id" uuid REFERENCES "issues"("id") ON DELETE SET NULL,
  "triggering_message_id" uuid REFERENCES "issue_protocol_messages"("id") ON DELETE SET NULL,
  "actor_type" text NOT NULL,
  "actor_id" text NOT NULL,
  "actor_role" text NOT NULL,
  "event_type" text NOT NULL,
  "workflow_state" text NOT NULL,
  "policy_id" uuid REFERENCES "retrieval_policies"("id") ON DELETE SET NULL,
  "query_text" text NOT NULL,
  "query_debug" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "final_brief_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrieval_run_hits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "retrieval_run_id" uuid NOT NULL REFERENCES "retrieval_runs"("id") ON DELETE CASCADE,
  "chunk_id" uuid NOT NULL REFERENCES "knowledge_chunks"("id") ON DELETE CASCADE,
  "dense_score" double precision,
  "sparse_score" double precision,
  "rerank_score" double precision,
  "fused_score" double precision,
  "final_rank" integer,
  "selected" boolean DEFAULT false NOT NULL,
  "rationale" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "issue_task_briefs_issue_scope_version_idx" ON "issue_task_briefs" ("issue_id", "brief_scope", "brief_version");
--> statement-breakpoint
CREATE INDEX "issue_task_briefs_issue_scope_idx" ON "issue_task_briefs" ("company_id", "issue_id", "brief_scope");
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_documents_unique_content_idx" ON "knowledge_documents" ("company_id", "source_type", "repo_url", "repo_ref", "path", "content_sha256");
--> statement-breakpoint
CREATE INDEX "knowledge_documents_issue_idx" ON "knowledge_documents" ("company_id", "issue_id");
--> statement-breakpoint
CREATE INDEX "knowledge_documents_project_idx" ON "knowledge_documents" ("company_id", "project_id", "source_type");
--> statement-breakpoint
CREATE INDEX "knowledge_documents_source_idx" ON "knowledge_documents" ("company_id", "source_type", "authority_level");
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_document_chunk_idx" ON "knowledge_chunks" ("document_id", "chunk_index");
--> statement-breakpoint
CREATE INDEX "knowledge_chunks_document_idx" ON "knowledge_chunks" ("company_id", "document_id", "chunk_index");
--> statement-breakpoint
CREATE INDEX "knowledge_chunks_symbol_idx" ON "knowledge_chunks" ("company_id", "symbol_name");
--> statement-breakpoint
CREATE INDEX "knowledge_chunks_search_gin_idx" ON "knowledge_chunks" USING gin ("search_tsv");
--> statement-breakpoint
CREATE INDEX "knowledge_chunk_links_chunk_idx" ON "knowledge_chunk_links" ("chunk_id");
--> statement-breakpoint
CREATE INDEX "knowledge_chunk_links_entity_idx" ON "knowledge_chunk_links" ("company_id", "entity_type", "entity_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "retrieval_policies_unique_idx" ON "retrieval_policies" ("company_id", "role", "event_type", "workflow_state");
--> statement-breakpoint
CREATE INDEX "retrieval_policies_company_role_idx" ON "retrieval_policies" ("company_id", "role", "workflow_state");
--> statement-breakpoint
CREATE INDEX "retrieval_runs_issue_created_idx" ON "retrieval_runs" ("company_id", "issue_id", "created_at");
--> statement-breakpoint
CREATE INDEX "retrieval_runs_policy_idx" ON "retrieval_runs" ("company_id", "policy_id", "created_at");
--> statement-breakpoint
CREATE INDEX "retrieval_run_hits_run_idx" ON "retrieval_run_hits" ("retrieval_run_id", "final_rank");
--> statement-breakpoint
CREATE INDEX "retrieval_run_hits_chunk_idx" ON "retrieval_run_hits" ("chunk_id");
