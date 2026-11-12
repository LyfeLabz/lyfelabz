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

// Teacher Units Expansion P1: the unit projection's policy gate and its
// Firestore seams. Default policy is "closed", so every pre-existing test
// sees `units: []` and is otherwise unchanged.
const mockReadUnitPolicy: jest.Mock = jest.fn(() => Promise.resolve("closed"));
const unitRegistry = new Map<string, Record<string, unknown>>();
const classRegistry = new Map<string, Record<string, unknown>>();
const mockUnitQueryGet: jest.Mock = jest.fn();
const mockTeacherUnitsCollectionRef: jest.Mock = jest.fn(() => {
  const filters: Array<[string, unknown]> = [];
  const query = {
    where: (field: string, _op: string, value: unknown) => {
      filters.push([field, value]);
      return query;
    },
    limit: () => query,
    get: () => mockUnitQueryGet(filters),
  };
  return query;
});
const mockClassDocRef: jest.Mock = jest.fn((classId: string) => ({
  get: () => {
    const data = classRegistry.get(classId);
    return Promise.resolve({ exists: data !== undefined, data: () => data });
  },
}));

jest.mock("./teacher-unit-projection-policy", () => ({
  readTeacherUnitProjectionPolicy: () => mockReadUnitPolicy(),
}));

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
    classDocRef: mockClassDocRef,
    teacherUnitsCollectionRef: mockTeacherUnitsCollectionRef,
    isTeacherUnitColor: jest.requireActual("../shared/types/teacher-unit").isTeacherUnitColor,
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
  assessmentRevisionId: string;
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
  mockReadUnitPolicy.mockResolvedValue("closed");
  unitRegistry.clear();
  classRegistry.clear();
  mockUnitQueryGet.mockImplementation((filters: Array<[string, unknown]>) =>
    Promise.resolve({
      docs: Array.from(unitRegistry.entries())
        .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
        .map(([id, data]) => ({ id, data: () => data })),
    }),
  );
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
      // F5.3 Slice 9C-1: `assessmentRevisionId` is now a deliberate, additive
      // item field (addendum 21.5), covered below; it is no longer excluded.
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

  test("different lessons in one class: publishing a newer lesson never supersedes an older lesson, and only a same-lesson reassignment does", async () => {
    // Lesson A published first; lesson B published later and then
    // deliberately reassigned (b-old -> b-cur). Each lesson has its own
    // managed Current. Older lesson A stays published, listed, and
    // launchable; only b-old (the same-lesson earlier occurrence) is
    // superseded.
    const OTHER = "lesson_g7_water-cycle";
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a-1"), recipientDoc("b-old"), recipientDoc("b-cur")],
    });
    seedAssignment("a-1", { lessonSlug: LESSON, publishedAt: at(1) });
    seedAssignment("b-old", { lessonSlug: OTHER, publishedAt: at(2) });
    seedAssignment("b-cur", { lessonSlug: OTHER, publishedAt: at(3) });
    seedPointer(CLASS_ID, LESSON, "a-1");
    seedPointer(CLASS_ID, OTHER, "b-cur");

    const res = await __assignmentsListForStudentHandler(makeRequest());

    // Newest publish first; attempt activity never participates in order.
    expect(res.items.map((i) => i.assignmentId)).toEqual(["b-cur", "a-1"]);
    const older = res.items.find((i) => i.assignmentId === "a-1");
    expect(older?.status).toBe("published");
    expect(older?.relatedAssignmentIds).toBeUndefined();
    expect(res.items.find((i) => i.assignmentId === "b-cur")?.relatedAssignmentIds).toEqual(["b-old"]);
    expect(res.supersededAssignmentIds).toEqual(["b-old"]);
    expect(res.historyOnlyGroups).toEqual([]);
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
      "units",
    ]);
  });
});

