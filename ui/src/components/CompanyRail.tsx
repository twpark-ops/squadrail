import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ArrowUpDown, Check, Plus } from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { queryKeys } from "../lib/queryKeys";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { heartbeatsApi } from "../api/heartbeats";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Company } from "@squadrail/shared";
import { ProductWordmark } from "./ProductWordmark";
import {
  readJsonStorageAlias,
  writeJsonStorageAlias,
} from "../lib/storage-aliases";
import { CompanyRailItem } from "./CompanyRailItem";

const CompanyRailSortableList = lazy(async () =>
  import("./CompanyRailSortableList").then((module) => ({
    default: module.CompanyRailSortableList,
  }))
);

const ORDER_STORAGE_KEY = "squadrail.companyOrder";
const LEGACY_ORDER_STORAGE_KEY = "squadrail.companyOrder";

function getStoredOrder(): string[] {
  return readJsonStorageAlias<string[]>(
    ORDER_STORAGE_KEY,
    LEGACY_ORDER_STORAGE_KEY,
    []
  );
}

function saveOrder(ids: string[]) {
  writeJsonStorageAlias(ORDER_STORAGE_KEY, LEGACY_ORDER_STORAGE_KEY, ids);
}

/** Sort companies by stored order, appending any new ones at the end. */
function sortByStoredOrder(companies: Company[]): Company[] {
  const order = getStoredOrder();
  if (order.length === 0) return companies;

  const byId = new Map(companies.map((c) => [c.id, c]));
  const sorted: Company[] = [];

  for (const id of order) {
    const c = byId.get(id);
    if (c) {
      sorted.push(c);
      byId.delete(id);
    }
  }
  // Append any companies not in stored order
  for (const c of byId.values()) {
    sorted.push(c);
  }
  return sorted;
}

