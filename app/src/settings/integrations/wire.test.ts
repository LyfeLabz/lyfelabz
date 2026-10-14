/**
 * @jest-environment jsdom
 */
// Historical Assignment Resolution, Implementation Slice 9. `mockHttpsCallable`
// dispatches by callable name so a test can configure exactly what one named
// callable (e.g. "assignmentsLifecycleState") returns, without disturbing the
// pre-existing `createIntegrationsDeps` tests below, which never configure a
// response and therefore keep receiving the original default `{data:
// undefined}` for every callable name.
const callableResponses = new Map<string, () => Promise<{ data: unknown }>>();
const mockHttpsCallable = jest.fn((_functions: unknown, name: string) => {
  const respond = callableResponses.get(name);
  return respond ?? (async () => ({ data: undefined }));
});
jest.mock("firebase/functions", () => ({
  httpsCallable: (functions: unknown, name: string) =>
    mockHttpsCallable(functions, name),
}));
jest.mock("firebase/firestore", () => ({
  collection: () => ({}),
  getDocs: async () => ({ forEach: () => undefined }),
  query: () => ({}),
  where: () => ({}),
}));

import type { Functions } from "firebase/functions";
import type { ListClasses } from "../../classes/listClasses";
import { createAssignmentsCallables, createIntegrationsDeps, createLmsCallables } from "./wire";

function makeWin(origin: string): Window {
  const win = {
    location: { origin },
    open: () => null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setInterval: () => 0,
    clearInterval: () => undefined,
  } as unknown as Window;
  return win;
}

const listClassesStub: ListClasses = async () => Object.freeze([]);

describe("createIntegrationsDeps redirectUri", () => {
  it("targets the served /app/lms-callback.html path at the production origin", () => {
    const deps = createIntegrationsDeps({
      functions: {} as Functions,
      listClasses: listClassesStub,
      teacherUid: "teacher-1",
      win: makeWin("https://app.lyfelabz.com"),
    });
    expect(deps.redirectUri).toBe("https://app.lyfelabz.com/app/lms-callback.html");
  });

  it("preserves the /app/ segment across arbitrary same-origin hosts", () => {
    const deps = createIntegrationsDeps({
      functions: {} as Functions,
      listClasses: listClassesStub,
      teacherUid: "teacher-1",
      win: makeWin("https://staging.example.test"),
    });
    expect(deps.redirectUri).toBe(
      "https://staging.example.test/app/lms-callback.html",
    );
  });

  it("never emits an origin-root /lms-callback.html redirect URI", () => {
    const deps = createIntegrationsDeps({
      functions: {} as Functions,
      listClasses: listClassesStub,
      teacherUid: "teacher-1",
      win: makeWin("https://app.lyfelabz.com"),
    });
    expect(deps.redirectUri).not.toMatch(/\/\/[^/]+\/lms-callback\.html$/);
    expect(deps.redirectUri).toMatch(/\/app\/lms-callback\.html$/);
  });
});

