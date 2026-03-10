CREATE TABLE "code_symbols" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"document_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"path" text NOT NULL,
	"language" text,
	"symbol_key" text NOT NULL,
	"symbol_name" text NOT NULL,
	"symbol_kind" text NOT NULL,
	"receiver_type" text,
	"start_line" integer,
	"end_line" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_symbol_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"from_symbol_id" uuid NOT NULL,
	"to_symbol_id" uuid NOT NULL,
	"edge_type" text NOT NULL,
	"weight" double precision DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "code_symbols" ADD CONSTRAINT "code_symbols_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "code_symbols" ADD CONSTRAINT "code_symbols_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "code_symbols" ADD CONSTRAINT "code_symbols_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "code_symbols" ADD CONSTRAINT "code_symbols_chunk_id_knowledge_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."knowledge_chunks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "code_symbol_edges" ADD CONSTRAINT "code_symbol_edges_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "code_symbol_edges" ADD CONSTRAINT "code_symbol_edges_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "code_symbol_edges" ADD CONSTRAINT "code_symbol_edges_from_symbol_id_code_symbols_id_fk" FOREIGN KEY ("from_symbol_id") REFERENCES "public"."code_symbols"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "code_symbol_edges" ADD CONSTRAINT "code_symbol_edges_to_symbol_id_code_symbols_id_fk" FOREIGN KEY ("to_symbol_id") REFERENCES "public"."code_symbols"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "code_symbols_company_project_path_symbol_idx" ON "code_symbols" USING btree ("company_id","project_id","path","symbol_key");
--> statement-breakpoint
CREATE INDEX "code_symbols_project_symbol_idx" ON "code_symbols" USING btree ("company_id","project_id","symbol_name");
--> statement-breakpoint
CREATE INDEX "code_symbols_chunk_idx" ON "code_symbols" USING btree ("chunk_id");
--> statement-breakpoint
CREATE INDEX "code_symbols_document_idx" ON "code_symbols" USING btree ("document_id");
--> statement-breakpoint
CREATE INDEX "code_symbols_path_idx" ON "code_symbols" USING btree ("company_id","project_id","path");
--> statement-breakpoint
CREATE UNIQUE INDEX "code_symbol_edges_unique_idx" ON "code_symbol_edges" USING btree ("from_symbol_id","to_symbol_id","edge_type");
--> statement-breakpoint
CREATE INDEX "code_symbol_edges_company_edge_idx" ON "code_symbol_edges" USING btree ("company_id","project_id","edge_type");
--> statement-breakpoint
CREATE INDEX "code_symbol_edges_from_idx" ON "code_symbol_edges" USING btree ("from_symbol_id");
--> statement-breakpoint
CREATE INDEX "code_symbol_edges_to_idx" ON "code_symbol_edges" USING btree ("to_symbol_id");
