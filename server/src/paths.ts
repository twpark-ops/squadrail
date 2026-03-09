import fs from "node:fs";
import path from "node:path";
import { resolveDefaultConfigPath } from "./home-paths.js";

const SQUADRAIL_CONFIG_BASENAME = "config.json";
const SQUADRAIL_ENV_FILENAME = ".env";

function readAliasEnv(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function findConfigFileFromAncestors(startDir: string): string | null {
  const absoluteStartDir = path.resolve(startDir);
  let currentDir = absoluteStartDir;

  while (true) {
    const squadrailCandidate = path.resolve(currentDir, ".squadrail", SQUADRAIL_CONFIG_BASENAME);
    if (fs.existsSync(squadrailCandidate)) {
      return squadrailCandidate;
    }

    const nextDir = path.resolve(currentDir, "..");
    if (nextDir === currentDir) break;
    currentDir = nextDir;
  }

  return null;
}

export function resolveSquadrailConfigPath(overridePath?: string): string {
  if (overridePath) return path.resolve(overridePath);
  const envConfig = readAliasEnv("SQUADRAIL_CONFIG");
  if (envConfig) return path.resolve(envConfig);
  return findConfigFileFromAncestors(process.cwd()) ?? resolveDefaultConfigPath();
}

export function resolveSquadrailEnvPath(overrideConfigPath?: string): string {
  return path.resolve(path.dirname(resolveSquadrailConfigPath(overrideConfigPath)), SQUADRAIL_ENV_FILENAME);
}
