import { type ReactNode } from "react";
import { Link } from "@/lib/router";
import { cn } from "../lib/utils";

interface EntityRowProps {
  leading?: ReactNode;
  identifier?: string;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  selected?: boolean;
  to?: string;
  onClick?: () => void;
  className?: string;
}

export function EntityRow({
  leading,
  identifier,
  title,
  subtitle,
  trailing,
  selected,
  to,
  onClick,
  className,
}: EntityRowProps) {
  const isClickable = !!(to || onClick);
  const classes = cn(
    "flex items-center gap-4 px-5 py-4 text-sm border-b border-border/85 last:border-b-0 transition-[background-color,border-color]",
    isClickable && "cursor-pointer hover:bg-accent/60",
    selected && "bg-accent/45",
    className
  );

  const content = (
    <>
      {leading && <div className="flex items-center gap-2 shrink-0">{leading}</div>}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5">
          {identifier && (
            <span className="relative top-[1px] shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground font-mono">
              {identifier}
            </span>
          )}
          <span className="truncate font-semibold text-foreground">{title}</span>
        </div>
        {subtitle && (
          <p className="mt-1 truncate text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {trailing && <div className="flex items-center gap-2 shrink-0">{trailing}</div>}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={cn(classes, "no-underline text-inherit")} onClick={onClick}>
        {content}
      </Link>
    );
  }

  return (
    <div className={classes} onClick={onClick}>
      {content}
    </div>
  );
}
