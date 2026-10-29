/**
 * Performance Operation 1: nonblocking assignment-registry hydration.
 *
 * The controller replaces the entry point's awaited hydration. These tests
 * drive it with controlled deferred promises to pin: readiness transitions,
 * once-per-generation enumeration, stale-response rejection BEFORE any
 * registry mutation (sign-out, account switch, same-user school change,
 * overlapping generations, out-of-order responses), lifecycle metadata
 * winning over a late enumeration, retry, and direct-entry metadata reads
 * that wait for a pending registry instead of reporting "not found".
 */
import { createAssignmentRegistryHydration } from "./hydration";
import type { AssignmentRegistryHydrationContext } from "./hydration";
import type { AssignmentsTeacherListCallable } from "./hydrate";
import { createAssignmentDetailRegistry } from "./registry";
import type { AssignmentDetailMetadata } from "./types";
import { AssignmentRegistryUnavailableError, createAssignmentDetailMetadataReader } from "./wire";

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (err: unknown) => void;
};

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const meta = (
  assignmentId: string,
  overrides: Partial<AssignmentDetailMetadata> = {},
): AssignmentDetailMetadata =>
  Object.freeze({
    assignmentId,
    title: `Title ${assignmentId}`,
    className: "6A",
    status: "published" as const,
    lessonSlug: "earths-layers",
    classId: "c1",
    ...overrides,
  });

type Items = ReadonlyArray<AssignmentDetailMetadata>;

// A scripted `assignmentsTeacherList`: every call returns a fresh deferred
// the test settles explicitly, in any order.
const scriptedList = () => {
  const calls: Array<Deferred<Items>> = [];
  const list: AssignmentsTeacherListCallable = jest.fn(() => {
    const d = deferred<Items>();
    calls.push(d);
    return d.promise;
  });
  return { list, calls };
};

// Mirrors the entry point: each bootstrap run takes the next token and is
// current only until another run begins.
const bootstrapModel = () => {
  let currentRunToken = 0;
  const begin = (uid: string, schoolId: string): AssignmentRegistryHydrationContext => {
    const runToken = ++currentRunToken;
    return {
      uid,
      schoolId,
      generation: runToken,
      isCurrent: () => runToken === currentRunToken,
    };
  };
  const beginNonTeacher = (): void => {
    currentRunToken += 1;
  };
  return { begin, beginNonTeacher };
};

const setup = () => {
  const registry = createAssignmentDetailRegistry();
  const hydration = createAssignmentRegistryHydration(registry);
  const { list, calls } = scriptedList();
  const boot = bootstrapModel();
  return { registry, hydration, list, calls, boot };
};

const ids = (items: Items): string[] => items.map((m) => m.assignmentId).sort();

describe("readiness transitions", () => {
  test("start returns synchronously and stays pending while enumeration never settles", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    const result = hydration.start(boot.begin("t1", "s1"), list);
    expect(result).toBeUndefined();
    expect(hydration.status()).toBe("pending");
    expect(calls).toHaveLength(1);
    await flush();
    await flush();
    expect(hydration.status()).toBe("pending");
    expect(registry.list()).toEqual([]);
  });

  test("successful hydration registers items, reads ready, notifies, and releases settled()", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    const seen: string[] = [];
    hydration.subscribe(() => seen.push(hydration.status()));
    let settled = false;
    void hydration.settled().then(() => {
      settled = true;
    });
    calls[0]!.resolve([meta("a1"), meta("a2", { status: "closed" }), meta("a3", { status: "draft" })]);
    await flush();
    expect(hydration.status()).toBe("ready");
    expect(ids(registry.list())).toEqual(["a1", "a2", "a3"]);
    expect(seen).toEqual(["ready"]);
    expect(settled).toBe(true);
  });

  test("successful EMPTY hydration reads ready (a genuine empty list), distinct from pending", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    expect(hydration.status()).toBe("pending");
    calls[0]!.resolve([]);
    await flush();
    expect(hydration.status()).toBe("ready");
    expect(registry.list()).toEqual([]);
  });

  test("failure reads unavailable and releases settled(); the registry is untouched", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    const waiting = hydration.settled();
    calls[0]!.reject(new Error("outage"));
    await expect(waiting).resolves.toBeUndefined();
    expect(hydration.status()).toBe("unavailable");
    expect(registry.list()).toEqual([]);
  });

  test("a synchronous throw from the callable is treated as a failure", async () => {
    const { hydration, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), () => {
      throw new Error("boom");
    });
    await flush();
    expect(hydration.status()).toBe("unavailable");
  });

  test("a throwing subscriber never breaks hydration or other subscribers", async () => {
    const { hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    const other = jest.fn();
    hydration.subscribe(() => {
      throw new Error("surface bug");
    });
    hydration.subscribe(other);
    calls[0]!.resolve([meta("a1")]);
    await flush();
    expect(hydration.status()).toBe("ready");
    expect(other).toHaveBeenCalledTimes(1);
  });
});

