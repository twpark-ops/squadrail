import { cn } from "../lib/utils";

interface ProductWordmarkProps {
  compact?: boolean;
  className?: string;
}

export function ProductWordmark({ compact = false, className }: ProductWordmarkProps) {
  if (compact) {
    return (
      <div className={cn("flex max-w-full items-center justify-center overflow-hidden", className)}>
        <ProductGlyph className="h-7 w-7 rounded-[0.85rem]" />
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <ProductGlyph className="h-7.5 w-7.5 shrink-0 rounded-[0.82rem]" />
      <div className="min-w-0">
        <div className="truncate text-[8px] font-medium tracking-[0.08em] text-muted-foreground">
          Operations studio
        </div>
        <div className="truncate font-['Space_Grotesk'] text-[0.9rem] font-semibold tracking-[-0.05em] text-foreground">
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
        "relative overflow-hidden rounded-[1rem] border border-slate-900/8 bg-[linear-gradient(165deg,#091120,#112344_48%,#2e6dff_100%)] shadow-[0_14px_28px_rgba(39,79,175,0.2)] dark:border-white/10 dark:bg-[linear-gradient(165deg,#0a1220,#142847_48%,#3b82f6_100%)] dark:shadow-[0_14px_28px_rgba(24,43,86,0.3)]",
        className,
      )}
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.26),transparent_44%)]" />
      <div className="absolute inset-[4px] rounded-[0.8rem] border border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))]" />
      <div className="absolute left-[8px] top-[8px] h-2 w-[58%] rounded-full bg-white/90" />
      <div className="absolute left-[8px] top-[8px] h-[58%] w-2 rounded-full bg-white/82" />
      <div className="absolute right-[8px] bottom-[8px] h-2 w-[54%] rounded-full bg-cyan-200/88" />
      <div className="absolute right-[8px] top-[8px] h-2 w-2 rounded-full bg-white/82" />
    </div>
  );
}
