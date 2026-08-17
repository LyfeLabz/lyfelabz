// Sprint 25 Phase 1 adapter tests for listClassTopics and publishAssignment.
//
// These two operations were deferred stubs (lms.providerNotYetOperational)
// through Sprint 23C. Sprint 25 Phase 1 activates both against the transport
// seam. The boundary-test entries for them are removed from adapter.test.ts;
// full behavioral coverage lives here.
//
// All identifiers are fictional. No real teacher, student, school, OAuth
// credential, or LyfeLabz-affiliated identifier is used.

import { PlatformError } from "../../../shared";
import { googleClassroomAdapter } from "./adapter";
import {
  resetGoogleClassroomConfigForTests,
  setGoogleClassroomConfig,
} from "./config";
import {
  FIXTURE_ACCESS_TOKEN,
  FIXTURE_TOPICS_BY_COURSE,
  createFixtureGoogleClassroomTransport,
} from "./__fixtures__/fixture-transport";
import {
  createHttpsGoogleClassroomTransport,
  resetGoogleClassroomTransportForTests,
  setGoogleClassroomTransport,
  type HttpsFetch,
} from "./transport";

const FIXTURE_CONFIG = {
  clientId: "fixture-oauth-client-id",
  clientSecret: "fixture-oauth-client-secret-never-real",
  redirectUri: "https://fixture.example.invalid/lms-callback",
} as const;

const PLANET_FORGE_COURSE_ID = "fixture-course-planet-forge";
const TIDE_LOOP_COURSE_ID = "fixture-course-tide-loop";
const SIGNAL_DRIFT_COURSE_ID = "fixture-course-signal-drift";
const FIXTURE_ASSIGNMENT_URL =
  "https://app.lyfelabz.invalid/a/fixture-assignment-1";
const FIXTURE_ASSIGNMENT_TITLE = "Fictional Assignment Title";

function setupFixture(
  options: Parameters<typeof createFixtureGoogleClassroomTransport>[0] = {},
) {
  const transport = createFixtureGoogleClassroomTransport(options);
  setGoogleClassroomTransport(transport);
  setGoogleClassroomConfig(FIXTURE_CONFIG);
  return transport;
}

