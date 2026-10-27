import {
  ASSESSMENT_REVISION_MISMATCH_MESSAGE,
  ATTEMPT_ALREADY_SUBMITTED_MESSAGE,
  AttemptAlreadySubmittedError,
  createAssessmentRuntime,
} from "./orchestrator";
import type {
  AttemptSummary,
  FinalizeResult,
  RuntimeCallables,
  SessionResponse,
} from "./types";

// Sprint 17 Slice 5 orchestrator tests. The orchestrator is driven
// against in-memory callable fakes so every lifecycle transition is
// observed without going through Firebase. Confidentiality invariants
// (no ownership identifiers, no answer keys, no teacher fields, no
// backend identifiers exposed unnecessarily) are enforced by the type
// system on RuntimeCallables and RuntimeStatus.

const FINALIZE_RESULT: FinalizeResult = Object.freeze({
  attemptId: "asg-1__student-1__a1",
  attemptNumber: 1,
  score: 8,
  maxScore: 10,
  percentage: 80,
  itemResults: Object.freeze([]),
  replay: false,
});

const ATTEMPT_SUMMARY: AttemptSummary = Object.freeze({
  attemptId: "asg-1__student-1__a1",
  attemptNumber: 1,
  score: 8,
  maxScore: 10,
  percentage: 80,
  itemResults: Object.freeze([]),
});

type CallableSpy = {
  callables: RuntimeCallables;
  beginCalls: string[];
  autosaveCalls: Array<{ sessionId: string; responses: readonly SessionResponse[] }>;
  finalizeCalls: Array<{ sessionId: string; idempotencyKey: string }>;
  getAttemptCalls: string[];
};

function makeCallables(overrides: Partial<{
  beginResponse: () => Promise<{ sessionId: string; alreadyLive: boolean }>;
  autosaveResponse: () => Promise<{ persisted: boolean }>;
  finalizeResponse: () => Promise<FinalizeResult>;
  getAttemptResponse: () => Promise<AttemptSummary>;
}> = {}): CallableSpy {
  const beginCalls: string[] = [];
  const autosaveCalls: Array<{ sessionId: string; responses: readonly SessionResponse[] }> = [];
  const finalizeCalls: Array<{ sessionId: string; idempotencyKey: string }> = [];
  const getAttemptCalls: string[] = [];
  const callables: RuntimeCallables = {
    begin: async (assignmentId) => {
      beginCalls.push(assignmentId);
      if (overrides.beginResponse) return overrides.beginResponse();
      return { sessionId: `sess-${assignmentId}`, alreadyLive: false };
    },
    autosave: async (sessionId, responses) => {
      autosaveCalls.push({ sessionId, responses });
      if (overrides.autosaveResponse) return overrides.autosaveResponse();
      return { persisted: true };
    },
    finalize: async (sessionId, idempotencyKey) => {
      finalizeCalls.push({ sessionId, idempotencyKey });
      if (overrides.finalizeResponse) return overrides.finalizeResponse();
      return FINALIZE_RESULT;
    },
    getAttempt: async (attemptId) => {
      getAttemptCalls.push(attemptId);
      if (overrides.getAttemptResponse) return overrides.getAttemptResponse();
      return ATTEMPT_SUMMARY;
    },
  };
  return { callables, beginCalls, autosaveCalls, finalizeCalls, getAttemptCalls };
}

let idCounter = 0;
const env = { randomId: () => `idk-${++idCounter}` };
beforeEach(() => {
  idCounter = 0;
});

