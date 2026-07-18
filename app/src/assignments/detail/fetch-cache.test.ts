import { createDetailFetchCache } from "./fetch-cache";

describe("DetailFetchCache", () => {
  test("deduplicates concurrent identical requests to a single in-flight promise", async () => {
    const cache = createDetailFetchCache();
    let calls = 0;
    const factory = (): Promise<number> => {
      calls += 1;
      return Promise.resolve(calls);
    };
    const a = cache.get("k", factory);
    const b = cache.get("k", factory);
    expect(a).toBe(b);
    await Promise.all([a, b]);
    expect(calls).toBe(1);
  });

  test("returns the same resolved value to every consumer", async () => {
    const cache = createDetailFetchCache();
    const factory = (): Promise<{ v: number }> => Promise.resolve({ v: 42 });
    const [a, b, c] = await Promise.all([
      cache.get("k", factory),
      cache.get("k", factory),
      cache.get("k", factory),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).toEqual({ v: 42 });
  });

  test("distinct keys resolve independently", async () => {
    const cache = createDetailFetchCache();
    let a = 0;
    let b = 0;
    await Promise.all([
      cache.get("a", () => {
        a += 1;
        return Promise.resolve("a");
      }),
      cache.get("b", () => {
        b += 1;
        return Promise.resolve("b");
      }),
    ]);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  test("invalidate causes the next get to issue a fresh call", async () => {
    const cache = createDetailFetchCache();
    let calls = 0;
    const factory = (): Promise<number> => {
      calls += 1;
      return Promise.resolve(calls);
    };
    await cache.get("k", factory);
    cache.invalidate();
    await cache.get("k", factory);
    expect(calls).toBe(2);
  });

  test("rejected shared request is surfaced to every consumer and evicted", async () => {
    const cache = createDetailFetchCache();
    let calls = 0;
    const failing = (): Promise<number> => {
      calls += 1;
      return Promise.reject(new Error("boom"));
    };
    const a = cache.get("k", failing);
    const b = cache.get("k", failing);
    await expect(a).rejects.toThrow("boom");
    await expect(b).rejects.toThrow("boom");
    expect(calls).toBe(1);
    // Eviction: a subsequent get after failure issues a fresh call.
    await cache.get("k", () => Promise.resolve(99));
    expect(calls).toBe(1);
  });

  test("rejection does not produce an unhandled rejection when a second consumer attaches synchronously", async () => {
    const cache = createDetailFetchCache();
    const a = cache.get("k", () => Promise.reject(new Error("x")));
    const b = cache.get("k", () => Promise.reject(new Error("x")));
    // Both consumers attach handlers before the microtask queue drains.
    const results = await Promise.allSettled([a, b]);
    expect(results[0]?.status).toBe("rejected");
    expect(results[1]?.status).toBe("rejected");
  });
});