describe("googleClassroomAdapter.listClassTopics (Sprint 25 Phase 1)", () => {
  afterEach(() => {
    resetGoogleClassroomTransportForTests();
    resetGoogleClassroomConfigForTests();
  });

  it("returns a single page of topics (tide-loop: 1 topic, fits in one page)", async () => {
    setupFixture();
    const result = await googleClassroomAdapter.listClassTopics({
      accessToken: FIXTURE_ACCESS_TOKEN,
      lmsClassId: TIDE_LOOP_COURSE_ID,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      lmsTopicId: "fixture-topic-intro",
      name: "Fictional Topic - Intro",
    });
  });

  it("returns multiple pages of topics (planet-forge: 3 topics, page size 2)", async () => {
    setupFixture();
    const result = await googleClassroomAdapter.listClassTopics({
      accessToken: FIXTURE_ACCESS_TOKEN,
      lmsClassId: PLANET_FORGE_COURSE_ID,
    });
    // Fixture page size is 2; planet-forge has 3 topics requiring 2 pages.
    const expected = FIXTURE_TOPICS_BY_COURSE[PLANET_FORGE_COURSE_ID].map(
      (t) => ({ lmsTopicId: t.topicId, name: t.name }),
    );
    expect(result).toHaveLength(3);
    expect(result).toEqual(expected);
  });

  it("returns an empty array when the course has no topics", async () => {
    setupFixture();
    const result = await googleClassroomAdapter.listClassTopics({
      accessToken: FIXTURE_ACCESS_TOKEN,
      lmsClassId: SIGNAL_DRIFT_COURSE_ID,
    });
    expect(result).toEqual([]);
  });

  it("throws lms.upstreamAuthorizationFailed on a 401 response", async () => {
    setupFixture({ failureMode: "authorization-failure" });
    await expect(
      googleClassroomAdapter.listClassTopics({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: PLANET_FORGE_COURSE_ID,
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamAuthorizationFailed" });
  });

  it("throws lms.insufficientScope on a 403 INSUFFICIENT_SCOPE response", async () => {
    setupFixture({ failureMode: "insufficient-scope" });
    await expect(
      googleClassroomAdapter.listClassTopics({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: PLANET_FORGE_COURSE_ID,
      }),
    ).rejects.toMatchObject({ code: "lms.insufficientScope" });
  });

  it("throws lms.upstreamAuthorizationFailed on a non-scope 403 (PERMISSION_DENIED), not lms.insufficientScope", async () => {
    setupFixture({ failureMode: "permission-denied" });
    await expect(
      googleClassroomAdapter.listClassTopics({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: PLANET_FORGE_COURSE_ID,
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamAuthorizationFailed" });
  });

  it("rejects a repeated (cyclic) nextPageToken rather than looping to the page bound", async () => {
    const cyclicTransport = createFixtureGoogleClassroomTransport();
    (cyclicTransport as unknown as Record<string, unknown>).listCourseTopics =
      () =>
        Promise.resolve({
          topic: [
            { topicId: "fixture-topic-loop", name: "Fictional Topic - Loop" },
          ],
          // Always hands back the same cursor: a non-advancing upstream.
          nextPageToken: "cursor-stuck",
        });
    setGoogleClassroomTransport(cyclicTransport);
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    await expect(
      googleClassroomAdapter.listClassTopics({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: PLANET_FORGE_COURSE_ID,
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamCallFailed" });
  });

  it("throws lms.upstreamTemporarilyUnavailable on a 429 rate-limited response", async () => {
    setupFixture({ failureMode: "rate-limited" });
    await expect(
      googleClassroomAdapter.listClassTopics({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: PLANET_FORGE_COURSE_ID,
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamTemporarilyUnavailable" });
  });

  it("throws lms.upstreamTemporarilyUnavailable on a 503 temporarily-unavailable response", async () => {
    setupFixture({ failureMode: "temporary-unavailable" });
    await expect(
      googleClassroomAdapter.listClassTopics({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: PLANET_FORGE_COURSE_ID,
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamTemporarilyUnavailable" });
  });

  it("throws lms.upstreamMalformedResponse when a topic entry is missing its topicId", async () => {
    // Inject a transport that returns a topic with no topicId.
    const badTransport = createFixtureGoogleClassroomTransport();
    (badTransport as unknown as Record<string, unknown>).listCourseTopics =
      () => Promise.resolve({ topic: [{ topicId: "", name: "Fictional Topic" }] });
    setGoogleClassroomTransport(badTransport);
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    await expect(
      googleClassroomAdapter.listClassTopics({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: PLANET_FORGE_COURSE_ID,
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamMalformedResponse" });
  });

  it("throws lms.upstreamMalformedResponse when a topic entry is missing its name", async () => {
    const badTransport = createFixtureGoogleClassroomTransport();
    (badTransport as unknown as Record<string, unknown>).listCourseTopics =
      () => Promise.resolve({ topic: [{ topicId: "fixture-topic-ok", name: "" }] });
    setGoogleClassroomTransport(badTransport);
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    await expect(
      googleClassroomAdapter.listClassTopics({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: PLANET_FORGE_COURSE_ID,
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamMalformedResponse" });
  });
});

describe("googleClassroomAdapter.publishAssignment (Sprint 25 Phase 1)", () => {
  afterEach(() => {
    resetGoogleClassroomTransportForTests();
    resetGoogleClassroomConfigForTests();
  });

  it("publishes successfully without a topic", async () => {
    setupFixture();
    const result = await googleClassroomAdapter.publishAssignment({
      accessToken: FIXTURE_ACCESS_TOKEN,
      lmsClassId: PLANET_FORGE_COURSE_ID,
      title: FIXTURE_ASSIGNMENT_TITLE,
      lyfelabzAssignmentUrl: FIXTURE_ASSIGNMENT_URL,
    });
    expect(typeof result.lmsAssignmentId).toBe("string");
    expect(result.lmsAssignmentId.length).toBeGreaterThan(0);
    // topicId must not be present in the request when not provided.
    expect(result).not.toHaveProperty("topicId");
  });

  it("publishes successfully with a topic", async () => {
    setupFixture();
    const result = await googleClassroomAdapter.publishAssignment({
      accessToken: FIXTURE_ACCESS_TOKEN,
      lmsClassId: PLANET_FORGE_COURSE_ID,
      title: FIXTURE_ASSIGNMENT_TITLE,
      lyfelabzAssignmentUrl: FIXTURE_ASSIGNMENT_URL,
      lmsTopicId: "fixture-topic-week-01",
    });
    expect(typeof result.lmsAssignmentId).toBe("string");
    expect(result.lmsAssignmentId.length).toBeGreaterThan(0);
  });

  it("includes lmsAssignmentUrl in the result when the upstream resource returns alternateLink", async () => {
    setupFixture();
    const result = await googleClassroomAdapter.publishAssignment({
      accessToken: FIXTURE_ACCESS_TOKEN,
      lmsClassId: PLANET_FORGE_COURSE_ID,
      title: FIXTURE_ASSIGNMENT_TITLE,
      lyfelabzAssignmentUrl: FIXTURE_ASSIGNMENT_URL,
    });
    // The fixture transport always returns alternateLink.
    expect(typeof result.lmsAssignmentUrl).toBe("string");
    expect(result.lmsAssignmentUrl!.length).toBeGreaterThan(0);
  });

  it("throws lms.upstreamMalformedResponse when the upstream result has an empty id", async () => {
    const badTransport = createFixtureGoogleClassroomTransport();
    (badTransport as unknown as Record<string, unknown>).createCourseWork = () =>
      Promise.resolve({ id: "", alternateLink: "https://classroom.google.com/c/fake" });
    setGoogleClassroomTransport(badTransport);
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    await expect(
      googleClassroomAdapter.publishAssignment({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: PLANET_FORGE_COURSE_ID,
        title: FIXTURE_ASSIGNMENT_TITLE,
        lyfelabzAssignmentUrl: FIXTURE_ASSIGNMENT_URL,
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamMalformedResponse" });
  });

  it("throws lms.insufficientScope on a 403 INSUFFICIENT_SCOPE response", async () => {
    setupFixture({ failureMode: "insufficient-scope" });
    await expect(
      googleClassroomAdapter.publishAssignment({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: PLANET_FORGE_COURSE_ID,
        title: FIXTURE_ASSIGNMENT_TITLE,
        lyfelabzAssignmentUrl: FIXTURE_ASSIGNMENT_URL,
      }),
    ).rejects.toMatchObject({ code: "lms.insufficientScope" });
  });

  it("throws lms.upstreamAuthorizationFailed on a 401 response", async () => {
    setupFixture({ failureMode: "authorization-failure" });
    await expect(
      googleClassroomAdapter.publishAssignment({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: PLANET_FORGE_COURSE_ID,
        title: FIXTURE_ASSIGNMENT_TITLE,
        lyfelabzAssignmentUrl: FIXTURE_ASSIGNMENT_URL,
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamAuthorizationFailed" });
  });

  it("throws lms.upstreamTemporarilyUnavailable on a 429 rate-limited response", async () => {
    setupFixture({ failureMode: "rate-limited" });
    await expect(
      googleClassroomAdapter.publishAssignment({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: PLANET_FORGE_COURSE_ID,
        title: FIXTURE_ASSIGNMENT_TITLE,
        lyfelabzAssignmentUrl: FIXTURE_ASSIGNMENT_URL,
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamTemporarilyUnavailable" });
  });

  it("throws lms.upstreamTemporarilyUnavailable on a 503 temporarily-unavailable response", async () => {
    setupFixture({ failureMode: "temporary-unavailable" });
    await expect(
      googleClassroomAdapter.publishAssignment({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: PLANET_FORGE_COURSE_ID,
        title: FIXTURE_ASSIGNMENT_TITLE,
        lyfelabzAssignmentUrl: FIXTURE_ASSIGNMENT_URL,
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamTemporarilyUnavailable" });
  });

  it("delivers an AbortSignal to the transport createCourseWork call", async () => {
    const capturing = createFixtureGoogleClassroomTransport();
    let capturedSignal: AbortSignal | undefined;
    (capturing as unknown as Record<string, unknown>).createCourseWork = (req: {
      signal?: AbortSignal;
    }) => {
      capturedSignal = req.signal;
      return Promise.resolve({
        id: "fixture-coursework-signal-ok",
        alternateLink: "https://classroom.google.com/c/fixture/a/ok/details",
      });
    };
    setGoogleClassroomTransport(capturing);
    setGoogleClassroomConfig(FIXTURE_CONFIG);

    await googleClassroomAdapter.publishAssignment({
      accessToken: FIXTURE_ACCESS_TOKEN,
      lmsClassId: PLANET_FORGE_COURSE_ID,
      title: FIXTURE_ASSIGNMENT_TITLE,
      lyfelabzAssignmentUrl: FIXTURE_ASSIGNMENT_URL,
    });

    // The adapter must hand the transport a real AbortSignal, and on a
    // successful (non-timed-out) call that signal must not be aborted.
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal!.aborted).toBe(false);
  });

  it("aborts the signal at the 30s deadline, maps to lms.upstreamCallFailed, and cannot later resolve", async () => {
    jest.useFakeTimers();
    try {
      let capturedSignal: AbortSignal | undefined;
      let resolveWork:
        | ((v: { id: string; alternateLink?: string }) => void)
        | undefined;
      const controlled = createFixtureGoogleClassroomTransport();
      (controlled as unknown as Record<string, unknown>).createCourseWork = (req: {
        signal?: AbortSignal;
      }) =>
        new Promise<{ id: string; alternateLink?: string }>((resolve) => {
          capturedSignal = req.signal;
          resolveWork = resolve;
        });
      setGoogleClassroomTransport(controlled);
      setGoogleClassroomConfig(FIXTURE_CONFIG);

      const resultPromise = googleClassroomAdapter.publishAssignment({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: PLANET_FORGE_COURSE_ID,
        title: FIXTURE_ASSIGNMENT_TITLE,
        lyfelabzAssignmentUrl: FIXTURE_ASSIGNMENT_URL,
      });

      // The signal is captured synchronously at call time and is not yet
      // aborted before the deadline.
      expect(capturedSignal).toBeInstanceOf(AbortSignal);
      expect(capturedSignal!.aborted).toBe(false);

      // Advance to exactly the 30-second adapter deadline.
      jest.advanceTimersByTime(30_000);

      await expect(resultPromise).rejects.toMatchObject({
        code: "lms.upstreamCallFailed",
      });
      // The in-flight request was genuinely cancelled, not merely raced.
      expect(capturedSignal!.aborted).toBe(true);

      // A late upstream success after the timeout path completes must not
      // turn the already-rejected publish into a success.
      resolveWork?.({
        id: "fixture-coursework-late",
        alternateLink: "https://classroom.google.com/c/fixture/a/late/details",
      });
      await expect(resultPromise).rejects.toMatchObject({
        code: "lms.upstreamCallFailed",
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("throws lms.upstreamAuthorizationFailed on a non-scope 403 (PERMISSION_DENIED), not lms.insufficientScope", async () => {
    setupFixture({ failureMode: "permission-denied" });
    await expect(
      googleClassroomAdapter.publishAssignment({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: PLANET_FORGE_COURSE_ID,
        title: FIXTURE_ASSIGNMENT_TITLE,
        lyfelabzAssignmentUrl: FIXTURE_ASSIGNMENT_URL,
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamAuthorizationFailed" });
  });

  it("throws lms.upstreamCallFailed on a generic (non-upstream) transport error", async () => {
    const badTransport = createFixtureGoogleClassroomTransport();
    (badTransport as unknown as Record<string, unknown>).createCourseWork = () =>
      Promise.reject(new Error("Unexpected network failure"));
    setGoogleClassroomTransport(badTransport);
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    await expect(
      googleClassroomAdapter.publishAssignment({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: PLANET_FORGE_COURSE_ID,
        title: FIXTURE_ASSIGNMENT_TITLE,
        lyfelabzAssignmentUrl: FIXTURE_ASSIGNMENT_URL,
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamCallFailed" });
  });

  // ---------------------------------------------------------------------------
  // Sprint 25 B9 certification finding: timeout-lifecycle ownership.
  //
  // The corrected structure owns the 30s timeout timer inside a single
  // try/finally that also encloses the createCourseWork() call. These tests
  // pin the three ways the call can settle (synchronous throw, asynchronous
  // 30s timeout, success is covered above) and assert, for each, that no
  // orphan timer survives and no unhandled rejection escapes.
  // ---------------------------------------------------------------------------

  it("Part 4B: a SYNCHRONOUS createCourseWork throw surfaces a mapped failure, clears the timer, and leaves no orphan timeout", async () => {
    jest.useFakeTimers();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      // Mirror the real UnboundGoogleClassroomTransport, whose
      // createCourseWork() throws synchronously. Before the fix, this throw
      // escaped the try/finally because the work was started before the try,
      // leaving the 30s timer live to reject an unconsumed promise later.
      const syncThrow = createFixtureGoogleClassroomTransport();
      (syncThrow as unknown as Record<string, unknown>).createCourseWork = () => {
        throw new PlatformError(
          "lms.googleClassroomTransportUnbound",
          "Synchronous transport throw (fixture).",
        );
      };
      setGoogleClassroomTransport(syncThrow);
      setGoogleClassroomConfig(FIXTURE_CONFIG);

      const resultPromise = googleClassroomAdapter.publishAssignment({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: PLANET_FORGE_COURSE_ID,
        title: FIXTURE_ASSIGNMENT_TITLE,
        lyfelabzAssignmentUrl: FIXTURE_ASSIGNMENT_URL,
      });

      await expect(resultPromise).rejects.toMatchObject({
        code: "lms.googleClassroomTransportUnbound",
      });

      // Load-bearing assertion. After the synchronous throw settles the
      // publish, NO timer may remain pending. Against the pre-fix code this
      // was 1: the 30s timeout was created before the throwing line and never
      // cleared. This is the assertion that fails pre-fix.
      expect(jest.getTimerCount()).toBe(0);

      // Advancing well past the 30s deadline must not fire an orphan timer.
      jest.advanceTimersByTime(60_000);
      await Promise.resolve();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      jest.useRealTimers();
    }
    // Flush the microtask queue on real timers so any (erroneous) orphan
    // rejection would have surfaced before we assert none did.
    await new Promise((resolve) => setImmediate(resolve));
    expect(unhandled).toEqual([]);
  });

  it("Part 4C: a never-resolving call fires the 30s timeout as lms.upstreamCallFailed, clears the timer, and never leaks a rejection", async () => {
    jest.useFakeTimers();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const neverResolves = createFixtureGoogleClassroomTransport();
      (neverResolves as unknown as Record<string, unknown>).createCourseWork =
        () =>
          new Promise<{ id: string; alternateLink?: string }>(() => {
            // Intentionally never settles; only the 30s timeout can win.
          });
      setGoogleClassroomTransport(neverResolves);
      setGoogleClassroomConfig(FIXTURE_CONFIG);

      const resultPromise = googleClassroomAdapter.publishAssignment({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: PLANET_FORGE_COURSE_ID,
        title: FIXTURE_ASSIGNMENT_TITLE,
        lyfelabzAssignmentUrl: FIXTURE_ASSIGNMENT_URL,
      });

      // The timeout timer is pending until the deadline.
      expect(jest.getTimerCount()).toBe(1);
      jest.advanceTimersByTime(30_000);

      await expect(resultPromise).rejects.toMatchObject({
        code: "lms.upstreamCallFailed",
      });
      // The timer fired and was cleared by finally; none remain.
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      jest.useRealTimers();
    }
    await new Promise((resolve) => setImmediate(resolve));
    expect(unhandled).toEqual([]);
  });

  it("Part 4D: with a bound transport and readonly-only scopes, a scope shortfall surfaces lms.insufficientScope (not transport-unbound, not a generic failure)", async () => {
    // A bound transport whose createCourseWork rejects with an
    // insufficient-scope upstream error, i.e. the readonly-only token path.
    setupFixture({ failureMode: "insufficient-scope" });
    const error = await googleClassroomAdapter
      .publishAssignment({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: PLANET_FORGE_COURSE_ID,
        title: FIXTURE_ASSIGNMENT_TITLE,
        lyfelabzAssignmentUrl: FIXTURE_ASSIGNMENT_URL,
      })
      .then(
        () => {
          throw new Error("publishAssignment should have rejected");
        },
        (e: unknown) => e as { code?: string },
      );
    expect(error).toMatchObject({ code: "lms.insufficientScope" });
    // The bound-transport contract: the readonly token must reach the
    // incremental-consent signal, never the transport-unbound error and
    // never a generic upstream failure.
    expect(error.code).not.toBe("lms.googleClassroomTransportUnbound");
    expect(error.code).not.toBe("lms.upstreamCallFailed");
  });
});

// End-to-end classification against the REAL production HTTPS transport
// (Sprint 25 certification finding). The tests above install the in-memory
// fixture transport, whose upstream errors carry a synthetic `errorCode`
// that the adapter recognizes directly. Real Google never sends that shape:
// an OAuth scope shortfall arrives as HTTP 403 with the generic status
// "PERMISSION_DENIED" and the discriminating reason
// "ACCESS_TOKEN_SCOPE_INSUFFICIENT" nested in error.details[]. These tests
// wire the genuine fetch-based transport (with an injected fetchImpl) into
// the adapter so the real body flows transport -> extractUpstreamCode ->
// GoogleClassroomHttpsError -> translateUpstreamError -> vendor-neutral
// PlatformError, exactly as it does against production Google.
describe("googleClassroomAdapter classification against the real HTTPS transport", () => {
  const REAL_TRANSPORT_CONFIG = {
    clientId: "fixture-oauth-client-id",
    clientSecret: "fixture-oauth-client-secret-never-real",
  } as const;

  // Genuine Google 403 body for an insufficient OAuth scope (topics.list or
  // courseWork.create). Top-level status is the generic PERMISSION_DENIED;
  // the scope shortfall is only visible in details[].reason.
  const SCOPE_INSUFFICIENT_BODY = JSON.stringify({
    error: {
      code: 403,
      message: "Request had insufficient authentication scopes.",
      status: "PERMISSION_DENIED",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
          domain: "googleapis.com",
          metadata: { service: "classroom.googleapis.com" },
        },
      ],
    },
  });

  // Genuine Google 403 body for an ordinary permission denial: correct
  // scopes, but the caller is not allowed on the resource.
  const ORDINARY_DENIAL_BODY = JSON.stringify({
    error: {
      code: 403,
      message: "The caller does not have permission.",
      status: "PERMISSION_DENIED",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "IAM_PERMISSION_DENIED",
          domain: "googleapis.com",
        },
      ],
    },
  });

  function installRealTransport(status: number, body: string): void {
    const fetchImpl: HttpsFetch = () =>
      Promise.resolve({
        status,
        ok: status >= 200 && status < 300,
        text: () => Promise.resolve(body),
      });
    setGoogleClassroomTransport(
      createHttpsGoogleClassroomTransport({
        resolveConfig: () => REAL_TRANSPORT_CONFIG,
        fetchImpl,
      }),
    );
    setGoogleClassroomConfig(FIXTURE_CONFIG);
  }

  afterEach(() => {
    resetGoogleClassroomTransportForTests();
    resetGoogleClassroomConfigForTests();
  });

  it("listClassTopics: real insufficient-scope 403 -> lms.insufficientScope", async () => {
    installRealTransport(403, SCOPE_INSUFFICIENT_BODY);
    await expect(
      googleClassroomAdapter.listClassTopics({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: PLANET_FORGE_COURSE_ID,
      }),
    ).rejects.toMatchObject({ code: "lms.insufficientScope" });
  });

  it("publishAssignment: real insufficient-scope 403 -> lms.insufficientScope", async () => {
    installRealTransport(403, SCOPE_INSUFFICIENT_BODY);
    await expect(
      googleClassroomAdapter.publishAssignment({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: PLANET_FORGE_COURSE_ID,
        title: FIXTURE_ASSIGNMENT_TITLE,
        lyfelabzAssignmentUrl: FIXTURE_ASSIGNMENT_URL,
      }),
    ).rejects.toMatchObject({ code: "lms.insufficientScope" });
  });

  it("listClassTopics: real ordinary 403 -> lms.upstreamAuthorizationFailed (not insufficientScope)", async () => {
    installRealTransport(403, ORDINARY_DENIAL_BODY);
    await expect(
      googleClassroomAdapter.listClassTopics({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: PLANET_FORGE_COURSE_ID,
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamAuthorizationFailed" });
  });

  it("publishAssignment: real ordinary 403 -> lms.upstreamAuthorizationFailed (not insufficientScope)", async () => {
    installRealTransport(403, ORDINARY_DENIAL_BODY);
    await expect(
      googleClassroomAdapter.publishAssignment({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: PLANET_FORGE_COURSE_ID,
        title: FIXTURE_ASSIGNMENT_TITLE,
        lyfelabzAssignmentUrl: FIXTURE_ASSIGNMENT_URL,
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamAuthorizationFailed" });
  });
});
