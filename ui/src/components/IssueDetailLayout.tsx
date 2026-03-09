import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface IssueDetailLayoutProps {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  className?: string;
}

/**
 * Optimized 3-column layout for Issue Detail
 *
 * Structure:
 * - Left (25%): Brief, Evidence, Related Issues
 * - Center (50%): Description, Protocol Timeline, Comments
 * - Right (25%): Properties, Quick Actions
 *
 * Responsive:
 * - Mobile: Stack vertically
 * - Tablet: 2 columns (center + right)
 * - Desktop: 3 columns
 */
export function IssueDetailLayout({ left, center, right, className }: IssueDetailLayoutProps) {
  return (
    <div className={cn("grid grid-cols-1 lg:grid-cols-12 gap-6", className)}>
      {/* Left Panel - Brief & Context */}
      <aside className="lg:col-span-3 space-y-6 order-3 lg:order-1">
        {left}
      </aside>

      {/* Center Panel - Main Content */}
      <main className="lg:col-span-6 space-y-6 order-1 lg:order-2">
        {center}
      </main>

      {/* Right Panel - Properties & Actions */}
      <aside className="lg:col-span-3 space-y-6 order-2 lg:order-3">
        {right}
      </aside>
    </div>
  );
}

interface SectionCardProps {
  title: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * Reusable section card for Issue Detail panels
 */
export function SectionCard({
  title,
  children,
  badge,
  actions,
  className,
}: SectionCardProps) {
  return (
    <section className={cn("rounded-xl border bg-card shadow-card overflow-hidden", className)}>
      <div className="px-5 py-3 border-b bg-muted/30 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide">{title}</h3>
          {badge}
        </div>
        {actions}
      </div>
      <div className="p-5">
        {children}
      </div>
    </section>
  );
}

interface PropertyRowProps {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
}

/**
 * Compact property row for right panel
 */
export function PropertyRow({ label, value, icon }: PropertyRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-sm font-medium">
        {value}
      </div>
    </div>
  );
}
