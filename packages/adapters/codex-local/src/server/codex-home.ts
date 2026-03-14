import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { AdapterExecutionContext } from "@squadrail/adapter-utils";

const DEFAULT_SQUADRAIL_HOME_DIRNAME = ".squadrail";
const DEFAULT_INSTANCE_ID = "default";
const INSTANCE_ID_RE = /^[a-zA-Z0-9_-]+$/;
const SHARED_LINKED_FILES = [
  ".personality_migration",
  "AGENTS.md",
  "auth.json",
  "config.json",
  "config.toml",
  "history.json",
  "history.jsonl",
  "instructions.md",
  "models_cache.json",
  "version.json",
] as const;
const SHARED_LINKED_DIRS = ["memories", "rules"] as const;

function nonEmpty(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function expandHomePrefix(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return value;
}

export async function pathExists(candidate: string): Promise<boolean> {
  return fs.access(candidate).then(() => true).catch(() => false);
}

export function resolveCodexHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = nonEmpty(env.CODEX_HOME);
  if (fromEnv) return path.resolve(expandHomePrefix(fromEnv));
  return path.join(os.homedir(), ".codex");
}

function resolveSquadrailHomeDir(env: NodeJS.ProcessEnv): string {
  const fromEnv = nonEmpty(env.SQUADRAIL_HOME);
  if (fromEnv) return path.resolve(expandHomePrefix(fromEnv));
  return path.resolve(os.homedir(), DEFAULT_SQUADRAIL_HOME_DIRNAME);
}

function resolveSquadrailInstanceId(env: NodeJS.ProcessEnv): string {
  const raw = nonEmpty(env.SQUADRAIL_INSTANCE_ID) ?? DEFAULT_INSTANCE_ID;
  if (!INSTANCE_ID_RE.test(raw)) {
    throw new Error(`Invalid SQUADRAIL_INSTANCE_ID '${raw}'.`);
  }
  return raw;
}

export function resolveInstanceCodexHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const squadrailHome = resolveSquadrailHomeDir(env);
  const instanceId = resolveSquadrailInstanceId(env);
  return path.resolve(squadrailHome, "instances", instanceId, "codex-home");
}

function sanitizeScopeSegment(raw: string): string {
  const trimmed = raw.trim();
  const normalized = trimmed
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const base = normalized.length > 0 ? normalized : "scope";
  const hash = crypto.createHash("sha256").update(trimmed).digest("hex").slice(0, 12);
  return `${base}-${hash}`;
}

export function resolveScopedCodexHomeDir(
  env: NodeJS.ProcessEnv = process.env,
  scopeKey?: string | null,
): string {
  const instanceHome = resolveInstanceCodexHomeDir(env);
  const normalizedScope = typeof scopeKey === "string" && scopeKey.trim().length > 0
    ? sanitizeScopeSegment(scopeKey)
    : null;
  if (!normalizedScope) return instanceHome;
  return path.resolve(path.dirname(instanceHome), "codex-homes", normalizedScope);
}

async function ensureParentDir(target: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
}

async function ensureSharedLink(target: string, source: string): Promise<void> {
  const existing = await fs.lstat(target).catch(() => null);
  if (!existing) {
    await ensureParentDir(target);
    await fs.symlink(source, target);
    return;
  }

  if (existing.isSymbolicLink()) {
    const linkedPath = await fs.readlink(target).catch(() => null);
    if (linkedPath) {
      const resolvedLinkedPath = path.resolve(path.dirname(target), linkedPath);
      if (resolvedLinkedPath === source) return;
    }
  }

  await fs.rm(target, { recursive: true, force: true });
  await ensureParentDir(target);
  await fs.symlink(source, target);
}

export async function prepareScopedCodexHome(
  env: NodeJS.ProcessEnv,
  onLog: AdapterExecutionContext["onLog"],
  options: { scopeKey?: string | null } = {},
): Promise<string | null> {
  const targetHome = resolveScopedCodexHomeDir(env, options.scopeKey);
  const sourceHome = resolveCodexHomeDir(env);
  if (path.resolve(sourceHome) === path.resolve(targetHome)) return targetHome;

  await fs.mkdir(targetHome, { recursive: true });

  for (const name of SHARED_LINKED_FILES) {
    const source = path.join(sourceHome, name);
    if (!(await pathExists(source))) continue;
    await ensureSharedLink(path.join(targetHome, name), source);
  }

  for (const name of SHARED_LINKED_DIRS) {
    const source = path.join(sourceHome, name);
    if (!(await pathExists(source))) continue;
    await ensureSharedLink(path.join(targetHome, name), source);
  }

  await onLog(
    "stderr",
    `[squadrail] Using scoped Codex home "${targetHome}" (seeded from "${sourceHome}").\n`,
  );
  return targetHome;
}
