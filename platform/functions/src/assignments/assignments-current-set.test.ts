import type { CallableRequest } from "firebase-functions/v2/https";

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

const SERVER_TIMESTAMP_SENTINEL = { __sentinel: "serverTimestamp" } as const;
jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
  },
}));

const mockRequireDistrictContext = jest.fn();
const mockWriteAuditEventInTransaction = jest.fn();
const mockLogInfo = jest.fn();

type FakeSnapshot = { exists: boolean; data: () => unknown };
type FakeRef =
  | { readonly kind: "class"; readonly id: string }
  | { readonly kind: "assignment"; readonly id: string }
  | { readonly kind: "pointer"; readonly classId: string; readonly lessonSlug: string };

const classRegistry = new Map<string, FakeSnapshot>();
const mockClassDocRef = jest.fn(
  (id: string): FakeRef => ({ kind: "class", id }),
);

const assignmentRegistry = new Map<string, FakeSnapshot>();
const mockAssignmentDocRef = jest.fn(
  (id: string): FakeRef => ({ kind: "assignment", id }),
);

const pointerRegistry = new Map<string, FakeSnapshot>();
function pointerKey(classId: string, lessonSlug: string): string {
  return `${classId}/${lessonSlug}`;
}
const mockAssignmentsCurrentDocRef = jest.fn(
  (classId: string, lessonSlug: string): FakeRef => ({
    kind: "pointer",
    classId,
    lessonSlug,
  }),
);
const mockAssignmentsCurrentSetDocRef = jest.fn(
  (classId: string, lessonSlug: string): FakeRef => ({
    kind: "pointer",
    classId,
    lessonSlug,
  }),
);

const pointerWrites: Array<{ classId: string; lessonSlug: string; data: Record<string, unknown> }> = [];

// Models one real Firestore transaction attempt: every `tx.get` dispatches
// to the fixture registry matching the ref's fake identity, and every
// `tx.set` records the write for later assertion. Mirrors the existing
// `assignments-recipients-reconcile.test.ts` fake-doc-ref convention,
// extended with a transaction wrapper since this callable's defining
// feature is the compare-and-swap transaction.
function makeFakeTx() {
  return {
    get: (ref: FakeRef): Promise<FakeSnapshot> => {
      if (ref.kind === "class") {
        return Promise.resolve(
          classRegistry.get(ref.id) ?? { exists: false, data: () => undefined },
        );
      }
      if (ref.kind === "assignment") {
        return Promise.resolve(
          assignmentRegistry.get(ref.id) ?? { exists: false, data: () => undefined },
        );
      }
      return Promise.resolve(
        pointerRegistry.get(pointerKey(ref.classId, ref.lessonSlug)) ?? {
          exists: false,
          data: () => undefined,
        },
      );
    },
    set: (ref: FakeRef, data: Record<string, unknown>): void => {
      if (ref.kind !== "pointer") {
        throw new Error("unexpected tx.set target in test fake");
      }
      pointerWrites.push({ classId: ref.classId, lessonSlug: ref.lessonSlug, data });
    },
  };
}

const mockRunFirestoreTransaction = jest.fn(
  (fn: (tx: ReturnType<typeof makeFakeTx>) => Promise<unknown>) => fn(makeFakeTx()),
);

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual("../shared/errors/platform-error");
  return {
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    log: { info: mockLogInfo, warn: jest.fn(), error: jest.fn() },
    requireDistrictContext: mockRequireDistrictContext,
    runFirestoreTransaction: mockRunFirestoreTransaction,
    writeAuditEventInTransaction: mockWriteAuditEventInTransaction,
    classDocRef: mockClassDocRef,
    assignmentDocRef: mockAssignmentDocRef,
    assignmentsCurrentDocRef: mockAssignmentsCurrentDocRef,
    assignmentsCurrentSetDocRef: mockAssignmentsCurrentSetDocRef,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { mapPlatformCodeToHttpsCode } from "../shared/errors/https-callable";
import { __assignmentsCurrentSetHandler } from "./assignments-current-set";

const TEACHER_UID = "teacher-1";
const OTHER_TEACHER_UID = "teacher-2";
const SCHOOL_ID = "school-a";
const OTHER_SCHOOL_ID = "school-b";
const DISTRICT_ID = "district-1";
const CLASS_ID = "class-abc";
const OTHER_CLASS_ID = "class-xyz";
const LESSON_SLUG = "lesson_g7_earths-layers";
const OTHER_LESSON_SLUG = "lesson_g7_water-cycle";
const ASSIGNMENT_ID = "assign-1";
const OTHER_ASSIGNMENT_ID = "assign-2";

const VALID_CONTEXT = Object.freeze({
  uid: TEACHER_UID,
  role: "teacher" as const,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
});

function makeRequest(
  data: Record<string, unknown> | undefined | null = {
    classId: CLASS_ID,
    lessonSlug: LESSON_SLUG,
    assignmentId: ASSIGNMENT_ID,
    expectedCurrentAssignmentId: null,
  },
): CallableRequest<unknown> {
  return {
    data,
    auth: { uid: TEACHER_UID, token: {} } as never,
    rawRequest: {} as never,
  };
}

async function expectRejectedCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(PlatformError);
  await promise.catch((err: unknown) => {
    expect((err as PlatformError).code).toBe(code);
  });
}

