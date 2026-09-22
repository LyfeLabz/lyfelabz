import type { CallableRequest } from "firebase-functions/v2/https";

const mockRecipientsGet = jest.fn();
const mockRecipientsWhere = jest.fn();
const mockRecipientsCollectionGroupRef = jest.fn(() => ({
  where: mockRecipientsWhere,
}));

const mockAssignmentGet = jest.fn();
const mockAssignmentDocRef: jest.Mock = jest.fn(() => ({
  get: mockAssignmentGet,
}));

// Current-aware dashboard dedup: `collapsePublishedToCurrent` calls the
// real (unmocked) `resolveValidCurrentAssignmentId`, which reads the
// pointer through this seam. Defaulting to "no pointer document" means
// every pre-existing test in this file - none of which set up a Current
// pointer - keeps its exact prior behavior: any class+lesson group with
// more than one item resolves "unresolved" and is returned in full,
// unchanged. Tests that specifically exercise collapsing configure this
// per-call.
const mockCurrentDocGet: jest.Mock = jest.fn(() =>
  Promise.resolve({ exists: false, data: () => undefined }),
);
const mockAssignmentsCurrentDocRef: jest.Mock = jest.fn(() => ({
  get: mockCurrentDocGet,
}));

// Reassignment model: the canonical occurrence grouping enumerates a class's
// assignments with one single-field `classId` equality query. Served from
// the same in-memory registry `assignmentDocRef` reads (declared below).
const mockAssignmentsCollectionRef = jest.fn(() => ({
  where: (_field: string, _op: string, classId: string) => ({
    get: () =>
      Promise.resolve({
        docs: Array.from(assignmentRegistry.entries())
          .filter(([, snap]) => snap.exists && (snap.data() as { classId?: string }).classId === classId)
          .map(([id, snap]) => ({ id, data: () => snap.data() })),
      }),
  }),
}));

const mockRequireDistrictContext = jest.fn();

const mockLogInfo = jest.fn();

// F5.2 Slice 4: the per-item launch-presentation resolver (Op C) is injected
// via `../shared`. Default outcome is EXPECTED_CANONICAL so pre-feature item
// shape assertions remain exact; individual tests override it.
const mockLaunchResolve = jest.fn();
const mockCreateLaunchResolver = jest.fn(() => ({ resolve: mockLaunchResolve }));

jest.mock("firebase-admin/firestore", () => ({}));

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    log: { info: mockLogInfo, warn: jest.fn(), error: jest.fn() },
    assignmentDocRef: mockAssignmentDocRef,
    assignmentsCurrentDocRef: mockAssignmentsCurrentDocRef,
    assignmentsCollectionRef: mockAssignmentsCollectionRef,
    assignmentRecipientsCollectionGroupRef: mockRecipientsCollectionGroupRef,
    requireDistrictContext: mockRequireDistrictContext,
    createRequestLaunchPresentationResolver: mockCreateLaunchResolver,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __assignmentsListForStudentHandler } from "./assignments-list-for-student";

const STUDENT_UID = "student-uid";
const OTHER_UID = "other-student";
const TEACHER_UID = "teacher-uid";
const SCHOOL_ID = "school-a";
const DISTRICT_ID = "district-1";
const CLASS_ID = "class-a";

const VALID_CONTEXT = Object.freeze({
  uid: STUDENT_UID,
  role: "student" as const,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
});

function makeRequest(
  data: Record<string, unknown> | undefined | null = {},
  auth: { uid?: string } | null = { uid: STUDENT_UID },
): CallableRequest<unknown> {
  return {
    data,
    auth: auth ? ({ uid: auth.uid, token: {} } as never) : (null as never),
    rawRequest: {} as never,
  };
}

type RecipientOverrides = Partial<{
  assignmentId: string;
  studentId: string;
  teacherId: string;
  classId: string;
  schoolId: string;
  districtId: string;
  status: string;
  source: string;
}>;

function recipientDoc(
  assignmentId: string,
  overrides: RecipientOverrides = {},
): { data(): unknown } {
  return {
    data: () => ({
      assignmentId,
      studentId: STUDENT_UID,
      teacherId: TEACHER_UID,
      classId: CLASS_ID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      assignedAt: {},
      assignedBy: TEACHER_UID,
      source: "classPublication",
      status: "assigned",
      ...overrides,
    }),
  };
}

type AssignmentOverrides = Partial<{
  classId: string;
  teacherId: string;
  schoolId: string;
  lessonSlug: string;
  mode: string;
  status: string;
  title: string;
  publishedAt: unknown;
  availableAt: unknown;
}>;

