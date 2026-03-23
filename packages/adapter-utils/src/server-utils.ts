import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProtocolRunRequirement, type ProtocolRunRequirement } from "@squadrail/shared";

export interface RunProcessResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

interface RunningProcess {
  child: ChildProcess;
  graceSec: number;
}

type ChildProcessWithEvents = ChildProcess & {
  on(event: "error", listener: (err: Error) => void): ChildProcess;
  on(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): ChildProcess;
};

export const runningProcesses = new Map<string, RunningProcess>();
export const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
export const MAX_EXCERPT_BYTES = 32 * 1024;
const SENSITIVE_ENV_KEY = /(key|token|secret|password|passwd|authorization|cookie)/i;
export const SQUADRAIL_PROTOCOL_HELPER_ENV_VAR = "SQUADRAIL_PROTOCOL_HELPER_PATH";
const PROTOCOL_HELPER_RELATIVE_PATH = path.join("scripts", "runtime", "squadrail-protocol.mjs");
const CURRENT_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
let protocolTransportGuardDirPromise: Promise<string> | null = null;
let protocolHelperPathPromise: Promise<string> | null = null;

function collectParentDirectories(start: string) {
  const results: string[] = [];
  let current = path.resolve(start);
  while (!results.includes(current)) {
    results.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return results;
}

function escapeForDoubleQuotedBash(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
}

function escapeForSingleQuotedBash(value: string) {
  return value.replace(/'/g, `'\"'\"'`);
}

function getProtocolHelperVarRef() {
  return `$${SQUADRAIL_PROTOCOL_HELPER_ENV_VAR}`;
}

function buildProtocolHelperPathCandidates() {
  const searchRoots = [process.cwd(), CURRENT_MODULE_DIR];
  const candidates: string[] = [];
  for (const root of searchRoots) {
    for (const directory of collectParentDirectories(root)) {
      candidates.push(path.join(directory, PROTOCOL_HELPER_RELATIVE_PATH));
    }
  }
  return Array.from(new Set(candidates));
}

async function assertReadableFile(filePath: string, errorPrefix: string) {
  try {
    await fs.access(filePath, fsConstants.R_OK);
    return filePath;
  } catch {
    throw new Error(`${errorPrefix}: "${filePath}"`);
  }
}

export async function resolveProtocolHelperPath(explicitPath?: string | null): Promise<string> {
  const trimmedExplicit = typeof explicitPath === "string" ? explicitPath.trim() : "";
  if (trimmedExplicit.length > 0) {
    const resolvedExplicit = path.isAbsolute(trimmedExplicit)
      ? trimmedExplicit
      : path.resolve(process.cwd(), trimmedExplicit);
    return assertReadableFile(
      resolvedExplicit,
      "Configured protocol helper path is not readable",
    );
  }

  if (!protocolHelperPathPromise) {
    protocolHelperPathPromise = (async () => {
      const candidates = buildProtocolHelperPathCandidates();
      for (const candidate of candidates) {
        try {
          await fs.access(candidate, fsConstants.R_OK);
          return candidate;
        } catch {
          // continue scanning
        }
      }
      throw new Error(
        `Could not resolve protocol helper path. Expected ${PROTOCOL_HELPER_RELATIVE_PATH} relative to the repo or set ${SQUADRAIL_PROTOCOL_HELPER_ENV_VAR}.`,
      );
    })();
  }

  return protocolHelperPathPromise;
}

export function formatProtocolHelperCommand(command: string) {
  return `node "${getProtocolHelperVarRef()}" ${command} --issue "$SQUADRAIL_TASK_ID" ...`;
}

function formatConcreteProtocolHelperCommand(input: {
  command: string;
  issueId?: string | null;
  payload?: Record<string, unknown> | null;
  senderRole?: string | null;
}) {
  const issueRef = input.issueId && input.issueId.trim().length > 0
    ? input.issueId.trim()
    : "$SQUADRAIL_TASK_ID";
  const baseSegments = [
    `node "${getProtocolHelperVarRef()}" ${input.command}`,
    `--issue "${escapeForDoubleQuotedBash(issueRef)}"`,
  ];
  const senderRole = nonEmptyString(input.senderRole);
  if (senderRole) {
    baseSegments.push(`--sender-role "${escapeForDoubleQuotedBash(senderRole)}"`);
  }
  const base = baseSegments.join(" ");
  if (!input.payload || Object.keys(input.payload).length === 0) {
    return base;
  }
  if (
    input.command === "ask-clarification"
    || input.command === "submit-for-review"
    || input.command === "approve-implementation"
    || input.command === "close-task"
  ) {
    const payload = parseObject(input.payload);
    const segments = [base];

    if (input.command === "ask-clarification") {
      const summary = nonEmptyString(payload.summary);
      const questionType = nonEmptyString(payload.questionType);
      const question = nonEmptyString(payload.question);
      const requestedFrom = nonEmptyString(payload.requestedFrom);
      const recipientId = nonEmptyString(payload.recipientId);
      const blocking = typeof payload.blocking === "boolean" ? payload.blocking : null;
      const proposedAssumptions = asStringArray(payload.proposedAssumptions);
      const relatedArtifacts = asStringArray(payload.relatedArtifacts);
      const resumeWorkflowState = nonEmptyString(payload.resumeWorkflowState);

      if (summary) segments.push(`--summary "${escapeForDoubleQuotedBash(summary)}"`);
      if (questionType) segments.push(`--question-type "${escapeForDoubleQuotedBash(questionType)}"`);
      if (question) segments.push(`--question "${escapeForDoubleQuotedBash(question)}"`);
      if (requestedFrom) segments.push(`--requested-from "${escapeForDoubleQuotedBash(requestedFrom)}"`);
      if (recipientId) segments.push(`--recipient-id "${escapeForDoubleQuotedBash(recipientId)}"`);
      if (blocking != null) segments.push(`--blocking "${blocking ? "true" : "false"}"`);
      if (resumeWorkflowState) {
        segments.push(`--resume-workflow-state "${escapeForDoubleQuotedBash(resumeWorkflowState)}"`);
      }
      if (proposedAssumptions.length > 0) {
        segments.push(`--proposed-assumptions "${escapeForDoubleQuotedBash(proposedAssumptions.join("||"))}"`);
      }
      if (relatedArtifacts.length > 0) {
        segments.push(`--related-artifacts "${escapeForDoubleQuotedBash(relatedArtifacts.join("||"))}"`);
      }
      return segments.join(" ");
    }

    const firstCitation = parseArray(payload.evidenceCitations)
      .map((entry) => parseObject(entry))
      .find((entry) => Object.keys(entry).length > 0) ?? null;

    if (input.command === "submit-for-review") {
      const reviewerId = nonEmptyString(payload.reviewerId);
      const summary = nonEmptyString(payload.summary);
      const implementationSummary = nonEmptyString(payload.implementationSummary);
      const diffSummary = nonEmptyString(payload.diffSummary);
      const evidence = asStringArray(payload.evidence);
      const changedFiles = asStringArray(payload.changedFiles);
      const testResults = asStringArray(payload.testResults);
      const reviewChecklist = asStringArray(payload.reviewChecklist);
      const residualRisks = asStringArray(payload.residualRisks);

      if (reviewerId) segments.push(`--reviewer-id "${escapeForDoubleQuotedBash(reviewerId)}"`);
      if (summary) segments.push(`--summary "${escapeForDoubleQuotedBash(summary)}"`);
      if (implementationSummary) {
        segments.push(`--implementation-summary "${escapeForDoubleQuotedBash(implementationSummary)}"`);
      }
      if (evidence.length > 0) segments.push(`--evidence "${escapeForDoubleQuotedBash(evidence.join("||"))}"`);
      if (diffSummary) segments.push(`--diff-summary "${escapeForDoubleQuotedBash(diffSummary)}"`);
      if (changedFiles.length > 0) {
        segments.push(`--changed-files "${escapeForDoubleQuotedBash(changedFiles.join("||"))}"`);
      }
      if (testResults.length > 0) segments.push(`--test-results "${escapeForDoubleQuotedBash(testResults.join("||"))}"`);
      if (reviewChecklist.length > 0) {
        segments.push(`--review-checklist "${escapeForDoubleQuotedBash(reviewChecklist.join("||"))}"`);
      }
      if (residualRisks.length > 0) {
        segments.push(`--residual-risks "${escapeForDoubleQuotedBash(residualRisks.join("||"))}"`);
      }
    } else if (input.command === "approve-implementation") {
      const summary = nonEmptyString(payload.summary);
      const approvalSummary = nonEmptyString(payload.approvalSummary);
      const approvalChecklist = asStringArray(payload.approvalChecklist);
      const verifiedEvidence = asStringArray(payload.verifiedEvidence);
      const residualRisks = asStringArray(payload.residualRisks);
      const approvalMode = nonEmptyString(payload.approvalMode);
      const executionLog = nonEmptyString(payload.executionLog);
      const outputVerified = nonEmptyString(payload.outputVerified);
      const sanityCommand = nonEmptyString(payload.sanityCommand);

      if (summary) segments.push(`--summary "${escapeForDoubleQuotedBash(summary)}"`);
      if (approvalSummary) segments.push(`--approval-summary "${escapeForDoubleQuotedBash(approvalSummary)}"`);
      if (approvalChecklist.length > 0) {
        segments.push(`--approval-checklist "${escapeForDoubleQuotedBash(approvalChecklist.join("||"))}"`);
      }
      if (verifiedEvidence.length > 0) {
        segments.push(`--verified-evidence "${escapeForDoubleQuotedBash(verifiedEvidence.join("||"))}"`);
      }
      if (residualRisks.length > 0) {
        segments.push(`--residual-risks "${escapeForDoubleQuotedBash(residualRisks.join("||"))}"`);
      }
      if (approvalMode) segments.push(`--approval-mode "${escapeForDoubleQuotedBash(approvalMode)}"`);
      if (executionLog) segments.push(`--execution-log "${escapeForDoubleQuotedBash(executionLog)}"`);
      if (outputVerified) segments.push(`--output-verified "${escapeForDoubleQuotedBash(outputVerified)}"`);
      if (sanityCommand) segments.push(`--sanity-command "${escapeForDoubleQuotedBash(sanityCommand)}"`);
    } else if (input.command === "close-task") {
      const summary = nonEmptyString(payload.summary);
      const closureSummary = nonEmptyString(payload.closureSummary);
      const verificationSummary = nonEmptyString(payload.verificationSummary);
      const rollbackPlan = nonEmptyString(payload.rollbackPlan);
      const finalArtifacts = asStringArray(payload.finalArtifacts);
      const remainingRisks = asStringArray(payload.remainingRisks);
      const closeReason = nonEmptyString(payload.closeReason);
      const mergeStatus = nonEmptyString(payload.mergeStatus);
      const finalTestStatus = nonEmptyString(payload.finalTestStatus);

      if (summary) segments.push(`--summary "${escapeForDoubleQuotedBash(summary)}"`);
      if (closureSummary) segments.push(`--closure-summary "${escapeForDoubleQuotedBash(closureSummary)}"`);
      if (verificationSummary) {
        segments.push(`--verification-summary "${escapeForDoubleQuotedBash(verificationSummary)}"`);
      }
      if (rollbackPlan) segments.push(`--rollback-plan "${escapeForDoubleQuotedBash(rollbackPlan)}"`);
      if (finalArtifacts.length > 0) {
        segments.push(`--final-artifacts "${escapeForDoubleQuotedBash(finalArtifacts.join("||"))}"`);
      }
      if (remainingRisks.length > 0) {
        segments.push(`--remaining-risks "${escapeForDoubleQuotedBash(remainingRisks.join("||"))}"`);
      }
      if (closeReason) segments.push(`--close-reason "${escapeForDoubleQuotedBash(closeReason)}"`);
      if (mergeStatus) segments.push(`--merge-status "${escapeForDoubleQuotedBash(mergeStatus)}"`);
      if (finalTestStatus) {
        segments.push(`--final-test-status "${escapeForDoubleQuotedBash(finalTestStatus)}"`);
      }
    }

    if (firstCitation) {
      const citationRunId = nonEmptyString(firstCitation.retrievalRunId);
      const citationBriefId = nonEmptyString(firstCitation.briefId);
      const citedHitRanks = asStringArray(parseArray(firstCitation.citedHitRanks).map((entry) => String(entry)));
      const citedPaths = asStringArray(firstCitation.citedPaths);
      const citedSourceTypes = asStringArray(firstCitation.citedSourceTypes);
      const citedSummaryKinds = asStringArray(firstCitation.citedSummaryKinds);
      const citationReason = nonEmptyString(firstCitation.citationReason);
      if (citationRunId) segments.push(`--citation-run-id "${escapeForDoubleQuotedBash(citationRunId)}"`);
      if (citationBriefId) segments.push(`--citation-brief-id "${escapeForDoubleQuotedBash(citationBriefId)}"`);
      if (citedHitRanks.length > 0) {
        segments.push(`--cited-hit-ranks "${escapeForDoubleQuotedBash(citedHitRanks.join("||"))}"`);
      }
      if (citedPaths.length > 0) segments.push(`--cited-paths "${escapeForDoubleQuotedBash(citedPaths.join("||"))}"`);
      if (citedSourceTypes.length > 0) {
        segments.push(`--cited-source-types "${escapeForDoubleQuotedBash(citedSourceTypes.join("||"))}"`);
      }
      if (citedSummaryKinds.length > 0) {
        segments.push(`--cited-summary-kinds "${escapeForDoubleQuotedBash(citedSummaryKinds.join("||"))}"`);
      }
      if (citationReason) segments.push(`--citation-reason "${escapeForDoubleQuotedBash(citationReason)}"`);
    }
    return segments.join(" ");
  }
  const payloadJson = JSON.stringify(input.payload);
  return `${base} --payload '${escapeForSingleQuotedBash(payloadJson)}'`;
}

function buildPythonProtocolGuardScript(defaultHelperPath: string) {
  return `#!/usr/bin/env bash
set -euo pipefail

REAL_PYTHON="/usr/bin/python3"
HELPER_PATH="\${${SQUADRAIL_PROTOCOL_HELPER_ENV_VAR}:-${escapeForDoubleQuotedBash(defaultHelperPath)}}"
BLOCK_MESSAGE="[squadrail] Direct protocol HTTP via python is blocked. Use: node \${HELPER_PATH} <command> --issue \\"$SQUADRAIL_TASK_ID\\" ..."

block_if_protocol_script() {
  local content="$1"
  if printf '%s' "$content" | grep -Eq '/protocol/messages'; then
    printf '%s\\n' "$BLOCK_MESSAGE" >&2
    exit 97
  fi
}

if [[ "\${1:-}" == "-" ]]; then
  tmp_file="$(mktemp)"
  trap 'rm -f "$tmp_file"' EXIT
  cat >"$tmp_file"
  block_if_protocol_script "$(cat "$tmp_file")"
  "$REAL_PYTHON" "$@" <"$tmp_file"
  exit $?
fi

if [[ "\${1:-}" == "-c" ]]; then
  block_if_protocol_script "\${2:-}"
fi

exec "$REAL_PYTHON" "$@"
`;
}

function buildHttpProtocolGuardScript(realBinary: string, toolName: string, defaultHelperPath: string) {
  return `#!/usr/bin/env bash
set -euo pipefail

REAL_BINARY="${realBinary}"
HELPER_PATH="\${${SQUADRAIL_PROTOCOL_HELPER_ENV_VAR}:-${escapeForDoubleQuotedBash(defaultHelperPath)}}"
BLOCK_MESSAGE="[squadrail] Direct protocol HTTP via ${toolName} is blocked. Use: node \${HELPER_PATH} <command> --issue \\"$SQUADRAIL_TASK_ID\\" ..."

if printf '%s' "$*" | grep -Eq '/protocol/messages'; then
  printf '%s\\n' "$BLOCK_MESSAGE" >&2
  exit 97
fi

exec "$REAL_BINARY" "$@"
`;
}

function buildGitWriteGuardScript() {
  const blockedSubcommands = ["commit", "add", "push", "stash", "rebase", "merge", "cherry-pick", "reset", "checkout -- ", "restore"];
  const pattern = blockedSubcommands.join("|");
  return `#!/usr/bin/env bash
set -euo pipefail

REAL_GIT="$(command -v git.real 2>/dev/null || echo /usr/bin/git)"
BLOCK_MESSAGE="[squadrail] QA workspace is read-only. git write operations (commit, add, push, etc.) are blocked. QA may only run commands for execution verification."

if [[ "\${SQUADRAIL_WORKSPACE_READ_ONLY:-}" == "1" ]]; then
  subcmd="\${1:-}"
  case "$subcmd" in
    ${blockedSubcommands.map((cmd) => cmd.split(" ")[0]).join("|")})
      printf '%s\\n' "$BLOCK_MESSAGE" >&2
      exit 97
      ;;
  esac
fi

exec "$REAL_GIT" "$@"
`;
}

async function ensureProtocolTransportGuardDir() {
  if (!protocolTransportGuardDirPromise) {
    protocolTransportGuardDirPromise = (async () => {
      const guardDir = path.join(os.tmpdir(), "squadrail-protocol-guard-bin", String(process.pid));
      const helperPath = await resolveProtocolHelperPath(
        process.env[SQUADRAIL_PROTOCOL_HELPER_ENV_VAR] ?? null,
      );
      await fs.mkdir(guardDir, { recursive: true });
      // Backup real git before shim replaces it
      const realGitPath = path.join(guardDir, "git.real");
      const whichGit = await new Promise<string>((resolve) => {
        const cp = require("node:child_process").execFileSync("which", ["git"], { encoding: "utf8" });
        resolve(cp.trim());
      }).catch(() => "/usr/bin/git");
      await Promise.all([
        fs.writeFile(path.join(guardDir, "python"), buildPythonProtocolGuardScript(helperPath), { mode: 0o755 }),
        fs.writeFile(path.join(guardDir, "python3"), buildPythonProtocolGuardScript(helperPath), { mode: 0o755 }),
        fs.writeFile(
          path.join(guardDir, "curl"),
          buildHttpProtocolGuardScript("/usr/bin/curl", "curl", helperPath),
          { mode: 0o755 },
        ),
        fs.writeFile(path.join(guardDir, "git"), buildGitWriteGuardScript(), { mode: 0o755 }),
        fs.symlink(whichGit, realGitPath).catch(() => null), // OK if exists
      ]);
      return guardDir;
    })();
  }
  return protocolTransportGuardDirPromise;
}

export async function withProtocolTransportGuards(
  env: NodeJS.ProcessEnv,
  options?: { readOnlyWorkspace?: boolean },
): Promise<NodeJS.ProcessEnv> {
  const helperPath = await resolveProtocolHelperPath(env[SQUADRAIL_PROTOCOL_HELPER_ENV_VAR] ?? null);
  const guardDir = await ensureProtocolTransportGuardDir();
  const currentPath = env.PATH ?? process.env.PATH ?? "";
  const pathEntries = currentPath.split(":").filter(Boolean);
  if (pathEntries[0] !== guardDir) {
    env.PATH = [guardDir, ...pathEntries].join(":");
  }
  env[SQUADRAIL_PROTOCOL_HELPER_ENV_VAR] = helperPath;
  if (options?.readOnlyWorkspace) {
    env.SQUADRAIL_WORKSPACE_READ_ONLY = "1";
  }
  return env;
}

export function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function parseJson(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function appendWithCap(prev: string, chunk: string, cap = MAX_CAPTURE_BYTES) {
  const combined = prev + chunk;
  return combined.length > cap ? combined.slice(combined.length - cap) : combined;
}

export function resolvePathValue(obj: Record<string, unknown>, dottedPath: string) {
  const parts = dottedPath.split(".");
  let cursor: unknown = obj;

  for (const part of parts) {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) {
      return "";
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }

  if (cursor === null || cursor === undefined) return "";
  if (typeof cursor === "string") return cursor;
  if (typeof cursor === "number" || typeof cursor === "boolean") return String(cursor);

  try {
    return JSON.stringify(cursor);
  } catch {
    return "";
  }
}

export function renderTemplate(template: string, data: Record<string, unknown>) {
  return template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_, path) => resolvePathValue(data, path));
}

export function redactEnvForLogs(env: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    redacted[key] = SENSITIVE_ENV_KEY.test(key) ? "***REDACTED***" : value;
  }
  return redacted;
}

