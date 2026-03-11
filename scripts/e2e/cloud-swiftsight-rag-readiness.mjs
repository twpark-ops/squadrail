#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  collectNonReadyProjectIds,
  extractJsonTail,
  findLatestBriefByScope,
  isKnowledgeSetupReady,
  summarizeBriefQuality,
} from "./rag-readiness-utils.mjs";

const execFileAsync = promisify(execFile);

const REPO_ROOT = "/home/taewoong/company-project/squadall";
const BASE_URL = process.env.SQUADRAIL_BASE_URL ?? "http://127.0.0.1:3101";
const COMPANY_NAME = process.env.SQUADRAIL_COMPANY_NAME ?? "cloud-swiftsight";
const ORG_SYNC_TIMEOUT_MS = Number(process.env.SWIFTSIGHT_RAG_ORG_SYNC_TIMEOUT_MS ?? 5 * 60 * 1000);
const KNOWLEDGE_SYNC_TIMEOUT_MS = Number(process.env.SWIFTSIGHT_RAG_KNOWLEDGE_SYNC_TIMEOUT_MS ?? 45 * 60 * 1000);
const POLL_INTERVAL_MS = Number(process.env.SWIFTSIGHT_RAG_POLL_INTERVAL_MS ?? 10_000);
const RAG_SCENARIO_KEY = process.env.SWIFTSIGHT_RAG_SCENARIO ?? "swiftsight-agent-tl-qa-loop";

const SCENARIO_CONFIG = {
  "swiftsight-agent-tl-qa-loop": {
    pinnedPaths: [
      "internal/storage/path.go",
      "internal/storage/path_test.go",
    ],
    reviewScope: "reviewer",
    expectedProject: "swiftsight-agent",
  },
  "swiftsight-cloud-pm-qa-lead-loop": {
    pinnedPaths: [
      "internal/observability/tracing.go",
      "internal/observability/tracing_test.go",
    ],
    reviewScope: "reviewer",
    expectedProject: "swiftsight-cloud",
  },
};

function note(message = "") {
  process.stdout.write(`${message}\n`);
}

function section(title) {
  note("");
  note("=".repeat(96));
  note(title);
  note("=".repeat(96));
}

async function api(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(
      `API ${options.method ?? "GET"} ${pathname} failed with ${response.status}: ${
        typeof body === "string" ? body : JSON.stringify(body)
      }`,
    );
  }
  return body;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runNodeScript(scriptPath, extraEnv = {}) {
  const result = await execFileAsync("node", [scriptPath], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      SQUADRAIL_BASE_URL: BASE_URL,
      ...extraEnv,
    },
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    summary: extractJsonTail(result.stdout),
  };
}

async function resolveCompany() {
  const companies = await api("/api/companies");
  const company = companies.find((entry) => entry.name === COMPANY_NAME);
  assert(company, `Company not found: ${COMPANY_NAME}`);
  return company;
}

async function ensureOrgSync(companyId) {
  section("Ensure Org Sync");
  const startedAt = Date.now();
  let orgSync = await api(`/api/companies/${companyId}/org-sync`);
  note(`status=${orgSync.status} canonical=${orgSync.canonicalAgentCount} live=${orgSync.liveAgentCount}`);
  if (orgSync.status === "in_sync") return orgSync;

  note("repairing live org to canonical 18-agent template");
  await api(`/api/companies/${companyId}/org-sync/repair`, {
    method: "POST",
    body: {
      createMissing: true,
      adoptLegacySingleEngineers: true,
      repairMismatches: true,
      pauseLegacyExtras: true,
    },
  });

  while (Date.now() - startedAt < ORG_SYNC_TIMEOUT_MS) {
    await sleep(2_000);
    orgSync = await api(`/api/companies/${companyId}/org-sync`);
    note(`repair poll status=${orgSync.status} missing=${orgSync.missingAgents.length} extra=${orgSync.extraAgents.length}`);
    if (orgSync.status === "in_sync") {
      return orgSync;
    }
  }
  throw new Error("Org sync repair did not converge to in_sync");
}

