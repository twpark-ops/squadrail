import {
  BookOpen,
  LayoutDashboard,
  GitBranch,
  Bot,
  Search,
  SquarePen,
  Users,
  Settings,
  Database,
  Workflow,
  Moon,
  Sun,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { SidebarSection } from "./SidebarSection";
import { SidebarNavItem } from "./SidebarNavItem";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { useTheme } from "../context/ThemeContext";
import { heartbeatsApi } from "../api/heartbeats";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { appRoutes } from "../lib/appRoutes";
import { ProductWordmark } from "./ProductWordmark";

export function Sidebar({ width }: { width?: number }) {
  const { openNewIssue } = useDialog();
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { theme, toggleTheme } = useTheme();
  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
  });
  const liveRunCount = liveRuns?.length ?? 0;
  const nextTheme = theme === "dark" ? "light" : "dark";

  function openSearch() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  }

  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col border-r border-sidebar-border bg-sidebar/95 backdrop-blur-xl dark:bg-[linear-gradient(180deg,#111722,#171d29)]"
      style={width ? { width } : undefined}
    >
      <div className="shrink-0 border-b border-sidebar-border px-5 py-5">
        <ProductWordmark />
        <div className="mt-5 flex items-start justify-between gap-3 rounded-[1.25rem] border border-border bg-card px-3.5 py-3.5 shadow-[0_16px_34px_rgba(15,23,42,0.06)]">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Current Company
              </div>
              <div className="mt-1 truncate text-sm font-semibold text-foreground">
                {selectedCompany?.name ?? "Select company"}
              </div>
            </div>
            <div className="shrink-0 rounded-full border border-border bg-accent px-2.5 py-1 font-['IBM_Plex_Mono'] text-[10px] font-semibold uppercase tracking-[0.22em] text-foreground">
              {selectedCompany?.issuePrefix ?? "----"}
            </div>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <Button
            type="button"
            onClick={() => openNewIssue()}
            className="w-full justify-start gap-2 rounded-[1.05rem] bg-[linear-gradient(135deg,color-mix(in_oklab,var(--primary)_94%,white),color-mix(in_oklab,var(--primary)_74%,black))] text-primary-foreground shadow-[0_18px_30px_color-mix(in_oklab,var(--primary)_22%,transparent)] hover:brightness-[1.04]"
          >
            <SquarePen className="h-4 w-4" />
            New Issue
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={openSearch}
            className="flex w-full items-center justify-between gap-3 overflow-hidden rounded-[1.05rem] border-border bg-card px-3 text-muted-foreground hover:border-primary/25 hover:bg-accent hover:text-foreground"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Search className="h-4 w-4 shrink-0" />
              <span className="truncate">Search</span>
            </span>
            <span className="shrink-0 rounded-md border border-border bg-background px-1.5 py-0.5 font-['IBM_Plex_Mono'] text-[10px] text-muted-foreground">
              ⌘K
            </span>
          </Button>
        </div>
      </div>

      <nav className="flex flex-1 min-h-0 flex-col gap-6 overflow-y-auto px-4 py-5 scrollbar-none">
        <SidebarSection label="Primary Workspace">
          <SidebarNavItem to={appRoutes.overview} label="Overview" icon={LayoutDashboard} />
          <SidebarNavItem to={appRoutes.work} label="Work" icon={Workflow} />
          <SidebarNavItem to={appRoutes.changes} label="Changes" icon={GitBranch} />
          <SidebarNavItem to={appRoutes.runs} label="Runs" icon={Bot} liveCount={liveRunCount} />
          <SidebarNavItem to={appRoutes.knowledge} label="Knowledge" icon={Database} />
          <SidebarNavItem to={appRoutes.team} label="Team" icon={Users} />
        </SidebarSection>

        <SidebarSection label="Operations">
          <SidebarNavItem to="/projects" label="Projects" icon={Users} />
          <SidebarNavItem to="/agents/all" label="Agents" icon={Bot} />
          <SidebarNavItem to="/goals" label="Goals" icon={Workflow} />
        </SidebarSection>
      </nav>

      <div className="shrink-0 border-t border-sidebar-border px-4 py-4">
        <div className="rounded-[1.25rem] border border-border bg-card p-3 shadow-[0_14px_26px_rgba(15,23,42,0.05)]">
          <div className="flex items-center gap-2">
            <SidebarNavItem to={appRoutes.docs} label="Documentation" icon={BookOpen} className="min-w-0 flex-1" />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="shrink-0 rounded-[0.95rem] border-border bg-background text-muted-foreground hover:border-primary/25 hover:bg-accent hover:text-foreground"
              onClick={toggleTheme}
              aria-label={`Switch to ${nextTheme} mode`}
              title={`Switch to ${nextTheme} mode`}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-[0.95rem] border border-border bg-background/78 px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Live runs
            </div>
            <div className="font-['IBM_Plex_Mono'] text-sm font-semibold text-foreground">
              {liveRunCount}
            </div>
          </div>
          <SidebarNavItem to={appRoutes.settings} label="Settings" icon={Settings} className="mt-2" />
        </div>
      </div>
    </aside>
  );
}
