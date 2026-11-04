import { createSaveCoordinator } from "./saveCoordinator";
import type { SaveStatus } from "./saveCoordinator";
import type { SessionResponse } from "./types";

// Student autosave reliability: the page save queue in isolation, with a
// controllable fake backend and fake timers.

type Sent = { responses: readonly SessionResponse[]; writtenResponse: string | undefined };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const transient = () => Object.assign(new Error("offline"), { code: "functions/unavailable" });
const permanent = () => Object.assign(new Error("denied"), { code: "functions/permission-denied" });

function harness(opts: { retryDelaysMs?: number[] } = {}) {
  const sent: Sent[] = [];
  const statuses: SaveStatus[] = [];
  const pending: Array<ReturnType<typeof deferred<{ persisted: boolean }>>> = [];
  let auto: "ack" | "manual" = "ack";
  let failNext: Array<() => Error> = [];
  const coordinator = createSaveCoordinator({
    send: (responses, writtenResponse) => {
      sent.push({ responses, writtenResponse });
      const fail = failNext.shift();
      if (fail !== undefined) return Promise.reject(fail());
      if (auto === "ack") return Promise.resolve({ persisted: true });
      const d = deferred<{ persisted: boolean }>();
      pending.push(d);
      return d.promise;
    },
    isPermanentFailure: (err) => (err as { code?: string }).code === "functions/permission-denied",
    onStatus: (s) => statuses.push(s),
    textDebounceMs: 1000,
    retryDelaysMs: opts.retryDelaysMs ?? [100, 200],
  });
  return {
    coordinator,
    sent,
    statuses,
    pending,
    manual: () => {
      auto = "manual";
    },
    failWith: (...errs: Array<() => Error>) => {
      failNext = errs;
    },
  };
}

const r = (...pairs: Array<[string, string]>): SessionResponse[] =>
  pairs.map(([itemId, response]) => ({ itemId, response }));

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("save status transitions", () => {
  test("Saved only after the backend acknowledges the latest change", async () => {
    const h = harness();
    h.manual();
    void h.coordinator.setResponses(r(["q1", "A"]));
    expect(h.coordinator.getStatus()).toBe("saving");
    h.pending[0]!.resolve({ persisted: true });
    await jest.advanceTimersByTimeAsync(0);
    expect(h.coordinator.getStatus()).toBe("saved");
    expect(h.coordinator.hasUnsavedChanges()).toBe(false);
  });

  test("a change made while a write is in flight keeps the status off Saved", async () => {
    const h = harness();
    h.manual();
    void h.coordinator.setResponses(r(["q1", "A"]));
    void h.coordinator.setResponses(r(["q1", "A"], ["q2", "B"]));
    h.pending[0]!.resolve({ persisted: true });
    await jest.advanceTimersByTimeAsync(0);
    // The first ack does not cover the second change.
    expect(h.coordinator.getStatus()).toBe("saving");
    expect(h.statuses).not.toContain("saved");
    h.pending[1]!.resolve({ persisted: true });
    await jest.advanceTimersByTimeAsync(0);
    expect(h.coordinator.getStatus()).toBe("saved");
  });

  test("debounced text is pending (unsaved) until it is sent and acknowledged", async () => {
    const h = harness();
    h.coordinator.setWrittenResponse("Mass over volume");
    expect(h.coordinator.getStatus()).toBe("pending");
    expect(h.coordinator.hasUnsavedChanges()).toBe(true);
    expect(h.sent).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1000);
    expect(h.sent).toEqual([{ responses: [], writtenResponse: "Mass over volume" }]);
    expect(h.coordinator.getStatus()).toBe("saved");
  });
});

describe("ordering: newer work is never overwritten by older saves", () => {
  test("one write at a time; queued changes collapse to the latest state", async () => {
    const h = harness();
    h.manual();
    void h.coordinator.setResponses(r(["q1", "A"]));
    void h.coordinator.setResponses(r(["q1", "B"]));
    void h.coordinator.setResponses(r(["q1", "C"]));
    expect(h.sent).toHaveLength(1);
    h.pending[0]!.resolve({ persisted: true });
    await jest.advanceTimersByTimeAsync(0);
    // The two queued changes go out as ONE write of the newest state.
    expect(h.sent.map((s) => s.responses)).toEqual([r(["q1", "A"]), r(["q1", "C"])]);
    h.pending[1]!.resolve({ persisted: true });
    await jest.advanceTimersByTimeAsync(0);
    expect(h.sent).toHaveLength(2);
  });

  test("a late acknowledgment of an older write never marks newer work saved", async () => {
    const h = harness();
    h.manual();
    void h.coordinator.setResponses(r(["q1", "A"]));
    h.coordinator.setWrittenResponse("draft");
    h.pending[0]!.resolve({ persisted: true });
    await jest.advanceTimersByTimeAsync(0);
    expect(h.coordinator.hasUnsavedChanges()).toBe(true);
    expect(h.coordinator.getStatus()).not.toBe("saved");
  });
});

