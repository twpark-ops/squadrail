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
  const autonomyVariant = scenario.clarificationMode === "reviewer"
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

function evaluateDomainAwarePmDelivery(delivery, scenario) {
  if (!delivery) {
    return {
      score: 0,
      maxScore: 8,
      checks: {
        projectionApplied: false,
        childDeliveryClosed: false,
        clarificationModeMatched: false,
        clarificationRecorded: false,
      },
    };
  }

  const childResults = Array.isArray(delivery.childResults) ? delivery.childResults : [];
  const expectedClarificationMode = scenario.clarificationMode ?? "human_board";
  const expectsClarification = expectedClarificationMode !== "none";
  const checks = {
    projectionApplied: Number(delivery.projectedChildCount ?? 0) > 0,
    childDeliveryClosed: childResults.length > 0 && childResults.every((child) => child?.finalWorkflowState === "done"),
    clarificationModeMatched: !expectsClarification
      || childResults.some((child) => child?.clarificationMode === expectedClarificationMode),
    clarificationRecorded: !expectsClarification
      || childResults.some((child) => typeof child?.askMessageId === "string" && child.askMessageId.length > 0),
  };

  let score = 0;
  if (checks.projectionApplied) score += 2;
  if (checks.childDeliveryClosed) score += 2;
  if (checks.clarificationModeMatched) score += 2;
  if (checks.clarificationRecorded) score += 2;

  return {
    score,
    maxScore: 8,
    checks,
    rootWorkflowState: delivery.rootWorkflowState ?? null,
    projectedChildCount: delivery.projectedChildCount ?? 0,
    childResults,
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
    deliveryEvaluation = evaluateDomainAwarePmDelivery(delivery, scenario);
    note(`deliveryScore=${deliveryEvaluation.score}/${deliveryEvaluation.maxScore}`);
    note(`projectionApplied=${deliveryEvaluation.checks.projectionApplied}`);
    note(`childDeliveryClosed=${deliveryEvaluation.checks.childDeliveryClosed}`);
    note(`clarificationModeMatched=${deliveryEvaluation.checks.clarificationModeMatched}`);
    note(`clarificationRecorded=${deliveryEvaluation.checks.clarificationRecorded}`);
  } else {
    deliveryEvaluation = evaluateDomainAwarePmDelivery(null, scenario);
  }

  const overallScore = previewEvaluation.score + deliveryEvaluation.score;
  const overallMaxScore = previewEvaluation.maxScore + deliveryEvaluation.maxScore;

  section("Manual Review Checklist");
  for (const item of scenario.manualReviewChecklist) {
    note(`- ${item}`);
  }
  note(`overallScore=${overallScore}/${overallMaxScore}`);

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

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