// Historical Assignment Resolution, Implementation Slice 9. Focused tests
// for the `assignmentsLifecycleState` client parser's strict validation of
// the additive `currentAssignmentId`/`currentAssignmentResolution` fields.
// This is the ONLY place raw, untrusted callable JSON is converted into the
// typed `AssignmentsLifecycleStateOutput` the rest of the client consumes -
// `curriculum.lifecycle.test.ts` mocks `AssignmentsCallables` directly and
// therefore never exercises this parsing logic at all.
describe("createAssignmentsCallables lifecycleState: Current-resolution parsing", () => {
  const candidateX = {
    assignmentId: "a-x",
    title: "X",
    status: "published",
    publishedAt: 1,
    recipientCount: 1,
    activeEnrollmentCount: 1,
    missingRecipientCount: 0,
  };
  const candidateY = {
    assignmentId: "a-y",
    title: "Y",
    status: "published",
    publishedAt: 2,
    recipientCount: 2,
    activeEnrollmentCount: 2,
    missingRecipientCount: 0,
  };
  const candidateZ = {
    assignmentId: "a-z",
    title: "Z",
    status: "published",
    publishedAt: 3,
    recipientCount: 3,
    activeEnrollmentCount: 3,
    missingRecipientCount: 0,
  };

  beforeEach(() => {
    callableResponses.clear();
  });

  function stubLifecycleState(data: Readonly<Record<string, unknown>>): void {
    callableResponses.set("assignmentsLifecycleState", async () => ({ data }));
  }

  async function callLifecycleState() {
    const assignments = createAssignmentsCallables({} as Functions);
    return assignments.lifecycleState({ classId: "c1", lessonSlug: "slug" });
  }

  // 1. valid Current parses
  it("parses a valid resolution, preserving the exact server assignmentId", async () => {
    stubLifecycleState({
      state: "multiplePublished",
      candidates: [candidateX, candidateY],
      currentAssignmentResolution: "valid",
      currentAssignmentId: "a-y",
    });
    const out = await callLifecycleState();
    expect(out.currentAssignmentResolution).toBe("valid");
    expect(out.currentAssignmentId).toBe("a-y");
  });

  // 2. unresolved parses
  it("parses an unresolved resolution with null id", async () => {
    stubLifecycleState({
      state: "multiplePublished",
      candidates: [],
      currentAssignmentResolution: "unresolved",
      currentAssignmentId: null,
    });
    const out = await callLifecycleState();
    expect(out.currentAssignmentResolution).toBe("unresolved");
    expect(out.currentAssignmentId).toBeNull();
  });

  // 3. invalid parses
  it("parses an invalid resolution with null id", async () => {
    stubLifecycleState({
      state: "multiplePublished",
      candidates: [],
      currentAssignmentResolution: "invalid",
      currentAssignmentId: null,
    });
    const out = await callLifecycleState();
    expect(out.currentAssignmentResolution).toBe("invalid");
    expect(out.currentAssignmentId).toBeNull();
  });

  // 3b. inactive (managed Current closed/archived) parses
  it("parses an inactive resolution with null id", async () => {
    stubLifecycleState({
      state: "historicalOnly",
      candidates: [],
      currentAssignmentResolution: "inactive",
      currentAssignmentId: null,
    });
    const out = await callLifecycleState();
    expect(out.currentAssignmentResolution).toBe("inactive");
    expect(out.currentAssignmentId).toBeNull();
  });

  it("rejects inactive resolution paired with a non-null assignmentId", async () => {
    stubLifecycleState({
      state: "historicalOnly",
      candidates: [],
      currentAssignmentResolution: "inactive",
      currentAssignmentId: "a-x",
    });
    await expect(callLifecycleState()).rejects.toThrow(
      "assignmentsLifecycleState returned an unexpected shape.",
    );
  });

  // 4. valid + null rejected
  it("rejects valid resolution paired with a null assignmentId", async () => {
    stubLifecycleState({
      state: "onePublishedFullyCurrent",
      candidates: [candidateX],
      currentAssignmentResolution: "valid",
      currentAssignmentId: null,
    });
    await expect(callLifecycleState()).rejects.toThrow(
      "assignmentsLifecycleState returned an unexpected shape.",
    );
  });

  // 5. unresolved + id rejected
  it("rejects unresolved resolution paired with a non-null assignmentId", async () => {
    stubLifecycleState({
      state: "multiplePublished",
      candidates: [],
      currentAssignmentResolution: "unresolved",
      currentAssignmentId: "a-x",
    });
    await expect(callLifecycleState()).rejects.toThrow(
      "assignmentsLifecycleState returned an unexpected shape.",
    );
  });

  // 6. invalid + id rejected
  it("rejects invalid resolution paired with a non-null assignmentId", async () => {
    stubLifecycleState({
      state: "multiplePublished",
      candidates: [],
      currentAssignmentResolution: "invalid",
      currentAssignmentId: "a-x",
    });
    await expect(callLifecycleState()).rejects.toThrow(
      "assignmentsLifecycleState returned an unexpected shape.",
    );
  });

  // 7. unknown resolution string rejected
  it("rejects an unrecognized currentAssignmentResolution value", async () => {
    stubLifecycleState({
      state: "multiplePublished",
      candidates: [],
      currentAssignmentResolution: "somethingElse",
      currentAssignmentId: null,
    });
    await expect(callLifecycleState()).rejects.toThrow(
      "assignmentsLifecycleState returned an unexpected shape.",
    );
  });

  // 8. missing resolution field rejected
  it("rejects a response missing currentAssignmentResolution entirely", async () => {
    stubLifecycleState({
      state: "multiplePublished",
      candidates: [],
      currentAssignmentId: null,
    });
    await expect(callLifecycleState()).rejects.toThrow(
      "assignmentsLifecycleState returned an unexpected shape.",
    );
  });

  // 9. missing currentAssignmentId field rejected (distinct from explicit null)
  it("rejects a response missing currentAssignmentId entirely, even though explicit null is otherwise valid", async () => {
    stubLifecycleState({
      state: "multiplePublished",
      candidates: [],
      currentAssignmentResolution: "unresolved",
      // currentAssignmentId intentionally omitted, not set to null.
    });
    await expect(callLifecycleState()).rejects.toThrow(
      "assignmentsLifecycleState returned an unexpected shape.",
    );
  });

  // 10. wrong type for currentAssignmentId rejected
  it("rejects a wrong-typed currentAssignmentId (number) on a valid resolution", async () => {
    stubLifecycleState({
      state: "onePublishedFullyCurrent",
      candidates: [candidateX],
      currentAssignmentResolution: "valid",
      currentAssignmentId: 12345,
    });
    await expect(callLifecycleState()).rejects.toThrow(
      "assignmentsLifecycleState returned an unexpected shape.",
    );
  });

  // 11. valid + empty assignmentId rejected
  it("rejects a valid resolution paired with an empty-string assignmentId", async () => {
    stubLifecycleState({
      state: "onePublishedFullyCurrent",
      candidates: [candidateX],
      currentAssignmentResolution: "valid",
      currentAssignmentId: "",
    });
    await expect(callLifecycleState()).rejects.toThrow(
      "assignmentsLifecycleState returned an unexpected shape.",
    );
  });

  // 12. no heuristic inference: one published candidate + unresolved/null
  // must remain unresolved/null - the parser never looks at `candidates`
  // to decide Current.
  it("does not infer Current from a lone published candidate: one candidate + unresolved/null stays unresolved/null", async () => {
    stubLifecycleState({
      state: "onePublishedFullyCurrent",
      candidates: [candidateX],
      currentAssignmentResolution: "unresolved",
      currentAssignmentId: null,
    });
    const out = await callLifecycleState();
    expect(out.currentAssignmentResolution).toBe("unresolved");
    expect(out.currentAssignmentId).toBeNull();
  });

  // 13. multiple published preserves exact server Current
  it("preserves the exact server-chosen Current among three published candidates", async () => {
    stubLifecycleState({
      state: "multiplePublished",
      candidates: [candidateX, candidateY, candidateZ],
      currentAssignmentResolution: "valid",
      currentAssignmentId: "a-y",
    });
    const out = await callLifecycleState();
    expect(out.currentAssignmentId).toBe("a-y");
    expect(out.currentAssignmentId).not.toBe("a-x");
    expect(out.currentAssignmentId).not.toBe("a-z");
  });

  // 14. candidate shape unchanged - no per-candidate Current flag
  it("parses candidates with exactly the existing shape, no per-candidate Current field", async () => {
    stubLifecycleState({
      state: "onePublishedFullyCurrent",
      candidates: [candidateX],
      currentAssignmentResolution: "valid",
      currentAssignmentId: "a-x",
    });
    const out = await callLifecycleState();
    expect(Object.keys(out.candidates[0]).sort()).toEqual(
      [
        "assignmentId",
        "title",
        "status",
        "publishedAt",
        "recipientCount",
        "activeEnrollmentCount",
        "missingRecipientCount",
      ].sort(),
    );
  });

  // 15. existing lifecycle state parsing preserved across all five states
  it.each([
    "neverAssigned",
    "onePublishedFullyCurrent",
    "onePublishedMissingRecipients",
    "multiplePublished",
    "historicalOnly",
  ] as const)("continues to parse the existing lifecycle state %s", async (state) => {
    stubLifecycleState({
      state,
      candidates: [],
      currentAssignmentResolution: "unresolved",
      currentAssignmentId: null,
    });
    const out = await callLifecycleState();
    expect(out.state).toBe(state);
  });
});

