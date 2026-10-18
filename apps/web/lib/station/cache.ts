/** Tiny per-instance TTL cache for a loader. Empty results are not cached so a pool that appears later is picked up at once. */
export function ttlCache<T extends unknown[]>(load: () => Promise<T>, ttlMs: number, now: () => number = Date.now) {
  let value: T | null = null;
  let at = 0;
  let inflight: Promise<T> | null = null;
  return async (): Promise<T> => {
    if (value && now() - at < ttlMs) return value;
    // Concurrent callers share one load instead of each hitting the database.
    inflight ??= load()
      .then((v) => {
        if (v.length > 0) { value = v; at = now(); }
        return v;
      })
      .finally(() => { inflight = null; });
    return inflight;
  };
}
