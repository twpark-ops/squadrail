import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import type { DashboardAgentPerformanceItem } from "@squadrail/shared";
import {
  Bot,
  Building2,
  Clock3,
  Cpu,
  Network,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { agentsApi } from "../api/agents";
import { dashboardApi } from "../api/dashboard";
import { heartbeatsApi } from "../api/heartbeats";
import { projectsApi } from "../api/projects";
import { PageTabBar } from "../components/PageTabBar";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { cn, relativeTime } from "../lib/utils";
import { EmptyState } from "../components/EmptyState";
import { HeroSection } from "../components/HeroSection";
import {
  AgentJobIdentity,
  getAgentRolePresentation,
} from "../components/agent-presence-primitives";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { SquadStageBoard } from "../components/squad-stage/SquadStageBoard";
import { buildSquadStageModel } from "../lib/squad-stage/stage-model";

function TeamLaneCard({
  title,
  description,
  href,
  count,
  icon: Icon,
}: {
  title: string;
  description: string;
  href: string;
  count: string;
  icon: typeof Users;
}) {
  return (
    <Link
      to={href}
      className="rounded-[1.5rem] border border-border bg-background px-4 py-5 no-underline transition-colors hover:border-primary/18 hover:bg-accent/45"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="rounded-[0.95rem] border border-primary/10 bg-primary/8 p-2 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <span className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          {count}
        </span>
      </div>
      <div className="mt-4 text-base font-semibold text-foreground">{title}</div>
      <div className="mt-1 text-sm leading-6 text-muted-foreground">{description}</div>
    </Link>
  );
}

function TeamRosterSection({
  title,
  subtitle,
  agents,
  isLoading = false,
}: {
  title: string;
  subtitle: string;
  agents: Array<{
    id: string;
    urlKey: string | null;
    name: string;
    role: string;
    title: string | null;
    icon?: string | null;
    status: string;
    adapterType: string;
    lastHeartbeatAt: Date | string | null;
  }>;
  isLoading?: boolean;
}) {
  function describePresenceMode(agent: (typeof agents)[number]) {
    if (agent.status === "paused") return "paused";
    if (agent.status === "terminated") return "offline";
    if (agent.status === "active" && agent.lastHeartbeatAt) return "hot";
    if (agent.status === "active") return "ready";
    return "standby";
  }

  function describeActivity(agent: (typeof agents)[number]) {
    if (agent.status === "active") {
      return agent.lastHeartbeatAt ? "Hot lane" : "Ready";
    }
    if (agent.status === "paused") return "Paused";
    if (agent.status === "terminated") return "Offline";
    return "Standby";
  }

  function describePosture(agent: (typeof agents)[number]) {
    if (agent.status === "paused") {
      return "This lane is paused and will not pick up new work until an operator resumes it.";
    }
    if (agent.status === "terminated") {
      return "This lane is archived. Re-staff before routing new work here.";
    }
    if (!agent.lastHeartbeatAt) {
      return "Rostered and available, but no fresh heartbeat has landed yet.";
    }
    return `Last heartbeat ${relativeTime(agent.lastHeartbeatAt)}. Keep this lane warm for the next handoff.`;
  }

  return (
    <section className="rounded-[1.7rem] border border-border bg-card shadow-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="grid gap-3 p-5">
        {agents.length === 0 ? (
          <div className="rounded-[1.35rem] border border-dashed border-border px-5 py-8 text-sm text-muted-foreground">
            {isLoading ? "Loading roster..." : "No agents assigned to this lane yet."}
          </div>
        ) : (
          agents.map((agent, index) => {
            const presentation = getAgentRolePresentation(agent.role, agent.title);
            const activity = describeActivity(agent);
            const presenceMode = describePresenceMode(agent);

            return (
              <Link
                key={agent.id}
                to={`/agents/${agent.urlKey ?? agent.id}`}
                className="team-roster-card group rounded-[1.35rem] border border-border bg-background/80 p-4 no-underline"
                data-presence={presenceMode}
                style={
                  {
                    "--team-card-delay": `${Math.min(index, 6) * 80}ms`,
                  } as CSSProperties
                }
              >
                <div className="relative z-10">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div
                      className={cn(
                        "team-role-pill inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em]",
                        presentation.badgeClassName,
                      )}
                    >
                      <presentation.icon className={cn("h-3.5 w-3.5", presentation.iconClassName)} />
                      {presentation.classLabel}
                    </div>
                    <div className="flex flex-wrap gap-2 text-[11px]">
                      <span className="rounded-full border border-border bg-card px-2.5 py-1 font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        {agent.status}
                      </span>
                      <span
                        className={cn(
                          "team-live-pill rounded-full border px-2.5 py-1 font-medium uppercase tracking-[0.14em]",
                          presenceMode === "hot"
                            ? "team-live-pill-hot border-emerald-300/70 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200"
                            : presenceMode === "ready"
                              ? "team-live-pill-ready border-sky-300/70 bg-sky-500/10 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200"
                              : presenceMode === "standby"
                                ? "team-live-pill-standby border-amber-300/70 bg-amber-500/10 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200"
                              : "border-border bg-card text-muted-foreground",
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn("team-live-pill-dot", `team-live-pill-dot-${presenceMode}`)}
                        />
                        <span>{activity}</span>
                      </span>
                    </div>
                  </div>

                  <div className="mt-4">
                    <AgentJobIdentity
                      name={agent.name}
                      role={agent.role}
                      title={agent.title}
                      icon={agent.icon}
                      adapterType={agent.adapterType}
                      subtitle={
                        agent.lastHeartbeatAt
                          ? `heartbeat ${relativeTime(agent.lastHeartbeatAt)}`
                          : "no heartbeat yet"
                      }
                      avatarClassName={cn("team-avatar-shell", `team-avatar-${presenceMode}`)}
                      avatarAuraClassName={cn("team-avatar-aura", `team-avatar-aura-${presenceMode}`)}
                      roleBadgeClassName="team-job-badge"
                    />
                  </div>

                  <p className="mt-4 text-sm leading-6 text-muted-foreground">
                    {describePosture(agent)}
                  </p>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}

function formatRunDuration(value: number | null) {
  if (!value || value <= 0) return "n/a";
  const minutes = value / 60000;
  return minutes < 10 ? `${minutes.toFixed(1)}m` : `${Math.round(minutes)}m`;
}

function AgentPerformanceCard({
  item,
}: {
  item: DashboardAgentPerformanceItem;
}) {
  const toneClass =
    item.health === "risk"
      ? "text-red-600 border-red-500/25 bg-red-500/8"
      : item.health === "warning"
      ? "text-amber-600 border-amber-500/25 bg-amber-500/8"
      : "text-emerald-600 border-emerald-500/25 bg-emerald-500/8";

  return (
    <div className="rounded-[1.35rem] border border-border bg-background px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{item.name}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {item.title ?? item.role} · {item.adapterType.replace(/_/g, " ")}
          </div>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize ${toneClass}`}>
          {item.health}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            Success 7d
          </div>
          <div className="mt-1 text-xl font-semibold text-foreground">{item.successRate7d}%</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            Avg run
          </div>
          <div className="mt-1 text-xl font-semibold text-foreground">{formatRunDuration(item.averageRunDurationMs7d)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            Open load
          </div>
          <div className="mt-1 text-lg font-semibold text-foreground">{item.openIssueCount}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            Review / QA bounce
          </div>
          <div className="mt-1 text-lg font-semibold text-foreground">
            {item.reviewBounceCount30d} / {item.qaBounceCount30d}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="rounded-full border border-border bg-card px-2.5 py-1">
          {item.successfulRuns7d}/{item.totalRuns7d} succeeded
        </span>
        <span className="rounded-full border border-border bg-card px-2.5 py-1">
          {item.runningCount} running · {item.queuedCount} queued
        </span>
        {item.priorityPreemptions7d > 0 && (
          <span className="rounded-full border border-border bg-card px-2.5 py-1">
            {item.priorityPreemptions7d} preemptions
          </span>
        )}
      </div>

      <p className="mt-4 text-sm leading-6 text-muted-foreground">{item.summaryText}</p>
    </div>
  );
}

export function Team() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [teamView, setTeamView] = useState<"stage" | "roster" | "coverage">("stage");

  useEffect(() => {
    setBreadcrumbs([{ label: "Team" }]);
  }, [setBreadcrumbs]);

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const liveRunsQuery = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
  });
  const performanceQuery = useQuery({
    queryKey: queryKeys.dashboardAgentPerformance(selectedCompanyId!, 18),
    queryFn: () => dashboardApi.agentPerformance(selectedCompanyId!, 18),
    enabled: !!selectedCompanyId,
  });
  const teamSupervisionQuery = useQuery({
    queryKey: queryKeys.dashboardTeamSupervision(selectedCompanyId!, 18),
    queryFn: () => dashboardApi.teamSupervision(selectedCompanyId!, 18),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
  });

  const agents = agentsQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const liveRuns = liveRunsQuery.data ?? [];
  const performance = performanceQuery.data;
  const performanceItems = performance?.items ?? [];
  const performanceSummary = performance?.summary;
  const isBaseLoading = agentsQuery.isLoading || projectsQuery.isLoading;
  const isLiveStageSyncing =
    agentsQuery.isLoading
    || projectsQuery.isLoading
    || liveRunsQuery.isLoading
    || performanceQuery.isLoading
    || teamSupervisionQuery.isLoading;

  const leadershipTitlePattern = /(lead|head|chief|director|manager|cto|ceo|owner)/i;
  const qaTitlePattern = /(qa|quality|review)/i;

  const roleSummary = useMemo(() => {
    return {
      leaders: agents.filter(
        (agent) =>
          ["ceo", "cto", "pm"].includes(agent.role) || leadershipTitlePattern.test(agent.title ?? ""),
      ).length,
      engineers: agents.filter((agent) => agent.role === "engineer").length,
      qa: agents.filter((agent) => agent.role === "qa" || qaTitlePattern.test(agent.title ?? "")).length,
      active: agents.filter((agent) => agent.status === "active").length,
      codex: agents.filter((agent) => agent.adapterType === "codex_local").length,
      claude: agents.filter((agent) => agent.adapterType === "claude_local").length,
    };
  }, [agents]);

  const laneRoster = useMemo(() => {
    const sortedAgents = [...agents].sort((left, right) => {
      const leftHeartbeat = left.lastHeartbeatAt ? +new Date(left.lastHeartbeatAt) : 0;
      const rightHeartbeat = right.lastHeartbeatAt ? +new Date(right.lastHeartbeatAt) : 0;
      return rightHeartbeat - leftHeartbeat;
    });

    return {
      leadership: sortedAgents.filter(
        (agent) =>
          ["ceo", "cto", "pm"].includes(agent.role) || leadershipTitlePattern.test(agent.title ?? ""),
      ),
      execution: sortedAgents.filter((agent) => agent.role === "engineer"),
      review: sortedAgents.filter((agent) => agent.role === "qa" || qaTitlePattern.test(agent.title ?? "")),
    };
  }, [agents]);

  const coverageNotes = useMemo(() => {
    if (isBaseLoading) {
      return [
        "Loading roster and project coverage before calculating staffing and ownership notes.",
      ];
    }

    const notes: string[] = [];

    if (roleSummary.leaders === 0) {
      notes.push("Leadership coverage is missing. No clear operator or escalation owner is visible.");
    }
    if (roleSummary.engineers === 0) {
      notes.push("Execution coverage is missing. No engineer lane is available for implementation.");
    }
    if (roleSummary.qa === 0) {
      notes.push("Review coverage is missing. Approval and regression checks are not independently covered.");
    }
    if (projects.length > 0 && roleSummary.engineers > 0 && projects.length / roleSummary.engineers > 3) {
      notes.push("Project load per engineer is high. Context switching risk will grow as more work is assigned.");
    }
    if (notes.length === 0) {
      notes.push("Leadership, execution, and review lanes are all visible. The next gap is explicit project ownership.");
    }

    return notes;
  }, [isBaseLoading, projects, roleSummary.engineers, roleSummary.leaders, roleSummary.qa]);

  const liveAgentCount = new Set(liveRuns.map((run) => run.agentId)).size;
  const stageModel = useMemo(
    () =>
      buildSquadStageModel({
        companyLabel: selectedCompany?.name ?? "Company",
        agents,
        liveRuns,
        performanceItems,
        teamSupervision: teamSupervisionQuery.data,
        projects,
      }),
    [agents, liveRuns, performanceItems, projects, selectedCompany?.name, teamSupervisionQuery.data],
  );

  if (!selectedCompanyId) {
    return <EmptyState icon={Users} message="Select a company to inspect the squad." />;
  }

  return (
    <div className="space-y-8">
      <HeroSection
        eyebrow="Squad coverage"
        title="Team"
        subtitle={
          <span>
            Read leadership lanes, execution depth, and review capacity before assigning more work.
            This surface is strongest when it answers who owns routing, who builds, and who closes.
          </span>
        }
        actions={
          <>
            <Link
              to="/agents/all"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground no-underline transition-colors hover:border-primary/18 hover:bg-accent"
            >
              Open agents
              <Sparkles className="h-4 w-4" />
            </Link>
            <Link
              to="/org"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground no-underline transition-colors hover:border-primary/18 hover:bg-accent hover:text-foreground"
            >
              Org chart
              <Network className="h-4 w-4" />
            </Link>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[1.6rem] border border-border bg-card px-5 py-5 shadow-card">
          <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Leadership lanes
          </div>
          <div className="mt-3 text-3xl font-semibold text-foreground">
            {agentsQuery.isLoading ? "..." : roleSummary.leaders}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Operators, leads, and planners steering direction and escalation.</p>
        </div>
        <div className="rounded-[1.6rem] border border-border bg-card px-5 py-5 shadow-card">
          <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
            <Bot className="h-3.5 w-3.5" />
            Engineers
          </div>
          <div className="mt-3 text-3xl font-semibold text-foreground">
            {agentsQuery.isLoading ? "..." : roleSummary.engineers}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Execution lanes currently available for implementation and follow-through.</p>
        </div>
        <div className="rounded-[1.6rem] border border-border bg-card px-5 py-5 shadow-card">
          <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Verification lanes
          </div>
          <div className="mt-3 text-3xl font-semibold text-foreground">
            {agentsQuery.isLoading ? "..." : roleSummary.qa}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Reviewer and QA coverage available before close, release, or merge.</p>
        </div>
        <div className="rounded-[1.6rem] border border-border bg-card px-5 py-5 shadow-card">
          <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" />
            Live execution
          </div>
          <div className="mt-3 text-3xl font-semibold text-foreground">
            {liveRunsQuery.isLoading ? "..." : liveAgentCount}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Agents currently attached to running or queued execution.</p>
        </div>
      </div>

      <Tabs value={teamView} onValueChange={(value) => setTeamView(value as "stage" | "roster" | "coverage")}>
        <div className="rounded-[1.7rem] border border-border bg-card px-5 py-4 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Team surfaces</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Stage is now the primary squad surface. Roster and Coverage remain as operator support tabs.
              </p>
            </div>
            <PageTabBar
              items={[
                { value: "stage", label: "Stage" },
                { value: "roster", label: "Roster" },
                { value: "coverage", label: "Coverage" },
              ]}
              value={teamView}
              onValueChange={(value) => setTeamView(value as "stage" | "roster" | "coverage")}
            />
          </div>
        </div>

        <TabsContent value="stage" className="space-y-6">
          <SquadStageBoard model={stageModel} isSyncing={isLiveStageSyncing} isBaseLoading={isBaseLoading} />
        </TabsContent>

        <TabsContent value="roster" className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-3">
            <TeamRosterSection
              title="Leadership roster"
              subtitle="Planners, operators, and escalation owners steering routing, staffing, and recovery."
              agents={laneRoster.leadership}
              isLoading={agentsQuery.isLoading}
            />
            <TeamRosterSection
              title="Execution roster"
              subtitle="Builders and delivery owners sorted by the freshest heartbeat so active lanes stay on top."
              agents={laneRoster.execution}
              isLoading={agentsQuery.isLoading}
            />
            <TeamRosterSection
              title="Verification roster"
              subtitle="Review and QA lanes protecting close quality, release confidence, and regression evidence."
              agents={laneRoster.review}
              isLoading={agentsQuery.isLoading}
            />
          </div>
        </TabsContent>

        <TabsContent value="coverage" className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1.04fr_0.96fr]">
            <section className="rounded-[1.8rem] border border-border bg-card shadow-card">
              <div className="border-b border-border px-6 py-5">
                <h2 className="text-lg font-semibold">Operating Lanes</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Keep the operating party visible so owners can read planners, builders, and verification lanes at a glance.
                </p>
              </div>
              <div className="grid gap-4 px-6 py-6 md:grid-cols-3">
                <TeamLaneCard
                  href="/agents/all"
                  title="Agents"
                  description="Inspect execution lanes, current status, and runtime ownership from the full roster."
                  count={`${agents.length} total`}
                  icon={Bot}
                />
                <TeamLaneCard
                  href="/projects"
                  title="Projects"
                  description="Check how many product areas this squad is currently expected to cover."
                  count={`${projects.length} active`}
                  icon={Building2}
                />
                <TeamLaneCard
                  href="/org"
                  title="Org Chart"
                  description="Read escalation boundaries, reporting lines, and command structure before staffing decisions."
                  count={`${roleSummary.leaders} leads`}
                  icon={Network}
                />
              </div>
            </section>

            <section className="rounded-[1.8rem] border border-border bg-card shadow-card">
              <div className="border-b border-border px-6 py-5">
                <h2 className="text-lg font-semibold">Execution Mix</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Adapter distribution, current roster health, and project load in one pass.
                </p>
              </div>
              <div className="grid gap-4 px-6 py-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-[1.35rem] border border-border bg-background px-4 py-4">
                    <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                      <Cpu className="h-3.5 w-3.5" />
                      Engine coverage
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-3">
                      <div>
                        <div className="text-2xl font-semibold text-foreground">
                          {agentsQuery.isLoading ? "..." : roleSummary.codex}
                        </div>
                        <div className="text-sm text-muted-foreground">Codex lanes</div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-semibold text-foreground">
                          {agentsQuery.isLoading ? "..." : roleSummary.claude}
                        </div>
                        <div className="text-sm text-muted-foreground">Claude lanes</div>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-[1.35rem] border border-border bg-background px-4 py-4">
                    <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                      <Building2 className="h-3.5 w-3.5" />
                      Project load
                    </div>
                    <div className="mt-3 text-2xl font-semibold text-foreground">
                      {isBaseLoading
                        ? "..."
                        : roleSummary.engineers === 0
                          ? "n/a"
                          : (projects.length / roleSummary.engineers).toFixed(1)}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">Projects per engineer, based on current roster count.</div>
                  </div>
                </div>

                <div className="rounded-[1.35rem] border border-border bg-background">
                  <div className="border-b border-border px-4 py-3 text-sm font-medium text-foreground">Coverage notes</div>
                  <div className="grid gap-3 px-4 py-4">
                    {coverageNotes.map((note) => (
                      <div key={note} className="rounded-[1rem] border border-border bg-card px-3 py-3 text-sm leading-6 text-muted-foreground">
                        {note}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <section className="rounded-[1.8rem] border border-border bg-card shadow-card">
            <div className="border-b border-border px-6 py-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Agent performance scorecard</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Runtime reliability, delivery throughput, and change-request pressure per agent.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full border border-border bg-background px-2.5 py-1">
                    {performanceSummary?.healthyAgents ?? 0} healthy
                  </span>
                  <span className="rounded-full border border-border bg-background px-2.5 py-1">
                    {performanceSummary?.warningAgents ?? 0} warning
                  </span>
                  <span className="rounded-full border border-border bg-background px-2.5 py-1">
                    {performanceSummary?.riskAgents ?? 0} risk
                  </span>
                  <span className="rounded-full border border-border bg-background px-2.5 py-1">
                    {performanceSummary?.priorityPreemptions7d ?? 0} priority preemptions
                  </span>
                </div>
              </div>
            </div>
            <div className="grid gap-4 px-6 py-6 lg:grid-cols-2 xl:grid-cols-3">
              {performanceItems.length > 0 ? (
                performanceItems.map((item) => <AgentPerformanceCard key={item.agentId} item={item} />)
              ) : performanceQuery.isLoading ? (
                <div className="rounded-[1.35rem] border border-dashed border-border px-5 py-10 text-sm text-muted-foreground lg:col-span-2 xl:col-span-3">
                  Loading agent performance scorecard...
                </div>
              ) : (
                <div className="rounded-[1.35rem] border border-dashed border-border px-5 py-10 text-sm text-muted-foreground lg:col-span-2 xl:col-span-3">
                  No performance signals yet.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-[1.8rem] border border-border bg-card shadow-card">
            <div className="border-b border-border px-6 py-5">
              <h2 className="text-lg font-semibold text-foreground">Project coverage</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Product areas currently attached to this company. Ownership wiring still needs backend support, but coverage density is already visible.
              </p>
            </div>
            <div className="divide-y divide-border">
              {projects.length === 0 ? (
                <div className="px-6 py-10 text-sm text-muted-foreground">
                  {projectsQuery.isLoading ? "Loading projects..." : "No projects yet."}
                </div>
              ) : (
                projects.map((project) => (
                  <Link
                    key={project.id}
                    to={`/projects/${project.urlKey ?? project.id}`}
                    className="flex items-start justify-between gap-4 px-6 py-4 no-underline transition-colors hover:bg-accent/35"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground">{project.name}</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {project.workspaces.length} workspace{project.workspaces.length === 1 ? "" : "s"} · {project.status}
                      </div>
                    </div>
                    <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                      {project.urlKey ?? project.id.slice(0, 6)}
                    </span>
                  </Link>
                ))
              )}
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
