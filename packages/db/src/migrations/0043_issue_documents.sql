-- Issue Documents: mutable key-based documents attached to issues
-- Keys: plan, spec, decision-log, qa-notes, release-note

CREATE TABLE IF NOT EXISTS issue_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key text NOT NULL,
  title text NOT NULL,
  format text NOT NULL DEFAULT 'markdown',
  body text NOT NULL DEFAULT '',
  revision_number integer NOT NULL DEFAULT 1,
  created_by_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  created_by_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(issue_id, key)
);

CREATE TABLE IF NOT EXISTS issue_document_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES issue_documents(id) ON DELETE CASCADE,
  revision_number integer NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  created_by_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  created_by_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_id, revision_number)
);

CREATE INDEX issue_documents_issue_idx ON issue_documents(issue_id);
CREATE INDEX issue_documents_company_idx ON issue_documents(company_id);
CREATE INDEX issue_document_revisions_document_idx ON issue_document_revisions(document_id);
