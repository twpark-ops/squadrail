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
const BASE_URL = process.env.SQUADRAIL_BASE_URL ?? "http://127.0.0.1:3101";
const BASELINE_ARTIFACT_PATH = process.env.SWIFTSIGHT_SUMMARY_PROOF_BASELINE_PATH
  ?? path.join(REPO_ROOT, "scripts", "e2e", "cloud-swiftsight-domain-aware-pm-baseline.json");
const INCLUDE_RAG_READINESS = process.env.SWIFTSIGHT_SUMMARY_PROOF_INCLUDE_RAG_READINESS !== "0";
const PREPARE_FIXTURE = process.env.SWIFTSIGHT_SUMMARY_PROOF_PREPARE_FIXTURE !== "0";
const PREPARE_FORCE_FULL = process.env.SWIFTSIGHT_SUMMARY_PROOF_FORCE_FULL !== "0";
const PREPARE_MAX_FILES = Number.parseInt(process.env.SWIFTSIGHT_SUMMARY_PROOF_MAX_FILES ?? "80", 10);
const COMPANY_NAME = process.env.SQUADRAIL_COMPANY_NAME ?? "cloud-swiftsight-summary-eval";
const PROOF_MODE = INCLUDE_RAG_READINESS ? "full" : "domain_only";

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

async function resolveCompanyByName(name) {
  const companies = await api("/api/companies");
  const normalized = name.trim().toLowerCase();
  const match = companies.find((company) => {
    const companyName = typeof company.name === "string" ? company.name.toLowerCase() : "";
    const slug = typeof company.slug === "string" ? company.slug.toLowerCase() : "";
    return companyName === normalized || slug === normalized;
  });
  if (!match) {
    throw new Error(`Company not found: ${name}`);
  }
  return match;
}

async function listCompanyProjects(companyId) {
  return api(`/api/companies/${companyId}/projects`);
}

async function listCompanyIssues(companyId) {
  return api(`/api/companies/${companyId}/issues`);
}

async function listHeartbeatRuns(companyId) {
  return api(`/api/companies/${companyId}/heartbeat-runs?limit=200`);
}

async function cancelHeartbeatRun(runId) {
  return api(`/api/heartbeat-runs/${runId}/cancel`, {
    method: "POST",
  });
}

async function listKnowledgeDocumentsBySourceType(companyId, projectId, sourceType) {
  return api(
    `/api/knowledge/documents?companyId=${encodeURIComponent(companyId)}&projectId=${encodeURIComponent(projectId)}&sourceType=${encodeURIComponent(sourceType)}&limit=500`,
  );
}

async function importProjectWorkspace(projectId) {
  return api(`/api/knowledge/projects/${projectId}/import-workspace`, {
    method: "POST",
    body: {
      forceFull: PREPARE_FORCE_FULL,
      maxFiles: PREPARE_MAX_FILES,
    },
  });
}

async function prepareSummaryFixture(company) {
  const projects = await listCompanyProjects(company.id);
  const refreshedProjects = [];

  for (const project of projects) {
    if (!project?.id) continue;
    const importResult = await importProjectWorkspace(project.id);
    const [codeSummaries, symbolSummaries] = await Promise.all([
      listKnowledgeDocumentsBySourceType(company.id, project.id, "code_summary"),
      listKnowledgeDocumentsBySourceType(company.id, project.id, "symbol_summary"),
    ]);
    refreshedProjects.push({
      projectId: project.id,
      projectName: project.name ?? null,
      importedFiles: importResult?.importedFiles ?? 0,
      codeSummaryCount: Array.isArray(codeSummaries) ? codeSummaries.length : 0,
      symbolSummaryCount: Array.isArray(symbolSummaries) ? symbolSummaries.length : 0,
    });
  }

  return {
    companyId: company.id,
    companyName: company.name,
    projectCount: refreshedProjects.length,
    refreshedProjects,
  };
}

function collectVisibleIssueIds(issues) {
  return new Set(
    (Array.isArray(issues) ? issues : [])
      .filter((issue) => !issue?.parentId)
      .map((issue) => issue?.id)
      .filter((issueId) => typeof issueId === "string" && issueId.length > 0),
  );
}

function collectIssueIds(issues) {
  return new Set(
    (Array.isArray(issues) ? issues : [])
      .map((issue) => issue?.id)
      .filter((issueId) => typeof issueId === "string" && issueId.length > 0),
  );
}

