import { NavLink } from "@/lib/router";
import { cn } from "../lib/utils";
import { useSidebar } from "../context/SidebarContext";
import type { LucideIcon } from "lucide-react";

interface SidebarNavItemProps {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  className?: string;
  badge?: number;
  badgeTone?: "default" | "danger";
  alert?: boolean;
  liveCount?: number;
}

export function SidebarNavItem({
  to,
  label,
  icon: Icon,
  end,
  className,
  badge,
  badgeTone = "default",
  alert = false,
  liveCount,
}: SidebarNavItemProps) {
  const { isMobile, setSidebarOpen } = useSidebar();

  return (
    <NavLink
      to={to}
      end={end}
      onClick={() => { if (isMobile) setSidebarOpen(false); }}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-3 rounded-[1.2rem] border px-3 py-2.5 text-[13px] font-medium transition-[border-color,background-color,color,transform,box-shadow]",
          isActive
            ? "border-primary/14 bg-[color-mix(in_oklab,var(--primary)_10%,var(--card))] text-foreground shadow-[0_16px_28px_color-mix(in_oklab,var(--primary)_10%,transparent)]"
            : "border-transparent text-foreground/72 hover:border-border/80 hover:bg-card/70 hover:text-foreground dark:hover:bg-card/90",
          className,
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              "absolute inset-y-2 left-0.5 w-1 rounded-full transition-colors",
              isActive ? "bg-primary/80" : "bg-transparent group-hover:bg-primary/35",
            )}
          />
          <span
            className={cn(
              "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.95rem] border transition-colors",
              isActive
                ? "border-primary/10 bg-background text-primary shadow-[0_8px_18px_rgba(15,23,42,0.05)] dark:bg-background/92"
                : "border-transparent bg-transparent text-muted-foreground group-hover:border-border/80 group-hover:bg-card group-hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {alert && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-card" />
            )}
          </span>
          <span className="flex-1 truncate">{label}</span>
          {liveCount != null && liveCount > 0 && (
            <span
              className={cn(
                "ml-auto rounded-full border px-2 py-1 text-[10px] font-semibold",
                isActive
                  ? "border-primary/12 bg-background/82 text-primary dark:bg-background/92"
                  : "border-border bg-background text-muted-foreground",
              )}
            >
              {liveCount} live
            </span>
          )}
          {badge != null && badge > 0 && (
            <span
              className={cn(
                "ml-auto rounded-full px-1.5 py-0.5 text-xs leading-none",
                badgeTone === "danger"
                  ? "bg-red-600/90 text-red-50"
                  : isActive
                    ? "bg-primary/14 text-primary"
                    : "bg-primary text-primary-foreground",
              )}
            >
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}
