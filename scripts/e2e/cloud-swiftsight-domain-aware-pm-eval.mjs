#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { extractJsonTail } from "./rag-readiness-utils.mjs";
import {
  evaluateDomainAwarePmPreview,
  listDomainAwarePmScenarioKeys,
  resolveDomainAwarePmScenario,
} from "./domain-aware-pm-scenarios.mjs";

const execFileAsync = promisify(execFile);

const BASE_URL = process.env.SQUADRAIL_BASE_URL ?? "http://127.0.0.1:3101";
const COMPANY_NAME = process.env.SQUADRAIL_COMPANY_NAME ?? "cloud-swiftsight";
const SCENARIO_KEY = process.env.SWIFTSIGHT_PM_EVAL_SCENARIO ?? "pacs_delivery_audit_evidence";
const PRIORITY = process.env.SWIFTSIGHT_PM_EVAL_PRIORITY ?? "high";
const EXECUTE_DELIVERY = process.env.SWIFTSIGHT_PM_EVAL_EXECUTE !== "0";
const CLEANUP_AFTER_RUN = process.env.SWIFTSIGHT_PM_EVAL_CLEANUP === "1";
const CLEANUP_ACTOR_ID = process.env.SWIFTSIGHT_PM_EVAL_CLEANUP_ACTOR_ID ?? "summary-proof-cleanup";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROTOCOL_HELPER_PATH = process.env.SQUADRAIL_PROTOCOL_HELPER_PATH
  ?? path.join(REPO_ROOT, "scripts", "runtime", "squadrail-protocol.mjs");
const AUTONOMY_HARNESS_PATH = path.join(REPO_ROOT, "scripts", "e2e", "cloud-swiftsight-autonomy-org.mjs");

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

async function getIssue(issueId) {
  return api(`/api/issues/${issueId}`);
}

async function getProtocolState(issueId) {
  return api(`/api/issues/${issueId}/protocol/state`);
}

async function archiveIssue(issueId) {
  return api(`/api/issues/${issueId}`, {
    method: "PATCH",
    body: {
      status: "cancelled",
    },
  });
}

async function cancelIssue(issueId, workflowStateBefore, reason) {
  return api(`/api/issues/${issueId}/protocol/messages`, {
    method: "POST",
    body: {
      messageType: "CANCEL_TASK",
      sender: {
        actorType: "user",
        actorId: CLEANUP_ACTOR_ID,
        role: "human_board",
      },
      recipients: [
        {
          recipientType: "role_group",
          recipientId: "human_board",
          role: "human_board",
        },
      ],
      workflowStateBefore,
      workflowStateAfter: "cancelled",
      summary: "Cancel summary proof evaluation issue during cleanup",
      requiresAck: false,
      payload: {
        reason,
        cancelType: "duplicate",
      },
      artifacts: [],
    },
  });
}

function needsCancellation(workflowState) {
  return workflowState !== "done" && workflowState !== "cancelled";
}

async function cleanupEvaluationIssues(input) {
  const touched = [];
  const cleanupIssue = async (issueId, reason) => {
    const issue = await getIssue(issueId).catch(() => null);
    if (!issue) return null;

    const protocolState = await getProtocolState(issueId).catch(() => null);
    const workflowState = protocolState?.workflowState ?? null;
    let cancelled = false;
    if (workflowState && needsCancellation(workflowState)) {
      await cancelIssue(issueId, workflowState, reason);
      cancelled = true;
    }
    await archiveIssue(issueId);
    return {
      issueId,
      identifier: issue.identifier ?? null,
      workflowStateBefore: workflowState,
      cancelled,
      archived: true,
    };
  };

  const rootCleanup = await cleanupIssue(
    input.rootIssueId,
    `Cleanup summary proof root issue ${input.rootIssueIdentifier ?? input.rootIssueId}.`,
  );
  if (rootCleanup) touched.push(rootCleanup);

  for (const child of input.childResults) {
    const cleaned = await cleanupIssue(
      child.issueId,
      `Cleanup summary proof child issue ${child.identifier ?? child.issueId}.`,
    );
    if (cleaned) touched.push(cleaned);
  }

  return {
    enabled: true,
    touchedCount: touched.length,
    cancelledCount: touched.filter((entry) => entry.cancelled).length,
    touched,
  };
}

