import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { roleLabels, adapterLabels } from "./agent-config-primitives";
import { AgentIcon } from "./AgentIconPicker";
import {
  Bot,
  CheckCircle2,
  Network,
  ShieldCheck,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

type RolePresentation = {
  label: string;
  classLabel: string;
  icon: LucideIcon;
  badgeClassName: string;
  avatarClassName: string;
  iconClassName: string;
};

const leadershipRoles = new Set(["ceo", "cto"]);

function isLeadershipTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  return /(lead|head|chief|director|manager|owner|principal)/i.test(title);
}

export function getAgentRolePresentation(role: string, title?: string | null): RolePresentation {
  if (role === "pm") {
    return {
      label: roleLabels[role] ?? role,
      classLabel: "Planner",
      icon: Sparkles,
      badgeClassName: "border-amber-300/70 bg-amber-500/10 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200",
      avatarClassName: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-200",
      iconClassName: "text-amber-600 dark:text-amber-300",
    };
  }

  if (role === "engineer") {
    return {
      label: roleLabels[role] ?? role,
      classLabel: "Builder",
      icon: Bot,
      badgeClassName: "border-emerald-300/70 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200",
      avatarClassName: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200",
      iconClassName: "text-emerald-600 dark:text-emerald-300",
    };
  }

  if (role === "qa") {
    return {
      label: roleLabels[role] ?? role,
      classLabel: "Verifier",
      icon: CheckCircle2,
      badgeClassName: "border-green-300/70 bg-green-500/10 text-green-700 dark:border-green-500/30 dark:bg-green-500/15 dark:text-green-200",
      avatarClassName: "bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-200",
      iconClassName: "text-green-600 dark:text-green-300",
    };
  }

  if (leadershipRoles.has(role) || isLeadershipTitle(title)) {
    return {
      label: roleLabels[role] ?? role,
      classLabel: "Lead",
      icon: Network,
      badgeClassName: "border-sky-300/70 bg-sky-500/10 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200",
      avatarClassName: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-200",
      iconClassName: "text-sky-600 dark:text-sky-300",
    };
  }

  if (title && /(review|reviewer)/i.test(title)) {
    return {
      label: "Reviewer",
      classLabel: "Reviewer",
      icon: ShieldCheck,
      badgeClassName: "border-violet-300/70 bg-violet-500/10 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-200",
      avatarClassName: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-200",
      iconClassName: "text-violet-600 dark:text-violet-300",
    };
  }

  return {
    label: roleLabels[role] ?? role,
    classLabel: "Crew",
    icon: Users,
    badgeClassName: "border-border bg-background text-muted-foreground",
    avatarClassName: "bg-muted text-foreground",
    iconClassName: "text-muted-foreground",
  };
}

export function AgentRoleBadge({
  role,
  title,
  className,
}: {
  role: string;
  title?: string | null;
  className?: string;
}) {
  const presentation = getAgentRolePresentation(role, title);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em]",
        presentation.badgeClassName,
        className,
      )}
    >
      <presentation.icon className={cn("h-3 w-3", presentation.iconClassName)} />
      {presentation.label}
    </span>
  );
}

export function AgentJobIdentity({
  name,
  role,
  title,
  icon,
  adapterType,
  subtitle,
}: {
  name: string;
  role: string;
  title?: string | null;
  icon?: string | null;
  adapterType?: string;
  subtitle?: string | null;
}) {
  const presentation = getAgentRolePresentation(role, title);

  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar className="h-11 w-11 border border-background/80 shadow-sm">
        <AvatarFallback className={cn("text-sm font-semibold", presentation.avatarClassName)}>
          {icon ? <AgentIcon icon={icon} className="h-5 w-5" /> : <presentation.icon className={cn("h-4.5 w-4.5", presentation.iconClassName)} />}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{name}</span>
          <AgentRoleBadge role={role} title={title} />
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{title ?? presentation.classLabel}</span>
          {adapterType ? (
            <>
              <span className="text-border">•</span>
              <span>{adapterLabels[adapterType] ?? adapterType}</span>
            </>
          ) : null}
          {subtitle ? (
            <>
              <span className="text-border">•</span>
              <span className="truncate">{subtitle}</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