// F5.3 Slice 9C-1 (addendum 21.5): every launchable item carries the
// assignment's FROZEN assessment revision, for every student and every
// delivery outcome, read from the assignment record; a client can never name
// one, and an unusable stored value is omitted rather than guessed.
describe("assignmentsListForStudent - frozen assessment revision (F5.3 Slice 9C-1)", () => {
  const SLUG = "earths-layers";
  const R1 = `assessment_${SLUG}__r1`;
  const R2 = `assessment_${SLUG}__r2`;

  test("an r1 assignment returns r1 and resolves coverage against it", async () => {
    mockRecipientsGet.mockResolvedValue({ docs: [recipientDoc("a1")] });
    seedAssignment("a1", { lessonSlug: SLUG, assessmentRevisionId: R1 });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items[0].assessmentRevisionId).toBe(R1);
    expect(mockLaunchResolve).toHaveBeenCalledWith({
      studentId: STUDENT_UID,
      assignmentId: "a1",
      lessonSlug: SLUG,
      assessmentRevisionId: R1,
    });
  });

  test("r1 and synthetic r2 assignments of one lesson each keep their own frozen revision", async () => {
    mockRecipientsGet.mockResolvedValue({ docs: [recipientDoc("a1"), recipientDoc("a2", { classId: "class-b" })] });
    seedAssignment("a1", { lessonSlug: SLUG, assessmentRevisionId: R1, publishedAt: { toMillis: () => 2_000 } });
    seedAssignment("a2", { lessonSlug: SLUG, assessmentRevisionId: R2, classId: "class-b", publishedAt: { toMillis: () => 1_000 } });
    mockLaunchResolve
      .mockResolvedValueOnce({ kind: "expectedCanonical" })
      .mockResolvedValueOnce({ kind: "canonicalFallback", launchRef: "f".repeat(32), reason: "coverageAssessmentMismatch" });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    const byId = Object.fromEntries(res.items.map((i) => [i.assignmentId, i]));
    expect(byId.a1.assessmentRevisionId).toBe(R1);
    // canonicalFallback still carries the frozen r2 for revision-bound routing.
    expect(byId.a2.assessmentRevisionId).toBe(R2);
    expect(byId.a2.launchRef).toBe("f".repeat(32));
    expect("presentation" in byId.a2).toBe(false);
  });

  test("a differentiated r1 item keeps its provenance alongside the frozen revision", async () => {
    mockRecipientsGet.mockResolvedValue({ docs: [recipientDoc("a1")] });
    seedAssignment("a1", { lessonSlug: SLUG, assessmentRevisionId: R1 });
    const presentation = {
      variantKey: "reading-adapted",
      presentationRevisionId: "pr90f52136d39f36d21bf1602d0af3901adf0eae32a046c522907c5e932f342189",
      path: "app/lessons/variants/lesson_earths-layers__pr90f52136d39f36d21bf1602d0af3901adf0eae32a046c522907c5e932f342189.html",
    };
    mockLaunchResolve.mockResolvedValue({ kind: "differentiated", launchRef: "0".repeat(32), presentation });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items[0]).toMatchObject({ presentation, launchRef: "0".repeat(32), assessmentRevisionId: R1 });
  });

  test.each([
    ["missing", undefined],
    ["another lesson's revision", "assessment_water-cycle__r1"],
    ["a non-canonical ordinal", `assessment_${SLUG}__r0`],
  ])("a %s frozen revision is omitted, never guessed", async (_label, value) => {
    mockRecipientsGet.mockResolvedValue({ docs: [recipientDoc("a1")] });
    seedAssignment("a1", { lessonSlug: SLUG, ...(value !== undefined ? { assessmentRevisionId: value } : {}) });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect("assessmentRevisionId" in res.items[0]).toBe(false);
    expect("assessmentRevisionId" in mockLaunchResolve.mock.calls[0][0]).toBe(false);
  });

  test("refuses a client-supplied assessmentRevisionId", async () => {
    await expect(
      __assignmentsListForStudentHandler(makeRequest({ assessmentRevisionId: R2 })),
    ).rejects.toMatchObject({ code: expect.any(String) });
    expect(mockLaunchResolve).not.toHaveBeenCalled();
  });
});

