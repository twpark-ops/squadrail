import { useMemo } from "react";
import { cn } from "../lib/utils";

interface CompanyPatternIconProps {
  companyName: string;
  brandColor?: string | null;
  label?: string | null;
  className?: string;
}

function normalizeHex(hex: string | null | undefined) {
  if (!hex) return null;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : null;
}

function makeMonogram(companyName: string, label?: string | null) {
  if (label && label.trim()) return label.trim().slice(0, 3).toUpperCase();
  const parts = companyName
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]!.charAt(0)}${parts[1]!.charAt(0)}`.toUpperCase();
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function fallbackBrand(seed: string) {
  const palette = ["#5B6CFF", "#0F766E", "#E85D2A", "#7C3AED", "#B45309", "#2563EB"];
  return palette[hashString(seed) % palette.length]!;
}

function mixColor(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function CompanyPatternIcon({ companyName, brandColor, label, className }: CompanyPatternIconProps) {
  const monogram = makeMonogram(companyName, label);
  const normalizedBrand = normalizeHex(brandColor) ?? fallbackBrand(`${companyName}:${label ?? ""}`);
  const style = useMemo(() => {
    return {
      borderColor: mixColor(normalizedBrand, 0.22),
      boxShadow: `0 16px 28px ${mixColor(normalizedBrand, 0.18)}`,
      backgroundImage: `linear-gradient(160deg, ${mixColor(normalizedBrand, 0.94)}, ${mixColor(normalizedBrand, 0.68)})`,
    };
  }, [normalizedBrand]);

  return (
    <div
      className={cn(
        "relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-[1.15rem] border text-[11px] font-semibold uppercase tracking-[0.18em] text-white",
        className,
      )}
      style={style}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.26),transparent_42%)]" />
      <div className="absolute inset-[4px] rounded-[0.9rem] border border-white/14 bg-[linear-gradient(180deg,rgba(255,255,255,0.12),rgba(255,255,255,0.02))]" />
      <span className="absolute left-2.5 top-2.5 h-1.5 w-5 rounded-full bg-white/78" />
      <span className="absolute right-2.5 bottom-2.5 h-1.5 w-1.5 rounded-full bg-white/88" />
      <span className="relative z-10 font-['IBM_Plex_Mono'] tracking-[0.2em] text-white/96">{monogram}</span>
    </div>
  );
}
