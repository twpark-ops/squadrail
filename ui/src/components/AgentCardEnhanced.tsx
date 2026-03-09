import { Link } from "@/lib/router";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AgentIcon } from "./AgentIconPicker";
import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";
import type { Agent } from "@squadrail/shared";

interface AgentCardEnhancedProps {
  agent: Agent;
  currentTask?: {
    issueId: string;
    issueTitle: string;
    issueIdentifier?: string;
  };
  isActive: boolean;
  position: { x: number; y: number };
  width: number;
  height: number;
  onClick?: () => void;
}

/**
 * Enhanced Agent Card for Org Chart
 *
 * Features:
 * - Large avatar (48px)
 * - Real-time pulse indicator
 * - Current task display
 * - Clean hover states
 */
export function AgentCardEnhanced({
  agent,
  currentTask,
  isActive,
  position,
  width,
  height,
  onClick,
}: AgentCardEnhancedProps) {
  const adapterLabels: Record<string, string> = {
    claude_local: "Claude",
    codex_local: "Codex",
    opencode_local: "OpenCode",
    cursor: "Cursor",
    openclaw: "OpenClaw",
    process: "Process",
    http: "HTTP",
  };

  return (
    <div
      data-org-card
      className={cn(
        "absolute rounded-xl border-2 shadow-lg overflow-hidden transition-all duration-200",
        "bg-card hover:shadow-xl cursor-pointer select-none",
        isActive
          ? "border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.2)]"
          : "border-border hover:border-foreground/30"
      )}
      style={{
        left: position.x,
        top: position.y,
        width,
        minHeight: height,
      }}
      onClick={onClick}
    >
      {/* Header with gradient for active agents */}
      <div
        className={cn(
          "px-4 py-3 border-b",
          isActive
            ? "bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950/30 dark:to-cyan-950/30 border-blue-200 dark:border-blue-800"
            : "bg-muted/30 border-border/50"
        )}
      >
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <Avatar className="h-12 w-12 shrink-0 border-2 border-background">
            <AvatarFallback className={cn("text-lg font-semibold", isActive ? "bg-blue-100 dark:bg-blue-900" : "bg-muted")}>
              <AgentIcon icon={agent.icon} className="h-6 w-6" />
            </AvatarFallback>
          </Avatar>

          {/* Name & Title */}
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-base truncate">{agent.name}</h3>
            <p className="text-xs text-muted-foreground truncate">{agent.title || "Agent"}</p>
          </div>

          {/* Status Indicator */}
          {isActive ? (
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
            </span>
          ) : (
            <span className="flex h-3 w-3 shrink-0 rounded-full bg-gray-300 dark:bg-gray-600" />
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-3">
        {/* Current Task */}
        {isActive && currentTask ? (
          <div className="space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Working on
            </div>
            <Link
              to={`/issues/${currentTask.issueIdentifier ?? currentTask.issueId}`}
              className="block text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline line-clamp-2"
              onClick={(e) => e.stopPropagation()}
            >
              {currentTask.issueTitle}
            </Link>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic">Idle</div>
        )}

        {/* Adapter Type */}
        <div className="pt-2 border-t border-border/50">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground/70 font-mono">
              {adapterLabels[agent.adapterType] ?? agent.adapterType}
            </span>
            <Link
              to={`/agents/${agent.id}`}
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
