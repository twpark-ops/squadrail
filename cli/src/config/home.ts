import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PRIMARY_HOME_DIRNAME } from "../utils/branding.js";

const DEFAULT_INSTANCE_ID = "default";
const INSTANCE_ID_RE = /^[a-zA-Z0-9_-]+$/;

function readEnvAlias(primaryKey: string, legacyKey: string): string | undefined {
  const primaryValue = process.env[primaryKey]?.trim();
  if (primaryValue) return primaryValue;
  const legacyValue = process.env[legacyKey]?.trim();
  return legacyValue || undefined;
}

export function resolveSquadrailHomeDir(): string {
  const envHome = process.env.SQUADRAIL_HOME?.trim();
  if (envHome) return path.resolve(expandHomePrefix(envHome));
  return path.resolve(os.homedir(), PRIMARY_HOME_DIRNAME);
}

export function resolveSquadrailInstanceId(override?: string): string {
  const raw = override?.trim() || process.env.SQUADRAIL_INSTANCE_ID?.trim() || DEFAULT_INSTANCE_ID;
  if (!INSTANCE_ID_RE.test(raw)) {
    throw new Error(
      `Invalid instance id '${raw}'. Allowed characters: letters, numbers, '_' and '-'.`,
    );
  }
  return raw;
}

export function resolveSquadrailInstanceRoot(instanceId?: string): string {
  const id = resolveSquadrailInstanceId(instanceId);
  return path.resolve(resolveSquadrailHomeDir(), "instances", id);
}

export function resolveDefaultConfigPath(instanceId?: string): string {
  return path.resolve(resolveSquadrailInstanceRoot(instanceId), "config.json");
}

export function resolveDefaultContextPath(): string {
  return path.resolve(resolveSquadrailHomeDir(), "context.json");
}

export function resolveDefaultEmbeddedPostgresDir(instanceId?: string): string {
  return path.resolve(resolveSquadrailInstanceRoot(instanceId), "db");
}

export function resolveDefaultLogsDir(instanceId?: string): string {
  return path.resolve(resolveSquadrailInstanceRoot(instanceId), "logs");
}

export function resolveDefaultSecretsKeyFilePath(instanceId?: string): string {
  return path.resolve(resolveSquadrailInstanceRoot(instanceId), "secrets", "master.key");
}

export function resolveDefaultStorageDir(instanceId?: string): string {
  return path.resolve(resolveSquadrailInstanceRoot(instanceId), "data", "storage");
}

export function resolveDefaultBackupDir(instanceId?: string): string {
  return path.resolve(resolveSquadrailInstanceRoot(instanceId), "data", "backups");
}

export function expandHomePrefix(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return value;
}

export function describeLocalInstancePaths(instanceId?: string) {
  const resolvedInstanceId = resolveSquadrailInstanceId(instanceId);
  const instanceRoot = resolveSquadrailInstanceRoot(resolvedInstanceId);
  return {
    homeDir: resolveSquadrailHomeDir(),
    instanceId: resolvedInstanceId,
    instanceRoot,
    configPath: resolveDefaultConfigPath(resolvedInstanceId),
    embeddedPostgresDataDir: resolveDefaultEmbeddedPostgresDir(resolvedInstanceId),
    backupDir: resolveDefaultBackupDir(resolvedInstanceId),
    logDir: resolveDefaultLogsDir(resolvedInstanceId),
    secretsKeyFilePath: resolveDefaultSecretsKeyFilePath(resolvedInstanceId),
    storageDir: resolveDefaultStorageDir(resolvedInstanceId),
  };
}
