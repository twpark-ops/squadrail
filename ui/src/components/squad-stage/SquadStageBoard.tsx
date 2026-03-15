import type { CSSProperties } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { Link } from "@/lib/router";
import { cn } from "@/lib/utils";
import { SquadStageActor } from "./SquadStageActor";
import type { SquadStageActor as SquadStageActorModel, SquadStageLane, SquadStageModel } from "@/lib/squad-stage/stage-model";

function laneIcon(laneId: SquadStageLane["id"]) {
  switch (laneId) {
    case "planning":
      return Sparkles;
    case "lead":
      return ArrowRight;
    case "build":
      return Wrench;
    case "review":
      return ShieldCheck;
    case "qa":
      return CheckCircle2;
  }
}

function signalClassName(signal: SquadStageLane["signal"]) {
  switch (signal) {
    case "blocked":
      return "squad-stage-lane--blocked";
    case "active":
      return "squad-stage-lane--active";
    case "warning":
      return "squad-stage-lane--warning";
    default:
      return "squad-stage-lane--idle";
  }
}

function signalLabel(signal: SquadStageLane["signal"]) {
  switch (signal) {
    case "blocked":
      return "Blocked";
    case "active":
      return "Active";
    case "warning":
      return "Queued";
    default:
      return "Idle";
  }
}

function signalDotClassName(signal: SquadStageLane["signal"]) {
  switch (signal) {
    case "blocked":
      return "squad-stage-dot--blocked";
    case "active":
      return "squad-stage-dot--active";
    case "warning":
      return "squad-stage-dot--warning";
    default:
      return "squad-stage-dot--idle";
  }
}

function batonSignalClassName(signal: SquadStageLane["signal"]) {
  switch (signal) {
    case "blocked":
      return "squad-stage-baton--blocked";
    case "active":
      return "squad-stage-baton--active";
    case "warning":
      return "squad-stage-baton--warning";
    default:
      return "squad-stage-baton--idle";
  }
}

function stationClassName(laneId: SquadStageLane["id"]) {
  return `squad-stage-station--${laneId}`;
}

function actorAnchorForLane(lane: SquadStageLane) {
  const motion = lane.primaryActor?.motion;
  switch (lane.id) {
    case "planning":
      return motion === "walking" ? 28 : 34;
    case "lead":
      return motion === "handoff" ? 42 : 36;
    case "build":
      if (motion === "blocked") return 66;
      if (motion === "working") return 34;
      return 44;
    case "review":
      return motion === "reviewing" ? 58 : 50;
    case "qa":
      return motion === "verifying" ? 60 : 54;
    default:
      return 50;
  }
}

function scenePlacementForLane(laneId: SquadStageLane["id"]): CSSProperties {
  switch (laneId) {
    case "planning":
      return {
        ["--squad-stage-zone-left" as "--squad-stage-zone-left"]: "2%",
        ["--squad-stage-zone-top" as "--squad-stage-zone-top"]: "5%",
        ["--squad-stage-zone-width" as "--squad-stage-zone-width"]: "22%",
        ["--squad-stage-zone-height" as "--squad-stage-zone-height"]: "42%",
      } as CSSProperties;
    case "lead":
      return {
        ["--squad-stage-zone-left" as "--squad-stage-zone-left"]: "26.5%",
        ["--squad-stage-zone-top" as "--squad-stage-zone-top"]: "5%",
        ["--squad-stage-zone-width" as "--squad-stage-zone-width"]: "21%",
        ["--squad-stage-zone-height" as "--squad-stage-zone-height"]: "42%",
      } as CSSProperties;
    case "qa":
      return {
        ["--squad-stage-zone-left" as "--squad-stage-zone-left"]: "76%",
        ["--squad-stage-zone-top" as "--squad-stage-zone-top"]: "5%",
        ["--squad-stage-zone-width" as "--squad-stage-zone-width"]: "22%",
        ["--squad-stage-zone-height" as "--squad-stage-zone-height"]: "42%",
      } as CSSProperties;
    case "build":
      return {
        ["--squad-stage-zone-left" as "--squad-stage-zone-left"]: "11.5%",
        ["--squad-stage-zone-top" as "--squad-stage-zone-top"]: "49%",
        ["--squad-stage-zone-width" as "--squad-stage-zone-width"]: "31%",
        ["--squad-stage-zone-height" as "--squad-stage-zone-height"]: "45%",
      } as CSSProperties;
    case "review":
    default:
      return {
        ["--squad-stage-zone-left" as "--squad-stage-zone-left"]: "48.5%",
        ["--squad-stage-zone-top" as "--squad-stage-zone-top"]: "49%",
        ["--squad-stage-zone-width" as "--squad-stage-zone-width"]: "28%",
        ["--squad-stage-zone-height" as "--squad-stage-zone-height"]: "45%",
      } as CSSProperties;
  }
}

