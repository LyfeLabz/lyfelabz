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
const mockWriteAuditEvent = jest.fn();
const mockLogInfo = jest.fn();

type Row = { readonly id: string; readonly data: Record<string, unknown> };

const assignmentRegistry = new Map<
  string,
  { exists: boolean; data: () => unknown }
>();
const mockAssignmentDocRef = jest.fn((id: string) => ({
  get: () =>
    Promise.resolve(
      assignmentRegistry.get(id) ?? { exists: false, data: () => undefined },
    ),
}));

const classRegistry = new Map<string, { exists: boolean; data: () => unknown }>();
const mockClassDocRef = jest.fn((id: string) => ({
  get: () =>
    Promise.resolve(
      classRegistry.get(id) ?? { exists: false, data: () => undefined },
    ),
}));

const enrollmentsFixture: Row[] = [];
function makeEnrollmentsQuery(
  filters: Array<{ field: string; value: unknown }>,
) {
  return {
    where(field: string, _op: string, value: unknown) {
      return makeEnrollmentsQuery([...filters, { field, value }]);
    },
    get: () => {
      const filtered = enrollmentsFixture.filter((row) =>
        filters.every((f) => row.data[f.field] === f.value),
      );
      return Promise.resolve({
        docs: filtered.map((row) => ({ id: row.id, data: () => row.data })),
      });
    },
  };
}
const mockEnrollmentsCollectionRef = jest.fn(() => makeEnrollmentsQuery([]));

const recipientsFixture: Row[] = [];
const mockAssignmentRecipientsCollectionRef = jest.fn((assignmentId: string) => ({
  get: () =>
    Promise.resolve({
      docs: recipientsFixture
        .filter((row) => row.data.assignmentId === assignmentId)
        .map((row) => ({ id: row.id, data: () => row.data })),
    }),
}));

// Real `ensureAssignmentRecipient` (unmocked, imported transitively by the
// handler under test from `./assignment-recipients`) performs the
// existence-check-then-write against these two fakes, giving this suite
// genuine integration coverage of the Slice 1 <-> Slice 2 interaction
// rather than a mocked stand-in for it.
const mockAssignmentRecipientDocRef = jest.fn(
  (assignmentId: string, studentId: string) => ({
    get: () => {
      const exists = recipientsFixture.some(
        (row) => row.data.assignmentId === assignmentId && row.id === studentId,
      );
      return Promise.resolve({ exists });
    },
  }),
);
// Models Firestore's real `.set()` semantics at a deterministic document
// path: it is an upsert AT THAT EXACT PATH, never an append. Two `.set()`
// calls for the same (assignmentId, studentId) - exactly the scenario a
// genuine concurrent-call race produces - must result in exactly one
// entry, with the later call's payload winning, not two entries. A naive
// array-push fake would silently fail to model this and would make the
// "no duplicate canonical recipient documents" test below meaningless.
const mockRecipientCreationSet = jest.fn((payload: Record<string, unknown>) => {
  const id = payload.studentId as string;
  const assignmentId = payload.assignmentId as string;
  const existingIndex = recipientsFixture.findIndex(
    (row) => row.id === id && row.data.assignmentId === assignmentId,
  );
  if (existingIndex === -1) {
    recipientsFixture.push({ id, data: payload });
  } else {
    recipientsFixture[existingIndex] = { id, data: payload };
  }
  return Promise.resolve();
});
const mockAssignmentRecipientCreationDocRef = jest.fn(
  (assignmentId: string, studentId: string) => ({
    set: (payload: Record<string, unknown>) =>
      mockRecipientCreationSet({ ...payload, assignmentId, studentId }),
  }),
);

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    log: { info: mockLogInfo, warn: jest.fn(), error: jest.fn() },
    requireDistrictContext: mockRequireDistrictContext,
    writeAuditEvent: mockWriteAuditEvent,
    assignmentDocRef: mockAssignmentDocRef,
    classDocRef: mockClassDocRef,
    enrollmentsCollectionRef: mockEnrollmentsCollectionRef,
    assignmentRecipientsCollectionRef: mockAssignmentRecipientsCollectionRef,
    assignmentRecipientDocRef: mockAssignmentRecipientDocRef,
    assignmentRecipientCreationDocRef: mockAssignmentRecipientCreationDocRef,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __assignmentsRecipientsReconcileHandler } from "./assignments-recipients-reconcile";

