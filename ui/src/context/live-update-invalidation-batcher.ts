import type { QueryClient } from "@tanstack/react-query";

export const LIVE_UPDATE_INVALIDATION_WINDOW_MS = 150;

type TimerHandle = ReturnType<typeof setTimeout>;

export interface LiveUpdateInvalidationBatcher {
  invalidate(queryKey: readonly unknown[]): void;
  flush(): void;
  dispose(): void;
}

export function createLiveUpdateInvalidationBatcher(input: {
  queryClient: QueryClient;
  windowMs?: number;
}): LiveUpdateInvalidationBatcher {
  const windowMs = input.windowMs ?? LIVE_UPDATE_INVALIDATION_WINDOW_MS;
  const pending = new Map<string, readonly unknown[]>();
  let timer: TimerHandle | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.size === 0) return;
    const queryKeys = Array.from(pending.values());
    pending.clear();
    for (const queryKey of queryKeys) {
      void input.queryClient.invalidateQueries({ queryKey });
    }
  };

  return {
    invalidate(queryKey) {
      pending.set(JSON.stringify(queryKey), queryKey);
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, windowMs);
    },
    flush,
    dispose() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending.clear();
    },
  };
}
