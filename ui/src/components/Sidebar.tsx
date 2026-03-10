import {
  Link,
} from "@/lib/router";
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
      className="flex h-full min-h-0 w-full flex-col border-r border-sidebar-border bg-[linear-gradient(180deg,color-mix(in_oklab,var(--sidebar)_92%,var(--background)),color-mix(in_oklab,var(--sidebar)_98%,var(--accent))_54%,color-mix(in_oklab,var(--background)_98%,var(--sidebar)))] backdrop-blur-xl dark:bg-[linear-gradient(180deg,color-mix(in_oklab,var(--sidebar)_94%,var(--background)),color-mix(in_oklab,var(--sidebar)_90%,var(--accent))_54%,color-mix(in_oklab,var(--background)_96%,black))]"
      style={width ? { width } : undefined}
    >
      <div className="shrink-0 border-b border-sidebar-border px-4 pb-4 pt-4">
        <ProductWordmark />
        <div className="mt-4 rounded-[1.45rem] border border-border/80 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--card)_86%,var(--background)),color-mix(in_oklab,var(--accent)_18%,var(--card)))] p-3.5 shadow-[0_20px_38px_rgba(15,23,42,0.06)] dark:bg-[linear-gradient(180deg,color-mix(in_oklab,var(--card)_92%,var(--background)),color-mix(in_oklab,var(--card)_88%,var(--accent)))] dark:shadow-[0_18px_32px_rgba(4,8,18,0.26)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                Current workspace
              </div>
              <div className="mt-1 truncate text-base font-semibold text-foreground">
                {selectedCompany?.name ?? "Select company"}
              </div>
            </div>
            <div className="shrink-0 rounded-full border border-border/80 bg-background/78 px-2.5 py-1 font-['IBM_Plex_Mono'] text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground dark:bg-background/88">
              {selectedCompany?.issuePrefix ?? "----"}
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button
              type="button"
              onClick={() => openNewIssue()}
              className="flex-1 justify-start gap-2 rounded-[1.05rem] bg-[linear-gradient(135deg,color-mix(in_oklab,var(--primary)_92%,white),color-mix(in_oklab,var(--primary)_76%,black))] text-primary-foreground shadow-[0_18px_30px_color-mix(in_oklab,var(--primary)_18%,transparent)] hover:brightness-[1.04]"
            >
              <SquarePen className="h-4 w-4" />
              New Issue
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={openSearch}
              className="shrink-0 rounded-[1.05rem] border-border bg-background/80 text-muted-foreground hover:border-primary/20 hover:bg-accent hover:text-foreground dark:bg-background/88"
              aria-label="Open search"
              title="Open search"
            >
              <Search className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-[1rem] border border-border/70 bg-background/72 px-3 py-2.5 dark:bg-background/84">
            <div>
              <div className="text-[11px] font-medium text-muted-foreground">Live runs</div>
              <div className="mt-0.5 text-sm font-semibold text-foreground">{liveRunCount}</div>
            </div>
            <div className="rounded-full border border-border/80 bg-background/84 px-2.5 py-1 font-['IBM_Plex_Mono'] text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {liveRunCount > 0 ? "active" : "idle"}
            </div>
          </div>
        </div>
      </div>

      <nav className="flex flex-1 min-h-0 flex-col gap-5 overflow-y-auto px-3.5 py-4.5 scrollbar-none">
        <SidebarSection label="Core surfaces">
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

      <div className="shrink-0 border-t border-sidebar-border px-3.5 py-3.5">
        <div className="rounded-[1.2rem] border border-border/80 bg-card/84 p-3 shadow-[0_14px_30px_rgba(15,23,42,0.05)] dark:bg-card/92 dark:shadow-[0_16px_28px_rgba(4,8,18,0.24)]">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Button
              asChild
              variant="outline"
              className="justify-start rounded-[1rem] border-border bg-background/84 text-muted-foreground hover:border-primary/18 hover:bg-accent hover:text-foreground dark:bg-background/92"
            >
              <Link to={appRoutes.settings}>
                <Settings className="h-4 w-4" />
                Settings
              </Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="shrink-0 rounded-[1rem] border-border bg-background/84 text-muted-foreground hover:border-primary/18 hover:bg-accent hover:text-foreground dark:bg-background/92"
              onClick={toggleTheme}
              aria-label={`Switch to ${nextTheme} mode`}
              title={`Switch to ${nextTheme} mode`}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button
              asChild
              variant="ghost"
              className="justify-start rounded-[1rem] text-muted-foreground hover:bg-background hover:text-foreground"
            >
              <Link to={appRoutes.docs}>
                <BookOpen className="h-4 w-4" />
                Docs
              </Link>
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="justify-start rounded-[1rem] text-muted-foreground hover:bg-background hover:text-foreground"
              onClick={openSearch}
            >
              <Search className="h-4 w-4" />
              Search
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
