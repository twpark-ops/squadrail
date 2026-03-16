import { Link } from "@/lib/router";
import { cn } from "@/lib/utils";
import { AgentRoleBadge, getAgentRolePresentation } from "../agent-presence-primitives";
import type { SquadStageActor as SquadStageActorModel, SquadStageSignal } from "@/lib/squad-stage/stage-model";

function signalClassName(signal: SquadStageSignal) {
  if (signal === "blocked") return "squad-stage-actor--blocked";
  if (signal === "active") return "squad-stage-actor--active";
  if (signal === "warning") return "squad-stage-actor--warning";
  return "squad-stage-actor--idle";
}

export function SquadStageActor({
  actor,
  compact = false,
  decorative = false,
  scene = false,
}: {
  actor: SquadStageActorModel;
  compact?: boolean;
  decorative?: boolean;
  scene?: boolean;
}) {
  const presentation = getAgentRolePresentation(actor.role, actor.title);

  const actorClassName = cn(
    "squad-stage-actor group no-underline",
    compact ? "squad-stage-actor--compact" : "squad-stage-actor--full",
    scene ? "squad-stage-actor--scene" : null,
    signalClassName(actor.signal),
  );

  const actorBody = (
    <>
      <span className={cn("squad-stage-actor__role-chip", presentation.badgeClassName)}>
        <presentation.icon className={cn("h-3 w-3", presentation.iconClassName)} />
      </span>

      {scene && !compact ? (
        <span className="squad-stage-actor__scene-chip">
          <span className="squad-stage-actor__scene-name">{actor.name}</span>
          <span className="squad-stage-actor__scene-status">{actor.statusLabel}</span>
        </span>
      ) : null}

      {!compact && !scene ? (
        <span className="squad-stage-actor__meta">
          <span className="squad-stage-actor__name-row">
            <span className="squad-stage-actor__name">{actor.name}</span>
            <span className="squad-stage-actor__status">{actor.statusLabel}</span>
          </span>
          <span className="squad-stage-actor__subtitle">{actor.subtitle}</span>
          {actor.focusIssueLabel ? (
            <span className="squad-stage-actor__issue-chip">{actor.focusIssueLabel}</span>
          ) : (
            <AgentRoleBadge role={actor.role} title={actor.title} className="squad-stage-actor__role-badge" />
          )}
        </span>
      ) : null}
    </>
  );

  if (decorative) {
    return (
      <span
        className={actorClassName}
        data-motion={actor.motion}
        data-lane={actor.laneId}
        data-signal={actor.signal}
        data-presence={actor.presence}
        aria-hidden="true"
      >
        {actorBody}
      </span>
    );
  }

  return (
    <Link
      to={actor.href}
      className={actorClassName}
      data-motion={actor.motion}
      data-lane={actor.laneId}
      data-signal={actor.signal}
      data-presence={actor.presence}
      aria-label={`${actor.name} · ${actor.statusLabel}`}
      title={`${actor.name} · ${actor.statusLabel}`}
    >
      {actorBody}
    </Link>
  );
}
