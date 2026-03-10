#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REPO_ROOT = "/home/taewoong/company-project/squadall";
const BASE_URL = process.env.SQUADRAIL_BASE_URL ?? "http://127.0.0.1:3101";
const REPORT_ROOT = process.env.SQUADRAIL_NIGHTLY_REPORT_DIR
  ?? path.join(os.homedir(), ".squadrail", "reports", "nightly", "cloud-swiftsight-real-org");

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function runNodeScript(scriptPath, extraEnv = {}) {
  try {
    const result = await execFileAsync("node", [scriptPath], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        SQUADRAIL_BASE_URL: BASE_URL,
        ...extraEnv,
      },
      maxBuffer: 8 * 1024 * 1024,
    });
    return {
      ok: true,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function extractJsonSummary(stdout) {
  const lastBraceIndex = stdout.lastIndexOf("[");
  if (lastBraceIndex < 0) return null;
  const candidate = stdout.slice(lastBraceIndex).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

async function main() {
  await ensureDir(REPORT_ROOT);
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replaceAll(":", "-");

  const cleanupBefore = await runNodeScript("scripts/e2e/cloud-swiftsight-real-org-cleanup.mjs", {
    SWIFTSIGHT_E2E_NIGHTLY: "1",
  });

  const runResult = await runNodeScript("scripts/e2e/cloud-swiftsight-real-org.mjs", {
    SWIFTSIGHT_E2E_NIGHTLY: "1",
    SWIFTSIGHT_E2E_HIDE_COMPLETED: "1",
    SWIFTSIGHT_E2E_PRE_CLEANUP: "1",
  });

  const cleanupAfter = await runNodeScript("scripts/e2e/cloud-swiftsight-real-org-cleanup.mjs", {
    SWIFTSIGHT_E2E_NIGHTLY: "1",
  });

  const finishedAt = new Date();
  const report = {
    suite: "cloud-swiftsight-real-org",
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    ok: runResult.ok,
    cleanupBefore,
    cleanupAfter,
    summary: extractJsonSummary(runResult.stdout),
    stdout: runResult.stdout,
    stderr: runResult.stderr,
    error: runResult.ok ? null : runResult.error ?? "nightly run failed",
  };

  const latestPath = path.join(REPORT_ROOT, "latest.json");
  const historyPath = path.join(REPORT_ROOT, `${stamp}.json`);
  await fs.writeFile(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(historyPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: report.ok, latestPath, historyPath }, null, 2)}\n`);

  if (!report.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
