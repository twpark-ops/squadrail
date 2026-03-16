import type {
  DashboardAgentPerformanceItem,
  DashboardTeamSupervisionFeed,
  DashboardTeamSupervisionItem,
  Project,
} from "@squadrail/shared";
import type { LiveRunForIssue } from "../../api/heartbeats";

export type SquadStageLaneId = "planning" | "lead" | "build" | "review" | "qa";
export type SquadStageMotion = "idle" | "walking" | "working" | "reviewing" | "verifying" | "blocked" | "handoff" | "offline";
export type SquadStageSignal = "idle" | "active" | "warning" | "blocked";

type TeamAgent = {
  id: string;
  urlKey: string | null;
  name: string;
  role: string;
  title: string | null;
  icon?: string | null;
  status: string;
  adapterType: string;
  lastHeartbeatAt: Date | string | null;
};

export interface SquadStageActor {
  id: string;
  href: string;
  name: string;
  role: string;
  title: string | null;
  icon?: string | null;
  adapterType: string;
  laneId: SquadStageLaneId;
  spriteIndex: number;
  motion: SquadStageMotion;
  signal: SquadStageSignal;
  presence: "hot" | "ready" | "standby" | "paused" | "offline";
  statusLabel: string;
  subtitle: string;
  liveRun: LiveRunForIssue | null;
  performance: DashboardAgentPerformanceItem | null;
  focusIssueLabel: string | null;
  focusIssueHref: string | null;
}

export interface SquadStageLane {
  id: SquadStageLaneId;
  title: string;
  subtitle: string;
  stationLabel: string;
  roomLabel: string;
  contextLabel: string | null;
  accentColor: string;
  signal: SquadStageSignal;
  primaryActor: SquadStageActor | null;
  queueActors: SquadStageActor[];
  actors: SquadStageActor[];
  queueCount: number;
  spotlight: {
    label: string;
    href: string | null;
    tone: SquadStageSignal;
  } | null;
  packet: SquadStagePacket | null;
  queuePackets: SquadStagePacket[];
  workSummary: string;
  handoffLabel: string | null;
}

export interface SquadStagePacket {
  id: string;
  href: string | null;
  label: string;
  detail: string;
  projectLabel: string | null;
  tone: SquadStageSignal;
}

export interface SquadStageSpotlight {
  id: string;
  label: string;
  summary: string;
  href: string;
  tone: SquadStageSignal;
}

export interface SquadStagePriorityIssue {
  id: string;
  href: string;
  label: string;
  title: string;
  projectLabel: string | null;
  phaseLabel: string;
  summary: string;
  tone: SquadStageSignal;
  counts: {
    total: number;
    blocked: number;
    review: number;
    active: number;
    queued: number;
  };
}

export interface SquadStageModel {
  companyLabel: string;
  lanes: SquadStageLane[];
  spotlights: SquadStageSpotlight[];
  priorityIssues: SquadStagePriorityIssue[];
  officeMap: {
    rooms: Array<{
      laneId: SquadStageLaneId;
      title: string;
      roomLabel: string;
      contextLabel: string | null;
      packetLabel: string | null;
      tone: SquadStageSignal;
      accentColor: string;
      occupancyLabel: string;
    }>;
    projectLabels: string[];
  };
  summary: {
    hotActors: number;
    activeIssues: number;
    blockedIssues: number;
    queuedIssues: number;
  };
}

const LEADERSHIP_TITLE_PATTERN = /\b(tl|lead|head|chief|director|manager|owner|cto|ceo|principal)\b/i;
const REVIEW_TITLE_PATTERN = /\b(review|reviewer|approver)\b/i;
const QA_TITLE_PATTERN = /\b(qa|quality|verification|verifier)\b/i;
const PM_TITLE_PATTERN = /\b(pm|product)\b/i;

const LANE_ORDER: SquadStageLaneId[] = ["planning", "lead", "build", "review", "qa"];