describe("recovery", () => {
  test("retry after failure re-requests once, passes through pending, then ready", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    calls[0]!.reject(new Error("outage"));
    await flush();
    const seen: string[] = [];
    hydration.subscribe(() => seen.push(hydration.status()));
    hydration.retry();
    expect(calls).toHaveLength(2);
    expect(hydration.status()).toBe("pending");
    // A second retry while pending is a no-op (no duplicate enumeration).
    hydration.retry();
    expect(calls).toHaveLength(2);
    calls[1]!.resolve([meta("a1")]);
    await flush();
    expect(seen).toEqual(["pending", "ready"]);
    expect(ids(registry.list())).toEqual(["a1"]);
    // Retry once ready is a no-op.
    hydration.retry();
    expect(calls).toHaveLength(2);
  });

  test("retry is refused once the bootstrap generation is no longer current", async () => {
    const { hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    calls[0]!.reject(new Error("outage"));
    await flush();
    boot.beginNonTeacher(); // a new rerun began; this teacher is not current
    hydration.retry();
    expect(calls).toHaveLength(1);
  });

  test("retry is a no-op with no teacher context", () => {
    const { hydration, list } = setup();
    hydration.retry();
    expect(list).not.toHaveBeenCalled();
    expect(hydration.status()).toBe("ready");
  });
});

describe("start() rejects an already-obsolete context", () => {
  test("no registry clear, context replacement, status change, notification, or enumeration", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    const active = boot.begin("tB", "s1");
    hydration.start(active, list);
    calls[0]!.resolve([meta("b1")]);
    await flush();
    const notified = jest.fn();
    hydration.subscribe(notified);
    const writeB = hydration.writer();

    // A context whose run was already superseded (built before B's run).
    const obsolete: AssignmentRegistryHydrationContext = {
      uid: "tA",
      schoolId: "s1",
      generation: 0,
      isCurrent: () => false,
    };
    hydration.start(obsolete, list);

    expect(list).toHaveBeenCalledTimes(1); // no enumeration
    expect(ids(registry.list())).toEqual(["b1"]); // registry not cleared
    expect(hydration.status()).toBe("ready"); // status unchanged
    expect(notified).not.toHaveBeenCalled(); // subscribers untouched
    // B's context is still the active one: its writer still works.
    expect(writeB(meta("b2"))).toBe(true);
    // And B's subscriber set was not cleared by the rejected start.
    hydration.retry();
    expect(notified).not.toHaveBeenCalled();
  });
});

