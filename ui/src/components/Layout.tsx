import { Suspense, lazy, useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type UIEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Outlet, useLocation, useNavigate, useParams } from "@/lib/router";
import { CompanyRail } from "./CompanyRail";
import { Sidebar } from "./Sidebar";
import { BreadcrumbBar } from "./BreadcrumbBar";
import { PropertiesPanel } from "./PropertiesPanel";
import { CommandPalette } from "./CommandPalette";
import { ToastViewport } from "./ToastViewport";
import { MobileBottomNav } from "./MobileBottomNav";
import { useDialog } from "../context/DialogContext";
import { usePanel } from "../context/PanelContext";
import { useCompany } from "../context/CompanyContext";
import { useSidebar } from "../context/SidebarContext";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useCompanyPageMemory } from "../hooks/useCompanyPageMemory";
import { healthApi } from "../api/health";
import { companiesApi } from "../api/companies";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { appRoutes } from "../lib/appRoutes";

const NewIssueDialog = lazy(async () => import("./NewIssueDialog").then((module) => ({ default: module.NewIssueDialog })));
const NewProjectDialog = lazy(async () => import("./NewProjectDialog").then((module) => ({ default: module.NewProjectDialog })));
const NewGoalDialog = lazy(async () => import("./NewGoalDialog").then((module) => ({ default: module.NewGoalDialog })));
const NewAgentDialog = lazy(async () => import("./NewAgentDialog").then((module) => ({ default: module.NewAgentDialog })));