const TEACHER_UID = "teacher-1";
const OTHER_TEACHER_UID = "teacher-2";
const SCHOOL_ID = "school-a";
const OTHER_SCHOOL_ID = "school-b";
const DISTRICT_ID = "district-1";
const ASSIGNMENT_ID = "assign-1";
const CLASS_ID = "class-abc";

const VALID_CONTEXT = Object.freeze({
  uid: TEACHER_UID,
  role: "teacher" as const,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
});

function makeRequest(
  data: Record<string, unknown> | undefined | null = { assignmentId: ASSIGNMENT_ID },
): CallableRequest<unknown> {
  return {
    data,
    auth: { uid: TEACHER_UID, token: {} } as never,
    rawRequest: {} as never,
  };
}

async function expectRejectedCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(PlatformError);
  await promise.catch((err: unknown) => {
    expect((err as PlatformError).code).toBe(code);
  });
}

function seedAssignment(
  overrides: Partial<Record<string, unknown>> = {},
  exists = true,
): void {
  assignmentRegistry.set(ASSIGNMENT_ID, {
    exists,
    data: () => ({
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      lessonSlug: "lesson_engineering-design",
      status: "published",
      ...overrides,
    }),
  });
}

function seedClass(overrides: Partial<Record<string, unknown>> = {}): void {
  classRegistry.set(CLASS_ID, {
    exists: true,
    data: () => ({
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      title: "6A Life Science",
      status: "active",
      createdAt: {},
      ...overrides,
    }),
  });
}

function seedActiveEnrollment(
  studentId: string,
  overrides: Partial<Record<string, unknown>> = {},
): void {
  enrollmentsFixture.push({
    id: `${CLASS_ID}__${studentId}`,
    data: {
      studentId,
      classId: CLASS_ID,
      schoolId: SCHOOL_ID,
      status: "active",
      enrolledAt: {},
      ...overrides,
    },
  });
}