async function resolveCompanyByName(name) {
  const companies = await api("/api/companies");
  const normalized = name.trim().toLowerCase();
  const match = companies.find((company) => {
    const companyName = typeof company.name === "string" ? company.name.toLowerCase() : "";
    const slug = typeof company.slug === "string" ? company.slug.toLowerCase() : "";
    return companyName === normalized || slug === normalized;
  });
  assert(match, `Company not found for ${name}`);
  return match;
}

function canSupportPmProjection(agent) {
  const title = typeof agent?.title === "string" ? agent.title.toLowerCase() : "";
  const urlKey = typeof agent?.urlKey === "string" ? agent.urlKey.toLowerCase() : "";
  if (agent?.role === "pm") return true;
  if (agent?.role === "reviewer") return true;
  if (agent?.role === "manager" || agent?.role === "tech_lead") return true;
  if (title.includes("tech lead")) return true;
  if (title.includes("reviewer")) return true;
  return /(?:^|-)(tl|tech-lead|reviewer)(?:-|$)/.test(urlKey);
}

async function ensurePmProjectionAgentsReady(companyId) {
  const agents = await api(`/api/companies/${companyId}/agents`);
  const resumableStatuses = new Set(["paused", "error"]);
  const resumed = [];
  for (const agent of agents) {
    if (!canSupportPmProjection(agent)) continue;
    if (!resumableStatuses.has(agent.status)) continue;
    await api(`/api/agents/${agent.id}/resume`, { method: "POST" });
    resumed.push({
      id: agent.id,
      name: agent.name ?? null,
      title: agent.title ?? null,
      previousStatus: agent.status,
    });
  }
  return resumed;
}

async function createPmIntakeIssue(companyId, scenario) {
  const created = await api(`/api/companies/${companyId}/intake/issues`, {
    method: "POST",
    body: {
      request: scenario.request,
      priority: PRIORITY,
      requiredKnowledgeTags: scenario.requiredKnowledgeTags,
    },
  });
  return created.issue ?? created;
}

