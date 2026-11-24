// EXPERIMENT (E1b): cut database writes on the read path.
// - Read rate limits ("r:" keys) live in instance memory: they only need to stop floods, not be exact.
// - Visit counters are buffered and flushed in one batch every 25 hits or 20 seconds.
// Everything else passes through to the real store.
import type { Store } from "./store.ts";

export function buffered(inner: Store, opts: { flushEvery?: number; flushMs?: number } = {}): Store & { flush(): Promise<void> } {
  const flushEvery = opts.flushEvery ?? 25;
  const flushMs = opts.flushMs ?? 20_000;
  const visits = new Map<string, number>();
  let pending = 0;
  let lastFlush = Date.now();
  const mem = new Map<string, { count: number; resetAt: number }>();

  async function flush() {
    if (!visits.size) return;
    const batch = Array.from(visits.entries());
    visits.clear();
    pending = 0;
    lastFlush = Date.now();
    for (const [k, n] of batch) {
      const [day, channel, client] = k.split("|");
      await inner.trackVisit(day, channel, client, n); // one upsert per key per batch
    }
  }

  const wrapper = Object.create(inner) as Store & { flush(): Promise<void> };
  wrapper.flush = flush;
  wrapper.trackVisit = async (day, channel, client) => {
    const k = `${day}|${channel}|${client}`;
    visits.set(k, (visits.get(k) ?? 0) + 1);
    pending++;
    if (pending >= flushEvery || Date.now() - lastFlush > flushMs) await flush();
  };
  wrapper.hitRateLimit = async (key, windowSeconds, max) => {
    if (!key.startsWith("r:")) return inner.hitRateLimit(key, windowSeconds, max);
    const now = Date.now();
    const r = mem.get(key);
    if (!r || r.resetAt <= now) {
      mem.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return true;
    }
    r.count++;
    return r.count <= max;
  };
  return wrapper;
}
