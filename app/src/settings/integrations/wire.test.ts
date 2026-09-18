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
import { createAssignmentsCallables, createIntegrationsDeps } from "./wire";

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
