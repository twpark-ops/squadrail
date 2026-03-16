import { Suspense, lazy, useEffect, useRef, type ComponentType, type ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Layout } from "./components/Layout";
import { authApi } from "./api/auth";
import { healthApi } from "./api/health";
import { companiesApi } from "./api/companies";
import { AuthPage } from "./pages/Auth";
import { BoardClaimPage } from "./pages/BoardClaim";
import { InviteLandingPage } from "./pages/InviteLanding";
import { queryKeys } from "./lib/queryKeys";
import { useCompany } from "./context/CompanyContext";
import { useDialog } from "./context/DialogContext";
import { appRoutes, workIssuePath } from "./lib/appRoutes";

function lazyPage<T extends Record<string, unknown>, K extends keyof T>(
  loader: () => Promise<T>,
  key: K,
) {
  return lazy(async () => {
    const module = await loader();
    return { default: module[key] as ComponentType };
  });
}

const Overview = lazyPage(() => import("./pages/DashboardOptimized"), "DashboardOptimized");
const Companies = lazyPage(() => import("./pages/Companies"), "Companies");
const Agents = lazyPage(() => import("./pages/Agents"), "Agents");
const AgentDetail = lazyPage(() => import("./pages/AgentDetail"), "AgentDetail");
const Projects = lazyPage(() => import("./pages/Projects"), "Projects");
const ProjectDetail = lazyPage(() => import("./pages/ProjectDetail"), "ProjectDetail");
const Issues = lazyPage(() => import("./pages/Issues"), "Issues");
const IssueDetail = lazyPage(() => import("./pages/IssueDetail"), "IssueDetail");
const Changes = lazyPage(() => import("./pages/Changes"), "Changes");
const Runs = lazyPage(() => import("./pages/Runs"), "Runs");
const Team = lazyPage(() => import("./pages/Team"), "Team");
const Goals = lazyPage(() => import("./pages/Goals"), "Goals");
const GoalDetail = lazyPage(() => import("./pages/GoalDetail"), "GoalDetail");
const Approvals = lazyPage(() => import("./pages/Approvals"), "Approvals");
const ApprovalDetail = lazyPage(() => import("./pages/ApprovalDetail"), "ApprovalDetail");
const Costs = lazyPage(() => import("./pages/Costs"), "Costs");
const Activity = lazyPage(() => import("./pages/Activity"), "Activity");
const Inbox = lazyPage(() => import("./pages/Inbox"), "Inbox");
const CompanySettings = lazyPage(() => import("./pages/CompanySettings"), "CompanySettings");
const DesignGuide = lazyPage(() => import("./pages/DesignGuide"), "DesignGuide");
const OrgChart = lazyPage(() => import("./pages/OrgChart"), "OrgChart");
const Knowledge = lazyPage(() => import("./pages/Knowledge"), "Knowledge");
const Analytics = lazyPage(() => import("./pages/Analytics"), "Analytics");
const OnboardingWizard = lazyPage(() => import("./components/OnboardingWizard"), "OnboardingWizard");

function RoutePendingPage() {
  return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
}

function SuspendedRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RoutePendingPage />}>{children}</Suspense>;
}

function routeElement(element: ReactNode) {
  return <SuspendedRoute>{element}</SuspendedRoute>;
}

function BootstrapPendingPage() {
  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">Instance setup required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No instance admin exists yet. Run this command on the machine hosting Squadrail to generate
          the first admin invite URL:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-md border border-border bg-muted/30 p-3 text-xs">
{`pnpm squadrail auth bootstrap-ceo`}
        </pre>
      </div>
    </div>
  );
}