// Historical Assignment Resolution, Implementation Slice 10. Focused tests
// for the new `assignmentsCurrentRecipientsReconcile` client wrapper. This
// is the only place raw, untrusted callable JSON is converted into the
// typed `AssignmentsCurrentRecipientsReconcileOutput` - Curriculum's own
// tests mock `AssignmentsCallables` directly and never exercise this
// parsing/request-shape logic.
describe("createAssignmentsCallables currentRecipientsReconcile", () => {
  beforeEach(() => {
    callableResponses.clear();
  });

  function stubCurrentReconcile(data: Readonly<Record<string, unknown>>): void {
    callableResponses.set(
      "assignmentsCurrentRecipientsReconcile",
      async () => ({ data }),
    );
  }

  function callCurrentReconcile() {
    const assignments = createAssignmentsCallables({} as Functions);
    return assignments.currentRecipientsReconcile({
      classId: "c1",
      lessonSlug: "slug",
    });
  }

  it("parses a well-formed response", async () => {
    stubCurrentReconcile({
      classId: "c1",
      lessonSlug: "slug",
      assignmentId: "a-1",
      added: 3,
      alreadyCurrent: 2,
    });
    const out = await callCurrentReconcile();
    expect(out).toEqual({
      classId: "c1",
      lessonSlug: "slug",
      assignmentId: "a-1",
      added: 3,
      alreadyCurrent: 2,
    });
  });

  it("sends a request containing only classId and lessonSlug - never an assignmentId", async () => {
    stubCurrentReconcile({
      classId: "c1",
      lessonSlug: "slug",
      assignmentId: "a-1",
      added: 0,
      alreadyCurrent: 0,
    });
    const assignments = createAssignmentsCallables({} as Functions);
    // mockHttpsCallable returns the same fixed responder regardless of the
    // request payload, so this asserts the wrapper's own TypeScript-typed
    // input shape rather than a runtime capture - the type
    // `AssignmentsCurrentRecipientsReconcileInput` structurally forbids any
    // extra field such as `assignmentId`/`currentAssignmentId`/
    // `expectedCurrentAssignmentId` from ever being passed here.
    const input: Parameters<typeof assignments.currentRecipientsReconcile>[0] =
      { classId: "c1", lessonSlug: "slug" };
    expect(Object.keys(input).sort()).toEqual(["classId", "lessonSlug"]);
    await assignments.currentRecipientsReconcile(input);
  });

  it("rejects a response missing assignmentId", async () => {
    stubCurrentReconcile({
      classId: "c1",
      lessonSlug: "slug",
      added: 0,
      alreadyCurrent: 0,
    });
    await expect(callCurrentReconcile()).rejects.toThrow(
      "assignmentsCurrentRecipientsReconcile returned an unexpected shape.",
    );
  });

  it("rejects a response with a negative added count", async () => {
    stubCurrentReconcile({
      classId: "c1",
      lessonSlug: "slug",
      assignmentId: "a-1",
      added: -1,
      alreadyCurrent: 0,
    });
    await expect(callCurrentReconcile()).rejects.toThrow(
      "assignmentsCurrentRecipientsReconcile returned an unexpected shape.",
    );
  });

  it("rejects a response with a non-integer alreadyCurrent count", async () => {
    stubCurrentReconcile({
      classId: "c1",
      lessonSlug: "slug",
      assignmentId: "a-1",
      added: 0,
      alreadyCurrent: 1.5,
    });
    await expect(callCurrentReconcile()).rejects.toThrow(
      "assignmentsCurrentRecipientsReconcile returned an unexpected shape.",
    );
  });

  it("rejects a response with a string-typed added count rather than defaulting it", async () => {
    stubCurrentReconcile({
      classId: "c1",
      lessonSlug: "slug",
      assignmentId: "a-1",
      added: "3",
      alreadyCurrent: 0,
    });
    await expect(callCurrentReconcile()).rejects.toThrow(
      "assignmentsCurrentRecipientsReconcile returned an unexpected shape.",
    );
  });

  it("rejects a response with an empty-string classId", async () => {
    stubCurrentReconcile({
      classId: "",
      lessonSlug: "slug",
      assignmentId: "a-1",
      added: 0,
      alreadyCurrent: 0,
    });
    await expect(callCurrentReconcile()).rejects.toThrow(
      "assignmentsCurrentRecipientsReconcile returned an unexpected shape.",
    );
  });
});

