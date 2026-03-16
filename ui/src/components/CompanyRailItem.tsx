import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Company } from "@squadrail/shared";
import { CompanyPatternIcon } from "./CompanyPatternIcon";
import { cn } from "../lib/utils";

interface CompanyRailItemProps {
  company: Company;
  isSelected: boolean;
  hasLiveAgents: boolean;
  hasUnreadInbox: boolean;
  onSelect: () => void;
  isDragging?: boolean;
}

export function CompanyRailItem({
  company,
  isSelected,
  hasLiveAgents,
  hasUnreadInbox,
  onSelect,
  isDragging = false,
}: CompanyRailItemProps) {
  const healthHint = hasLiveAgents
    ? hasUnreadInbox
      ? "Live runs and inbox activity"
      : "Live runs active"
    : hasUnreadInbox
    ? "Inbox waiting"
    : "Idle";

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <a
          href={`/${company.issuePrefix}/overview`}
          onClick={() => onSelect()}
          className="group relative flex flex-col items-center gap-0.5 overflow-visible rounded-[1rem] px-0.5 py-1"
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
              "relative overflow-visible rounded-[0.95rem] border p-1 transition-[transform,border-color,background-color,box-shadow] duration-200",
              isSelected
                ? "border-primary/14 bg-[color-mix(in_oklab,var(--primary)_9%,var(--card))] shadow-[0_12px_22px_rgba(54,78,155,0.12)] dark:shadow-[0_12px_22px_rgba(6,11,22,0.28)]"
                : "border-border/0 bg-transparent group-hover:border-border/80 group-hover:bg-card/72 dark:group-hover:bg-card/88",
              isDragging && "scale-105 shadow-lg"
            )}
          >
            <CompanyPatternIcon
              companyName={company.name}
              brandColor={company.brandColor}
              label={company.issuePrefix}
              className={cn(
                "h-8 w-8 rounded-[0.78rem] text-[8px]",
                isDragging && "shadow-lg"
              )}
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
              "max-w-full px-0.5 font-semibold uppercase text-center leading-tight",
              company.issuePrefix.length > 4
                ? "text-[5.5px] tracking-[0.06em] break-all line-clamp-2"
                : "text-[7px] tracking-[0.1em] truncate",
              isSelected
                ? "text-foreground"
                : "text-muted-foreground group-hover:text-foreground"
            )}
            title={company.issuePrefix}
          >
            {company.issuePrefix}
          </span>
        </a>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        sideOffset={10}
        className="space-y-1 rounded-2xl border-border/80 bg-card px-3 py-2"
      >
        <p className="text-sm font-semibold">{company.name}</p>
        <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
          {company.issuePrefix}
        </p>
        <p className="text-xs text-muted-foreground">{healthHint}</p>
      </TooltipContent>
    </Tooltip>
  );
}
