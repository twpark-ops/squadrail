#!/usr/bin/env tsx
/**
 * Simple Bootstrap Import
 * Imports agents from bootstrap bundle via API
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const API_BASE = process.env.API_BASE || "http://127.0.0.1:3101";
const BUNDLE_DIR = "/home/taewoong/company-project/squadall/bootstrap-bundles/cloud-swiftsight";
const BUNDLE_PATH = path.join(BUNDLE_DIR, "squadrail.manifest.json");

async function main() {
  console.log("🚀 Importing Bootstrap Bundle\n");

  // Read bundle
  const bundleContent = await fs.readFile(BUNDLE_PATH, 'utf-8');
  const bundle = JSON.parse(bundleContent);

  console.log(`Company: ${bundle.company.name}`);
  console.log(`Projects: ${bundle.projects.length}`);
  console.log(`Agents: ${bundle.agents.length}\n`);

  // Load all markdown files
  console.log("Loading markdown files...");
  const files: Record<string, string> = {};

  // Load agent markdown files
  for (const agent of bundle.agents) {
    if (agent.path) {
      const agentMdPath = path.join(BUNDLE_DIR, agent.path);
      try {
        files[agent.path] = await fs.readFile(agentMdPath, 'utf-8');
        console.log(`  ✅ ${agent.path}`);
      } catch (err) {
        console.log(`  ⚠️  ${agent.path} (not found)`);
      }
    }
  }

  // Load company markdown
  if (bundle.company.path) {
    const companyMdPath = path.join(BUNDLE_DIR, bundle.company.path);
    try {
      files[bundle.company.path] = await fs.readFile(companyMdPath, 'utf-8');
      console.log(`  ✅ ${bundle.company.path}`);
    } catch (err) {
      console.log(`  ⚠️  ${bundle.company.path} (not found)`);
    }
  }

  console.log(`\nLoaded ${Object.keys(files).length} files\n`);

  // Get existing company ID
  const companiesRes = await fetch(`${API_BASE}/api/companies`);
  const companies = await companiesRes.json();

  if (companies.length === 0) {
    throw new Error("No company found. Cannot import agents.");
  }

  const companyId = companies[0].id;
  console.log(`Target company ID: ${companyId}\n`);

  // Import via API
  console.log(`Calling POST ${API_BASE}/api/companies/import\n`);

  const response = await fetch(`${API_BASE}/api/companies/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: {
        type: 'inline',
        manifest: bundle,
        files: files,
      },
      target: {
        mode: 'existing_company',
        companyId: companyId,
      },
      include: {
        company: false,  // Don't update company
        projects: false, // Already exist
        agents: true,    // Need to create
      },
      agents: 'all',
      collisionStrategy: 'rename',
    }),
  });

  console.log(`Response status: ${response.status} ${response.statusText}\n`);

  if (!response.ok) {
    const error = await response.text();
    console.error("Error response:");
    console.error(error);
    process.exit(1);
  }

  const result = await response.json();
  console.log("Import successful!");
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
