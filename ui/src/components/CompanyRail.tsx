import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { cn } from "../lib/utils";
import { queryKeys } from "../lib/queryKeys";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { heartbeatsApi } from "../api/heartbeats";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Company } from "@squadrail/shared";
import { CompanyPatternIcon } from "./CompanyPatternIcon";
import { ProductWordmark } from "./ProductWordmark";
import { readJsonStorageAlias, writeJsonStorageAlias } from "../lib/storage-aliases";

const ORDER_STORAGE_KEY = "squadrail.companyOrder";
const LEGACY_ORDER_STORAGE_KEY = "squadrail.companyOrder";

function getStoredOrder(): string[] {
  return readJsonStorageAlias<string[]>(ORDER_STORAGE_KEY, LEGACY_ORDER_STORAGE_KEY, []);
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

function SortableCompanyItem({
  company,
  isSelected,
  hasLiveAgents,
  hasUnreadInbox,
  onSelect,
}: {
  company: Company;
  isSelected: boolean;
  hasLiveAgents: boolean;
  hasUnreadInbox: boolean;
  onSelect: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: company.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.8 : 1,
  };

  const healthHint = hasLiveAgents
    ? hasUnreadInbox
      ? "Live runs and inbox activity"
      : "Live runs active"
    : hasUnreadInbox
      ? "Inbox waiting"
      : "Idle";

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="overflow-visible">
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <a
            href={`/${company.issuePrefix}/overview`}
            onClick={() => onSelect()}
            className="group relative flex flex-col items-center gap-1.5 rounded-[1.4rem] px-1.5 py-2 overflow-visible"
          >
            <div
              className={cn(
                "absolute right-[-6px] top-3 bottom-3 w-[3px] rounded-full transition-all duration-200",
                isSelected
                  ? "bg-primary opacity-100"
                  : "bg-primary/0 opacity-0 group-hover:bg-primary/45 group-hover:opacity-100"
              )}
            />
            <div
              className={cn(
                "relative overflow-visible rounded-[1.35rem] border p-1.5 transition-[transform,border-color,background-color,box-shadow] duration-200",
                isSelected
                  ? "border-primary/16 bg-[color-mix(in_oklab,var(--primary)_10%,var(--card))] shadow-[0_18px_30px_rgba(54,78,155,0.14)] dark:shadow-[0_18px_28px_rgba(6,11,22,0.34)]"
                  : "border-border/0 bg-transparent group-hover:border-border/80 group-hover:bg-card/72 dark:group-hover:bg-card/88",
                isDragging && "scale-105 shadow-lg",
              )}
            >
              <CompanyPatternIcon
                companyName={company.name}
                brandColor={company.brandColor}
                label={company.issuePrefix}
                className={cn("h-10 w-10 rounded-[1rem] text-[10px]", isDragging && "shadow-lg")}
              />
              {hasLiveAgents && (
                <span className="pointer-events-none absolute -right-0.5 -top-0.5 z-10">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-80" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500 ring-2 ring-card" />
                  </span>
                </span>
              )}
              {hasUnreadInbox && (
                <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 z-10 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-card" />
              )}
            </div>
            <span
              className={cn(
                "max-w-full truncate px-1 text-[9px] font-semibold uppercase tracking-[0.18em]",
                isSelected ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
              )}
            >
              {company.issuePrefix}
            </span>
          </a>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={10} className="space-y-1 rounded-2xl border-border/80 bg-card px-3 py-2">
          <p className="text-sm font-semibold">{company.name}</p>
          <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
            {company.issuePrefix}
          </p>
          <p className="text-xs text-muted-foreground">{healthHint}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export function CompanyRail() {
  const { companies, selectedCompanyId, setSelectedCompanyId } = useCompany();
  const { openOnboarding } = useDialog();
  const sidebarCompanies = useMemo(
    () => companies.filter((company) => company.status !== "archived"),
    [companies],
  );
  const companyIds = useMemo(() => sidebarCompanies.map((company) => company.id), [sidebarCompanies]);

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
      if (e.key !== ORDER_STORAGE_KEY && e.key !== LEGACY_ORDER_STORAGE_KEY) return;
      try {
        const ids: string[] = e.newValue ? JSON.parse(e.newValue) : [];
        setOrderedIds(ids);
      } catch { /* ignore malformed data */ }
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

  // Require 8px of movement before starting a drag to avoid interfering with clicks
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const ids = orderedCompanies.map((c) => c.id);
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;

      const newIds = arrayMove(ids, oldIndex, newIndex);
      setOrderedIds(newIds);
      saveOrder(newIds);
    },
    [orderedCompanies]
  );

  return (
    <div className="flex w-[82px] shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-[linear-gradient(180deg,color-mix(in_oklab,var(--sidebar)_92%,var(--background)),color-mix(in_oklab,var(--sidebar)_96%,var(--accent))_56%,color-mix(in_oklab,var(--background)_98%,var(--sidebar)))] text-foreground dark:bg-[linear-gradient(180deg,color-mix(in_oklab,var(--sidebar)_94%,var(--background)),color-mix(in_oklab,var(--sidebar)_88%,var(--accent))_56%,color-mix(in_oklab,var(--background)_96%,black))]">
      <div className="flex w-full shrink-0 flex-col items-center gap-2.5 overflow-hidden border-b border-sidebar-border px-2.5 py-3.5">
        <div className="grid h-10 w-10 place-items-center rounded-[1.15rem] border border-border/80 bg-card/84 shadow-[0_14px_28px_rgba(15,23,42,0.07)] dark:bg-card/90 dark:shadow-[0_16px_24px_rgba(4,8,18,0.32)]">
          <ProductWordmark compact />
        </div>
        <div className="rounded-full border border-border/80 bg-card/80 px-2 py-1 text-[9px] font-medium tracking-[0.12em] text-muted-foreground dark:bg-card/92">
          Co
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-1.5 py-3.5 scrollbar-none">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={orderedCompanies.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col items-center gap-2.5">
              {orderedCompanies.map((company) => (
                <SortableCompanyItem
                  key={company.id}
                  company={company}
                  isSelected={company.id === selectedCompanyId}
                  hasLiveAgents={hasLiveAgentsByCompanyId.get(company.id) ?? false}
                  hasUnreadInbox={hasUnreadInboxByCompanyId.get(company.id) ?? false}
                  onSelect={() => setSelectedCompanyId(company.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <div className="border-t border-sidebar-border px-2.5 py-3.5">
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              onClick={() => openOnboarding()}
              className="flex w-full flex-col items-center justify-center gap-1 rounded-[1.15rem] border border-dashed border-border bg-card/74 px-1.5 py-2.5 text-muted-foreground transition-[border-color,color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/24 hover:bg-card hover:text-foreground dark:bg-card/88 dark:hover:bg-card"
              aria-label="Add company"
            >
              <Plus className="h-4 w-4" />
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em]">Add</span>
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