const LANE_META: Record<SquadStageLaneId, { title: string; subtitle: string; stationLabel: string }> = {
  planning: {
    title: "Planning",
    subtitle: "Human request intake and PM shaping",
    stationLabel: "Intake podium",
  },
  lead: {
    title: "Lead",
    subtitle: "Routing, baton handoff, and escalation",
    stationLabel: "Routing desk",
  },
  build: {
    title: "Build",
    subtitle: "Implementation bench and active execution",
    stationLabel: "Builder bench",
  },
  review: {
    title: "Review",
    subtitle: "Diff review and design quality gate",
    stationLabel: "Review desk",
  },
  qa: {
    title: "QA",
    subtitle: "Acceptance and release confidence gate",
    stationLabel: "Release gate",
  },
};

const MOTION_PRIORITY: Record<SquadStageMotion, number> = {
  handoff: 0,
  blocked: 1,
  working: 2,
  reviewing: 3,
  verifying: 4,
  walking: 5,
  idle: 6,
  offline: 7,
};

const SUMMARY_KIND_PRIORITY: Record<DashboardTeamSupervisionItem["summaryKind"], number> = {
  blocked: 0,
  review: 1,
  active: 2,
  queued: 3,
};

const LANE_ACCENT_FALLBACK: Record<SquadStageLaneId, string> = {
  planning: "#f59e0b",
  lead: "#0ea5e9",
  build: "#3b82f6",
  review: "#a855f7",
  qa: "#22c55e",
};

const KIND_LABELS: Record<NonNullable<DashboardTeamSupervisionItem["kind"]>, string> = {
  plan: "planning packet",
  implementation: "implementation slice",
  review: "review packet",
  qa: "qa packet",
};

function rankLiveRun(run: LiveRunForIssue | null) {
  if (!run) return 99;
  if (run.status === "running") return 0;
  if (run.status === "claimed") return 1;
  if (run.status === "queued") return 2;
  return 3;
}

function readDateValue(value: Date | string | null | undefined) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function pickPrimaryLiveRun(runs: LiveRunForIssue[]) {
  if (runs.length === 0) return null;
  return [...runs].sort((left, right) => {
    if (rankLiveRun(left) !== rankLiveRun(right)) {
      return rankLiveRun(left) - rankLiveRun(right);
    }
    return readDateValue(right.startedAt ?? right.createdAt) - readDateValue(left.startedAt ?? left.createdAt);
  })[0] ?? null;
}

function deriveLaneId(agent: TeamAgent): SquadStageLaneId {
  const title = agent.title ?? "";
  if (agent.role === "pm" || PM_TITLE_PATTERN.test(title)) return "planning";
  if (REVIEW_TITLE_PATTERN.test(title) && !QA_TITLE_PATTERN.test(title)) return "review";
  if (agent.role === "qa" || QA_TITLE_PATTERN.test(title)) return "qa";
  if (agent.role === "engineer") return "build";
  if (LEADERSHIP_TITLE_PATTERN.test(title) || agent.role === "ceo" || agent.role === "cto") return "lead";
  return "build";
}

function derivePresence(agent: TeamAgent): SquadStageActor["presence"] {
  if (agent.status === "paused") return "paused";
  if (agent.status === "terminated") return "offline";
  if (agent.status === "active" && agent.lastHeartbeatAt) return "hot";
  if (agent.status === "active") return "ready";
  return "standby";
}

function deriveSpriteIndex(laneId: SquadStageLaneId, agentId: string) {
  const baseByLane: Record<SquadStageLaneId, number> = {
    planning: 0,
    lead: 4,
    build: 1,
    review: 3,
    qa: 5,
  };
  const seed = [...agentId].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return (baseByLane[laneId] + seed) % 6;
}

function deriveIssueHref(issueId: string, identifier: string | null) {
  const ref = identifier ?? issueId;
  return `/work/${ref}`;
}