function sceneConnectionPath(source: SquadStageLane["id"], target: SquadStageLane["id"]) {
  if (source === "planning" && target === "lead") return "M 13 26 C 20 18, 31 18, 37 26";
  if (source === "lead" && target === "build") return "M 37 28 C 38 42, 31 56, 27 71";
  if (source === "build" && target === "review") return "M 27 71 C 39 64, 56 64, 65 71";
  if (source === "review" && target === "qa") return "M 65 71 C 76 55, 82 42, 87 26";
  return "M 10 10 C 40 10, 60 10, 90 10";
}

function ambientActorBlueprints(lane: SquadStageLane): Array<{
  id: string;
  actor: SquadStageActorModel;
  style: CSSProperties;
}> {
  const items: Array<{
    id: string;
    actor: SquadStageActorModel;
    style: CSSProperties;
  }> = [];

  const basePresence: SquadStageActorModel["presence"] = lane.signal === "blocked" ? "paused" : "standby";
  const buildRoom = lane.roomLabel.split(" ")[0] ?? lane.title;

  const pushAmbient = (
    index: number,
    motion: SquadStageActorModel["motion"],
    left: string,
    bottom: string,
  ) => {
    items.push({
      id: `${lane.id}-ambient-${index}`,
      actor: {
        id: `${lane.id}-ambient-${index}`,
        href: "#",
        name: `${lane.title} ambient ${index}`,
        role: lane.id === "planning" ? "pm" : lane.id === "qa" ? "qa" : lane.id === "review" ? "reviewer" : "engineer",
        title: `${lane.title} ambient`,
        adapterType: "decorative",
        laneId: lane.id,
        spriteIndex: (index + lane.id.length) % 6,
        motion,
        signal: lane.signal,
        presence: basePresence,
        statusLabel: "Ambient",
        subtitle: `${buildRoom} ambient activity`,
        liveRun: null,
        performance: null,
        focusIssueLabel: null,
        focusIssueHref: null,
      },
      style: {
        ["--squad-stage-ambient-left" as "--squad-stage-ambient-left"]: left,
        ["--squad-stage-ambient-bottom" as "--squad-stage-ambient-bottom"]: bottom,
      } as CSSProperties,
    });
  };

  if (lane.id === "planning") {
    pushAmbient(1, lane.signal === "warning" ? "walking" : "idle", "12%", "24%");
  } else if (lane.id === "lead") {
    pushAmbient(1, lane.signal === "active" ? "handoff" : "walking", "18%", "24%");
  } else if (lane.id === "build") {
    pushAmbient(1, lane.signal === "blocked" ? "blocked" : "working", "12%", "18%");
    pushAmbient(2, lane.signal === "active" ? "walking" : "idle", "72%", "20%");
  } else if (lane.id === "review") {
    pushAmbient(1, lane.signal === "active" ? "reviewing" : "idle", "18%", "17%");
  } else if (lane.id === "qa") {
    pushAmbient(1, lane.signal === "blocked" ? "blocked" : "verifying", "66%", "18%");
  }

  return items;
}

function shouldRenderWorkBeam(lane: SquadStageLane) {
  const motion = lane.primaryActor?.motion;
  return motion === "working" || motion === "reviewing" || motion === "verifying" || motion === "handoff" || motion === "blocked";
}

function batonSignalBetween(source: SquadStageLane, target: SquadStageLane): SquadStageLane["signal"] {
  if (source.signal === "blocked" || target.signal === "blocked") return "blocked";
  if (source.primaryActor?.motion === "handoff" || target.primaryActor?.motion === "handoff") return "active";
  if (source.signal === "active" || target.signal === "active") return "active";
  if (source.signal === "warning" || target.signal === "warning") return "warning";
  return "idle";
}

function isBatonTraveling(source: SquadStageLane, target: SquadStageLane) {
  return (
    source.primaryActor?.motion === "handoff"
    || target.primaryActor?.motion === "walking"
    || source.signal === "active"
    || target.signal === "active"
  );
}

