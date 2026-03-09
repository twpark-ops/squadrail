CREATE SCHEMA IF NOT EXISTS app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.current_company_ids() RETURNS uuid[] AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT value::uuid
      FROM jsonb_array_elements_text(
        COALESCE(NULLIF(current_setting('app.company_ids', true), ''), '[]')::jsonb
      ) AS value
    ),
    ARRAY[]::uuid[]
  );
$$ LANGUAGE sql STABLE;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.is_instance_admin() RETURNS boolean AS $$
  SELECT COALESCE(NULLIF(current_setting('app.is_instance_admin', true), '')::boolean, false);
$$ LANGUAGE sql STABLE;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.can_create_company() RETURNS boolean AS $$
  SELECT COALESCE(NULLIF(current_setting('app.can_create_company', true), '')::boolean, false);
$$ LANGUAGE sql STABLE;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.company_allowed(target_company_id uuid) RETURNS boolean AS $$
  SELECT app.is_instance_admin() OR target_company_id = ANY(app.current_company_ids());
$$ LANGUAGE sql STABLE;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'squadrail_app_rls') THEN
    CREATE ROLE squadrail_app_rls NOLOGIN;
  END IF;
  EXECUTE format('GRANT squadrail_app_rls TO %I', current_user);
END $$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO squadrail_app_rls;--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO squadrail_app_rls;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO squadrail_app_rls;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO squadrail_app_rls;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO squadrail_app_rls;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO squadrail_app_rls;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'knowledge_chunks'
        AND column_name = 'embedding_vector'
    ) THEN
      ALTER TABLE knowledge_chunks ADD COLUMN embedding_vector vector(1536);
    END IF;

    BEGIN
      EXECUTE 'UPDATE knowledge_chunks
        SET embedding_vector = embedding::text::vector
        WHERE embedding_vector IS NULL
          AND jsonb_typeof(embedding) = ''array''';
    EXCEPTION WHEN others THEN
      NULL;
    END;

    EXECUTE 'CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_vector_hnsw_idx
      ON knowledge_chunks USING hnsw (embedding_vector vector_cosine_ops)';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS companies_select_access ON companies;--> statement-breakpoint
DROP POLICY IF EXISTS companies_insert_access ON companies;--> statement-breakpoint
DROP POLICY IF EXISTS companies_update_access ON companies;--> statement-breakpoint
DROP POLICY IF EXISTS companies_delete_access ON companies;--> statement-breakpoint
CREATE POLICY companies_select_access ON companies
  FOR SELECT
  USING (app.company_allowed(id));--> statement-breakpoint
CREATE POLICY companies_insert_access ON companies
  FOR INSERT
  WITH CHECK (app.is_instance_admin() OR app.can_create_company());--> statement-breakpoint
CREATE POLICY companies_update_access ON companies
  FOR UPDATE
  USING (app.company_allowed(id))
  WITH CHECK (app.company_allowed(id));--> statement-breakpoint
CREATE POLICY companies_delete_access ON companies
  FOR DELETE
  USING (app.company_allowed(id));--> statement-breakpoint

DO $$
DECLARE
  table_name text;
  strict_tables text[] := ARRAY[
    'agent_config_revisions',
    'company_secrets',
    'agent_api_keys',
    'issue_protocol_artifacts',
    'knowledge_documents',
    'issue_labels',
    'setup_progress',
    'activity_log',
    'knowledge_chunks',
    'role_pack_sets',
    'knowledge_chunk_links',
    'issue_attachments',
    'issue_comments',
    'join_requests',
    'issues',
    'retrieval_run_hits',
    'issue_task_briefs',
    'issue_approvals',
    'retrieval_runs',
    'assets',
    'issue_review_cycles',
    'retrieval_policies',
    'issue_protocol_violations',
    'projects',
    'approval_comments',
    'issue_protocol_threads',
    'approvals',
    'agents',
    'issue_protocol_state',
    'heartbeat_run_events',
    'project_workspaces',
    'issue_protocol_recipients',
    'heartbeat_runs',
    'agent_wakeup_requests',
    'project_goals',
    'goals',
    'agent_task_sessions',
    'principal_permission_grants',
    'labels',
    'issue_protocol_messages',
    'agent_runtime_state',
    'cost_events'
  ];
  insert_lenient_tables text[] := ARRAY[
    'company_memberships',
    'invites'
  ];
BEGIN
  FOREACH table_name IN ARRAY strict_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_select_access ON %I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_update_access ON %I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_delete_access ON %I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_insert_access ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_select_access ON %I FOR SELECT USING (app.company_allowed(company_id))',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY tenant_update_access ON %I FOR UPDATE USING (app.company_allowed(company_id)) WITH CHECK (app.company_allowed(company_id))',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY tenant_delete_access ON %I FOR DELETE USING (app.company_allowed(company_id))',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY tenant_insert_access ON %I FOR INSERT WITH CHECK (app.company_allowed(company_id) OR app.can_create_company())',
      table_name
    );
  END LOOP;

  FOREACH table_name IN ARRAY insert_lenient_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_select_access ON %I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_update_access ON %I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_delete_access ON %I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_insert_access ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_select_access ON %I FOR SELECT USING (company_id IS NULL OR app.company_allowed(company_id))',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY tenant_update_access ON %I FOR UPDATE USING (company_id IS NULL OR app.company_allowed(company_id)) WITH CHECK (company_id IS NULL OR app.company_allowed(company_id))',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY tenant_delete_access ON %I FOR DELETE USING (company_id IS NULL OR app.company_allowed(company_id))',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY tenant_insert_access ON %I FOR INSERT WITH CHECK (company_id IS NULL OR app.company_allowed(company_id) OR app.can_create_company())',
      table_name
    );
  END LOOP;
END $$;--> statement-breakpoint

ALTER TABLE role_pack_revisions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS role_pack_revisions_access ON role_pack_revisions;--> statement-breakpoint
CREATE POLICY role_pack_revisions_access ON role_pack_revisions
  USING (
    EXISTS (
      SELECT 1
      FROM role_pack_sets
      WHERE role_pack_sets.id = role_pack_revisions.role_pack_set_id
        AND app.company_allowed(role_pack_sets.company_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM role_pack_sets
      WHERE role_pack_sets.id = role_pack_revisions.role_pack_set_id
        AND (app.company_allowed(role_pack_sets.company_id) OR app.can_create_company())
    )
  );--> statement-breakpoint

ALTER TABLE role_pack_files ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS role_pack_files_access ON role_pack_files;--> statement-breakpoint
CREATE POLICY role_pack_files_access ON role_pack_files
  USING (
    EXISTS (
      SELECT 1
      FROM role_pack_revisions
      INNER JOIN role_pack_sets ON role_pack_sets.id = role_pack_revisions.role_pack_set_id
      WHERE role_pack_revisions.id = role_pack_files.revision_id
        AND app.company_allowed(role_pack_sets.company_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM role_pack_revisions
      INNER JOIN role_pack_sets ON role_pack_sets.id = role_pack_revisions.role_pack_set_id
      WHERE role_pack_revisions.id = role_pack_files.revision_id
        AND (app.company_allowed(role_pack_sets.company_id) OR app.can_create_company())
    )
  );
