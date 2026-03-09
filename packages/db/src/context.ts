import { AsyncLocalStorage } from "node:async_hooks";

type AfterDbCommitCallback = () => void | Promise<void>;

type DbContextStore = {
  db: object;
  afterCommitCallbacks: AfterDbCommitCallback[];
};

const dbContextStorage = new AsyncLocalStorage<DbContextStore | undefined>();

function currentContextDb<T extends object>(fallback: T): T {
  const current = dbContextStorage.getStore()?.db;
  return (current as T | undefined) ?? fallback;
}

export function runWithDbContext<T>(
  db: object,
  fn: () => T,
  opts?: { afterCommitCallbacks?: AfterDbCommitCallback[] },
): T {
  return dbContextStorage.run(
    {
      db,
      afterCommitCallbacks: opts?.afterCommitCallbacks ?? [],
    },
    fn,
  );
}

export function runWithoutDbContext<T>(fn: () => T): T {
  return dbContextStorage.run(undefined, fn);
}

export function enqueueAfterDbCommit(callback: AfterDbCommitCallback): boolean {
  const store = dbContextStorage.getStore();
  if (!store) return false;
  store.afterCommitCallbacks.push(callback);
  return true;
}

export function drainAfterDbCommitCallbacks() {
  const store = dbContextStorage.getStore();
  if (!store || store.afterCommitCallbacks.length === 0) return [] as AfterDbCommitCallback[];
  const callbacks = [...store.afterCommitCallbacks];
  store.afterCommitCallbacks.length = 0;
  return callbacks;
}

export function createContextAwareDb<T extends object>(baseDb: T): T {
  return new Proxy(baseDb, {
    get(target, property, receiver) {
      const activeTarget = currentContextDb(target);
      const value = Reflect.get(activeTarget, property, receiver);
      return typeof value === "function" ? value.bind(activeTarget) : value;
    },
    has(target, property) {
      return Reflect.has(currentContextDb(target), property);
    },
    ownKeys(target) {
      return Reflect.ownKeys(currentContextDb(target));
    },
    getOwnPropertyDescriptor(target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(currentContextDb(target), property);
      if (descriptor) return descriptor;
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
}
