import path from "node:path";

export function uniqueNonEmpty(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ordered.push(trimmed);
  }
  return ordered;
}

export function compactWhitespace(value: string, max = 220) {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= max) return compacted;
  return `${compacted.slice(0, max - 1)}...`;
}

export function truncateRetrievalSegment(value: string, max: number) {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= max) return compacted;
  return `${compacted.slice(0, Math.max(0, max - 3))}...`;
}

export function normalizeHintPath(value: string) {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  return path.posix.normalize(normalized);
}

export function basenameWithoutExtension(filePath: string) {
  const base = path.posix.basename(filePath);
  return base.replace(/\.[^.]+$/, "");
}

export function metadataStringArray(metadata: Record<string, unknown>, keys: string[]) {
  const values: string[] = [];
  for (const key of keys) {
    const candidate = metadata[key];
    if (!Array.isArray(candidate)) continue;
    for (const item of candidate) {
      if (typeof item === "string" && item.trim().length > 0) {
        values.push(item.trim());
      }
    }
  }
  return uniqueNonEmpty(values);
}
