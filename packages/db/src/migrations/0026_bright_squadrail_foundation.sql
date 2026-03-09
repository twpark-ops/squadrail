CREATE TABLE "setup_progress" (
  "company_id" uuid PRIMARY KEY NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "status" text DEFAULT 'not_started' NOT NULL,
  "selected_engine" text,
  "selected_workspace_id" uuid REFERENCES "project_workspaces"("id") ON DELETE SET NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_pack_sets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "scope_type" text NOT NULL,
  "scope_id" text DEFAULT '' NOT NULL,
  "role_key" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_pack_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "role_pack_set_id" uuid NOT NULL REFERENCES "role_pack_sets"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "message" text,
  "created_by_user_id" text,
  "created_by_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "role_pack_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "revision_id" uuid NOT NULL REFERENCES "role_pack_revisions"("id") ON DELETE CASCADE,
  "filename" text NOT NULL,
  "content" text NOT NULL,
  "checksum_sha256" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "setup_progress_status_idx" ON "setup_progress" ("status");
--> statement-breakpoint
CREATE INDEX "setup_progress_workspace_idx" ON "setup_progress" ("selected_workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "role_pack_sets_scope_role_idx" ON "role_pack_sets" ("company_id", "scope_type", "scope_id", "role_key");
--> statement-breakpoint
CREATE INDEX "role_pack_sets_company_scope_idx" ON "role_pack_sets" ("company_id", "scope_type", "role_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "role_pack_revisions_version_idx" ON "role_pack_revisions" ("role_pack_set_id", "version");
--> statement-breakpoint
CREATE INDEX "role_pack_revisions_set_status_idx" ON "role_pack_revisions" ("role_pack_set_id", "status", "version");
--> statement-breakpoint
CREATE UNIQUE INDEX "role_pack_files_revision_file_idx" ON "role_pack_files" ("revision_id", "filename");
--> statement-breakpoint
CREATE INDEX "role_pack_files_revision_idx" ON "role_pack_files" ("revision_id");