describe("answers and written response are saved together", () => {
  test("an answer save carries the latest text; a text save carries the latest answers", async () => {
    const h = harness();
    h.coordinator.setWrittenResponse("first idea");
    // The answer arrives before the debounce: it carries the text too.
    void h.coordinator.setResponses(r(["q1", "A"]));
    await jest.advanceTimersByTimeAsync(0);
    expect(h.sent).toEqual([{ responses: r(["q1", "A"]), writtenResponse: "first idea" }]);
    h.coordinator.setWrittenResponse("better idea");
    await jest.advanceTimersByTimeAsync(1000);
    expect(h.sent[1]).toEqual({ responses: r(["q1", "A"]), writtenResponse: "better idea" });
    void h.coordinator.setResponses(r(["q1", "A"], ["q2", "D"]));
    await jest.advanceTimersByTimeAsync(0);
    expect(h.sent[2]).toEqual({ responses: r(["q1", "A"], ["q2", "D"]), writtenResponse: "better idea" });
  });

  test("unknown text is never sent, so it cannot erase saved text", async () => {
    const h = harness();
    void h.coordinator.setResponses(r(["q1", "A"]));
    await jest.advanceTimersByTimeAsync(0);
    expect(h.sent[0]!.writtenResponse).toBeUndefined();
  });

  test("restored text is adopted without a write and then rides later saves", async () => {
    const h = harness();
    h.coordinator.adoptWrittenResponse("restored");
    expect(h.sent).toHaveLength(0);
    expect(h.coordinator.hasUnsavedChanges()).toBe(false);
    void h.coordinator.setResponses(r(["q3", "B"]));
    await jest.advanceTimersByTimeAsync(0);
    expect(h.sent[0]).toEqual({ responses: r(["q3", "B"]), writtenResponse: "restored" });
  });
});

describe("transient failures: bounded retry", () => {
  test("retries with backoff, then saves", async () => {
    const h = harness();
    h.failWith(transient);
    const outcome = h.coordinator.setResponses(r(["q1", "A"]));
    await jest.advanceTimersByTimeAsync(0);
    // The caller learns about the failed first write; the retry continues.
    await expect(outcome).resolves.toBeNull();
    expect(h.coordinator.getStatus()).toBe("retrying");
    await jest.advanceTimersByTimeAsync(100);
    expect(h.sent).toHaveLength(2);
    expect(h.coordinator.getStatus()).toBe("saved");
  });

  test("stops after the retry budget and reports Not saved; the next change retries", async () => {
    const h = harness();
    h.failWith(transient, transient, transient);
    void h.coordinator.setResponses(r(["q1", "A"]));
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(100);
    await jest.advanceTimersByTimeAsync(200);
    expect(h.sent).toHaveLength(3);
    expect(h.coordinator.getStatus()).toBe("failed");
    // No unbounded loop: nothing more is sent on its own.
    await jest.advanceTimersByTimeAsync(60_000);
    expect(h.sent).toHaveLength(3);
    // The next change sends the full latest state.
    void h.coordinator.setResponses(r(["q1", "A"], ["q2", "C"]));
    await jest.advanceTimersByTimeAsync(0);
    expect(h.sent[3]!.responses).toEqual(r(["q1", "A"], ["q2", "C"]));
    expect(h.coordinator.getStatus()).toBe("saved");
  });

  test("retryNow sends immediately after a failure", async () => {
    const h = harness();
    h.failWith(transient, transient, transient);
    void h.coordinator.setResponses(r(["q1", "A"]));
    await jest.advanceTimersByTimeAsync(300);
    expect(h.coordinator.getStatus()).toBe("failed");
    h.coordinator.retryNow();
    await jest.advanceTimersByTimeAsync(0);
    expect(h.coordinator.getStatus()).toBe("saved");
  });
});

describe("permanent failures", () => {
  test("block further writes and keep the page state", async () => {
    const h = harness();
    h.failWith(permanent);
    void h.coordinator.setResponses(r(["q1", "A"]));
    await jest.advanceTimersByTimeAsync(0);
    expect(h.coordinator.getStatus()).toBe("blocked");
    await expect(h.coordinator.setResponses(r(["q1", "A"], ["q2", "B"]))).resolves.toBeNull();
    h.coordinator.setWrittenResponse("still typing");
    await jest.advanceTimersByTimeAsync(10_000);
    expect(h.sent).toHaveLength(1);
    expect(h.coordinator.getStatus()).toBe("blocked");
    expect(h.coordinator.hasUnsavedChanges()).toBe(true);
  });
});

describe("submission and new attempts", () => {
  test("pause waits for the in-flight write and holds new ones until resume", async () => {
    const h = harness();
    h.manual();
    void h.coordinator.setResponses(r(["q1", "A"]));
    let paused = false;
    void h.coordinator.pause().then(() => {
      paused = true;
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(paused).toBe(false);
    h.pending[0]!.resolve({ persisted: true });
    await jest.advanceTimersByTimeAsync(0);
    expect(paused).toBe(true);
    void h.coordinator.setResponses(r(["q1", "B"]));
    expect(h.sent).toHaveLength(1);
    h.coordinator.resume();
    expect(h.sent).toHaveLength(2);
  });

  test("a new attempt forgets the previous attempt's text", async () => {
    const h = harness();
    h.coordinator.setWrittenResponse("attempt one");
    await jest.advanceTimersByTimeAsync(1000);
    h.coordinator.resetForNewAttempt();
    void h.coordinator.setResponses(r(["q1", "D"]));
    await jest.advanceTimersByTimeAsync(0);
    expect(h.sent.at(-1)).toEqual({ responses: r(["q1", "D"]), writtenResponse: undefined });
  });

  test("flush sends debounced text at once (page hide)", async () => {
    const h = harness();
    h.coordinator.setWrittenResponse("leaving now");
    h.coordinator.flush();
    await jest.advanceTimersByTimeAsync(0);
    expect(h.sent).toEqual([{ responses: [], writtenResponse: "leaving now" }]);
  });
});
