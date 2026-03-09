import { useMemo } from "react";
import type { ActivityEvent, Agent } from "@squadrail/shared";
import { ActivityRow } from "./ActivityRow";
import { cn } from "@/lib/utils";

interface ActivityTimelineV2Props {
  events: ActivityEvent[];
  agentMap?: Map<string, Agent>;
  entityNameMap?: Map<string, string>;
  entityTitleMap?: Map<string, string>;
  limit?: number;
  className?: string;
}

/**
 * Enhanced activity timeline with vertical layout and date grouping
 * Uses existing ActivityRow component with improved spacing
 */
export function ActivityTimelineV2({
  events,
  agentMap = new Map(),
  entityNameMap = new Map(),
  entityTitleMap = new Map(),
  limit = 20,
  className
}: ActivityTimelineV2Props) {
  const displayEvents = useMemo(() => {
    return events.slice(0, limit);
  }, [events, limit]);

  if (displayEvents.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        No recent activity
      </div>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      {displayEvents.map((event) => (
        <ActivityRow
          key={event.id}
          event={event}
          agentMap={agentMap}
          entityNameMap={entityNameMap}
          entityTitleMap={entityTitleMap}
        />
      ))}
    </div>
  );
}