export function buildSquadrailEnv(agent: { id: string; companyId: string }): Record<string, string> {
  const resolveHostForUrl = (rawHost: string): string => {
    const host = rawHost.trim();
    if (!host || host === "0.0.0.0" || host === "::") return "localhost";
    if (host.includes(":") && !host.startsWith("[") && !host.endsWith("]")) return `[${host}]`;
    return host;
  };
  const vars: Record<string, string> = {
    SQUADRAIL_AGENT_ID: agent.id,
    SQUADRAIL_COMPANY_ID: agent.companyId,
  };
  if (typeof process.env.SQUADRAIL_DEPLOYMENT_MODE === "string" && process.env.SQUADRAIL_DEPLOYMENT_MODE.trim().length > 0) {
    vars.SQUADRAIL_DEPLOYMENT_MODE = process.env.SQUADRAIL_DEPLOYMENT_MODE.trim();
  }
  const runtimeHost = resolveHostForUrl(
    process.env.SQUADRAIL_LISTEN_HOST ?? process.env.HOST ?? "localhost",
  );
  const runtimePort = process.env.SQUADRAIL_LISTEN_PORT ?? process.env.PORT ?? "3100";
  const apiUrl = process.env.SQUADRAIL_API_URL ?? `http://${runtimeHost}:${runtimePort}`;
  vars.SQUADRAIL_API_URL = apiUrl;
  return vars;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readPositiveIntArray(value: unknown) {
  return parseArray(value)
    .map((entry) => {
      if (typeof entry === "number" && Number.isInteger(entry) && entry > 0) return entry;
      if (typeof entry === "string" && /^\d+$/.test(entry.trim())) return Number(entry.trim());
      return null;
    })
    .filter((entry): entry is number => entry !== null);
}

function extractEvidenceSummaryKind(entry: Record<string, unknown>) {
  return nonEmptyString(entry.summaryKind) ?? nonEmptyString(parseObject(entry.documentMetadata).summaryKind);
}

function buildDefaultEvidenceCitation(input: {
  retrievalRunId?: string | null;
  citationPaths: string[];
  taskBriefEvidence?: Array<Record<string, unknown>>;
  citationReason: string;
}) {
  const retrievalRunId = nonEmptyString(input.retrievalRunId);
  if (!retrievalRunId) return null;

  const normalizedEvidence = (input.taskBriefEvidence ?? [])
    .map((entry) => parseObject(entry))
    .filter((entry) => Object.keys(entry).length > 0);
  const preferredPathSet = new Set(input.citationPaths);
  const selectedEvidence = preferredPathSet.size > 0
    ? normalizedEvidence.filter((entry) => {
      const entryPath = nonEmptyString(entry.path);
      return entryPath ? preferredPathSet.has(entryPath) : false;
    })
    : [];
  const effectiveEvidence = selectedEvidence.length > 0 ? selectedEvidence : normalizedEvidence.slice(0, 4);
  const citedPaths = Array.from(new Set([
    ...input.citationPaths,
    ...effectiveEvidence
      .map((entry) => nonEmptyString(entry.path))
      .filter((entry): entry is string => Boolean(entry)),
  ]));
  const citedHitRanks = Array.from(new Set(effectiveEvidence.flatMap((entry) => readPositiveIntArray([entry.rank]))));
  const citedSourceTypes = Array.from(new Set(
    effectiveEvidence
      .map((entry) => nonEmptyString(entry.sourceType))
      .filter((entry): entry is string => Boolean(entry)),
  ));
  const citedSummaryKinds = Array.from(new Set(
    effectiveEvidence
      .map((entry) => extractEvidenceSummaryKind(entry))
      .filter((entry): entry is string => Boolean(entry)),
  ));

  if (
    citedPaths.length === 0
    && citedHitRanks.length === 0
    && citedSourceTypes.length === 0
    && citedSummaryKinds.length === 0
  ) {
    return null;
  }

  return {
    retrievalRunId,
    ...(citedHitRanks.length > 0 ? { citedHitRanks } : {}),
    ...(citedPaths.length > 0 ? { citedPaths } : {}),
    ...(citedSourceTypes.length > 0 ? { citedSourceTypes } : {}),
    ...(citedSummaryKinds.length > 0 ? { citedSummaryKinds } : {}),
    citationReason: input.citationReason,
  };
}

function isShortProtocolLaneKey(key: ProtocolRunRequirement["key"] | null | undefined) {
  return key === "assignment_supervisor"
    || key === "reassignment_supervisor"
    || key === "review_reviewer"
    || key === "qa_gate_reviewer"
    || key === "approval_tech_lead";
}

function shouldSkipInitialStartReview(input: {
  requirement: ProtocolRunRequirement;
  workflowBefore?: string | null;
}) {
  if (input.requirement.key === "review_reviewer") {
    return input.workflowBefore === "under_review";
  }
  if (input.requirement.key === "qa_gate_reviewer") {
    return input.workflowBefore === "under_qa_review";
  }
  return false;
}

export function buildProtocolHelperSnippet(messageType: string) {
  const commandByMessageType: Record<string, string> = {
    REASSIGN_TASK: "reassign-task",
    ACK_ASSIGNMENT: "ack-assignment",
    START_IMPLEMENTATION: "start-implementation",
    ASK_CLARIFICATION: "ask-clarification",
    REPORT_PROGRESS: "report-progress",
    SUBMIT_FOR_REVIEW: "submit-for-review",
    ACK_CHANGE_REQUEST: "ack-change-request",
    START_REVIEW: "start-review",
    REQUEST_CHANGES: "request-changes",
    REQUEST_HUMAN_DECISION: "request-human-decision",
    APPROVE_IMPLEMENTATION: "approve-implementation",
    CLOSE_TASK: "close-task",
  };
  const command = commandByMessageType[messageType];
  if (!command) return null;
  return formatProtocolHelperCommand(command);
}

function buildConcreteProtocolHelperSnippet(input: {
  requirement: ProtocolRunRequirement;
  issueId?: string | null;
  body: Record<string, unknown>;
  protocolPayload?: Record<string, unknown>;
  runtimeContext?: Record<string, unknown>;
  protocolSummary?: string | null;
  reviewSubmission?: Record<string, unknown>;
  retrievalRunId?: string | null;
  taskBriefEvidence?: Array<Record<string, unknown>>;
}) {
  const messageType = nonEmptyString(input.body.messageType);
  const payload = { ...parseObject(input.body.payload) };
  const protocolPayload = parseObject(input.protocolPayload);
  const runtimeContext = parseObject(input.runtimeContext);
  const reviewSubmission = parseObject(input.reviewSubmission);
  const reviewSubmissionChangedFiles = asStringArray(reviewSubmission.changedFiles);
  const reviewSubmissionChecklist = asStringArray(reviewSubmission.reviewChecklist);
  const reviewSubmissionEvidence = asStringArray(reviewSubmission.evidence);
  const reviewSubmissionTestResults = asStringArray(reviewSubmission.testResults);
  const reviewSubmissionResidualRisks = asStringArray(reviewSubmission.residualRisks);
  const reviewerId =
    nonEmptyString(input.protocolPayload?.reviewerAgentId)
    ?? nonEmptyString(input.protocolPayload?.newReviewerAgentId)
    ?? nonEmptyString(protocolPayload.reviewerAgentId)
    ?? nonEmptyString(protocolPayload.newReviewerAgentId)
    ?? nonEmptyString(runtimeContext.reviewerAgentId)
    ?? nonEmptyString(runtimeContext.newReviewerAgentId)
    ?? nonEmptyString(payload.reviewerId)
    ?? nonEmptyString(payload.reviewerAgentId);
  const protocolPayloadVerifiedEvidence = asStringArray(protocolPayload.verifiedEvidence);
  const protocolPayloadApprovalChecklist = asStringArray(protocolPayload.approvalChecklist);
  const taskBriefEvidencePaths = (input.taskBriefEvidence ?? [])
    .map((entry) => nonEmptyString(entry.path))
    .filter((entry): entry is string => Boolean(entry));
  const explicitSenderRole = nonEmptyString(runtimeContext.protocolRecipientRole);
  const citationPaths = reviewSubmissionChangedFiles.length > 0
    ? reviewSubmissionChangedFiles.slice(0, 4)
    : taskBriefEvidencePaths.slice(0, 4);
  const submitCitation = buildDefaultEvidenceCitation({
    retrievalRunId: input.retrievalRunId,
    citationPaths,
    taskBriefEvidence: input.taskBriefEvidence,
    citationReason: "implementation_handoff_brief_evidence",
  });
  const approvalCitation = buildDefaultEvidenceCitation({
    retrievalRunId: input.retrievalRunId,
    citationPaths,
    taskBriefEvidence: input.taskBriefEvidence,
    citationReason: "review_decision_brief_evidence",
  });
  const closeCitation = buildDefaultEvidenceCitation({
    retrievalRunId: input.retrievalRunId,
    citationPaths,
    taskBriefEvidence: input.taskBriefEvidence,
    citationReason: "closure_brief_evidence",
  });
  const bodySummary = nonEmptyString(input.body.summary);
  if (!payload.summary && bodySummary) {
    payload.summary = bodySummary;
  }
  if (!messageType) return null;

  switch (input.requirement.key) {
    case "assignment_supervisor":
    case "reassignment_supervisor":
      if (messageType === "REASSIGN_TASK") {
        const preferredSupervisorAssigneeId =
          input.requirement.recipientRole === "pm"
            ? nonEmptyString(runtimeContext.techLeadAgentId)
              ?? nonEmptyString(input.protocolPayload?.techLeadAgentId)
            : null;
        const preferredSupervisorAssigneeRole =
          preferredSupervisorAssigneeId ? "tech_lead" : null;
        const resolvedAssigneeId =
          preferredSupervisorAssigneeId
          ?? nonEmptyString(input.protocolPayload?.newAssigneeAgentId)
          ?? nonEmptyString(input.protocolPayload?.assigneeAgentId)
          ?? nonEmptyString(payload.newAssigneeAgentId)
          ?? null;
        const resolvedQaId =
          nonEmptyString(input.protocolPayload?.qaAgentId)
          ?? nonEmptyString(input.protocolPayload?.newQaAgentId)
          ?? nonEmptyString(runtimeContext.qaAgentId)
          ?? nonEmptyString(payload.newQaAgentId)
          ?? null;
        const reviewerFallbackCandidates = [
          nonEmptyString(input.protocolPayload?.reviewerAgentId),
          nonEmptyString(input.protocolPayload?.newReviewerAgentId),
          nonEmptyString(runtimeContext.reviewerAgentId),
          nonEmptyString(payload.newReviewerAgentId),
        ].filter((entry, index, array): entry is string =>
          Boolean(entry) && array.indexOf(entry) === index,
        );
        const resolvedReviewerId = reviewerFallbackCandidates.find(
          (candidate) => candidate !== resolvedAssigneeId && candidate !== resolvedQaId,
        ) ?? null;
        payload.newAssigneeAgentId =
          resolvedAssigneeId
          ?? payload.newAssigneeAgentId;
        if (
          preferredSupervisorAssigneeId
          && resolvedAssigneeId === preferredSupervisorAssigneeId
          && preferredSupervisorAssigneeRole
        ) {
          payload.newAssigneeRole = preferredSupervisorAssigneeRole;
        }
        if (resolvedReviewerId) {
          payload.newReviewerAgentId = resolvedReviewerId;
        } else {
          delete payload.newReviewerAgentId;
        }
        payload.newQaAgentId =
          nonEmptyString(input.protocolPayload?.qaAgentId)
          ?? nonEmptyString(input.protocolPayload?.newQaAgentId)
          ?? nonEmptyString(payload.newQaAgentId)
          ?? payload.newQaAgentId;
        if (!payload.reason && input.protocolSummary) {
          payload.reason = input.protocolSummary;
        }
        return formatConcreteProtocolHelperCommand({
          command: "reassign-task",
          issueId: input.issueId,
          payload,
          senderRole: explicitSenderRole,
        });
      }
      return null;
    case "assignment_engineer":
    case "reassignment_engineer":
      if (messageType === "ACK_ASSIGNMENT") {
        return formatConcreteProtocolHelperCommand({
          command: "ack-assignment",
          issueId: input.issueId,
          payload,
          senderRole: explicitSenderRole,
        });
      }
      if (messageType === "START_IMPLEMENTATION") {
        return formatConcreteProtocolHelperCommand({
          command: "start-implementation",
          issueId: input.issueId,
          payload,
          senderRole: explicitSenderRole,
        });
      }
      return null;
    case "change_request_engineer":
      if (messageType === "ACK_CHANGE_REQUEST") {
        payload.changeRequestIds =
          Array.isArray(input.protocolPayload?.changeRequestIds)
            ? input.protocolPayload.changeRequestIds
            : payload.changeRequestIds;
        return formatConcreteProtocolHelperCommand({
          command: "ack-change-request",
          issueId: input.issueId,
          payload,
          senderRole: explicitSenderRole,
        });
      }
      return null;
    case "implementation_engineer":
      if (messageType === "ASK_CLARIFICATION") {
        const techLeadRecipientId =
          nonEmptyString(runtimeContext.techLeadAgentId)
          ?? nonEmptyString(input.protocolPayload?.techLeadAgentId)
          ?? null;
        payload.questionType =
          nonEmptyString(payload.questionType)
          ?? "implementation";
        payload.question =
          nonEmptyString(payload.question)
          ?? "The acceptance step that should run before review is still unclear. Which exact command or artifact should be used to continue?";
        payload.requestedFrom =
          nonEmptyString(payload.requestedFrom)
          ?? (techLeadRecipientId ? "tech_lead" : "human_board");
        payload.summary =
          nonEmptyString(payload.summary)
          ?? "Need the exact implementation acceptance command before continuing.";
        payload.blocking = payload.blocking ?? true;
        if (techLeadRecipientId) {
          payload.recipientId =
            nonEmptyString(payload.recipientId)
            ?? techLeadRecipientId;
        } else {
          delete payload.recipientId;
        }
        return formatConcreteProtocolHelperCommand({
          command: "ask-clarification",
          issueId: input.issueId,
          payload,
          senderRole: explicitSenderRole,
        });
      }
      if (messageType === "REPORT_PROGRESS") {
        return formatConcreteProtocolHelperCommand({
          command: "report-progress",
          issueId: input.issueId,
          payload,
          senderRole: explicitSenderRole,
        });
      }
      if (messageType === "SUBMIT_FOR_REVIEW") {
        if (reviewerId) {
          payload.reviewerId = reviewerId;
        }
        if (submitCitation) {
          payload.evidenceCitations = [submitCitation];
        }
        return formatConcreteProtocolHelperCommand({
          command: "submit-for-review",
          issueId: input.issueId,
          payload,
          senderRole: explicitSenderRole,
        });
      }
      return null;
    case "review_reviewer":
    case "qa_gate_reviewer":
      if (messageType === "START_REVIEW") {
        if (input.requirement.key === "qa_gate_reviewer" && protocolPayloadVerifiedEvidence.length > 0) {
          payload.reviewFocus = [
            `Run reviewer-approved verification command: ${protocolPayloadVerifiedEvidence[0]}`,
            "Capture the observed output and compare it to the expected QA acceptance signal",
          ];
        }
        return formatConcreteProtocolHelperCommand({
          command: "start-review",
          issueId: input.issueId,
          payload,
          senderRole: explicitSenderRole,
        });
      }
      if (messageType === "APPROVE_IMPLEMENTATION") {
        if (input.requirement.key === "qa_gate_reviewer" && protocolPayloadApprovalChecklist.length > 0) {
          payload.approvalChecklist = protocolPayloadApprovalChecklist;
        } else if (reviewSubmissionChecklist.length > 0) {
          payload.approvalChecklist = reviewSubmissionChecklist;
        }
        if (input.requirement.key === "qa_gate_reviewer" && protocolPayloadVerifiedEvidence.length > 0) {
          payload.verifiedEvidence = protocolPayloadVerifiedEvidence;
          if (!nonEmptyString(payload.sanityCommand)) {
            payload.sanityCommand = protocolPayloadVerifiedEvidence[0];
          }
          if (!nonEmptyString(payload.executionLog)) {
            payload.executionLog = `Executed reviewer-approved verification command: ${protocolPayloadVerifiedEvidence[0]}`;
          }
          if (!nonEmptyString(payload.outputVerified)) {
            payload.outputVerified = "Observed output matches the expected QA acceptance signal.";
          }
        } else if (reviewSubmissionTestResults.length > 0) {
          payload.verifiedEvidence = reviewSubmissionTestResults;
        } else if (reviewSubmissionEvidence.length > 0) {
          payload.verifiedEvidence = reviewSubmissionEvidence;
        }
        if (reviewSubmissionResidualRisks.length > 0) {
          payload.residualRisks = reviewSubmissionResidualRisks;
        }
        if (approvalCitation) {
          payload.evidenceCitations = [approvalCitation];
        }
        return formatConcreteProtocolHelperCommand({
          command: "approve-implementation",
          issueId: input.issueId,
          payload,
          senderRole: explicitSenderRole,
        });
      }
      return null;
    case "approval_tech_lead":
      if (messageType === "CLOSE_TASK") {
        if (closeCitation) {
          payload.evidenceCitations = [closeCitation];
        }
        return formatConcreteProtocolHelperCommand({
          command: "close-task",
          issueId: input.issueId,
          payload,
          senderRole: explicitSenderRole,
        });
      }
      return null;
    default:
      return null;
  }
}

function buildImmediateProtocolCommandSequence(input: {
  requirement: ProtocolRunRequirement;
  issueId?: string | null;
  protocolPayload?: Record<string, unknown>;
  runtimeContext?: Record<string, unknown>;
  protocolSummary?: string | null;
  reviewSubmission?: Record<string, unknown>;
  retrievalRunId?: string | null;
  taskBriefEvidence?: Array<Record<string, unknown>>;
  workflowBefore?: string | null;
}) {
  const commands = buildProtocolExampleBodies(input.requirement, input.taskBriefEvidence)
    .map((example) => {
      const snippet = buildConcreteProtocolHelperSnippet({
        requirement: input.requirement,
        issueId: input.issueId,
        body: example.body,
        protocolPayload: input.protocolPayload,
        runtimeContext: input.runtimeContext,
        protocolSummary: input.protocolSummary,
        reviewSubmission: input.reviewSubmission,
        retrievalRunId: input.retrievalRunId,
        taskBriefEvidence: input.taskBriefEvidence,
      });
      const messageType = nonEmptyString(example.body.messageType);
      if (!snippet || !messageType) return null;
      return {
        label: example.label,
        messageType,
        snippet,
      };
    })
    .filter((entry): entry is { label: string; messageType: string; snippet: string } => Boolean(entry));

  switch (input.requirement.key) {
    case "assignment_engineer":
    case "reassignment_engineer":
      return commands.filter((entry) =>
        entry.messageType === "ACK_ASSIGNMENT" || entry.messageType === "START_IMPLEMENTATION",
      );
    case "assignment_supervisor":
    case "reassignment_supervisor":
    case "change_request_engineer":
    case "approval_tech_lead":
      return commands.slice(0, 1);
    case "review_reviewer":
      if (shouldSkipInitialStartReview(input)) {
        return commands.filter((entry) => entry.messageType !== "START_REVIEW");
      }
      return commands.slice(0, 2);
    case "qa_gate_reviewer":
      if (shouldSkipInitialStartReview(input)) {
        return commands.filter((entry) => entry.messageType !== "START_REVIEW");
      }
      return commands.slice(0, 2);
    default:
      return [];
  }
}

function buildProtocolExampleBodies(
  requirement: ProtocolRunRequirement,
  taskBriefEvidence?: Array<Record<string, unknown>>,
) {
  const sender = {
    actorType: "agent",
    actorId: "$SQUADRAIL_AGENT_ID",
    role: requirement.recipientRole,
  };
  const recipients = [
    {
      recipientType: "agent",
      recipientId: "$SQUADRAIL_AGENT_ID",
      role: requirement.recipientRole,
    },
  ];
  const scopedPaths = (taskBriefEvidence ?? [])
    .map((entry) => nonEmptyString(entry.path))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 2);
  const scopedPathText = scopedPaths.length > 0
    ? scopedPaths.join(" and ")
    : "the scoped target files from the current brief";
  const engineerScopeSummary = scopedPaths.length > 0
    ? `Implement the assigned fix in ${scopedPathText} and add focused validation.`
    : "Implement the assigned fix in the scoped target files and add focused validation.";
  const engineerRiskSummary =
    "A focused patch can regress existing behavior if the scoped validation is incomplete.";
  const engineerHypothesisSummary = scopedPaths.length > 0
    ? `${scopedPathText} contain the primary behavior and regression coverage needed for this slice.`
    : "The current brief contains the primary behavior and regression coverage needed for this slice.";
  const engineerProgressSummary = scopedPaths.length > 0
    ? `Scoped the active files (${scopedPathText}) and prepared the focused validation path.`
    : "Scoped the active files from the current brief and prepared the focused validation path.";
  const engineerReviewEvidence = scopedPaths.length > 0
    ? [`Focused patch applied in ${scopedPathText}.`]
    : ["Focused patch applied in the scoped target files."];
  const engineerReviewChecklist = scopedPaths.length > 0
    ? [
        `The targeted change in ${scopedPathText} satisfies the requested slice.`,
        "Focused validation evidence matches the requested acceptance bar.",
      ]
    : [
        "The targeted change satisfies the requested slice.",
        "Focused validation evidence matches the requested acceptance bar.",
      ];

  switch (requirement.key) {
    case "assignment_supervisor":
    case "reassignment_supervisor":
      return [
        {
          label: "Minimal REASSIGN_TASK example",
          body: {
            messageType: "REASSIGN_TASK",
            sender,
            recipients: [
              {
                recipientType: "agent",
                recipientId: "$TARGET_ASSIGNEE_AGENT_ID",
                role: "engineer",
              },
            ],
            workflowStateBefore: "assigned",
            workflowStateAfter: "assigned",
            summary: "Route this issue into the correct execution lane.",
            payload: {
              reason: "Clarified scope and delegated implementation to the owned project lane.",
              newAssigneeAgentId: "$TARGET_ASSIGNEE_AGENT_ID",
            },
            artifacts: [],
          },
        },
        {
          label: "Minimal ESCALATE_BLOCKER example",
          body: {
            messageType: "ESCALATE_BLOCKER",
            sender,
            recipients: [
              {
                recipientType: "role_group",
                recipientId: "human_board",
                role: "human_board",
              },
            ],
            workflowStateBefore: "assigned",
            workflowStateAfter: "blocked",
            summary: "Escalate because the correct execution owner is still unclear.",
            payload: {
              blockerCode: "needs_human_decision",
              blockingReason: "The issue needs an explicit routing decision before implementation starts.",
              requestedAction: "Clarify the target owner and reviewer, then reassign the task.",
              requestedFrom: "human_board",
            },
            artifacts: [],
          },
        },
      ];
    case "assignment_engineer":
    case "reassignment_engineer":
      return [
        {
          label: "Minimal ACK_ASSIGNMENT example",
          body: {
            messageType: "ACK_ASSIGNMENT",
            sender,
            recipients,
            workflowStateBefore: "assigned",
            workflowStateAfter: "accepted",
            summary: "Accepted the assignment and confirmed scope.",
            payload: {
              accepted: true,
              understoodScope: engineerScopeSummary,
              initialRisks: [
                engineerRiskSummary,
              ],
            },
            artifacts: [],
          },
        },
        {
          label: "Follow-up START_IMPLEMENTATION example",
          body: {
            messageType: "START_IMPLEMENTATION",
            sender,
            recipients,
            workflowStateBefore: "accepted",
            workflowStateAfter: "implementing",
            summary: "Starting the targeted implementation after accepting scope.",
            payload: {
              implementationMode: "direct",
              activeHypotheses: [
                engineerHypothesisSummary,
              ],
            },
            artifacts: [],
          },
        },
      ];
    case "implementation_engineer":
      return [
        {
          label: "Minimal ASK_CLARIFICATION example",
          body: {
            messageType: "ASK_CLARIFICATION",
            sender,
            recipients: [],
            workflowStateBefore: "implementing",
            workflowStateAfter: "implementing",
            summary: "Need the exact implementation acceptance command before continuing.",
            payload: {
              questionType: "implementation",
              question:
                "The exact acceptance step that should run before review is still unclear. Which command or artifact should I use to continue?",
              blocking: true,
              requestedFrom: "human_board",
            },
            artifacts: [],
          },
        },
        {
          label: "Minimal REPORT_PROGRESS example",
          body: {
            messageType: "REPORT_PROGRESS",
            sender,
            recipients,
            workflowStateBefore: "implementing",
            workflowStateAfter: "implementing",
            summary: "Progress update with current file targets and remaining validation.",
            payload: {
              progressPercent: 50,
              completedItems: [
                engineerProgressSummary,
              ],
              nextSteps: [
                "Apply the focused implementation patch.",
                "Run the required focused validation command from the current brief.",
              ],
              risks: [
                engineerRiskSummary,
              ],
              changedFiles: scopedPaths,
              testSummary: null,
            },
            artifacts: [],
          },
        },
        {
          label: "Minimal SUBMIT_FOR_REVIEW example",
          body: {
            messageType: "SUBMIT_FOR_REVIEW",
            sender,
            recipients,
            workflowStateBefore: "implementing",
            workflowStateAfter: "submitted_for_review",
            summary: "Implementation is ready for review with focused validation evidence.",
            payload: {
              implementationSummary: "Implemented the requested focused slice and prepared review evidence for the targeted files.",
              evidence: engineerReviewEvidence,
              reviewChecklist: engineerReviewChecklist,
              changedFiles: scopedPaths,
              testResults: [
                "Run the focused validation command from the current brief and capture the result.",
              ],
              residualRisks: [
                engineerRiskSummary,
              ],
              diffSummary: "Applied the focused patch and aligned regression coverage with the requested slice.",
            },
            artifacts: [],
          },
        },
      ];
    case "change_request_engineer":
      return [
        {
          label: "Minimal ACK_CHANGE_REQUEST example",
          body: {
            messageType: "ACK_CHANGE_REQUEST",
            sender,
            recipients,
            workflowStateBefore: "changes_requested",
            workflowStateAfter: "implementing",
            summary: "Acknowledged the change request and resumed implementation.",
            payload: {
              acknowledged: true,
              changeRequestIds: [
                "review-item-1",
              ],
              plannedFixOrder: [
                "Address the failing review point first.",
              ],
            },
            artifacts: [],
          },
        },
      ];
    case "review_reviewer":
      return [
        {
          label: "Minimal START_REVIEW example",
          body: {
            messageType: "START_REVIEW",
            sender,
            recipients,
            workflowStateBefore: "submitted_for_review",
            workflowStateAfter: "under_review",
            summary: "Started review on the submitted implementation.",
            payload: {
              reviewCycle: 1,
              reviewFocus: [
                "Acceptance criteria coverage",
                "Focused test evidence",
              ],
              blockingReview: false,
            },
            artifacts: [],
          },
        },
        {
          label: "Minimal APPROVE_IMPLEMENTATION example",
          body: {
            messageType: "APPROVE_IMPLEMENTATION",
            sender,
            recipients,
            workflowStateBefore: "under_review",
            workflowStateAfter: "approved",
            summary: "Implementation satisfies the requested scope and evidence bar.",
            payload: {
              approvalSummary: "Reviewed the patch, focused tests, and residual risks; approval is granted.",
              approvalMode: "agent_review",
              approvalChecklist: [
                "Acceptance criteria are covered.",
                "Focused validation evidence is present.",
              ],
              verifiedEvidence: [
                "Focused test command passed.",
              ],
              residualRisks: [
                "Any remaining risk should be limited to follow-up validation outside this focused slice.",
              ],
            },
            artifacts: [],
          },
        },
      ];
    case "qa_gate_reviewer":
      return [
        {
          label: "Minimal QA START_REVIEW example",
          body: {
            messageType: "START_REVIEW",
            sender,
            recipients,
            workflowStateBefore: "qa_pending",
            workflowStateAfter: "under_qa_review",
            summary: "Started QA execution review against the submitted implementation.",
            payload: {
              reviewFocus: [
                "Execute the acceptance criteria command",
                "Confirm the output matches the expected QA signal",
              ],
              blockingReview: false,
            },
            artifacts: [],
          },
        },
        {
          label: "Minimal QA APPROVE_IMPLEMENTATION example",
          body: {
            messageType: "APPROVE_IMPLEMENTATION",
            sender,
            recipients,
            workflowStateBefore: "under_qa_review",
            workflowStateAfter: "approved",
            summary: "QA execution evidence satisfies the acceptance bar.",
            payload: {
              approvalSummary: "Ran the acceptance check and the observed output matches the expected QA result.",
              approvalMode: "agent_review",
              approvalChecklist: [
                "Primary acceptance command completed successfully.",
                "Observed output matches the expected runtime behavior.",
              ],
              verifiedEvidence: [
                "Acceptance command exited successfully.",
              ],
              residualRisks: [
                "Operational merge ownership remains external to the QA lane.",
              ],
              executionLog: "Run the documented acceptance command and capture the observed output.",
              outputVerified: "Observed output matches the expected QA success signal.",
              sanityCommand: "",
            },
            artifacts: [],
          },
        },
      ];
    case "approval_tech_lead":
      return [
        {
          label: "Minimal CLOSE_TASK example",
          body: {
            messageType: "CLOSE_TASK",
            sender,
            recipients,
            workflowStateBefore: "approved",
            workflowStateAfter: "done",
            summary: "Closed the task after reviewer approval and verification review.",
            payload: {
              closeReason: "completed",
              closureSummary: "Shipped the requested implementation and completed the review loop.",
              verificationSummary: "Focused tests passed and reviewer approval was recorded before closure.",
              rollbackPlan: "Revert the focused patch and restore the previous behavior if this slice regresses.",
              finalArtifacts: [
                "diff artifact attached",
                "test_run artifact attached",
                "approval recorded in protocol",
              ],
              finalTestStatus: "passed",
              mergeStatus: "merge_not_required",
              remainingRisks: [
                "Any remaining risk should be limited to follow-up validation outside this focused slice.",
              ],
            },
            artifacts: [],
          },
        },
      ];
    default:
      return [];
  }
}

