import type { UIAdapterModule } from "./types";
import { claudeLocalUIAdapter } from "./claude-local";
import { codexLocalUIAdapter } from "./codex-local";
import { cursorLocalUIAdapter } from "./cursor";
import { openCodeLocalUIAdapter } from "./opencode-local";
import { openClawUIAdapter } from "./openclaw";
import { processUIAdapter } from "./process";
import { httpUIAdapter } from "./http";

const adaptersByType = new Map<string, UIAdapterModule>(
  [claudeLocalUIAdapter, codexLocalUIAdapter, openCodeLocalUIAdapter, cursorLocalUIAdapter, openClawUIAdapter, processUIAdapter, httpUIAdapter].map((a) => [a.type, a]),
);
const primaryAdapterTypes = new Set(["claude_local", "codex_local"]);

export function getUIAdapter(type: string): UIAdapterModule {
  return adaptersByType.get(type) ?? processUIAdapter;
}

export function isPrimaryUIAdapter(type: string): boolean {
  return primaryAdapterTypes.has(type);
}

export function listProductVisibleUIAdapters(): UIAdapterModule[] {
  return Array.from(adaptersByType.values()).filter((adapter) => isPrimaryUIAdapter(adapter.type));
}
