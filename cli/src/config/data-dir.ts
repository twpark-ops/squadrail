import path from "node:path";
import {
  expandHomePrefix,
  resolveDefaultConfigPath,
  resolveDefaultContextPath,
  resolveSquadrailInstanceId,
} from "./home.js";

export interface DataDirOptionLike {
  dataDir?: string;
  config?: string;
  context?: string;
  instance?: string;
}

export interface DataDirCommandSupport {
  hasConfigOption?: boolean;
  hasContextOption?: boolean;
}

export function applyDataDirOverride(
  options: DataDirOptionLike,
  support: DataDirCommandSupport = {},
): string | null {
  const rawDataDir = options.dataDir?.trim();
  if (!rawDataDir) return null;

  const resolvedDataDir = path.resolve(expandHomePrefix(rawDataDir));
  process.env.SQUADRAIL_HOME = resolvedDataDir;
  process.env.SQUADRAIL_HOME = resolvedDataDir;

  if (support.hasConfigOption) {
    const hasConfigOverride =
      Boolean(options.config?.trim()) ||
      Boolean(process.env.SQUADRAIL_CONFIG?.trim()) ||
      Boolean(process.env.SQUADRAIL_CONFIG?.trim());
    if (!hasConfigOverride) {
      const instanceId = resolveSquadrailInstanceId(options.instance);
      process.env.SQUADRAIL_INSTANCE_ID = instanceId;
      process.env.SQUADRAIL_INSTANCE_ID = instanceId;
      const defaultConfigPath = resolveDefaultConfigPath(instanceId);
      process.env.SQUADRAIL_CONFIG = defaultConfigPath;
      process.env.SQUADRAIL_CONFIG = defaultConfigPath;
    }
  }

  if (support.hasContextOption) {
    const hasContextOverride =
      Boolean(options.context?.trim()) ||
      Boolean(process.env.SQUADRAIL_CONTEXT?.trim()) ||
      Boolean(process.env.SQUADRAIL_CONTEXT?.trim());
    if (!hasContextOverride) {
      const defaultContextPath = resolveDefaultContextPath();
      process.env.SQUADRAIL_CONTEXT = defaultContextPath;
      process.env.SQUADRAIL_CONTEXT = defaultContextPath;
    }
  }

  return resolvedDataDir;
}