function assignmentSnap(
  exists: boolean,
  overrides: AssignmentOverrides = {},
): { readonly exists: boolean; readonly id: string; data(): unknown } {
  return {
    exists,
    id: overrides.classId ? "id-with-class" : "assignment-id",
    data: () => ({
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      lessonSlug: "lesson_g7_earths-layers",
      mode: "classroom",
      status: "published",
      createdAt: {},
      title: "Earth's Layers",
      publishedAt: { toMillis: () => 1_700_000_000_000 },
      ...overrides,
    }),
  };
}

// Set up an in-memory registry so mockAssignmentDocRef can return the doc
// keyed by assignmentId. Each test seeds the registry it needs.
const assignmentRegistry = new Map<string, ReturnType<typeof assignmentSnap>>();

function seedAssignment(
  id: string,
  overrides: AssignmentOverrides = {},
  exists = true,
) {
  const snap = assignmentSnap(exists, overrides);
  Object.defineProperty(snap, "id", { value: id, writable: false });
  assignmentRegistry.set(id, snap);
}

beforeEach(() => {
  jest.clearAllMocks();
  assignmentRegistry.clear();
  mockRecipientsWhere.mockReturnValue({ get: mockRecipientsGet });
  mockRequireDistrictContext.mockResolvedValue(VALID_CONTEXT);
  mockAssignmentDocRef.mockImplementation((id: string) => ({
    get: () =>
      Promise.resolve(
        assignmentRegistry.get(id) ?? { exists: false, id, data: () => undefined },
      ),
  }));
  // Default: canonical-expected student (no differentiation fields attached).
  mockLaunchResolve.mockResolvedValue({ kind: "expectedCanonical" });
  mockCreateLaunchResolver.mockReturnValue({ resolve: mockLaunchResolve });
});

describe("assignmentsListForStudent - authorization", () => {
  test("propagates unauthenticated rejection from district context", async () => {
    const err = new PlatformError("unauthenticated", "no auth");
    mockRequireDistrictContext.mockRejectedValue(err);
    await expect(
      __assignmentsListForStudentHandler(makeRequest({}, null)),
    ).rejects.toBe(err);
  });

  test("rejects non-student role", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_CONTEXT,
      role: "teacher",
    });
    await expect(
      __assignmentsListForStudentHandler(makeRequest()),
    ).rejects.toBeInstanceOf(PlatformError);
  });

  test("propagates stale-claim rejection from district context", async () => {
    const err = new PlatformError("claim-stale", "stale claim");
    mockRequireDistrictContext.mockRejectedValue(err);
    await expect(
      __assignmentsListForStudentHandler(makeRequest()),
    ).rejects.toBe(err);
  });

  test("propagates claim-state-mismatch from district context", async () => {
    const err = new PlatformError(
      "claim-state-mismatch",
      "mismatch",
    );
    mockRequireDistrictContext.mockRejectedValue(err);
    await expect(
      __assignmentsListForStudentHandler(makeRequest()),
    ).rejects.toBe(err);
  });
});

describe("assignmentsListForStudent - request shape", () => {
  test("rejects payload containing forbidden studentId key", async () => {
    await expect(
      __assignmentsListForStudentHandler(
        makeRequest({ studentId: OTHER_UID }),
      ),
    ).rejects.toBeInstanceOf(PlatformError);
  });

  test("rejects array payload", async () => {
    mockRecipientsGet.mockResolvedValue({ docs: [] });
    await expect(
      __assignmentsListForStudentHandler(
        makeRequest([] as unknown as Record<string, unknown>),
      ),
    ).rejects.toBeInstanceOf(PlatformError);
  });

  test("accepts undefined payload", async () => {
    mockRecipientsGet.mockResolvedValue({ docs: [] });
    const res = await __assignmentsListForStudentHandler(
      makeRequest(undefined),
    );
    expect(res.items).toEqual([]);
  });
});

describe("assignmentsListForStudent - query shape", () => {
  test("queries the recipients collection group filtered by caller uid", async () => {
    mockRecipientsGet.mockResolvedValue({ docs: [] });
    await __assignmentsListForStudentHandler(makeRequest());
    expect(mockRecipientsCollectionGroupRef).toHaveBeenCalledTimes(1);
    expect(mockRecipientsWhere).toHaveBeenCalledWith(
      "studentId",
      "==",
      STUDENT_UID,
    );
  });

  test("empty result returns empty items array", async () => {
    mockRecipientsGet.mockResolvedValue({ docs: [] });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });
});

