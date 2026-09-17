import type { CallableRequest } from "firebase-functions/v2/https";

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

const mockRequireDistrictContext = jest.fn();
const mockWriteAuditEvent = jest.fn();
const mockLogInfo = jest.fn();

type FakeSnapshot = { exists: boolean; data: () => unknown };

const classRegistry = new Map<string, FakeSnapshot>();
const mockClassDocRef = jest.fn((id: string) => ({
  get: () =>
    Promise.resolve(classRegistry.get(id) ?? { exists: false, data: () => undefined }),
}));

const pointerRegistry = new Map<string, FakeSnapshot>();
function pointerKey(classId: string, lessonSlug: string): string {
  return `${classId}/${lessonSlug}`;
}
const mockAssignmentsCurrentDocRef = jest.fn((classId: string, lessonSlug: string) => ({
  get: () =>
    Promise.resolve(
      pointerRegistry.get(pointerKey(classId, lessonSlug)) ?? {
        exists: false,
        data: () => undefined,
      },
    ),
}));

const assignmentRegistry = new Map<string, FakeSnapshot>();
const mockAssignmentDocRef = jest.fn((id: string) => ({
  get: () =>
    Promise.resolve(assignmentRegistry.get(id) ?? { exists: false, data: () => undefined }),
}));

// The real Slice 3 resolver (`./resolve-current-assignment`) is
// deliberately left UNMOCKED, exactly mirroring how
// `assignments-recipients-reconcile.test.ts` leaves `./assignment-recipients`
// unmocked for `ensureAssignmentRecipient` - this gives genuine integration
// coverage of the Slice 3 <-> Slice 7 interaction (the actual security
// property this callable exists to add) rather than a hand-rolled stand-in
// that could silently drift from the resolver's real behavior. Only its
// own two Firestore dependencies above (`assignmentsCurrentDocRef`,
// `assignmentDocRef`) are faked, at the `../shared` boundary both this
// callable and the resolver share.
jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual("../shared/errors/platform-error");
  return {
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    log: { info: mockLogInfo, warn: jest.fn(), error: jest.fn() },
    requireDistrictContext: mockRequireDistrictContext,
    writeAuditEvent: mockWriteAuditEvent,
    classDocRef: mockClassDocRef,
    assignmentDocRef: mockAssignmentDocRef,
    assignmentsCurrentDocRef: mockAssignmentsCurrentDocRef,
  };
});

// The Slice 6 engine's OWN behavior (active-enrollment derivation, partial
// success, integrity violations) is already exhaustively covered by
// `assignment-recipients.test.ts`. This suite mocks the engine directly so
// it can assert exactly what context/source THIS callable passes it,
// without re-deriving the engine's internals a second time.
const mockReconcileAssignmentRecipients = jest.fn();
jest.mock("./assignment-recipients", () => ({
  reconcileAssignmentRecipients: mockReconcileAssignmentRecipients,
}));

import { PlatformError } from "../shared/errors/platform-error";
import { __assignmentsCurrentRecipientsReconcileHandler } from "./assignments-current-recipients-reconcile";

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