function handoffRunnerForConnection(source: SquadStageLane, target: SquadStageLane) {
  if (!isBatonTraveling(source, target)) return null;
  const baseActor = source.primaryActor ?? target.primaryActor;
  if (!baseActor) return null;
  return {
    actor: {
      ...baseActor,
      id: `${source.id}-${target.id}-runner`,
      motion: "walking" as const,
      statusLabel: "Transit",
      subtitle: `${source.title} to ${target.title} handoff`,
    },
    path: sceneConnectionPath(source.id, target.id),
    testId: `squad-stage-runner-${source.id}-${target.id}`,
  };
}

function defaultDecorativeRole(laneId: SquadStageLane["id"]) {
  switch (laneId) {
    case "planning":
      return "pm";
    case "lead":
      return "cto";
    case "review":
      return "reviewer";
    case "qa":
      return "qa";
    case "build":
    default:
      return "engineer";
  }
}

function defaultSpriteIndex(laneId: SquadStageLane["id"]) {
  switch (laneId) {
    case "planning":
      return 0;
    case "lead":
      return 4;
    case "review":
      return 3;
    case "qa":
      return 5;
    case "build":
    default:
      return 1;
  }
}

function sceneBannerSummary(model: SquadStageModel) {
  if (model.summary.blockedIssues > 0) {
    return `${model.summary.blockedIssues} blocked lane${model.summary.blockedIssues > 1 ? "s" : ""} need operator attention.`;
  }
  if (model.summary.activeIssues > 0) {
    return `${model.summary.activeIssues} live packet${model.summary.activeIssues > 1 ? "s" : ""} are moving across the floor.`;
  }
  if (model.summary.queuedIssues > 0) {
    return `${model.summary.queuedIssues} queued packet${model.summary.queuedIssues > 1 ? "s" : ""} are warming up for the next handoff.`;
  }
  return "The floor is warm and ready for the next delivery cycle.";
}

function sceneCrewBlueprints(model: SquadStageModel): Array<{
  id: string;
  label: string;
  detail: string;
  actor: SquadStageActorModel;
  style: CSSProperties;
}> {
  const laneById = new Map(model.lanes.map((lane) => [lane.id, lane]));
  const crew: Array<{
    id: string;
    label: string;
    detail: string;
    actor: SquadStageActorModel;
    style: CSSProperties;
  }> = [];

  const pushCrew = (input: {
    id: string;
    laneId: SquadStageLane["id"];
    left: string;
    top: string;
    motion: SquadStageActorModel["motion"];
    label: string;
    detail: string;
    signal?: SquadStageActorModel["signal"];
    name?: string;
  }) => {
    const lane = laneById.get(input.laneId);
    if (!lane) return;
    const baseActor = lane.primaryActor ?? lane.queueActors[0] ?? lane.actors[0] ?? null;
    const signal = input.signal ?? lane.signal;
    crew.push({
      id: input.id,
      label: input.label,
      detail: input.detail,
      actor: {
        id: input.id,
        href: "#",
        name: input.name ?? baseActor?.name ?? input.label,
        role: baseActor?.role ?? defaultDecorativeRole(input.laneId),
        title: baseActor?.title ?? input.label,
        icon: baseActor?.icon,
        adapterType: "decorative",
        laneId: input.laneId,
        spriteIndex: baseActor?.spriteIndex ?? defaultSpriteIndex(input.laneId),
        motion: input.motion,
        signal,
        presence: signal === "blocked" ? "paused" : signal === "active" ? "ready" : "standby",
        statusLabel: input.label,
        subtitle: input.detail,
        liveRun: null,
        performance: null,
        focusIssueLabel: null,
        focusIssueHref: null,
      },
      style: {
        ["--squad-stage-crew-left" as "--squad-stage-crew-left"]: input.left,
        ["--squad-stage-crew-top" as "--squad-stage-crew-top"]: input.top,
      } as CSSProperties,
    });
  };

  pushCrew({
    id: "scene-crew-dispatch",
    laneId: "lead",
    left: "49%",
    top: "44%",
    motion: model.summary.activeIssues > 0 ? "handoff" : "idle",
    label: "Dispatch",
    detail: `${model.companyLabel} control point`,
    signal: model.summary.blockedIssues > 0 ? "blocked" : model.summary.activeIssues > 0 ? "active" : "idle",
    name: "Dispatch Lead",
  });
  pushCrew({
    id: "scene-crew-intake",
    laneId: "planning",
    left: "20%",
    top: "34%",
    motion: laneById.get("planning")?.signal === "warning" ? "walking" : "idle",
    label: "Intake relay",
    detail: "Briefs and clarifications move toward routing.",
    signal: laneById.get("planning")?.signal ?? "idle",
    name: "Intake Relay",
  });
  pushCrew({
    id: "scene-crew-build",
    laneId: "build",
    left: "25%",
    top: "73%",
    motion: laneById.get("build")?.signal === "blocked" ? "blocked" : laneById.get("build")?.signal === "active" ? "working" : "walking",
    label: "Build wing",
    detail: "Implementation packets cycle through the bench.",
    signal: laneById.get("build")?.signal ?? "idle",
    name: "Build Runner",
  });
  pushCrew({
    id: "scene-crew-review",
    laneId: "review",
    left: "61%",
    top: "72%",
    motion: laneById.get("review")?.signal === "active" ? "reviewing" : "walking",
    label: "Review relay",
    detail: "Diff handoff keeps flowing toward release.",
    signal: laneById.get("review")?.signal ?? "idle",
    name: "Review Relay",
  });
  pushCrew({
    id: "scene-crew-qa",
    laneId: "qa",
    left: "82%",
    top: "37%",
    motion: laneById.get("qa")?.signal === "blocked" ? "blocked" : laneById.get("qa")?.signal === "active" ? "verifying" : "walking",
    label: "Release watch",
    detail: "Acceptance packets hold at the gate until sign-off.",
    signal: laneById.get("qa")?.signal ?? "idle",
    name: "Release Watch",
  });

  return crew;
}