describe("once per bootstrap generation", () => {
  test("a repeated start for the same generation (navigation, remount) never re-enumerates", async () => {
    const { hydration, list, calls, boot } = setup();
    const ctx = boot.begin("t1", "s1");
    hydration.start(ctx, list);
    hydration.start(ctx, list);
    hydration.start({ ...ctx }, list);
    expect(list).toHaveBeenCalledTimes(1);
    calls[0]!.resolve([]);
    await flush();
    hydration.start(ctx, list);
    expect(list).toHaveBeenCalledTimes(1);
  });

  test("reads, subscriptions, and settled() never trigger enumeration", async () => {
    const { hydration, list, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    hydration.status();
    void hydration.settled();
    const off = hydration.subscribe(() => undefined);
    off();
    expect(list).toHaveBeenCalledTimes(1);
  });
});

describe("stale responses never mutate the active registry", () => {
  test("sign-out during hydration: the late response is discarded and the registry stays empty", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    let settled = false;
    void hydration.settled().then(() => {
      settled = true;
    });
    boot.beginNonTeacher();
    hydration.reset();
    await flush();
    expect(settled).toBe(true);
    calls[0]!.resolve([meta("a1")]);
    await flush();
    expect(registry.list()).toEqual([]);
    expect(hydration.status()).toBe("ready");
  });

  test("a response landing after a new rerun began but BEFORE it reached start is discarded", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    boot.beginNonTeacher(); // rerun is still resolving its session
    calls[0]!.resolve([meta("a1")]);
    await flush();
    expect(registry.list()).toEqual([]);
    expect(hydration.status()).toBe("pending");
  });

  test("account switch: the new teacher never sees the previous teacher's rows, early or late", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    calls[0]!.resolve([meta("t1-a")]);
    await flush();
    expect(ids(registry.list())).toEqual(["t1-a"]);
    // A second t1 generation still in flight when the account switches.
    hydration.start(boot.begin("t1", "s1"), list);
    hydration.start(boot.begin("t2", "s1"), list);
    expect(registry.list()).toEqual([]);
    expect(hydration.status()).toBe("pending");
    calls[1]!.resolve([meta("t1-late")]);
    await flush();
    expect(registry.list()).toEqual([]);
    calls[2]!.resolve([meta("t2-a")]);
    await flush();
    expect(ids(registry.list())).toEqual(["t2-a"]);
  });

  test("same user, school change: the old school's rows are cleared and its late response discarded", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "schoolA"), list);
    hydration.start(boot.begin("t1", "schoolB"), list);
    calls[1]!.resolve([meta("b1")]);
    await flush();
    calls[0]!.resolve([meta("a1")]);
    await flush();
    expect(ids(registry.list())).toEqual(["b1"]);
    expect(hydration.status()).toBe("ready");
  });

  test("overlapping generations resolving out of order: only the newest applies", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    hydration.start(boot.begin("t1", "s1"), list);
    hydration.start(boot.begin("t1", "s1"), list);
    calls[2]!.resolve([meta("gen3")]);
    await flush();
    calls[0]!.resolve([meta("gen1")]);
    calls[1]!.reject(new Error("late failure"));
    await flush();
    expect(ids(registry.list())).toEqual(["gen3"]);
    expect(hydration.status()).toBe("ready");
  });

  test("a stale FAILURE never flips the current generation to unavailable", async () => {
    const { hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    hydration.start(boot.begin("t1", "s1"), list);
    calls[0]!.reject(new Error("old"));
    await flush();
    expect(hydration.status()).toBe("pending");
  });

  test("subscribers from a previous generation are dropped when a new one starts", async () => {
    const { hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    const old = jest.fn();
    hydration.subscribe(old);
    hydration.start(boot.begin("t2", "s1"), list);
    calls[1]!.resolve([]);
    await flush();
    expect(old).not.toHaveBeenCalled();
  });
});

describe("late hydration versus newer lifecycle metadata", () => {
  test("publish, close, reopen, and draft edits made during hydration survive the late response", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    // In-session lifecycle writes while enumeration is still pending.
    hydration.writer()(meta("draft-published", { status: "published", publishedAt: 9 }));
    hydration.writer()(meta("closed-now", { status: "closed" }));
    hydration.writer()(meta("reopened", { status: "published" }));
    hydration.writer()(meta("draft-edited", { status: "draft", title: "New title" }));
    hydration.writer()(meta("brand-new"));
    // The enumeration snapshot predates those writes.
    calls[0]!.resolve([
      meta("draft-published", { status: "draft" }),
      meta("closed-now", { status: "published" }),
      meta("reopened", { status: "closed" }),
      meta("draft-edited", { status: "draft", title: "Old title" }),
      meta("history-only", { status: "closed" }),
    ]);
    await flush();
    expect(registry.lookup("draft-published")?.status).toBe("published");
    expect(registry.lookup("draft-published")?.publishedAt).toBe(9);
    expect(registry.lookup("closed-now")?.status).toBe("closed");
    expect(registry.lookup("reopened")?.status).toBe("published");
    expect(registry.lookup("draft-edited")?.title).toBe("New title");
    expect(registry.lookup("brand-new")).not.toBeNull();
    // Assignment history the lifecycle path never touched still hydrates.
    expect(registry.lookup("history-only")?.status).toBe("closed");
  });

  test("lifecycle metadata also wins over a retried enumeration in the same generation", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    calls[0]!.reject(new Error("outage"));
    await flush();
    hydration.writer()(meta("a1", { status: "closed" }));
    hydration.retry();
    calls[1]!.resolve([meta("a1", { status: "published" })]);
    await flush();
    expect(registry.lookup("a1")?.status).toBe("closed");
  });

  test("a later lifecycle write after hydration still supersedes (latest write wins)", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    calls[0]!.resolve([meta("a1", { status: "published" })]);
    await flush();
    hydration.writer()(meta("a1", { status: "closed" }));
    expect(registry.lookup("a1")?.status).toBe("closed");
  });

  test("a new generation starts from the server's view, not the previous generation's writes", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    hydration.writer()(meta("a1", { status: "closed" }));
    hydration.start(boot.begin("t1", "s1"), list);
    expect(registry.lookup("a1")).toBeNull();
    calls[1]!.resolve([meta("a1", { status: "closed" })]);
    await flush();
    expect(registry.lookup("a1")?.status).toBe("closed");
  });
});

