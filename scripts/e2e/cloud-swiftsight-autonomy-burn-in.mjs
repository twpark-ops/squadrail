#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extractJsonTail } from "./rag-readiness-utils.mjs";

const execFileAsync = promisify(execFile);

const BASE_URL = process.env.SQUADRAIL_BASE_URL ?? "http://127.0.0.1:3101";
const VARIANTS = (process.env.SWIFTSIGHT_AUTONOMY_VARIANTS ?? "baseline,multi_child_coordination,reviewer_clarification_policy")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function note(message = "") {
  process.stdout.write(`${message}\n`);
}

function section(title) {
  note("");
  note("=".repeat(96));
  note(title);
  note("=".repeat(96));
}

async function runVariant(variant) {
  const env = {
    ...process.env,
    SQUADRAIL_BASE_URL: BASE_URL,
    SWIFTSIGHT_AUTONOMY_VARIANT: variant,
  };
  const startedAt = Date.now();
  const { stdout, stderr } = await execFileAsync("node", ["scripts/e2e/cloud-swiftsight-autonomy-org.mjs"], {
    cwd: process.cwd(),
    env,
    maxBuffer: 10 * 1024 * 1024,
  });
  const durationMs = Date.now() - startedAt;
  const parsed = extractJsonTail(stdout);
  assert(parsed && typeof parsed === "object", `autonomy harness did not emit summary JSON for ${variant}`);
  return {
    variant,
    durationMs,
    stdout,
    stderr,
    result: parsed,
  };
}

async function main() {
  section("Resolve Autonomy Variant Matrix");
  note(`baseUrl=${BASE_URL}`);
  note(`variants=${VARIANTS.join(", ")}`);

  const results = [];
  for (const variant of VARIANTS) {
    section(`Run ${variant}`);
    const run = await runVariant(variant);
    note(`durationMs=${run.durationMs}`);
    note(`rootIssue=${run.result.rootIssueIdentifier ?? run.result.rootIssueId}`);
    note(`projectedChildCount=${run.result.projectedChildCount}`);
    results.push({
      variant,
      durationMs: run.durationMs,
      result: run.result,
    });
  }

  section("Autonomy Burn-In Summary");
  note(JSON.stringify({
    ok: true,
    baseUrl: BASE_URL,
    variantCount: results.length,
    results,
  }, null, 2));
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