export function renderSquadrailRuntimeNote(input: {
  env: Record<string, string>;
  context: Record<string, unknown>;
}) {
  const runtimeKeys = Object.keys(input.env)
    .filter((key) => key.startsWith("SQUADRAIL_"))
    .sort();

  const issueId = nonEmptyString(input.context.issueId) ?? nonEmptyString(input.context.taskId);
  const wakeReason = nonEmptyString(input.context.wakeReason);
  const protocolMessageType = nonEmptyString(input.context.protocolMessageType);
  const workflowBefore = nonEmptyString(input.context.protocolWorkflowStateBefore);
  const workflowAfter = nonEmptyString(input.context.protocolWorkflowStateAfter);
  const protocolSummary = nonEmptyString(input.context.protocolSummary);
  const protocolRecipientRole = nonEmptyString(input.context.protocolRecipientRole);
  const protocolSenderRole = nonEmptyString(input.context.protocolSenderRole);
  const protocolRequiredRetryCount =
    typeof input.context.protocolRequiredRetryCount === "number"
    && Number.isFinite(input.context.protocolRequiredRetryCount)
      ? input.context.protocolRequiredRetryCount
      : 0;
  const protocolProgressFollowupCount =
    typeof input.context.protocolProgressFollowupCount === "number"
    && Number.isFinite(input.context.protocolProgressFollowupCount)
      ? input.context.protocolProgressFollowupCount
      : 0;
  const protocolRequiredPreviousRunId = nonEmptyString(input.context.protocolRequiredPreviousRunId);
  const protocolProgressPreviousRunId = nonEmptyString(input.context.protocolProgressPreviousRunId);
  const timeoutCode = nonEmptyString(input.context.timeoutCode);
  const reminderCode = nonEmptyString(input.context.reminderCode);
  const latestBriefId = nonEmptyString(input.context.latestBriefId);
  const latestBriefScope = nonEmptyString(input.context.latestBriefScope);
  const retrievalRunId = nonEmptyString(input.context.retrievalRunId);
  const workspaceContext = parseObject(input.context.squadrailWorkspace);
  const workspaceUsage = nonEmptyString(workspaceContext.workspaceUsage);
  const workspaceSource = nonEmptyString(workspaceContext.source);
  const workspaceBranchName = nonEmptyString(workspaceContext.branchName);
  const protocolPayload = parseObject(input.context.protocolPayload);
  const enrichedProtocolPayload: Record<string, unknown> = {
    ...(nonEmptyString(input.context.techLeadAgentId)
      ? { techLeadAgentId: nonEmptyString(input.context.techLeadAgentId) }
      : {}),
    ...(nonEmptyString(input.context.primaryEngineerAgentId)
      ? { primaryEngineerAgentId: nonEmptyString(input.context.primaryEngineerAgentId) }
      : {}),
    ...(nonEmptyString(input.context.reviewerAgentId)
      ? { reviewerAgentId: nonEmptyString(input.context.reviewerAgentId) }
      : {}),
    ...(nonEmptyString(input.context.qaAgentId)
      ? { qaAgentId: nonEmptyString(input.context.qaAgentId) }
      : {}),
    ...protocolPayload,
  };
  const protocolPayloadKeys = Object.keys(enrichedProtocolPayload).sort();
  const protocolPayloadVerifiedEvidence = asStringArray(enrichedProtocolPayload.verifiedEvidence);
  const reviewSubmission = parseObject(input.context.reviewSubmission);
  const reviewSubmissionChangedFiles = asStringArray(reviewSubmission.changedFiles);
  const reviewSubmissionChecklist = asStringArray(reviewSubmission.reviewChecklist);
  const reviewSubmissionEvidence = asStringArray(reviewSubmission.evidence);
  const reviewSubmissionTestResults = asStringArray(reviewSubmission.testResults);
  const reviewSubmissionResidualRisks = asStringArray(reviewSubmission.residualRisks);
  const reviewSubmissionImplementationSummary = nonEmptyString(reviewSubmission.implementationSummary);
  const reviewSubmissionDiffSummary = nonEmptyString(reviewSubmission.diffSummary);
  const reviewSubmissionWorkspace = parseObject(reviewSubmission.implementationWorkspace);
  const reviewSubmissionWorkspaceCwd = nonEmptyString(reviewSubmissionWorkspace.cwd);
  const reviewSubmissionDiffArtifact = parseObject(reviewSubmission.diffArtifact);
  const reviewSubmissionDiffLabel = nonEmptyString(reviewSubmissionDiffArtifact.label);
  const reviewSubmissionVerificationArtifacts = parseArray(reviewSubmission.verificationArtifacts)
    .map((item) => parseObject(item))
    .filter((item) => Object.keys(item).length > 0);
  const taskBrief = parseObject(input.context.taskBrief);
  const taskBriefScope = nonEmptyString(taskBrief.scope);
  const taskBriefContent = nonEmptyString(taskBrief.contentMarkdown);
  const taskBriefEvidence = parseArray(taskBrief.evidence)
    .map((item) => parseObject(item))
    .filter((item) => Object.keys(item).length > 0);
  const briefRefreshScope = latestBriefScope ?? taskBriefScope ?? "engineer";

  const protocolRequirement = resolveProtocolRunRequirement({
    protocolMessageType,
    protocolRecipientRole,
  });
  const requiredActionLines = (() => {
    if (!protocolRequirement) return [] as string[];

    const requiredMessageTypes = protocolRequirement.requiredMessageTypes.join(", ");
    const firstActionMessageTypes = protocolRequirement.firstActionMessageTypes.join(", ");
    const lines = [
      `- REQUIRED WORKFLOW GATE: this wake expects ${protocolRequirement.description}.`,
      `- The first protocol action before repository work must be one of: ${firstActionMessageTypes}.`,
      `- Before ending this run, you must persist at least one of: ${requiredMessageTypes}.`,
      "- Plain analysis text is not sufficient, and repo inspection does not count as protocol progress.",
      "- If this run ends without the required protocol message, Squadrail will mark the run failed.",
      `- Use the local helper for protocol transitions: \`${formatProtocolHelperCommand("<command>")}\`.`,
      "- Do not handcraft Python/curl/urllib/fetch POSTs for protocol messages in this run.",
      "- Any ad-hoc POST to `/protocol/messages` counts as a workflow failure when the helper supports that transition.",
      "- If the helper fails or times out for a supported protocol action, report the blocker and stop instead of retrying with ad-hoc HTTP.",
    ];

    if (
      protocolRequirement.key === "assignment_supervisor"
      || protocolRequirement.key === "reassignment_supervisor"
    ) {
      lines.splice(3, 0, "- You are explicitly allowed to route this issue with `REASSIGN_TASK`.");
      lines.splice(4, 0, "- Your first shell action in this lane should be the concrete helper command shown below.");
      lines.splice(4, 0, "- Do not inspect repository files, search the codebase, or draft implementation notes before the first routing action is recorded.");
      lines.push("- Prefer `REASSIGN_TASK` when the correct execution owner and reviewer are already named in the issue, brief, or assignment payload.");
      lines.push("- Use the local helper command shown in the issue description when available; it is safer than ad-hoc API calls.");
      lines.push("- If ownership is genuinely unclear, use `ASK_CLARIFICATION` or `ESCALATE_BLOCKER` with the missing decision called out explicitly.");
    }

    if (
      protocolRequirement.key === "assignment_engineer"
      || protocolRequirement.key === "reassignment_engineer"
    ) {
      lines.splice(3, 0, "- Do not start file reads, design notes, or implementation planning before the first protocol action is sent.");
      lines.push("- Your first shell action in this lane should be the concrete helper command shown below.");
      lines.push("- If you accept and can continue immediately, follow `ACK_ASSIGNMENT` with `START_IMPLEMENTATION` in the same run.");
      lines.push("- Do not stop after `ACK_ASSIGNMENT` while the issue is still in `assigned` or `accepted`. ACK-only runs are incomplete and will be retried.");
      lines.push("- After `START_IMPLEMENTATION`, the server coalesces workspace context automatically via `workspaceUsageOverride`. Continue implementing in this run without waiting for a separate wake.");
      lines.push("- If the workspace is shared or analysis-only and no override is present, complete the protocol actions (ACK + START) and stop. The server routes your next wake to an isolated implementation workspace.");
    }

    if (protocolRequirement.key === "implementation_engineer") {
      lines.push("- Work only inside the isolated implementation workspace and finish with review handoff or explicit progress.");
      lines.push("- Stay inside the assigned issue scope. Do not make opportunistic cleanup, refactors, or warning-only fixes outside the requested acceptance criteria.");
      lines.push("- Do not open `SKILL.md`, run helper `--help`, or rediscover Squadrail transport usage in this lane. The runtime note and helper command forms below already define the contract.");
      lines.push("- Do not use the `squadrail` skill in this lane and do not inspect any file under the repository `skills/` directory or the helper source file path itself. Read the cited repository files and execute the cited verification commands instead.");
      lines.push("- `REPORT_PROGRESS` is not mandatory, but if this run will take more than a quick edit-to-review pass, send one early progress update as soon as you can name the target files, acceptance command, or concrete implementation hypothesis.");
      lines.push("- A valid early `REPORT_PROGRESS` may describe the intended file edits and planned focused verification even before the first patch is written.");
      lines.push("- If the acceptance scope is already clear, prefer going straight from `START_IMPLEMENTATION` to focused edits, the required verification command, and `SUBMIT_FOR_REVIEW` in the same run.");
      lines.push("- Do not stop after `REPORT_PROGRESS`. Progress-only runs without concrete edits, focused validation, or review handoff are incomplete and will be retried.");
      lines.push("- Do not spend a long turn reading files, searching the repository, or drafting notes without recording either `REPORT_PROGRESS`, `ASK_CLARIFICATION`, or `SUBMIT_FOR_REVIEW`.");
      lines.push("- Run only the exact test suite, build, or lint commands needed to verify acceptance criteria. Do not run golangci-lint, repo-wide lint, complexity checks, or unrelated validation.");
      lines.push("- Once the required edits are complete and the named acceptance tests pass, submit for review immediately instead of continuing with extra tooling.");
      lines.push("- After the focused verification command succeeds, your next protocol action should be the concrete `submit-for-review` helper command shown below.");
      lines.push("- Do not spend another turn drafting a prose recap, re-reading files, or searching for more context after the acceptance command is green.");
      lines.push("- If a non-required command fails after the acceptance criteria are already satisfied, do not widen scope chasing it; hand off with the exact required evidence.");
      lines.push("- For `SUBMIT_FOR_REVIEW`, use `workflowStateAfter: \"submitted_for_review\"` exactly.");
      lines.push("- `SUBMIT_FOR_REVIEW.recipients` must include the assigned reviewer agent with role `reviewer`. Reuse the reviewer from the assignment payload or current protocol state.");
      lines.push("- `SUBMIT_FOR_REVIEW.payload` must stay flat. Use only: `implementationSummary`, `evidence[]`, `diffSummary`, `changedFiles[]`, `testResults[]`, `reviewChecklist[]`, `residualRisks[]`, and optional `evidenceCitations[]`.");
      lines.push("- Prefer explicit helper flags over raw `--payload` JSON when test commands or checklist text contain quotes or shell metacharacters.");
      lines.push("- When the brief or retrieval evidence drove your handoff, include `evidenceCitations[]` with the current `retrievalRunId`, at least one cited path or hit rank, and the cited `sourceType` when the brief shows it.");
      lines.push("- If the next acceptance step is still unclear, send `ASK_CLARIFICATION` with `--question-type \"implementation\"` before more file reads or progress-only updates.");
      lines.push("- Use the concrete `ask-clarification` helper form below when you need an execution decision; do not omit `--question-type` or `--question`.");
      lines.push("- `changedFiles` must be a string array of file paths. Do not send objects inside `changedFiles`.");
      lines.push("- Do not invent nested objects such as `testEvidence`, structured `diffSummary`, `acceptanceCriteriaMet`, or custom residual-risk objects.");
      lines.push("- Prefer leaving `artifacts` empty unless you have a real `diff` or `commit` artifact URI. Squadrail auto-captures `run`, `test_run`, and `build_run` context.");
    }

    if (protocolRequirement.key === "change_request_engineer") {
      lines.push("- Your first shell action in this lane should be the concrete helper command shown below.");
      lines.push("- Read the full change request details from `protocolPayload.changeRequests[]`, `protocolPayload.reviewSummary`, and `protocolPayload.requiredEvidence[]` before touching code.");
      lines.push("- Treat each requested file target and required evidence item as mandatory scope for the follow-up patch.");
      lines.push("- If you complete the requested fixes in this run, finish with `SUBMIT_FOR_REVIEW` instead of plain text.");
    }

    if (protocolRequirement.key === "review_reviewer") {
      lines.push("- Your first shell action in this lane should be the concrete helper command shown below.");
      lines.push("- Start review with `START_REVIEW`, then conclude with `APPROVE_IMPLEMENTATION`, `REQUEST_CHANGES`, or `REQUEST_HUMAN_DECISION`.");
      lines.push("- Do not stop after `START_REVIEW` while the issue remains in `submitted_for_review` or `under_review`. Review-start-only runs are incomplete and will be retried.");
      lines.push("- Review artifacts first. The shared review workspace may still reflect base HEAD and can differ from the isolated implementation workspace.");
      lines.push("- Do not reject solely because the shared workspace file still shows the pre-change content; verify against the submitted diff, changed files, evidence, and implementation workspace binding.");
      lines.push("- If you need to inspect exact implementation files, use the implementation workspace path from the review submission context rather than assuming the shared workspace contains the patch.");
      lines.push("- If the submitted checklist, focused tests, and changed files are coherent and no concrete blocker remains, prefer `APPROVE_IMPLEMENTATION` over `REQUEST_HUMAN_DECISION`.");
      lines.push("- Reserve `REQUEST_HUMAN_DECISION` for true ambiguity: contradictory artifacts, missing verification evidence, or an approval decision that cannot be made from the submitted diff/evidence.");
      lines.push("- For `REQUEST_CHANGES`, keep `payload` flat and use only `severity`, `reviewSummary`, `changeRequests[]`, `requiredEvidence[]`, `mustFixBeforeApprove`, and optional `evidenceCitations[]`.");
      lines.push("- For `APPROVE_IMPLEMENTATION`, keep `payload` flat and use only `approvalSummary`, `approvalMode`, `approvalChecklist[]`, `verifiedEvidence[]`, `residualRisks[]`, and optional `evidenceCitations[]`.");
      lines.push("- When your review decision depends on brief evidence, cite it with `evidenceCitations[]` using `retrievalRunId`, at least one cited path or hit rank, and the cited `sourceType` when the brief shows it.");
      lines.push("- Valid `approvalMode` values are exactly: `agent_review`, `tech_lead_review`, or `human_override`.");
    }

    if (protocolRequirement.key === "qa_gate_reviewer") {
      if (workflowBefore === "under_qa_review") {
        lines.push("- QA review is already open. Your first shell action in this lane should be the reviewer-approved verification command, not another `START_REVIEW`.");
      } else {
        lines.push("- Your first shell action in this lane should be the concrete helper command shown below.");
      }
      lines.push("- You are the QA execution gate reviewer. Your role is to EXECUTE the built software, not just read code or diffs.");
      lines.push("- **Do not create, edit, or delete any source files.** You have implementation workspace access for running commands only. Code changes are the engineer's responsibility.");
      lines.push("- Do not stop after `START_REVIEW` while the issue remains in `qa_pending` or `under_qa_review`. QA-start-only runs are incomplete and will be retried.");
      lines.push("- Start by reading the project runbook from your brief. If no runbook is available, send `ASK_CLARIFICATION` requesting execution instructions before approving.");
      lines.push("- If `protocolPayload.verifiedEvidence[]` is present, start with the first reviewer-approved verification command before inventing a new QA probe.");
      lines.push("- Run the acceptance criteria commands or sanity checks in the project workspace. Record what you ran and what you observed.");
      lines.push("- Do not approve based on code reading alone. You must execute at least one verification command.");
      lines.push("- If the reviewer-approved verification command passes and the observed output matches the acceptance signal, prefer `APPROVE_IMPLEMENTATION` over `REQUEST_HUMAN_DECISION`.");
      if (workflowBefore !== "under_qa_review") {
        lines.push("- For `START_REVIEW`, describe your execution plan: which commands, fixtures, or probes you will use.");
      }
      lines.push("- For `APPROVE_IMPLEMENTATION`, include execution evidence in payload: `executionLog` (commands run + output), `outputVerified` (expected vs actual), `sanityCommand` (primary check command; reuse the reviewer-approved command when possible), optional `fixtureUsed`, and optional `evidenceCitations[]` with `sourceType` when the brief shows it.");
      lines.push("- For `REQUEST_CHANGES`, include the failure output as evidence: `executionLog` (failed command + output), `failureEvidence` (what went wrong), `expectedBehavior` (what should have happened), and optional `evidenceCitations[]` with `sourceType` when the brief shows it.");
    }

    if (protocolRequirement.key === "approval_tech_lead") {
      lines.push("- Your first shell action in this lane should be the concrete helper command shown below.");
      lines.push("- Approval wakes are not complete until a closing decision is recorded in protocol.");
      lines.push("- Do not idle in `approved`. Record `CLOSE_TASK` or `REQUEST_HUMAN_DECISION` in the same run.");
      lines.push("- For `CLOSE_TASK.payload.mergeStatus`, use exactly one of: `merged`, `merge_not_required`, `pending_external_merge`.");
      lines.push("- Never invent aliases such as `merge_pending`, `merge_required`, or free-form merge labels.");
      lines.push("- If code is approved but merge has not happened yet, use `pending_external_merge` and explain the external merge owner in `remainingRisks[]`.");
      lines.push("- If closure is based on retrieval-backed evidence or review briefs, include `evidenceCitations[]` with the cited retrieval run, path or hit rank, and `sourceType` when known.");
    }

    if (protocolRequiredRetryCount > 0) {
      lines.unshift(
        `- RETRY WARNING: previous run ${protocolRequiredPreviousRunId ?? "unknown"} ended without required protocol progress.`,
      );
      lines.unshift("- RETRY MODE: complete the required protocol action first. Repeating repository inspection without protocol will fail again.");
      if (protocolRequirement?.key === "implementation_engineer") {
        lines.unshift("- IMPLEMENTATION RETRY RULE: inspect the current workspace diff first and reuse any existing edits instead of restarting discovery from scratch.");
        lines.unshift("- IMPLEMENTATION RETRY RULE: if the focused acceptance test is already green or the required diff is already present, submit for review in this run instead of sending another progress-only update.");
      }
    }

    if (protocolProgressFollowupCount > 0 && protocolRequirement?.key === "implementation_engineer") {
      lines.unshift(
        `- FOLLOW-UP WARNING: previous implementation run ${protocolProgressPreviousRunId ?? "unknown"} ended after progress only.`,
      );
      lines.unshift("- FOLLOW-UP MODE: continue from the existing isolated workspace diff and finish with `SUBMIT_FOR_REVIEW` once the focused acceptance command is green.");
      lines.unshift("- FOLLOW-UP MODE: do not restart baseline exploration if the current workspace already contains the required edits or evidence.");
    }

    return lines;
  })();
  const protocolExamples = protocolRequirement ? buildProtocolExampleBodies(protocolRequirement) : [];
  const immediateProtocolCommands = protocolRequirement
    ? buildImmediateProtocolCommandSequence({
      requirement: protocolRequirement,
      issueId,
      protocolPayload: enrichedProtocolPayload,
      runtimeContext: input.context,
      protocolSummary,
      reviewSubmission,
      retrievalRunId,
      taskBriefEvidence,
      workflowBefore,
    })
    : [];
  const shortProtocolLane = isShortProtocolLaneKey(protocolRequirement?.key ?? null);

  if (
    runtimeKeys.length === 0
    && !issueId
    && !wakeReason
    && !protocolMessageType
    && !workflowBefore
    && !workflowAfter
    && !protocolSummary
    && !protocolRecipientRole
    && !protocolSenderRole
    && !timeoutCode
    && !reminderCode
    && !latestBriefId
    && !latestBriefScope
    && !retrievalRunId
    && !taskBriefContent
    && !workspaceUsage
    && !workspaceSource
    && !workspaceBranchName
    && protocolPayloadKeys.length === 0
  ) {
    return "";
  }

  if (shortProtocolLane) {
    const shortLines = ["Squadrail runtime note:"];
    if (immediateProtocolCommands.length > 0) {
      shortLines.push("IMMEDIATE PROTOCOL ACTION:");
      shortLines.push("- Run the first helper command below before any repository inspection or analysis.");
      immediateProtocolCommands.forEach((command, index) => {
        shortLines.push(index === 0 ? "- Run this first:" : "- If the lane still requires progress after the previous command, run this next:");
        shortLines.push("```bash");
        shortLines.push(command.snippet);
        shortLines.push("```");
        shortLines.push(`- Expected protocol message: ${command.messageType}`);
      });
      shortLines.push("- Use only the local helper command path shown above. Do not handcraft HTTP or plain-text status updates.");
      shortLines.push("");
    }

    shortLines.push("SHORT PROTOCOL LANE:");
    shortLines.push("- Treat this wake as protocol-first. Repository inspection is secondary and should not happen before the first helper command succeeds.");
    shortLines.push("- If the helper fails for a supported transition, report a blocker and stop instead of retrying with ad-hoc HTTP.");
    shortLines.push("- Do not open `SKILL.md`, run `--help`, or rediscover helper usage in this lane. The concrete helper commands above are already the contract.");
    shortLines.push("- Do not use the `squadrail` skill in this lane and do not inspect any file under the repository `skills/` directory or the helper source file path unless the runtime note is missing entirely.");
    if (protocolRequirement?.key === "assignment_supervisor" || protocolRequirement?.key === "reassignment_supervisor") {
      shortLines.push("- Route with `REASSIGN_TASK` when the execution owner is clear. Use `ASK_CLARIFICATION` or `ESCALATE_BLOCKER` only when ownership is genuinely unclear.");
    }
    if (protocolRequirement?.key === "review_reviewer") {
      if (workflowBefore === "under_review") {
        shortLines.push("- Review is already open in this lane. Move directly to `APPROVE_IMPLEMENTATION`, `REQUEST_CHANGES`, or `REQUEST_HUMAN_DECISION`.");
      } else {
        shortLines.push("- After `START_REVIEW`, conclude the lane with `APPROVE_IMPLEMENTATION`, `REQUEST_CHANGES`, or `REQUEST_HUMAN_DECISION`.");
      }
      shortLines.push("- If your review decision depends on the brief, cite it with `evidenceCitations[]` using the current `retrievalRunId`, at least one cited path or hit rank, and the cited `sourceType` when the brief shows it.");
      shortLines.push("- If the submitted checklist, focused tests, and changed files are coherent, prefer `APPROVE_IMPLEMENTATION` over `REQUEST_HUMAN_DECISION`.");
    }
    if (protocolRequirement?.key === "qa_gate_reviewer") {
      shortLines.push("- QA must execute the acceptance check before deciding. Do not edit source files in this lane.");
      if (workflowBefore === "under_qa_review") {
        shortLines.push("- QA review is already open in this lane. After rerunning verification, move directly to `APPROVE_IMPLEMENTATION`, `REQUEST_CHANGES`, or `REQUEST_HUMAN_DECISION`.");
      }
      if (protocolPayloadVerifiedEvidence.length > 0) {
        shortLines.push(`- Start with the reviewer-approved verification command: ${protocolPayloadVerifiedEvidence[0]}`);
        shortLines.push("- Do not fetch another brief or re-open helper documentation before running that command unless the command text itself is missing.");
      }
      shortLines.push("- If that verification passes and the observed output matches the expected acceptance signal, prefer `APPROVE_IMPLEMENTATION` over `REQUEST_HUMAN_DECISION`.");
      shortLines.push("- Include execution evidence in the decision payload and add optional `evidenceCitations[]` with `sourceType` when the brief or retrieval evidence guided the QA verdict.");
    }
    if (protocolRequirement?.key === "approval_tech_lead") {
      shortLines.push("- Approval is incomplete until `CLOSE_TASK` or `REQUEST_HUMAN_DECISION` is recorded.");
      shortLines.push("- If closure depends on retrieval-backed evidence or review briefs, include `evidenceCitations[]` with the cited retrieval run, path or hit rank, and `sourceType` when known.");
    }
    shortLines.push("");

    const shortStructuredLines: string[] = [];
    if (issueId) shortStructuredLines.push(`- issueId: ${issueId}`);
    if (wakeReason) shortStructuredLines.push(`- wakeReason: ${wakeReason}`);
    if (protocolMessageType) shortStructuredLines.push(`- protocolMessageType: ${protocolMessageType}`);
    if (workflowBefore || workflowAfter) {
      shortStructuredLines.push(`- protocolWorkflow: ${workflowBefore ?? "unknown"} -> ${workflowAfter ?? "unknown"}`);
    }
    if (protocolRecipientRole) shortStructuredLines.push(`- protocolRecipientRole: ${protocolRecipientRole}`);
    if (protocolSummary) shortStructuredLines.push(`- protocolSummary: ${protocolSummary}`);
    if (shortStructuredLines.length > 0) {
      shortLines.push("Structured wake context:");
      shortLines.push(...shortStructuredLines);
      shortLines.push("");
    }

    if (protocolRequirement?.key === "qa_gate_reviewer" && protocolPayloadVerifiedEvidence.length > 0) {
      shortLines.push("Reviewer-approved verification inputs:");
      for (const entry of protocolPayloadVerifiedEvidence.slice(0, 3)) {
        shortLines.push(`- ${entry}`);
      }
      shortLines.push("");
    }

    if (protocolRequirement?.key === "review_reviewer" && Object.keys(reviewSubmission).length > 0) {
      shortLines.push("Review submission context:");
      if (reviewSubmissionImplementationSummary) {
        shortLines.push(`- implementationSummary: ${reviewSubmissionImplementationSummary}`);
      }
      if (reviewSubmissionDiffSummary) {
        shortLines.push(`- diffSummary: ${reviewSubmissionDiffSummary}`);
      }
      if (reviewSubmissionChangedFiles.length > 0) {
        shortLines.push(`- changedFiles: ${reviewSubmissionChangedFiles.slice(0, 5).join(", ")}`);
      }
      if (reviewSubmissionWorkspaceCwd) {
        shortLines.push(`- implementationWorkspace: ${reviewSubmissionWorkspaceCwd}`);
      }
      shortLines.push("");
    }

    if (taskBriefEvidence.length > 0) {
      shortLines.push("Task brief evidence summary:");
      for (const evidence of taskBriefEvidence.slice(0, 3)) {
        const rank = typeof evidence.rank === "number" ? `#${evidence.rank}` : "#?";
        const sourceType = nonEmptyString(evidence.sourceType) ?? "unknown";
        const pathValue = nonEmptyString(evidence.path);
        const titleValue = nonEmptyString(evidence.title);
        const symbolName = nonEmptyString(evidence.symbolName);
        const parts = [rank, sourceType];
        if (pathValue) parts.push(pathValue);
        else if (titleValue) parts.push(titleValue);
        if (symbolName) parts.push(`symbol=${symbolName}`);
        shortLines.push(`- ${parts.join(" | ")}`);
      }
      shortLines.push("");
    }

    shortLines.push("Record the required protocol progress in this lane before ending the run.");
    shortLines.push("", "");
    return shortLines.join("\n");
  }

  const lines = ["Squadrail runtime note:"];
  if (immediateProtocolCommands.length > 0) {
    lines.push("IMMEDIATE PROTOCOL ACTION:");
    lines.push("- Before any analysis, repository inspection, or planning, run the exact shell command(s) below.");
    immediateProtocolCommands.forEach((command, index) => {
      if (index === 0) {
        lines.push("- Run this first:");
      } else {
        lines.push("- If the previous command succeeds and the issue remains in the same lane, run this next in the same run:");
      }
      lines.push("```bash");
      lines.push(command.snippet);
      lines.push("```");
      lines.push(`- Expected protocol message: ${command.messageType}`);
    });
    lines.push("- Do not replace these commands with ad-hoc HTTP, Python, or plain-text status updates.");
    lines.push("");
  }
  if (runtimeKeys.length > 0) {
    lines.push(`Available Squadrail-compatible environment variables: ${runtimeKeys.join(", ")}`);
  }

  const structuredLines: string[] = [];
  if (issueId) structuredLines.push(`- issueId: ${issueId}`);
  if (wakeReason) structuredLines.push(`- wakeReason: ${wakeReason}`);
  if (protocolMessageType) structuredLines.push(`- protocolMessageType: ${protocolMessageType}`);
  if (workflowBefore || workflowAfter) {
    structuredLines.push(`- protocolWorkflow: ${workflowBefore ?? "unknown"} -> ${workflowAfter ?? "unknown"}`);
  }
  if (protocolRecipientRole) structuredLines.push(`- protocolRecipientRole: ${protocolRecipientRole}`);
  if (protocolSenderRole) structuredLines.push(`- protocolSenderRole: ${protocolSenderRole}`);
  if (protocolSummary) structuredLines.push(`- protocolSummary: ${protocolSummary}`);
  if (timeoutCode) structuredLines.push(`- timeoutCode: ${timeoutCode}`);
  if (reminderCode) structuredLines.push(`- reminderCode: ${reminderCode}`);
  if (latestBriefScope) structuredLines.push(`- latestBriefScope: ${latestBriefScope}`);
  if (latestBriefId) structuredLines.push(`- latestBriefId: ${latestBriefId}`);
  if (retrievalRunId) structuredLines.push(`- retrievalRunId: ${retrievalRunId}`);
  if (taskBriefScope) structuredLines.push(`- taskBriefScope: ${taskBriefScope}`);
  if (workspaceSource) structuredLines.push(`- workspaceSource: ${workspaceSource}`);
  if (workspaceUsage) structuredLines.push(`- workspaceUsage: ${workspaceUsage}`);
  if (workspaceBranchName) structuredLines.push(`- workspaceBranchName: ${workspaceBranchName}`);
  if (protocolPayloadKeys.length > 0) {
    structuredLines.push(`- protocolPayloadKeys: ${protocolPayloadKeys.join(", ")}`);
  }
  if (requiredActionLines.length > 0) {
    const requirementForExamples = protocolRequirement;
    if (!requirementForExamples) {
      throw new Error("Invariant violation: requiredActionLines require a protocol requirement.");
    }
    lines.push("Mandatory protocol gate:");
    lines.push(...requiredActionLines);
    lines.push("");
    if (shortProtocolLane) {
      lines.push("- This is a short protocol lane. Use the immediate helper command block above instead of reviewing additional helper examples.");
      lines.push(`- Protocol transport helper path: ${formatProtocolHelperCommand("<command>")}`);
    } else {
      lines.push(`Use \`${formatProtocolHelperCommand("<command>")}\` for protocol transport.`);
      lines.push("Use the exact helper command forms below; substitute values only and do not handcraft ad-hoc HTTP.");
      for (const example of protocolExamples) {
        const helperSnippet = buildProtocolHelperSnippet(asString(example.body.messageType, ""));
        const concreteHelperSnippet = buildConcreteProtocolHelperSnippet({
          requirement: requirementForExamples,
          issueId,
          body: example.body,
          protocolPayload: enrichedProtocolPayload,
          runtimeContext: input.context,
          protocolSummary,
        });
        const payload = parseObject(example.body.payload);
        const payloadKeys = Object.keys(payload);
        lines.push("");
        lines.push(`${example.label}:`);
        if (concreteHelperSnippet) {
          lines.push("Run this exact command first:");
          lines.push("```bash");
          lines.push(concreteHelperSnippet);
          lines.push("```");
        }
        if (helperSnippet) {
          lines.push("Exact helper command form:");
          lines.push("```bash");
          lines.push(helperSnippet);
          lines.push("```");
        }
        if (payloadKeys.length > 0) {
          lines.push(`Required payload keys: ${payloadKeys.join(", ")}`);
        }
      }
    }
    lines.push("");
  }

  if (
    workspaceUsage
    && workspaceUsage !== "implementation"
    && (protocolRequirement?.key === "assignment_engineer" || protocolRequirement?.key === "reassignment_engineer")
  ) {
    lines.push("Workspace guardrail:");
    lines.push(`- Current workspaceUsage is \`${workspaceUsage}\`, so this run is not the final implementation workspace.`);
    lines.push("- You may acknowledge assignment and start implementation in protocol, but do not modify repository files in this workspace.");
    lines.push("- The server will coalesce workspace context on your next wake. If `workspaceUsageOverride` is provided, you will land in the correct implementation workspace automatically.");
    lines.push("");
  }

  if (workspaceUsage === "implementation") {
    lines.push("Implementation workspace discipline:");
    lines.push("- Start with the target files named in the task brief or evidence summary. Do not spend the run rediscovering task scope through extra API exploration.");
    lines.push("- The task brief content below is the canonical brief for this run.");
    lines.push(`- If you absolutely must refresh the brief, use \`node "${getProtocolHelperVarRef()}" get-brief --issue "$SQUADRAIL_TASK_ID" --scope "${briefRefreshScope}"\`.`);
    lines.push("- Do not use curl, wget, or ad-hoc HTTP to fetch Squadrail issue or brief data.");
    lines.push("- Move from file read -> focused patch -> focused test before any additional environment inspection.");
    lines.push("");
  }

  if (structuredLines.length > 0) {
    lines.push("Structured wake context:");
    lines.push(...structuredLines);
  }

  if (protocolRequirement?.key === "change_request_engineer" && Object.keys(protocolPayload).length > 0) {
    const reviewSummary = nonEmptyString(protocolPayload.reviewSummary);
    const changeRequests = parseArray(protocolPayload.changeRequests)
      .map((item) => parseObject(item))
      .filter((item) => Object.keys(item).length > 0);
    const requiredEvidence = asStringArray(protocolPayload.requiredEvidence);
    lines.push("");
    lines.push("Requested review changes:");
    if (reviewSummary) {
      lines.push(`- reviewSummary: ${reviewSummary}`);
    }
    for (const changeRequest of changeRequests.slice(0, 6)) {
      const title = nonEmptyString(changeRequest.title) ?? "Untitled change request";
      const reason = nonEmptyString(changeRequest.reason);
      const affectedFiles = asStringArray(changeRequest.affectedFiles);
      const suggestedAction = nonEmptyString(changeRequest.suggestedAction);
      lines.push(`- ${title}`);
      if (reason) lines.push(`  reason: ${reason}`);
      if (affectedFiles.length > 0) lines.push(`  affectedFiles: ${affectedFiles.join(", ")}`);
      if (suggestedAction) lines.push(`  suggestedAction: ${suggestedAction}`);
    }
    if (requiredEvidence.length > 0) {
      lines.push("- requiredEvidence:");
      for (const entry of requiredEvidence.slice(0, 8)) {
        lines.push(`  - ${entry}`);
      }
    }
  }

  if (protocolRequirement?.key === "review_reviewer" && Object.keys(reviewSubmission).length > 0) {
    lines.push("");
    lines.push("Review submission context:");
    if (reviewSubmissionImplementationSummary) {
      lines.push(`- implementationSummary: ${reviewSubmissionImplementationSummary}`);
    }
    if (reviewSubmissionDiffSummary) {
      lines.push(`- diffSummary: ${reviewSubmissionDiffSummary}`);
    }
    if (reviewSubmissionChangedFiles.length > 0) {
      lines.push(`- changedFiles: ${reviewSubmissionChangedFiles.join(", ")}`);
    }
    if (reviewSubmissionWorkspaceCwd) {
      lines.push(`- implementationWorkspace: ${reviewSubmissionWorkspaceCwd}`);
    }
    if (reviewSubmissionDiffLabel) {
      lines.push(`- diffArtifact: ${reviewSubmissionDiffLabel}`);
    }
    if (reviewSubmissionChecklist.length > 0) {
      lines.push("- reviewChecklist:");
      for (const entry of reviewSubmissionChecklist.slice(0, shortProtocolLane ? 4 : 8)) {
        lines.push(`  - ${entry}`);
      }
    }
    if (reviewSubmissionEvidence.length > 0) {
      lines.push("- implementationEvidence:");
      for (const entry of reviewSubmissionEvidence.slice(0, shortProtocolLane ? 4 : 8)) {
        lines.push(`  - ${entry}`);
      }
    }
    if (reviewSubmissionTestResults.length > 0) {
      lines.push("- submittedTestResults:");
      for (const entry of reviewSubmissionTestResults.slice(0, shortProtocolLane ? 4 : 8)) {
        lines.push(`  - ${entry}`);
      }
    }
    if (reviewSubmissionVerificationArtifacts.length > 0) {
      lines.push("- verificationArtifacts:");
      for (const artifact of reviewSubmissionVerificationArtifacts.slice(0, shortProtocolLane ? 3 : 6)) {
        const kind = nonEmptyString(artifact.kind) ?? "artifact";
        const label = nonEmptyString(artifact.label);
        const observedStatus = nonEmptyString(artifact.observedStatus) ?? nonEmptyString(artifact.confidence);
        const parts = [kind];
        if (label) parts.push(label);
        if (observedStatus) parts.push(observedStatus);
        lines.push(`  - ${parts.join(" | ")}`);
      }
    }
    if (reviewSubmissionResidualRisks.length > 0) {
      lines.push("- submittedResidualRisks:");
      for (const entry of reviewSubmissionResidualRisks.slice(0, shortProtocolLane ? 3 : 6)) {
        lines.push(`  - ${entry}`);
      }
    }
  }

  if (taskBriefContent) {
    lines.push("");
    if (shortProtocolLane) {
      lines.push("Task brief content omitted in this short protocol lane.");
      lines.push("Use the evidence summary below together with the immediate helper command block above.");
    } else {
      lines.push("Task brief (auto-generated from Squadrail knowledge):");
      lines.push(taskBriefContent);
    }
  }

  if (taskBriefEvidence.length > 0) {
    lines.push("");
    lines.push("Task brief evidence summary:");
    for (const evidence of taskBriefEvidence.slice(0, shortProtocolLane ? 4 : 6)) {
      const rank = typeof evidence.rank === "number" ? `#${evidence.rank}` : "#?";
      const sourceType = nonEmptyString(evidence.sourceType) ?? "unknown";
      const pathValue = nonEmptyString(evidence.path);
      const titleValue = nonEmptyString(evidence.title);
      const symbolName = nonEmptyString(evidence.symbolName);
      const fusedScore =
        typeof evidence.fusedScore === "number" && Number.isFinite(evidence.fusedScore)
          ? evidence.fusedScore.toFixed(3)
          : null;
      const parts = [rank, sourceType];
      if (pathValue) parts.push(pathValue);
      else if (titleValue) parts.push(titleValue);
      if (symbolName) parts.push(`symbol=${symbolName}`);
      if (fusedScore) parts.push(`score=${fusedScore}`);
      lines.push(`- ${parts.join(" | ")}`);
    }
  }

  lines.push(
    "Treat structured protocol wakes as workflow events. Respect your assigned role, use the Squadrail API/env when needed, and avoid inventing status changes outside the protocol.",
    "",
    "",
  );

  return lines.join("\n");
}

