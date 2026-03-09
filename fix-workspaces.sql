-- Fix missing workspaces for cloud-swiftsight projects
-- This SQL script creates primary workspaces for all 5 projects

-- Get company_id
\set company_id '45e628d4-c001-4b8e-b048-5ed9fac4f987'

-- Insert workspaces for each project
-- 1. swiftsight-cloud
INSERT INTO project_workspaces (company_id, project_id, name, cwd, repo_url, repo_ref, metadata, is_primary)
SELECT
  :'company_id'::uuid,
  p.id,
  'shared',
  '/home/taewoong/workspace/cloud-swiftsight/swiftsight-cloud',
  NULL,
  'HEAD',
  '{"purpose": "shared-analysis-review", "projectSlug": "swiftsight-cloud", "language": "Go", "stack": ["ConnectRPC", "Hasura", "Temporal", "RabbitMQ", "PostgreSQL"], "repoState": "clean", "documentationSignal": "high", "knowledgePriority": "P0"}'::jsonb,
  true
FROM projects p
WHERE p.name = 'swiftsight-cloud'
  AND NOT EXISTS (
    SELECT 1 FROM project_workspaces pw WHERE pw.project_id = p.id
  );

-- 2. swiftsight-agent
INSERT INTO project_workspaces (company_id, project_id, name, cwd, repo_url, repo_ref, metadata, is_primary)
SELECT
  :'company_id'::uuid,
  p.id,
  'shared',
  '/home/taewoong/workspace/cloud-swiftsight/swiftsight-agent',
  NULL,
  'HEAD',
  '{"purpose": "shared-analysis-review", "projectSlug": "swiftsight-agent", "language": "Go", "stack": ["gRPC", "DICOM", "RabbitMQ", "Command Execution"], "repoState": "clean", "documentationSignal": "high", "knowledgePriority": "P0"}'::jsonb,
  true
FROM projects p
WHERE p.name = 'swiftsight-agent'
  AND NOT EXISTS (
    SELECT 1 FROM project_workspaces pw WHERE pw.project_id = p.id
  );

-- 3. swiftcl
INSERT INTO project_workspaces (company_id, project_id, name, cwd, repo_url, repo_ref, metadata, is_primary)
SELECT
  :'company_id'::uuid,
  p.id,
  'shared',
  '/home/taewoong/workspace/cloud-swiftsight/swiftcl',
  NULL,
  'HEAD',
  '{"purpose": "shared-analysis-review", "projectSlug": "swiftcl", "language": "Go", "stack": ["HCL v2", "Tree-sitter", "LSP", "CLI Tooling"], "repoState": "clean", "documentationSignal": "high", "knowledgePriority": "P0"}'::jsonb,
  true
FROM projects p
WHERE p.name = 'swiftcl'
  AND NOT EXISTS (
    SELECT 1 FROM project_workspaces pw WHERE pw.project_id = p.id
  );

-- 4. swiftsight-report-server
INSERT INTO project_workspaces (company_id, project_id, name, cwd, repo_url, repo_ref, metadata, is_primary)
SELECT
  :'company_id'::uuid,
  p.id,
  'shared',
  '/home/taewoong/workspace/cloud-swiftsight/swiftsight-report-server',
  NULL,
  'HEAD',
  '{"purpose": "shared-analysis-review", "projectSlug": "swiftsight-report-server", "language": "Python", "stack": ["Python", "RabbitMQ RPC", "S3", "Report Rendering"], "repoState": "clean", "documentationSignal": "medium", "knowledgePriority": "P1"}'::jsonb,
  true
FROM projects p
WHERE p.name = 'swiftsight-report-server'
  AND NOT EXISTS (
    SELECT 1 FROM project_workspaces pw WHERE pw.project_id = p.id
  );

-- 5. swiftsight-worker
INSERT INTO project_workspaces (company_id, project_id, name, cwd, repo_url, repo_ref, metadata, is_primary)
SELECT
  :'company_id'::uuid,
  p.id,
  'shared',
  '/home/taewoong/workspace/cloud-swiftsight/swiftsight-worker',
  NULL,
  'HEAD',
  '{"purpose": "shared-analysis-review", "projectSlug": "swiftsight-worker", "language": "Python", "stack": ["Python", "Temporal SDK", "PyTorch", "S3", "Worker Pipelines"], "repoState": "dirty", "documentationSignal": "medium", "knowledgePriority": "P1"}'::jsonb,
  true
FROM projects p
WHERE p.name = 'swiftsight-worker'
  AND NOT EXISTS (
    SELECT 1 FROM project_workspaces pw WHERE pw.project_id = p.id
  );

-- Verify
SELECT
  p.name as project,
  pw.name as workspace,
  pw.cwd,
  pw.is_primary
FROM projects p
JOIN project_workspaces pw ON pw.project_id = p.id
ORDER BY p.created_at;
