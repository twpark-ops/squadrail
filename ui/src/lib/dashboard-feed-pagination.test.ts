import { describe, expect, it } from "vitest";
import {
  firstPaginatedFeedSummary,
  flattenPaginatedFeedItems,
  lastPaginatedFeedMeta,
} from "./dashboard-feed-pagination";

describe("dashboard feed pagination helpers", () => {
  it("flattens paginated items and de-dupes by key when requested", () => {
    const pages = [
      { items: [{ id: "a" }, { id: "b" }] },
      { items: [{ id: "b" }, { id: "c" }] },
    ];

    expect(flattenPaginatedFeedItems(pages).map((item) => item.id)).toEqual(["a", "b", "b", "c"]);
    expect(flattenPaginatedFeedItems(pages, (item) => item.id).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("reads the first summary and last pagination meta", () => {
    const pages = [
      { summary: { total: 4 }, hasMore: true, nextOffset: 2 },
      { summary: { total: 4 }, hasMore: false, nextOffset: null },
    ];

    expect(firstPaginatedFeedSummary(pages)).toEqual({ total: 4 });
    expect(lastPaginatedFeedMeta(pages)).toEqual(
      expect.objectContaining({
        hasMore: false,
        nextOffset: null,
      }),
    );
  });
});
