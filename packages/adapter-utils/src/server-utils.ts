import { spawn, type ChildProcess } from "node:child_process";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";

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
  const protocolPayloadKeys = Object.keys(protocolPayload).sort();
  const taskBrief = parseObject(input.context.taskBrief);
  const taskBriefScope = nonEmptyString(taskBrief.scope);
  const taskBriefContent = nonEmptyString(taskBrief.contentMarkdown);
  const taskBriefEvidence = parseArray(taskBrief.evidence)
    .map((item) => parseObject(item))
    .filter((item) => Object.keys(item).length > 0);

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

  const lines = ["Squadrail runtime note:"];
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
  if (structuredLines.length > 0) {
    lines.push("Structured wake context:");
    lines.push(...structuredLines);
  }

  if (taskBriefContent) {
    lines.push("");
    lines.push("Task brief (auto-generated from Squadrail knowledge):");
    lines.push(taskBriefContent);
  }

  if (taskBriefEvidence.length > 0) {
    lines.push("");
    lines.push("Task brief evidence summary:");
    for (const evidence of taskBriefEvidence.slice(0, 6)) {
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
    onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
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