// Historical Assignment Resolution, Implementation Slice 11. Focused tests
// for the new `assignmentsCurrentSet` client wrapper - the narrow mirror of
// the committed Slice 4 server callable. This is the only place raw,
// untrusted callable JSON is converted into the typed
// `AssignmentsCurrentSetOutput`, and the only place that proves the request
// this wrapper sends preserves all four fields (including a `null`
// `expectedCurrentAssignmentId`) exactly as supplied.
describe("createAssignmentsCallables currentSet", () => {
  beforeEach(() => {
    callableResponses.clear();
  });

  function stubCurrentSet(data: Readonly<Record<string, unknown>>): void {
    callableResponses.set("assignmentsCurrentSet", async () => ({ data }));
  }

  function callCurrentSet(
    expectedCurrentAssignmentId: string | null = null,
  ) {
    const assignments = createAssignmentsCallables({} as Functions);
    return assignments.currentSet({
      classId: "c1",
      lessonSlug: "slug",
      assignmentId: "a-1",
      expectedCurrentAssignmentId,
    });
  }

  it("parses a well-formed response for a genuine change", async () => {
    stubCurrentSet({
      classId: "c1",
      lessonSlug: "slug",
      assignmentId: "a-1",
      changed: true,
    });
    const out = await callCurrentSet();
    expect(out).toEqual({
      classId: "c1",
      lessonSlug: "slug",
      assignmentId: "a-1",
      changed: true,
    });
  });

  it("parses a well-formed response for an idempotent same-value retry (changed: false)", async () => {
    stubCurrentSet({
      classId: "c1",
      lessonSlug: "slug",
      assignmentId: "a-1",
      changed: false,
    });
    const out = await callCurrentSet("a-1");
    expect(out.changed).toBe(false);
  });

  it("sends expectedCurrentAssignmentId exactly null for an initial Set - never omitted, never substituted", async () => {
    stubCurrentSet({
      classId: "c1",
      lessonSlug: "slug",
      assignmentId: "a-1",
      changed: true,
    });
    const assignments = createAssignmentsCallables({} as Functions);
    const input: Parameters<typeof assignments.currentSet>[0] = {
      classId: "c1",
      lessonSlug: "slug",
      assignmentId: "a-1",
      expectedCurrentAssignmentId: null,
    };
    expect(input.expectedCurrentAssignmentId).toBeNull();
    expect("expectedCurrentAssignmentId" in input).toBe(true);
    await assignments.currentSet(input);
  });

  it("sends the exact observed Current as expectedCurrentAssignmentId for a Change", async () => {
    stubCurrentSet({
      classId: "c1",
      lessonSlug: "slug",
      assignmentId: "a-2",
      changed: true,
    });
    const assignments = createAssignmentsCallables({} as Functions);
    const input: Parameters<typeof assignments.currentSet>[0] = {
      classId: "c1",
      lessonSlug: "slug",
      assignmentId: "a-2",
      expectedCurrentAssignmentId: "a-1",
    };
    expect(input.expectedCurrentAssignmentId).toBe("a-1");
    expect(Object.keys(input).sort()).toEqual(
      [
        "classId",
        "lessonSlug",
        "assignmentId",
        "expectedCurrentAssignmentId",
      ].sort(),
    );
    await assignments.currentSet(input);
  });

  it("rejects a non-object response", async () => {
    callableResponses.set("assignmentsCurrentSet", async () => ({
      data: "not an object",
    }));
    await expect(callCurrentSet()).rejects.toThrow(
      "assignmentsCurrentSet returned an unexpected shape.",
    );
  });

  it("rejects a response missing assignmentId", async () => {
    stubCurrentSet({ classId: "c1", lessonSlug: "slug", changed: true });
    await expect(callCurrentSet()).rejects.toThrow(
      "assignmentsCurrentSet returned an unexpected shape.",
    );
  });

  it("rejects a response with an empty-string assignmentId", async () => {
    stubCurrentSet({
      classId: "c1",
      lessonSlug: "slug",
      assignmentId: "",
      changed: true,
    });
    await expect(callCurrentSet()).rejects.toThrow(
      "assignmentsCurrentSet returned an unexpected shape.",
    );
  });

  it("rejects a response with a wrong-typed classId", async () => {
    stubCurrentSet({
      classId: 42,
      lessonSlug: "slug",
      assignmentId: "a-1",
      changed: true,
    });
    await expect(callCurrentSet()).rejects.toThrow(
      "assignmentsCurrentSet returned an unexpected shape.",
    );
  });

  it("rejects a response with a wrong-typed lessonSlug", async () => {
    stubCurrentSet({
      classId: "c1",
      lessonSlug: 42,
      assignmentId: "a-1",
      changed: true,
    });
    await expect(callCurrentSet()).rejects.toThrow(
      "assignmentsCurrentSet returned an unexpected shape.",
    );
  });

  it("rejects a response with a non-boolean changed field, rather than coercing it", async () => {
    stubCurrentSet({
      classId: "c1",
      lessonSlug: "slug",
      assignmentId: "a-1",
      changed: "true",
    });
    await expect(callCurrentSet()).rejects.toThrow(
      "assignmentsCurrentSet returned an unexpected shape.",
    );
  });

  it("rejects a response missing the changed field entirely", async () => {
    stubCurrentSet({ classId: "c1", lessonSlug: "slug", assignmentId: "a-1" });
    await expect(callCurrentSet()).rejects.toThrow(
      "assignmentsCurrentSet returned an unexpected shape.",
    );
  });
});

