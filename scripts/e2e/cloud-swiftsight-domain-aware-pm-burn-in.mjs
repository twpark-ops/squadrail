#!/usr/bin/env node

import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { extractJsonTail } from "./rag-readiness-utils.mjs";
import { listDomainAwarePmScenarioKeys } from "./domain-aware-pm-scenarios.mjs";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function main() {
  const scenarios = listDomainAwarePmScenarioKeys();
  const results = [];

  for (const scenario of scenarios) {
    const { stdout, stderr } = await execFileAsync("node", ["scripts/e2e/cloud-swiftsight-domain-aware-pm-eval.mjs"], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        SWIFTSIGHT_PM_EVAL_SCENARIO: scenario,
      },
      maxBuffer: 16 * 1024 * 1024,
    });

    process.stdout.write(stdout);
    if (stderr.trim()) {
      process.stderr.write(stderr);
    }

    const summary = extractJsonTail(stdout);
    results.push({
      scenario,
      summary,
    });
  }

  process.stdout.write(
    `${JSON.stringify(
      results.map((entry) => ({
        scenario: entry.scenario,
        previewScore: entry.summary?.previewEvaluation?.score ?? null,
        previewMaxScore: entry.summary?.previewEvaluation?.maxScore ?? null,
        deliveryScore: entry.summary?.deliveryEvaluation?.score ?? null,
        deliveryMaxScore: entry.summary?.deliveryEvaluation?.maxScore ?? null,
        overallScore: entry.summary?.overallEvaluation?.score ?? null,
        overallMaxScore: entry.summary?.overallEvaluation?.maxScore ?? null,
        selectedProjectName: entry.summary?.preview?.selectedProjectName ?? null,
        issueIdentifier: entry.summary?.issue?.identifier ?? null,
        deliveryClosed:
          Array.isArray(entry.summary?.delivery?.childResults)
          && entry.summary.delivery.childResults.every((child) => child?.finalWorkflowState === "done"),
      })),
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