describe("assignmentsListForStudent - response filtering", () => {
  test("returns published assignment for authorized recipient", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a1")],
    });
    seedAssignment("a1");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([
      {
        assignmentId: "a1",
        lessonSlug: "lesson_g7_earths-layers",
        title: "Earth's Layers",
        status: "published",
        publishedAt: 1_700_000_000_000,
      },
    ]);
  });

  test("excludes recipient whose frozen studentId does not match caller", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a2", { studentId: OTHER_UID })],
    });
    seedAssignment("a2");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("excludes cross-district recipient defensively", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a3", { districtId: "other-district" })],
    });
    seedAssignment("a3");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("excludes cross-school recipient defensively", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a4", { schoolId: "other-school" })],
    });
    seedAssignment("a4");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("excludes recipient whose status is not 'assigned'", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a5", { status: "revoked" })],
    });
    seedAssignment("a5");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("excludes draft assignment", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a6")],
    });
    seedAssignment("a6", { status: "draft" });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("excludes closed assignment", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a7")],
    });
    seedAssignment("a7", { status: "closed" });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("excludes archived assignment", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a8")],
    });
    seedAssignment("a8", { status: "archived" });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("excludes practice-mode assignment", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a9")],
    });
    seedAssignment("a9", { mode: "practice" });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("excludes assignment whose ownership drifted from the recipient snapshot", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a10")],
    });
    seedAssignment("a10", { teacherId: "other-teacher" });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("excludes assignment whose schoolId drifted from caller school", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a11")],
    });
    seedAssignment("a11", { schoolId: "other-school" });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("excludes assignment whose classId drifted from recipient classId", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a12")],
    });
    seedAssignment("a12", { classId: "other-class" });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("gracefully drops recipient whose parent assignment is missing", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a13")],
    });
    // no seed
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("gracefully drops recipient whose lessonSlug is missing on the assignment", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a14")],
    });
    seedAssignment("a14", { lessonSlug: "" });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("gracefully drops malformed recipient record (empty assignmentId)", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("", { assignmentId: "" })],
    });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  test("gracefully drops recipient record whose data() returns undefined", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [{ data: () => undefined }],
    });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("dedupes duplicate recipient records for the same assignment", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a15"), recipientDoc("a15")],
    });
    seedAssignment("a15");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toHaveLength(1);
    expect(res.items[0].assignmentId).toBe("a15");
  });

  test("falls back to lessonSlug when title is missing", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a16")],
    });
    seedAssignment("a16", { title: "" });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items[0].title).toBe("lesson_g7_earths-layers");
  });

  test("projects publishedAt as null when the assignment record lacks a timestamp", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a17")],
    });
    seedAssignment("a17", { publishedAt: undefined });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items[0].publishedAt).toBeNull();
  });
});

describe("assignmentsListForStudent - projection safety", () => {
  test("returns no teacher, recipient, session, or answer-key fields", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a18")],
    });
    seedAssignment("a18");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    const keys = Object.keys(res.items[0]);
    for (const forbidden of [
      "teacherId",
      "classId",
      "className",
      "districtId",
      "schoolId",
      "studentId",
      "recipientId",
      "recipients",
      "attemptId",
      "sessionId",
      "answerKey",
      "explanation",
      "instructions",
      "windowClosesAt",
      "availableAt",
      "mode",
      "assessmentRevisionId",
      "lmsPublicationRef",
      "createdAt",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe("assignmentsListForStudent - ordering", () => {
  test("orders by publishedAt desc, then assignmentId asc as tiebreaker", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [
        recipientDoc("z"),
        recipientDoc("a"),
        recipientDoc("m"),
      ],
    });
    seedAssignment("z", {
      publishedAt: { toMillis: () => 1_000 },
    });
    seedAssignment("a", {
      publishedAt: { toMillis: () => 3_000 },
    });
    seedAssignment("m", {
      publishedAt: { toMillis: () => 3_000 },
    });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items.map((i) => i.assignmentId)).toEqual(["a", "m", "z"]);
  });

  test("orders null publishedAt after present publishedAt", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a"), recipientDoc("b")],
    });
    seedAssignment("a", { publishedAt: undefined });
    seedAssignment("b", {
      publishedAt: { toMillis: () => 5_000 },
    });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items.map((i) => i.assignmentId)).toEqual(["b", "a"]);
  });
});