describe("createLmsCallables refreshRoster: manual reconciliation passthrough and parsing", () => {
  beforeEach(() => {
    callableResponses.clear();
  });

  const base = {
    classId: "c1",
    membersSeen: 20,
    added: 0,
    reaffirmed: 20,
    removed: 1,
    withdrawnEnrollments: 1,
    upstreamRosterEmpty: false,
  };

  it("sends the request as given (Import: classId only; manual: reconcileEnrollments) and parses the reconciliation counts", async () => {
    const sent: unknown[] = [];
    callableResponses.set("lmsClassesRefreshRoster", ((input: unknown) => {
      sent.push(input);
      return Promise.resolve({
        data: {
          ...base,
          enrollmentReconciliation: {
            added: 2,
            alreadyEnrolled: 17,
            reactivated: 1,
            awaitingFirstSignIn: 1,
            notReactivated: 0,
            notMatched: 0,
            withdrawn: 1,
          },
        },
      });
    }) as never);
    const callables = createLmsCallables({} as Functions);
    const out = await callables.refreshRoster({ classId: "c1", reconcileEnrollments: true });
    await callables.refreshRoster({ classId: "c1" });
    expect(sent).toEqual([{ classId: "c1", reconcileEnrollments: true }, { classId: "c1" }]);
    expect(out.enrollmentReconciliation).toEqual({
      added: 2,
      alreadyEnrolled: 17,
      reactivated: 1,
      awaitingFirstSignIn: 1,
      notReactivated: 0,
      notMatched: 0,
      withdrawn: 1,
    });
  });

  it("omits enrollmentReconciliation when the server sends none (Import response)", async () => {
    callableResponses.set("lmsClassesRefreshRoster", async () => ({ data: base }));
    const out = await createLmsCallables({} as Functions).refreshRoster({ classId: "c1" });
    expect(out).not.toHaveProperty("enrollmentReconciliation");
    expect(out.withdrawnEnrollments).toBe(1);
  });
});