describe("createAssessmentRuntime - standalone (inert)", () => {
  test("without assignment context, mode stays inert and no callable runs", async () => {
    const spy = makeCallables();
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: null,
      callables: spy.callables,
      env,
    });
    expect(runtime.hasAssignmentContext).toBe(false);
    expect(runtime.getStatus()).toEqual({ mode: "inert", hasAssignmentContext: false });
    await runtime.begin();
    const auto = await runtime.autosave([{ itemId: "q1", response: "A" }]);
    expect(auto).toEqual({ persisted: false });
    expect(spy.beginCalls).toHaveLength(0);
    expect(spy.autosaveCalls).toHaveLength(0);
    expect(spy.finalizeCalls).toHaveLength(0);
  });

  test("finalize refuses in standalone mode", async () => {
    const spy = makeCallables();
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: null,
      callables: spy.callables,
      env,
    });
    await expect(runtime.finalize([])).rejects.toThrow(/inert/);
    expect(spy.finalizeCalls).toHaveLength(0);
  });

  test("empty-string assignmentId collapses to inert", async () => {
    const spy = makeCallables();
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: "",
      callables: spy.callables,
      env,
    });
    expect(runtime.hasAssignmentContext).toBe(false);
    await runtime.begin();
    expect(spy.beginCalls).toHaveLength(0);
  });
});

describe("createAssessmentRuntime - session begin", () => {
  test("assignment mode calls begin exactly once even under concurrent callers", async () => {
    const spy = makeCallables();
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: "asg-1",
      callables: spy.callables,
      env,
    });
    await Promise.all([runtime.begin(), runtime.begin(), runtime.begin()]);
    expect(spy.beginCalls).toEqual(["asg-1"]);
    expect(runtime.getStatus().mode).toBe("active");
  });

  test("subsequent begin after success does not re-call the callable", async () => {
    const spy = makeCallables();
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: "asg-1",
      callables: spy.callables,
      env,
    });
    await runtime.begin();
    await runtime.begin();
    expect(spy.beginCalls).toHaveLength(1);
  });

  test("begin surfaces server refusal as a non-recoverable error", async () => {
    const spy = makeCallables({
      beginResponse: async () => {
        const err = Object.assign(new Error("nope"), {
          code: "permission-denied",
        });
        throw err;
      },
    });
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: "asg-1",
      callables: spy.callables,
      env,
    });
    await expect(runtime.begin()).rejects.toThrow(/nope/);
    expect(runtime.getStatus().mode).toBe("error");
  });

  test("recoverable begin failure lets a retry succeed", async () => {
    let attempt = 0;
    const spy = makeCallables({
      beginResponse: async () => {
        attempt += 1;
        if (attempt === 1) {
          throw Object.assign(new Error("offline"), { code: "unavailable" });
        }
        return { sessionId: "sess-retry", alreadyLive: false };
      },
    });
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: "asg-1",
      callables: spy.callables,
      env,
    });
    await expect(runtime.begin()).rejects.toThrow(/offline/);
    expect(runtime.getStatus().mode).toBe("pending");
    await runtime.begin();
    expect(runtime.getStatus().mode).toBe("active");
    expect(attempt).toBe(2);
  });

  test("alreadyLive replay from begin is treated as an active session", async () => {
    const spy = makeCallables({
      beginResponse: async () => ({ sessionId: "sess-existing", alreadyLive: true }),
    });
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: "asg-1",
      callables: spy.callables,
      env,
    });
    await runtime.begin();
    expect(runtime.getStatus().mode).toBe("active");
  });
});