function seedClass(overrides: Record<string, unknown> = {}): void {
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

function seedPointer(overrides: Record<string, unknown> = {}): void {
  pointerRegistry.set(pointerKey(CLASS_ID, LESSON_SLUG), {
    exists: true,
    data: () => ({
      classId: CLASS_ID,
      lessonSlug: LESSON_SLUG,
      assignmentId: ASSIGNMENT_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      setAt: {},
      setBy: TEACHER_UID,
      source: "publish",
      ...overrides,
    }),
  });
}

function seedAssignment(
  id: string = ASSIGNMENT_ID,
  overrides: Record<string, unknown> = {},
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

beforeEach(() => {
  jest.clearAllMocks();
  classRegistry.clear();
  pointerRegistry.clear();
  assignmentRegistry.clear();
  mockRequireDistrictContext.mockResolvedValue(VALID_CONTEXT);
  mockReconcileAssignmentRecipients.mockResolvedValue({ added: 0, alreadyCurrent: 0 });
});

describe("assignmentsCurrentRecipientsReconcile: happy path", () => {
  it("resolves live Current, invokes the engine for it, and returns the exact aggregate result", async () => {
    seedClass();
    seedPointer();
    seedAssignment();
    mockReconcileAssignmentRecipients.mockResolvedValueOnce({ added: 2, alreadyCurrent: 1 });

    const result = await __assignmentsCurrentRecipientsReconcileHandler(makeRequest());

    expect(result).toEqual({
      classId: CLASS_ID,
      lessonSlug: LESSON_SLUG,
      assignmentId: ASSIGNMENT_ID,
      added: 2,
      alreadyCurrent: 1,
    });
    expect(mockReconcileAssignmentRecipients).toHaveBeenCalledWith(
      {
        assignmentId: ASSIGNMENT_ID,
        classId: CLASS_ID,
        teacherId: TEACHER_UID,
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
        assignedBy: TEACHER_UID,
      },
      "teacherReconcile",
    );
  });

  it("audits exactly once on success with an aggregate-only payload", async () => {
    seedClass();
    seedPointer();
    seedAssignment();
    mockReconcileAssignmentRecipients.mockResolvedValueOnce({ added: 2, alreadyCurrent: 1 });

    await __assignmentsCurrentRecipientsReconcileHandler(makeRequest());

    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: TEACHER_UID,
      actorRole: "teacher",
      action: "assignments.recipientsReconciled",
      targetType: "assignment",
      targetId: ASSIGNMENT_ID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      payload: {
        assignmentId: ASSIGNMENT_ID,
        classId: CLASS_ID,
        lessonSlug: LESSON_SLUG,
        added: 2,
        alreadyCurrent: 1,
      },
    });
  });
});

describe("assignmentsCurrentRecipientsReconcile: request authority", () => {
  it("rejects a non-object payload", async () => {
    await expectRejectedCode(
      __assignmentsCurrentRecipientsReconcileHandler(makeRequest(null)),
      "assignments.invalidRequest",
    );
  });

  it.each([
    "assignmentId",
    "currentAssignmentId",
    "expectedCurrentAssignmentId",
    "expectedAssignmentId",
    "candidateAssignmentId",
    "studentIds",
    "schoolId",
    "districtId",
    "teacherId",
  ])("rejects an unexpected request key: %s", async (key) => {
    await expectRejectedCode(
      __assignmentsCurrentRecipientsReconcileHandler(
        makeRequest({ classId: CLASS_ID, lessonSlug: LESSON_SLUG, [key]: "x" }),
      ),
      "assignments.invalidRequest",
    );
    expect(mockReconcileAssignmentRecipients).not.toHaveBeenCalled();
  });

  it("rejects a missing classId", async () => {
    await expectRejectedCode(
      __assignmentsCurrentRecipientsReconcileHandler(makeRequest({ lessonSlug: LESSON_SLUG })),
      "assignments.invalidClassId",
    );
  });

  it("rejects a missing lessonSlug", async () => {
    await expectRejectedCode(
      __assignmentsCurrentRecipientsReconcileHandler(makeRequest({ classId: CLASS_ID })),
      "assignments.invalidLessonSlug",
    );
  });

  it("rejects a wrong-typed classId", async () => {
    await expectRejectedCode(
      __assignmentsCurrentRecipientsReconcileHandler(
        makeRequest({ classId: 42, lessonSlug: LESSON_SLUG }),
      ),
      "assignments.invalidClassId",
    );
  });

  it("rejects an invalid-charset lessonSlug", async () => {
    await expectRejectedCode(
      __assignmentsCurrentRecipientsReconcileHandler(
        makeRequest({ classId: CLASS_ID, lessonSlug: "not a valid slug!" }),
      ),
      "assignments.invalidLessonSlug",
    );
  });
});