async function verifyPostRunCleanup(companyId, visibleIssueIdsBefore) {
  const [issues, heartbeatRuns] = await Promise.all([
    listCompanyIssues(companyId),
    listHeartbeatRuns(companyId),
  ]);
  const terminalStatuses = new Set(["cancelled", "done"]);
  const visibleNewIssues = (Array.isArray(issues) ? issues : [])
    .filter((issue) => !issue?.parentId)
    .filter((issue) => !visibleIssueIdsBefore.has(issue?.id))
    .filter((issue) => !terminalStatuses.has(issue?.status));
  const activeRuns = (Array.isArray(heartbeatRuns) ? heartbeatRuns : [])
    .filter((run) => ["queued", "claimed", "running"].includes(run?.status));

  return {
    visibleNewIssueCount: visibleNewIssues.length,
    visibleNewIssues: visibleNewIssues.map((issue) => ({
      id: issue.id,
      identifier: issue.identifier ?? null,
      title: issue.title ?? null,
      status: issue.status ?? null,
    })),
    activeRunCount: activeRuns.length,
    activeRuns: activeRuns.map((run) => ({
      id: run.id,
      status: run.status,
      issueId: run?.contextSnapshot?.issueId ?? null,
    })),
  };
}

function collectCleanupIssueIds(currentResults) {
  const record = currentResults && typeof currentResults === "object" ? currentResults : {};
  const scenarioDetails = Array.isArray(record.scenarioDetails) ? record.scenarioDetails : [];
  const ids = new Set();

  for (const entry of scenarioDetails) {
    if (typeof entry?.issueId === "string" && entry.issueId.length > 0) {
      ids.add(entry.issueId);
    }
    const cleanupTouched = Array.isArray(entry?.cleanup?.touched) ? entry.cleanup.touched : [];
    for (const touched of cleanupTouched) {
      if (typeof touched?.issueId === "string" && touched.issueId.length > 0) {
        ids.add(touched.issueId);
      }
    }
    const childResults = Array.isArray(entry?.delivery?.childResults) ? entry.delivery.childResults : [];
    for (const child of childResults) {
      if (typeof child?.issueId === "string" && child.issueId.length > 0) {
        ids.add(child.issueId);
      }
    }
  }

  return ids;
}

async function cancelLingeringRuns(companyId, issueIds) {
  const cancelledRunIds = new Set();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const runs = await listHeartbeatRuns(companyId);
    const activeRuns = (Array.isArray(runs) ? runs : [])
      .filter((run) => ["queued", "claimed", "running"].includes(run?.status))
      .filter((run) => {
        const issueId = run?.contextSnapshot?.issueId ?? null;
        return typeof issueId === "string" && issueIds.has(issueId);
      });

    if (activeRuns.length === 0) {
      return {
        cancelledRunCount: cancelledRunIds.size,
        cancelledRunIds: [...cancelledRunIds],
      };
    }

    for (const run of activeRuns) {
      if (!run?.id) continue;
      await cancelHeartbeatRun(run.id).catch(() => null);
      cancelledRunIds.add(run.id);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return {
    cancelledRunCount: cancelledRunIds.size,
    cancelledRunIds: [...cancelledRunIds],
  };
}

async function runDomainAwarePmBurnIn() {
  const { stdout, stderr } = await execFileAsync("node", ["scripts/e2e/cloud-swiftsight-domain-aware-pm-burn-in.mjs"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      SQUADRAIL_BASE_URL: BASE_URL,
      SQUADRAIL_COMPANY_NAME: COMPANY_NAME,
      SWIFTSIGHT_PM_EVAL_CLEANUP: "1",
    },
    maxBuffer: 16 * 1024 * 1024,
  });
  process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
  return extractJsonTail(stdout);
}

async function runRagReadiness() {
  // RAG readiness runs against the main org (code repos + review history),
  // not the summary-eval org which is PM-projection-only.
  const RAG_COMPANY = process.env.SWIFTSIGHT_RAG_READINESS_COMPANY ?? "cloud-swiftsight";
  const { stdout, stderr } = await execFileAsync("node", ["scripts/e2e/cloud-swiftsight-rag-readiness.mjs"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      SQUADRAIL_BASE_URL: BASE_URL,
      SQUADRAIL_COMPANY_NAME: RAG_COMPANY,
    },
    maxBuffer: 16 * 1024 * 1024,
  });
  process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
  return extractJsonTail(stdout);
}