describe("createAssessmentRuntime - autosave", () => {
  test("autosave auto-begins the session and forwards the payload", async () => {
    const spy = makeCallables();
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: "asg-1",
      callables: spy.callables,
      env,
    });
    await runtime.autosave([{ itemId: "q1", response: "A" }]);
    expect(spy.beginCalls).toEqual(["asg-1"]);
    expect(spy.autosaveCalls).toEqual([
      { sessionId: "sess-asg-1", responses: [{ itemId: "q1", response: "A" }] },
    ]);
  });

  test("byte-identical autosave coalesces without a second call", async () => {
    const spy = makeCallables();
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: "asg-1",
      callables: spy.callables,
      env,
    });
    const payload: SessionResponse[] = [{ itemId: "q1", response: "A" }];
    await runtime.autosave(payload);
    const second = await runtime.autosave(payload);
    expect(second).toEqual({ persisted: false });
    expect(spy.autosaveCalls).toHaveLength(1);
  });

  test("distinct payload issues a fresh autosave", async () => {
    const spy = makeCallables();
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: "asg-1",
      callables: spy.callables,
      env,
    });
    await runtime.autosave([{ itemId: "q1", response: "A" }]);
    await runtime.autosave([{ itemId: "q1", response: "B" }]);
    expect(spy.autosaveCalls).toHaveLength(2);
  });

  test("autosave refuses in error mode", async () => {
    const spy = makeCallables({
      beginResponse: async () => {
        throw Object.assign(new Error("nope"), { code: "permission-denied" });
      },
    });
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: "asg-1",
      callables: spy.callables,
      env,
    });
    await expect(runtime.begin()).rejects.toThrow();
    // Error mode rethrows the refusal that caused it, not a generic guard.
    await expect(runtime.autosave([])).rejects.toThrow("nope");
    expect(spy.autosaveCalls).toHaveLength(0);
  });
});

describe("createAssessmentRuntime - finalize", () => {
  test("finalize ensures autosave first, then calls finalize with an idempotency key", async () => {
    const spy = makeCallables();
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: "asg-1",
      callables: spy.callables,
      env,
    });
    const responses: SessionResponse[] = [{ itemId: "q1", response: "A" }];
    const result = await runtime.finalize(responses);
    expect(result).toEqual(FINALIZE_RESULT);
    expect(spy.autosaveCalls).toHaveLength(1);
    expect(spy.finalizeCalls).toEqual([
      { sessionId: "sess-asg-1", idempotencyKey: "idk-1" },
    ]);
    expect(runtime.getStatus().mode).toBe("finalized");
  });

  test("finalize is idempotent - repeated calls return the cached result", async () => {
    const spy = makeCallables();
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: "asg-1",
      callables: spy.callables,
      env,
    });
    const responses: SessionResponse[] = [{ itemId: "q1", response: "A" }];
    const a = await runtime.finalize(responses);
    const b = await runtime.finalize(responses);
    expect(a).toBe(b);
    expect(spy.finalizeCalls).toHaveLength(1);
  });

  test("finalize retry after transient failure reuses the same idempotencyKey", async () => {
    let attempt = 0;
    const spy = makeCallables({
      finalizeResponse: async () => {
        attempt += 1;
        if (attempt === 1) {
          throw Object.assign(new Error("network"), { code: "unavailable" });
        }
        return FINALIZE_RESULT;
      },
    });
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: "asg-1",
      callables: spy.callables,
      env,
    });
    await expect(runtime.finalize([{ itemId: "q1", response: "A" }])).rejects.toThrow(
      /network/,
    );
    await runtime.finalize([{ itemId: "q1", response: "A" }]);
    expect(spy.finalizeCalls).toHaveLength(2);
    expect(spy.finalizeCalls[0]?.idempotencyKey).toBe(
      spy.finalizeCalls[1]?.idempotencyKey,
    );
  });

  test("concurrent finalize collapses to a single backend call", async () => {
    const spy = makeCallables();
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: "asg-1",
      callables: spy.callables,
      env,
    });
    const [a, b] = await Promise.all([
      runtime.finalize([{ itemId: "q1", response: "A" }]),
      runtime.finalize([{ itemId: "q1", response: "A" }]),
    ]);
    expect(a).toBe(b);
    expect(spy.finalizeCalls).toHaveLength(1);
  });
});

describe("createAssessmentRuntime - getAttempt", () => {
  test("getAttempt without id uses the finalized attemptId", async () => {
    const spy = makeCallables();
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: "asg-1",
      callables: spy.callables,
      env,
    });
    await runtime.finalize([]);
    const summary = await runtime.getAttempt();
    expect(summary).toEqual(ATTEMPT_SUMMARY);
    expect(spy.getAttemptCalls).toEqual([FINALIZE_RESULT.attemptId]);
  });

  test("getAttempt refuses when nothing is finalized and no id is supplied", async () => {
    const spy = makeCallables();
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: "asg-1",
      callables: spy.callables,
      env,
    });
    await expect(runtime.getAttempt()).rejects.toThrow(/attemptId/);
    expect(spy.getAttemptCalls).toHaveLength(0);
  });

  test("getAttempt refuses in standalone mode", async () => {
    const spy = makeCallables();
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: null,
      callables: spy.callables,
      env,
    });
    await expect(runtime.getAttempt("a-1")).rejects.toThrow(/inert/);
  });
});

