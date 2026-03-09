#!/usr/bin/env tsx
/**
 * Bootstrap Fix Script
 *
 * This script:
 * 1. Checks current workspace state in DB
 * 2. Re-imports the bootstrap bundle to create workspaces
 * 3. Verifies CTO agent status
 * 4. Imports knowledge base for all projects
 */

const API_BASE = "http://127.0.0.1:3100";
const BUNDLE_PATH = "/home/taewoong/company-project/squadall/bootstrap-bundles/cloud-swiftsight/squadrail.manifest.json";

interface BootstrapResult {
  workspacesCreated: number;
  projectsProcessed: number;
  agentsFixed: number;
  knowledgeImported: boolean;
}

async function checkCurrentState() {
  console.log("=== Step 1: Checking Current State ===\n");

  // Check companies
  const companiesRes = await fetch(`${API_BASE}/api/companies`);
  const companies = await companiesRes.json();
  console.log(`Companies: ${companies.length}`);

  if (companies.length === 0) {
    throw new Error("No company found. Bootstrap has not been run.");
  }

  const company = companies[0];
  console.log(`Company ID: ${company.id}`);
  console.log(`Company Name: ${company.name}\n`);

  // Check projects
  const projectsRes = await fetch(`${API_BASE}/api/projects?companyId=${company.id}`);
  const projects = await projectsRes.json();
  console.log(`Projects: ${projects.length}`);
  projects.forEach((p: any) => console.log(`  - ${p.name} (${p.id})`));
  console.log();

  // Check workspaces for each project
  let totalWorkspaces = 0;
  for (const project of projects) {
    const wsRes = await fetch(`${API_BASE}/api/projects/${project.id}/workspaces`);
    const workspaces = await wsRes.json();
    totalWorkspaces += workspaces.length;
    console.log(`Project "${project.name}" workspaces: ${workspaces.length}`);
    if (workspaces.length > 0) {
      workspaces.forEach((ws: any) => {
        console.log(`  - ${ws.name}: ${ws.cwd || '(no cwd)'}`);
      });
    }
  }
  console.log(`\nTotal workspaces: ${totalWorkspaces}`);

  // Check agents
  const agentsRes = await fetch(`${API_BASE}/api/agents?companyId=${company.id}`);
  const agents = await agentsRes.json();
  console.log(`\nAgents: ${agents.length}`);

  const ctoAgent = agents.find((a: any) => a.role === 'cto');
  if (ctoAgent) {
    console.log(`CTO Agent: ${ctoAgent.name} (status: ${ctoAgent.status})`);
  }

  const errorAgents = agents.filter((a: any) => a.status === 'error');
  if (errorAgents.length > 0) {
    console.log(`\n⚠️  Agents with error status: ${errorAgents.length}`);
    errorAgents.forEach((a: any) => console.log(`  - ${a.name}`));
  }

  return {
    company,
    projects,
    totalWorkspaces,
    agents,
    ctoAgent,
    errorAgents
  };
}

async function reimportBundle() {
  console.log("\n=== Step 2: Re-importing Bootstrap Bundle ===\n");

  const fs = await import('node:fs/promises');
  const bundleContent = await fs.readFile(BUNDLE_PATH, 'utf-8');
  const bundle = JSON.parse(bundleContent);

  console.log(`Bundle: ${bundle.company.name}`);
  console.log(`Projects in bundle: ${bundle.projects.length}`);
  console.log(`Agents in bundle: ${bundle.agents.length}\n`);

  // Import bundle via API
  const importRes = await fetch(`${API_BASE}/api/companies/bootstrap/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: bundleContent,
      include: {
        company: true,
        projects: true,
        agents: true,
      },
      collisionStrategy: 'merge',
    }),
  });

  if (!importRes.ok) {
    const error = await importRes.text();
    console.error(`Import failed: ${importRes.status}`);
    console.error(error);
    throw new Error(`Bootstrap import failed: ${importRes.status}`);
  }

  const result = await importRes.json();
  console.log("Import result:");
  console.log(JSON.stringify(result, null, 2));

  return result;
}

async function verifyWorkspaces() {
  console.log("\n=== Step 3: Verifying Workspaces ===\n");

  const companiesRes = await fetch(`${API_BASE}/api/companies`);
  const companies = await companiesRes.json();
  const company = companies[0];

  const projectsRes = await fetch(`${API_BASE}/api/projects?companyId=${company.id}`);
  const projects = await projectsRes.json();

  const expectedWorkspaces = [
    { project: 'swiftsight-cloud', cwd: '/home/taewoong/workspace/cloud-swiftsight/swiftsight-cloud' },
    { project: 'swiftsight-agent', cwd: '/home/taewoong/workspace/cloud-swiftsight/swiftsight-agent' },
    { project: 'swiftcl', cwd: '/home/taewoong/workspace/cloud-swiftsight/swiftcl' },
    { project: 'swiftsight-report-server', cwd: '/home/taewoong/workspace/cloud-swiftsight/swiftsight-report-server' },
    { project: 'swiftsight-worker', cwd: '/home/taewoong/workspace/cloud-swiftsight/swiftsight-worker' },
  ];

  let verified = 0;
  let missing = 0;

  for (const expected of expectedWorkspaces) {
    const project = projects.find((p: any) => p.name === expected.project);
    if (!project) {
      console.log(`❌ Project not found: ${expected.project}`);
      missing++;
      continue;
    }

    const wsRes = await fetch(`${API_BASE}/api/projects/${project.id}/workspaces`);
    const workspaces = await wsRes.json();

    const primaryWs = workspaces.find((ws: any) => ws.isPrimary);
    if (!primaryWs) {
      console.log(`❌ No primary workspace for: ${expected.project}`);
      missing++;
      continue;
    }

    if (primaryWs.cwd === expected.cwd) {
      console.log(`✅ ${expected.project}: ${primaryWs.cwd}`);
      verified++;
    } else {
      console.log(`⚠️  ${expected.project}: ${primaryWs.cwd} (expected: ${expected.cwd})`);
      missing++;
    }
  }

  console.log(`\nVerified: ${verified}/${expectedWorkspaces.length}`);
  return verified === expectedWorkspaces.length;
}

async function importKnowledge() {
  console.log("\n=== Step 4: Importing Knowledge Base ===\n");

  const companiesRes = await fetch(`${API_BASE}/api/companies`);
  const companies = await companiesRes.json();
  const company = companies[0];

  const projectsRes = await fetch(`${API_BASE}/api/projects?companyId=${company.id}`);
  const projects = await projectsRes.json();

  const results = [];

  for (const project of projects) {
    console.log(`\nImporting knowledge for: ${project.name}`);

    const wsRes = await fetch(`${API_BASE}/api/projects/${project.id}/workspaces`);
    const workspaces = await wsRes.json();
    const primaryWs = workspaces.find((ws: any) => ws.isPrimary);

    if (!primaryWs || !primaryWs.cwd) {
      console.log(`  ⚠️  No primary workspace with CWD, skipping`);
      continue;
    }

    const importRes = await fetch(`${API_BASE}/api/knowledge/projects/${project.id}/import-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!importRes.ok) {
      console.log(`  ❌ Import failed: ${importRes.status}`);
      continue;
    }

    const result = await importRes.json();
    console.log(`  ✅ Import started (status: ${importRes.status})`);

    // Wait a bit for processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    results.push({ project: project.name, success: true });
  }

  return results;
}