// F5.2 Slice 4 - per-item Op C differentiation resolution on the list surface
// (§4 Op C, §7.1, §7.3). The resolver core is unit-tested separately; here we
// assert the SURFACE wiring: one resolver per call, one resolve per item for
// the authenticated student's own uid, correct additive-field attachment, and
// per-item degradation.
describe("assignmentsListForStudent - Slice 4 differentiation (Op C)", () => {
  test("attaches presentation + launchRef to a differentiated item", async () => {
    mockRecipientsGet.mockResolvedValue({ docs: [recipientDoc("a1")] });
    seedAssignment("a1");
    const presentation = {
      variantKey: "reading-adapted",
      presentationRevisionId: `pr${"a".repeat(64)}`,
      path: `app/lessons/variants/lesson_earths-layers__pr${"a".repeat(64)}.html`,
    };
    mockLaunchResolve.mockResolvedValue({
      kind: "differentiated",
      launchRef: "0123456789abcdef0123456789abcdef",
      presentation,
    });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items[0].presentation).toEqual(presentation);
    expect(res.items[0].launchRef).toBe("0123456789abcdef0123456789abcdef");
    // Resolved for the authenticated caller's uid and the item's own
    // (assignmentId, lessonSlug) - never a client-asserted identity.
    expect(mockLaunchResolve).toHaveBeenCalledWith({
      studentId: STUDENT_UID,
      assignmentId: "a1",
      lessonSlug: "lesson_g7_earths-layers",
    });
  });

  test("attaches launchRef only (no presentation) for a canonicalFallback item", async () => {
    mockRecipientsGet.mockResolvedValue({ docs: [recipientDoc("a1")] });
    seedAssignment("a1");
    mockLaunchResolve.mockResolvedValue({
      kind: "canonicalFallback",
      launchRef: "ffffffffffffffffffffffffffffffff",
      reason: "operationalDisable",
    });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items[0].launchRef).toBe("ffffffffffffffffffffffffffffffff");
    expect("presentation" in res.items[0]).toBe(false);
  });

  test("attaches nothing for a canonical-expected student (item shape unchanged)", async () => {
    mockRecipientsGet.mockResolvedValue({ docs: [recipientDoc("a1")] });
    seedAssignment("a1");
    mockLaunchResolve.mockResolvedValue({ kind: "expectedCanonical" });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect("presentation" in res.items[0]).toBe(false);
    expect("launchRef" in res.items[0]).toBe(false);
  });

  test("degrades one item to canonical on internal failure without failing the list", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a1"), recipientDoc("a2")],
    });
    seedAssignment("a1", { publishedAt: { toMillis: () => 2_000 } });
    seedAssignment("a2", { publishedAt: { toMillis: () => 1_000 } });
    mockLaunchResolve
      .mockResolvedValueOnce({ kind: "internalFailure" })
      .mockResolvedValueOnce({
        kind: "differentiated",
        launchRef: "0123456789abcdef0123456789abcdef",
        presentation: {
          variantKey: "reading-adapted",
          presentationRevisionId: `pr${"c".repeat(64)}`,
          path: `app/lessons/variants/lesson_earths-layers__pr${"c".repeat(64)}.html`,
        },
      });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toHaveLength(2);
    const a1 = res.items.find((i) => i.assignmentId === "a1");
    const a2 = res.items.find((i) => i.assignmentId === "a2");
    expect("launchRef" in (a1 as object)).toBe(false);
    expect(a2?.launchRef).toBe("0123456789abcdef0123456789abcdef");
  });

  test("creates exactly one resolver per call (memoized reads) across items", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a1"), recipientDoc("a2")],
    });
    seedAssignment("a1");
    seedAssignment("a2");
    await __assignmentsListForStudentHandler(makeRequest());
    expect(mockCreateLaunchResolver).toHaveBeenCalledTimes(1);
    expect(mockLaunchResolve).toHaveBeenCalledTimes(2);
  });

  test("refuses a client-asserted variantKey before any resolution", async () => {
    await expect(
      __assignmentsListForStudentHandler(
        makeRequest({ variantKey: "reading-adapted" }),
      ),
    ).rejects.toBeInstanceOf(PlatformError);
    expect(mockLaunchResolve).not.toHaveBeenCalled();
  });
});