function deriveFocusIssue(actorId: string, laneId: SquadStageLaneId, supervision: DashboardTeamSupervisionItem[]) {
  const matches = supervision.filter((item) => {
    if (laneId === "lead") return item.techLead?.id === actorId;
    if (laneId === "review") return item.reviewer?.id === actorId;
    return item.assignee?.id === actorId;
  });
  if (matches.length === 0) return { label: null, href: null };
  const best = [...matches].sort((left, right) => {
    if (SUMMARY_KIND_PRIORITY[left.summaryKind] !== SUMMARY_KIND_PRIORITY[right.summaryKind]) {
      return SUMMARY_KIND_PRIORITY[left.summaryKind] - SUMMARY_KIND_PRIORITY[right.summaryKind];
    }
    return readDateValue(right.updatedAt) - readDateValue(left.updatedAt);
  })[0];
  const rootLabel = best.rootIdentifier ?? best.rootTitle;
  const workLabel = best.workItemIdentifier ?? best.workItemTitle;
  return {
    label: workLabel !== rootLabel ? `${rootLabel} / ${workLabel}` : rootLabel,
    href: deriveIssueHref(best.rootIssueId, best.rootIdentifier),
  };
}

function deriveActorSignal(run: LiveRunForIssue | null, performance: DashboardAgentPerformanceItem | null, motion: SquadStageMotion): SquadStageSignal {
  if (motion === "blocked") return "blocked";
  if (run && (run.status === "running" || run.status === "claimed" || run.status === "queued")) return "active";
  if (performance?.health === "risk" || performance?.health === "warning") return "warning";
  return "idle";
}

function deriveMotion(input: {
  laneId: SquadStageLaneId;
  agent: TeamAgent;
  run: LiveRunForIssue | null;
  performance: DashboardAgentPerformanceItem | null;
  focusItems: DashboardTeamSupervisionItem[];
}): SquadStageMotion {
  if (input.agent.status === "terminated") return "offline";
  if (input.focusItems.some((item) => item.summaryKind === "blocked")) return "blocked";

  const run = input.run;
  if (!run) {
    if (input.performance?.health === "risk") return "blocked";
    return "idle";
  }

  const triggerText = `${run.invocationSource} ${run.triggerDetail ?? ""}`.toLowerCase();
  if (triggerText.includes("assign") || triggerText.includes("handoff") || triggerText.includes("reassign")) {
    return "handoff";
  }
  if (run.status === "queued" || run.status === "claimed") {
    return "walking";
  }
  if (input.laneId === "review") return "reviewing";
  if (input.laneId === "qa") return "verifying";
  if (input.laneId === "planning" || input.laneId === "lead") return "walking";
  return "working";
}

function summarizeLaneWork(laneId: SquadStageLaneId, items: DashboardTeamSupervisionItem[]) {
  if (items.length === 0) {
    return laneId === "planning"
      ? "No intake queue is visible right now."
      : "No active work is parked in this lane.";
  }
  const blocked = items.filter((item) => item.summaryKind === "blocked").length;
  const review = items.filter((item) => item.summaryKind === "review").length;
  const active = items.filter((item) => item.summaryKind === "active").length;
  const queued = items.filter((item) => item.summaryKind === "queued").length;
  const parts = [];
  if (blocked > 0) parts.push(`${blocked} blocked`);
  if (review > 0) parts.push(`${review} review-waiting`);
  if (active > 0) parts.push(`${active} active`);
  if (queued > 0) parts.push(`${queued} queued`);
  return parts.join(" · ");
}

function deriveLaneSignal(items: DashboardTeamSupervisionItem[], actors: SquadStageActor[]): SquadStageSignal {
  if (items.some((item) => item.summaryKind === "blocked") || actors.some((actor) => actor.signal === "blocked")) {
    return "blocked";
  }
  if (
    items.some((item) => item.summaryKind === "review")
    || items.some((item) => item.summaryKind === "active")
    || actors.some((actor) => actor.signal === "active")
  ) {
    return "active";
  }
  if (items.length > 0 || actors.some((actor) => actor.signal === "warning")) {
    return "warning";
  }
  return "idle";
}

function packetTone(item: DashboardTeamSupervisionItem): SquadStageSignal {
  return item.summaryKind === "blocked"
    ? "blocked"
    : item.summaryKind === "queued"
      ? "warning"
      : "active";
}

