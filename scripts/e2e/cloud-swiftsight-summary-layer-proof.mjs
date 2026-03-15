#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { extractJsonTail, summarizeKnowledgeQualityGate } from "./rag-readiness-utils.mjs";
import { compareDomainAwareProofRuns, normalizeDomainAwareProofResultSet } from "./summary-proof-utils.mjs";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASELINE_ARTIFACT_PATH = process.env.SWIFTSIGHT_SUMMARY_PROOF_BASELINE_PATH
  ?? path.join(REPO_ROOT, "scripts", "e2e", "cloud-swiftsight-domain-aware-pm-baseline.json");
const INCLUDE_RAG_READINESS = process.env.SWIFTSIGHT_SUMMARY_PROOF_INCLUDE_RAG_READINESS !== "0";

function note(message = "") {
  process.stdout.write(`${message}\n`);
}

function section(title) {
  note("");
  note("=".repeat(96));
  note(title);
  note("=".repeat(96));
}

async function readBaselineArtifact() {
  const raw = await readFile(BASELINE_ARTIFACT_PATH, "utf8");
  return JSON.parse(raw);
}

async function runDomainAwarePmBurnIn() {
  const { stdout, stderr } = await execFileAsync("node", ["scripts/e2e/cloud-swiftsight-domain-aware-pm-burn-in.mjs"], {
    cwd: REPO_ROOT,
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
  return extractJsonTail(stdout);
}

async function runRagReadiness() {
  const { stdout, stderr } = await execFileAsync("node", ["scripts/e2e/cloud-swiftsight-rag-readiness.mjs"], {
    cwd: REPO_ROOT,
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
  return extractJsonTail(stdout);
}

async function main() {
  section("Load Baseline Artifact");
  const baselineArtifact = await readBaselineArtifact();
  const baseline = normalizeDomainAwareProofResultSet(baselineArtifact);
  note(`baselineFixture=${baseline.fixture.companyName ?? "unknown"}`);
  note(`baselineScenarioCount=${baseline.results.length}`);

  section("Run Current Domain-Aware PM Burn-In");
  const currentResults = await runDomainAwarePmBurnIn();
  const comparison = compareDomainAwareProofRuns({
    baseline: baselineArtifact,
    current: currentResults,
  });
  note(`improvedScenarioCount=${comparison.summary.improvedScenarioCount}`);
  note(`regressedScenarioCount=${comparison.summary.regressedScenarioCount}`);
  note(`changedProjectSelectionCount=${comparison.summary.changedProjectSelectionCount}`);

  let ragReadinessSummary = null;
  if (INCLUDE_RAG_READINESS) {
    section("Run Rag Readiness Gate");
    const readiness = await runRagReadiness();
    ragReadinessSummary = summarizeKnowledgeQualityGate(readiness);
    note(`ragReadinessStatus=${ragReadinessSummary.status ?? "unknown"}`);
    note(`ragFunctionalStatus=${ragReadinessSummary.functionalStatus ?? "unknown"}`);
  }

  note(
    JSON.stringify(
      {
        version: 1,
        baseline: baselineArtifact,
        current: normalizeDomainAwareProofResultSet(currentResults),
        comparison,
        ragReadinessSummary,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
