import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface SupportPanelProps {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function SupportPanel({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: SupportPanelProps) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-[1.8rem] border border-border bg-card shadow-card",
        className,
      )}
    >
      <header className="flex flex-col gap-3 border-b border-border/80 px-5 py-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.03em] text-foreground">{title}</h2>
          {description ? (
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className={cn("px-5 py-5", contentClassName)}>{children}</div>
    </section>
  );
}