function CloudAccessGate() {
  const location = useLocation();
  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
  });

  const isAuthenticatedMode = healthQuery.data?.deploymentMode === "authenticated";
  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    enabled: isAuthenticatedMode,
    retry: false,
  });

  if (healthQuery.isLoading || (isAuthenticatedMode && sessionQuery.isLoading)) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
  }

  if (healthQuery.error) {
    return (
      <div className="mx-auto max-w-xl py-10 text-sm text-destructive">
        {healthQuery.error instanceof Error ? healthQuery.error.message : "Failed to load app state"}
      </div>
    );
  }

  if (isAuthenticatedMode && healthQuery.data?.bootstrapStatus === "bootstrap_pending") {
    return <BootstrapPendingPage />;
  }

  if (isAuthenticatedMode && !sessionQuery.data) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/auth?next=${next}`} replace />;
  }

  return <Outlet />;
}

function LegacyIssueRedirect() {
  const { issueId } = useParams<{ issueId: string }>();
  return <Navigate to={workIssuePath(issueId ?? "")} replace />;
}

function boardRoutes() {
  return (
    <>
      <Route index element={<Navigate to="overview" replace />} />
      <Route path="overview" element={routeElement(<Overview />)} />
      <Route path="dashboard" element={<Navigate to="/overview" replace />} />
      <Route path="companies" element={routeElement(<Companies />)} />
      <Route path="settings" element={routeElement(<CompanySettings />)} />
      <Route path="company/settings" element={<Navigate to="/settings" replace />} />
      <Route path="org" element={routeElement(<OrgChart />)} />
      <Route path="team" element={routeElement(<Team />)} />
      <Route path="agents" element={<Navigate to="all" replace />} />
      <Route path="agents/all" element={routeElement(<Agents />)} />
      <Route path="agents/active" element={routeElement(<Agents />)} />
      <Route path="agents/paused" element={routeElement(<Agents />)} />
      <Route path="agents/error" element={routeElement(<Agents />)} />
      <Route path="agents/:agentId" element={routeElement(<AgentDetail />)} />
      <Route path="agents/:agentId/:tab" element={routeElement(<AgentDetail />)} />
      <Route path="agents/:agentId/runs/:runId" element={routeElement(<AgentDetail />)} />
      <Route path="projects" element={routeElement(<Projects />)} />
      <Route path="projects/:projectId" element={routeElement(<ProjectDetail />)} />
      <Route path="projects/:projectId/overview" element={routeElement(<ProjectDetail />)} />
      <Route path="projects/:projectId/issues" element={routeElement(<ProjectDetail />)} />
      <Route path="projects/:projectId/issues/:filter" element={routeElement(<ProjectDetail />)} />
      <Route path="work" element={routeElement(<Issues />)} />
      <Route path="work/:issueId" element={routeElement(<IssueDetail />)} />
      <Route path="issues" element={<Navigate to="/work" replace />} />
      <Route path="issues/all" element={<Navigate to="/work" replace />} />
      <Route path="issues/active" element={<Navigate to="/work" replace />} />
      <Route path="issues/backlog" element={<Navigate to="/work" replace />} />
      <Route path="issues/done" element={<Navigate to="/work" replace />} />
      <Route path="issues/recent" element={<Navigate to="/work" replace />} />
      <Route path="issues/:issueId" element={<LegacyIssueRedirect />} />
      <Route path="changes" element={routeElement(<Changes />)} />
      <Route path="changes/:issueId" element={routeElement(<IssueDetail />)} />
      <Route path="runs" element={routeElement(<Runs />)} />
      <Route path="goals" element={routeElement(<Goals />)} />
      <Route path="goals/:goalId" element={routeElement(<GoalDetail />)} />
      <Route path="approvals" element={<Navigate to="/approvals/pending" replace />} />
      <Route path="approvals/pending" element={routeElement(<Approvals />)} />
      <Route path="approvals/all" element={routeElement(<Approvals />)} />
      <Route path="approvals/:approvalId" element={routeElement(<ApprovalDetail />)} />
      <Route path="costs" element={routeElement(<Costs />)} />
      <Route path="activity" element={routeElement(<Activity />)} />
      <Route path="inbox" element={<Navigate to="/inbox/new" replace />} />
      <Route path="inbox/new" element={routeElement(<Inbox />)} />
      <Route path="inbox/all" element={routeElement(<Inbox />)} />
      <Route path="knowledge" element={routeElement(<Knowledge />)} />
      <Route path="analytics" element={routeElement(<Analytics />)} />
      <Route path="design-guide" element={routeElement(<DesignGuide />)} />
    </>
  );
}

function CompanyRootRedirect() {
  const { companies, selectedCompany, loading } = useCompany();
  const { onboardingOpen } = useDialog();
  const targetCompany = selectedCompany ?? companies[0] ?? null;
  const setupProgressQuery = useQuery({
    queryKey: targetCompany
      ? queryKeys.companies.setupProgress(targetCompany.id)
      : ["companies", "__none__", "setup-progress"],
    queryFn: () => companiesApi.getSetupProgress(targetCompany!.id),
    enabled: Boolean(targetCompany?.id),
  });

  if (loading) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
  }

  // Keep the first-run onboarding mounted until it completes.
  if (onboardingOpen) {
    return <NoCompaniesStartPage autoOpen={false} />;
  }

  if (!targetCompany) {
    return <NoCompaniesStartPage />;
  }
  if (setupProgressQuery.isLoading) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
  }
  if (setupProgressQuery.data && setupProgressQuery.data.status !== "first_issue_ready") {
    return <Navigate to={`/${targetCompany.issuePrefix}${appRoutes.settings}`} replace />;
  }

  return <Navigate to={`/${targetCompany.issuePrefix}${appRoutes.overview}`} replace />;
}

function UnprefixedBoardRedirect() {
  const location = useLocation();
  const { companies, selectedCompany, loading } = useCompany();
  const targetCompany = selectedCompany ?? companies[0] ?? null;
  const setupProgressQuery = useQuery({
    queryKey: targetCompany
      ? queryKeys.companies.setupProgress(targetCompany.id)
      : ["companies", "__none__", "setup-progress"],
    queryFn: () => companiesApi.getSetupProgress(targetCompany!.id),
    enabled: Boolean(targetCompany?.id),
  });

  if (loading) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
  }

  if (!targetCompany) {
    return <NoCompaniesStartPage />;
  }
  if (setupProgressQuery.isLoading) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
  }
  if (setupProgressQuery.data && setupProgressQuery.data.status !== "first_issue_ready") {
    return <Navigate to={`/${targetCompany.issuePrefix}${appRoutes.settings}`} replace />;
  }

  return (
    <Navigate
      to={`/${targetCompany.issuePrefix}${location.pathname}${location.search}${location.hash}`}
      replace
    />
  );
}

function NoCompaniesStartPage({ autoOpen = true }: { autoOpen?: boolean }) {
  const { openOnboarding } = useDialog();
  const opened = useRef(false);

  useEffect(() => {
    if (!autoOpen) return;
    if (opened.current) return;
    opened.current = true;
    openOnboarding();
  }, [autoOpen, openOnboarding]);

  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">Create your first company</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Get started by creating a company.
        </p>
        <div className="mt-4">
          <Button onClick={() => openOnboarding()}>New Company</Button>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const { onboardingOpen } = useDialog();

  return (
    <>
      <Routes>
        <Route path="auth" element={<AuthPage />} />
        <Route path="board-claim/:token" element={<BoardClaimPage />} />
        <Route path="invite/:token" element={<InviteLandingPage />} />

        <Route element={<CloudAccessGate />}>
          <Route index element={<CompanyRootRedirect />} />
          <Route path="overview" element={<UnprefixedBoardRedirect />} />
          <Route path="work" element={<UnprefixedBoardRedirect />} />
          <Route path="work/:issueId" element={<UnprefixedBoardRedirect />} />
          <Route path="changes" element={<UnprefixedBoardRedirect />} />
          <Route path="changes/:issueId" element={<UnprefixedBoardRedirect />} />
          <Route path="runs" element={<UnprefixedBoardRedirect />} />
          <Route path="team" element={<UnprefixedBoardRedirect />} />
          <Route path="settings" element={<UnprefixedBoardRedirect />} />
          <Route path="companies" element={<UnprefixedBoardRedirect />} />
          <Route path="issues" element={<UnprefixedBoardRedirect />} />
          <Route path="issues/:issueId" element={<UnprefixedBoardRedirect />} />
          <Route path="agents" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId/:tab" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId/runs/:runId" element={<UnprefixedBoardRedirect />} />
          <Route path="projects" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/overview" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/issues" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/issues/:filter" element={<UnprefixedBoardRedirect />} />
          <Route path="goals" element={<UnprefixedBoardRedirect />} />
          <Route path="goals/:goalId" element={<UnprefixedBoardRedirect />} />
          <Route path="knowledge" element={<UnprefixedBoardRedirect />} />
          <Route path="activity" element={<UnprefixedBoardRedirect />} />
          <Route path="costs" element={<UnprefixedBoardRedirect />} />
          <Route path="approvals" element={<UnprefixedBoardRedirect />} />
          <Route path="approvals/:approvalId" element={<UnprefixedBoardRedirect />} />
          <Route path="inbox" element={<UnprefixedBoardRedirect />} />
          <Route path=":companyPrefix" element={<Layout />}>
            {boardRoutes()}
          </Route>
        </Route>
      </Routes>
      <Suspense fallback={null}>
        {onboardingOpen ? <OnboardingWizard /> : null}
      </Suspense>
    </>
  );
}
