import { describe, expect, it } from "vitest";
import { enqueueAfterDbCommit, runWithDbContext, runWithoutDbContext } from "./context.js";

describe("db context after-commit queue", () => {
  it("queues callbacks inside db context and leaves execution to the caller", async () => {
    const callbacks: Array<() => void | Promise<void>> = [];
    const observed: string[] = [];

    runWithDbContext(
      {},
      () => {
        const queued = enqueueAfterDbCommit(() => {
          observed.push("after-commit");
        });

        observed.push("inside");
        expect(queued).toBe(true);
      },
      { afterCommitCallbacks: callbacks },
    );

    expect(observed).toEqual(["inside"]);
    expect(callbacks).toHaveLength(1);

    await callbacks[0]?.();
    expect(observed).toEqual(["inside", "after-commit"]);
  });

  it("does not queue callbacks outside db context", () => {
    expect(enqueueAfterDbCommit(() => undefined)).toBe(false);

    runWithoutDbContext(() => {
      expect(enqueueAfterDbCommit(() => undefined)).toBe(false);
    });
  });
});
