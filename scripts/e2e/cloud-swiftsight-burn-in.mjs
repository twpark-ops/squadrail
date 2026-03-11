#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BURN_IN_BATCH_SCENARIOS } from "./burn-in-scenarios.mjs";
import {
  extractJsonTail,
} from "./rag-readiness-utils.mjs";

const execFileAsync = promisify(execFile);

const BASE_URL = process.env.SQUADRAIL_BASE_URL ?? "http://127.0.0.1:3101";
const BATCH_KEY = process.env.SWIFTSIGHT_BURN_IN_BATCH?.trim() || "batch1";
const PROJECT_QUALITY_DAYS = Number(process.env.SWIFTSIGHT_BURN_IN_QUALITY_DAYS ?? 14);

function note(message = "") {
  process.stdout.write(`${message}\n`);
}

function section(title) {
  note("");
  note("=".repeat(96));
  note(title);
  note("=".repeat(96));
}

async function api(pathname) {
  const response = await fetch(`${BASE_URL}${pathname}`);
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    throw new Error(`API GET ${pathname} failed with ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

async function runRealOrgScenarioBatch(scenarioSelection) {
  const env = {
    ...process.env,
    SQUADRAIL_BASE_URL: BASE_URL,
    SWIFTSIGHT_E2E_SCENARIO: scenarioSelection.join(","),
  };
  const startedAt = Date.now();
  const { stdout, stderr } = await execFileAsync("node", ["scripts/e2e/cloud-swiftsight-real-org.mjs"], {
    cwd: process.cwd(),
    env,
    maxBuffer: 10 * 1024 * 1024,
  });
  const durationMs = Date.now() - startedAt;
  const parsed = extractJsonTail(stdout);
  assert(Array.isArray(parsed), "burn-in harness did not emit scenario summary JSON array");
  return {
    durationMs,
    stdout,
    stderr,
    results: parsed,
  };
}

async function cleanupLingeringE2eIssues() {
  const env = {
    ...process.env,
    SQUADRAIL_BASE_URL: BASE_URL,
  };
  const { stdout, stderr } = await execFileAsync("node", ["scripts/e2e/cloud-swiftsight-real-org-cleanup.mjs"], {
    cwd: process.cwd(),
    env,
    maxBuffer: 4 * 1024 * 1024,
  });
  return { stdout, stderr };
}

async function enrichScenarioResult(result) {
  const issueId = result?.issueId;
  const issueIdentifier = result?.issueIdentifier ?? result?.identifier ?? null;
  const projectId = result?.projectId ?? null;
  const [protocolState, quality] = await Promise.all([
    issueId ? api(`/api/issues/${issueId}/protocol/state`) : Promise.resolve(null),
    projectId
      ? api(`/api/knowledge/quality?companyId=${encodeURIComponent(result.companyId)}&projectId=${encodeURIComponent(projectId)}&days=${PROJECT_QUALITY_DAYS}`)
      : Promise.resolve(null),
  ]);
  return {
    issueId,
    issueIdentifier,
    scenarioKey: result?.scenarioKey ?? null,
    status: result?.status ?? protocolState?.workflowState ?? null,
    workflowState: protocolState?.workflowState ?? null,
    candidateCacheHitRate: quality?.candidateCacheHitRate ?? null,
    finalCacheHitRate: quality?.finalCacheHitRate ?? null,
    multiHopGraphExpandedRuns: quality?.multiHopGraphExpandedRuns ?? null,
    readinessGate: quality?.readinessGate ?? null,
    functionalReadinessGate: quality?.functionalReadinessGate ?? null,
    historicalHygieneGate: quality?.historicalHygieneGate ?? null,
  };
}

async function main() {
  section("Resolve Burn-In Batch");
  const scenarios = BURN_IN_BATCH_SCENARIOS[BATCH_KEY];
  assert(scenarios?.length, `Unknown burn-in batch: ${BATCH_KEY}`);
  note(`batch=${BATCH_KEY}`);
  note(`scenarioCount=${scenarios.length}`);
  note(`scenarios=${scenarios.join(", ")}`);

  section("Cleanup Lingering E2E Issues");
  const cleanup = await cleanupLingeringE2eIssues();
  if (cleanup.stdout.trim()) note(cleanup.stdout.trim());
  if (cleanup.stderr.trim()) note(cleanup.stderr.trim());

  section("Run Real-Org Batch");
  const run = await runRealOrgScenarioBatch(scenarios);
  note(`durationMs=${run.durationMs}`);

  section("Enrich Results");
  const enriched = [];
  for (const result of run.results) {
    enriched.push(await enrichScenarioResult(result));
  }

  section("Summary");
  note(JSON.stringify({
    ok: true,
    batch: BATCH_KEY,
    durationMs: run.durationMs,
    scenarioCount: scenarios.length,
    results: enriched,
  }, null, 2));
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
