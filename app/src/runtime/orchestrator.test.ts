import { createAssessmentRuntime } from "./orchestrator";
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
    await expect(runtime.autosave([])).rejects.toThrow(/error state/);
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
