import { cn } from "@/lib/utils";

interface LoadingSkeletonProps {
  className?: string;
  variant?: "text" | "circular" | "rectangular";
  width?: string | number;
  height?: string | number;
}

/**
 * Generic loading skeleton to prevent layout shift
 */
export function LoadingSkeleton({
  className,
  variant = "rectangular",
  width,
  height,
}: LoadingSkeletonProps) {
  const variantClasses = {
    text: "h-4 rounded",
    circular: "rounded-full",
    rectangular: "rounded-lg",
  };

  const style: React.CSSProperties = {};
  if (width) style.width = typeof width === "number" ? `${width}px` : width;
  if (height) style.height = typeof height === "number" ? `${height}px` : height;

  return (
    <div
      className={cn("animate-pulse bg-muted", variantClasses[variant], className)}
      style={style}
      aria-busy="true"
      aria-label="Loading"
    />
  );
}

/**
 * Card skeleton for loading states
 */
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("p-6 border rounded-xl space-y-4", className)}>
      <LoadingSkeleton className="h-6 w-32" />
      <div className="space-y-3">
        <LoadingSkeleton className="h-16 w-full" />
        <LoadingSkeleton className="h-16 w-full" />
        <LoadingSkeleton className="h-16 w-full" />
      </div>
    </div>
  );
}

/**
 * Metric card skeleton
 */
export function MetricCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("p-6 border rounded-xl space-y-2", className)}>
      <LoadingSkeleton className="h-10 w-24" />
      <LoadingSkeleton className="h-4 w-32" />
      <LoadingSkeleton className="h-3 w-40" />
    </div>
  );
}