async function previewProjection(issueId, scenario) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await api(`/api/issues/${issueId}/intake/projection-preview`, {
        method: "POST",
        body: {
          coordinationOnly: false,
          requiredKnowledgeTags: scenario.requiredKnowledgeTags,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Issue not found") || attempt === 4) {
        throw error;
      }
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError ?? new Error(`Projection preview did not become available for issue ${issueId}`);
}

async function listProjectsViaHelper(companyId) {
  const { stdout } = await execFileAsync("node", [PROTOCOL_HELPER_PATH, "list-projects"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      SQUADRAIL_API_URL: BASE_URL,
      SQUADRAIL_COMPANY_ID: companyId,
    },
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim();
}

async function executeBoundedDelivery(companyId, issueId, preview, scenario) {
  const clarificationMode = scenario.clarificationMode ?? "human_board";
  const autonomyVariant = clarificationMode === "reviewer"
    ? "reviewer_clarification_policy"
    : "baseline";
  const { stdout, stderr } = await execFileAsync("node", [AUTONOMY_HARNESS_PATH], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      SQUADRAIL_BASE_URL: BASE_URL,
      SQUADRAIL_COMPANY_NAME: COMPANY_NAME,
      SQUADRAIL_COMPANY_ID: companyId,
      SWIFTSIGHT_AUTONOMY_VARIANT: autonomyVariant,
      SWIFTSIGHT_AUTONOMY_CLARIFICATION_MODE: clarificationMode,
      SWIFTSIGHT_AUTONOMY_EXISTING_ROOT_ISSUE_ID: issueId,
      SWIFTSIGHT_AUTONOMY_PREVIEW_JSON: JSON.stringify(preview),
      SWIFTSIGHT_AUTONOMY_PROJECT: preview.selectedProjectId ?? preview.selectedProjectName ?? "",
    },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (stderr.trim()) {
    process.stderr.write(stderr);
  }
  process.stdout.write(stdout);
  const summary = extractJsonTail(stdout);
  assert(summary?.ok === true, "Bounded autonomy harness did not return a successful JSON summary");
  return summary;
}

async function fetchRetrievalRunHits(runId) {
  return api(`/api/knowledge/retrieval-runs/${runId}/hits`);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function matchesAnyField(fields, fragment) {
  const normalizedFragment = normalizeText(fragment);
  if (!normalizedFragment) return false;
  return fields.some((field) => normalizeText(field).includes(normalizedFragment));
}

function summarizeRetrievalEvidence(runSummaries, scenario) {
  const hits = runSummaries.flatMap((entry) => Array.isArray(entry?.hits) ? entry.hits : []);
  const expectedPathHints = Array.isArray(scenario.expectedKnowledgePathHints)
    ? scenario.expectedKnowledgePathHints.filter((value) => typeof value === "string" && value.trim().length > 0)
    : [];
  const minimumKnowledgePathMatches = Number.isFinite(scenario.minimumKnowledgePathMatches)
    ? Math.max(0, Number(scenario.minimumKnowledgePathMatches))
    : (expectedPathHints.length > 0 ? 1 : 0);
  const matchedPathHints = expectedPathHints.filter((hint) =>
    hits.some((hit) =>
      matchesAnyField(
        [
          hit?.documentPath,
          hit?.documentTitle,
          hit?.headingPath,
          hit?.symbolName,
          hit?.textContent,
        ],
        hint,
      )),
  );

  return {
    retrievalRunCount: runSummaries.length,
    totalHitCount: hits.length,
    matchedPathHints,
    expectedPathHints,
    minimumKnowledgePathMatches,
    topHitPaths: uniqueStrings(
      hits
        .slice(0, 10)
        .map((hit) => hit?.documentPath ?? null),
    ),
  };
}

function evaluateImplementationOwnership(childResults, scenario) {
  const expectedImplementationOwner = scenario.expectedImplementationOwner ?? null;
  if (!expectedImplementationOwner) {
    return {
      expectedImplementationOwner: null,
      implementationOwnerMatched: true,
    };
  }

  if (expectedImplementationOwner === "engineer_assigned") {
    const matched = childResults.length > 0 && childResults.every((child) => {
      const implementationAssigneeAgentId = typeof child?.implementationAssigneeAgentId === "string"
        ? child.implementationAssigneeAgentId
        : null;
      const finalPrimaryEngineerAgentId = typeof child?.finalPrimaryEngineerAgentId === "string"
        ? child.finalPrimaryEngineerAgentId
        : null;
      const finalTechLeadAgentId = typeof child?.finalTechLeadAgentId === "string"
        ? child.finalTechLeadAgentId
        : null;
      return Boolean(implementationAssigneeAgentId)
        && finalPrimaryEngineerAgentId === implementationAssigneeAgentId
        && finalPrimaryEngineerAgentId !== finalTechLeadAgentId;
    });
    return {
      expectedImplementationOwner,
      implementationOwnerMatched: matched,
    };
  }

  if (expectedImplementationOwner === "tl_direct") {
    const matched = childResults.length > 0 && childResults.every((child) => {
      const finalPrimaryEngineerAgentId = typeof child?.finalPrimaryEngineerAgentId === "string"
        ? child.finalPrimaryEngineerAgentId
        : null;
      const finalTechLeadAgentId = typeof child?.finalTechLeadAgentId === "string"
        ? child.finalTechLeadAgentId
        : null;
      return Boolean(finalPrimaryEngineerAgentId) && finalPrimaryEngineerAgentId === finalTechLeadAgentId;
    });
    return {
      expectedImplementationOwner,
      implementationOwnerMatched: matched,
    };
  }

  return {
    expectedImplementationOwner,
    implementationOwnerMatched: false,
  };
}

export async function evaluateDomainAwarePmDelivery(delivery, scenario, options = {}) {
  if (!delivery) {
    return {
      score: 0,
      maxScore: 8
        + (scenario.expectedImplementationOwner ? 2 : 0)
        + (Array.isArray(scenario.expectedKnowledgePathHints) && scenario.expectedKnowledgePathHints.length > 0 ? 4 : 0),
      checks: {
        projectionApplied: false,
        childDeliveryClosed: false,
        clarificationModeMatched: false,
        clarificationRecorded: false,
        retrievalUsed: false,
        knowledgePathCoverage: false,
        implementationOwnerMatched: false,
      },
      retrievalEvidence: null,
    };
  }

  const childResults = Array.isArray(delivery.childResults) ? delivery.childResults : [];
  const expectedClarificationMode = scenario.clarificationMode ?? "human_board";
  const expectsClarification = expectedClarificationMode !== "none";
  const unexpectedClarification = childResults.some((child) =>
    typeof child?.askMessageId === "string" && child.askMessageId.length > 0,
  );
  const retrievalRunIds = uniqueStrings(
    childResults.flatMap((child) => Array.isArray(child?.retrievalRunIds) ? child.retrievalRunIds : []),
  );
  const retrievalRunFetcher = options.fetchRetrievalRunHits ?? fetchRetrievalRunHits;
  const retrievalRuns = await Promise.all(
    retrievalRunIds.map(async (runId) => {
      try {
        return await retrievalRunFetcher(runId);
      } catch {
        return null;
      }
    }),
  );
  const retrievalEvidence = summarizeRetrievalEvidence(
    retrievalRuns.filter((entry) => entry && Array.isArray(entry.hits)),
    scenario,
  );
  const ownership = evaluateImplementationOwnership(childResults, scenario);
  const checks = {
    projectionApplied: Number(delivery.projectedChildCount ?? 0) > 0,
    childDeliveryClosed: childResults.length > 0 && childResults.every((child) => child?.finalWorkflowState === "done"),
    clarificationModeMatched: expectsClarification
      ? childResults.some((child) => child?.clarificationMode === expectedClarificationMode)
      : childResults.every((child) => (child?.clarificationMode ?? "none") === "none"),
    clarificationRecorded: expectsClarification
      ? childResults.some((child) => typeof child?.askMessageId === "string" && child.askMessageId.length > 0)
      : !unexpectedClarification,
    retrievalUsed: retrievalEvidence.retrievalRunCount > 0 && retrievalEvidence.totalHitCount > 0,
    knowledgePathCoverage:
      retrievalEvidence.expectedPathHints.length === 0
      || retrievalEvidence.matchedPathHints.length >= retrievalEvidence.minimumKnowledgePathMatches,
    implementationOwnerMatched: ownership.implementationOwnerMatched,
  };

  let score = 0;
  if (checks.projectionApplied) score += 2;
  if (checks.childDeliveryClosed) score += 2;
  if (checks.clarificationModeMatched) score += 2;
  if (checks.clarificationRecorded) score += 2;
  if (Array.isArray(scenario.expectedKnowledgePathHints) && scenario.expectedKnowledgePathHints.length > 0) {
    if (checks.retrievalUsed) score += 2;
    if (checks.knowledgePathCoverage) score += 2;
  }
  if (scenario.expectedImplementationOwner) {
    if (checks.implementationOwnerMatched) score += 2;
  }

  return {
    score,
    maxScore: 8
      + (scenario.expectedImplementationOwner ? 2 : 0)
      + (Array.isArray(scenario.expectedKnowledgePathHints) && scenario.expectedKnowledgePathHints.length > 0 ? 4 : 0),
    checks,
    rootWorkflowState: delivery.rootWorkflowState ?? null,
    projectedChildCount: delivery.projectedChildCount ?? 0,
    childResults,
    retrievalEvidence,
  };
}

async function main() {
  const scenario = resolveDomainAwarePmScenario(SCENARIO_KEY);

  section("Domain-Aware PM Scenario");
  note(`company=${COMPANY_NAME}`);
  note(`scenario=${scenario.key}`);
  note(`label=${scenario.label}`);
  note(`supported=${listDomainAwarePmScenarioKeys().join(", ")}`);

  section("Resolve Company");
  const company = await resolveCompanyByName(COMPANY_NAME);
  note(`companyId=${company.id}`);
  note(`companyName=${company.name}`);

  section("Projection Agent Readiness");
  const resumedAgents = await ensurePmProjectionAgentsReady(company.id);
  note(`resumedAgents=${resumedAgents.length}`);
  for (const agent of resumedAgents) {
    note(`- resumed ${agent.name ?? agent.id} (${agent.title ?? "n/a"}) from ${agent.previousStatus}`);
  }

  section("Project Inventory");
  note(await listProjectsViaHelper(company.id));

  section("Create PM Intake Issue");
  const issue = await createPmIntakeIssue(company.id, scenario);
  note(`issueId=${issue.id}`);
  note(`issueIdentifier=${issue.identifier ?? "n/a"}`);
  note(`issueTitle=${issue.title}`);

  section("Preview Projection");
  const preview = await previewProjection(issue.id, scenario);
  note(`selectedProject=${preview.selectedProjectName ?? "n/a"}`);
  note(`warnings=${Array.isArray(preview.warnings) ? preview.warnings.join(", ") || "none" : "none"}`);

  section("Evaluate Preview");
  const previewEvaluation = evaluateDomainAwarePmPreview(preview, scenario);
  note(`score=${previewEvaluation.score}/${previewEvaluation.maxScore}`);
  note(`selectedPrimaryProject=${previewEvaluation.checks.selectedPrimaryProject}`);
  note(`topProjectCoverage=${previewEvaluation.checks.topProjectCoverage}`);
  note(`workItemPresent=${previewEvaluation.checks.workItemPresent}`);
  note(`acceptanceCriteriaSufficient=${previewEvaluation.checks.acceptanceCriteriaSufficient}`);
  note(`definitionOfDoneSufficient=${previewEvaluation.checks.definitionOfDoneSufficient}`);
  note(`projectConfidenceWarning=${previewEvaluation.checks.projectConfidenceWarning}`);

  let delivery = null;
  let deliveryEvaluation = null;
  if (EXECUTE_DELIVERY) {
    section("Execute Bounded Delivery");
    delivery = await executeBoundedDelivery(company.id, issue.id, preview, scenario);
    deliveryEvaluation = await evaluateDomainAwarePmDelivery(delivery, scenario);
    note(`deliveryScore=${deliveryEvaluation.score}/${deliveryEvaluation.maxScore}`);
    note(`projectionApplied=${deliveryEvaluation.checks.projectionApplied}`);
    note(`childDeliveryClosed=${deliveryEvaluation.checks.childDeliveryClosed}`);
    note(`clarificationModeMatched=${deliveryEvaluation.checks.clarificationModeMatched}`);
    note(`clarificationRecorded=${deliveryEvaluation.checks.clarificationRecorded}`);
    note(`retrievalUsed=${deliveryEvaluation.checks.retrievalUsed}`);
    note(`knowledgePathCoverage=${deliveryEvaluation.checks.knowledgePathCoverage}`);
    note(`implementationOwnerMatched=${deliveryEvaluation.checks.implementationOwnerMatched}`);
  } else {
    deliveryEvaluation = await evaluateDomainAwarePmDelivery(null, scenario);
  }

  const overallScore = previewEvaluation.score + deliveryEvaluation.score;
  const overallMaxScore = previewEvaluation.maxScore + deliveryEvaluation.maxScore;

  section("Manual Review Checklist");
  for (const item of scenario.manualReviewChecklist) {
    note(`- ${item}`);
  }
  note(`overallScore=${overallScore}/${overallMaxScore}`);

  let cleanup = null;
  if (CLEANUP_AFTER_RUN) {
    section("Cleanup Evaluation Issues");
    cleanup = await cleanupEvaluationIssues({
      rootIssueId: issue.id,
      rootIssueIdentifier: issue.identifier ?? null,
      childResults: Array.isArray(delivery?.childResults) ? delivery.childResults : [],
    });
    note(`cleanupTouched=${cleanup.touchedCount}`);
    note(`cleanupCancelled=${cleanup.cancelledCount}`);
  }

  note(
    JSON.stringify(
      {
        companyId: company.id,
        companyName: company.name,
        scenario: {
          key: scenario.key,
          label: scenario.label,
          expectedPrimaryProjects: scenario.expectedPrimaryProjects,
          expectedTopProjects: scenario.expectedTopProjects,
        },
        issue: {
          id: issue.id,
          identifier: issue.identifier ?? null,
          title: issue.title,
        },
        preview: {
          selectedProjectId: preview.selectedProjectId,
          selectedProjectName: preview.selectedProjectName,
          staffing: preview.staffing,
          warnings: preview.warnings,
        },
        previewEvaluation,
        delivery,
        deliveryEvaluation,
        cleanup,
        overallEvaluation: {
          score: overallScore,
          maxScore: overallMaxScore,
          manualReviewChecklist: scenario.manualReviewChecklist,
        },
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}