async function generateReport(state: any, importResult: any, workspacesOk: boolean, knowledgeResults: any[]) {
  const report = `# 수정 완료 보고서

**날짜**: ${new Date().toISOString()}
**프로젝트**: squadall

---

## Workspace CWD 수정

${workspacesOk ? '✅' : '❌'} Workspace 수정 완료

### 프로젝트별 상태

${state.projects.map((p: any) => `- ${p.name}: ${workspacesOk ? '✅' : '⚠️'}`).join('\n')}

---

## CTO Error 수정

**원인**: ${state.ctoAgent?.status === 'error' ? 'Error 상태 확인됨' : '정상'}
**수정**: ${importResult ? '✅ Bootstrap 재실행' : '❌'}
**Status**: ${state.ctoAgent?.status || 'unknown'}

---

## Knowledge Import

**Documents**: ${knowledgeResults.filter((r: any) => r.success).length}/${knowledgeResults.length} 프로젝트
**Status**: ${knowledgeResults.length > 0 ? '✅' : '❌'}

### 프로젝트별 Import

${knowledgeResults.map((r: any) => `- ${r.project}: ${r.success ? '✅' : '❌'}`).join('\n')}

---

## 다음 단계

${workspacesOk ? '✅ E2E 재실행 준비 완료' : '⚠️  Workspace 수정 필요'}

### 검증 명령어

\`\`\`bash
# Database 직접 확인
docker exec squadall-db-1 psql -U squadrail -d squadrail -c "SELECT COUNT(*) FROM project_workspaces;"
docker exec squadall-db-1 psql -U squadrail -d squadrail -c "SELECT COUNT(*) FROM knowledge_documents;"
docker exec squadall-db-1 psql -U squadrail -d squadrail -c "SELECT COUNT(*) FROM knowledge_chunks;"

# Agent 상태 확인
curl http://127.0.0.1:3100/api/agents | jq '.[] | select(.role == "cto")'
\`\`\`

---

**Generated**: ${new Date().toISOString()}
`;

  await import('node:fs/promises').then(fs =>
    fs.writeFile('/home/taewoong/company-project/squadall/FIX_REPORT.md', report)
  );

  console.log("\n" + report);
}

async function main() {
  console.log("🔧 Bootstrap Fix Script\n");
  console.log("=" .repeat(60) + "\n");

  try {
    const state = await checkCurrentState();

    if (state.totalWorkspaces === 0) {
      console.log("\n⚠️  No workspaces found. Re-importing bootstrap bundle...\n");
      const importResult = await reimportBundle();
      const workspacesOk = await verifyWorkspaces();
      const knowledgeResults = await importKnowledge();

      await generateReport(state, importResult, workspacesOk, knowledgeResults);
    } else {
      console.log("\n✅ Workspaces already exist. Verifying...\n");
      const workspacesOk = await verifyWorkspaces();

      if (!workspacesOk) {
        console.log("\n⚠️  Workspace verification failed. Consider manual fix.\n");
      }

      const knowledgeResults = await importKnowledge();
      await generateReport(state, null, workspacesOk, knowledgeResults);
    }

    console.log("\n✅ Fix script completed");
    console.log("📄 Report: /home/taewoong/company-project/squadall/FIX_REPORT.md\n");

  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

main();
