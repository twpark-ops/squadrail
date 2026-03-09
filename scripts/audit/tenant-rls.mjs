#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import postgres from "../../node_modules/.pnpm/postgres@3.4.8/node_modules/postgres/src/index.js";

const DEFAULT_DATABASE_URL = "postgres://squadrail:squadrail@127.0.0.1:54329/squadrail";
const ROLLBACK_SENTINEL = "__SQUADRAIL_RLS_AUDIT_ROLLBACK__";

const STRICT_TABLES = [
  "agent_config_revisions",
  "company_secrets",
  "agent_api_keys",
  "issue_protocol_artifacts",
  "knowledge_documents",
  "issue_labels",
  "setup_progress",
  "activity_log",
  "knowledge_chunks",
  "role_pack_sets",
  "knowledge_chunk_links",
  "issue_attachments",
  "issue_comments",
  "join_requests",
  "issues",
  "retrieval_run_hits",
  "issue_task_briefs",
  "issue_approvals",
  "retrieval_runs",
  "assets",
  "issue_review_cycles",
  "retrieval_policies",
  "issue_protocol_violations",
  "projects",
  "approval_comments",
  "issue_protocol_threads",
  "approvals",
  "agents",
  "issue_protocol_state",
  "heartbeat_run_events",
  "project_workspaces",
  "issue_protocol_recipients",
  "heartbeat_runs",
  "agent_wakeup_requests",
  "project_goals",
  "goals",
  "agent_task_sessions",
  "principal_permission_grants",
  "labels",
  "issue_protocol_messages",
  "agent_runtime_state",
  "cost_events",
];

const LENIENT_INSERT_TABLES = [
  "company_memberships",
  "invites",
];

function parseDatabaseUrl() {
  const flag = process.argv.find((value) => value.startsWith("--database-url="));
  return flag?.slice("--database-url=".length)
    ?? process.env.DATABASE_URL
    ?? process.env.SQUADRAIL_DATABASE_URL
    ?? DEFAULT_DATABASE_URL;
}

function redactDatabaseUrl(databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    if (url.password) url.password = "******";
    return url.toString();
  } catch {
    return databaseUrl;
  }
}

function checksum(content) {
  return createHash("sha256").update(content).digest("hex");
}

function embedding(seed, dimensions = 1536) {
  return Array.from({ length: dimensions }, (_, index) =>
    Number((((seed + 1) * (index + 3)) % 997) / 997).toFixed(6),
  );
}

