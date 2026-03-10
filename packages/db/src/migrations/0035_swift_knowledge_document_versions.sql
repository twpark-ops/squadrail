CREATE TABLE "knowledge_document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"document_id" uuid NOT NULL,
	"path" text,
	"repo_ref" text,
	"branch_name" text,
	"default_branch_name" text,
	"commit_sha" text,
	"parent_commit_sha" text,
	"is_head" boolean DEFAULT true NOT NULL,
	"is_default_branch" boolean DEFAULT false NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_document_versions" ADD CONSTRAINT "knowledge_document_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_document_versions" ADD CONSTRAINT "knowledge_document_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_document_versions" ADD CONSTRAINT "knowledge_document_versions_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "knowledge_document_versions_document_idx" ON "knowledge_document_versions" USING btree ("document_id","updated_at");
--> statement-breakpoint
CREATE INDEX "knowledge_document_versions_branch_idx" ON "knowledge_document_versions" USING btree ("company_id","project_id","branch_name","is_head");
--> statement-breakpoint
CREATE INDEX "knowledge_document_versions_path_idx" ON "knowledge_document_versions" USING btree ("company_id","project_id","path","branch_name");
--> statement-breakpoint
CREATE INDEX "knowledge_document_versions_commit_idx" ON "knowledge_document_versions" USING btree ("company_id","commit_sha");
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_document_versions_unique_idx" ON "knowledge_document_versions" USING btree ("company_id","document_id","branch_name","commit_sha");