function seedClass(overrides: Partial<Record<string, unknown>> = {}): void {
  classRegistry.set(CLASS_ID, {
    exists: true,
    data: () => ({
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      title: "Grade 7 Science, Block C",
      status: "active",
      createdAt: {},
      ...overrides,
    }),
  });
}

function seedAssignment(
  id: string = ASSIGNMENT_ID,
  overrides: Partial<Record<string, unknown>> = {},
): void {
  assignmentRegistry.set(id, {
    exists: true,
    data: () => ({
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      lessonSlug: LESSON_SLUG,
      mode: "classroom",
      status: "published",
      createdAt: {},
      ...overrides,
    }),
  });
}

function seedPointer(overrides: Partial<Record<string, unknown>> = {}): void {
  pointerRegistry.set(pointerKey(CLASS_ID, LESSON_SLUG), {
    exists: true,
    data: () => ({
      classId: CLASS_ID,
      lessonSlug: LESSON_SLUG,
      assignmentId: OTHER_ASSIGNMENT_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      setAt: {},
      setBy: TEACHER_UID,
      source: "publish",
      ...overrides,
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  classRegistry.clear();
  assignmentRegistry.clear();
  pointerRegistry.clear();
  pointerWrites.length = 0;
  mockRequireDistrictContext.mockResolvedValue(VALID_CONTEXT);
});

describe("assignmentsCurrentSet: happy path", () => {
  test("first legacy resolution: no pointer, expected null, requested published assignment -> changed:true", async () => {
    seedClass();
    seedAssignment();

    const res = await __assignmentsCurrentSetHandler(makeRequest());

    expect(res).toEqual({
      classId: CLASS_ID,
      lessonSlug: LESSON_SLUG,
      assignmentId: ASSIGNMENT_ID,
      changed: true,
    });
    expect(pointerWrites).toEqual([
      {
        classId: CLASS_ID,
        lessonSlug: LESSON_SLUG,
        data: {
          classId: CLASS_ID,
          lessonSlug: LESSON_SLUG,
          assignmentId: ASSIGNMENT_ID,
          teacherId: TEACHER_UID,
          schoolId: SCHOOL_ID,
          setAt: SERVER_TIMESTAMP_SENTINEL,
          setBy: TEACHER_UID,
          source: "teacherResolution",
        },
      },
    ]);
  });

  test("writes exactly the approved pointer shape and no extra fields", async () => {
    seedClass();
    seedAssignment();

    await __assignmentsCurrentSetHandler(makeRequest());

    const written = pointerWrites[0].data;
    expect(Object.keys(written).sort()).toEqual(
      ["assignmentId", "classId", "lessonSlug", "schoolId", "setAt", "setBy", "source", "teacherId"].sort(),
    );
  });

  test("change current: existing pointer X, expected X, requested Z -> changed:true", async () => {
    seedClass();
    seedAssignment(OTHER_ASSIGNMENT_ID);
    seedPointer({ assignmentId: OTHER_ASSIGNMENT_ID });
    seedAssignment(ASSIGNMENT_ID);

    const res = await __assignmentsCurrentSetHandler(
      makeRequest({
        classId: CLASS_ID,
        lessonSlug: LESSON_SLUG,
        assignmentId: ASSIGNMENT_ID,
        expectedCurrentAssignmentId: OTHER_ASSIGNMENT_ID,
      }),
    );

    expect(res.changed).toBe(true);
    expect(res.assignmentId).toBe(ASSIGNMENT_ID);
  });

  test("writes an audit event only on an actual change, with the canonical action and payload", async () => {
    seedClass();
    seedAssignment(OTHER_ASSIGNMENT_ID);
    seedPointer({ assignmentId: OTHER_ASSIGNMENT_ID });
    seedAssignment(ASSIGNMENT_ID);

    await __assignmentsCurrentSetHandler(
      makeRequest({
        classId: CLASS_ID,
        lessonSlug: LESSON_SLUG,
        assignmentId: ASSIGNMENT_ID,
        expectedCurrentAssignmentId: OTHER_ASSIGNMENT_ID,
      }),
    );

    expect(mockWriteAuditEventInTransaction).toHaveBeenCalledTimes(1);
    const [, auditInput] = mockWriteAuditEventInTransaction.mock.calls[0];
    expect(auditInput).toMatchObject({
      actorUserId: TEACHER_UID,
      actorRole: "teacher",
      action: "assignments.currentChanged",
      targetType: "assignment",
      targetId: ASSIGNMENT_ID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      payload: {
        classId: CLASS_ID,
        lessonSlug: LESSON_SLUG,
        assignmentId: ASSIGNMENT_ID,
        previousAssignmentId: OTHER_ASSIGNMENT_ID,
        source: "teacherResolution",
      },
    });
  });
});

describe("assignmentsCurrentSet: idempotent same-value branch (LOCKED ordering)", () => {
  test("pointer already equals requested: changed:false, no write, no audit, regardless of stale expected", async () => {
    seedClass();
    seedAssignment(ASSIGNMENT_ID);
    seedPointer({ assignmentId: ASSIGNMENT_ID });

    const res = await __assignmentsCurrentSetHandler(
      makeRequest({
        classId: CLASS_ID,
        lessonSlug: LESSON_SLUG,
        assignmentId: ASSIGNMENT_ID,
        expectedCurrentAssignmentId: "totally-different-stale-value",
      }),
    );

    expect(res).toEqual({
      classId: CLASS_ID,
      lessonSlug: LESSON_SLUG,
      assignmentId: ASSIGNMENT_ID,
      changed: false,
    });
    expect(pointerWrites).toEqual([]);
    expect(mockWriteAuditEventInTransaction).not.toHaveBeenCalled();
  });

  // Required regression: retry after a committed response was lost.
  test("retry after lost response: same requested+expected, live already equals requested -> changed:false, no second write", async () => {
    seedClass();
    seedAssignment(OTHER_ASSIGNMENT_ID);
    seedAssignment(ASSIGNMENT_ID);

    const req = makeRequest({
      classId: CLASS_ID,
      lessonSlug: LESSON_SLUG,
      assignmentId: ASSIGNMENT_ID,
      expectedCurrentAssignmentId: OTHER_ASSIGNMENT_ID,
    });

    // First call: pointer absent-equivalent already advanced to
    // OTHER_ASSIGNMENT_ID would be the normal case, but to isolate exactly
    // the "response lost" step we seed the pointer as it would exist AFTER
    // the first call already committed (assignmentId already = ASSIGNMENT_ID).
    seedPointer({ assignmentId: ASSIGNMENT_ID });

    const retryRes = await __assignmentsCurrentSetHandler(req);

    expect(retryRes).toEqual({
      classId: CLASS_ID,
      lessonSlug: LESSON_SLUG,
      assignmentId: ASSIGNMENT_ID,
      changed: false,
    });
    expect(pointerWrites).toEqual([]);
    expect(mockWriteAuditEventInTransaction).not.toHaveBeenCalled();
  });

  // Required regression: first-resolution retry (expected null) after a
  // committed response was lost.
  test("same-value first-resolution retry: expected null, live already equals requested -> changed:false, no conflict", async () => {
    seedClass();
    seedAssignment(ASSIGNMENT_ID);
    seedPointer({ assignmentId: ASSIGNMENT_ID });

    const res = await __assignmentsCurrentSetHandler(
      makeRequest({
        classId: CLASS_ID,
        lessonSlug: LESSON_SLUG,
        assignmentId: ASSIGNMENT_ID,
        expectedCurrentAssignmentId: null,
      }),
    );

    expect(res.changed).toBe(false);
    expect(pointerWrites).toEqual([]);
  });
});

describe("assignmentsCurrentSet: compare-and-swap conflicts", () => {
  test("pointer absent, expected non-null -> conflict", async () => {
    seedClass();
    seedAssignment(ASSIGNMENT_ID);

    await expectRejectedCode(
      __assignmentsCurrentSetHandler(
        makeRequest({
          classId: CLASS_ID,
          lessonSlug: LESSON_SLUG,
          assignmentId: ASSIGNMENT_ID,
          expectedCurrentAssignmentId: OTHER_ASSIGNMENT_ID,
        }),
      ),
      "assignments.conflict",
    );
    expect(pointerWrites).toEqual([]);
    expect(mockWriteAuditEventInTransaction).not.toHaveBeenCalled();
  });

  test("pointer X, expected null, requested Z -> conflict", async () => {
    seedClass();
    seedAssignment(OTHER_ASSIGNMENT_ID);
    seedPointer({ assignmentId: OTHER_ASSIGNMENT_ID });
    seedAssignment(ASSIGNMENT_ID);

    await expectRejectedCode(
      __assignmentsCurrentSetHandler(
        makeRequest({
          classId: CLASS_ID,
          lessonSlug: LESSON_SLUG,
          assignmentId: ASSIGNMENT_ID,
          expectedCurrentAssignmentId: null,
        }),
      ),
      "assignments.conflict",
    );
  });

  test("pointer X, expected Y (neither null nor X), requested Z -> conflict", async () => {
    seedClass();
    seedAssignment(OTHER_ASSIGNMENT_ID);
    seedPointer({ assignmentId: OTHER_ASSIGNMENT_ID });
    seedAssignment(ASSIGNMENT_ID);

    await expectRejectedCode(
      __assignmentsCurrentSetHandler(
        makeRequest({
          classId: CLASS_ID,
          lessonSlug: LESSON_SLUG,
          assignmentId: ASSIGNMENT_ID,
          expectedCurrentAssignmentId: "some-third-value-y",
        }),
      ),
      "assignments.conflict",
    );
  });

  // Required: stale two-tab conflict. Current = X, Tab A observed X,
  // another action changed Current to Y, Tab A requests Z with expected X.
  test("stale two-tab conflict: live is Y, requested Z, expected stale X -> conflict, Y survives, no audit", async () => {
    const X = "assign-x";
    const Y = "assign-y";
    const Z = ASSIGNMENT_ID;
    seedClass();
    seedAssignment(Y);
    seedAssignment(Z);
    seedPointer({ assignmentId: Y }); // live Current is Y, not X

    await expectRejectedCode(
      __assignmentsCurrentSetHandler(
        makeRequest({
          classId: CLASS_ID,
          lessonSlug: LESSON_SLUG,
          assignmentId: Z,
          expectedCurrentAssignmentId: X,
        }),
      ),
      "assignments.conflict",
    );
    expect(pointerWrites).toEqual([]);
    expect(mockWriteAuditEventInTransaction).not.toHaveBeenCalled();
  });

  // Required: first legacy resolution race. No pointer exists; two tabs
  // both observed no Current. A commits X first; B's later attempt (which,
  // in this single-process unit test, models "B's transaction reads after
  // A's already committed") must conflict rather than silently overwrite.
  test("first legacy resolution race: A commits X, B's subsequent attempt with expected null conflicts", async () => {
    const X = "assign-x";
    const Y = "assign-y";
    seedClass();
    seedAssignment(X);
    seedAssignment(Y);

    const resA = await __assignmentsCurrentSetHandler(
      makeRequest({
        classId: CLASS_ID,
        lessonSlug: LESSON_SLUG,
        assignmentId: X,
        expectedCurrentAssignmentId: null,
      }),
    );
    expect(resA).toEqual({ classId: CLASS_ID, lessonSlug: LESSON_SLUG, assignmentId: X, changed: true });

    // B's own transaction now reads the LIVE pointer, which A's commit
    // already advanced to X - not the stale "no pointer" state B originally
    // observed.
    seedPointer({ assignmentId: X });

    await expectRejectedCode(
      __assignmentsCurrentSetHandler(
        makeRequest({
          classId: CLASS_ID,
          lessonSlug: LESSON_SLUG,
          assignmentId: Y,
          expectedCurrentAssignmentId: null,
        }),
      ),
      "assignments.conflict",
    );

    // X survives: no second pointer write occurred for B's rejected attempt.
    expect(pointerWrites).toHaveLength(1);
    expect(pointerWrites[0].data.assignmentId).toBe(X);
  });

  test("reverse ordering of the first legacy resolution race is equivalently safe: B commits Y first, A then conflicts", async () => {
    const X = "assign-x";
    const Y = "assign-y";
    seedClass();
    seedAssignment(X);
    seedAssignment(Y);

    const resB = await __assignmentsCurrentSetHandler(
      makeRequest({
        classId: CLASS_ID,
        lessonSlug: LESSON_SLUG,
        assignmentId: Y,
        expectedCurrentAssignmentId: null,
      }),
    );
    expect(resB.changed).toBe(true);

    seedPointer({ assignmentId: Y });

    await expectRejectedCode(
      __assignmentsCurrentSetHandler(
        makeRequest({
          classId: CLASS_ID,
          lessonSlug: LESSON_SLUG,
          assignmentId: X,
          expectedCurrentAssignmentId: null,
        }),
      ),
      "assignments.conflict",
    );
    expect(pointerWrites).toHaveLength(1);
    expect(pointerWrites[0].data.assignmentId).toBe(Y);
  });

  test("assignments.conflict maps to the canonical already-exists callable posture", () => {
    expect(mapPlatformCodeToHttpsCode("assignments.conflict")).toBe("already-exists");
  });
});

describe("assignmentsCurrentSet: malformed / cross-scope live pointer fails closed", () => {
  test.each([
    ["missing assignmentId", { assignmentId: undefined }],
    ["wrong-typed assignmentId", { assignmentId: 42 }],
    ["missing teacherId", { teacherId: undefined }],
    ["missing schoolId", { schoolId: "" }],
    ["missing setBy", { setBy: undefined }],
    ["invalid source", { source: "notARealSource" }],
  ])("malformed live pointer (%s) fails closed and never overwrites", async (_label, overrides) => {
    seedClass();
    seedAssignment(ASSIGNMENT_ID);
    seedPointer(overrides);

    await expectRejectedCode(
      __assignmentsCurrentSetHandler(makeRequest()),
      "assignments.currentNotResolved",
    );
    expect(pointerWrites).toEqual([]);
  });

  test("cross-class pointer metadata fails closed", async () => {
    seedClass();
    seedAssignment(ASSIGNMENT_ID);
    seedPointer({ classId: OTHER_CLASS_ID });

    await expectRejectedCode(
      __assignmentsCurrentSetHandler(makeRequest()),
      "assignments.currentNotResolved",
    );
    expect(pointerWrites).toEqual([]);
  });

  test("cross-lesson pointer metadata fails closed", async () => {
    seedClass();
    seedAssignment(ASSIGNMENT_ID);
    seedPointer({ lessonSlug: OTHER_LESSON_SLUG });

    await expectRejectedCode(
      __assignmentsCurrentSetHandler(makeRequest()),
      "assignments.currentNotResolved",
    );
    expect(pointerWrites).toEqual([]);
  });

  test("cross-teacher pointer metadata fails closed", async () => {
    seedClass();
    seedAssignment(ASSIGNMENT_ID);
    seedPointer({ teacherId: OTHER_TEACHER_UID });

    await expectRejectedCode(
      __assignmentsCurrentSetHandler(makeRequest()),
      "assignments.currentNotResolved",
    );
    expect(pointerWrites).toEqual([]);
  });

  test("cross-school pointer metadata fails closed", async () => {
    seedClass();
    seedAssignment(ASSIGNMENT_ID);
    seedPointer({ schoolId: OTHER_SCHOOL_ID });

    await expectRejectedCode(
      __assignmentsCurrentSetHandler(makeRequest()),
      "assignments.currentNotResolved",
    );
    expect(pointerWrites).toEqual([]);
  });
});

describe("assignmentsCurrentSet: authorization and isolation", () => {
  test("unauthenticated caller is refused", async () => {
    mockRequireDistrictContext.mockRejectedValue(
      new PlatformError("unauthenticated", "An authenticated caller is required."),
    );
    await expectRejectedCode(__assignmentsCurrentSetHandler(makeRequest()), "unauthenticated");
  });

  test("student caller is refused", async () => {
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_CONTEXT, role: "student" });
    seedClass();
    seedAssignment(ASSIGNMENT_ID);

    await expectRejectedCode(__assignmentsCurrentSetHandler(makeRequest()), "role-forbidden");
  });

  test("suspended/non-active teacher is refused (propagated from requireDistrictContext)", async () => {
    mockRequireDistrictContext.mockRejectedValue(
      new PlatformError("account-inactive", "The authenticated caller is not active."),
    );
    await expectRejectedCode(
      __assignmentsCurrentSetHandler(makeRequest()),
      "account-inactive",
    );
  });

  test("different teacher (class not owned) is refused", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_CONTEXT,
      uid: OTHER_TEACHER_UID,
    });
    seedClass();
    seedAssignment(ASSIGNMENT_ID);

    await expectRejectedCode(__assignmentsCurrentSetHandler(makeRequest()), "classes.forbidden");
  });

  test("cross-school teacher is refused", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_CONTEXT,
      schoolId: OTHER_SCHOOL_ID,
    });
    seedClass();
    seedAssignment(ASSIGNMENT_ID);

    await expectRejectedCode(__assignmentsCurrentSetHandler(makeRequest()), "classes.forbidden");
  });

  test("missing class is refused", async () => {
    seedAssignment(ASSIGNMENT_ID);
    await expectRejectedCode(__assignmentsCurrentSetHandler(makeRequest()), "classes.notFound");
  });

  test("requested assignment missing is refused", async () => {
    seedClass();
    await expectRejectedCode(__assignmentsCurrentSetHandler(makeRequest()), "assignments.notFound");
  });

  test("requested assignment from another class is refused", async () => {
    seedClass();
    seedAssignment(ASSIGNMENT_ID, { classId: OTHER_CLASS_ID });

    await expectRejectedCode(
      __assignmentsCurrentSetHandler(makeRequest()),
      "assignments.classLessonMismatch",
    );
  });

  test("requested assignment for another lesson is refused", async () => {
    seedClass();
    seedAssignment(ASSIGNMENT_ID, { lessonSlug: OTHER_LESSON_SLUG });

    await expectRejectedCode(
      __assignmentsCurrentSetHandler(makeRequest()),
      "assignments.classLessonMismatch",
    );
  });

  test("requested assignment owned by another teacher is refused", async () => {
    seedClass();
    seedAssignment(ASSIGNMENT_ID, { teacherId: OTHER_TEACHER_UID });

    await expectRejectedCode(
      __assignmentsCurrentSetHandler(makeRequest()),
      "assignments.forbidden",
    );
  });

  test("requested assignment from another school is refused", async () => {
    seedClass();
    seedAssignment(ASSIGNMENT_ID, { schoolId: OTHER_SCHOOL_ID });

    await expectRejectedCode(
      __assignmentsCurrentSetHandler(makeRequest()),
      "assignments.forbidden",
    );
  });

  test.each(["draft", "closed", "archived"] as const)(
    "requested assignment with status %s is refused",
    async (status) => {
      seedClass();
      seedAssignment(ASSIGNMENT_ID, { status });

      await expectRejectedCode(
        __assignmentsCurrentSetHandler(makeRequest()),
        "assignments.invalidTransition",
      );
    },
  );

  // Post-Slice-4-review: under the corrected ordering, the same-value branch
  // can be reached before the requested assignment is ever read, so a
  // well-formed, correctly-scoped pointer whose assignmentId already equals
  // the request legitimately short-circuits to changed:false without
  // consulting the (here, irrelevantly cross-owned) assignment document at
  // all - proven separately below ("same-value success does not require the
  // requested assignment to be independently owned by the caller"). The
  // security invariant this section now proves instead is narrower and
  // stronger: neither a class the caller does not own, nor a pointer whose
  // OWN recorded scope disagrees with the caller, can ever produce a
  // same-value success merely because an assignmentId happens to match.
  test("class ownership is checked before the pointer is ever read, even when a legitimately-shaped pointer for that class exists", async () => {
    // The class belongs to TEACHER_UID; the caller is OTHER_TEACHER_UID.
    // The pointer is exactly as legitimate a pointer for TEACHER_UID's
    // class as Slice 4 ever writes (own teacherId/schoolId, matching
    // assignmentId) - but the caller does not own the class at all, so
    // class ownership must fail before the pointer is ever read.
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_CONTEXT,
      uid: OTHER_TEACHER_UID,
    });
    seedClass();
    seedPointer({ assignmentId: ASSIGNMENT_ID, teacherId: TEACHER_UID, schoolId: SCHOOL_ID });

    await expectRejectedCode(
      __assignmentsCurrentSetHandler(makeRequest()),
      "classes.forbidden",
    );
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
    expect(mockAssignmentsCurrentDocRef).not.toHaveBeenCalled();
  });

  test("a pointer whose own scope disagrees with the caller cannot produce a same-value success merely because assignmentId matches", async () => {
    // Caller legitimately owns the class. The pointer's assignmentId
    // matches the request exactly, but the pointer's own teacherId names a
    // different teacher - contradictory pointer metadata, which must fail
    // closed rather than be read as "matches, so changed:false."
    seedClass();
    seedPointer({ assignmentId: ASSIGNMENT_ID, teacherId: OTHER_TEACHER_UID });

    await expectRejectedCode(
      __assignmentsCurrentSetHandler(makeRequest()),
      "assignments.currentNotResolved",
    );
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
    expect(pointerWrites).toEqual([]);
  });

  test("same-value success does not require the requested assignment to be independently owned by the caller", async () => {
    // Documents the corrected ordering directly: a well-formed pointer,
    // correctly scoped to the authorized class/lesson/teacher/school, whose
    // recorded assignmentId already equals the request, resolves
    // changed:false without ever reading the requested assignment - even
    // though that assignment document (irrelevantly, since it is never
    // read) happens to be owned by someone else. The same-value branch is
    // an idempotent pointer-mutation acknowledgement, not assignment access
    // authorization.
    seedClass();
    seedAssignment(ASSIGNMENT_ID, { teacherId: OTHER_TEACHER_UID });
    seedPointer({ assignmentId: ASSIGNMENT_ID });

    const res = await __assignmentsCurrentSetHandler(makeRequest());

    expect(res.changed).toBe(false);
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });
});