describe("assignmentsListForStudent - Current-aware dashboard dedup (Sprint 30 cleanup)", () => {
  beforeEach(() => {
    // Reset the Current-pointer seam explicitly: `jest.clearAllMocks()` in
    // the outer beforeEach clears call history only, not a prior test's
    // `.mockResolvedValue` override, so a leaked pointer fixture could
    // otherwise bleed into the next test.
    mockCurrentDocGet.mockResolvedValue({ exists: false, data: () => undefined });
  });

  function seedCurrentPointer(
    classId: string,
    lessonSlug: string,
    assignmentId: string,
  ): void {
    mockCurrentDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        classId,
        lessonSlug,
        assignmentId,
        teacherId: TEACHER_UID,
        schoolId: SCHOOL_ID,
        setAt: { __sentinel: "timestamp" },
        setBy: TEACHER_UID,
        source: "teacherResolution",
      }),
    });
  }

  test("one published assignment with no Current pointer -> one operational item (resolved, legacy state kept)", async () => {
    mockRecipientsGet.mockResolvedValue({ docs: [recipientDoc("a1")] });
    seedAssignment("a1");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toHaveLength(1);
    expect(res.supersededAssignmentIds).toEqual([]);
    // A student's item set is recipient-scoped, so even a single visible
    // occurrence is resolved against the canonical pointer.
    expect(mockAssignmentsCurrentDocRef).toHaveBeenCalledTimes(1);
  });

  test("four historical published occurrences + valid Current (not the newest) -> exactly one item representing Current", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [
        recipientDoc("a-0909"),
        recipientDoc("a-0910"),
        recipientDoc("a-0956"),
        recipientDoc("a-1016"),
      ],
    });
    seedAssignment("a-0909", { publishedAt: { toMillis: () => 1 } });
    seedAssignment("a-0910", { publishedAt: { toMillis: () => 2 } });
    seedAssignment("a-0956", { publishedAt: { toMillis: () => 3 } });
    seedAssignment("a-1016", { publishedAt: { toMillis: () => 4 } });
    // Known production example: Current is the SECOND occurrence, not the
    // newest - proves resolution is by the canonical pointer, never recency.
    seedCurrentPointer(CLASS_ID, "lesson_g7_earths-layers", "a-0910");

    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.assignmentId).toBe("a-0910");
  });

  test("multiple published + NO valid Current -> every occurrence stays visible (no heuristic ever chosen)", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a-0909"), recipientDoc("a-0910")],
    });
    seedAssignment("a-0909");
    seedAssignment("a-0910");
    // mockCurrentDocGet default (reset above): pointer missing.
    const res = await __assignmentsListForStudentHandler(makeRequest());
    const ids = res.items.map((i) => i.assignmentId).sort();
    expect(ids).toEqual(["a-0909", "a-0910"]);
  });

  test("multiple published + a stale/invalid Current pointer -> every occurrence stays visible", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a-0909"), recipientDoc("a-0910")],
    });
    seedAssignment("a-0909");
    seedAssignment("a-0910");
    // Pointer names an assignment id not present in the registry at all
    // (e.g. a closed/deleted/cross-scope record) - assignmentMissing.
    seedCurrentPointer(CLASS_ID, "lesson_g7_earths-layers", "a-gone");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    const ids = res.items.map((i) => i.assignmentId).sort();
    expect(ids).toEqual(["a-0909", "a-0910"]);
  });

  test("same lesson in two different classes does NOT collapse", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [
        recipientDoc("a-classA", { classId: "class-a" }),
        recipientDoc("a-classB", { classId: "class-b" }),
      ],
    });
    seedAssignment("a-classA", { classId: "class-a" });
    seedAssignment("a-classB", { classId: "class-b" });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    const ids = res.items.map((i) => i.assignmentId).sort();
    expect(ids).toEqual(["a-classA", "a-classB"]);
  });

  test("two different lessons in one class do NOT collapse", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a-lesson1"), recipientDoc("a-lesson2")],
    });
    seedAssignment("a-lesson1", { lessonSlug: "lesson_g7_earths-layers" });
    seedAssignment("a-lesson2", { lessonSlug: "lesson_g7_water-cycle" });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    const ids = res.items.map((i) => i.assignmentId).sort();
    expect(ids).toEqual(["a-lesson1", "a-lesson2"]);
  });

  test("the collapsed item carries no classId/teacherId/schoolId - only the additive related-occurrence ids", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a-0909"), recipientDoc("a-0910")],
    });
    seedAssignment("a-0909");
    seedAssignment("a-0910");
    seedCurrentPointer(CLASS_ID, "lesson_g7_earths-layers", "a-0910");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([
      {
        assignmentId: "a-0910",
        lessonSlug: "lesson_g7_earths-layers",
        title: "Earth's Layers",
        status: "published",
        publishedAt: 1_700_000_000_000,
        // Reassignment model: the superseded occurrence whose attempts
        // belong to this tile's cumulative history.
        relatedAssignmentIds: ["a-0909"],
      },
    ]);
  });
});

