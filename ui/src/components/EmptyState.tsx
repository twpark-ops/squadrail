import { Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: LucideIcon;
  message: string;
  action?: string;
  onAction?: () => void;
}

export function EmptyState({ icon: Icon, message, action, onAction }: EmptyStateProps) {
  return (
    <div className="rounded-[1.85rem] border border-border bg-card px-10 py-14 text-center shadow-card">
      <div className="mx-auto mb-6 flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-[1.5rem] border border-primary/10 bg-primary/8">
        <Icon className="h-8 w-8 text-primary" />
      </div>
      <p className="mx-auto max-w-xl text-base leading-7 text-muted-foreground">{message}</p>
      {action && onAction && (
        <Button onClick={onAction} className="mt-7 rounded-full px-5">
          <Plus className="mr-1.5 h-4 w-4" />
          {action}
        </Button>
      )}
    </div>
  );
}
