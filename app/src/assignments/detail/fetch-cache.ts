// Sprint 16 Slice 2: per-render fetch deduplication for the Assignment
// Detail surface. Multiple sub-panels on the same render share the same
// in-flight or resolved value per `(callable, keyString)` pair so a
// single Detail render never issues the same callable twice for the
// same input.
//
// The cache holds only Promise references. It stores no callable
// response payload beyond what the underlying Promise already resolves
// to and it is not persisted across the current Detail render lifetime.
// A rejected shared request is evicted so a subsequent retry can issue
// a fresh call rather than replaying the previous failure.

export type DetailFetchCache = {
  readonly get: <T>(key: string, factory: () => Promise<T>) => Promise<T>;
  readonly invalidate: () => void;
};

export function createDetailFetchCache(): DetailFetchCache {
  const entries = new Map<string, Promise<unknown>>();
  return Object.freeze({
    get: <T>(key: string, factory: () => Promise<T>): Promise<T> => {
      const existing = entries.get(key);
      if (existing !== undefined) return existing as Promise<T>;
      const created = factory().catch((err) => {
        if (entries.get(key) === created) entries.delete(key);
        throw err;
      });
      entries.set(key, created);
      return created as Promise<T>;
    },
    invalidate: (): void => {
      entries.clear();
    },
  });
}
