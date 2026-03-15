import { useEffect, useMemo } from "react";
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
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { relativeTime } from "../lib/utils";
import { EmptyState } from "../components/EmptyState";
import { HeroSection } from "../components/HeroSection";
import { PageSkeleton } from "../components/PageSkeleton";
import { AgentJobIdentity } from "../components/agent-presence-primitives";

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
}) {
  return (
    <section className="rounded-[1.7rem] border border-border bg-card shadow-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="divide-y divide-border">
        {agents.length === 0 ? (
          <div className="px-5 py-8 text-sm text-muted-foreground">No agents assigned to this lane yet.</div>
        ) : (
          agents.map((agent) => (
            <Link
              key={agent.id}
              to={`/agents/${agent.urlKey ?? agent.id}`}
              className="flex items-start justify-between gap-4 px-5 py-4 no-underline transition-colors hover:bg-accent/35"
            >
              <div className="min-w-0 flex-1">
                <AgentJobIdentity
                  name={agent.name}
                  role={agent.role}
                  title={agent.title}
                  icon={agent.icon}
                  adapterType={agent.adapterType}
                  subtitle={agent.lastHeartbeatAt ? `heartbeat ${relativeTime(agent.lastHeartbeatAt)}` : "no heartbeat yet"}
                />
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full border border-border bg-background px-2.5 py-1">
                    {agent.status}
                  </span>
                  <span className="rounded-full border border-border bg-background px-2.5 py-1">
                    {agent.lastHeartbeatAt ? "recently active" : "cold lane"}
                  </span>
                </div>
              </div>
            </Link>
          ))
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
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

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

  const leadershipTitlePattern = /(lead|head|chief|director|manager|cto|ceo|owner)/i;
  const qaTitlePattern = /(qa|quality|review)/i;

  const roleSummary = useMemo(() => {
    const agents = agentsQuery.data ?? [];

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
  }, [agentsQuery.data]);

  const laneRoster = useMemo(() => {
    const agents = [...(agentsQuery.data ?? [])].sort((left, right) => {
      const leftHeartbeat = left.lastHeartbeatAt ? +new Date(left.lastHeartbeatAt) : 0;
      const rightHeartbeat = right.lastHeartbeatAt ? +new Date(right.lastHeartbeatAt) : 0;
      return rightHeartbeat - leftHeartbeat;
    });

    return {
      leadership: agents.filter(
        (agent) =>
          ["ceo", "cto", "pm"].includes(agent.role) || leadershipTitlePattern.test(agent.title ?? ""),
      ),
      execution: agents.filter((agent) => agent.role === "engineer"),
      review: agents.filter((agent) => agent.role === "qa" || qaTitlePattern.test(agent.title ?? "")),
    };
  }, [agentsQuery.data]);

  const coverageNotes = useMemo(() => {
    const projects = projectsQuery.data ?? [];
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
  }, [projectsQuery.data, roleSummary.engineers, roleSummary.leaders, roleSummary.qa]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Users} message="Select a company to inspect the squad." />;
  }

  if (agentsQuery.isLoading || projectsQuery.isLoading || liveRunsQuery.isLoading || performanceQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  const projects = projectsQuery.data ?? [];
  const agents = agentsQuery.data ?? [];
  const liveAgentCount = new Set((liveRunsQuery.data ?? []).map((run) => run.agentId)).size;
  const performance = performanceQuery.data;

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
          <div className="mt-3 text-3xl font-semibold text-foreground">{roleSummary.leaders}</div>
          <p className="mt-2 text-sm text-muted-foreground">Operators, leads, and planners steering direction and escalation.</p>
        </div>
        <div className="rounded-[1.6rem] border border-border bg-card px-5 py-5 shadow-card">
          <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
            <Bot className="h-3.5 w-3.5" />
            Engineers
          </div>
          <div className="mt-3 text-3xl font-semibold text-foreground">{roleSummary.engineers}</div>
          <p className="mt-2 text-sm text-muted-foreground">Execution lanes currently available for implementation and follow-through.</p>
        </div>
        <div className="rounded-[1.6rem] border border-border bg-card px-5 py-5 shadow-card">
          <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            QA / reviewers
          </div>
          <div className="mt-3 text-3xl font-semibold text-foreground">{roleSummary.qa}</div>
          <p className="mt-2 text-sm text-muted-foreground">Review and regression capacity available before close or merge.</p>
        </div>
        <div className="rounded-[1.6rem] border border-border bg-card px-5 py-5 shadow-card">
          <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" />
            Live execution
          </div>
          <div className="mt-3 text-3xl font-semibold text-foreground">{liveAgentCount}</div>
          <p className="mt-2 text-sm text-muted-foreground">Agents currently attached to running or queued execution.</p>
        </div>
      </div>

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
                    <div className="text-2xl font-semibold text-foreground">{roleSummary.codex}</div>
                    <div className="text-sm text-muted-foreground">Codex lanes</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-semibold text-foreground">{roleSummary.claude}</div>
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
                  {roleSummary.engineers === 0 ? "n/a" : (projects.length / roleSummary.engineers).toFixed(1)}
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
                {performance?.summary.healthyAgents ?? 0} healthy
              </span>
              <span className="rounded-full border border-border bg-background px-2.5 py-1">
                {performance?.summary.warningAgents ?? 0} warning
              </span>
              <span className="rounded-full border border-border bg-background px-2.5 py-1">
                {performance?.summary.riskAgents ?? 0} risk
              </span>
              <span className="rounded-full border border-border bg-background px-2.5 py-1">
                {performance?.summary.priorityPreemptions7d ?? 0} priority preemptions
              </span>
            </div>
          </div>
        </div>
        <div className="grid gap-4 px-6 py-6 lg:grid-cols-2 xl:grid-cols-3">
          {(performance?.items ?? []).map((item) => (
            <AgentPerformanceCard key={item.agentId} item={item} />
          ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <TeamRosterSection
          title="Leadership roster"
          subtitle="Planners, operators, and escalation owners steering routing, staffing, and recovery."
          agents={laneRoster.leadership}
        />
        <TeamRosterSection
          title="Execution roster"
          subtitle="Builders and delivery owners sorted by the freshest heartbeat so active lanes stay on top."
          agents={laneRoster.execution}
        />
        <TeamRosterSection
          title="Verification roster"
          subtitle="Review and QA lanes protecting close quality, release confidence, and regression evidence."
          agents={laneRoster.review}
        />
      </div>

      <section className="rounded-[1.8rem] border border-border bg-card shadow-card">
        <div className="border-b border-border px-6 py-5">
          <h2 className="text-lg font-semibold text-foreground">Project coverage</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Product areas currently attached to this company. Ownership wiring still needs backend support, but coverage density is already visible.
          </p>
        </div>
        <div className="divide-y divide-border">
          {projects.length === 0 ? (
            <div className="px-6 py-10 text-sm text-muted-foreground">No projects yet.</div>
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
    </div>
  );
}