describe("lifecycle writers are bound to their originating context", () => {
  test("a write that began under teacher A and completes after a switch to B never enters B's registry", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("tA", "s1"), list);
    calls[0]!.resolve([]);
    await flush();
    // Captured before the asynchronous publish begins.
    const writeA = hydration.writer();
    hydration.start(boot.begin("tB", "s1"), list);
    expect(writeA(meta("a-from-A"))).toBe(false);
    expect(registry.lookup("a-from-A")).toBeNull();
    // Nor does it poison B's conflict tracking: B's enumeration of the same
    // id still applies.
    calls[1]!.resolve([meta("a-from-A", { classId: "b-class" })]);
    await flush();
    expect(registry.lookup("a-from-A")?.classId).toBe("b-class");
  });

  test("rejected immediately after bootstrap invalidation, before the new run installs its context", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("tA", "s1"), list);
    calls[0]!.resolve([meta("seed")]);
    await flush();
    const writeA = hydration.writer();
    // Generation B begins (sign-out / switch / re-bootstrap) and is still
    // resolving its session: no start() or reset() has run yet, so the
    // controller still holds A's context object.
    boot.begin("tB", "s1");
    expect(writeA(meta("late-from-A"))).toBe(false);
    expect(registry.lookup("late-from-A")).toBeNull();
    expect(ids(registry.list())).toEqual(["seed"]);
    expect(hydration.status()).toBe("ready");
    // B installs its own context; its writers work, A's stay rejected.
    hydration.start(boot.begin("tB", "s1"), list);
    expect(writeA(meta("late-from-A"))).toBe(false);
    expect(hydration.writer()(meta("b1"))).toBe(true);
    expect(ids(registry.list())).toEqual(["b1"]);
  });

  test("a rejected write leaves conflict tracking untouched", async () => {
    const { registry, hydration, list, calls } = setup();
    // A controllable generation so the probe can observe tracking directly.
    let current = true;
    hydration.start({ uid: "t1", schoolId: "s1", generation: 1, isCurrent: () => current }, list);
    const write = hydration.writer();
    current = false;
    expect(write(meta("a1", { status: "closed" }))).toBe(false);
    // Probe: were the id tracked, this enumeration entry would be skipped.
    current = true;
    calls[0]!.resolve([meta("a1", { status: "published" })]);
    await flush();
    expect(registry.lookup("a1")?.status).toBe("published");
    // A valid same-generation write is still accepted and wins later.
    expect(write(meta("a1", { status: "closed" }))).toBe(true);
    expect(registry.lookup("a1")?.status).toBe("closed");
  });

  test("same user, school change: a school-A completion is rejected in school B", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "schoolA"), list);
    const writeA = hydration.writer();
    hydration.start(boot.begin("t1", "schoolB"), list);
    calls[1]!.resolve([]);
    await flush();
    expect(writeA(meta("x"))).toBe(false);
    expect(registry.list()).toEqual([]);
  });

  test("overlapping generations of the same teacher and school: the older writer is rejected", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    const writeGen1 = hydration.writer();
    hydration.start(boot.begin("t1", "s1"), list);
    const writeGen2 = hydration.writer();
    expect(writeGen1(meta("old", { status: "closed" }))).toBe(false);
    expect(writeGen2(meta("new"))).toBe(true);
    // gen2's enumeration still applies "old" (its tracking was not touched
    // by the rejected gen1 write) and keeps gen2's own lifecycle write.
    calls[1]!.resolve([meta("old", { status: "published" }), meta("new", { status: "draft" })]);
    await flush();
    expect(registry.lookup("old")?.status).toBe("published");
    expect(registry.lookup("new")?.status).toBe("published");
  });

  test("sign-out rejects a pending completion; a writer created after sign-in works", async () => {
    const { registry, hydration, list, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    const before = hydration.writer();
    boot.beginNonTeacher();
    hydration.reset();
    expect(before(meta("a1"))).toBe(false);
    hydration.start(boot.begin("t1", "s1"), list);
    expect(before(meta("a1"))).toBe(false);
    expect(registry.list()).toEqual([]);
    expect(hydration.writer()(meta("a2"))).toBe(true);
    expect(ids(registry.list())).toEqual(["a2"]);
  });

  test("a writer stays valid across a retry within its own generation", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    const write = hydration.writer();
    calls[0]!.reject(new Error("outage"));
    await flush();
    hydration.retry();
    expect(write(meta("a1", { status: "closed" }))).toBe(true);
    calls[1]!.resolve([meta("a1", { status: "published" })]);
    await flush();
    expect(registry.lookup("a1")?.status).toBe("closed");
  });
});

