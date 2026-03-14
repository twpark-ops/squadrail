CREATE TABLE IF NOT EXISTS company_team_blueprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  slug text NOT NULL,
  label text NOT NULL,
  description text,
  source_blueprint_key text,
  definition jsonb NOT NULL,
  default_preview_request jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS company_team_blueprints_company_slug_idx
  ON company_team_blueprints(company_id, slug);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS company_team_blueprints_company_idx
  ON company_team_blueprints(company_id);--> statement-breakpoint

ALTER TABLE company_team_blueprints ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_select_access ON company_team_blueprints;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_update_access ON company_team_blueprints;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_delete_access ON company_team_blueprints;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_insert_access ON company_team_blueprints;--> statement-breakpoint
CREATE POLICY tenant_select_access ON company_team_blueprints
  FOR SELECT
  USING (app.company_allowed(company_id));--> statement-breakpoint
CREATE POLICY tenant_update_access ON company_team_blueprints
  FOR UPDATE
  USING (app.company_allowed(company_id))
  WITH CHECK (app.company_allowed(company_id));--> statement-breakpoint
CREATE POLICY tenant_delete_access ON company_team_blueprints
  FOR DELETE
  USING (app.company_allowed(company_id));--> statement-breakpoint
CREATE POLICY tenant_insert_access ON company_team_blueprints
  FOR INSERT
  WITH CHECK (app.company_allowed(company_id) OR app.can_create_company());--> statement-breakpoint
