import {
  ensureAgentJwtSecret,
  readAgentJwtSecretFromEnv,
  readAgentJwtSecretFromEnvFile,
  resolveAgentJwtEnvFile,
} from "../config/env.js";
import type { CheckResult } from "./index.js";
import { PRODUCT_NAME, formatCliCommand } from "../utils/branding.js";

export function agentJwtSecretCheck(configPath?: string): CheckResult {
  if (readAgentJwtSecretFromEnv(configPath)) {
    return {
      name: "Agent JWT secret",
      status: "pass",
      message: "SQUADRAIL_AGENT_JWT_SECRET is set in environment",
    };
  }

  const envPath = resolveAgentJwtEnvFile(configPath);
  const fileSecret = readAgentJwtSecretFromEnvFile(envPath);

  if (fileSecret) {
    return {
      name: "Agent JWT secret",
      status: "warn",
      message: `SQUADRAIL_AGENT_JWT_SECRET is present in ${envPath} but not loaded into environment`,
      repairHint: `Set the value from ${envPath} in your shell before starting the ${PRODUCT_NAME} server`,
    };
  }

  return {
    name: "Agent JWT secret",
    status: "fail",
    message: `SQUADRAIL_AGENT_JWT_SECRET missing from environment and ${envPath}`,
    canRepair: true,
    repair: () => {
      ensureAgentJwtSecret(configPath);
    },
    repairHint: `Run \`${formatCliCommand("doctor --repair")}\` to create ${envPath} containing SQUADRAIL_AGENT_JWT_SECRET`,
  };
}
