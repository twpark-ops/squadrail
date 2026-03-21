ALTER TABLE issue_document_revisions
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE CASCADE;--> statement-breakpoint

UPDATE issue_document_revisions
SET company_id = issue_documents.company_id
FROM issue_documents
WHERE issue_documents.id = issue_document_revisions.document_id
  AND issue_document_revisions.company_id IS NULL;--> statement-breakpoint

ALTER TABLE issue_document_revisions
  ALTER COLUMN company_id SET NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS issue_document_revisions_company_idx
  ON issue_document_revisions(company_id);--> statement-breakpoint

ALTER TABLE issue_documents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_select_access ON issue_documents;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_update_access ON issue_documents;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_delete_access ON issue_documents;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_insert_access ON issue_documents;--> statement-breakpoint
CREATE POLICY tenant_select_access ON issue_documents
  FOR SELECT
  USING (app.company_allowed(company_id));--> statement-breakpoint
CREATE POLICY tenant_update_access ON issue_documents
  FOR UPDATE
  USING (app.company_allowed(company_id))
  WITH CHECK (app.company_allowed(company_id));--> statement-breakpoint
CREATE POLICY tenant_delete_access ON issue_documents
  FOR DELETE
  USING (app.company_allowed(company_id));--> statement-breakpoint
CREATE POLICY tenant_insert_access ON issue_documents
  FOR INSERT
  WITH CHECK (app.company_allowed(company_id) OR app.can_create_company());--> statement-breakpoint

ALTER TABLE issue_document_revisions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_select_access ON issue_document_revisions;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_update_access ON issue_document_revisions;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_delete_access ON issue_document_revisions;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_insert_access ON issue_document_revisions;--> statement-breakpoint
CREATE POLICY tenant_select_access ON issue_document_revisions
  FOR SELECT
  USING (app.company_allowed(company_id));--> statement-breakpoint
CREATE POLICY tenant_update_access ON issue_document_revisions
  FOR UPDATE
  USING (app.company_allowed(company_id))
  WITH CHECK (app.company_allowed(company_id));--> statement-breakpoint
CREATE POLICY tenant_delete_access ON issue_document_revisions
  FOR DELETE
  USING (app.company_allowed(company_id));--> statement-breakpoint
CREATE POLICY tenant_insert_access ON issue_document_revisions
  FOR INSERT
  WITH CHECK (app.company_allowed(company_id) OR app.can_create_company());--> statement-breakpoint