describe("createAssessmentRuntime - refresh recovery + destroy", () => {
  test("a fresh runtime on the same page re-begins and receives alreadyLive", async () => {
    // A page refresh discards the JS-level runtime; the certified
    // begin callable returns alreadyLive:true on the reload path per
    // the §6 one-live-session invariant. The orchestrator treats it
    // as a normal active session with the returned sessionId.
    const spy = makeCallables({
      beginResponse: async () => ({ sessionId: "sess-existing", alreadyLive: true }),
    });
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: "asg-1",
      callables: spy.callables,
      env,
    });
    await runtime.autosave([{ itemId: "q1", response: "X" }]);
    expect(spy.autosaveCalls[0]?.sessionId).toBe("sess-existing");
  });

  test("destroy stops future backend calls", async () => {
    const spy = makeCallables();
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: "asg-1",
      callables: spy.callables,
      env,
    });
    runtime.destroy();
    await runtime.begin();
    expect(await runtime.autosave([])).toEqual({ persisted: false });
    expect(spy.beginCalls).toHaveLength(0);
    expect(spy.autosaveCalls).toHaveLength(0);
    await expect(runtime.finalize([])).rejects.toThrow(/destroyed/);
  });
});

// F5.2 §7.3/§8 (Slice 5): the assessment-begin transport seam. The runtime
// forwards the opaque launchRef to begin verbatim, only when one was provided;
// it never enforces, decodes, or fabricates it (that is Slice 6, server-side).
describe("createAssessmentRuntime - launchRef transport (F5.2 Slice 5)", () => {
  function beginRefSpy() {
    const calls: Array<{ assignmentId: string; launchRef: string | undefined }> = [];
    const callables: RuntimeCallables = {
      begin: async (assignmentId, launchRef) => {
        calls.push({ assignmentId, launchRef });
        return { sessionId: `sess-${assignmentId}`, alreadyLive: false };
      },
      autosave: async () => ({ persisted: true }),
      finalize: async () => FINALIZE_RESULT,
      getAttempt: async () => ATTEMPT_SUMMARY,
    };
    return { callables, calls };
  }

  test("forwards a provided launchRef to begin verbatim", async () => {
    const spy = beginRefSpy();
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: "asg-1",
      launchRef: "0123456789abcdef0123456789abcdef",
      callables: spy.callables,
      env,
    });
    await runtime.begin();
    expect(spy.calls).toEqual([
      { assignmentId: "asg-1", launchRef: "0123456789abcdef0123456789abcdef" },
    ]);
  });

  test("a canonical launch (no launchRef) calls begin with launchRef undefined", async () => {
    const spy = beginRefSpy();
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: "asg-1",
      callables: spy.callables,
      env,
    });
    await runtime.begin();
    expect(spy.calls).toEqual([{ assignmentId: "asg-1", launchRef: undefined }]);
  });

  test("an empty-string launchRef is treated as absent", async () => {
    const spy = beginRefSpy();
    const runtime = createAssessmentRuntime({
      version: "17.5.0",
      assignmentId: "asg-1",
      launchRef: "",
      callables: spy.callables,
      env,
    });
    await runtime.begin();
    expect(spy.calls[0]?.launchRef).toBeUndefined();
  });
});