describe("assignmentsCurrentRecipientsReconcile: class authorization (before Current resolution)", () => {
  it("unauthenticated caller is refused", async () => {
    mockRequireDistrictContext.mockRejectedValue(
      new PlatformError("unauthenticated", "An authenticated caller is required."),
    );
    await expectRejectedCode(
      __assignmentsCurrentRecipientsReconcileHandler(makeRequest()),
      "unauthenticated",
    );
  });

  it("non-teacher caller is refused", async () => {
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_CONTEXT, role: "student" });
    await expectRejectedCode(
      __assignmentsCurrentRecipientsReconcileHandler(makeRequest()),
      "role-forbidden",
    );
  });

  it("suspended/inactive teacher is refused (propagated from requireDistrictContext)", async () => {
    mockRequireDistrictContext.mockRejectedValue(
      new PlatformError("account-inactive", "The authenticated caller is not active."),
    );
    await expectRejectedCode(
      __assignmentsCurrentRecipientsReconcileHandler(makeRequest()),
      "account-inactive",
    );
  });

  it("missing class is refused", async () => {
    await expectRejectedCode(
      __assignmentsCurrentRecipientsReconcileHandler(makeRequest()),
      "classes.notFound",
    );
    expect(mockAssignmentsCurrentDocRef).not.toHaveBeenCalled();
    expect(mockReconcileAssignmentRecipients).not.toHaveBeenCalled();
  });

  it("wrong class owner fails BEFORE Current is ever resolved", async () => {
    seedClass({ teacherId: OTHER_TEACHER_UID });
    seedPointer();
    seedAssignment();

    await expectRejectedCode(
      __assignmentsCurrentRecipientsReconcileHandler(makeRequest()),
      "classes.forbidden",
    );
    expect(mockAssignmentsCurrentDocRef).not.toHaveBeenCalled();
    expect(mockReconcileAssignmentRecipients).not.toHaveBeenCalled();
  });

  it("cross-school class fails BEFORE Current is ever resolved", async () => {
    seedClass({ schoolId: OTHER_SCHOOL_ID });
    seedPointer();
    seedAssignment();

    await expectRejectedCode(
      __assignmentsCurrentRecipientsReconcileHandler(makeRequest()),
      "classes.forbidden",
    );
    expect(mockAssignmentsCurrentDocRef).not.toHaveBeenCalled();
    expect(mockReconcileAssignmentRecipients).not.toHaveBeenCalled();
  });
});

