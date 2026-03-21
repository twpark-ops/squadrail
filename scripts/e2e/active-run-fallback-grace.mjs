function toEpochMillis(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : null;
}

export function shouldDelayFallbackForFreshRun(input) {
  const startedAtMs = toEpochMillis(input?.startedAt ?? null);
  if (startedAtMs == null) return false;
  const nowMs =
    input?.now instanceof Date
      ? input.now.getTime()
      : typeof input?.now === "number" && Number.isFinite(input.now)
        ? input.now
        : Date.now();
  const minAgeMs =
    typeof input?.minAgeMs === "number" && Number.isFinite(input.minAgeMs)
      ? input.minAgeMs
      : 0;
  return nowMs - startedAtMs < minAgeMs;
}