// New attempts (assigned quiz Try Again). A committed finalize deletes the server
// session, so each attempt needs its own begin, its own idempotency key and
// its own finalize. Before this, a second finalize on the same page returned
// the first attempt's cached result and the lesson showed "Submitted to your
// teacher" for answers that were never sent.
describe("createAssessmentRuntime - new attempts", () => {
  function attemptServer(opts: { beginFailures?: unknown[] } = {}) {
    const beginFailures = [...(opts.beginFailures ?? [])];
    const calls = {
      begins: [] as Array<{ assignmentId: string; launchRef: string | undefined }>,
      autosaves: [] as Array<readonly SessionResponse[]>,
      finalizes: [] as string[],
    };
    let live = false;
    let liveResponses: readonly SessionResponse[] = [];
    let attempts = 0;
    const callables: RuntimeCallables = {
      begin: async (assignmentId, launchRef) => {
        calls.begins.push({ assignmentId, launchRef });
        const failure = beginFailures.shift();
        if (failure !== undefined) throw failure;
        const alreadyLive = live;
        live = true;
        return { sessionId: `${assignmentId}__s1__1`, alreadyLive, responses: liveResponses };
      },
      autosave: async (_sessionId, responses) => {
        calls.autosaves.push(responses);
        if (!live) throw Object.assign(new Error("Referenced session was not found."), { code: "functions/not-found" });
        liveResponses = responses;
        return { persisted: true };
      },
      finalize: async (_sessionId, key) => {
        calls.finalizes.push(key);
        live = false;
        liveResponses = [];
        attempts += 1;
        return { ...FINALIZE_RESULT, attemptId: `asg-1__s1__a${attempts}`, attemptNumber: attempts };
      },
      getAttempt: async () => ATTEMPT_SUMMARY,
    };
    return { callables, calls };
  }

  const A: SessionResponse[] = [{ itemId: "q1", response: "A" }];
  const B: SessionResponse[] = [{ itemId: "q1", response: "B" }];
  const C: SessionResponse[] = [{ itemId: "q1", response: "C" }];

  test("first, second and third attempts each begin, autosave and finalize under a new key", async () => {
    const server = attemptServer();
    const runtime = createAssessmentRuntime({ version: "t", assignmentId: "asg-1", callables: server.callables, env });
    const first = await runtime.finalize(A, "because A");
    expect(runtime.hasSubmittedAttempt()).toBe(true);
    await runtime.restart();
    expect(runtime.hasSubmittedAttempt()).toBe(false);
    expect(runtime.getStatus().mode).toBe("active");
    const second = await runtime.finalize(B, "because B");
    await runtime.restart();
    const third = await runtime.finalize(C, "because C");
    expect([first.attemptNumber, second.attemptNumber, third.attemptNumber]).toEqual([1, 2, 3]);
    expect(server.calls.begins).toHaveLength(3);
    expect(server.calls.autosaves).toEqual([A, B, C]);
    expect(new Set(server.calls.finalizes).size).toBe(3);
  });

  test("different answers after a submission are refused, never answered with the cached success", async () => {
    const server = attemptServer();
    const runtime = createAssessmentRuntime({ version: "t", assignmentId: "asg-1", callables: server.callables, env });
    await runtime.finalize(A);
    await expect(runtime.finalize(B)).rejects.toThrow(AttemptAlreadySubmittedError);
    await expect(runtime.finalize(A, "new explanation")).rejects.toThrow(ATTEMPT_ALREADY_SUBMITTED_MESSAGE);
    expect(server.calls.finalizes).toHaveLength(1);
    expect(runtime.getStatus().mode).toBe("finalized");
  });

  test("duplicate submit clicks (same answers) share one finalize, in flight and after it settles", async () => {
    const server = attemptServer();
    const runtime = createAssessmentRuntime({ version: "t", assignmentId: "asg-1", callables: server.callables, env });
    const [a, b] = await Promise.all([runtime.finalize(A, "why"), runtime.finalize(A, "why")]);
    const c = await runtime.finalize(A, "why");
    expect(a).toBe(b);
    expect(c).toBe(a);
    expect(server.calls.finalizes).toHaveLength(1);
  });

  test("a restart requested while finalize is in flight waits for it and keeps the attempts apart", async () => {
    const server = attemptServer();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const finalizeImpl = server.callables.finalize;
    const callables: RuntimeCallables = {
      ...server.callables,
      finalize: async (sessionId, key) => {
        await gate;
        return finalizeImpl(sessionId, key);
      },
    };
    const runtime = createAssessmentRuntime({ version: "t", assignmentId: "asg-1", callables, env });
    const first = runtime.finalize(A);
    const restarted = runtime.restart();
    const save = runtime.autosave(B);
    release();
    expect((await first).attemptNumber).toBe(1);
    await restarted;
    await save;
    expect(server.calls.autosaves).toEqual([A, B]);
    expect(server.calls.begins).toHaveLength(2);
    expect((await runtime.finalize(B)).attemptNumber).toBe(2);
  });

  test("concurrent restarts collapse to one new begin", async () => {
    const server = attemptServer();
    const runtime = createAssessmentRuntime({ version: "t", assignmentId: "asg-1", callables: server.callables, env });
    await runtime.finalize(A);
    await Promise.all([runtime.restart(), runtime.restart(), runtime.restart()]);
    expect(server.calls.begins).toHaveLength(2);
  });

  test("a restart never restores the previous attempt's answers into the page", async () => {
    const adopted: unknown[] = [];
    const callables: RuntimeCallables = {
      ...makeCallables().callables,
      begin: async () => ({ sessionId: "s", alreadyLive: true, responses: [{ itemId: "q1", response: "A" }] }),
    };
    const runtime = createAssessmentRuntime({
      version: "t",
      assignmentId: "asg-1",
      callables,
      env,
      adoptPersisted: (state) => {
        adopted.push(state);
        return state.responses;
      },
    });
    await runtime.begin();
    expect(adopted).toHaveLength(1);
    await runtime.finalize(A);
    await runtime.restart();
    expect(adopted).toHaveLength(1);
  });

  test("a restart keeps the assignment and launch grant of the original launch", async () => {
    const server = attemptServer();
    const runtime = createAssessmentRuntime({
      version: "t",
      assignmentId: "asg-1",
      launchRef: "0123456789abcdef0123456789abcdef",
      callables: server.callables,
      env,
    });
    await runtime.finalize(A);
    await runtime.restart();
    expect(server.calls.begins).toEqual([
      { assignmentId: "asg-1", launchRef: "0123456789abcdef0123456789abcdef" },
      { assignmentId: "asg-1", launchRef: "0123456789abcdef0123456789abcdef" },
    ]);
  });

  test("a restart after a failed finalize begins again and the new attempt uses a new key", async () => {
    const server = attemptServer();
    let failNext = true;
    const finalizeImpl = server.callables.finalize;
    const callables: RuntimeCallables = {
      ...server.callables,
      finalize: async (sessionId, key) => {
        if (failNext) {
          failNext = false;
          server.calls.finalizes.push(key);
          throw Object.assign(new Error("down"), { code: "functions/unavailable" });
        }
        return finalizeImpl(sessionId, key);
      },
    };
    const runtime = createAssessmentRuntime({ version: "t", assignmentId: "asg-1", callables, env });
    await expect(runtime.finalize(A)).rejects.toThrow("down");
    expect(runtime.getStatus().mode).toBe("active");
    expect(runtime.hasSubmittedAttempt()).toBe(true);
    await runtime.restart();
    await runtime.finalize(B);
    expect(server.calls.begins).toHaveLength(2);
    expect(server.calls.finalizes[0]).not.toBe(server.calls.finalizes[1]);
  });

  test("a retry with the same answers reuses the key; different answers get a new one", async () => {
    const keys: string[] = [];
    let failures = 2;
    const callables: RuntimeCallables = {
      ...makeCallables().callables,
      finalize: async (_sessionId, key) => {
        keys.push(key);
        if (failures-- > 0) throw Object.assign(new Error("down"), { code: "functions/deadline-exceeded" });
        return FINALIZE_RESULT;
      },
    };
    const runtime = createAssessmentRuntime({ version: "t", assignmentId: "asg-1", callables, env });
    await expect(runtime.finalize(A)).rejects.toThrow();
    await expect(runtime.finalize(A)).rejects.toThrow();
    await runtime.finalize(B);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  test("a non-recoverable begin failure on restart is reported by the next finalize", async () => {
    const closed = Object.assign(new Error("Assignment window has closed."), { code: "functions/failed-precondition" });
    const server = attemptServer({ beginFailures: [undefined, closed] });
    const runtime = createAssessmentRuntime({ version: "t", assignmentId: "asg-1", callables: server.callables, env });
    await runtime.finalize(A);
    await expect(runtime.restart()).rejects.toThrow("Assignment window has closed.");
    expect(runtime.getStatus().mode).toBe("error");
    await expect(runtime.finalize(B)).rejects.toThrow("Assignment window has closed.");
    expect(server.calls.finalizes).toHaveLength(1);
  });

  test("a recoverable begin failure on restart is retried by the next autosave", async () => {
    const down = Object.assign(new Error("down"), { code: "functions/unavailable" });
    const server = attemptServer({ beginFailures: [undefined, down] });
    const runtime = createAssessmentRuntime({ version: "t", assignmentId: "asg-1", callables: server.callables, env });
    await runtime.finalize(A);
    await expect(runtime.restart()).rejects.toThrow("down");
    expect(runtime.getStatus().mode).toBe("pending");
    await runtime.autosave(B);
    expect(server.calls.begins).toHaveLength(3);
    expect((await runtime.finalize(B)).attemptNumber).toBe(2);
  });

  test("an integrity error stays terminal: restart refuses and sends nothing", async () => {
    const callables: RuntimeCallables = {
      ...makeCallables().callables,
      begin: async () => ({ sessionId: "s", alreadyLive: false, assessmentRevisionId: "assessment_x__r2" }),
    };
    const runtime = createAssessmentRuntime({
      version: "t",
      assignmentId: "asg-1",
      callables,
      env,
      verifyAssessmentRevision: () => ({ ok: false, reason: "mismatch" }),
    });
    await expect(runtime.begin()).rejects.toThrow(ASSESSMENT_REVISION_MISMATCH_MESSAGE);
    await expect(runtime.restart()).rejects.toThrow(ASSESSMENT_REVISION_MISMATCH_MESSAGE);
  });
});

// The Firebase client reports callable failures as `functions/<code>`.
// Before, only bare codes were treated as transient, so in production every
// network hiccup left the runtime in a permanent error state.
describe("createAssessmentRuntime - Firebase error codes", () => {
  const A: SessionResponse[] = [{ itemId: "q1", response: "A" }];

  test.each(["functions/unavailable", "functions/internal", "functions/deadline-exceeded", "unavailable"])(
    "%s is recoverable: the session stays usable",
    async (code) => {
      let fail = true;
      const callables: RuntimeCallables = {
        ...makeCallables().callables,
        autosave: async () => {
          if (fail) {
            fail = false;
            throw Object.assign(new Error("blip"), { code });
          }
          return { persisted: true };
        },
      };
      const runtime = createAssessmentRuntime({ version: "t", assignmentId: "asg-1", callables, env });
      await expect(runtime.autosave(A)).rejects.toThrow("blip");
      expect(runtime.getStatus().mode).toBe("active");
      await expect(runtime.autosave(A)).resolves.toEqual({ persisted: true });
    },
  );

  test.each(["functions/not-found", "functions/failed-precondition", "functions/permission-denied"])(
    "%s is not recoverable",
    async (code) => {
      const callables: RuntimeCallables = {
        ...makeCallables().callables,
        autosave: async () => {
          throw Object.assign(new Error("refused"), { code });
        },
      };
      const runtime = createAssessmentRuntime({ version: "t", assignmentId: "asg-1", callables, env });
      await expect(runtime.autosave(A)).rejects.toThrow("refused");
      expect(runtime.getStatus().mode).toBe("error");
    },
  );
});