export function defaultPathForPlatform() {
  if (process.platform === "win32") {
    return "C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\Wbem";
  }
  return "/usr/local/bin:/opt/homebrew/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin";
}

export function ensurePathInEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (typeof env.PATH === "string" && env.PATH.length > 0) return env;
  if (typeof env.Path === "string" && env.Path.length > 0) return env;
  return { ...env, PATH: defaultPathForPlatform() };
}

export async function ensureAbsoluteDirectory(
  cwd: string,
  opts: { createIfMissing?: boolean } = {},
) {
  if (!path.isAbsolute(cwd)) {
    throw new Error(`Working directory must be an absolute path: "${cwd}"`);
  }

  const assertDirectory = async () => {
    const stats = await fs.stat(cwd);
    if (!stats.isDirectory()) {
      throw new Error(`Working directory is not a directory: "${cwd}"`);
    }
  };

  try {
    await assertDirectory();
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (!opts.createIfMissing || code !== "ENOENT") {
      if (code === "ENOENT") {
        throw new Error(`Working directory does not exist: "${cwd}"`);
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  try {
    await fs.mkdir(cwd, { recursive: true });
    await assertDirectory();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not create working directory "${cwd}": ${reason}`);
  }
}

export async function ensureCommandResolvable(command: string, cwd: string, env: NodeJS.ProcessEnv) {
  const hasPathSeparator = command.includes("/") || command.includes("\\");
  if (hasPathSeparator) {
    const absolute = path.isAbsolute(command) ? command : path.resolve(cwd, command);
    try {
      await fs.access(absolute, fsConstants.X_OK);
    } catch {
      throw new Error(`Command is not executable: "${command}" (resolved: "${absolute}")`);
    }
    return;
  }

  const pathValue = env.PATH ?? env.Path ?? "";
  const delimiter = process.platform === "win32" ? ";" : ":";
  const dirs = pathValue.split(delimiter).filter(Boolean);
  const windowsExt = process.platform === "win32"
    ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];

  for (const dir of dirs) {
    for (const ext of windowsExt) {
      const candidate = path.join(dir, process.platform === "win32" ? `${command}${ext}` : command);
      try {
        await fs.access(candidate, fsConstants.X_OK);
        return;
      } catch {
        // continue scanning PATH
      }
    }
  }

  throw new Error(`Command not found in PATH: "${command}"`);
}

export async function runChildProcess(
  runId: string,
  command: string,
  args: string[],
  opts: {
    cwd: string;
    env: Record<string, string>;
    timeoutSec: number;
    graceSec: number;
    onLog: (stream: "stdout" | "stderr" | "system", chunk: string) => Promise<void>;
    onLogError?: (err: unknown, runId: string, message: string) => void;
    stdin?: string;
  },
): Promise<RunProcessResult> {
  const onLogError = opts.onLogError ?? ((err, id, msg) => console.warn({ err, runId: id }, msg));

  return new Promise<RunProcessResult>((resolve, reject) => {
    const mergedEnv = ensurePathInEnv({ ...process.env, ...opts.env });
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: mergedEnv,
      shell: false,
      stdio: [opts.stdin != null ? "pipe" : "ignore", "pipe", "pipe"],
    }) as ChildProcessWithEvents;

    if (opts.stdin != null && child.stdin) {
      child.stdin.write(opts.stdin);
      child.stdin.end();
    }

    runningProcesses.set(runId, { child, graceSec: opts.graceSec });

    let timedOut = false;
    let stdout = "";
    let stderr = "";
    let logChain: Promise<void> = Promise.resolve();

    const timeout =
      opts.timeoutSec > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            setTimeout(() => {
              if (!child.killed) {
                child.kill("SIGKILL");
              }
            }, Math.max(1, opts.graceSec) * 1000);
          }, opts.timeoutSec * 1000)
        : null;

    child.stdout?.on("data", (chunk: unknown) => {
      const text = String(chunk);
      stdout = appendWithCap(stdout, text);
      logChain = logChain
        .then(() => opts.onLog("stdout", text))
        .catch((err) => onLogError(err, runId, "failed to append stdout log chunk"));
    });

    child.stderr?.on("data", (chunk: unknown) => {
      const text = String(chunk);
      stderr = appendWithCap(stderr, text);
      logChain = logChain
        .then(() => opts.onLog("stderr", text))
        .catch((err) => onLogError(err, runId, "failed to append stderr log chunk"));
    });

    child.on("error", (err: Error) => {
      if (timeout) clearTimeout(timeout);
      runningProcesses.delete(runId);
      const errno = (err as NodeJS.ErrnoException).code;
      const pathValue = mergedEnv.PATH ?? mergedEnv.Path ?? "";
      const msg =
        errno === "ENOENT"
          ? `Failed to start command "${command}" in "${opts.cwd}". Verify adapter command, working directory, and PATH (${pathValue}).`
          : `Failed to start command "${command}" in "${opts.cwd}": ${err.message}`;
      reject(new Error(msg));
    });

    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (timeout) clearTimeout(timeout);
      runningProcesses.delete(runId);
      void logChain.finally(() => {
        resolve({
          exitCode: code,
          signal,
          timedOut,
          stdout,
          stderr,
        });
      });
    });
  });
}