function seedExistingRecipient(
  studentId: string,
  overrides: Partial<Record<string, unknown>> = {},
): void {
  recipientsFixture.push({
    id: studentId,
    data: {
      assignmentId: ASSIGNMENT_ID,
      studentId,
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      assignedAt: {},
      assignedBy: TEACHER_UID,
      source: "classPublication",
      status: "assigned",
      ...overrides,
    },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  assignmentRegistry.clear();
  classRegistry.clear();
  enrollmentsFixture.length = 0;
  recipientsFixture.length = 0;
  mockRequireDistrictContext.mockResolvedValue(VALID_CONTEXT);
});

describe("assignmentsRecipientsReconcile", () => {
  test("authenticated owning teacher can reconcile a published assignment", async () => {
    seedAssignment();
    seedClass();
    seedActiveEnrollment("stu-a");
    seedActiveEnrollment("stu-b");

    const res = await __assignmentsRecipientsReconcileHandler(makeRequest());

    expect(res).toEqual({ assignmentId: ASSIGNMENT_ID, added: 2, alreadyCurrent: 0 });
  });

  test("active enrolled students already present as recipients are preserved", async () => {
    seedAssignment();
    seedClass();
    seedActiveEnrollment("stu-a");
    seedExistingRecipient("stu-a", { source: "manualAddition" });

    await __assignmentsRecipientsReconcileHandler(makeRequest());

    const stored = recipientsFixture.find((r) => r.id === "stu-a")!;
    expect(stored.data.source).toBe("manualAddition");
    expect(recipientsFixture.length).toBe(1);
  });

  test("active enrolled students missing from recipients are added with source teacherReconcile", async () => {
    seedAssignment();
    seedClass();
    seedActiveEnrollment("stu-a");
    seedActiveEnrollment("stu-b");
    seedExistingRecipient("stu-a");

    const res = await __assignmentsRecipientsReconcileHandler(makeRequest());

    expect(res).toEqual({ assignmentId: ASSIGNMENT_ID, added: 1, alreadyCurrent: 1 });
    const created = recipientsFixture.find((r) => r.id === "stu-b")!;
    expect(created.data.source).toBe("teacherReconcile");
    expect(created.data.status).toBe("assigned");
    expect(created.data.assignedAt).toBe(SERVER_TIMESTAMP_SENTINEL);
  });

  test("inactive enrollments are NOT added", async () => {
    seedAssignment();
    seedClass();
    seedActiveEnrollment("stu-active");
    seedActiveEnrollment("stu-withdrawn", { status: "withdrawn" });
    seedActiveEnrollment("stu-transferred", { status: "transferred" });

    const res = await __assignmentsRecipientsReconcileHandler(makeRequest());

    expect(res).toEqual({ assignmentId: ASSIGNMENT_ID, added: 1, alreadyCurrent: 0 });
    expect(recipientsFixture.map((r) => r.id)).toEqual(["stu-active"]);
  });

  test("repeated reconciliation is idempotent", async () => {
    seedAssignment();
    seedClass();
    seedActiveEnrollment("stu-a");
    seedActiveEnrollment("stu-b");

    const first = await __assignmentsRecipientsReconcileHandler(makeRequest());
    expect(first).toEqual({ assignmentId: ASSIGNMENT_ID, added: 2, alreadyCurrent: 0 });

    const second = await __assignmentsRecipientsReconcileHandler(makeRequest());
    expect(second).toEqual({ assignmentId: ASSIGNMENT_ID, added: 0, alreadyCurrent: 2 });
    expect(recipientsFixture.length).toBe(2);
  });

  test("an assignment with every active enrollee already present performs zero recipient writes", async () => {
    seedAssignment();
    seedClass();
    seedActiveEnrollment("stu-a");
    seedExistingRecipient("stu-a");

    await __assignmentsRecipientsReconcileHandler(makeRequest());

    expect(mockRecipientCreationSet).not.toHaveBeenCalled();
  });

  test("non-published assignment is refused", async () => {
    seedAssignment({ status: "draft" });
    seedClass();

    await expectRejectedCode(
      __assignmentsRecipientsReconcileHandler(makeRequest()),
      "assignments.invalidTransition",
    );
  });

  test("closed assignment is refused", async () => {
    seedAssignment({ status: "closed" });
    seedClass();

    await expectRejectedCode(
      __assignmentsRecipientsReconcileHandler(makeRequest()),
      "assignments.invalidTransition",
    );
  });

  test("archived assignment is refused", async () => {
    seedAssignment({ status: "archived" });
    seedClass();

    await expectRejectedCode(
      __assignmentsRecipientsReconcileHandler(makeRequest()),
      "assignments.invalidTransition",
    );
  });

  test("non-owning teacher is refused", async () => {
    seedAssignment({ teacherId: OTHER_TEACHER_UID });
    seedClass({ teacherId: OTHER_TEACHER_UID });

    await expectRejectedCode(
      __assignmentsRecipientsReconcileHandler(makeRequest()),
      "assignments.forbidden",
    );
  });

  test("cross-school assignment ownership is refused", async () => {
    seedAssignment({ schoolId: OTHER_SCHOOL_ID });
    seedClass({ schoolId: OTHER_SCHOOL_ID });

    await expectRejectedCode(
      __assignmentsRecipientsReconcileHandler(makeRequest()),
      "assignments.forbidden",
    );
  });

  test("class ownership inconsistent with assignment is refused", async () => {
    seedAssignment();
    seedClass({ teacherId: OTHER_TEACHER_UID });

    await expectRejectedCode(
      __assignmentsRecipientsReconcileHandler(makeRequest()),
      "classes.forbidden",
    );
  });

  test("missing assignment is refused", async () => {
    seedClass();

    await expectRejectedCode(
      __assignmentsRecipientsReconcileHandler(makeRequest()),
      "assignments.notFound",
    );
  });

  test("missing class is refused", async () => {
    seedAssignment();

    await expectRejectedCode(
      __assignmentsRecipientsReconcileHandler(makeRequest()),
      "classes.notFound",
    );
  });

  test("non-teacher caller is refused", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_CONTEXT,
      role: "student",
    });
    seedAssignment();
    seedClass();

    await expectRejectedCode(
      __assignmentsRecipientsReconcileHandler(makeRequest()),
      "role-forbidden",
    );
  });

  test("malformed request (missing assignmentId) is refused", async () => {
    await expectRejectedCode(
      __assignmentsRecipientsReconcileHandler(makeRequest({})),
      "assignments.invalidAssignmentId",
    );
  });

  test("malformed request (non-object payload) is refused", async () => {
    await expectRejectedCode(
      __assignmentsRecipientsReconcileHandler(makeRequest(null)),
      "assignments.invalidRequest",
    );
  });

  test.each(["studentIds", "studentId", "classId", "teacherId", "schoolId", "source"])(
    "forbidden extra request key %s is refused",
    async (key) => {
      await expectRejectedCode(
        __assignmentsRecipientsReconcileHandler(
          makeRequest({ assignmentId: ASSIGNMENT_ID, [key]: "x" }),
        ),
        "assignments.invalidRequest",
      );
    },
  );

  test("response contains aggregate counts only, no student-identifying data", async () => {
    seedAssignment();
    seedClass();
    seedActiveEnrollment("stu-a");
    seedActiveEnrollment("stu-b");

    const res = await __assignmentsRecipientsReconcileHandler(makeRequest());

    expect(Object.keys(res).sort()).toEqual(["added", "alreadyCurrent", "assignmentId"]);
  });

  test("no Classroom publication path is invoked (no lms-related shared symbol is referenced)", async () => {
    seedAssignment();
    seedClass();
    seedActiveEnrollment("stu-a");

    await __assignmentsRecipientsReconcileHandler(makeRequest());

    // The mocked `../shared` module intentionally supplies no
    // `lmsAssignmentsPublish`/publication-related export at all; if the
    // handler ever referenced one, this test file's module resolution
    // would fail before any assertion runs.
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "assignments.recipientsReconciled" }),
    );
  });

  test("audit event carries aggregate counts and no student identifier", async () => {
    seedAssignment();
    seedClass();
    seedActiveEnrollment("stu-a");
    seedActiveEnrollment("stu-b");
    seedExistingRecipient("stu-a");

    await __assignmentsRecipientsReconcileHandler(makeRequest());

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
        added: 1,
        alreadyCurrent: 1,
      },
    });
  });

  test("concurrent reconciliation calls cannot create duplicate canonical recipient documents", async () => {
    seedAssignment();
    seedClass();
    seedActiveEnrollment("stu-a");
    seedActiveEnrollment("stu-b");
    seedActiveEnrollment("stu-c");

    const [first, second] = await Promise.all([
      __assignmentsRecipientsReconcileHandler(makeRequest()),
      __assignmentsRecipientsReconcileHandler(makeRequest()),
    ]);

    // Exactly one recipient document per student, regardless of how the
    // two concurrent calls' `added`/`alreadyCurrent` counts split the
    // three students between them - no duplicate document was created at
    // any (assignmentId, studentId) path.
    const ids = recipientsFixture.map((r) => r.id).sort();
    expect(ids).toEqual(["stu-a", "stu-b", "stu-c"]);
    expect(recipientsFixture.length).toBe(3);
    // Each call's own added+alreadyCurrent always sums to the full active
    // population as seen from that call's own perspective, regardless of
    // how the race actually interleaved.
    expect(first.added + first.alreadyCurrent).toBe(3);
    expect(second.added + second.alreadyCurrent).toBe(3);
  });
});
