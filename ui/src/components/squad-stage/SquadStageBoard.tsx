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
        ["--squad-stage-zone-top" as "--squad-stage-zone-top"]: "4%",
        ["--squad-stage-zone-width" as "--squad-stage-zone-width"]: "22%",
        ["--squad-stage-zone-height" as "--squad-stage-zone-height"]: "34%",
      } as CSSProperties;
    case "lead":
      return {
        ["--squad-stage-zone-left" as "--squad-stage-zone-left"]: "26.5%",
        ["--squad-stage-zone-top" as "--squad-stage-zone-top"]: "4%",
        ["--squad-stage-zone-width" as "--squad-stage-zone-width"]: "21%",
        ["--squad-stage-zone-height" as "--squad-stage-zone-height"]: "34%",
      } as CSSProperties;
    case "qa":
      return {
        ["--squad-stage-zone-left" as "--squad-stage-zone-left"]: "76%",
        ["--squad-stage-zone-top" as "--squad-stage-zone-top"]: "4%",
        ["--squad-stage-zone-width" as "--squad-stage-zone-width"]: "22%",
        ["--squad-stage-zone-height" as "--squad-stage-zone-height"]: "34%",
      } as CSSProperties;
    case "build":
      return {
        ["--squad-stage-zone-left" as "--squad-stage-zone-left"]: "10%",
        ["--squad-stage-zone-top" as "--squad-stage-zone-top"]: "41%",
        ["--squad-stage-zone-width" as "--squad-stage-zone-width"]: "31.5%",
        ["--squad-stage-zone-height" as "--squad-stage-zone-height"]: "36%",
      } as CSSProperties;
    case "review":
    default:
      return {
        ["--squad-stage-zone-left" as "--squad-stage-zone-left"]: "46%",
        ["--squad-stage-zone-top" as "--squad-stage-zone-top"]: "41%",
        ["--squad-stage-zone-width" as "--squad-stage-zone-width"]: "30%",
        ["--squad-stage-zone-height" as "--squad-stage-zone-height"]: "36%",
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

function queueActorPlacementForLane(laneId: SquadStageLane["id"], index: number): CSSProperties {
  const placements: Record<SquadStageLane["id"], Array<{ left: string; bottom: string }>> = {
    planning: [
      { left: "24%", bottom: "22%" },
      { left: "40%", bottom: "19%" },
      { left: "55%", bottom: "22%" },
    ],
    lead: [
      { left: "24%", bottom: "23%" },
      { left: "43%", bottom: "20%" },
      { left: "58%", bottom: "24%" },
    ],
    build: [
      { left: "58%", bottom: "18%" },
      { left: "74%", bottom: "22%" },
      { left: "84%", bottom: "18%" },
    ],
    review: [
      { left: "26%", bottom: "14%" },
      { left: "43%", bottom: "18%" },
      { left: "58%", bottom: "14%" },
    ],
    qa: [
      { left: "54%", bottom: "17%" },
      { left: "68%", bottom: "21%" },
      { left: "82%", bottom: "17%" },
    ],
  };
  const slot = placements[laneId][index] ?? placements[laneId][placements[laneId].length - 1]!;
  return {
    ["--squad-stage-queue-left" as "--squad-stage-queue-left"]: slot.left,
    ["--squad-stage-queue-bottom" as "--squad-stage-queue-bottom"]: slot.bottom,
  } as CSSProperties;
}

function queuePacketPlacementForLane(laneId: SquadStageLane["id"], index: number): CSSProperties {
  const placements: Record<SquadStageLane["id"], Array<{ left: string; bottom: string }>> = {
    planning: [
      { left: "61%", bottom: "9%" },
      { left: "72%", bottom: "11%" },
    ],
    lead: [
      { left: "64%", bottom: "10%" },
      { left: "76%", bottom: "12%" },
    ],
    build: [
      { left: "20%", bottom: "8%" },
      { left: "34%", bottom: "10%" },
    ],
    review: [
      { left: "66%", bottom: "8%" },
      { left: "78%", bottom: "10%" },
    ],
    qa: [
      { left: "22%", bottom: "8%" },
      { left: "36%", bottom: "10%" },
    ],
  };
  const slot = placements[laneId][index] ?? placements[laneId][placements[laneId].length - 1]!;
  return {
    ["--squad-stage-packet-left" as "--squad-stage-packet-left"]: slot.left,
    ["--squad-stage-packet-bottom" as "--squad-stage-packet-bottom"]: slot.bottom,
  } as CSSProperties;
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
  const topSpotlights = model.spotlights.slice(0, 1);
  return (
    <div className="squad-stage-scene__dispatch" data-testid="squad-stage-scene-dispatch">
      <div className="squad-stage-scene__dispatch-title">Current focus</div>
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

function SquadStagePriorityIssues({ model }: { model: SquadStageModel }) {
  return (
    <section className="squad-stage-priority-strip" data-testid="squad-stage-priority-strip">
      <div className="squad-stage-priority-strip__header">
        <div>
          <div className="squad-stage-priority-strip__eyebrow">Parent issue progress</div>
          <h3 className="squad-stage-priority-strip__title">What the squad is actually moving right now</h3>
        </div>
      </div>
      <div className="squad-stage-priority-strip__grid">
        {model.priorityIssues.length > 0 ? (
          model.priorityIssues.map((issue) => (
            <Link
              key={issue.id}
              to={issue.href}
              className={cn("squad-stage-priority-card", `squad-stage-priority-card--${issue.tone}`)}
              data-testid={`squad-stage-priority-issue-${issue.id}`}
            >
              <div className="squad-stage-priority-card__header">
                <span className="squad-stage-priority-card__label">{issue.label}</span>
                <span className={cn("squad-stage-priority-card__phase", `squad-stage-priority-card__phase--${issue.tone}`)}>
                  {issue.phaseLabel}
                </span>
              </div>
              <div className="squad-stage-priority-card__title" title={issue.title}>
                {issue.title}
              </div>
              <div className="squad-stage-priority-card__summary">{issue.summary}</div>
              <div className="squad-stage-priority-card__meta">
                <span>{issue.counts.total} packet{issue.counts.total > 1 ? "s" : ""}</span>
                {issue.projectLabel ? <span>{issue.projectLabel}</span> : null}
              </div>
            </Link>
          ))
        ) : (
          <div className="squad-stage-priority-strip__empty">
            No parent issue is pushing the floor right now. The next assigned request will land here first.
          </div>
        )}
      </div>
    </section>
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
  const actorAnchor = actorAnchorForLane(lane);
  const actorSide = actorAnchor < 50 ? "left" : "right";
  const hasQueue = lane.queueActors.length > 0 || lane.queuePackets.length > 0;
  const queueActors = lane.queueActors.slice(0, 3);
  const queuePackets = lane.queuePackets.slice(0, 2);

  return (
    <section
      className={cn("squad-stage-zone", "squad-stage-lane", signalClassName(lane.signal))}
      data-lane={lane.id}
      style={{
        ["--squad-stage-accent" as "--squad-stage-accent"]: lane.accentColor,
        ...scenePlacementForLane(lane.id),
      } as CSSProperties}
      data-testid={`squad-stage-lane-${lane.id}`}
    >
      <div className="squad-stage-zone__arena squad-stage-lane__arena">
        <div className="squad-stage-zone__backdrop squad-stage-lane__backdrop" data-testid={`squad-stage-room-${lane.id}`} aria-hidden />
        <div className="squad-stage-zone__track squad-stage-lane__track" aria-hidden />
        <div className="squad-stage-zone__plate">
          <div className="squad-stage-zone__plate-title">
            <span className={cn("squad-stage-dot", signalDotClassName(lane.signal))} aria-hidden />
            <span>{lane.title}</span>
            <span className="squad-stage-zone__plate-state">{signalLabel(lane.signal)}</span>
          </div>
          <div className="squad-stage-zone__plate-room" title={lane.roomLabel}>{lane.roomLabel}</div>
          <div className="squad-stage-zone__plate-station" title={lane.stationLabel}>{lane.stationLabel}</div>
        </div>
        {lane.contextLabel ? (
          <div
            className="squad-stage-zone__context-chip squad-stage-lane__context-chip"
            title={lane.contextLabel}
          >
            {lane.contextLabel}
          </div>
        ) : null}
        {lane.spotlight ? (
          <Link
            to={lane.spotlight.href ?? "#"}
            className={cn("squad-stage-zone__ticket", `squad-stage-zone__ticket--${lane.spotlight.tone}`)}
            title={lane.spotlight.label}
          >
            {lane.spotlight.label}
          </Link>
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
              {queueActors.map((actor, index) => (
                <span
                  key={actor.id}
                  className="squad-stage-zone__queue-actor"
                  style={queueActorPlacementForLane(lane.id, index)}
                >
                  <SquadStageActor actor={actor} compact scene />
                </span>
              ))}
              {queuePackets.map((packet, index) => (
                <span
                  key={packet.id}
                  className="squad-stage-zone__queue-packet"
                  style={queuePacketPlacementForLane(lane.id, index)}
                >
                  <SquadStagePacketCard lane={lane} packet={packet} compact />
                </span>
              ))}
              <SquadStageActor actor={lane.primaryActor} scene />
              {lane.packet ? (
                <span
                  className="squad-stage-zone__primary-packet"
                  data-testid={`squad-stage-packet-${lane.id}`}
                >
                  <SquadStagePacketCard lane={lane} packet={lane.packet} compact />
                </span>
              ) : null}
            </div>
          ) : (
            <div className="squad-stage-zone__empty-state squad-stage-lane__empty-state">
              <span className="squad-stage-zone__empty-ghost squad-stage-lane__empty-ghost" aria-hidden />
              <span>{lane.signal === "idle" ? "Station idle" : "No active actor"}</span>
              {queueActors.map((actor, index) => (
                <span
                  key={actor.id}
                  className="squad-stage-zone__queue-actor"
                  style={queueActorPlacementForLane(lane.id, index)}
                >
                  <SquadStageActor actor={actor} compact scene />
                </span>
              ))}
              {queuePackets.map((packet, index) => (
                <span
                  key={packet.id}
                  className="squad-stage-zone__queue-packet"
                  style={queuePacketPlacementForLane(lane.id, index)}
                >
                  <SquadStagePacketCard lane={lane} packet={packet} compact />
                </span>
              ))}
              {lane.packet ? (
                <span
                  className="squad-stage-zone__primary-packet"
                  data-testid={`squad-stage-packet-${lane.id}`}
                >
                  <SquadStagePacketCard lane={lane} packet={lane.packet} compact />
                </span>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="squad-stage-zone__footer squad-stage-lane__footer">
        <div className="squad-stage-zone__hud">
          <span className="squad-stage-zone__hud-copy">
            {lane.primaryActor ? lane.primaryActor.statusLabel : "Warm standby"}
          </span>
          <div className="squad-stage-zone__hud-metrics">
            {hasQueue ? (
              <span className="squad-stage-zone__summary-chip">
                Queue {lane.queueActors.length + lane.queuePackets.length}
              </span>
            ) : null}
            {lane.handoffLabel ? <span className="squad-stage-zone__handoff squad-stage-lane__handoff">{lane.handoffLabel}</span> : null}
          </div>
        </div>
      </div>
    </section>
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

export function SquadStageBoard({
  model,
  isSyncing = false,
  isBaseLoading = false,
}: {
  model: SquadStageModel;
  isSyncing?: boolean;
  isBaseLoading?: boolean;
}) {
  if (isBaseLoading) {
    return (
      <section className="squad-stage-shell rounded-[2rem] border border-border bg-card shadow-card" data-testid="squad-stage-board">
        <div className="squad-stage-shell__header">
          <div>
            <p className="squad-stage-shell__eyebrow">Team stage</p>
            <h2 className="squad-stage-shell__title">Squad Stage</h2>
            <p className="squad-stage-shell__subtitle">Loading team data…</p>
          </div>
        </div>
        <div className="flex items-center justify-center py-24 text-muted-foreground animate-pulse">
          Connecting to live floor
        </div>
      </section>
    );
  }

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
          <span>{isSyncing ? "syncing live floor" : "live floor ready"}</span>
          <span>{model.summary.hotActors} hot actors</span>
          <span>{model.summary.activeIssues} active items</span>
          <span>{model.summary.blockedIssues} blocked</span>
          <span>{model.summary.queuedIssues} queued</span>
        </div>
      </div>

      <div className="squad-stage-shell__flow">
        <SquadStageFlowStrip lanes={model.lanes} />
      </div>

      <SquadStagePriorityIssues model={model} />

      <div className="squad-stage-shell__body squad-stage-shell__body--scene">
        <div className="squad-stage-scene-wrap">
          <div className="squad-stage-scene__meta">
            <SquadStageSceneBanner model={model} />
            <SquadStageSceneDispatch model={model} />
          </div>
          <div className="squad-stage-scene">
            <div className="squad-stage-scene__glow" aria-hidden />
            <div className="squad-stage-scene__concourse" aria-hidden />
            <div className="squad-stage-scene__floor" aria-hidden />
            <div className="squad-stage-scene__hub" aria-hidden>
              <span className="squad-stage-scene__hub-label">Dispatch</span>
            </div>
            <SquadStageSceneConnections lanes={model.lanes} />
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
