import type { ReactNode } from "react";

interface SidebarSectionProps {
  label: string;
  children: ReactNode;
}

export function SidebarSection({ label, children }: SidebarSectionProps) {
  return (
    <div className="space-y-2.5">
      <div className="px-1 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}