describe("direct-entry assignment restoration (metadata reader)", () => {
  test("a Detail opened before hydration lands waits for it instead of reading 'not found'", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    const read = createAssignmentDetailMetadataReader(registry, hydration.readiness);
    let result: AssignmentDetailMetadata | null | "unresolved" = "unresolved";
    void read({ assignmentId: "a1" }).then((m) => {
      result = m;
    });
    await flush();
    expect(result).toBe("unresolved");
    calls[0]!.resolve([meta("a1")]);
    await flush();
    expect(result).toEqual(meta("a1"));
  });

  test("a hit resolves immediately even while pending", async () => {
    const { registry, hydration, list, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    hydration.writer()(meta("a1"));
    const read = createAssignmentDetailMetadataReader(registry, hydration.readiness);
    await expect(read({ assignmentId: "a1" })).resolves.toEqual(meta("a1"));
  });

  test("an unknown id after a successful load resolves null (genuine not-found)", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    const read = createAssignmentDetailMetadataReader(registry, hydration.readiness);
    const pendingRead = read({ assignmentId: "missing" });
    calls[0]!.resolve([meta("a1")]);
    await expect(pendingRead).resolves.toBeNull();
    await expect(read({ assignmentId: "missing" })).resolves.toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
  });

  test("a failed load rejects (never 'not found'); the next read retries enumeration and recovers", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    const read = createAssignmentDetailMetadataReader(registry, hydration.readiness);
    const first = read({ assignmentId: "a1" });
    calls[0]!.reject(new Error("outage"));
    await expect(first).rejects.toBeInstanceOf(AssignmentRegistryUnavailableError);
    // Detail's Try again re-runs the reader: it re-requests enumeration.
    const second = read({ assignmentId: "a1" });
    expect(list).toHaveBeenCalledTimes(2);
    calls[1]!.resolve([meta("a1")]);
    await expect(second).resolves.toEqual(meta("a1"));
  });

  test("a retried load that fails again still rejects; one that succeeds without the id is not-found", async () => {
    const { registry, hydration, list, calls, boot } = setup();
    hydration.start(boot.begin("t1", "s1"), list);
    const read = createAssignmentDetailMetadataReader(registry, hydration.readiness);
    const first = read({ assignmentId: "a1" });
    calls[0]!.reject(new Error("outage"));
    await expect(first).rejects.toBeInstanceOf(AssignmentRegistryUnavailableError);
    const second = read({ assignmentId: "a1" });
    calls[1]!.reject(new Error("outage again"));
    await expect(second).rejects.toBeInstanceOf(AssignmentRegistryUnavailableError);
    const third = read({ assignmentId: "a1" });
    calls[2]!.resolve([]);
    await expect(third).resolves.toBeNull();
  });

  test("without readiness the reader keeps the certified synchronous-lookup behavior", async () => {
    const registry = createAssignmentDetailRegistry();
    const read = createAssignmentDetailMetadataReader(registry);
    await expect(read({ assignmentId: "a1" })).resolves.toBeNull();
    registry.register(meta("a1"));
    await expect(read({ assignmentId: "a1" })).resolves.toEqual(meta("a1"));
  });
});
