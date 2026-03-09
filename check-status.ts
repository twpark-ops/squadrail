#!/usr/bin/env tsx
/**
 * Check current system status
 */

const API_BASE = "http://127.0.0.1:3101";

async function main() {
  console.log("=== System Status Check ===\n");

  // 1. Companies
  const companiesRes = await fetch(`${API_BASE}/api/companies`);
  const companies = await companiesRes.json();
  console.log(`Companies: ${companies.length}`);
  if (companies.length > 0) {
    console.log(`  - ${companies[0].name} (${companies[0].id})\n`);
  }

  const companyId = companies[0]?.id;
  if (!companyId) {
    console.error("No company found");
    return;
  }

  // 2. Projects
  const projectsRes = await fetch(`${API_BASE}/api/companies/${companyId}/projects`);
  if (!projectsRes.ok) {
    console.error(`Projects fetch failed: ${projectsRes.status}`);
    const text = await projectsRes.text();
    console.error(text.substring(0, 200));
    return;
  }
  const projects = await projectsRes.json();
  console.log(`Projects: ${projects.length}`);
  projects.forEach((p: any) => console.log(`  - ${p.name} (${p.id})`));
  console.log();

  // 3. Workspaces
  let totalWorkspaces = 0;
  for (const project of projects) {
    const wsRes = await fetch(`${API_BASE}/api/projects/${project.id}/workspaces`);
    const workspaces = await wsRes.json();
    totalWorkspaces += workspaces.length;
    if (workspaces.length > 0) {
      console.log(`Workspaces for ${project.name}:`);
      workspaces.forEach((ws: any) => {
        console.log(`  - ${ws.name} (primary: ${ws.isPrimary}): ${ws.cwd || '(no cwd)'}`);
      });
    }
  }
  console.log(`\nTotal workspaces: ${totalWorkspaces}\n`);

  // 4. Agents
  const agentsRes = await fetch(`${API_BASE}/api/agents?companyId=${companyId}`);
  const agents = await agentsRes.json();
  console.log(`Agents: ${agents.length}`);

  const agentsByRole: Record<string, number> = {};
  const agentsByStatus: Record<string, number> = {};

  agents.forEach((a: any) => {
    agentsByRole[a.role] = (agentsByRole[a.role] || 0) + 1;
    agentsByStatus[a.status] = (agentsByStatus[a.status] || 0) + 1;
  });

  console.log("\nBy role:");
  Object.entries(agentsByRole).forEach(([role, count]) => {
    console.log(`  - ${role}: ${count}`);
  });

  console.log("\nBy status:");
  Object.entries(agentsByStatus).forEach(([status, count]) => {
    console.log(`  - ${status}: ${count}`);
  });

  const ctoAgent = agents.find((a: any) => a.role === 'cto');
  if (ctoAgent) {
    console.log(`\nCTO Agent: ${ctoAgent.name}`);
    console.log(`  Status: ${ctoAgent.status}`);
    console.log(`  Adapter: ${ctoAgent.adapterType}`);
  } else {
    console.log("\n⚠️  No CTO agent found");
  }

  // 5. Knowledge base
  console.log("\n=== Knowledge Base ===\n");
  for (const project of projects.slice(0, 2)) {  // Check first 2 projects
    const docsRes = await fetch(`${API_BASE}/api/knowledge/projects/${project.id}/documents`);
    if (docsRes.ok) {
      const docs = await docsRes.json();
      console.log(`${project.name}: ${docs.length} documents`);
    }
  }

  console.log("\n=== Summary ===");
  console.log(`✅ Companies: ${companies.length}`);
  console.log(`${projects.length === 5 ? '✅' : '⚠️ '} Projects: ${projects.length} (expected: 5)`);
  console.log(`${totalWorkspaces === 5 ? '✅' : '⚠️ '} Workspaces: ${totalWorkspaces} (expected: 5)`);
  console.log(`${agents.length === 18 ? '✅' : '⚠️ '} Agents: ${agents.length} (expected: 18)`);
  console.log(`${ctoAgent ? (ctoAgent.status === 'idle' ? '✅' : '⚠️ ') : '❌'} CTO Agent: ${ctoAgent ? ctoAgent.status : 'missing'}`);
}

main().catch(err => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
