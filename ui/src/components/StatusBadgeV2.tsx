import { cn } from "@/lib/utils";
import { CheckCircle2, Circle, Clock, AlertTriangle, Ban, Pause } from "lucide-react";

interface StatusBadgeV2Props {
  state: string;
  className?: string;
  showIcon?: boolean;
}

const stateConfig = {
  backlog: {
    label: "Backlog",
    icon: Circle,
    colorClass: "bg-[var(--status-backlog)] border-[var(--status-backlog-border)] text-foreground",
  },
  implementing: {
    label: "Implementing",
    icon: Clock,
    colorClass: "bg-[var(--status-implementing)] border-[var(--status-implementing-border)] text-foreground",
  },
  reviewing: {
    label: "Reviewing",
    icon: Clock,
    colorClass: "bg-[var(--status-reviewing)] border-[var(--status-reviewing-border)] text-foreground",
  },
  approved: {
    label: "Approved",
    icon: CheckCircle2,
    colorClass: "bg-[var(--status-approved)] border-[var(--status-approved-border)] text-foreground",
  },
  blocked: {
    label: "Blocked",
    icon: Ban,
    colorClass: "bg-[var(--status-blocked)] border-[var(--status-blocked-border)] text-white",
  },
  awaiting_human_decision: {
    label: "Awaiting Decision",
    icon: AlertTriangle,
    colorClass: "bg-[var(--status-reviewing)] border-[var(--status-reviewing-border)] text-foreground",
  },
  idle: {
    label: "Idle",
    icon: Pause,
    colorClass: "bg-[var(--status-idle)] border-[var(--status-idle-border)] text-muted-foreground",
  },
} as const;

/**
 * Enhanced status badge with larger size, icon support, and rich colors
 */
export function StatusBadgeV2({ state, className, showIcon = true }: StatusBadgeV2Props) {
  const config = stateConfig[state as keyof typeof stateConfig] || stateConfig.idle;
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors",
        config.colorClass,
        className
      )}
      role="status"
      aria-label={`Status: ${config.label}`}
    >
      {showIcon && <Icon className="h-3.5 w-3.5" />}
      <span>{config.label}</span>
    </div>
  );
}