function packetDetail(item: DashboardTeamSupervisionItem) {
  const rootLabel = item.rootIdentifier ?? item.rootTitle;
  const projectLabel = item.rootProjectName ?? "Shared room";
  const kindLabel = item.kind ? KIND_LABELS[item.kind] : "delivery packet";
  const workLabel = item.workItemIdentifier ?? item.workItemTitle;
  if (workLabel !== rootLabel) {
    return `${projectLabel} · child of ${rootLabel}`;
  }
  return `${projectLabel} · ${kindLabel}`;
}

function makePacket(item: DashboardTeamSupervisionItem): SquadStagePacket {
  return {
    id: item.workItemIssueId,
    href: deriveIssueHref(item.workItemIssueId, item.workItemIdentifier),
    label: item.workItemIdentifier ?? item.workItemTitle,
    detail: packetDetail(item),
    projectLabel: item.rootProjectName,
    tone: packetTone(item),
  };
}

function dominantProjectForLane(
  laneId: SquadStageLaneId,
  items: DashboardTeamSupervisionItem[],
  projects: Project[],
) {
  const weighted = new Map<string, { count: number; project: Project | null; name: string }>();
  for (const item of items) {
    const key = item.rootProjectId ?? item.rootProjectName;
    if (!key) continue;
    const existing = weighted.get(key);
    const project =
      (item.rootProjectId ? projects.find((candidate) => candidate.id === item.rootProjectId) : null)
      ?? (item.rootProjectName ? projects.find((candidate) => candidate.name === item.rootProjectName) : null)
      ?? null;
    weighted.set(key, {
      count: (existing?.count ?? 0) + 1,
      project,
      name: item.rootProjectName ?? project?.name ?? "Shared room",
    });
  }

  const dominant = [...weighted.values()].sort((left, right) => right.count - left.count)[0];
  if (dominant) return dominant;

  const fallbackProject = projects[LANE_ORDER.indexOf(laneId) % Math.max(projects.length, 1)] ?? null;
  return fallbackProject
    ? {
        count: 0,
        project: fallbackProject,
        name: fallbackProject.name,
      }
    : null;
}

function roomLabelForLane(laneId: SquadStageLaneId, projectName: string | null) {
  const prefix = projectName ?? "Shared";
  switch (laneId) {
    case "planning":
      return `${prefix} briefing room`;
    case "lead":
      return `${prefix} routing room`;
    case "build":
      return `${prefix} build bay`;
    case "review":
      return `${prefix} review booth`;
    case "qa":
      return `${prefix} release gate`;
  }
}

function contextLabelForLane(
  laneId: SquadStageLaneId,
  items: DashboardTeamSupervisionItem[],
  projectName: string | null,
) {
  const topItem = [...items].sort((left, right) => {
    if (SUMMARY_KIND_PRIORITY[left.summaryKind] !== SUMMARY_KIND_PRIORITY[right.summaryKind]) {
      return SUMMARY_KIND_PRIORITY[left.summaryKind] - SUMMARY_KIND_PRIORITY[right.summaryKind];
    }
    return readDateValue(right.updatedAt) - readDateValue(left.updatedAt);
  })[0];
  if (!topItem) {
    return projectName ? `${projectName} lane standing by` : null;
  }

  const rootLabel = topItem.rootIdentifier ?? topItem.rootTitle;
  const workLabel = topItem.workItemIdentifier ?? topItem.workItemTitle;
  if (laneId === "planning") {
    return `Intake anchored on ${rootLabel}`;
  }
  if (workLabel !== rootLabel) {
    return `${workLabel} from ${rootLabel}`;
  }
  return `${projectName ?? "Shared"} · ${rootLabel}`;
}

function laneItemsForActor(agentId: string, laneId: SquadStageLaneId, supervision: DashboardTeamSupervisionItem[]) {
  return supervision.filter((item) => {
    if (laneId === "lead") return item.techLead?.id === agentId;
    if (laneId === "review") return item.reviewer?.id === agentId;
    return item.assignee?.id === agentId;
  });
}

