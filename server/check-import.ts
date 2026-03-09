import { createDbClient } from '../packages/db/src/client.js';

const db = await createDbClient({
  databaseUrl: 'postgresql://postgres@127.0.0.1:54329/squadrail'
});

const companyId = '9677872e-35bd-4843-8341-06663d6f9ae4';

const company = await db`SELECT id, name, issue_prefix, description FROM companies WHERE id = ${companyId}`;
console.log('=== COMPANY ===');
console.log(`Name: ${company[0].name}`);
console.log(`Issue Prefix: ${company[0].issue_prefix}`);
console.log(`Description: ${company[0].description || 'N/A'}`);

const agents = await db`SELECT name, role, adapter_type FROM agents WHERE company_id = ${companyId} ORDER BY 
  CASE role 
    WHEN 'cto' THEN 1
    WHEN 'pm' THEN 2
    WHEN 'qa' THEN 3
    ELSE 4
  END, name`;
console.log(`\n=== AGENTS (${agents.length}/18) ===`);
const roleCount = {};
agents.forEach(a => {
  roleCount[a.role] = (roleCount[a.role] || 0) + 1;
  console.log(`  ${a.name} (${a.role}, ${a.adapter_type})`);
});
console.log(`\nRole distribution:`, roleCount);

const projects = await db`SELECT id, name, lead_agent_slug, status FROM projects WHERE company_id = ${companyId} ORDER BY name`;
console.log(`\n=== PROJECTS (${projects.length}/5) ===`);
for (const p of projects) {
  console.log(`  ${p.name} - ${p.status}`);
}

console.log(`\n=== WORKSPACES ===`);
for (const project of projects) {
  const workspaces = await db`SELECT name, cwd, is_primary FROM project_workspaces WHERE project_id = ${project.id} ORDER BY is_primary DESC`;
  console.log(`\n${project.name}:`);
  workspaces.forEach(w => console.log(`    ${w.is_primary ? '[PRIMARY]' : '[ISOLATED]'} ${w.name}: ${w.cwd}`));
}

await db.end();
