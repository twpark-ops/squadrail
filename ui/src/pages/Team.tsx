import { useEffect, useMemo } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { Bot, Building2, Cpu, Network, ShieldCheck, Users } from "lucide-react";
import { agentsApi } from "../api/agents";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";

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

  const roleSummary = useMemo(() => {
    const agents = agentsQuery.data ?? [];
    const leadershipTitlePattern = /(lead|head|chief|director|manager|cto|ceo|owner)/i;
    const qaTitlePattern = /(qa|quality|review)/i;

    return {
      leaders: agents.filter(
        (agent) =>
          ["ceo", "cto", "pm"].includes(agent.role) || leadershipTitlePattern.test(agent.title ?? ""),
      ).length,
      engineers: agents.filter((agent) => agent.role === "engineer").length,
      qa: agents.filter(
        (agent) => agent.role === "qa" || qaTitlePattern.test(agent.title ?? ""),
      ).length,
      active: agents.filter((agent) => agent.status === "active").length,
      codex: agents.filter((agent) => agent.adapterType === "codex_local").length,
      claude: agents.filter((agent) => agent.adapterType === "claude_local").length,
    };
  }, [agentsQuery.data]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Users} message="Select a company to inspect the squad." />;
  }

  if (agentsQuery.isLoading || projectsQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-8">
      <section className="rounded-[2rem] border border-border bg-card px-6 py-6 shadow-card">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          Command structure
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Team</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Leadership lanes, execution engines, and project coverage for the current squad. This view
          should answer who owns work, who executes it, and how review capacity is distributed.
        </p>
      </section>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[1.6rem] border border-border bg-card px-5 py-5 shadow-card">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Leadership lanes
          </div>
          <div className="mt-3 text-3xl font-semibold">{roleSummary.leaders}</div>
          <p className="mt-2 text-sm text-muted-foreground">CTO, PM, tech leads, and operators steering delivery.</p>
        </div>
        <div className="rounded-[1.6rem] border border-border bg-card px-5 py-5 shadow-card">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <Bot className="h-3.5 w-3.5" />
            Engineers
          </div>
          <div className="mt-3 text-3xl font-semibold">{roleSummary.engineers}</div>
          <p className="mt-2 text-sm text-muted-foreground">Execution lanes currently available for implementation work.</p>
        </div>
        <div className="rounded-[1.6rem] border border-border bg-card px-5 py-5 shadow-card">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            QA / reviewers
          </div>
          <div className="mt-3 text-3xl font-semibold">{roleSummary.qa}</div>
          <p className="mt-2 text-sm text-muted-foreground">Independent review capacity for approval and regression checks.</p>
        </div>
        <div className="rounded-[1.6rem] border border-border bg-card px-5 py-5 shadow-card">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" />
            Projects
          </div>
          <div className="mt-3 text-3xl font-semibold">{projectsQuery.data?.length ?? 0}</div>
          <p className="mt-2 text-sm text-muted-foreground">Product areas currently bound to the selected company.</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <section className="rounded-[1.8rem] border border-border bg-card shadow-card">
          <div className="border-b border-border px-6 py-5">
            <h2 className="text-lg font-semibold">Operating Lanes</h2>
            <p className="mt-1 text-sm text-muted-foreground">Jump into the role-specific surfaces without losing the delivery context.</p>
          </div>
          <div className="grid gap-4 px-6 py-6 md:grid-cols-3">
            <Link to="/agents/all" className="rounded-[1.5rem] border border-border bg-background px-4 py-5 no-underline transition-colors hover:bg-accent">
              <Bot className="h-5 w-5 text-primary" />
              <div className="mt-3 font-medium text-foreground">Agents</div>
              <div className="mt-1 text-sm text-muted-foreground">Inspect execution lanes, engines, live runs, and assignment ownership.</div>
            </Link>
            <Link to="/projects" className="rounded-[1.5rem] border border-border bg-background px-4 py-5 no-underline transition-colors hover:bg-accent">
              <Building2 className="h-5 w-5 text-primary" />
              <div className="mt-3 font-medium text-foreground">Projects</div>
              <div className="mt-1 text-sm text-muted-foreground">Check workspace binding, delivery scope, and project-level routing surfaces.</div>
            </Link>
            <Link to="/org" className="rounded-[1.5rem] border border-border bg-background px-4 py-5 no-underline transition-colors hover:bg-accent">
              <Network className="h-5 w-5 text-primary" />
              <div className="mt-3 font-medium text-foreground">Org Chart</div>
              <div className="mt-1 text-sm text-muted-foreground">Read reporting lines, escalation boundaries, and command structure.</div>
            </Link>
          </div>
        </section>

        <section className="rounded-[1.8rem] border border-border bg-card shadow-card">
          <div className="border-b border-border px-6 py-5">
            <h2 className="text-lg font-semibold">Execution Mix</h2>
            <p className="mt-1 text-sm text-muted-foreground">Adapter distribution and project coverage inside the current squad.</p>
          </div>
          <div className="grid gap-4 px-6 py-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-[1.35rem] border border-border bg-background px-4 py-4">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  <Cpu className="h-3.5 w-3.5" />
                  Engine coverage
                </div>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <div>
                    <div className="text-2xl font-semibold">{roleSummary.codex}</div>
                    <div className="text-sm text-muted-foreground">Codex lanes</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-semibold">{roleSummary.claude}</div>
                    <div className="text-sm text-muted-foreground">Claude lanes</div>
                  </div>
                </div>
              </div>
              <div className="rounded-[1.35rem] border border-border bg-background px-4 py-4">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  Availability
                </div>
                <div className="mt-3 text-2xl font-semibold">{roleSummary.active}</div>
                <div className="mt-1 text-sm text-muted-foreground">Agents currently marked active.</div>
              </div>
            </div>
            <div className="rounded-[1.35rem] border border-border bg-background">
              <div className="border-b border-border px-4 py-3 text-sm font-medium">Project coverage</div>
              <div className="divide-y divide-border">
            {(projectsQuery.data ?? []).length === 0 ? (
                  <div className="px-4 py-8 text-sm text-muted-foreground">No projects yet.</div>
            ) : (
              projectsQuery.data!.map((project) => (
                <Link
                  key={project.id}
                  to={`/projects/${project.urlKey ?? project.id}`}
                  className="flex items-start justify-between gap-4 px-4 py-4 no-underline transition-colors hover:bg-accent/40"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">{project.name}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {project.workspaces.length} workspace{project.workspaces.length === 1 ? "" : "s"} · {project.status}
                    </div>
                  </div>
                  <div className="rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    {project.urlKey ?? project.id.slice(0, 6)}
                  </div>
                </Link>
              ))
            )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
