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
import { BudgetGuardrailPill } from "./BudgetGuardrailPill";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { useTheme } from "../context/ThemeContext";
import { useBudgetGuardrail } from "../hooks/useBudgetGuardrail";
import { heartbeatsApi } from "../api/heartbeats";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { appRoutes } from "../lib/appRoutes";
import { ProductWordmark } from "./ProductWordmark";

export function Sidebar({ width }: { width?: number }) {
  const { openNewIssue } = useDialog();
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { theme, toggleTheme } = useTheme();
  const { status: budgetStatus } = useBudgetGuardrail();
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
      <div className="shrink-0 border-b border-sidebar-border px-3 pb-3 pt-3">
        <ProductWordmark />
        <div className="mt-2.5 rounded-[1rem] border border-border/80 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--card)_88%,var(--background)),color-mix(in_oklab,var(--accent)_16%,var(--card)))] p-2.5 shadow-[0_14px_24px_rgba(15,23,42,0.04)] dark:bg-[linear-gradient(180deg,color-mix(in_oklab,var(--card)_92%,var(--background)),color-mix(in_oklab,var(--card)_89%,var(--accent)))] dark:shadow-[0_12px_22px_rgba(4,8,18,0.2)]">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="truncate text-[0.92rem] font-semibold text-foreground">
                  {selectedCompany?.name ?? "Select company"}
                </div>
                <div className="shrink-0 rounded-full border border-border/80 bg-background/78 px-1.75 py-0.5 font-['IBM_Plex_Mono'] text-[8px] font-semibold uppercase tracking-[0.1em] text-foreground dark:bg-background/88">
                  {selectedCompany?.issuePrefix ?? "----"}
                </div>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>workspace</span>
                <span className="rounded-full border border-border/75 bg-background/80 px-1.75 py-0.5 font-['IBM_Plex_Mono'] text-[8px] font-semibold uppercase tracking-[0.08em]">
                  {liveRunCount > 0 ? `${liveRunCount} live` : "idle"}
                </span>
                {budgetStatus && <BudgetGuardrailPill status={budgetStatus} compact />}
              </div>
            </div>
          </div>
          <div className="mt-2.5 flex items-center gap-1.5">
            <Button
              type="button"
              onClick={() => openNewIssue()}
              className="h-8.5 flex-1 justify-start gap-1.5 rounded-[0.85rem] bg-[linear-gradient(135deg,color-mix(in_oklab,var(--primary)_92%,white),color-mix(in_oklab,var(--primary)_76%,black))] px-2.5 text-primary-foreground shadow-[0_12px_20px_color-mix(in_oklab,var(--primary)_14%,transparent)] hover:brightness-[1.04]"
            >
              <SquarePen className="h-3.5 w-3.5" />
              New Issue
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={openSearch}
              className="h-8.5 w-8.5 shrink-0 rounded-[0.85rem] border-border bg-background/80 text-muted-foreground hover:border-primary/20 hover:bg-accent hover:text-foreground dark:bg-background/88"
              aria-label="Open search"
              title="Open search"
            >
              <Search className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <nav className="flex flex-1 min-h-0 flex-col gap-2.5 overflow-y-auto px-2 py-3 scrollbar-none">
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

      <div className="shrink-0 border-t border-sidebar-border px-2.5 py-2.5">
        <div className="rounded-[0.95rem] border border-border/80 bg-card/84 p-2 shadow-[0_12px_20px_rgba(15,23,42,0.04)] dark:bg-card/92 dark:shadow-[0_14px_20px_rgba(4,8,18,0.2)]">
          <div className="grid grid-cols-[1fr_auto] gap-1.5">
            <Button
              asChild
              variant="outline"
              className="h-8 justify-start rounded-[0.8rem] border-border bg-background/84 px-2.5 text-muted-foreground hover:border-primary/18 hover:bg-accent hover:text-foreground dark:bg-background/92"
            >
              <Link to={appRoutes.settings}>
                <Settings className="h-3.5 w-3.5" />
                Settings
              </Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="h-8 w-8 shrink-0 rounded-[0.8rem] border-border bg-background/84 text-muted-foreground hover:border-primary/18 hover:bg-accent hover:text-foreground dark:bg-background/92"
              onClick={toggleTheme}
              aria-label={`Switch to ${nextTheme} mode`}
              title={`Switch to ${nextTheme} mode`}
            >
              {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <Button
              asChild
              variant="ghost"
              className="h-8 justify-start rounded-[0.8rem] px-2.5 text-muted-foreground hover:bg-background hover:text-foreground"
            >
              <Link to={appRoutes.docs}>
                <BookOpen className="h-3.5 w-3.5" />
                Docs
              </Link>
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-8 justify-start rounded-[0.8rem] px-2.5 text-muted-foreground hover:bg-background hover:text-foreground"
              onClick={openSearch}
            >
              <Search className="h-3.5 w-3.5" />
              Search
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
