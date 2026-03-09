import { cn } from "@/lib/utils";

interface StatusPulseDotProps {
  active: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Animated pulse indicator for active agents/processes
 * - Green pulsing dot when active
 * - Gray static dot when idle
 */
export function StatusPulseDot({ active, size = "md", className }: StatusPulseDotProps) {
  const sizeClasses = {
    sm: "h-2 w-2",
    md: "h-2.5 w-2.5",
    lg: "h-3 w-3",
  };

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      {/* Outer pulse ring (only when active) */}
      {active && (
        <span
          className={cn(
            "absolute inline-flex rounded-full bg-emerald-400 opacity-75 status-pulse-ring",
            sizeClasses[size]
          )}
        />
      )}

      {/* Inner dot */}
      <span
        className={cn(
          "relative inline-flex rounded-full",
          sizeClasses[size],
          active
            ? "bg-emerald-500 status-pulse"
            : "bg-muted-foreground/40"
        )}
      />
    </div>
  );
}