// Post-Slice-4-review regression suite. Proves the corrected ordering: the
// same-value idempotency check and the CAS comparison both happen before
// the requested assignment is ever read, so a retry of an
// already-completed mutation cannot be defeated by the requested
// assignment later closing or disappearing, and a stale CAS request never
// pays for (or is affected by) a requested-assignment read it could never
// use.
describe("assignmentsCurrentSet: retry-after-eligibility-change regression", () => {
  // A. Retry after the pointed (already-current) assignment closes.
  test("A1: live pointer already equals Z, Z is now closed, retry with stale expected -> changed:false, assignment never read", async () => {
    const Z = ASSIGNMENT_ID;
    const staleExpectedX = "assign-stale-x";
    seedClass();
    seedPointer({ assignmentId: Z });
    seedAssignment(Z, { status: "closed" });

    const res = await __assignmentsCurrentSetHandler(
      makeRequest({
        classId: CLASS_ID,
        lessonSlug: LESSON_SLUG,
        assignmentId: Z,
        expectedCurrentAssignmentId: staleExpectedX,
      }),
    );

    expect(res).toEqual({
      classId: CLASS_ID,
      lessonSlug: LESSON_SLUG,
      assignmentId: Z,
      changed: false,
    });
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
    expect(pointerWrites).toEqual([]);
    expect(mockWriteAuditEventInTransaction).not.toHaveBeenCalled();
  });

  test("A2: live pointer already equals Z, Z's assignment document is now entirely absent, retry -> changed:false, assignment never read", async () => {
    const Z = ASSIGNMENT_ID;
    const staleExpectedX = "assign-stale-x";
    seedClass();
    seedPointer({ assignmentId: Z });
    // Z is not seeded into assignmentRegistry at all - genuinely absent.

    const res = await __assignmentsCurrentSetHandler(
      makeRequest({
        classId: CLASS_ID,
        lessonSlug: LESSON_SLUG,
        assignmentId: Z,
        expectedCurrentAssignmentId: staleExpectedX,
      }),
    );

    expect(res).toEqual({
      classId: CLASS_ID,
      lessonSlug: LESSON_SLUG,
      assignmentId: Z,
      changed: false,
    });
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
    expect(pointerWrites).toEqual([]);
    expect(mockWriteAuditEventInTransaction).not.toHaveBeenCalled();
  });

  // B. Stale CAS short-circuits before the requested assignment is read.
  test("B: live pointer = Y, request Z with stale expected X (X != Y) -> conflict, Z never read", async () => {
    const X = "assign-x";
    const Y = "assign-y";
    const Z = ASSIGNMENT_ID;
    seedClass();
    seedPointer({ assignmentId: Y });
    // Z is deliberately NOT seeded into assignmentRegistry - if the
    // implementation tried to read it, the missing-assignment branch would
    // fire instead of the conflict branch, which would fail this test.

    await expectRejectedCode(
      __assignmentsCurrentSetHandler(
        makeRequest({
          classId: CLASS_ID,
          lessonSlug: LESSON_SLUG,
          assignmentId: Z,
          expectedCurrentAssignmentId: X,
        }),
      ),
      "assignments.conflict",
    );
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
    expect(pointerWrites).toEqual([]);
    expect(mockWriteAuditEventInTransaction).not.toHaveBeenCalled();
  });

  // C. A genuine change still fully validates the requested assignment.
  test("C: live pointer = X, request Z expected X, Z is closed -> CAS matches but assignment is read and rejected; X survives", async () => {
    const X = "assign-x";
    const Z = ASSIGNMENT_ID;
    seedClass();
    seedPointer({ assignmentId: X });
    seedAssignment(Z, { status: "closed" });

    await expectRejectedCode(
      __assignmentsCurrentSetHandler(
        makeRequest({
          classId: CLASS_ID,
          lessonSlug: LESSON_SLUG,
          assignmentId: Z,
          expectedCurrentAssignmentId: X,
        }),
      ),
      "assignments.invalidTransition",
    );
    expect(mockAssignmentDocRef).toHaveBeenCalled();
    expect(pointerWrites).toEqual([]);
    expect(mockWriteAuditEventInTransaction).not.toHaveBeenCalled();
  });

  // D. A malformed pointer whose recorded assignmentId happens to equal the
  // request must still fail closed, never receive the same-value success.
  test("D: pointer contains assignmentId Z but is otherwise malformed -> currentNotResolved before the same-value branch, Z never read", async () => {
    const Z = ASSIGNMENT_ID;
    seedClass();
    seedPointer({ assignmentId: Z, source: "notARealSource" });
    seedAssignment(Z);

    await expectRejectedCode(
      __assignmentsCurrentSetHandler(
        makeRequest({
          classId: CLASS_ID,
          lessonSlug: LESSON_SLUG,
          assignmentId: Z,
          expectedCurrentAssignmentId: null,
        }),
      ),
      "assignments.currentNotResolved",
    );
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
    expect(pointerWrites).toEqual([]);
    expect(mockWriteAuditEventInTransaction).not.toHaveBeenCalled();
  });

  test("D2: pointer contains assignmentId Z but contradicts its own storage scope (classId) -> currentNotResolved before the same-value branch", async () => {
    const Z = ASSIGNMENT_ID;
    seedClass();
    seedPointer({ assignmentId: Z, classId: OTHER_CLASS_ID });
    seedAssignment(Z);

    await expectRejectedCode(
      __assignmentsCurrentSetHandler(
        makeRequest({
          classId: CLASS_ID,
          lessonSlug: LESSON_SLUG,
          assignmentId: Z,
          expectedCurrentAssignmentId: null,
        }),
      ),
      "assignments.currentNotResolved",
    );
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
    expect(pointerWrites).toEqual([]);
  });
});

