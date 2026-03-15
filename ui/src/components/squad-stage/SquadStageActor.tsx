import type { CSSProperties } from "react";
import { Link } from "@/lib/router";
import { cn } from "@/lib/utils";
import { AgentRoleBadge, getAgentRolePresentation } from "../agent-presence-primitives";
import type { SquadStageActor as SquadStageActorModel, SquadStageSignal } from "@/lib/squad-stage/stage-model";

const FRAME_WIDTH = 16;
const FRAME_HEIGHT = 24;
const SHEET_WIDTH = 112;
const SHEET_HEIGHT = 96;

type SpriteAnimationMode = "static" | "task" | "handoff" | "walk";

function spriteConfigForMotion(motion: SquadStageActorModel["motion"]) {
  switch (motion) {
    case "walking":
      return { row: 2, startCol: 0, endCol: 3, animationMode: "walk" as const };
    case "handoff":
      return { row: 2, startCol: 1, endCol: 3, animationMode: "handoff" as const };
    case "working":
      return { row: 3, startCol: 4, endCol: 5, animationMode: "task" as const };
    case "reviewing":
      return { row: 1, startCol: 4, endCol: 5, animationMode: "task" as const };
    case "verifying":
      return { row: 0, startCol: 4, endCol: 5, animationMode: "task" as const };
    case "blocked":
      return { row: 0, startCol: 6, endCol: 6, animationMode: "static" as const };
    case "offline":
      return { row: 3, startCol: 6, endCol: 6, animationMode: "static" as const };
    case "idle":
    default:
      return { row: 0, startCol: 1, endCol: 1, animationMode: "static" as const };
  }
}

function signalClassName(signal: SquadStageSignal) {
  if (signal === "blocked") return "squad-stage-actor--blocked";
  if (signal === "active") return "squad-stage-actor--active";
  if (signal === "warning") return "squad-stage-actor--warning";
  return "squad-stage-actor--idle";
}

function spriteClassName(mode: SpriteAnimationMode) {
  if (mode === "walk") return "squad-stage-actor__sprite--walk";
  if (mode === "handoff") return "squad-stage-actor__sprite--handoff";
  if (mode === "task") return "squad-stage-actor__sprite--task";
  return "squad-stage-actor__sprite--static";
}

function statePropForMotion(motion: SquadStageActorModel["motion"]) {
  switch (motion) {
    case "working":
      return { path: "/squad-stage/office/build-prop.svg", label: "Implementation prop" };
    case "reviewing":
      return { path: "/squad-stage/office/review-prop.svg", label: "Review prop" };
    case "verifying":
      return { path: "/squad-stage/office/qa-prop.svg", label: "QA prop" };
    case "blocked":
      return { path: "/squad-stage/office/blocked-prop.svg", label: "Blocked prop" };
    case "handoff":
      return { path: "/squad-stage/office/handoff-prop.svg", label: "Handoff prop" };
    default:
      return null;
  }
}

export function SquadStageActor({
  actor,
  compact = false,
  decorative = false,
}: {
  actor: SquadStageActorModel;
  compact?: boolean;
  decorative?: boolean;
}) {
  const presentation = getAgentRolePresentation(actor.role, actor.title);
  const sprite = spriteConfigForMotion(actor.motion);
  const scale = compact ? 2.4 : 3.4;
  const sheetIndex = actor.spriteIndex % 6;
  const stateProp = statePropForMotion(actor.motion);

  const spriteStyle = {
    width: `${FRAME_WIDTH * scale}px`,
    height: `${FRAME_HEIGHT * scale}px`,
    backgroundImage: `url('/squad-stage/actors/char_${sheetIndex}.png')`,
    backgroundPosition: `${-sprite.startCol * FRAME_WIDTH * scale}px ${-sprite.row * FRAME_HEIGHT * scale}px`,
    backgroundSize: `${SHEET_WIDTH * scale}px ${SHEET_HEIGHT * scale}px`,
    ["--squad-stage-sprite-start-x" as "--squad-stage-sprite-start-x"]: `${-sprite.startCol * FRAME_WIDTH * scale}px`,
    ["--squad-stage-sprite-end-x" as "--squad-stage-sprite-end-x"]: `${-sprite.endCol * FRAME_WIDTH * scale}px`,
    ["--squad-stage-sprite-row-y" as "--squad-stage-sprite-row-y"]: `${-sprite.row * FRAME_HEIGHT * scale}px`,
  } as CSSProperties;

  const actorClassName = cn(
    "squad-stage-actor group no-underline",
    compact ? "squad-stage-actor--compact" : "squad-stage-actor--full",
    signalClassName(actor.signal),
  );

  const actorBody = (
    <>
      <span className="squad-stage-actor__shadow" aria-hidden />
      <span className="squad-stage-actor__motion" aria-hidden>
        <span
          className={cn("squad-stage-actor__sprite", spriteClassName(sprite.animationMode))}
          style={spriteStyle}
        />
      </span>
      {stateProp ? (
        <span
          className="squad-stage-actor__prop"
          aria-hidden
          title={stateProp.label}
          style={{ backgroundImage: `url('${stateProp.path}')` }}
        />
      ) : null}
      <span className={cn("squad-stage-actor__role-chip", presentation.badgeClassName)}>
        <presentation.icon className={cn("h-3 w-3", presentation.iconClassName)} />
      </span>

      {!compact ? (
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