function laneItemsForLane(laneId: SquadStageLaneId, supervision: DashboardTeamSupervisionItem[]) {
  return supervision.filter((item) => {
    if (laneId === "planning") return item.kind === "plan";
    if (laneId === "lead") return Boolean(item.techLead);
    if (laneId === "build") return item.kind === "implementation";
    if (laneId === "review") return item.kind === "review" || Boolean(item.reviewer);
    return item.kind === "qa";
  });
}

function buildSpotlights(supervision: DashboardTeamSupervisionItem[]): SquadStageSpotlight[] {
  return [...supervision]
    .sort((left, right) => {
      if (SUMMARY_KIND_PRIORITY[left.summaryKind] !== SUMMARY_KIND_PRIORITY[right.summaryKind]) {
        return SUMMARY_KIND_PRIORITY[left.summaryKind] - SUMMARY_KIND_PRIORITY[right.summaryKind];
      }
      return readDateValue(right.updatedAt) - readDateValue(left.updatedAt);
    })
    .slice(0, 4)
    .map((item) => ({
      id: item.workItemIssueId,
      label: item.rootIdentifier ?? item.rootTitle,
      summary: item.summaryText,
      href: deriveIssueHref(item.rootIssueId, item.rootIdentifier),
      tone: item.summaryKind === "blocked" ? "blocked" : item.summaryKind === "queued" ? "warning" : "active",
    }));
}

function tonePriority(signal: SquadStageSignal) {
  switch (signal) {
    case "blocked":
      return 0;
    case "active":
      return 1;
    case "warning":
      return 2;
    default:
      return 3;
  }
}

function phaseLabelForItems(items: DashboardTeamSupervisionItem[]) {
  if (items.some((item) => item.summaryKind === "blocked")) return "Blocked";
  if (items.some((item) => item.kind === "qa")) return "QA gate";
  if (items.some((item) => item.kind === "review" || item.summaryKind === "review")) return "Review";
  if (items.some((item) => item.kind === "implementation")) return "Implementation";
  if (items.some((item) => item.kind === "plan")) return "Planning";
  return "Queued";
}

function summaryForPriorityIssue(issue: {
  blocked: number;
  review: number;
  active: number;
  queued: number;
  total: number;
}) {
  if (issue.blocked > 0) {
    return `${issue.blocked} blocked · ${issue.total} active packet${issue.total > 1 ? "s" : ""}`;
  }
  if (issue.review > 0) {
    return `${issue.review} waiting for review or QA`;
  }
  if (issue.active > 0) {
    return `${issue.active} packet${issue.active > 1 ? "s" : ""} moving now`;
  }
  if (issue.queued > 0) {
    return `${issue.queued} queued for the next handoff`;
  }
  return "No active packet visible right now.";
}

function buildPriorityIssues(supervision: DashboardTeamSupervisionItem[]): SquadStagePriorityIssue[] {
  const grouped = new Map<
    string,
    {
      rootIssueId: string;
      rootIdentifier: string | null;
      rootTitle: string;
      rootProjectName: string | null;
      items: DashboardTeamSupervisionItem[];
      lastUpdatedAt: number;
    }
  >();

  for (const item of supervision) {
    const existing = grouped.get(item.rootIssueId);
    if (existing) {
      existing.items.push(item);
      existing.lastUpdatedAt = Math.max(existing.lastUpdatedAt, readDateValue(item.updatedAt));
      continue;
    }
    grouped.set(item.rootIssueId, {
      rootIssueId: item.rootIssueId,
      rootIdentifier: item.rootIdentifier,
      rootTitle: item.rootTitle,
      rootProjectName: item.rootProjectName,
      items: [item],
      lastUpdatedAt: readDateValue(item.updatedAt),
    });
  }

  return [...grouped.values()]
    .map((group) => {
      const counts = {
        total: group.items.length,
        blocked: group.items.filter((item) => item.summaryKind === "blocked").length,
        review: group.items.filter((item) => item.summaryKind === "review").length,
        active: group.items.filter((item) => item.summaryKind === "active").length,
        queued: group.items.filter((item) => item.summaryKind === "queued").length,
      };
      const tone: SquadStageSignal =
        counts.blocked > 0 ? "blocked" : counts.review > 0 || counts.active > 0 ? "active" : counts.queued > 0 ? "warning" : "idle";

      return {
        id: group.rootIssueId,
        href: deriveIssueHref(group.rootIssueId, group.rootIdentifier),
        label: group.rootIdentifier ?? group.rootTitle,
        title: group.rootTitle,
        projectLabel: group.rootProjectName,
        phaseLabel: phaseLabelForItems(group.items),
        summary: summaryForPriorityIssue(counts),
        tone,
        counts,
        lastUpdatedAt: group.lastUpdatedAt,
      };
    })
    .sort((left, right) => {
      if (tonePriority(left.tone) !== tonePriority(right.tone)) {
        return tonePriority(left.tone) - tonePriority(right.tone);
      }
      return right.lastUpdatedAt - left.lastUpdatedAt;
    })
    .slice(0, 4)
    .map(({ lastUpdatedAt: _lastUpdatedAt, ...issue }) => issue);
}