function SquadStageSceneBanner({ model }: { model: SquadStageModel }) {
  return (
    <div className="squad-stage-scene__banner" data-testid="squad-stage-scene-banner">
      <div className="squad-stage-scene__banner-eyebrow">Company stage</div>
      <div className="squad-stage-scene__banner-title">{model.companyLabel} delivery floor</div>
      <div className="squad-stage-scene__banner-copy">{sceneBannerSummary(model)}</div>
      {model.officeMap.projectLabels.length > 0 ? (
        <div className="squad-stage-scene__banner-chips">
          {model.officeMap.projectLabels.map((projectLabel) => (
            <span key={projectLabel} className="squad-stage-scene__banner-chip">
              {projectLabel}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SquadStageSceneDispatch({ model }: { model: SquadStageModel }) {
  const topSpotlights = model.spotlights.slice(0, 2);
  return (
    <div className="squad-stage-scene__dispatch" data-testid="squad-stage-scene-dispatch">
      <div className="squad-stage-scene__dispatch-title">Dispatch board</div>
      <div className="squad-stage-scene__dispatch-copy">
        {topSpotlights[0]?.summary ?? "No urgent packet is pinned to dispatch right now."}
      </div>
      {topSpotlights.length > 0 ? (
        <div className="squad-stage-scene__dispatch-stack">
          {topSpotlights.map((spotlight) => (
            <Link
              key={spotlight.id}
              to={spotlight.href}
              className={cn("squad-stage-scene__dispatch-spotlight", `squad-stage-scene__dispatch-spotlight--${spotlight.tone}`)}
            >
              <span>{spotlight.label}</span>
              <span>{spotlight.summary}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SquadStageSceneCrew({ model }: { model: SquadStageModel }) {
  const crew = sceneCrewBlueprints(model);
  return (
    <div className="squad-stage-scene__crew" data-testid="squad-stage-scene-crew" aria-label="Company floor crew">
      {crew.map((member) => (
        <div
          key={member.id}
          className={cn("squad-stage-scene__crew-node", `squad-stage-scene__crew-node--${member.actor.signal}`)}
          style={member.style}
          data-testid={member.id}
        >
          <SquadStageActor actor={member.actor} compact decorative />
          <div className="squad-stage-scene__crew-label">
            <span>{member.label}</span>
            <span>{member.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function SquadStageFlowStrip({ lanes }: { lanes: SquadStageModel["lanes"] }) {
  return (
    <div className="squad-stage-flow-strip" aria-label="Stage handoff flow">
      {lanes.map((lane, index) => (
        <div key={lane.id} className="squad-stage-flow-strip__item">
          <div
            className={cn("squad-stage-flow-strip__chip", `squad-stage-flow-strip__chip--${lane.signal}`)}
          >
            <span className={cn("squad-stage-dot", signalDotClassName(lane.signal))} aria-hidden />
            <span>{lane.title}</span>
            <span className="squad-stage-flow-strip__state">{signalLabel(lane.signal)}</span>
          </div>
          {index < lanes.length - 1 ? (
            <div
              className={cn(
                "squad-stage-flow-strip__link",
                batonSignalClassName(batonSignalBetween(lane, lanes[index + 1]!)),
              )}
              data-active={isBatonTraveling(lane, lanes[index + 1]!) ? "true" : "false"}
              data-testid={`squad-stage-baton-${lane.id}-${lanes[index + 1]!.id}`}
            >
              <svg className="squad-stage-flow-strip__arc" viewBox="0 0 104 24" aria-hidden>
                <path className="squad-stage-flow-strip__arc-path" d="M4 18 Q52 3 100 18" />
              </svg>
              <span className="squad-stage-flow-strip__baton" aria-hidden>
                <span className="squad-stage-flow-strip__baton-sprite" />
              </span>
              <ArrowRight className="squad-stage-flow-strip__arrow" aria-hidden />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function SquadStageSceneConnections({ lanes }: { lanes: SquadStageModel["lanes"] }) {
  return (
    <div className="squad-stage-scene__connections" aria-hidden>
      {lanes.slice(0, -1).map((lane, index) => {
        const nextLane = lanes[index + 1]!;
        const signal = batonSignalBetween(lane, nextLane);
        const runner = handoffRunnerForConnection(lane, nextLane);
        return (
          <div
            key={`${lane.id}-${nextLane.id}`}
            className={cn("squad-stage-scene__connection", batonSignalClassName(signal))}
            data-active={runner ? "true" : "false"}
          >
            <svg className="squad-stage-scene__connection-arc" viewBox="0 0 100 100" preserveAspectRatio="none">
              <path className="squad-stage-scene__connection-path" d={sceneConnectionPath(lane.id, nextLane.id)} />
            </svg>
            {runner ? (
              <span
                className="squad-stage-scene__runner"
                data-testid={runner.testId}
                style={{ ["--squad-stage-runner-path" as "--squad-stage-runner-path"]: `path('${runner.path}')` } as CSSProperties}
              >
                <SquadStageActor actor={runner.actor} compact decorative />
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function SquadStageStation({ lane }: { lane: SquadStageLane }) {
  return (
    <div
      className={cn("squad-stage-station", stationClassName(lane.id))}
      data-testid={`squad-stage-station-${lane.id}`}
    >
      <span className="squad-stage-station__footprint" aria-hidden />
      <span className="squad-stage-station__sprite" aria-hidden />
      <span className="squad-stage-station__glow" aria-hidden />
      <span className="squad-stage-station__label">{lane.stationLabel}</span>
    </div>
  );
}

function SquadStagePacketCard({
  lane,
  packet,
  compact = false,
}: {
  lane: SquadStageLane;
  packet: NonNullable<SquadStageLane["packet"]>;
  compact?: boolean;
}) {
  const href = packet.href ?? "#";
  return (
    <Link
      to={href}
      className={cn(
        "squad-stage-packet",
        compact ? "squad-stage-packet--compact" : "squad-stage-packet--full",
        `squad-stage-packet--${packet.tone}`,
      )}
      data-motion={lane.primaryActor?.motion ?? "idle"}
      data-lane={lane.id}
      data-testid={compact ? undefined : `squad-stage-packet-${lane.id}`}
      style={{ ["--squad-stage-accent" as "--squad-stage-accent"]: lane.accentColor } as CSSProperties}
    >
      <span className="squad-stage-packet__route" aria-hidden />
      <span className="squad-stage-packet__label">{packet.label}</span>
      <span className="squad-stage-packet__detail">{packet.detail}</span>
      {packet.projectLabel ? (
        <span className="squad-stage-packet__project">{packet.projectLabel}</span>
      ) : null}
    </Link>
  );
}

function SquadStageOfficeMap({ model }: { model: SquadStageModel }) {
  return (
    <div className="squad-stage-office-map">
      {model.officeMap.rooms.map((room) => (
        <div
          key={room.laneId}
          className={cn("squad-stage-office-map__room", `squad-stage-office-map__room--${room.tone}`)}
          data-testid={`squad-stage-map-room-${room.laneId}`}
          style={{ ["--squad-stage-accent" as "--squad-stage-accent"]: room.accentColor } as CSSProperties}
        >
          <div className="squad-stage-office-map__room-header">
            <span className={cn("squad-stage-dot", signalDotClassName(room.tone))} aria-hidden />
            <span className="squad-stage-office-map__room-title">{room.title}</span>
          </div>
          <div className="squad-stage-office-map__room-label">{room.roomLabel}</div>
          {room.contextLabel ? (
            <div className="squad-stage-office-map__room-context">{room.contextLabel}</div>
          ) : null}
          {room.packetLabel ? (
            <div className="squad-stage-office-map__room-packet">{room.packetLabel}</div>
          ) : null}
          <div className="squad-stage-office-map__room-occupancy">{room.occupancyLabel}</div>
        </div>
      ))}
    </div>
  );
}

function SquadStageSceneZone({ lane }: { lane: SquadStageLane }) {
  const LaneIcon = laneIcon(lane.id);
  const actorAnchor = actorAnchorForLane(lane);
  const actorSide = actorAnchor < 50 ? "left" : "right";
  const countBadges = [
    lane.actors.length > 0 ? `${lane.actors.length} rostered` : null,
    lane.queueCount > 0 ? `${lane.queueCount} queued` : null,
  ].filter((value): value is string => Boolean(value));
  const isQuietLane =
    lane.signal === "idle"
    && !lane.primaryActor
    && lane.queueActors.length === 0
    && lane.queuePackets.length === 0
    && !lane.spotlight;

  return (
    <article
      className={cn("squad-stage-zone", "squad-stage-lane", signalClassName(lane.signal))}
      data-lane={lane.id}
      style={{
        ["--squad-stage-accent" as "--squad-stage-accent"]: lane.accentColor,
        ...scenePlacementForLane(lane.id),
      } as CSSProperties}
      data-testid={`squad-stage-lane-${lane.id}`}
    >
      <div className="squad-stage-zone__header squad-stage-lane__header">
        <div>
          <div className="squad-stage-zone__title-row squad-stage-lane__title-row">
            <span className="squad-stage-zone__icon squad-stage-lane__icon">
              <LaneIcon className="h-3.5 w-3.5" />
            </span>
            <h3 className="squad-stage-zone__title squad-stage-lane__title">{lane.title}</h3>
            <span className={cn("squad-stage-zone__signal-chip", "squad-stage-lane__signal-chip", `squad-stage-zone__signal-chip--${lane.signal}`, `squad-stage-lane__signal-chip--${lane.signal}`)}>
              <span className={cn("squad-stage-dot", signalDotClassName(lane.signal))} aria-hidden />
              {signalLabel(lane.signal)}
            </span>
          </div>
          <p className="squad-stage-zone__subtitle squad-stage-lane__subtitle">{lane.subtitle}</p>
        </div>
        {countBadges.length > 0 ? (
          <div className="squad-stage-zone__counts squad-stage-lane__counts">
            {countBadges.map((countLabel) => (
              <span key={countLabel}>{countLabel}</span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="squad-stage-zone__arena squad-stage-lane__arena">
        <div className="squad-stage-zone__backdrop squad-stage-lane__backdrop" data-testid={`squad-stage-room-${lane.id}`} aria-hidden />
        <div className="squad-stage-zone__track squad-stage-lane__track" aria-hidden />
        <div className="squad-stage-zone__room-chip squad-stage-lane__room-chip">
          {lane.roomLabel}
        </div>
        {lane.contextLabel ? (
          <div className="squad-stage-zone__context-chip squad-stage-lane__context-chip">{lane.contextLabel}</div>
        ) : null}
        {lane.handoffLabel ? (
          <div
            className={cn("squad-stage-zone__baton-rail", "squad-stage-lane__baton-rail", batonSignalClassName(lane.signal))}
            data-active={lane.primaryActor?.motion === "handoff" || lane.signal === "active" ? "true" : "false"}
          >
            <svg className="squad-stage-zone__baton-arc squad-stage-lane__baton-arc" viewBox="0 0 120 18" aria-hidden>
              <path className="squad-stage-zone__baton-arc-path squad-stage-lane__baton-arc-path" d="M4 14 Q60 2 116 14" />
            </svg>
            <span className="squad-stage-zone__baton-token squad-stage-lane__baton-token" aria-hidden>
              <span className="squad-stage-zone__baton-sprite squad-stage-lane__baton-sprite" />
            </span>
          </div>
        ) : null}
        <SquadStageStation lane={lane} />
        <div className="squad-stage-zone__active-slot squad-stage-lane__active-slot">
          {lane.primaryActor ? (
            <div
              className="squad-stage-zone__active-anchor squad-stage-lane__active-anchor"
              data-lane={lane.id}
              data-side={actorSide}
              data-motion={lane.primaryActor.motion}
              style={
                {
                  ["--squad-stage-anchor" as "--squad-stage-anchor"]: `${actorAnchor}%`,
                  ["--squad-stage-beam-span" as "--squad-stage-beam-span"]: `${Math.abs(50 - actorAnchor)}%`,
                } as CSSProperties
              }
            >
              {shouldRenderWorkBeam(lane) ? (
                <span
                  className={cn("squad-stage-zone__work-beam", "squad-stage-lane__work-beam", `squad-stage-zone__work-beam--${lane.signal}`, `squad-stage-lane__work-beam--${lane.signal}`)}
                  data-testid={`squad-stage-work-beam-${lane.id}`}
                  aria-hidden
                >
                  <span className="squad-stage-zone__work-beam-dot squad-stage-lane__work-beam-dot" />
                </span>
              ) : null}
              {ambientActorBlueprints(lane).map((ambient) => (
                <span
                  key={ambient.id}
                  className="squad-stage-zone__ambient"
                  style={ambient.style}
                >
                  <SquadStageActor actor={ambient.actor} compact decorative />
                </span>
              ))}
              <SquadStageActor actor={lane.primaryActor} />
              {lane.packet ? <SquadStagePacketCard lane={lane} packet={lane.packet} /> : null}
            </div>
          ) : (
            <div className="squad-stage-zone__empty-state squad-stage-lane__empty-state">
              <span className="squad-stage-zone__empty-ghost squad-stage-lane__empty-ghost" aria-hidden />
              <span>{lane.signal === "idle" ? "Station idle" : "No active actor"}</span>
            </div>
          )}
        </div>
      </div>

      <div className="squad-stage-zone__footer squad-stage-lane__footer">
        {isQuietLane ? (
          <div className="squad-stage-zone__quiet squad-stage-lane__quiet">
            <span className="squad-stage-zone__quiet-copy squad-stage-lane__quiet-copy">
              {lane.id === "planning" ? "Warm intake standby" : "Warm standby"}
            </span>
            {lane.handoffLabel ? (
              <span className="squad-stage-zone__quiet-handoff squad-stage-lane__quiet-handoff">
                {lane.handoffLabel}
              </span>
            ) : null}
          </div>
        ) : (
          <>
            <div className="squad-stage-zone__queue-pocket squad-stage-lane__queue-pocket">
              <span className="squad-stage-zone__queue-label squad-stage-lane__queue-label">Queue pocket</span>
              <div className="squad-stage-zone__queue-actors squad-stage-lane__queue-actors">
                {lane.queueActors.length > 0 ? (
                  lane.queueActors.map((actor) => (
                    <SquadStageActor key={actor.id} actor={actor} compact />
                  ))
                ) : (
                  <span className="squad-stage-zone__queue-empty squad-stage-lane__queue-empty">clear</span>
                )}
              </div>
              {lane.queuePackets.length > 0 ? (
                <div className="squad-stage-zone__queue-packets squad-stage-lane__queue-packets">
                  {lane.queuePackets.map((packet) => (
                    <SquadStagePacketCard key={packet.id} lane={lane} packet={packet} compact />
                  ))}
                </div>
              ) : null}
            </div>

            <div className="squad-stage-zone__summary squad-stage-lane__summary">
              <p>{lane.workSummary}</p>
              {lane.spotlight ? (
                <Link to={lane.spotlight.href ?? "#"} className={cn("squad-stage-zone__spotlight", "squad-stage-lane__spotlight", `squad-stage-zone__spotlight--${lane.spotlight.tone}`, `squad-stage-lane__spotlight--${lane.spotlight.tone}`)}>
                  {lane.spotlight.label}
                </Link>
              ) : null}
              {lane.handoffLabel ? <span className="squad-stage-zone__handoff squad-stage-lane__handoff">{lane.handoffLabel}</span> : null}
            </div>
          </>
        )}
      </div>
    </article>
  );
}

function SquadStageLaneLedger({ lanes }: { lanes: SquadStageModel["lanes"] }) {
  return (
    <div className="squad-stage-ledger">
      {lanes.map((lane) => (
        <div
          key={lane.id}
          className={cn("squad-stage-ledger__item", `squad-stage-ledger__item--${lane.signal}`)}
          style={{ ["--squad-stage-accent" as "--squad-stage-accent"]: lane.accentColor } as CSSProperties}
        >
          <div className="squad-stage-ledger__title-row">
            <span className={cn("squad-stage-dot", signalDotClassName(lane.signal))} aria-hidden />
            <span className="squad-stage-ledger__title">{lane.title}</span>
          </div>
          <div className="squad-stage-ledger__copy">{lane.workSummary}</div>
        </div>
      ))}
    </div>
  );
}

export function SquadStageBoard({ model }: { model: SquadStageModel }) {
  return (
    <section className="squad-stage-shell rounded-[2rem] border border-border bg-card shadow-card" data-testid="squad-stage-board">
      <div className="squad-stage-shell__header">
        <div>
          <p className="squad-stage-shell__eyebrow">Team stage</p>
          <h2 className="squad-stage-shell__title">Squad Stage</h2>
          <p className="squad-stage-shell__subtitle">
            Watch the current party move through planning, routing, build, review, and release lanes.
          </p>
        </div>
        <div className="squad-stage-shell__stats">
          <span>{model.summary.hotActors} hot actors</span>
          <span>{model.summary.activeIssues} active items</span>
          <span>{model.summary.blockedIssues} blocked</span>
          <span>{model.summary.queuedIssues} queued</span>
        </div>
      </div>

      <div className="squad-stage-shell__flow">
        <SquadStageFlowStrip lanes={model.lanes} />
      </div>

      <div className="squad-stage-shell__body squad-stage-shell__body--scene">
        <div className="squad-stage-scene-wrap">
          <div className="squad-stage-scene">
            <SquadStageSceneBanner model={model} />
            <div className="squad-stage-scene__glow" aria-hidden />
            <div className="squad-stage-scene__concourse" aria-hidden />
            <div className="squad-stage-scene__floor" aria-hidden />
            <div className="squad-stage-scene__hub" aria-hidden>
              <span className="squad-stage-scene__hub-label">Dispatch</span>
            </div>
            <SquadStageSceneDispatch model={model} />
            <SquadStageSceneConnections lanes={model.lanes} />
            <SquadStageSceneCrew model={model} />
            <div className="squad-stage-scene__lanes">
              {model.lanes.map((lane) => (
                <SquadStageSceneZone key={lane.id} lane={lane} />
              ))}
            </div>
          </div>
          <SquadStageLaneLedger lanes={model.lanes} />
        </div>

        <aside className="squad-stage-rail">
          <div className="squad-stage-rail__panel">
            <h3>Office map</h3>
            <p className="squad-stage-rail__panel-copy">
              Live company rooms inherit project context and show which packet is moving through each lane.
            </p>
            {model.officeMap.projectLabels.length > 0 ? (
              <div className="squad-stage-rail__project-chips">
                {model.officeMap.projectLabels.map((projectLabel) => (
                  <span key={projectLabel} className="squad-stage-rail__project-chip">
                    {projectLabel}
                  </span>
                ))}
              </div>
            ) : null}
            <SquadStageOfficeMap model={model} />
          </div>

          <div className="squad-stage-rail__panel">
            <h3>Active pulse</h3>
            <p className="squad-stage-rail__panel-copy">
              Highest-priority work items currently shaping the squad rhythm.
            </p>
            <div className="squad-stage-rail__spotlights">
              {model.spotlights.length > 0 ? (
                model.spotlights.map((spotlight) => (
                  <Link
                    key={spotlight.id}
                    to={spotlight.href}
                    className={cn("squad-stage-rail__spotlight", `squad-stage-rail__spotlight--${spotlight.tone}`)}
                  >
                    <span className="squad-stage-rail__spotlight-label">{spotlight.label}</span>
                    <span className="squad-stage-rail__spotlight-summary">{spotlight.summary}</span>
                  </Link>
                ))
              ) : (
                <div className="squad-stage-rail__empty">No active delivery pulse right now.</div>
              )}
            </div>
          </div>

          <div className="squad-stage-rail__panel">
            <h3>Legend</h3>
            <div className="squad-stage-rail__legend">
              <div><span className="squad-stage-dot squad-stage-dot--active" /> active execution</div>
              <div><span className="squad-stage-dot squad-stage-dot--warning" /> handoff or review queue</div>
              <div><span className="squad-stage-dot squad-stage-dot--blocked" /> blocked / operator attention</div>
              <div><span className="squad-stage-dot squad-stage-dot--idle" /> idle or warm standby</div>
            </div>
          </div>

          <div className="squad-stage-rail__panel">
            <h3>Motion model</h3>
            <div className="squad-stage-rail__legend">
              <div>Walking: queued or moving to the next station</div>
              <div>Working: implementation or review execution is active</div>
              <div>Blocked: visible stop-state, not just a badge</div>
              <div className="squad-stage-rail__motion-note">
                <AlertTriangle className="h-4 w-4" />
                Reduced-motion users fall back to static poses automatically.
              </div>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
