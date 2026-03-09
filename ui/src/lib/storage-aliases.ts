export function readStorageAlias(primaryKey: string, legacyKey?: string): string | null {
  try {
    const primaryValue = localStorage.getItem(primaryKey);
    if (primaryValue !== null) return primaryValue;
    if (!legacyKey) return null;
    const legacyValue = localStorage.getItem(legacyKey);
    if (legacyValue !== null) {
      localStorage.setItem(primaryKey, legacyValue);
    }
    return legacyValue;
  } catch {
    return null;
  }
}

export function writeStorageAlias(primaryKey: string, legacyKey: string | undefined, value: string) {
  try {
    localStorage.setItem(primaryKey, value);
    if (legacyKey && legacyKey !== primaryKey) {
      localStorage.removeItem(legacyKey);
    }
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}

export function removeStorageAlias(primaryKey: string, legacyKey?: string) {
  try {
    localStorage.removeItem(primaryKey);
    if (legacyKey && legacyKey !== primaryKey) {
      localStorage.removeItem(legacyKey);
    }
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}

export function readJsonStorageAlias<T>(
  primaryKey: string,
  legacyKey: string | undefined,
  fallback: T,
): T {
  const raw = readStorageAlias(primaryKey, legacyKey);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonStorageAlias(
  primaryKey: string,
  legacyKey: string | undefined,
  value: unknown,
) {
  writeStorageAlias(primaryKey, legacyKey, JSON.stringify(value));
}