async function pollKnowledgeJob(companyId, jobId) {
  const startedAt = Date.now();
  let lastPrinted = "";
  while (Date.now() - startedAt < KNOWLEDGE_SYNC_TIMEOUT_MS) {
    const job = await api(`/api/companies/${companyId}/knowledge-sync/${jobId}`);
    const progress = JSON.stringify({
      status: job.status,
      projectRuns: job.projectRuns.map((run) => ({
        projectId: run.projectId,
        status: run.status,
        error: run.error,
      })),
    });
    if (progress !== lastPrinted) {
      note(`knowledge-sync=${progress}`);
      lastPrinted = progress;
    }
    if (job.status === "completed") return job;
    if (job.status === "failed") {
      throw new Error(`Knowledge sync job failed: ${job.error ?? "unknown error"}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Knowledge sync job ${jobId} timed out`);
}

async function ensureKnowledgeReady(companyId) {
  section("Ensure Knowledge Setup");
  const startedAt = Date.now();
  while (Date.now() - startedAt < KNOWLEDGE_SYNC_TIMEOUT_MS) {
    const setup = await api(`/api/companies/${companyId}/knowledge-setup`);
    if (isKnowledgeSetupReady(setup)) {
      note(`knowledge-ready projects=${setup.projects.length}`);
      return setup;
    }

    if (setup.activeJobCount > 0 && setup.latestJob) {
      note(`reusing active knowledge sync job ${setup.latestJob.id}`);
      await pollKnowledgeJob(companyId, setup.latestJob.id);
      continue;
    }

    const projectIds = collectNonReadyProjectIds(setup);
    if (projectIds.length === 0) {
      note("all projects are ready after setup refresh");
      return setup;
    }

    note(`starting knowledge sync for ${projectIds.length} projects`);
    const job = await api(`/api/companies/${companyId}/knowledge-sync`, {
      method: "POST",
      body: {
        projectIds,
        forceFull: false,
        rebuildGraph: true,
        rebuildVersions: true,
        backfillPersonalization: true,
      },
    });
    await pollKnowledgeJob(companyId, job.id);
  }
  throw new Error("Knowledge setup did not become ready within timeout");
}

async function fetchBriefs(issueId) {
  return api(`/api/issues/${issueId}/protocol/briefs`);
}

async function fetchKnowledgeQuality(companyId) {
  return api(`/api/knowledge/quality?companyId=${companyId}&days=14&limit=2000`);
}

async function recordOperatorPin(issueId, retrievalRunId, pinnedPaths) {
  return api(`/api/issues/${issueId}/retrieval-feedback`, {
    method: "POST",
    body: {
      retrievalRunId,
      feedbackType: "operator_pin",
      targetType: "path",
      targetIds: pinnedPaths,
      noteBody: "Real-org RAG follow-up E2E pinned implementation paths for the next issue.",
    },
  });
}

async function markMerged(issueId) {
  return api(`/api/issues/${issueId}/merge-candidate/actions`, {
    method: "POST",
    body: {
      actionType: "mark_merged",
      noteBody: "Real-org RAG follow-up E2E marked the candidate as merged to feed retrieval profiles.",
    },
  });
}

async function runScenarioOnce(input) {
  const result = await runNodeScript("scripts/e2e/cloud-swiftsight-real-org.mjs", {
    SWIFTSIGHT_E2E_SCENARIO: input.scenarioKey,
    SWIFTSIGHT_E2E_PRE_CLEANUP: input.preCleanup ? "1" : "0",
    SWIFTSIGHT_E2E_HIDE_COMPLETED: "0",
  });
  const summary = Array.isArray(result.summary) ? result.summary : null;
  assert(summary && summary.length === 1, `Unexpected scenario summary: ${result.stdout}`);
  return summary[0];
}

async function inspectScenarioIssue(issueId, reviewScope) {
  const briefs = await fetchBriefs(issueId);
  const latestReviewBrief = findLatestBriefByScope(briefs, reviewScope);
  assert(latestReviewBrief, `Missing ${reviewScope} brief for issue ${issueId}`);
  return {
    latestReviewBrief,
    reviewQuality: summarizeBriefQuality(latestReviewBrief),
  };
}

async function main() {
  section("Resolve Company");
  const company = await resolveCompany();
  note(`company=${company.name} (${company.id})`);

  const scenarioConfig = SCENARIO_CONFIG[RAG_SCENARIO_KEY];
  assert(scenarioConfig, `Unsupported RAG scenario: ${RAG_SCENARIO_KEY}`);

  await ensureOrgSync(company.id);
  const setup = await ensureKnowledgeReady(company.id);
  const targetProject = setup.projects.find((project) => project.projectName === scenarioConfig.expectedProject);
  assert(targetProject, `Missing target project in knowledge setup: ${scenarioConfig.expectedProject}`);
  note(`targetProject=${targetProject.projectName} revision=${targetProject.knowledge.revision}`);

  section("Seed Issue");
  const seedRun = await runScenarioOnce({
    scenarioKey: RAG_SCENARIO_KEY,
    preCleanup: true,
  });
  note(`seed issue=${seedRun.identifier} (${seedRun.issueId})`);
  const seedInspect = await inspectScenarioIssue(seedRun.issueId, scenarioConfig.reviewScope);
  note(`seed review quality=${JSON.stringify(seedInspect.reviewQuality)}`);
  assert(
    seedInspect.reviewQuality.reviewHitCount > 0 || seedInspect.reviewQuality.codeHitCount > 0,
    "Seed reviewer brief still lacks concrete review/code evidence",
  );
  assert(
    !seedInspect.reviewQuality.hitSourceTypes.every((sourceType) => sourceType === "issue"),
    "Seed reviewer brief is still dominated entirely by issue snapshots",
  );

  assert(seedInspect.reviewQuality.retrievalRunId, "Seed reviewer brief is missing retrievalRunId");
  await recordOperatorPin(seedRun.issueId, seedInspect.reviewQuality.retrievalRunId, scenarioConfig.pinnedPaths);
  note(`operator pin recorded for ${scenarioConfig.pinnedPaths.join(", ")}`);

  await markMerged(seedRun.issueId);
  note("merge candidate marked as merged for retrieval feedback");

  section("Follow-up Issue");
  const followUpRun = await runScenarioOnce({
    scenarioKey: RAG_SCENARIO_KEY,
    preCleanup: false,
  });
  note(`follow-up issue=${followUpRun.identifier} (${followUpRun.issueId})`);
  const followInspect = await inspectScenarioIssue(followUpRun.issueId, scenarioConfig.reviewScope);
  note(`follow-up review quality=${JSON.stringify(followInspect.reviewQuality)}`);

  assert(followInspect.reviewQuality.graphHitCount > 0, "Follow-up reviewer brief did not produce graph hits");
  assert(
    followInspect.reviewQuality.personalizationApplied || followInspect.reviewQuality.personalizedHitCount > 0,
    "Follow-up reviewer brief did not apply retrieval personalization",
  );
  assert(
    followInspect.reviewQuality.reviewHitCount > 0 || followInspect.reviewQuality.codeHitCount > 0,
    "Follow-up reviewer brief still lacks concrete review/code evidence",
  );
  assert(
    !followInspect.reviewQuality.hitSourceTypes.every((sourceType) => sourceType === "issue"),
    "Follow-up reviewer brief is still dominated entirely by issue snapshots",
  );
  assert(
    followInspect.reviewQuality.hitPaths.some((hitPath) => scenarioConfig.pinnedPaths.includes(hitPath)),
    "Follow-up reviewer brief did not surface pinned implementation paths",
  );

  section("Replay Issue");
  const replayRun = await runScenarioOnce({
    scenarioKey: RAG_SCENARIO_KEY,
    preCleanup: false,
  });
  note(`replay issue=${replayRun.identifier} (${replayRun.issueId})`);
  const replayInspect = await inspectScenarioIssue(replayRun.issueId, scenarioConfig.reviewScope);
  note(`replay review quality=${JSON.stringify(replayInspect.reviewQuality)}`);

  assert(
    replayInspect.reviewQuality.candidateCacheHit || replayInspect.reviewQuality.finalCacheHit,
    "Replay reviewer brief did not hit retrieval caches",
  );

  const quality = await fetchKnowledgeQuality(company.id);
  assert(quality.candidateCacheHitRate > 0 || quality.finalCacheHitRate > 0, "Knowledge quality did not record cache hit rates");

  section("Summary");
  note(JSON.stringify({
    ok: true,
    companyId: company.id,
    scenarioKey: RAG_SCENARIO_KEY,
    knowledgeRevision: targetProject.knowledge.revision,
    seed: {
      issueId: seedRun.issueId,
      identifier: seedRun.identifier,
      reviewQuality: seedInspect.reviewQuality,
    },
    followUp: {
      issueId: followUpRun.issueId,
      identifier: followUpRun.identifier,
      reviewQuality: followInspect.reviewQuality,
    },
    replay: {
      issueId: replayRun.issueId,
      identifier: replayRun.identifier,
      reviewQuality: replayInspect.reviewQuality,
    },
    quality: {
      candidateCacheHitRate: quality.candidateCacheHitRate,
      finalCacheHitRate: quality.finalCacheHitRate,
      averageGraphHitCount: quality.averageGraphHitCount,
      multiHopGraphExpandedRuns: quality.multiHopGraphExpandedRuns,
    },
  }, null, 2));
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