// Teacher Units Expansion P1: read-only projection of the class owner's
// current active units onto the cards this response already returns.
describe("assignmentsListForStudent - Teacher Units projection (P1)", () => {
  const L1 = "lesson_alpha";
  const L2 = "lesson_beta";
  const L3 = "lesson_gamma";
  const OTHER_TEACHER = "teacher-2";
  const CLASS_B = "class-b";

  function seedClass(classId: string, overrides: Record<string, unknown> = {}) {
    classRegistry.set(classId, {
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      title: "Science",
      status: "active",
      grade: "7",
      block: "A",
      createdAt: {},
      ...overrides,
    });
  }

  function seedUnit(unitId: string, overrides: Record<string, unknown> = {}) {
    unitRegistry.set(unitId, {
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      grade: "7",
      title: `Title ${unitId}`,
      description: "SECRET DESCRIPTION",
      color: "teal",
      status: "active",
      archivedAt: null,
      createdAt: { toMillis: () => 1 },
      updatedAt: { toMillis: () => 1 },
      resourceIds: [],
      sortOrder: 1,
      revision: 3,
      ...overrides,
    });
  }

  function seedWork(entries: Array<[string, string, RecipientOverrides?]>) {
    mockRecipientsGet.mockResolvedValue({
      docs: entries.map(([id, , overrides]) => recipientDoc(id, overrides ?? {})),
    });
    for (const [id, lessonSlug, overrides] of entries) {
      seedAssignment(id, {
        lessonSlug,
        ...(overrides?.classId ? { classId: overrides.classId } : {}),
        ...(overrides?.teacherId ? { teacherId: overrides.teacherId } : {}),
      });
    }
  }

  beforeEach(() => {
    mockReadUnitPolicy.mockResolvedValue("enabled");
    seedClass(CLASS_ID);
  });

  test("single teacher, class and unit", async () => {
    seedWork([["a1", L1]]);
    seedUnit("u1", { resourceIds: [L1] });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.units).toEqual([
      { unitId: "u1", title: "Title u1", color: "teal", assignmentIds: ["a1"] },
    ]);
  });

  test("units follow teacher order (sortOrder, createdAt, unitId); resources follow resourceIds order", async () => {
    seedWork([["a1", L1], ["a2", L2], ["a3", L3]]);
    seedUnit("u-late", { sortOrder: 2, resourceIds: [L1] });
    seedUnit("u-first", { sortOrder: 1, resourceIds: [L3, L2] });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.units.map((u) => [u.unitId, u.assignmentIds])).toEqual([
      ["u-first", ["a3", "a2"]],
      ["u-late", ["a1"]],
    ]);
  });

  test("an assignment matching several units is placed once, in the first unit in teacher order", async () => {
    seedWork([["a1", L1]]);
    seedUnit("u-b", { sortOrder: 1, createdAt: { toMillis: () => 5 }, resourceIds: [L1] });
    seedUnit("u-a", { sortOrder: 1, createdAt: { toMillis: () => 5 }, resourceIds: [L1] });
    seedUnit("u-0", { sortOrder: 3, resourceIds: [L1] });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.units).toEqual([
      expect.objectContaining({ unitId: "u-a", assignmentIds: ["a1"] }),
    ]);
  });

  test("multiple classes are never merged into one entry, even for the same owner and unit", async () => {
    seedClass(CLASS_B);
    seedWork([["a1", L1], ["b1", L1, { classId: CLASS_B }]]);
    seedUnit("u1", { resourceIds: [L1] });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.units.map((u) => [u.unitId, u.assignmentIds])).toEqual([
      ["u1", ["a1"]],
      ["u1", ["b1"]],
    ]);
  });

  test("multiple teachers: each class uses only its own owner's units", async () => {
    seedClass(CLASS_B, { teacherId: OTHER_TEACHER });
    seedWork([["a1", L1], ["b1", L1, { classId: CLASS_B, teacherId: OTHER_TEACHER }]]);
    seedUnit("u-mine", { resourceIds: [L1] });
    seedUnit("u-other", { teacherId: OTHER_TEACHER, resourceIds: [L1] });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.units.map((u) => [u.unitId, u.assignmentIds])).toEqual([
      ["u-mine", ["a1"]],
      ["u-other", ["b1"]],
    ]);
  });

  test("grade filtering: a unit for another grade is never exposed", async () => {
    seedWork([["a1", L1]]);
    seedUnit("u-g6", { grade: "6", resourceIds: [L1] });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.units).toEqual([]);
  });

  test("school filtering: the owner's units at another school are never read into the projection", async () => {
    seedWork([["a1", L1]]);
    seedUnit("u-old-school", { schoolId: "school-z", resourceIds: [L1] });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.units).toEqual([]);
    const [filters] = mockUnitQueryGet.mock.calls[0] as [Array<[string, unknown]>];
    expect(filters).toEqual([["teacherId", TEACHER_UID], ["schoolId", SCHOOL_ID]]);
  });

  test("archived units are excluded; their assignments fall back to a later active unit or stay ungrouped", async () => {
    seedWork([["a1", L1], ["a2", L2]]);
    seedUnit("u-arch", { status: "archived", sortOrder: 1, resourceIds: [L1, L2] });
    seedUnit("u-act", { sortOrder: 2, resourceIds: [L2] });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.units.map((u) => [u.unitId, u.assignmentIds])).toEqual([["u-act", ["a2"]]]);
  });

  test("unassigned resources, descriptions and resourceIds never cross the boundary; empty units omitted", async () => {
    seedWork([["a1", L1]]);
    seedUnit("u1", { resourceIds: ["lesson_unassigned", L1, "simulation_gravity-wells"] });
    seedUnit("u-empty", { sortOrder: 0, resourceIds: ["lesson_unassigned"] });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.units).toEqual([
      { unitId: "u1", title: "Title u1", color: "teal", assignmentIds: ["a1"] },
    ]);
    const json = JSON.stringify(res);
    expect(json).not.toContain("lesson_unassigned");
    expect(json).not.toContain("gravity-wells");
    expect(json).not.toContain("SECRET DESCRIPTION");
    expect(json).not.toContain(TEACHER_UID);
    expect(json).not.toContain(SCHOOL_ID);
  });

  test("policy closed -> empty units, no unit or class reads, items unchanged", async () => {
    seedWork([["a1", L1]]);
    seedUnit("u1", { resourceIds: [L1] });
    mockReadUnitPolicy.mockResolvedValue("enabled");
    const open = await __assignmentsListForStudentHandler(makeRequest());
    mockReadUnitPolicy.mockResolvedValue("closed");
    mockUnitQueryGet.mockClear();
    mockClassDocRef.mockClear();
    const closed = await __assignmentsListForStudentHandler(makeRequest());
    expect(closed.units).toEqual([]);
    expect(mockUnitQueryGet).not.toHaveBeenCalled();
    expect(mockClassDocRef).not.toHaveBeenCalled();
    expect(closed.items).toEqual(open.items);
    expect(closed.supersededAssignmentIds).toEqual(open.supersededAssignmentIds);
    expect(closed.historyOnlyGroups).toEqual(open.historyOnlyGroups);
  });

  test("no matching units -> empty units, items unchanged", async () => {
    seedWork([["a1", L1]]);
    seedUnit("u1", { resourceIds: [L2] });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.units).toEqual([]);
    expect(res.items.map((i) => i.assignmentId)).toEqual(["a1"]);
  });

  test("policy read failure or unit read failure degrades to empty units without failing the list", async () => {
    seedWork([["a1", L1]]);
    seedUnit("u1", { resourceIds: [L1] });
    mockReadUnitPolicy.mockRejectedValueOnce(new Error("unavailable"));
    const a = await __assignmentsListForStudentHandler(makeRequest());
    expect(a.units).toEqual([]);
    expect(a.items).toHaveLength(1);
    mockUnitQueryGet.mockRejectedValueOnce(new Error("unavailable"));
    const b = await __assignmentsListForStudentHandler(makeRequest());
    expect(b.units).toEqual([]);
    expect(b.items).toHaveLength(1);
  });

  test("class ownership/school mismatch or needsSetup class -> no units for that class", async () => {
    seedWork([["a1", L1]]);
    seedUnit("u1", { resourceIds: [L1] });
    seedClass(CLASS_ID, { teacherId: OTHER_TEACHER });
    expect((await __assignmentsListForStudentHandler(makeRequest())).units).toEqual([]);
    seedClass(CLASS_ID, { schoolId: "school-z" });
    expect((await __assignmentsListForStudentHandler(makeRequest())).units).toEqual([]);
    classRegistry.set(CLASS_ID, { teacherId: TEACHER_UID, schoolId: SCHOOL_ID, status: "needsSetup" });
    expect((await __assignmentsListForStudentHandler(makeRequest())).units).toEqual([]);
    classRegistry.delete(CLASS_ID);
    expect((await __assignmentsListForStudentHandler(makeRequest())).units).toEqual([]);
  });

  test("archived class keeps its grade, so its work is still organized", async () => {
    seedClass(CLASS_ID, { status: "archived" });
    seedWork([["a1", L1]]);
    seedUnit("u1", { resourceIds: [L1] });
    expect((await __assignmentsListForStudentHandler(makeRequest())).units).toHaveLength(1);
  });

  test("differentiation metadata and assignment ids are preserved alongside units", async () => {
    seedWork([["a1", L1]]);
    seedUnit("u1", { resourceIds: [L1] });
    mockLaunchResolve.mockResolvedValue({
      kind: "differentiated",
      presentation: { variantKey: "v" },
      launchRef: "ref-1",
    });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items[0]).toMatchObject({
      assignmentId: "a1",
      presentation: { variantKey: "v" },
      launchRef: "ref-1",
    });
    expect(res.units[0]?.assignmentIds).toEqual(["a1"]);
  });

  test("a recipient or assignment the student cannot see is never placed (no visibility expansion)", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a1"), recipientDoc("x-other", { studentId: OTHER_UID })],
    });
    seedAssignment("a1", { lessonSlug: L1 });
    seedAssignment("x-other", { lessonSlug: L2 });
    seedAssignment("x-draft", { lessonSlug: L3, status: "draft" });
    seedUnit("u1", { resourceIds: [L1, L2, L3] });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.units).toEqual([expect.objectContaining({ assignmentIds: ["a1"] })]);
  });

  test("unit reads run concurrently with presentation resolution (not after it)", async () => {
    seedWork([["a1", L1]]);
    seedUnit("u1", { resourceIds: [L1] });
    let unitQueryStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      unitQueryStarted = resolve;
    });
    const base = mockUnitQueryGet.getMockImplementation() as (f: unknown) => unknown;
    mockUnitQueryGet.mockImplementation((filters: unknown) => {
      unitQueryStarted();
      return base(filters);
    });
    // Resolution completes only once the unit query has been issued; a
    // sequential implementation would never get there.
    mockLaunchResolve.mockImplementation(() =>
      Promise.race([
        started.then(() => ({ kind: "expectedCanonical" })),
        new Promise((_, reject) => setTimeout(() => reject(new Error("projection not concurrent")), 2000)),
      ]),
    );
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.units).toEqual([expect.objectContaining({ assignmentIds: ["a1"] })]);
  });

  test("authorization failure still throws before any unit read", async () => {
    const err = new PlatformError("claim-stale", "stale claim");
    mockRequireDistrictContext.mockRejectedValue(err);
    await expect(__assignmentsListForStudentHandler(makeRequest())).rejects.toBe(err);
    expect(mockReadUnitPolicy).not.toHaveBeenCalled();
    expect(mockUnitQueryGet).not.toHaveBeenCalled();
  });

  describe("Current occurrences", () => {
    const pointers = new Map<string, string>();
    beforeEach(() => {
      pointers.clear();
      mockAssignmentsCurrentDocRef.mockImplementation((classId: string, lessonSlug: string) => ({
        get: () => {
          const assignmentId = pointers.get(`${classId}/${lessonSlug}`);
          return Promise.resolve(
            assignmentId === undefined
              ? { exists: false, data: () => undefined }
              : {
                  exists: true,
                  data: () => ({
                    classId, lessonSlug, assignmentId, teacherId: TEACHER_UID, schoolId: SCHOOL_ID,
                    setAt: {}, setBy: TEACHER_UID, source: "teacherResolution",
                  }),
                },
          );
        },
      }));
    });
    afterEach(() => {
      mockAssignmentsCurrentDocRef.mockImplementation(() => ({ get: mockCurrentDocGet }));
    });

    test("superseded occurrences are never placed; only the Current item's card is", async () => {
      seedWork([["old-1", L1], ["old-2", L1], ["cur", L1]]);
      pointers.set(`${CLASS_ID}/${L1}`, "cur");
      seedUnit("u1", { resourceIds: [L1] });
      const res = await __assignmentsListForStudentHandler(makeRequest());
      expect(res.items.map((i) => i.assignmentId)).toEqual(["cur"]);
      expect(res.supersededAssignmentIds).toEqual(["old-1", "old-2"]);
      expect(res.units).toEqual([expect.objectContaining({ unitId: "u1", assignmentIds: ["cur"] })]);
    });

    test("a history-only group is placed whole, with its ids unchanged", async () => {
      seedWork([["old-1", L1], ["cur", L1], ["a2", L2]]);
      seedAssignment("cur", { lessonSlug: L1, status: "closed" });
      pointers.set(`${CLASS_ID}/${L1}`, "cur");
      seedUnit("u1", { resourceIds: [L2, L1] });
      const res = await __assignmentsListForStudentHandler(makeRequest());
      expect(res.items.map((i) => i.assignmentId)).toEqual(["a2"]);
      expect(res.historyOnlyGroups).toEqual([{ assignmentIds: ["cur", "old-1"] }]);
      expect(res.units).toEqual([
        expect.objectContaining({ unitId: "u1", assignmentIds: ["a2", "cur", "old-1"] }),
      ]);
    });
  });
});
