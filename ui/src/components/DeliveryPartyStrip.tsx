import { Badge } from "@/components/ui/badge";
import { AgentJobIdentity, getAgentRolePresentation } from "@/components/agent-presence-primitives";
import { cn } from "@/lib/utils";

export type DeliveryPartySlotKey = "lead" | "engineer" | "reviewer" | "qa";
export type DeliveryPartySlotTone = "active" | "waiting" | "blocked" | "idle" | "done";

type DeliveryPartyStripAgent = {
  name: string;
  role: string;
  title?: string | null;
  icon?: string | null;
  adapterType?: string | null;
};

export type DeliveryPartySlot = {
  key: DeliveryPartySlotKey;
  label: string;
  agentId: string | null;
  agent: DeliveryPartyStripAgent | null;
  statusLabel: string;
  tone: DeliveryPartySlotTone;
  helperText: string;
  signalLabel?: string | null;
  detailText?: string | null;
};

function deliveryPartyToneClassName(tone: DeliveryPartySlotTone) {
  switch (tone) {
    case "active":
      return "border-cyan-300/70 bg-cyan-500/10 text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-500/15 dark:text-cyan-200";
    case "waiting":
      return "border-amber-300/70 bg-amber-500/10 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200";
    case "blocked":
      return "border-red-300/70 bg-red-500/10 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-200";
    case "done":
      return "border-emerald-300/70 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200";
    default:
      return "border-border bg-background text-muted-foreground";
  }
}

function deliveryPartyPresenceClasses(tone: DeliveryPartySlotTone) {
  switch (tone) {
    case "active":
      return {
        avatarClassName: "team-avatar-shell team-avatar-hot",
        auraClassName: "team-avatar-aura team-avatar-aura-hot",
      };
    case "blocked":
      return {
        avatarClassName: "team-avatar-shell team-avatar-paused",
        auraClassName: "team-avatar-aura team-avatar-aura-paused",
      };
    case "done":
      return {
        avatarClassName: "team-avatar-shell team-avatar-ready",
        auraClassName: "team-avatar-aura team-avatar-aura-ready",
      };
    case "waiting":
      return {
        avatarClassName: "team-avatar-shell team-avatar-standby",
        auraClassName: "team-avatar-aura team-avatar-aura-standby",
      };
    default:
      return {
        avatarClassName: "team-avatar-shell team-avatar-offline",
        auraClassName: "team-avatar-aura team-avatar-aura-offline",
      };
  }
}

function describeContextRole(slot: DeliveryPartySlot) {
  if (!slot.agent) return null;
  const baseLabel = getAgentRolePresentation(slot.agent.role, slot.agent.title).label.toLowerCase();
  switch (slot.key) {
    case "reviewer":
      return baseLabel === "reviewer" ? null : "Acting as reviewer";
    case "qa":
      return baseLabel === "qa" ? null : "Acting as qa";
    case "engineer":
      return baseLabel === "engineer" ? null : "Acting as engineer";
    default:
      return null;
  }
}

type DeliveryPartyStripProps = {
  headline: string;
  slots: DeliveryPartySlot[];
  summaryLabel?: string | null;
  summaryTone?: DeliveryPartySlotTone | null;
  testId?: string;
};

export function DeliveryPartyStrip({
  headline,
  slots,
  summaryLabel,
  summaryTone,
  testId,
}: DeliveryPartyStripProps) {
  return (
    <div
      className="rounded-xl border border-border/80 bg-card/80 px-4 py-4"
      data-testid={testId}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Delivery party
          </div>
          <div className="mt-1 text-sm font-semibold text-foreground">{headline}</div>
        </div>
        {summaryLabel && summaryTone ? (
          <Badge
            variant="outline"
            className={cn(
              "delivery-party-summary-badge rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.16em]",
              deliveryPartyToneClassName(summaryTone),
            )}
          >
            {summaryLabel}
          </Badge>
        ) : null}
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-4">
        {slots.map((slot) => {
          const contextRole = describeContextRole(slot);
          const presence = deliveryPartyPresenceClasses(slot.tone);
          return (
            <div
              key={slot.key}
              className="delivery-party-slot rounded-xl border border-border/80 bg-background/80 px-3 py-3"
              data-tone={slot.tone}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {slot.label}
                </div>
                <span
                  className={cn(
                    "delivery-party-status-badge inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em]",
                    deliveryPartyToneClassName(slot.tone),
                  )}
                >
                  {slot.statusLabel}
                </span>
              </div>
              <div className="mt-3">
                {slot.agent ? (
                  <AgentJobIdentity
                    name={slot.agent.name}
                    role={slot.agent.role}
                    title={slot.agent.title}
                    icon={slot.agent.icon}
                    adapterType={slot.agent.adapterType ?? undefined}
                    subtitle={slot.helperText}
                    avatarClassName={presence.avatarClassName}
                    avatarAuraClassName={presence.auraClassName}
                    roleBadgeClassName="team-job-badge"
                  />
                ) : (
                  <div className="rounded-lg border border-dashed border-border px-3 py-3 text-xs leading-5 text-muted-foreground">
                    {slot.helperText}
                  </div>
                )}
              </div>
              {contextRole ? (
                <div className="mt-3">
                  <span className="delivery-party-context-badge inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    {contextRole}
                  </span>
                </div>
              ) : null}
              {slot.signalLabel ? (
                <div className="mt-3">
                  <span
                    className={cn(
                      "delivery-party-signal-badge inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em]",
                      deliveryPartyToneClassName(slot.tone),
                    )}
                  >
                    <span className="delivery-party-signal-dot" aria-hidden />
                    {slot.signalLabel}
                  </span>
                </div>
              ) : null}
              {slot.detailText ? (
                <div
                  className={cn(
                    "delivery-party-detail mt-3 rounded-lg border px-3 py-2 text-xs leading-5",
                    slot.tone === "blocked"
                      ? "border-red-300/70 bg-red-500/10 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-200"
                      : slot.tone === "active"
                        ? "border-cyan-300/70 bg-cyan-500/10 text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-500/15 dark:text-cyan-200"
                        : "border-border/70 bg-muted/30 text-muted-foreground",
                  )}
                >
                  {slot.detailText}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
