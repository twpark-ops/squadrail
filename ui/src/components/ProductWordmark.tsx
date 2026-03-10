import { cn } from "../lib/utils";

interface ProductWordmarkProps {
  compact?: boolean;
  className?: string;
}

export function ProductWordmark({ compact = false, className }: ProductWordmarkProps) {
  if (compact) {
    return (
      <div className={cn("flex max-w-full items-center justify-center overflow-hidden", className)}>
        <ProductGlyph className="h-9 w-9" />
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-3.5", className)}>
      <ProductGlyph className="h-11 w-11 shrink-0" />
      <div className="min-w-0">
        <div className="truncate text-[10px] font-semibold uppercase tracking-[0.34em] text-primary/82">
          Autonomous Delivery
        </div>
        <div className="truncate font-['Space_Grotesk'] text-[1.15rem] font-semibold tracking-[-0.05em] text-foreground">
          Squadrail
        </div>
      </div>
    </div>
  );
}

function ProductGlyph({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[1.1rem] border border-slate-900/8 bg-[linear-gradient(165deg,#091120,#112344_48%,#2e6dff_100%)] shadow-[0_16px_34px_rgba(39,79,175,0.24)] dark:border-white/10 dark:bg-[linear-gradient(165deg,#0a1220,#142847_48%,#3b82f6_100%)] dark:shadow-[0_16px_34px_rgba(24,43,86,0.34)]",
        className,
      )}
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.26),transparent_44%)]" />
      <div className="absolute inset-[4px] rounded-[0.95rem] border border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))]" />
      <div className="absolute left-[9px] top-[9px] h-2.5 w-[58%] rounded-full bg-white/90" />
      <div className="absolute left-[9px] top-[9px] h-[58%] w-2.5 rounded-full bg-white/82" />
      <div className="absolute right-[9px] bottom-[9px] h-2.5 w-[54%] rounded-full bg-cyan-200/88" />
      <div className="absolute right-[9px] top-[9px] h-2.5 w-2.5 rounded-full bg-white/82" />
    </div>
  );
}