describe("assignmentsCurrentSet: malformed request", () => {
  test("non-object payload is refused", async () => {
    await expectRejectedCode(__assignmentsCurrentSetHandler(makeRequest(null)), "assignments.invalidRequest");
  });

  test.each(["schoolId", "districtId", "teacherId", "setBy", "source", "previousAssignmentId", "somethingUnrecognized"])(
    "forbidden or unrecognized extra request key %s is refused",
    async (key) => {
      await expectRejectedCode(
        __assignmentsCurrentSetHandler(
          makeRequest({
            classId: CLASS_ID,
            lessonSlug: LESSON_SLUG,
            assignmentId: ASSIGNMENT_ID,
            expectedCurrentAssignmentId: null,
            [key]: "x",
          }),
        ),
        "assignments.invalidRequest",
      );
    },
  );

  test("missing classId is refused", async () => {
    await expectRejectedCode(
      __assignmentsCurrentSetHandler(
        makeRequest({ lessonSlug: LESSON_SLUG, assignmentId: ASSIGNMENT_ID, expectedCurrentAssignmentId: null }),
      ),
      "assignments.invalidClassId",
    );
  });

  test("missing lessonSlug is refused", async () => {
    await expectRejectedCode(
      __assignmentsCurrentSetHandler(
        makeRequest({ classId: CLASS_ID, assignmentId: ASSIGNMENT_ID, expectedCurrentAssignmentId: null }),
      ),
      "assignments.invalidLessonSlug",
    );
  });

  test("missing assignmentId is refused", async () => {
    await expectRejectedCode(
      __assignmentsCurrentSetHandler(
        makeRequest({ classId: CLASS_ID, lessonSlug: LESSON_SLUG, expectedCurrentAssignmentId: null }),
      ),
      "assignments.invalidAssignmentId",
    );
  });

  test("missing expectedCurrentAssignmentId key entirely is refused (never inferred)", async () => {
    await expectRejectedCode(
      __assignmentsCurrentSetHandler(
        makeRequest({ classId: CLASS_ID, lessonSlug: LESSON_SLUG, assignmentId: ASSIGNMENT_ID }),
      ),
      "assignments.invalidExpectedCurrentAssignmentId",
    );
  });

  test("wrong type for expectedCurrentAssignmentId (number) is refused", async () => {
    await expectRejectedCode(
      __assignmentsCurrentSetHandler(
        makeRequest({
          classId: CLASS_ID,
          lessonSlug: LESSON_SLUG,
          assignmentId: ASSIGNMENT_ID,
          expectedCurrentAssignmentId: 12345,
        }),
      ),
      "assignments.invalidExpectedCurrentAssignmentId",
    );
  });

  test("empty-string expectedCurrentAssignmentId (not null, not a real id) is refused", async () => {
    await expectRejectedCode(
      __assignmentsCurrentSetHandler(
        makeRequest({
          classId: CLASS_ID,
          lessonSlug: LESSON_SLUG,
          assignmentId: ASSIGNMENT_ID,
          expectedCurrentAssignmentId: "",
        }),
      ),
      "assignments.invalidExpectedCurrentAssignmentId",
    );
  });

  test("wrong-typed classId is refused", async () => {
    await expectRejectedCode(
      __assignmentsCurrentSetHandler(
        makeRequest({
          classId: 42,
          lessonSlug: LESSON_SLUG,
          assignmentId: ASSIGNMENT_ID,
          expectedCurrentAssignmentId: null,
        }),
      ),
      "assignments.invalidClassId",
    );
  });

  test("invalid-charset classId is refused", async () => {
    await expectRejectedCode(
      __assignmentsCurrentSetHandler(
        makeRequest({
          classId: "not a valid id!",
          lessonSlug: LESSON_SLUG,
          assignmentId: ASSIGNMENT_ID,
          expectedCurrentAssignmentId: null,
        }),
      ),
      "assignments.invalidClassId",
    );
  });
});
