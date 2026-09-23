interface MemoEntry<Value> {
  storedAt: number;
  value: Promise<Value>;
}

export interface Memo<Value> {
  get(key: string, load: () => Promise<Value>): Promise<Value>;
  delete(key: string): void;
  clear(): void;
}

/** Caches a loader per key for a while; concurrent callers share one pending load. */
export function createMemo<Value>(ttlMs: number): Memo<Value> {
  const entries = new Map<string, MemoEntry<Value>>();
  return {
    get(key, load) {
      const entry = entries.get(key);
      if (entry !== undefined && Date.now() - entry.storedAt < ttlMs) return entry.value;
      const value = load();
      entries.set(key, { storedAt: Date.now(), value });
      // A failed load must not be served from the cache.
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });
      return value;
    },
    delete(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
  };
}
