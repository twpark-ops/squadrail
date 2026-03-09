import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_INSTANCE_ID = "default";
const INSTANCE_ID_RE = /^[a-zA-Z0-9_-]+$/;
const PATH_SEGMENT_RE = /^[a-zA-Z0-9_-]+$/;

function expandHomePrefix(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return value;
}

function readAliasEnv(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function resolveSquadrailHomeDir(): string {
  const envHome = readAliasEnv("SQUADRAIL_HOME");
  if (envHome) return path.resolve(expandHomePrefix(envHome));
  return path.resolve(os.homedir(), ".squadrail");
}

export function resolveSquadrailInstanceId(): string {
  const raw = readAliasEnv("SQUADRAIL_INSTANCE_ID") || DEFAULT_INSTANCE_ID;
  if (!INSTANCE_ID_RE.test(raw)) {
    throw new Error(`Invalid SQUADRAIL_INSTANCE_ID '${raw}'.`);
  }
  return raw;
}

export function resolveSquadrailInstanceRoot(): string {
  return path.resolve(resolveSquadrailHomeDir(), "instances", resolveSquadrailInstanceId());
}

export function resolveDefaultConfigPath(): string {
  return path.resolve(resolveSquadrailInstanceRoot(), "config.json");
}

export function resolveDefaultEmbeddedPostgresDir(): string {
  return path.resolve(resolveSquadrailInstanceRoot(), "db");
}

export function resolveDefaultLogsDir(): string {
  return path.resolve(resolveSquadrailInstanceRoot(), "logs");
}

export function resolveDefaultSecretsKeyFilePath(): string {
  return path.resolve(resolveSquadrailInstanceRoot(), "secrets", "master.key");
}

export function resolveDefaultStorageDir(): string {
  return path.resolve(resolveSquadrailInstanceRoot(), "data", "storage");
}

export function resolveDefaultBackupDir(): string {
  return path.resolve(resolveSquadrailInstanceRoot(), "data", "backups");
}

export function resolveDefaultProtocolIntegritySecretFilePath(): string {
  return path.resolve(resolveSquadrailInstanceRoot(), "secrets", "protocol-integrity.secret");
}

export function resolveDefaultAgentWorkspaceDir(agentId: string): string {
  const trimmed = agentId.trim();
  if (!PATH_SEGMENT_RE.test(trimmed)) {
    throw new Error(`Invalid agent id for workspace path '${agentId}'.`);
  }
  return path.resolve(resolveSquadrailInstanceRoot(), "workspaces", trimmed);
}

export function resolveHomeAwarePath(value: string): string {
  return path.resolve(expandHomePrefix(value));
}
