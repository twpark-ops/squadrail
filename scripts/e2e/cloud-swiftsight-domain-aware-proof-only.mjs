#!/usr/bin/env node

import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { extractJsonTail } from "./rag-readiness-utils.mjs";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function main() {
  const { stdout, stderr } = await execFileAsync("node", ["scripts/e2e/cloud-swiftsight-summary-layer-proof.mjs"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      SWIFTSIGHT_SUMMARY_PROOF_INCLUDE_RAG_READINESS: "0",
    },
    maxBuffer: 16 * 1024 * 1024,
  });

  process.stdout.write(stdout);
  if (stderr.trim()) {
    process.stderr.write(stderr);
  }

  const summary = extractJsonTail(stdout);
  if (!summary || typeof summary !== "object") {
    throw new Error("Domain-aware proof runner did not emit a structured summary");
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
