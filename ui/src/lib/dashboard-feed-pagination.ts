export function flattenPaginatedFeedItems<T>(
  pages: Array<{ items: T[] }> | undefined,
  getKey?: (item: T) => string,
) {
  if (!pages || pages.length === 0) return [] as T[];
  if (!getKey) return pages.flatMap((page) => page.items);

  const seen = new Set<string>();
  const flattened: T[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      const key = getKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      flattened.push(item);
    }
  }
  return flattened;
}

export function firstPaginatedFeedSummary<T>(
  pages: Array<{ summary: T }> | undefined,
) {
  return pages?.[0]?.summary;
}

export function lastPaginatedFeedMeta<T extends {
  hasMore: boolean;
  nextOffset: number | null;
}>(
  pages: T[] | undefined,
) {
  return pages && pages.length > 0 ? pages[pages.length - 1] : null;
}
