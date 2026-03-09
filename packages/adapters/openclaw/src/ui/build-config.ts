import type { CreateConfigValues } from "@squadrail/adapter-utils";

export function buildOpenClawConfig(v: CreateConfigValues): Record<string, unknown> {
  const ac: Record<string, unknown> = {};
  if (v.url) ac.url = v.url;
  ac.method = "POST";
  ac.timeoutSec = 30;
  return ac;
}