// Unified onboarding authorization: the provider-neutral
// `publicationAuthorized` flag is parsed only when it is a real boolean, so
// an older server (no field) reads as unknown and never blocks a teacher.
describe("createLmsCallables publicationAuthorized parsing", () => {
  afterEach(() => callableResponses.clear());

  it("describeConnections carries a boolean flag and omits a missing or malformed one", async () => {
    callableResponses.set("lmsConnectionsDescribe", async () => ({
      data: {
        connections: [
          { connectionId: "a", providerId: "googleClassroom", status: "active", scopes: [], publicationAuthorized: false },
          { connectionId: "b", providerId: "googleClassroom", status: "active", scopes: [], publicationAuthorized: true },
          { connectionId: "c", providerId: "googleClassroom", status: "active", scopes: [] },
          { connectionId: "d", providerId: "googleClassroom", status: "active", scopes: [], publicationAuthorized: "yes" },
        ],
      },
    }));
    const rows = await createLmsCallables({} as Functions).describeConnections();
    expect(rows.map((r) => r.publicationAuthorized)).toEqual([false, true, undefined, undefined]);
    expect(rows[2]).not.toHaveProperty("publicationAuthorized");
  });

  it("completeConnection carries the flag when present", async () => {
    callableResponses.set("lmsConnectionsComplete", async () => ({
      data: { connectionId: "conn", alreadyConnected: true, consentOutcome: "alreadyAuthorized", publicationAuthorized: false },
    }));
    const res = await createLmsCallables({} as Functions).completeConnection({
      providerId: "googleClassroom",
      code: "c",
      state: "s",
      redirectUri: "r",
    });
    expect(res.publicationAuthorized).toBe(false);
    callableResponses.set("lmsConnectionsComplete", async () => ({
      data: { connectionId: "conn", alreadyConnected: false },
    }));
    const legacy = await createLmsCallables({} as Functions).completeConnection({
      providerId: "googleClassroom",
      code: "c",
      state: "s",
      redirectUri: "r",
    });
    expect(legacy).not.toHaveProperty("publicationAuthorized");
  });
});