async function runRealOrgCleanup(companyName = COMPANY_NAME) {
  const { stdout, stderr } = await execFileAsync("node", ["scripts/e2e/cloud-swiftsight-real-org-cleanup.mjs"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      SQUADRAIL_BASE_URL: BASE_URL,
      SQUADRAIL_COMPANY_NAME: companyName,
      SWIFTSIGHT_E2E_HIDE_COMPLETED: "1",
    },
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
  note(`proofMode=${PROOF_MODE}`);
  note(`targetCompany=${COMPANY_NAME}`);
  note(`targetBaseUrl=${BASE_URL}`);

  section("Resolve Summary Fixture");
  const company = await resolveCompanyByName(COMPANY_NAME);
  note(`companyId=${company.id}`);
  note(`companyName=${company.name}`);

  if (PREPARE_FIXTURE) {
    section("Prepare Summary Fixture");
    const prepared = await prepareSummaryFixture(company);
    note(`preparedProjectCount=${prepared.projectCount}`);
    for (const project of prepared.refreshedProjects) {
      note(
        `prepared ${project.projectName ?? project.projectId}: importedFiles=${project.importedFiles} codeSummaryCount=${project.codeSummaryCount} symbolSummaryCount=${project.symbolSummaryCount}`,
      );
    }
  }

  const issuesBefore = await listCompanyIssues(company.id);
  const visibleIssueIdsBefore = collectVisibleIssueIds(issuesBefore);

  section("Run Current Domain-Aware PM Burn-In");
  const currentResults = await runDomainAwarePmBurnIn();
  const comparison = compareDomainAwareProofRuns({
    baseline: baselineArtifact,
    current: currentResults,
  });
  note(`improvedScenarioCount=${comparison.summary.improvedScenarioCount}`);
  note(`regressedScenarioCount=${comparison.summary.regressedScenarioCount}`);
  note(`changedProjectSelectionCount=${comparison.summary.changedProjectSelectionCount}`);

  section("Cancel Lingering Domain-Aware Runs");
  const cleanupIssueIds = collectCleanupIssueIds(currentResults);
  const cleanupRunSweep = await cancelLingeringRuns(company.id, cleanupIssueIds);
  note(`cleanupIssueCount=${cleanupIssueIds.size}`);
  note(`cancelledRunCount=${cleanupRunSweep.cancelledRunCount}`);

  section("Verify Domain-Aware Cleanup");
  const cleanupSummary = await verifyPostRunCleanup(company.id, visibleIssueIdsBefore);
  note(`visibleNewIssueCount=${cleanupSummary.visibleNewIssueCount}`);
  note(`activeRunCount=${cleanupSummary.activeRunCount}`);

  let ragReadinessSummary = null;
  let ragCleanupSummary = null;
  let ragReadinessError = null;
  let ragCleanupRunSweep = null;
  let ragIssueIds = new Set();
  if (INCLUDE_RAG_READINESS) {
    // RAG readiness uses the main org (code repos + review history).
    const RAG_COMPANY_NAME = process.env.SWIFTSIGHT_RAG_READINESS_COMPANY ?? "cloud-swiftsight";
    const ragCompany = await resolveCompanyByName(RAG_COMPANY_NAME);
    const issuesBeforeRag = await listCompanyIssues(ragCompany.id);
    const issueIdsBeforeRag = collectIssueIds(issuesBeforeRag);
    try {
      section("Run Rag Readiness Gate");
      const readiness = await runRagReadiness();
      ragReadinessSummary = summarizeKnowledgeQualityGate(readiness);
      note(`ragReadinessStatus=${ragReadinessSummary.status ?? "unknown"}`);
      note(`ragFunctionalStatus=${ragReadinessSummary.functionalStatus ?? "unknown"}`);
    } catch (error) {
      ragReadinessError = error instanceof Error ? error : new Error(String(error));
      note(`ragReadinessError=${ragReadinessError.message}`);
    } finally {
      const issuesAfterRag = await listCompanyIssues(ragCompany.id).catch(() => []);
      ragIssueIds = new Set(
        [...collectIssueIds(issuesAfterRag)].filter((issueId) => !issueIdsBeforeRag.has(issueId)),
      );

      section("Cleanup Rag Readiness Issues");
      ragCleanupSummary = await runRealOrgCleanup(RAG_COMPANY_NAME);
      note(`ragCleanupCancelled=${ragCleanupSummary?.cancelled ?? 0}`);
      note(`ragCleanupHidden=${ragCleanupSummary?.hidden ?? 0}`);
      note(`ragCleanupRunsCancelled=${ragCleanupSummary?.runsCancelled ?? 0}`);

      section("Cancel Lingering Rag Readiness Runs");
      const allCleanupIssueIds = new Set([...cleanupIssueIds, ...ragIssueIds]);
      ragCleanupRunSweep = await cancelLingeringRuns(ragCompany.id, allCleanupIssueIds);
      note(`ragCleanupIssueCount=${allCleanupIssueIds.size}`);
      note(`ragCancelledRunCount=${ragCleanupRunSweep.cancelledRunCount}`);
    }
  }

  section("Verify Final Cleanup");
  const finalCleanupSummary = await verifyPostRunCleanup(company.id, visibleIssueIdsBefore);
  note(`finalVisibleNewIssueCount=${finalCleanupSummary.visibleNewIssueCount}`);
  note(`finalActiveRunCount=${finalCleanupSummary.activeRunCount}`);

  note(
    JSON.stringify(
      {
        version: 1,
        baseline: baselineArtifact,
        current: normalizeDomainAwareProofResultSet(currentResults),
        comparison,
        cleanupRunSweep,
        cleanupSummary,
        finalCleanupSummary,
        ragReadinessSummary,
        ragCleanupSummary,
        ragCleanupRunSweep,
        ragIssueIds: [...ragIssueIds],
      },
      null,
      2,
    ),
  );

  if (finalCleanupSummary.visibleNewIssueCount > 0 || finalCleanupSummary.activeRunCount > 0) {
    throw new Error("Summary proof cleanup verification failed");
  }
  if (ragReadinessError) {
    throw ragReadinessError;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