describe("assignmentsCurrentRecipientsReconcile: Current resolution failures fail closed", () => {
  it("Current absent: fails closed, engine not invoked, no audit", async () => {
    seedClass();
    // No pointer seeded at all.

    await expectRejectedCode(
      __assignmentsCurrentRecipientsReconcileHandler(makeRequest()),
      "assignments.currentNotResolved",
    );
    expect(mockReconcileAssignmentRecipients).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("Current malformed: fails closed, engine not invoked, no audit", async () => {
    seedClass();
    seedPointer({ source: "notARealSource" });

    await expectRejectedCode(
      __assignmentsCurrentRecipientsReconcileHandler(makeRequest()),
      "assignments.currentNotResolved",
    );
    expect(mockReconcileAssignmentRecipients).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("Current references a cross-class pointer scope: fails closed", async () => {
    seedClass();
    seedPointer({ classId: OTHER_CLASS_ID });
    seedAssignment();

    await expectRejectedCode(
      __assignmentsCurrentRecipientsReconcileHandler(makeRequest()),
      "assignments.currentNotResolved",
    );
    expect(mockReconcileAssignmentRecipients).not.toHaveBeenCalled();
  });

  it("Current references a cross-lesson pointer scope: fails closed", async () => {
    seedClass();
    seedPointer({ lessonSlug: OTHER_LESSON_SLUG });
    seedAssignment();

    await expectRejectedCode(
      __assignmentsCurrentRecipientsReconcileHandler(makeRequest()),
      "assignments.currentNotResolved",
    );
    expect(mockReconcileAssignmentRecipients).not.toHaveBeenCalled();
  });

  it("Current references a cross-teacher pointer scope: fails closed", async () => {
    seedClass();
    seedPointer({ teacherId: OTHER_TEACHER_UID });
    seedAssignment();

    await expectRejectedCode(
      __assignmentsCurrentRecipientsReconcileHandler(makeRequest()),
      "assignments.currentNotResolved",
    );
    expect(mockReconcileAssignmentRecipients).not.toHaveBeenCalled();
  });

  it("Current references a cross-school pointer scope: fails closed", async () => {
    seedClass();
    seedPointer({ schoolId: OTHER_SCHOOL_ID });
    seedAssignment();

    await expectRejectedCode(
      __assignmentsCurrentRecipientsReconcileHandler(makeRequest()),
      "assignments.currentNotResolved",
    );
    expect(mockReconcileAssignmentRecipients).not.toHaveBeenCalled();
  });

  it("Current references a missing assignment: fails closed, engine not invoked, no audit", async () => {
    seedClass();
    seedPointer();
    // Assignment deliberately not seeded.

    await expectRejectedCode(
      __assignmentsCurrentRecipientsReconcileHandler(makeRequest()),
      "assignments.currentNotResolved",
    );
    expect(mockReconcileAssignmentRecipients).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it.each(["draft", "closed", "archived"] as const)(
    "Current references a non-published (%s) assignment: fails closed, engine not invoked, no audit",
    async (status) => {
      seedClass();
      seedPointer();
      seedAssignment(ASSIGNMENT_ID, { status });

      await expectRejectedCode(
        __assignmentsCurrentRecipientsReconcileHandler(makeRequest()),
        "assignments.currentNotResolved",
      );
      expect(mockReconcileAssignmentRecipients).not.toHaveBeenCalled();
      expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    },
  );
});

describe("assignmentsCurrentRecipientsReconcile: stale client view cannot pin an old assignment", () => {
  it("a request naming only classId/lessonSlug always reconciles whatever is LIVE Current, never a value the client might believe is Current", async () => {
    // Model: a stale tab once observed Current = X. Some other operation
    // has since changed live Current to Y. The stale tab's request, by
    // this callable's own request contract, can only ever carry
    // {classId, lessonSlug} - there is no field through which it could
    // name X even if it tried. The server resolves whatever is live NOW.
    const Y = "assign-y";
    seedClass();
    seedPointer({ assignmentId: Y });
    seedAssignment(Y);

    const result = await __assignmentsCurrentRecipientsReconcileHandler(makeRequest());

    expect(result.assignmentId).toBe(Y);
    expect(mockReconcileAssignmentRecipients).toHaveBeenCalledWith(
      expect.objectContaining({ assignmentId: Y }),
      "teacherReconcile",
    );
    // X (the stale tab's remembered value) never appears anywhere - it was
    // never a value the request could carry in the first place.
    expect(mockReconcileAssignmentRecipients).not.toHaveBeenCalledWith(
      expect.objectContaining({ assignmentId: "assign-x-stale" }),
      expect.anything(),
    );
  });
});

describe("assignmentsCurrentRecipientsReconcile: engine result propagation and failure", () => {
  it("propagates the engine's exact aggregate result", async () => {
    seedClass();
    seedPointer();
    seedAssignment();
    mockReconcileAssignmentRecipients.mockResolvedValueOnce({ added: 7, alreadyCurrent: 3 });

    const result = await __assignmentsCurrentRecipientsReconcileHandler(makeRequest());

    expect(result.added).toBe(7);
    expect(result.alreadyCurrent).toBe(3);
  });

  it("propagates an engine integrity-violation error and never audits", async () => {
    seedClass();
    seedPointer();
    seedAssignment();
    mockReconcileAssignmentRecipients.mockRejectedValueOnce(
      new PlatformError(
        "assignments.recipientIntegrityViolation",
        "Existing recipient document does not match canonical ownership fields",
      ),
    );

    await expectRejectedCode(
      __assignmentsCurrentRecipientsReconcileHandler(makeRequest()),
      "assignments.recipientIntegrityViolation",
    );
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });
});
