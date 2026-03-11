import { useEffect, useMemo, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { History, Layers3, Shapes, Sparkles } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { activityApi } from "../api/activity";
import { agentsApi } from "../api/agents";
import { goalsApi } from "../api/goals";
import { issuesApi } from "../api/issues";
import { projectsApi } from "../api/projects";
import { ActivityRow } from "../components/ActivityRow";
import { EmptyState } from "../components/EmptyState";
import { HeroSection } from "../components/HeroSection";
import { PageSkeleton } from "../components/PageSkeleton";
import { SupportMetricCard } from "../components/SupportMetricCard";
import { SupportPanel } from "../components/SupportPanel";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import type { Agent } from "@squadrail/shared";

export function Activity() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    setBreadcrumbs([{ label: "Activity" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.activity(selectedCompanyId!),
    queryFn: () => activityApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: goals } = useQuery({
    queryKey: queryKeys.goals.list(selectedCompanyId!),
    queryFn: () => goalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents ?? []) map.set(agent.id, agent);
    return map;
  }, [agents]);

  const entityNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const issue of issues ?? []) map.set(`issue:${issue.id}`, issue.identifier ?? issue.id.slice(0, 8));
    for (const agent of agents ?? []) map.set(`agent:${agent.id}`, agent.name);
    for (const project of projects ?? []) map.set(`project:${project.id}`, project.name);
    for (const goal of goals ?? []) map.set(`goal:${goal.id}`, goal.title);
    return map;
  }, [issues, agents, projects, goals]);

  const entityTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const issue of issues ?? []) map.set(`issue:${issue.id}`, issue.title);
    return map;
  }, [issues]);

  const entityTypes = useMemo(
    () => (data ? [...new Set(data.map((event) => event.entityType))].sort() : []),
    [data],
  );

  const filtered = useMemo(
    () => (data && filter !== "all" ? data.filter((event) => event.entityType === filter) : data ?? []),
    [data, filter],
  );

  const issueEvents = useMemo(() => (data ?? []).filter((event) => event.entityType === "issue").length, [data]);
  const projectEvents = useMemo(() => (data ?? []).filter((event) => event.entityType === "project").length, [data]);
  const actorCount = useMemo(
    () =>
      new Set(
        (data ?? [])
          .map((event) => event.actorId)
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      ).size,
    [data],
  );

  if (!selectedCompanyId) {
    return <EmptyState icon={History} message="Select a company to view activity." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-8">
      <HeroSection
        title="Activity"
        subtitle="Trace recent changes across issues, projects, goals, and agents without dropping into raw event logs."
        eyebrow="Recent Movement"
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SupportMetricCard
          icon={History}
          label="Visible events"
          value={data?.length ?? 0}
          detail="The recent activity window currently indexed for this company."
          tone="accent"
        />
        <SupportMetricCard
          icon={Sparkles}
          label="Issue activity"
          value={issueEvents}
          detail="Protocol and delivery work attached directly to issues."
        />
        <SupportMetricCard
          icon={Layers3}
          label="Project activity"
          value={projectEvents}
          detail="Changes in project scope, status, and workspace-linked operations."
        />
        <SupportMetricCard
          icon={Shapes}
          label="Active actors"
          value={actorCount}
          detail="Distinct agents or humans represented in the visible event stream."
        />
      </div>

      <SupportPanel
        title="Activity stream"
        description="Filter the event stream by entity type when you need a narrower read. Keep the default view broad to preserve sequencing."
        action={
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-9 w-[170px] rounded-full border-border bg-background/80 text-xs">
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entities</SelectItem>
              {entityTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        contentClassName="space-y-4"
      >
        {error ? <p className="text-sm text-destructive">{error.message}</p> : null}

        {filtered.length === 0 ? (
          <EmptyState
            icon={History}
            message={filter === "all" ? "No recent activity is visible yet." : "No events matched the current entity filter."}
          />
        ) : (
          <div className="overflow-hidden rounded-[1.35rem] border border-border/80">
            {filtered.map((event) => (
              <ActivityRow
                key={event.id}
                event={event}
                agentMap={agentMap}
                entityNameMap={entityNameMap}
                entityTitleMap={entityTitleMap}
              />
            ))}
          </div>
        )}
      </SupportPanel>
    </div>
  );
}
