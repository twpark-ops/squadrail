import { useMemo } from "react";
import { NavLink } from "@/lib/router";
import {
  House,
  Workflow,
  GitBranch,
  Bot,
  Users,
} from "lucide-react";
import { cn } from "../lib/utils";
import { appRoutes } from "../lib/appRoutes";

interface MobileBottomNavProps {
  visible: boolean;
}

interface MobileNavLinkItem {
  to: string;
  label: string;
  icon: typeof House;
}
type MobileNavItem = MobileNavLinkItem;

export function MobileBottomNav({ visible }: MobileBottomNavProps) {
  const items = useMemo<MobileNavItem[]>(
    () => [
      { to: appRoutes.overview, label: "Overview", icon: House },
      { to: appRoutes.work, label: "Work", icon: Workflow },
      { to: appRoutes.changes, label: "Changes", icon: GitBranch },
      { to: appRoutes.runs, label: "Runs", icon: Bot },
      { to: appRoutes.team, label: "Team", icon: Users },
    ],
    [],
  );

  return (
    <nav
      className={cn(
        "fixed inset-x-3 bottom-3 z-30 transition-transform duration-200 ease-out md:hidden",
        visible ? "translate-y-0" : "translate-y-full",
      )}
      aria-label="Mobile navigation"
    >
      <div className="mx-auto max-w-[28rem] rounded-[1.65rem] border border-border/80 bg-[color-mix(in_oklab,var(--card)_88%,var(--background))] p-1.5 shadow-[0_20px_42px_rgba(15,23,42,0.14)] backdrop-blur-xl supports-[backdrop-filter]:bg-[color-mix(in_oklab,var(--card)_84%,var(--background))] dark:shadow-[0_20px_42px_rgba(4,8,18,0.32)]">
        <div className="grid h-[4.4rem] grid-cols-5 gap-1 pb-[env(safe-area-inset-bottom)]">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.label}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-[1.1rem] border border-transparent text-[10px] font-medium transition-[background-color,border-color,color]",
                    isActive
                      ? "border-primary/16 bg-[color-mix(in_oklab,var(--primary)_10%,var(--card))] text-foreground"
                      : "text-muted-foreground hover:border-border hover:bg-accent/55 hover:text-foreground",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="relative">
                      <Icon className={cn("h-[18px] w-[18px]", isActive && "stroke-[2.25]")} />
                    </span>
                    <span className="truncate">{item.label}</span>
                  </>
                )}
              </NavLink>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