async function simulateRls(sql) {
  const companyA = randomUUID();
  const companyB = randomUUID();
  const setA = randomUUID();
  const setB = randomUUID();
  const revisionA = randomUUID();
  const revisionB = randomUUID();
  const documentA = randomUUID();
  const documentB = randomUUID();

  let result = {
    visibleCompanies: 0,
    visibleKnowledgeDocuments: 0,
    visibleRolePackFiles: 0,
    unauthorizedInsertBlocked: false,
  };

  try {
    await sql.begin(async (tx) => {
      await tx`
        insert into companies (
          id, name, description, status, issue_prefix, issue_counter, budget_monthly_cents, spent_monthly_cents,
          require_board_approval_for_new_agents
        ) values
          (${companyA}, ${"RLS Audit A"}, ${"audit company a"}, 'active', ${"RLA"}, 0, 0, 0, true),
          (${companyB}, ${"RLS Audit B"}, ${"audit company b"}, 'active', ${"RLB"}, 0, 0, 0, true)
      `;

      await tx`
        insert into role_pack_sets (id, company_id, scope_type, scope_id, role_key, status, metadata)
        values
          (${setA}, ${companyA}, 'company', '', 'engineer', 'published', '{}'::jsonb),
          (${setB}, ${companyB}, 'company', '', 'engineer', 'published', '{}'::jsonb)
      `;
      await tx`
        insert into role_pack_revisions (id, role_pack_set_id, version, status, message, created_by_user_id)
        values
          (${revisionA}, ${setA}, 1, 'published', 'seed', 'audit-user'),
          (${revisionB}, ${setB}, 1, 'published', 'seed', 'audit-user')
      `;
      await tx`
        insert into role_pack_files (revision_id, filename, content, checksum_sha256)
        values
          (${revisionA}, 'ROLE.md', '# Engineer A', ${checksum("# Engineer A")}),
          (${revisionB}, 'ROLE.md', '# Engineer B', ${checksum("# Engineer B")})
      `;

      await tx`
        insert into knowledge_documents (
          id, company_id, source_type, authority_level, content_sha256, metadata, raw_content, title, path
        ) values
          (${documentA}, ${companyA}, 'doc', 'canonical', ${checksum("doc-a")}, '{}'::jsonb, 'doc-a', 'Doc A', 'docs/a.md'),
          (${documentB}, ${companyB}, 'doc', 'canonical', ${checksum("doc-b")}, '{}'::jsonb, 'doc-b', 'Doc B', 'docs/b.md')
      `;

      const embedA = JSON.stringify(embedding(1));
      const embedB = JSON.stringify(embedding(2));
      await tx`
        insert into knowledge_chunks (
          company_id, document_id, chunk_index, token_count, text_content, search_tsv, embedding, metadata
        ) values
          (${companyA}, ${documentA}, 0, 32, 'tenant-a chunk', to_tsvector('simple', 'tenant-a chunk'), ${embedA}::jsonb, '{}'::jsonb),
          (${companyB}, ${documentB}, 0, 32, 'tenant-b chunk', to_tsvector('simple', 'tenant-b chunk'), ${embedB}::jsonb, '{}'::jsonb)
      `;

      await tx`set local role squadrail_app_rls`;
      await tx`select set_config('app.company_ids', ${JSON.stringify([companyA])}, true)`;
      await tx`select set_config('app.is_instance_admin', 'false', true)`;
      await tx`select set_config('app.can_create_company', 'false', true)`;

      const [companiesVisible] = await tx`select count(*)::int as count from companies`;
      const [documentsVisible] = await tx`select count(*)::int as count from knowledge_documents`;
      const [filesVisible] = await tx`select count(*)::int as count from role_pack_files`;

      let unauthorizedInsertBlocked = false;
      try {
        await tx`
          insert into knowledge_documents (
            company_id, source_type, authority_level, content_sha256, metadata, raw_content, title, path
          ) values (
            ${companyB}, 'doc', 'canonical', ${checksum("blocked")}, '{}'::jsonb, 'blocked', 'Blocked', 'docs/blocked.md'
          )
        `;
      } catch {
        unauthorizedInsertBlocked = true;
      }

      result = {
        visibleCompanies: Number(companiesVisible?.count ?? 0),
        visibleKnowledgeDocuments: Number(documentsVisible?.count ?? 0),
        visibleRolePackFiles: Number(filesVisible?.count ?? 0),
        unauthorizedInsertBlocked,
      };

      throw new Error(ROLLBACK_SENTINEL);
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== ROLLBACK_SENTINEL) {
      throw error;
    }
  }

  return result;
}

async function main() {
  const databaseUrl = parseDatabaseUrl();
  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
  });

  try {
    const [roleRow] = await sql`
      select exists(select 1 from pg_roles where rolname = 'squadrail_app_rls') as ready
    `;
    const rlsRoleReady = Boolean(roleRow?.ready ?? false);

    const tableRows = await sql`
      select c.relname as table_name, c.relrowsecurity
      from pg_class c
      inner join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
    `;
    const policyRows = await sql`
      select tablename as table_name, policyname as policy_name
      from pg_policies
      where schemaname = 'public'
    `;

    const rlsByTable = new Map(tableRows.map((row) => [row.table_name, row.relrowsecurity]));
    const policiesByTable = new Map();
    for (const row of policyRows) {
      const current = policiesByTable.get(row.table_name) ?? new Set();
      current.add(row.policy_name);
      policiesByTable.set(row.table_name, current);
    }

    const expectations = [
      {
        table: "companies",
        enabled: Boolean(rlsByTable.get("companies")),
        missingPolicies: ["companies_select_access", "companies_insert_access", "companies_update_access", "companies_delete_access"]
          .filter((name) => !policiesByTable.get("companies")?.has(name)),
      },
      ...STRICT_TABLES.map((table) => ({
        table,
        enabled: Boolean(rlsByTable.get(table)),
        missingPolicies: ["tenant_select_access", "tenant_update_access", "tenant_delete_access", "tenant_insert_access"]
          .filter((name) => !policiesByTable.get(table)?.has(name)),
      })),
      ...LENIENT_INSERT_TABLES.map((table) => ({
        table,
        enabled: Boolean(rlsByTable.get(table)),
        missingPolicies: ["tenant_select_access", "tenant_update_access", "tenant_delete_access", "tenant_insert_access"]
          .filter((name) => !policiesByTable.get(table)?.has(name)),
      })),
      {
        table: "role_pack_revisions",
        enabled: Boolean(rlsByTable.get("role_pack_revisions")),
        missingPolicies: ["role_pack_revisions_access"]
          .filter((name) => !policiesByTable.get("role_pack_revisions")?.has(name)),
      },
      {
        table: "role_pack_files",
        enabled: Boolean(rlsByTable.get("role_pack_files")),
        missingPolicies: ["role_pack_files_access"]
          .filter((name) => !policiesByTable.get("role_pack_files")?.has(name)),
      },
    ];

    const simulation = await simulateRls(sql);
    const failedPolicies = expectations.filter((entry) => !entry.enabled || entry.missingPolicies.length > 0);
    const status = rlsRoleReady
      && failedPolicies.length === 0
      && simulation.unauthorizedInsertBlocked
      && simulation.visibleCompanies === 1
      && simulation.visibleKnowledgeDocuments === 1
      && simulation.visibleRolePackFiles === 1
      ? "pass"
      : "fail";

    const report = {
      databaseUrl: redactDatabaseUrl(databaseUrl),
      checkedAt: new Date().toISOString(),
      rlsRoleReady,
      policyExpectations: expectations,
      simulation,
      status,
    };

    console.log(JSON.stringify(report, null, 2));
    if (status !== "pass") {
      process.exitCode = 1;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await main();
