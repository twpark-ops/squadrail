import { describe, expect, it, vi } from "vitest";
import { createLiveUpdateInvalidationBatcher } from "./live-update-invalidation-batcher";

describe("createLiveUpdateInvalidationBatcher", () => {
  it("deduplicates invalidations inside the debounce window", async () => {
    vi.useFakeTimers();
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const batcher = createLiveUpdateInvalidationBatcher({
      queryClient: {
        invalidateQueries,
      } as never,
      windowMs: 100,
    });

    batcher.invalidate(["issues", "detail", "ISS-1"]);
    batcher.invalidate(["issues", "detail", "ISS-1"]);
    batcher.invalidate(["issues", "comments", "ISS-1"]);

    expect(invalidateQueries).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);

    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ["issues", "detail", "ISS-1"],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ["issues", "comments", "ISS-1"],
    });

    batcher.dispose();
    vi.useRealTimers();
  });
});
