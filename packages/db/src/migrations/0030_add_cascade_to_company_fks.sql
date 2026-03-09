-- Add CASCADE to company_id foreign keys for 13 tables
-- This ensures that when a company is deleted, all related data is automatically removed

-- Drop and recreate foreign key constraints with CASCADE

-- knowledge_documents
ALTER TABLE "knowledge_documents" DROP CONSTRAINT IF EXISTS "knowledge_documents_company_id_companies_id_fk";
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;

-- knowledge_chunks
ALTER TABLE "knowledge_chunks" DROP CONSTRAINT IF EXISTS "knowledge_chunks_company_id_companies_id_fk";
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;

-- knowledge_chunk_links
ALTER TABLE "knowledge_chunk_links" DROP CONSTRAINT IF EXISTS "knowledge_chunk_links_company_id_companies_id_fk";
ALTER TABLE "knowledge_chunk_links" ADD CONSTRAINT "knowledge_chunk_links_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;

-- issue_protocol_messages
ALTER TABLE "issue_protocol_messages" DROP CONSTRAINT IF EXISTS "issue_protocol_messages_company_id_companies_id_fk";
ALTER TABLE "issue_protocol_messages" ADD CONSTRAINT "issue_protocol_messages_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;

-- issue_protocol_state
ALTER TABLE "issue_protocol_state" DROP CONSTRAINT IF EXISTS "issue_protocol_state_company_id_companies_id_fk";
ALTER TABLE "issue_protocol_state" ADD CONSTRAINT "issue_protocol_state_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;

-- issue_protocol_threads
ALTER TABLE "issue_protocol_threads" DROP CONSTRAINT IF EXISTS "issue_protocol_threads_company_id_companies_id_fk";
ALTER TABLE "issue_protocol_threads" ADD CONSTRAINT "issue_protocol_threads_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;

-- issue_protocol_recipients
ALTER TABLE "issue_protocol_recipients" DROP CONSTRAINT IF EXISTS "issue_protocol_recipients_company_id_companies_id_fk";
ALTER TABLE "issue_protocol_recipients" ADD CONSTRAINT "issue_protocol_recipients_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;

-- issue_protocol_artifacts
ALTER TABLE "issue_protocol_artifacts" DROP CONSTRAINT IF EXISTS "issue_protocol_artifacts_company_id_companies_id_fk";
ALTER TABLE "issue_protocol_artifacts" ADD CONSTRAINT "issue_protocol_artifacts_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;

-- issue_review_cycles
ALTER TABLE "issue_review_cycles" DROP CONSTRAINT IF EXISTS "issue_review_cycles_company_id_companies_id_fk";
ALTER TABLE "issue_review_cycles" ADD CONSTRAINT "issue_review_cycles_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;

-- issue_task_briefs
ALTER TABLE "issue_task_briefs" DROP CONSTRAINT IF EXISTS "issue_task_briefs_company_id_companies_id_fk";
ALTER TABLE "issue_task_briefs" ADD CONSTRAINT "issue_task_briefs_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;

-- retrieval_policies
ALTER TABLE "retrieval_policies" DROP CONSTRAINT IF EXISTS "retrieval_policies_company_id_companies_id_fk";
ALTER TABLE "retrieval_policies" ADD CONSTRAINT "retrieval_policies_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;

-- retrieval_runs
ALTER TABLE "retrieval_runs" DROP CONSTRAINT IF EXISTS "retrieval_runs_company_id_companies_id_fk";
ALTER TABLE "retrieval_runs" ADD CONSTRAINT "retrieval_runs_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;

-- retrieval_run_hits
ALTER TABLE "retrieval_run_hits" DROP CONSTRAINT IF EXISTS "retrieval_run_hits_company_id_companies_id_fk";
ALTER TABLE "retrieval_run_hits" ADD CONSTRAINT "retrieval_run_hits_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