// Production defect regression (Sprint 30): the (A) Science Engineering
// Design fixture. Four published occurrences share one class+lesson; the
// teacher-selected Current is the SECOND (Sep 15 9:10 AM), not the newest.
// The student holds recipient membership on all four and (as in production)
// completed attempts on all four, so the surface depends on BOTH the
// operational items and `supersededAssignmentIds` (see the My Science
// surface test that consumes this exact response).
describe("assignmentsListForStudent - strict Current + scheduled availability", () => {
  const LESSON = "engineering-design";
  const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
  const HOUR = 60 * 60 * 1000;
  const at = (ms: number) => ({ toMillis: () => ms });

  // Per-(class, lesson) pointer registry so several classes can carry
  // independent Current pointers in one call.
  const pointers = new Map<string, string>();
  function seedPointer(classId: string, lessonSlug: string, assignmentId: string) {
    pointers.set(`${classId}/${lessonSlug}`, assignmentId);
  }

  let nowSpy: jest.SpyInstance<number, []>;
  beforeEach(() => {
    pointers.clear();
    nowSpy = jest.spyOn(Date, "now").mockReturnValue(NOW);
    mockAssignmentsCurrentDocRef.mockImplementation(
      (classId: string, lessonSlug: string) => ({
        get: () => {
          const assignmentId = pointers.get(`${classId}/${lessonSlug}`);
          if (assignmentId === undefined) {
            return Promise.resolve({ exists: false, data: () => undefined });
          }
          return Promise.resolve({
            exists: true,
            data: () => ({
              classId,
              lessonSlug,
              assignmentId,
              teacherId: TEACHER_UID,
              schoolId: SCHOOL_ID,
              setAt: { __sentinel: "timestamp" },
              setBy: TEACHER_UID,
              source: "teacherResolution",
            }),
          });
        },
      }),
    );
  });
  afterEach(() => {
    nowSpy.mockRestore();
    mockAssignmentsCurrentDocRef.mockImplementation(() => ({
      get: mockCurrentDocGet,
    }));
  });

  function seedFixture(overrides: Partial<Record<string, AssignmentOverrides>> = {}) {
    mockRecipientsGet.mockResolvedValue({
      docs: [
        recipientDoc("a-0909"),
        recipientDoc("a-0910"),
        recipientDoc("a-0956"),
        recipientDoc("a-1016"),
      ],
    });
    seedAssignment("a-0909", { lessonSlug: LESSON, publishedAt: at(1), ...overrides["a-0909"] });
    seedAssignment("a-0910", { lessonSlug: LESSON, publishedAt: at(2), ...overrides["a-0910"] });
    seedAssignment("a-0956", { lessonSlug: LESSON, publishedAt: at(3), ...overrides["a-0956"] });
    seedAssignment("a-1016", { lessonSlug: LESSON, publishedAt: at(4), ...overrides["a-1016"] });
  }

  test("production fixture: valid Current -> exactly one operational item carrying the three superseded occurrences as its history", async () => {
    seedFixture();
    seedPointer(CLASS_ID, LESSON, "a-0910");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items.map((i) => i.assignmentId)).toEqual(["a-0910"]);
    expect(res.items[0]?.relatedAssignmentIds).toEqual(["a-0909", "a-0956", "a-1016"]);
    expect(res.supersededAssignmentIds).toEqual(["a-0909", "a-0956", "a-1016"]);
  });

  test("three reassignments incl. a CLOSED older occurrence: one tile; the closed occurrence's history still belongs to it", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a-A"), recipientDoc("a-B"), recipientDoc("a-C")],
    });
    seedAssignment("a-A", { lessonSlug: LESSON, status: "closed" });
    seedAssignment("a-B", { lessonSlug: LESSON });
    seedAssignment("a-C", { lessonSlug: LESSON });
    seedPointer(CLASS_ID, LESSON, "a-C");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items.map((i) => i.assignmentId)).toEqual(["a-C"]);
    expect(res.items[0]?.relatedAssignmentIds).toEqual(["a-A", "a-B"]);
    expect(res.supersededAssignmentIds).toEqual(["a-A", "a-B"]);
  });

  test("an occurrence in another class sharing the lesson is never pulled into this group", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [
        recipientDoc("a-old"),
        recipientDoc("a-cur"),
        recipientDoc("b-1", { classId: "class-b" }),
      ],
    });
    seedAssignment("a-old", { lessonSlug: LESSON });
    seedAssignment("a-cur", { lessonSlug: LESSON });
    seedAssignment("b-1", { lessonSlug: LESSON, classId: "class-b" });
    seedPointer(CLASS_ID, LESSON, "a-cur");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    const byId = new Map(res.items.map((i) => [i.assignmentId, i]));
    expect(Array.from(byId.keys()).sort()).toEqual(["a-cur", "b-1"]);
    expect(byId.get("a-cur")?.relatedAssignmentIds).toEqual(["a-old"]);
    expect(byId.get("b-1")?.relatedAssignmentIds).toBeUndefined();
  });

  test("missing Current pointer -> every occurrence stays operational and nothing is superseded (no heuristic)", async () => {
    seedFixture();
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items.map((i) => i.assignmentId).sort()).toEqual([
      "a-0909",
      "a-0910",
      "a-0956",
      "a-1016",
    ]);
    expect(res.supersededAssignmentIds).toEqual([]);
  });

  test("pointer naming a MISSING assignment is not authoritative -> legacy: every published occurrence stays listed", async () => {
    seedFixture();
    seedPointer(CLASS_ID, LESSON, "a-gone");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toHaveLength(4);
    expect(res.supersededAssignmentIds).toEqual([]);
    expect(res.historyOnlyGroups).toEqual([]);
  });

  test("closing a managed Current: NO operational item, no older occurrence resurrected, history kept as ONE group", async () => {
    // Four older published occurrences plus the Current, which the teacher
    // has since closed. The pointer still names it (authoritative).
    seedFixture();
    mockRecipientsGet.mockResolvedValue({
      docs: ["a-0909", "a-0910", "a-0956", "a-1016", "a-cur"].map((id) => recipientDoc(id)),
    });
    seedAssignment("a-cur", { lessonSlug: LESSON, status: "closed" });
    seedPointer(CLASS_ID, LESSON, "a-cur");
    const before = JSON.stringify(
      Array.from(assignmentRegistry.entries()).map(([id, snap]) => [id, snap.data()]),
    );

    const res = await __assignmentsListForStudentHandler(makeRequest());

    expect(res.items).toEqual([]);
    expect(res.supersededAssignmentIds).toEqual([]);
    expect(res.historyOnlyGroups).toEqual([
      { assignmentIds: ["a-0909", "a-0910", "a-0956", "a-1016", "a-cur"] },
    ]);
    // Read-only: no historical record was rewritten.
    expect(
      JSON.stringify(
        Array.from(assignmentRegistry.entries()).map(([id, snap]) => [id, snap.data()]),
      ),
    ).toBe(before);
  });

  test("closing Current in one class never affects a legacy (never-managed) class with the same lesson", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [
        recipientDoc("a-cur"),
        recipientDoc("a-old"),
        recipientDoc("b-1", { classId: "class-b" }),
        recipientDoc("b-2", { classId: "class-b" }),
      ],
    });
    seedAssignment("a-cur", { lessonSlug: LESSON, status: "closed" });
    seedAssignment("a-old", { lessonSlug: LESSON });
    seedAssignment("b-1", { lessonSlug: LESSON, classId: "class-b" });
    seedAssignment("b-2", { lessonSlug: LESSON, classId: "class-b" });
    seedPointer(CLASS_ID, LESSON, "a-cur");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items.map((i) => i.assignmentId).sort()).toEqual(["b-1", "b-2"]);
    expect(res.historyOnlyGroups).toEqual([{ assignmentIds: ["a-cur", "a-old"] }]);
  });

  test("valid Current the student is not a recipient of -> no older occurrence is offered as a substitute", async () => {
    mockRecipientsGet.mockResolvedValue({ docs: [recipientDoc("a-0909")] });
    seedAssignment("a-0909", { lessonSlug: LESSON });
    // Current exists and is valid, but the student holds no recipient row.
    seedAssignment("a-0910", { lessonSlug: LESSON });
    seedPointer(CLASS_ID, LESSON, "a-0910");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
    expect(res.supersededAssignmentIds).toEqual(["a-0909"]);
  });

  test("future availableAt -> hidden from the list before the instant", async () => {
    mockRecipientsGet.mockResolvedValue({ docs: [recipientDoc("a-sched")] });
    seedAssignment("a-sched", { lessonSlug: LESSON, availableAt: at(NOW + HOUR) });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
    expect(res.supersededAssignmentIds).toEqual([]);
  });

  test("availableAt reached exactly, or already passed -> listed normally", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a-exact"), recipientDoc("a-past")],
    });
    seedAssignment("a-exact", { lessonSlug: "lesson-one", availableAt: at(NOW) });
    seedAssignment("a-past", { lessonSlug: "lesson-two", availableAt: at(NOW - HOUR) });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items.map((i) => i.assignmentId).sort()).toEqual(["a-exact", "a-past"]);
  });

  test("the same assignment becomes available once the clock passes availableAt", async () => {
    mockRecipientsGet.mockResolvedValue({ docs: [recipientDoc("a-sched")] });
    seedAssignment("a-sched", { lessonSlug: LESSON, availableAt: at(NOW + HOUR) });
    expect((await __assignmentsListForStudentHandler(makeRequest())).items).toEqual([]);
    nowSpy.mockReturnValue(NOW + HOUR);
    const later = await __assignmentsListForStudentHandler(makeRequest());
    expect(later.items.map((i) => i.assignmentId)).toEqual(["a-sched"]);
  });

  test("absent availableAt (untouched default Date/Time) -> immediately available", async () => {
    mockRecipientsGet.mockResolvedValue({ docs: [recipientDoc("a-now")] });
    seedAssignment("a-now", { lessonSlug: LESSON });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items.map((i) => i.assignmentId)).toEqual(["a-now"]);
  });

  test("malformed availableAt fails closed (hidden), never treated as available", async () => {
    mockRecipientsGet.mockResolvedValue({ docs: [recipientDoc("a-bad")] });
    seedAssignment("a-bad", { lessonSlug: LESSON, availableAt: "2026-09-23" });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("future-scheduled Current stays Current: hidden, and no older occurrence is exposed in its place", async () => {
    seedFixture({ "a-1016": { availableAt: at(NOW + HOUR) } });
    seedPointer(CLASS_ID, LESSON, "a-1016");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
    expect(res.supersededAssignmentIds).toEqual(["a-0909", "a-0910", "a-0956"]);

    nowSpy.mockReturnValue(NOW + HOUR);
    const later = await __assignmentsListForStudentHandler(makeRequest());
    expect(later.items.map((i) => i.assignmentId)).toEqual(["a-1016"]);
    // At/after availability the one Current tile carries the full history.
    expect(later.items[0]?.relatedAssignmentIds).toEqual(["a-0909", "a-0910", "a-0956"]);
  });

  test("a not-yet-available superseded occurrence is never disclosed in supersededAssignmentIds", async () => {
    seedFixture({ "a-1016": { availableAt: at(NOW + HOUR) } });
    seedPointer(CLASS_ID, LESSON, "a-0910");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items.map((i) => i.assignmentId)).toEqual(["a-0910"]);
    expect(res.items[0]?.relatedAssignmentIds).toEqual(["a-0909", "a-0956"]);
    expect(res.supersededAssignmentIds).toEqual(["a-0909", "a-0956"]);
  });

  test("per-class schedules are independent: same lesson, one class future, one class available", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [
        recipientDoc("a-classA", { classId: "class-a" }),
        recipientDoc("a-classB", { classId: "class-b" }),
      ],
    });
    seedAssignment("a-classA", {
      classId: "class-a",
      lessonSlug: LESSON,
      availableAt: at(NOW + HOUR),
    });
    seedAssignment("a-classB", {
      classId: "class-b",
      lessonSlug: LESSON,
      availableAt: at(NOW - HOUR),
    });
    seedPointer("class-a", LESSON, "a-classA");
    seedPointer("class-b", LESSON, "a-classB");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items.map((i) => i.assignmentId)).toEqual(["a-classB"]);
  });

  test("response carries no availableAt or scheduling field on items", async () => {
    mockRecipientsGet.mockResolvedValue({ docs: [recipientDoc("a-past")] });
    seedAssignment("a-past", { lessonSlug: LESSON, availableAt: at(NOW - HOUR) });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(Object.keys(res.items[0] as object).sort()).toEqual([
      "assignmentId",
      "lessonSlug",
      "publishedAt",
      "status",
      "title",
    ]);
    expect(Object.keys(res).sort()).toEqual([
      "historyOnlyGroups",
      "items",
      "supersededAssignmentIds",
    ]);
  });
});
