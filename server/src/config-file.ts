import fs from "node:fs";
import { squadrailConfigSchema, type SquadrailConfig } from "@squadrail/shared";
import { resolveSquadrailConfigPath } from "./paths.js";

export function readConfigFile(): SquadrailConfig | null {
  const configPath = resolveSquadrailConfigPath();

  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return squadrailConfigSchema.parse(raw);
  } catch {
    return null;
  }
}
