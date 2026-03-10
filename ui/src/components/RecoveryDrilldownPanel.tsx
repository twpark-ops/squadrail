import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { dashboardApi } from "../api/dashboard";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { timeAgo } from "../lib/timeAgo";
import { workIssuePath } from "../lib/appRoutes";
import type { DashboardRecoveryCase } from "@squadrail/shared";

function formatProtocolLabel(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function recoveryCaseKey(item: DashboardRecoveryCase) {
  return `${item.recoveryType}:${item.issueId}:${item.code ?? "none"}:${item.createdAt.toString()}`;
}

export function RecoveryDrilldownPanel({
  companyId,
  items,
}: {
  companyId: string;
  items: DashboardRecoveryCase[];
}) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | DashboardRecoveryCase["recoveryType"]>("all");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [noteBody, setNoteBody] = useState(
    "Board recovery note: inspect the current blocker, preserve evidence, and post the next deterministic handoff.",
  );

  const filteredItems = useMemo(
    () => (filter === "all" ? items : items.filter((item) => item.recoveryType === filter)),
    [filter, items],
  );
  const selectedItems = useMemo(
    () => filteredItems.filter((item) => selectedKeys.includes(recoveryCaseKey(item))),
    [filteredItems, selectedKeys],
  );
  const selectedIssueIds = useMemo(
    () => Array.from(new Set(selectedItems.map((item) => item.issueId))),
    [selectedItems],
  );
  const hasSelectedViolation = selectedItems.some((item) => item.recoveryType === "violation");

  useEffect(() => {
    const validKeys = new Set(items.map(recoveryCaseKey));
    setSelectedKeys((current) => current.filter((key) => validKeys.has(key)));
  }, [items]);

  const recoveryActionMutation = useMutation({
    mutationFn: (input: { actionType: "resolve_violations" | "post_recovery_note"; noteBody?: string }) =>
      dashboardApi.applyRecoveryAction(companyId, {
        actionType: input.actionType,
        issueIds: selectedIssueIds,
        recoveryTypes: Array.from(new Set(selectedItems.map((item) => item.recoveryType))),
        noteBody: input.noteBody,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboardRecoveryQueue(companyId, 12) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboardProtocolQueue(companyId, 20) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(companyId) });
      setSelectedKeys([]);
    },
  });

  function toggleSelection(key: string) {
    setSelectedKeys((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );
  }

  function toggleSelectAllVisible() {
    const visibleKeys = filteredItems.map(recoveryCaseKey);
    const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeys.includes(key));
    setSelectedKeys((current) =>
      allVisibleSelected
        ? current.filter((key) => !visibleKeys.includes(key))
        : Array.from(new Set([...current, ...visibleKeys])),
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recovery Drill-down</h3>
          <p className="text-xs text-muted-foreground">
            Runtime failures, protocol violations, timeout escalations, and integrity backlog that need operator action.
          </p>
        </div>
        <div className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card">
          <ShieldAlert className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "runtime", "violation", "timeout", "integrity"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                filter === value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:bg-accent/50",
              )}
            >
              {value === "all" ? "All" : formatProtocolLabel(value)}
            </button>
          ))}
          <button
            type="button"
            onClick={toggleSelectAllVisible}
            className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/50"
            disabled={filteredItems.length === 0}
          >
            {filteredItems.length > 0 && filteredItems.every((item) => selectedKeys.includes(recoveryCaseKey(item)))
              ? "Clear visible"
              : "Select visible"}
          </button>
        </div>

        <textarea
          className="min-h-[88px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
          value={noteBody}
          onChange={(event) => setNoteBody(event.target.value)}
          placeholder="Shared board recovery note for selected issues"
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => recoveryActionMutation.mutate({ actionType: "resolve_violations" })}
            disabled={recoveryActionMutation.isPending || selectedIssueIds.length === 0 || !hasSelectedViolation}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Resolve violations
          </button>
          <button
            type="button"
            onClick={() => recoveryActionMutation.mutate({ actionType: "post_recovery_note", noteBody })}
            disabled={recoveryActionMutation.isPending || selectedIssueIds.length === 0 || noteBody.trim().length === 0}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Post board note
          </button>
          <div className="text-xs text-muted-foreground">
            {selectedIssueIds.length} issue(s) selected
          </div>
          {recoveryActionMutation.data && (
            <div className="text-xs text-muted-foreground">
              Updated violations {recoveryActionMutation.data.affectedViolationCount} · created notes {recoveryActionMutation.data.createdMessageCount}
            </div>
          )}
          {recoveryActionMutation.isError && (
            <div className="text-xs text-destructive">
              {recoveryActionMutation.error instanceof Error ? recoveryActionMutation.error.message : "Recovery action failed"}
            </div>
          )}
        </div>

        {filteredItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
            No recovery cases are open.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredItems.map((item) => (
              <Link
                key={recoveryCaseKey(item)}
                to={workIssuePath(item.identifier ?? item.issueId)}
                className={cn(
                  "block rounded-lg border p-4 transition-colors hover:border-foreground/20 hover:bg-accent/20",
                  item.recoveryType === "violation"
                    ? "border-red-300/70 bg-red-50/70"
                    : item.recoveryType === "runtime"
                      ? "border-orange-300/70 bg-orange-50/70"
                      : "border-amber-300/70 bg-amber-50/70",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-2">
                    <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={selectedKeys.includes(recoveryCaseKey(item))}
                        onChange={(event) => {
                          event.stopPropagation();
                          toggleSelection(recoveryCaseKey(item));
                        }}
                        onClick={(event) => event.stopPropagation()}
                      />
                      Select
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {item.identifier ?? item.issueId.slice(0, 8)}
                      </span>
                      <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                        {formatProtocolLabel(item.recoveryType)}
                      </span>
                      <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                        {formatProtocolLabel(item.workflowState)}
                      </span>
                      {item.code && (
                        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                          {item.code}
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-semibold text-foreground">{item.title}</div>
                    <p className="text-sm text-muted-foreground">{item.summary}</p>
                    <div className="rounded-md border border-border/70 bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                      Next action: {item.nextAction}
                    </div>
                  </div>
                  <div className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(item.createdAt)}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