export function buildSquadStageModel(input: {
  companyLabel: string;
  agents: TeamAgent[];
  liveRuns: LiveRunForIssue[];
  performanceItems: DashboardAgentPerformanceItem[];
  teamSupervision: DashboardTeamSupervisionFeed | null | undefined;
  projects: Project[];
}): SquadStageModel {
  const runsByAgent = new Map<string, LiveRunForIssue[]>();
  for (const run of input.liveRuns) {
    const existing = runsByAgent.get(run.agentId);
    if (existing) existing.push(run);
    else runsByAgent.set(run.agentId, [run]);
  }

  const performanceByAgent = new Map(input.performanceItems.map((item) => [item.agentId, item]));
  const supervisionItems = input.teamSupervision?.items ?? [];

  const actors = input.agents.map<SquadStageActor>((agent) => {
    const laneId = deriveLaneId(agent);
    const liveRun = pickPrimaryLiveRun(runsByAgent.get(agent.id) ?? []);
    const performance = performanceByAgent.get(agent.id) ?? null;
    const focusItems = laneItemsForActor(agent.id, laneId, supervisionItems);
    const focusIssue = deriveFocusIssue(agent.id, laneId, supervisionItems);
    const motion = deriveMotion({
      laneId,
      agent,
      run: liveRun,
      performance,
      focusItems,
    });
    const signal = deriveActorSignal(liveRun, performance, motion);
    const statusLabel =
      motion === "blocked"
        ? "Blocked"
        : motion === "handoff"
          ? "Handing off"
          : motion === "walking"
            ? "Moving"
            : motion === "reviewing"
              ? "Reviewing"
              : motion === "verifying"
                ? "Verifying"
                : motion === "working"
                  ? "Implementing"
                  : derivePresence(agent) === "offline"
                    ? "Offline"
                    : derivePresence(agent) === "paused"
                      ? "Paused"
                      : "Idle";

    const subtitle = liveRun
      ? `${liveRun.status} · ${liveRun.invocationSource.replace(/_/g, " ")}`
      : performance?.summaryText ?? "Standing by for the next handoff.";

    return {
      id: agent.id,
      href: `/agents/${agent.urlKey ?? agent.id}`,
      name: agent.name,
      role: agent.role,
      title: agent.title,
      icon: agent.icon,
      adapterType: agent.adapterType,
      laneId,
      spriteIndex: deriveSpriteIndex(laneId, agent.id),
      motion,
      signal,
      presence: derivePresence(agent),
      statusLabel,
      subtitle,
      liveRun,
      performance,
      focusIssueLabel: focusIssue.label,
      focusIssueHref: focusIssue.href,
    };
  });

  const lanes = LANE_ORDER.map<SquadStageLane>((laneId, index) => {
    const laneActors = actors
      .filter((actor) => actor.laneId === laneId)
      .sort((left, right) => {
        if (MOTION_PRIORITY[left.motion] !== MOTION_PRIORITY[right.motion]) {
          return MOTION_PRIORITY[left.motion] - MOTION_PRIORITY[right.motion];
        }
        if (readDateValue(right.liveRun?.createdAt) !== readDateValue(left.liveRun?.createdAt)) {
          return readDateValue(right.liveRun?.createdAt) - readDateValue(left.liveRun?.createdAt);
        }
        return left.name.localeCompare(right.name);
      });
    const laneItems = laneItemsForLane(laneId, supervisionItems);
    const signal = deriveLaneSignal(laneItems, laneActors);
    const dominantProject = dominantProjectForLane(laneId, laneItems, input.projects);
    const spotlightItem = [...laneItems].sort((left, right) => {
      if (SUMMARY_KIND_PRIORITY[left.summaryKind] !== SUMMARY_KIND_PRIORITY[right.summaryKind]) {
        return SUMMARY_KIND_PRIORITY[left.summaryKind] - SUMMARY_KIND_PRIORITY[right.summaryKind];
      }
      return readDateValue(right.updatedAt) - readDateValue(left.updatedAt);
    })[0] ?? null;
    const packets = laneItems.slice(0, 4).map(makePacket);
    const roomLabel = roomLabelForLane(laneId, dominantProject?.name ?? null);
    const contextLabel = contextLabelForLane(laneId, laneItems, dominantProject?.name ?? null);
    const accentColor = dominantProject?.project?.color ?? LANE_ACCENT_FALLBACK[laneId];

    return {
      id: laneId,
      title: LANE_META[laneId].title,
      subtitle: LANE_META[laneId].subtitle,
      stationLabel: LANE_META[laneId].stationLabel,
      roomLabel,
      contextLabel,
      accentColor,
      signal,
      primaryActor: laneActors[0] ?? null,
      queueActors: laneActors.slice(1, 5),
      actors: laneActors,
      queueCount: Math.max(laneItems.length - (laneActors[0] ? 1 : 0), 0),
      spotlight: spotlightItem
        ? {
            label: spotlightItem.workItemIdentifier ?? spotlightItem.workItemTitle,
            href: deriveIssueHref(spotlightItem.workItemIssueId, spotlightItem.workItemIdentifier),
            tone: spotlightItem.summaryKind === "blocked" ? "blocked" : spotlightItem.summaryKind === "queued" ? "warning" : "active",
          }
        : null,
      packet: packets[0] ?? null,
      queuePackets: packets.slice(1),
      workSummary: summarizeLaneWork(laneId, laneItems),
      handoffLabel: index < LANE_ORDER.length - 1 ? `handoff -> ${LANE_META[LANE_ORDER[index + 1]].title}` : null,
    };
  });

  return {
    companyLabel: input.companyLabel,
    lanes,
    spotlights: buildSpotlights(supervisionItems),
    priorityIssues: buildPriorityIssues(supervisionItems),
    officeMap: {
      rooms: lanes.map((lane) => ({
        laneId: lane.id,
        title: lane.title,
        roomLabel: lane.roomLabel,
        contextLabel: lane.contextLabel,
        packetLabel: lane.packet?.label ?? null,
        tone: lane.signal,
        accentColor: lane.accentColor,
        occupancyLabel: lane.primaryActor ? `${lane.primaryActor.name} on deck` : "No active actor",
      })),
      projectLabels: [...new Set(
        lanes
          .map((lane) => lane.roomLabel.replace(/\s+(briefing room|routing room|build bay|review booth|release gate)$/i, ""))
          .filter((label) => label !== "Shared"),
      )].slice(0, 4),
    },
    summary: {
      hotActors: actors.filter((actor) => actor.presence === "hot").length,
      activeIssues: supervisionItems.filter((item) => item.summaryKind === "active" || item.summaryKind === "review").length,
      blockedIssues: supervisionItems.filter((item) => item.summaryKind === "blocked").length,
      queuedIssues: supervisionItems.filter((item) => item.summaryKind === "queued").length,
    },
  };
}