export function CompanyRail() {
  const { companies, selectedCompanyId, setSelectedCompanyId } = useCompany();
  const { openOnboarding } = useDialog();
  const sidebarCompanies = useMemo(
    () => companies.filter((company) => company.status !== "archived"),
    [companies]
  );
  const companyIds = useMemo(
    () => sidebarCompanies.map((company) => company.id),
    [sidebarCompanies]
  );

  const liveRunsQueries = useQueries({
    queries: companyIds.map((companyId) => ({
      queryKey: queryKeys.liveRuns(companyId),
      queryFn: () => heartbeatsApi.liveRunsForCompany(companyId),
      refetchInterval: 10_000,
    })),
  });
  const sidebarBadgeQueries = useQueries({
    queries: companyIds.map((companyId) => ({
      queryKey: queryKeys.sidebarBadges(companyId),
      queryFn: () => sidebarBadgesApi.get(companyId),
      refetchInterval: 15_000,
    })),
  });
  const hasLiveAgentsByCompanyId = useMemo(() => {
    const result = new Map<string, boolean>();
    companyIds.forEach((companyId, index) => {
      result.set(companyId, (liveRunsQueries[index]?.data?.length ?? 0) > 0);
    });
    return result;
  }, [companyIds, liveRunsQueries]);
  const hasUnreadInboxByCompanyId = useMemo(() => {
    const result = new Map<string, boolean>();
    companyIds.forEach((companyId, index) => {
      result.set(companyId, (sidebarBadgeQueries[index]?.data?.inbox ?? 0) > 0);
    });
    return result;
  }, [companyIds, sidebarBadgeQueries]);

  // Maintain sorted order in local state, synced from companies + localStorage
  const [orderedIds, setOrderedIds] = useState<string[]>(() =>
    sortByStoredOrder(sidebarCompanies).map((c) => c.id)
  );
  const [reorderMode, setReorderMode] = useState(false);

  // Re-sync orderedIds from localStorage whenever companies changes.
  // Handles initial data load (companies starts as [] before query resolves)
  // and subsequent refetches triggered by live updates.
  useEffect(() => {
    if (sidebarCompanies.length === 0) {
      setOrderedIds([]);
      return;
    }
    setOrderedIds(sortByStoredOrder(sidebarCompanies).map((c) => c.id));
  }, [sidebarCompanies]);

  // Sync order across tabs via the native storage event
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== ORDER_STORAGE_KEY && e.key !== LEGACY_ORDER_STORAGE_KEY)
        return;
      try {
        const ids: string[] = e.newValue ? JSON.parse(e.newValue) : [];
        setOrderedIds(ids);
      } catch {
        /* ignore malformed data */
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  // Re-derive when companies change (new company added/removed)
  const orderedCompanies = useMemo(() => {
    const byId = new Map(sidebarCompanies.map((c) => [c.id, c]));
    const result: Company[] = [];
    for (const id of orderedIds) {
      const c = byId.get(id);
      if (c) {
        result.push(c);
        byId.delete(id);
      }
    }
    // Append any new companies not yet in our order
    for (const c of byId.values()) {
      result.push(c);
    }
    return result;
  }, [sidebarCompanies, orderedIds]);

  const handleDragEnd = useCallback((newIds: string[]) => {
    setOrderedIds(newIds);
    saveOrder(newIds);
  }, []);

  return (
    <div className="flex w-[64px] shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-[linear-gradient(180deg,color-mix(in_oklab,var(--sidebar)_92%,var(--background)),color-mix(in_oklab,var(--sidebar)_96%,var(--accent))_56%,color-mix(in_oklab,var(--background)_98%,var(--sidebar)))] text-foreground dark:bg-[linear-gradient(180deg,color-mix(in_oklab,var(--sidebar)_94%,var(--background)),color-mix(in_oklab,var(--sidebar)_88%,var(--accent))_56%,color-mix(in_oklab,var(--background)_96%,black))]">
      <div className="flex w-full shrink-0 flex-col items-center gap-1.5 overflow-hidden border-b border-sidebar-border px-1.5 py-2.5">
        <div className="grid h-8 w-8 place-items-center rounded-[0.9rem] border border-border/80 bg-card/84 shadow-[0_10px_18px_rgba(15,23,42,0.05)] dark:bg-card/90 dark:shadow-[0_12px_18px_rgba(4,8,18,0.24)]">
          <ProductWordmark compact />
        </div>
        <div className="rounded-full border border-border/80 bg-card/80 px-1.25 py-0.5 text-[7px] font-medium tracking-[0.08em] text-muted-foreground dark:bg-card/92">
          Co
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-0.5 py-2 scrollbar-none">
        {reorderMode ? (
          <Suspense
            fallback={
              <div className="flex flex-col items-center gap-1.5">
                {orderedCompanies.map((company) => (
                  <CompanyRailItem
                    key={company.id}
                    company={company}
                    isSelected={company.id === selectedCompanyId}
                    hasLiveAgents={
                      hasLiveAgentsByCompanyId.get(company.id) ?? false
                    }
                    hasUnreadInbox={
                      hasUnreadInboxByCompanyId.get(company.id) ?? false
                    }
                    onSelect={() => setSelectedCompanyId(company.id)}
                  />
                ))}
              </div>
            }
          >
            <CompanyRailSortableList
              companies={orderedCompanies}
              selectedCompanyId={selectedCompanyId}
              hasLiveAgentsByCompanyId={hasLiveAgentsByCompanyId}
              hasUnreadInboxByCompanyId={hasUnreadInboxByCompanyId}
              onSelect={setSelectedCompanyId}
              onOrderChange={handleDragEnd}
            />
          </Suspense>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            {orderedCompanies.map((company) => (
              <CompanyRailItem
                key={company.id}
                company={company}
                isSelected={company.id === selectedCompanyId}
                hasLiveAgents={
                  hasLiveAgentsByCompanyId.get(company.id) ?? false
                }
                hasUnreadInbox={
                  hasUnreadInboxByCompanyId.get(company.id) ?? false
                }
                onSelect={() => setSelectedCompanyId(company.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1 border-t border-sidebar-border px-1.5 py-2">
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              onClick={() => setReorderMode((value) => !value)}
              className="flex w-full flex-col items-center justify-center gap-0.5 rounded-[0.9rem] border border-border/80 bg-card/72 px-0.75 py-1.5 text-muted-foreground transition-[border-color,color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/24 hover:bg-card hover:text-foreground dark:bg-card/88 dark:hover:bg-card"
              aria-pressed={reorderMode}
              aria-label={
                reorderMode ? "Finish company order" : "Reorder companies"
              }
            >
              {reorderMode ? (
                <Check className="h-3 w-3" />
              ) : (
                <ArrowUpDown className="h-3 w-3" />
              )}
              <span className="text-[7px] font-semibold uppercase tracking-[0.08em]">
                {reorderMode ? "Done" : "Order"}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            <p>{reorderMode ? "Finish company order" : "Reorder companies"}</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              onClick={() => openOnboarding()}
              className="flex w-full flex-col items-center justify-center gap-0.5 rounded-[0.9rem] border border-dashed border-border bg-card/74 px-0.75 py-1.75 text-muted-foreground transition-[border-color,color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/24 hover:bg-card hover:text-foreground dark:bg-card/88 dark:hover:bg-card"
              aria-label="Add company"
            >
              <Plus className="h-3 w-3" />
              <span className="text-[7px] font-semibold uppercase tracking-[0.08em]">
                Add
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            <p>Add company</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