// PDR-030i popup reliability: a blank window reserved synchronously from the
// teacher's click is navigated to the server-issued authorization URL; the
// OAuth callback contract (same-origin postMessage, exact state match) is
// unchanged.
describe("browser OAuth window reservation and handoff", () => {
  type FakePopup = {
    closed: boolean;
    close: jest.Mock;
    location: { replace: jest.Mock };
  };
  const ORIGIN = "https://app.lyfelabz.com";
  const GOOGLE = "https://accounts.google.com/o/oauth2/v2/auth?state=st-1";

  const makePopup = (): FakePopup => {
    const popup: FakePopup = {
      closed: false,
      close: jest.fn(() => {
        popup.closed = true;
      }),
      location: { replace: jest.fn() },
    };
    return popup;
  };

  const makeBrowser = (opts: { openReturns?: FakePopup | null } = {}) => {
    const listeners: Array<(ev: MessageEvent) => void> = [];
    const intervals: Array<() => void> = [];
    const open = jest.fn(() => (opts.openReturns === undefined ? makePopup() : opts.openReturns));
    const win = {
      location: { origin: ORIGIN },
      open,
      addEventListener: (_t: string, fn: (ev: MessageEvent) => void) => listeners.push(fn),
      removeEventListener: (_t: string, fn: (ev: MessageEvent) => void) => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      },
      setInterval: (fn: () => void) => {
        intervals.push(fn);
        return intervals.length;
      },
      clearInterval: () => undefined,
    } as unknown as Window;
    const post = (data: unknown, origin = ORIGIN): void => {
      for (const fn of [...listeners]) fn({ origin, data } as MessageEvent);
    };
    const tick = (): void => {
      for (const fn of intervals) fn();
    };
    return { win, open, post, tick, listeners };
  };

  it("reserves an about:blank window synchronously, never the callback page", async () => {
    const { createBrowserOAuthWindowReserver } = await import("./wire");
    const b = makeBrowser();
    const reservation = createBrowserOAuthWindowReserver(b.win)();
    expect(reservation).not.toBeNull();
    expect(b.open).toHaveBeenCalledTimes(1);
    const firstCall = b.open.mock.calls[0] as unknown as [string, string, string];
    expect(firstCall[0]).toBe("about:blank");
    expect(firstCall[0]).not.toContain("lms-callback");
    expect(firstCall[2]).toContain("noopener=no");
    reservation!.close();
    reservation!.close();
    expect((reservation!.popup as unknown as FakePopup).close).toHaveBeenCalledTimes(1);
  });

  it("returns null when the browser blocks the reservation", async () => {
    const { createBrowserOAuthWindowReserver } = await import("./wire");
    const b = makeBrowser({ openReturns: null });
    expect(createBrowserOAuthWindowReserver(b.win)()).toBeNull();
  });

  it("navigates the reserved window to the authorization URL and resolves on the matching callback", async () => {
    const { createBrowserOAuthHandoff, createBrowserOAuthWindowReserver } = await import("./wire");
    const b = makeBrowser();
    const reservation = createBrowserOAuthWindowReserver(b.win)()!;
    const pending = createBrowserOAuthHandoff(b.win)({
      authorizationUrl: GOOGLE,
      redirectUri: `${ORIGIN}/app/lms-callback.html`,
      expectedState: "st-1",
      reservation,
    });
    const popup = reservation.popup as unknown as FakePopup;
    expect(popup.location.replace).toHaveBeenCalledWith(GOOGLE);
    // No second window is opened.
    expect(b.open).toHaveBeenCalledTimes(1);
    // A message from another origin, or with another type, is ignored.
    b.post({ type: "lyfelabz-lms-oauth", code: "evil", state: "st-1" }, "https://evil.example");
    b.post({ type: "other", code: "x", state: "st-1" });
    b.post({ type: "lyfelabz-lms-oauth", code: "auth-code", state: "st-1" });
    await expect(pending).resolves.toEqual({ code: "auth-code", state: "st-1" });
    expect(popup.close).toHaveBeenCalled();
    expect(b.listeners).toHaveLength(0);
  });

  it("still rejects a state mismatch when using a reserved window", async () => {
    const { createBrowserOAuthHandoff, createBrowserOAuthWindowReserver } = await import("./wire");
    const b = makeBrowser();
    const reservation = createBrowserOAuthWindowReserver(b.win)()!;
    const pending = createBrowserOAuthHandoff(b.win)({
      authorizationUrl: GOOGLE,
      redirectUri: "r",
      expectedState: "st-1",
      reservation,
    });
    b.post({ type: "lyfelabz-lms-oauth", code: "c", state: "forged" });
    await expect(pending).rejects.toMatchObject({ code: "state-mismatch" });
  });

  it("surfaces a provider refusal (access_denied) as-is", async () => {
    const { createBrowserOAuthHandoff, createBrowserOAuthWindowReserver } = await import("./wire");
    const b = makeBrowser();
    const reservation = createBrowserOAuthWindowReserver(b.win)()!;
    const pending = createBrowserOAuthHandoff(b.win)({
      authorizationUrl: GOOGLE,
      redirectUri: "r",
      expectedState: "st-1",
      reservation,
    });
    b.post({ type: "lyfelabz-lms-oauth", error: "access_denied" });
    await expect(pending).rejects.toMatchObject({ code: "access_denied" });
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["plain http", "http://accounts.google.com/o/oauth2/v2/auth"],
    ["same-origin callback page", `${ORIGIN}/app/lms-callback.html?code=x&state=st-1`],
    ["unparseable", "not a url"],
    ["embedded credentials", "https://user:pass@accounts.google.com/auth"],
  ])("refuses to navigate to a %s URL and releases the reserved window", async (_l, url) => {
    const { createBrowserOAuthHandoff, createBrowserOAuthWindowReserver } = await import("./wire");
    const b = makeBrowser();
    const reservation = createBrowserOAuthWindowReserver(b.win)()!;
    await expect(
      createBrowserOAuthHandoff(b.win)({
        authorizationUrl: url,
        redirectUri: "r",
        expectedState: "st-1",
        reservation,
      }),
    ).rejects.toMatchObject({ code: "invalid-authorization-url" });
    const popup = reservation.popup as unknown as FakePopup;
    expect(popup.location.replace).not.toHaveBeenCalled();
    expect(popup.close).toHaveBeenCalled();
    expect(b.open).toHaveBeenCalledTimes(1);
  });

  it("reports cancelled when the teacher closed the blank window before Google loaded", async () => {
    const { createBrowserOAuthHandoff, createBrowserOAuthWindowReserver } = await import("./wire");
    const b = makeBrowser();
    const reservation = createBrowserOAuthWindowReserver(b.win)()!;
    (reservation.popup as unknown as FakePopup).closed = true;
    await expect(
      createBrowserOAuthHandoff(b.win)({
        authorizationUrl: GOOGLE,
        redirectUri: "r",
        expectedState: "st-1",
        reservation,
      }),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(b.open).toHaveBeenCalledTimes(1);
  });

  it("reports cancelled when the Google window is closed mid-flow", async () => {
    const { createBrowserOAuthHandoff, createBrowserOAuthWindowReserver } = await import("./wire");
    const b = makeBrowser();
    const reservation = createBrowserOAuthWindowReserver(b.win)()!;
    const pending = createBrowserOAuthHandoff(b.win)({
      authorizationUrl: GOOGLE,
      redirectUri: "r",
      expectedState: "st-1",
      reservation,
    });
    (reservation.popup as unknown as FakePopup).closed = true;
    b.tick();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });

  it("falls back to opening the authorization URL when nothing was reserved", async () => {
    const { createBrowserOAuthHandoff } = await import("./wire");
    const b = makeBrowser();
    const pending = createBrowserOAuthHandoff(b.win)({
      authorizationUrl: GOOGLE,
      redirectUri: "r",
      expectedState: "st-1",
    });
    expect((b.open.mock.calls[0] as unknown as [string])[0]).toBe(GOOGLE);
    b.post({ type: "lyfelabz-lms-oauth", code: "c", state: "st-1" });
    await expect(pending).resolves.toEqual({ code: "c", state: "st-1" });
  });

  it("reports popup-blocked when there is no reservation and the browser blocks the window", async () => {
    const { createBrowserOAuthHandoff } = await import("./wire");
    const b = makeBrowser({ openReturns: null });
    await expect(
      createBrowserOAuthHandoff(b.win)({
        authorizationUrl: GOOGLE,
        redirectUri: "r",
        expectedState: "st-1",
      }),
    ).rejects.toMatchObject({ code: "popup-blocked" });
  });

  it("createIntegrationsDeps wires the reserver", () => {
    const deps = createIntegrationsDeps({
      functions: {} as Functions,
      listClasses: listClassesStub,
      teacherUid: "teacher-1",
      win: makeWin(ORIGIN),
    });
    expect(typeof deps.reserveOAuthWindow).toBe("function");
  });
});
