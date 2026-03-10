CREATE TABLE "project_knowledge_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"last_head_sha" text,
	"last_tree_signature" text,
	"last_import_mode" text,
	"last_imported_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrieval_cache_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"stage" text NOT NULL,
	"cache_key" text NOT NULL,
	"knowledge_revision" integer DEFAULT 0 NOT NULL,
	"value_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_knowledge_revisions" ADD CONSTRAINT "project_knowledge_revisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_knowledge_revisions" ADD CONSTRAINT "project_knowledge_revisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retrieval_cache_entries" ADD CONSTRAINT "retrieval_cache_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retrieval_cache_entries" ADD CONSTRAINT "retrieval_cache_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "project_knowledge_revisions_company_project_idx" ON "project_knowledge_revisions" USING btree ("company_id","project_id");
--> statement-breakpoint
CREATE INDEX "project_knowledge_revisions_revision_idx" ON "project_knowledge_revisions" USING btree ("company_id","revision","updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "retrieval_cache_entries_unique_stage_key_idx" ON "retrieval_cache_entries" USING btree ("company_id","project_id","stage","cache_key","knowledge_revision");
--> statement-breakpoint
CREATE INDEX "retrieval_cache_entries_expiry_idx" ON "retrieval_cache_entries" USING btree ("company_id","stage","expires_at");
--> statement-breakpoint
CREATE INDEX "retrieval_cache_entries_stage_project_idx" ON "retrieval_cache_entries" USING btree ("company_id","project_id","stage","updated_at");