export function Layout() {
  const {
    sidebarOpen,
    setSidebarOpen,
    toggleSidebar,
    isMobile,
    sidebarWidth,
    setSidebarWidth,
    minSidebarWidth,
    maxSidebarWidth,
  } = useSidebar();
  const {
    openNewIssue,
    openOnboarding,
    newIssueOpen,
    newProjectOpen,
    newGoalOpen,
    newAgentOpen,
  } = useDialog();
  const { togglePanelVisible } = usePanel();
  const { companies, loading: companiesLoading, selectedCompanyId, setSelectedCompanyId } = useCompany();
  const { companyPrefix } = useParams<{ companyPrefix: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const onboardingTriggered = useRef(false);
  const lastMainScrollTop = useRef(0);
  const desktopSidebarShellRef = useRef<HTMLDivElement | null>(null);
  const companyRailRef = useRef<HTMLDivElement | null>(null);
  const isResizingSidebarRef = useRef(false);
  const [mobileNavVisible, setMobileNavVisible] = useState(true);
  const { data: health } = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
  });
  const { data: setupProgress } = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.companies.setupProgress(selectedCompanyId)
      : ["companies", "__none__", "setup-progress"],
    queryFn: () => companiesApi.getSetupProgress(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  useEffect(() => {
    if (companiesLoading || onboardingTriggered.current) return;
    if (health?.deploymentMode === "authenticated") return;
    if (companies.length === 0) {
      onboardingTriggered.current = true;
      openOnboarding();
    }
  }, [companies, companiesLoading, openOnboarding, health?.deploymentMode]);

  useEffect(() => {
    if (!companyPrefix || companiesLoading || companies.length === 0) return;

    const requestedPrefix = companyPrefix.toUpperCase();
    const matched = companies.find((company) => company.issuePrefix.toUpperCase() === requestedPrefix);

    if (!matched) {
      const fallback =
        (selectedCompanyId ? companies.find((company) => company.id === selectedCompanyId) : null)
        ?? companies[0]!;
      navigate(`/${fallback.issuePrefix}${appRoutes.overview}`, { replace: true });
      return;
    }

    if (companyPrefix !== matched.issuePrefix) {
      const suffix = location.pathname.replace(/^\/[^/]+/, "");
      navigate(`/${matched.issuePrefix}${suffix}${location.search}`, { replace: true });
      return;
    }

    if (selectedCompanyId !== matched.id) {
      setSelectedCompanyId(matched.id, { source: "route_sync" });
    }
  }, [
    companyPrefix,
    companies,
    companiesLoading,
    location.pathname,
    location.search,
    navigate,
    selectedCompanyId,
    setSelectedCompanyId,
  ]);

  const togglePanel = togglePanelVisible;

  // Cmd+1..9 to switch companies
  const switchCompany = useCallback(
    (index: number) => {
      if (index < companies.length) {
        setSelectedCompanyId(companies[index]!.id);
      }
    },
    [companies, setSelectedCompanyId],
  );

  useCompanyPageMemory();

  useKeyboardShortcuts({
    onNewIssue: () => openNewIssue(),
    onToggleSidebar: toggleSidebar,
    onTogglePanel: togglePanel,
    onSwitchCompany: switchCompany,
  });

  useEffect(() => {
    if (!isMobile) {
      setMobileNavVisible(true);
      return;
    }
    lastMainScrollTop.current = 0;
    setMobileNavVisible(true);
  }, [isMobile]);

  useEffect(() => {
    if (isMobile) return;

    const handleMouseMove = (event: MouseEvent) => {
      if (!isResizingSidebarRef.current) return;
      const shellRect = desktopSidebarShellRef.current?.getBoundingClientRect();
      const railRect = companyRailRef.current?.getBoundingClientRect();
      if (!shellRect) return;
      const railWidth = railRect?.width ?? 64;
      const nextWidth = event.clientX - shellRect.left - railWidth;
      setSidebarWidth(nextWidth);
    };

    const stopResize = () => {
      if (!isResizingSidebarRef.current) return;
      isResizingSidebarRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopResize);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResize);
      stopResize();
    };
  }, [isMobile, setSidebarWidth]);

  // Swipe gesture to open/close sidebar on mobile
  useEffect(() => {
    if (!isMobile) return;

    const EDGE_ZONE = 30; // px from left edge to start open-swipe
    const MIN_DISTANCE = 50; // minimum horizontal swipe distance
    const MAX_VERTICAL = 75; // max vertical drift before we ignore

    let startX = 0;
    let startY = 0;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0]!;
      startX = t.clientX;
      startY = t.clientY;
    };

    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0]!;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);

      if (dy > MAX_VERTICAL) return; // vertical scroll, ignore

      // Swipe right from left edge → open
      if (!sidebarOpen && startX < EDGE_ZONE && dx > MIN_DISTANCE) {
        setSidebarOpen(true);
        return;
      }

      // Swipe left when open → close
      if (sidebarOpen && dx < -MIN_DISTANCE) {
        setSidebarOpen(false);
      }
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [isMobile, sidebarOpen, setSidebarOpen]);

  const handleMainScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      if (!isMobile) return;

      const currentTop = event.currentTarget.scrollTop;
      const delta = currentTop - lastMainScrollTop.current;

      if (currentTop <= 24) {
        setMobileNavVisible(true);
      } else if (delta > 8) {
        setMobileNavVisible(false);
      } else if (delta < -8) {
        setMobileNavVisible(true);
      }

      lastMainScrollTop.current = currentTop;
    },
    [isMobile],
  );

  const startSidebarResize = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    if (isMobile || !sidebarOpen) return;
    event.preventDefault();
    isResizingSidebarRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [isMobile, sidebarOpen]);

  const selectedCompany =
    selectedCompanyId
      ? companies.find((company) => company.id === selectedCompanyId) ?? null
      : null;
  const showSetupGate =
    Boolean(selectedCompany) &&
    Boolean(setupProgress) &&
    setupProgress?.status !== "first_issue_ready" &&
    !(location.pathname.endsWith("/company/settings") || location.pathname.endsWith("/settings"));

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground pt-[env(safe-area-inset-top)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Skip to Main Content
      </a>
      {/* Mobile backdrop */}
      {isMobile && sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-slate-950/18 backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      )}

      {/* Combined sidebar area: company rail + inner sidebar + docs bar */}
      {isMobile ? (
        <div
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex overflow-hidden pt-[env(safe-area-inset-top)] shadow-[0_30px_70px_rgba(15,23,42,0.16)] transition-transform duration-100 ease-out",
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <CompanyRail />
          <Sidebar width={sidebarWidth} />
        </div>
      ) : (
        <div ref={desktopSidebarShellRef} className="relative flex h-full shrink-0">
          <div ref={companyRailRef}>
            <CompanyRail />
          </div>
          <div
            className={cn(
              "overflow-hidden border-r border-sidebar-border/0 transition-[width] duration-150 ease-out",
              sidebarOpen ? "opacity-100" : "w-0 opacity-0"
            )}
            style={{ width: sidebarOpen ? sidebarWidth : 0 }}
          >
            <Sidebar width={sidebarWidth} />
          </div>
          {sidebarOpen && (
            <button
              type="button"
              className="absolute right-0 top-0 z-20 hidden h-full w-3 -translate-x-1/2 cursor-col-resize bg-transparent md:block"
              onMouseDown={startSidebarResize}
              aria-label="Resize sidebar"
              title={`Resize sidebar (${minSidebarWidth}-${maxSidebarWidth}px)`}
            >
              <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors hover:bg-primary" />
            </button>
          )}
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <BreadcrumbBar />
        <div className="flex min-h-0 flex-1">
          <main
            id="main-content"
            tabIndex={-1}
            className={cn(
              "relative flex-1 overflow-auto px-3 pb-7 pt-4 md:px-5 md:pb-8 md:pt-5 lg:px-6",
              isMobile && "pb-[calc(5.75rem+env(safe-area-inset-bottom))]",
            )}
            onScroll={handleMainScroll}
          >
            <div className="mx-auto w-full max-w-[1500px]">
              {showSetupGate && selectedCompany && setupProgress && (
                <div className="mb-6 rounded-[1.6rem] border border-amber-300/32 bg-[color-mix(in_oklab,var(--card)_95%,#f5e7c6)] px-5 py-4 shadow-[0_14px_30px_rgba(180,129,18,0.06)]">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-amber-950">
                        Setup is still in progress for {selectedCompany.name}
                      </div>
                      <ul className="mt-2 space-y-1 text-xs text-amber-900/80">
                        {[
                          { done: setupProgress.steps.companyReady, label: "Company created" },
                          { done: setupProgress.steps.squadReady, label: "Team blueprint applied" },
                          { done: setupProgress.steps.engineReady, label: "Execution engine configured" },
                          { done: setupProgress.steps.workspaceConnected, label: "Primary workspace connected" },
                          { done: setupProgress.steps.knowledgeSeeded, label: "Knowledge base seeded" },
                          { done: setupProgress.steps.firstIssueReady, label: "First quick request submitted" },
                        ].map((item) => (
                          <li key={item.label} className="flex items-center gap-1.5">
                            <span className={item.done ? "text-emerald-600" : "text-amber-400"}>{item.done ? "✓" : "○"}</span>
                            <span className={item.done ? "line-through opacity-60" : ""}>{item.label}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => navigate(`/${selectedCompany.issuePrefix}${appRoutes.settings}`)}
                      >
                        Resume Setup
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              <Outlet />
            </div>
          </main>
          <PropertiesPanel />
        </div>
      </div>
      {isMobile && <MobileBottomNav visible={mobileNavVisible} />}
      <CommandPalette />
      <Suspense fallback={null}>
        {newIssueOpen ? <NewIssueDialog /> : null}
        {newProjectOpen ? <NewProjectDialog /> : null}
        {newGoalOpen ? <NewGoalDialog /> : null}
        {newAgentOpen ? <NewAgentDialog /> : null}
      </Suspense>
      <ToastViewport />
    </div>
  );
}
