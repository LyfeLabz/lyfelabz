import type { CallableRequest } from "firebase-functions/v2/https";

const mockAssignmentGet = jest.fn();
const mockEnrollmentGet = jest.fn();
const mockSessionGet = jest.fn();
const mockSessionCreate = jest.fn();
const mockRecipientGet = jest.fn();

// F5.2 Slice 6 differentiation ports (consumed via begin-delivery-deps, which
// imports these from the same mocked `../shared`).
const mockAccommodationGet = jest.fn();
const mockGrantGet = jest.fn();
const mockIndexGet = jest.fn();
const mockIsDeliveryEnabled = jest.fn();

const mockAssignmentDocRef = jest.fn(() => ({ get: mockAssignmentGet }));
const mockEnrollmentDocRef = jest.fn(() => ({ get: mockEnrollmentGet }));
const mockSessionDocRef = jest.fn(() => ({ get: mockSessionGet }));
const mockSessionCreationDocRef = jest.fn(() => ({
  set: mockSessionCreate,
  create: mockSessionCreate,
}));
const mockRecipientCreationSet = jest.fn();
const mockAssignmentRecipientDocRef = jest.fn(() => ({
  get: mockRecipientGet,
}));
const mockAssignmentRecipientCreationDocRef = jest.fn(() => ({
  set: mockRecipientCreationSet,
}));
const mockStudentAccommodationDocRef = jest.fn(() => ({ get: mockAccommodationGet }));
const mockLaunchGrantDocRef = jest.fn(() => ({ get: mockGrantGet }));
const mockPresentationVariantIndexDocRef = jest.fn(() => ({ get: mockIndexGet }));

const mockWriteAuditEvent = jest.fn();
const mockRequireDistrictContext = jest.fn();

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

const SERVER_TIMESTAMP_SENTINEL = Symbol("serverTimestamp");

const FIXED_NOW_MS = 1_700_000_000_000;

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
  },
  Timestamp: {
    now: () => ({ toMillis: () => FIXED_NOW_MS }),
    fromMillis: (ms: number) => ({ toMillis: () => ms }),
  },
}));

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
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    assignmentDocRef: mockAssignmentDocRef,
    enrollmentDocRef: mockEnrollmentDocRef,
    assessmentSessionDocRef: mockSessionDocRef,
    assessmentSessionCreationDocRef: mockSessionCreationDocRef,
    assignmentRecipientDocRef: mockAssignmentRecipientDocRef,
    assignmentRecipientCreationDocRef: mockAssignmentRecipientCreationDocRef,
    enrollmentsCollectionRef: jest.fn(),
    requireDistrictContext: mockRequireDistrictContext,
    writeAuditEvent: mockWriteAuditEvent,
    // Slice 6 differentiation ports + pure helpers used by begin-delivery-deps.
    studentAccommodationDocRef: mockStudentAccommodationDocRef,
    launchGrantDocRef: mockLaunchGrantDocRef,
    presentationVariantIndexDocRef: mockPresentationVariantIndexDocRef,
    isDifferentiatedDeliveryEnabled: mockIsDeliveryEnabled,
    isValidGrantId: (value: unknown) =>
      typeof value === "string" && /^[0-9a-f]{32}$/.test(value),
    isValidLessonSlugForVariant: (slug: string) =>
      typeof slug === "string" && /^[a-z0-9-]+$/.test(slug),
    isValidVariantKey: (variantKey: string) =>
      typeof variantKey === "string" &&
      /^[a-z0-9-]+$/.test(variantKey) &&
      !variantKey.includes("__"),
    assertActivateWriteConsistent: () => undefined,
    variantKeyForReadingLevel: (level: string) => `reading-${level}`,
    parseAssessmentIdFromRevisionId: (revisionId: string) => {
      const m = /__r(\d+)$/.exec(revisionId);
      if (!m) return undefined;
      const head = revisionId.slice(0, m.index);
      if (!head.startsWith("assessment_")) return undefined;
      if (head.length <= "assessment_".length) return undefined;
      return head;
    },
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import {
  __assessmentSessionsBeginHandler,
  sessionIdFor,
} from "./assessment-sessions-begin";

const STUDENT_UID = "student-uid";
const SCHOOL_ID = "school-a";
const DISTRICT_ID = "district-1";
const CLASS_ID = "class-abc";
const TEACHER_UID = "teacher-uid";
const ASSIGNMENT_ID = "assign-1";
const LESSON_SLUG = "lesson_g7_earths-layers";
const LESSON_VERSION = "1";
const ACTIVITY_ID = LESSON_SLUG;
const ASSESSMENT_ID = `assessment_${LESSON_SLUG}`;
const REVISION_ID = `assessment_${LESSON_SLUG}__r${LESSON_VERSION}`;
const SESSION_ID = `${ASSIGNMENT_ID}__${STUDENT_UID}__1`;

const VALID_DATA = {
  assignmentId: ASSIGNMENT_ID,
};

const VALID_DISTRICT_CONTEXT = Object.freeze({
  uid: STUDENT_UID,
  role: "student" as const,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
});

function makeRequest(overrides: { data?: unknown } = {}): CallableRequest<unknown> {
  const data = overrides.data === undefined ? { ...VALID_DATA } : overrides.data;
  return {
    data,
    auth: { uid: STUDENT_UID, token: {} } as never,
    rawRequest: {} as never,
  };
}

function assignmentSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      lessonSlug: LESSON_SLUG,
      assessmentRevisionId: REVISION_ID,
      mode: "classroom",
      status: "published",
      createdAt: {} as never,
      ...overrides,
    }),
  };
}

function enrollmentSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      studentId: STUDENT_UID,
      classId: CLASS_ID,
      schoolId: SCHOOL_ID,
      status: "active",
      enrolledAt: {} as never,
      ...overrides,
    }),
  };
}

function absentSessionSnapshot() {
  return { exists: false, data: () => undefined };
}

// -------- Slice 6 differentiation fixtures --------

const VALID_LAUNCH_REF = "0123456789abcdef0123456789abcdef";
// A charset-valid lessonSlug (no underscores) so the no-ref coverage check can
// classify an index as "active". The default LESSON_SLUG carries underscores
// and therefore always resolves to a legitimate coverage gap (absent).
const VARIANT_LESSON_SLUG = "earths-layers";
const VARIANT_KEY = "reading-adapted";
const REVISION_A = `pr${"a".repeat(64)}`;
const FAR_FUTURE_MS = 9_999_999_999_999;

function absentAccommodationSnapshot() {
  return { exists: false, data: () => undefined };
}

function activeAccommodationSnapshot() {
  return {
    exists: true,
    data: () => ({
      studentId: STUDENT_UID,
      schoolId: SCHOOL_ID,
      readingAccessibility: { status: "active", level: "adapted" },
      configRevision: 1,
      createdAt: {} as never,
      createdBy: TEACHER_UID,
      updatedAt: {} as never,
      updatedBy: TEACHER_UID,
    }),
  };
}

function differentiatedGrantSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      grantId: VALID_LAUNCH_REF,
      studentId: STUDENT_UID,
      assignmentId: ASSIGNMENT_ID,
      lessonSlug: LESSON_SLUG,
      outcomeAtIssuance: "differentiated",
      variantKey: VARIANT_KEY,
      presentationRevisionId: REVISION_A,
      issuedAt: { toMillis: () => FAR_FUTURE_MS - 60_000 },
      expiresAt: { toMillis: () => FAR_FUTURE_MS },
      ...overrides,
    }),
  };
}

function fallbackGrantSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      grantId: VALID_LAUNCH_REF,
      studentId: STUDENT_UID,
      assignmentId: ASSIGNMENT_ID,
      lessonSlug: LESSON_SLUG,
      outcomeAtIssuance: "canonicalFallback",
      issuedAt: { toMillis: () => FAR_FUTURE_MS - 60_000 },
      expiresAt: { toMillis: () => FAR_FUTURE_MS },
      ...overrides,
    }),
  };
}

function activeIndexSnapshot(lessonSlug: string) {
  return {
    exists: true,
    data: () => ({
      lessonSlug,
      variantKey: VARIANT_KEY,
      currentPresentationRevisionId: REVISION_A,
      currentPath: `app/lessons/variants/lesson_${lessonSlug}__${REVISION_A}.html`,
      contentSha256: "a".repeat(64),
      status: "active",
      updatedAt: {} as never,
      publishedBy: "publisher",
    }),
  };
}

function recipientSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_UID,
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      assignedAt: {} as never,
      assignedBy: TEACHER_UID,
      source: "classPublication",
      status: "assigned",
      ...overrides,
    }),
  };
}

function absentRecipientSnapshot() {
  return { exists: false, data: () => undefined };
}

function existingLiveSessionSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      studentId: STUDENT_UID,
      assignmentId: ASSIGNMENT_ID,
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      activityId: ACTIVITY_ID,
      assessmentId: ASSESSMENT_ID,
      assessmentRevisionId: REVISION_ID,
      sessionOrdinal: 1,
      status: "live",
      startedAt: {} as never,
      ...overrides,
    }),
  };
}

describe("assessmentSessionsBegin", () => {
  beforeEach(() => {
    mockAssignmentGet.mockReset();
    mockEnrollmentGet.mockReset();
    mockSessionGet.mockReset();
    mockSessionCreate.mockReset();
    mockRecipientGet.mockReset();
    mockRecipientGet.mockResolvedValue(recipientSnapshot());
    mockRecipientCreationSet.mockReset();
    mockRecipientCreationSet.mockResolvedValue(undefined);
    mockAssignmentDocRef.mockClear();
    mockEnrollmentDocRef.mockClear();
    mockSessionDocRef.mockClear();
    mockSessionCreationDocRef.mockClear();
    mockAssignmentRecipientDocRef.mockClear();
    mockAssignmentRecipientCreationDocRef.mockClear();
    mockWriteAuditEvent.mockReset();
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_DISTRICT_CONTEXT });
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
    // Slice 6 defaults: no accommodation record (=> canonical), delivery
    // enabled, no grant/index reads unless a test opts in. These keep the
    // pre-Slice-6 canonical begin behavior intact for every existing test.
    mockAccommodationGet.mockReset();
    mockAccommodationGet.mockResolvedValue(absentAccommodationSnapshot());
    mockGrantGet.mockReset();
    mockIndexGet.mockReset();
    mockIndexGet.mockResolvedValue({ exists: false, data: () => undefined });
    mockIsDeliveryEnabled.mockReset();
    mockIsDeliveryEnabled.mockResolvedValue(true);
    mockStudentAccommodationDocRef.mockClear();
    mockLaunchGrantDocRef.mockClear();
    mockPresentationVariantIndexDocRef.mockClear();
  });

  it("returns the deterministic first-session identifier", () => {
    expect(sessionIdFor(ASSIGNMENT_ID, STUDENT_UID)).toBe(SESSION_ID);
    expect(sessionIdFor(ASSIGNMENT_ID, STUDENT_UID, 3)).toBe(
      `${ASSIGNMENT_ID}__${STUDENT_UID}__3`,
    );
  });

  it("creates a canonical Live session and emits a single audit event", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSessionGet.mockResolvedValueOnce(absentSessionSnapshot());
    mockSessionCreate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    const result = await __assessmentSessionsBeginHandler(makeRequest());

    expect(mockRequireDistrictContext).toHaveBeenCalledTimes(1);
    expect(mockAssignmentDocRef).toHaveBeenCalledWith(ASSIGNMENT_ID);
    expect(mockEnrollmentDocRef).toHaveBeenCalledWith(`${CLASS_ID}__${STUDENT_UID}`);
    expect(mockSessionDocRef).toHaveBeenCalledWith(SESSION_ID);
    expect(mockSessionCreationDocRef).toHaveBeenCalledWith(SESSION_ID);
    expect(mockSessionCreate).toHaveBeenCalledTimes(1);
    expect(mockSessionCreate).toHaveBeenCalledWith({
      studentId: STUDENT_UID,
      assignmentId: ASSIGNMENT_ID,
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      activityId: ACTIVITY_ID,
      assessmentId: ASSESSMENT_ID,
      assessmentRevisionId: REVISION_ID,
      sessionOrdinal: 1,
      status: "live",
      startedAt: SERVER_TIMESTAMP_SENTINEL,
      // Slice 6: no accommodation (default fixture) => canonical, no pair.
      deliveryOutcome: "canonical",
    });
    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: STUDENT_UID,
      actorRole: "student",
      action: "assessment.sessionBegan",
      targetType: "assessmentSession",
      targetId: SESSION_ID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      payload: {
        assignmentId: ASSIGNMENT_ID,
        classId: CLASS_ID,
        activityId: ACTIVITY_ID,
        assessmentId: ASSESSMENT_ID,
        assessmentRevisionId: REVISION_ID,
        sessionOrdinal: 1,
        districtId: DISTRICT_ID,
      },
    });
    expect(result).toEqual({ sessionId: SESSION_ID, alreadyLive: false });
  });

  it("returns the existing Live session idempotently without a second write", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSessionGet.mockResolvedValueOnce(existingLiveSessionSnapshot());

    const result = await __assessmentSessionsBeginHandler(makeRequest());

    expect(result).toEqual({ sessionId: SESSION_ID, alreadyLive: true });
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("refuses a second Live session with mismatched canonical fields", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSessionGet.mockResolvedValueOnce(
      existingLiveSessionSnapshot({ classId: "other-class" }),
    );

    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentSessions.conflict" });
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("refuses when an archived session already occupies the ordinal", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSessionGet.mockResolvedValueOnce(
      existingLiveSessionSnapshot({ status: "archived" }),
    );

    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentSessions.conflict" });
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("propagates the canonical unauthenticated district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("unauthenticated", "no auth"),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("propagates the canonical account-inactive district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("account-inactive", "inactive"),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "account-inactive" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
  });

  it("propagates the canonical claim-stale district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("claim-stale", "stale"),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "claim-stale" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
  });

  it("propagates the canonical district-mismatch district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("district-mismatch", "mismatch"),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "district-mismatch" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
  });

  it("propagates the canonical school-district-mismatch district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("school-district-mismatch", "mismatch"),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "school-district-mismatch" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
  });

  it("propagates the canonical district-unassigned district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("district-unassigned", "no district"),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "district-unassigned" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
  });

  it("rejects a non-student active caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValueOnce({
      uid: "teacher-uid",
      role: "teacher",
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
    });
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("rejects a request whose payload is not a structured object", async () => {
    await expect(
      __assessmentSessionsBeginHandler(makeRequest({ data: null })),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidRequest" });
    await expect(
      __assessmentSessionsBeginHandler(makeRequest({ data: "not-an-object" })),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidRequest" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed assignmentId", async () => {
    await expect(
      __assessmentSessionsBeginHandler(makeRequest({ data: {} })),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidAssignmentId" });
    await expect(
      __assessmentSessionsBeginHandler(
        makeRequest({ data: { assignmentId: "" } }),
      ),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidAssignmentId" });
    await expect(
      __assessmentSessionsBeginHandler(
        makeRequest({ data: { assignmentId: "not a url safe token!" } }),
      ),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidAssignmentId" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
  });

  it("rejects a missing assignment record", async () => {
    mockAssignmentGet.mockResolvedValueOnce({
      exists: false,
      data: () => undefined,
    });
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignment-not-found" });
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("rejects a cross-school assignment target", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      assignmentSnapshot({ schoolId: "other-school" }),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentSessions.forbidden" });
    expect(mockEnrollmentGet).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("rejects a practice-mode assignment target", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      assignmentSnapshot({ mode: "practice" }),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({
      code: "assignment-mode-invalid",
    });
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("rejects a non-published assignment target with certified refusals", async () => {
    // Sprint 11C Remediation Slice 1 (C-2). `closed` maps to the
    // canonical `assignment-window-closed`; `draft` and `archived` map
    // to the canonical `assignment-not-published` per
    // ASSESSMENT_IMPLEMENTATION_CONTRACT.md §25.
    const cases: ReadonlyArray<{
      status: "draft" | "closed" | "archived";
      code: string;
    }> = [
      { status: "draft", code: "assignment-not-published" },
      { status: "closed", code: "assignment-window-closed" },
      { status: "archived", code: "assignment-not-published" },
    ];
    for (const { status, code } of cases) {
      mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot({ status }));
      await expect(
        __assessmentSessionsBeginHandler(makeRequest()),
      ).rejects.toMatchObject({ code });
    }
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("rejects a caller without an active enrollment", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce({
      exists: false,
      data: () => undefined,
    });
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollment-inactive" });
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("rejects a caller whose enrollment is not active", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(
      enrollmentSnapshot({ status: "removed" }),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollment-inactive" });
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("does not emit an audit event when the session write fails", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSessionGet.mockResolvedValueOnce(absentSessionSnapshot());
    mockSessionCreate.mockRejectedValueOnce(new Error("write failed"));
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toThrow("write failed");
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  // -------- Sprint 11C Remediation Slice 1 - Critical Finding C-2 --------

  it("C-2: refuses when the assignment window has not yet opened", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      assignmentSnapshot({
        availableAt: { toMillis: () => FIXED_NOW_MS + 60_000 },
      }),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignment-window-closed" });
    expect(mockEnrollmentGet).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("C-2: refuses when the assignment window has already closed", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      assignmentSnapshot({
        windowClosesAt: { toMillis: () => FIXED_NOW_MS - 60_000 },
      }),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignment-window-closed" });
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("C-2: refuses when the caller is not enrolled at all with enrollment-inactive", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce({
      exists: false,
      data: () => undefined,
    });
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollment-inactive" });
  });

  // Sprint 11D I-3. Two concurrent begin calls for the same
  // deterministic sessionId can both observe `exists === false` at the
  // pre-check. The pre-Sprint-11D `.set()` write would silently
  // overwrite the first-committed session. The corrected implementation
  // uses `.create()` (server-enforced "must-not-exist" precondition) and
  // maps the ALREADY_EXISTS grpc code back to the canonical
  // `assessmentSessions.conflict` identifier so the caller observes the
  // same refusal identifier they would have observed on a mid-check
  // conflict.
  // -------- Sprint 12E Slice 2B / Phase B Core Layer 2 - recipient enforcement --------
  //
  // Layer 2 self-heal replaces the old read-only `isCanonicalRecipient`
  // refusal with `ensureAssignmentRecipient`: if the recipient doc is
  // missing AFTER active enrollment is confirmed, it is idempotently
  // created with source `lateJoinReconciliation`. If the doc already
  // exists AND is canonical, `ensureAssignmentRecipient` returns
  // `{added: false}` (no write). If the doc exists but is noncanonical,
  // `ensureAssignmentRecipient` throws a fail-closed
  // `assignments.recipientIntegrityViolation` error - it does NOT
  // silently accept or overwrite malformed data.

  it("recipient: creates a session when a canonical recipient exists (no recipient creation write)", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSessionGet.mockResolvedValueOnce(absentSessionSnapshot());
    mockSessionCreate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-r", record: {} });
    const result = await __assessmentSessionsBeginHandler(makeRequest());
    expect(result).toEqual({ sessionId: SESSION_ID, alreadyLive: false });
    expect(mockAssignmentRecipientDocRef).toHaveBeenCalledWith(
      ASSIGNMENT_ID,
      STUDENT_UID,
    );
    expect(mockRecipientGet).toHaveBeenCalledTimes(1);
    expect(mockRecipientCreationSet).not.toHaveBeenCalled();
  });

  it("Layer 2 self-heal: missing recipient + active enrollment creates the recipient with source lateJoinReconciliation then begins session", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockRecipientGet.mockReset();
    mockRecipientGet.mockResolvedValueOnce(absentRecipientSnapshot());
    mockSessionGet.mockResolvedValueOnce(absentSessionSnapshot());
    mockSessionCreate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-sh", record: {} });

    const result = await __assessmentSessionsBeginHandler(makeRequest());

    expect(result).toEqual({ sessionId: SESSION_ID, alreadyLive: false });
    expect(mockAssignmentRecipientDocRef).toHaveBeenCalledWith(
      ASSIGNMENT_ID,
      STUDENT_UID,
    );
    expect(mockAssignmentRecipientCreationDocRef).toHaveBeenCalledWith(
      ASSIGNMENT_ID,
      STUDENT_UID,
    );
    expect(mockRecipientCreationSet).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: ASSIGNMENT_ID,
        studentId: STUDENT_UID,
        classId: CLASS_ID,
        teacherId: TEACHER_UID,
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
        assignedBy: TEACHER_UID,
        source: "lateJoinReconciliation",
        status: "assigned",
      }),
    );
    expect(mockSessionCreate).toHaveBeenCalled();
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "assessment.sessionBegan" }),
    );
  });

  it("Layer 2: missing recipient + NO active enrollment refuses and creates zero recipients", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockReset();
    mockEnrollmentGet.mockResolvedValueOnce(
      { exists: false, data: () => undefined },
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollment-inactive" });
    expect(mockRecipientGet).not.toHaveBeenCalled();
    expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("Layer 2: missing recipient + inactive enrollment refuses and creates zero recipients", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockReset();
    mockEnrollmentGet.mockResolvedValueOnce(
      enrollmentSnapshot({ status: "withdrawn" }),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollment-inactive" });
    expect(mockRecipientGet).not.toHaveBeenCalled();
    expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("Layer 2: missing recipient + enrollment in a DIFFERENT class refuses and creates zero recipients", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    // The enrollment doc at `classId__studentId` does not exist because
    // the student is enrolled in another class, not assignment.classId.
    mockEnrollmentGet.mockReset();
    mockEnrollmentGet.mockResolvedValueOnce(
      { exists: false, data: () => undefined },
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollment-inactive" });
    expect(mockRecipientGet).not.toHaveBeenCalled();
    expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("Layer 2: assignment not published refuses BEFORE recipient repair", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      assignmentSnapshot({ status: "draft" }),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignment-not-published" });
    expect(mockEnrollmentGet).not.toHaveBeenCalled();
    expect(mockRecipientGet).not.toHaveBeenCalled();
    expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("Layer 2: recipient repair write fails => fails closed, zero sessions", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockRecipientGet.mockReset();
    mockRecipientGet.mockResolvedValueOnce(absentRecipientSnapshot());
    mockRecipientCreationSet.mockReset();
    mockRecipientCreationSet.mockRejectedValueOnce(new Error("Firestore unavailable"));
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toThrow();
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("Layer 2: repeated call after successful repair is idempotent", async () => {
    // First call: self-heal creates recipient
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockRecipientGet.mockReset();
    mockRecipientGet.mockResolvedValueOnce(absentRecipientSnapshot());
    mockSessionGet.mockResolvedValueOnce(absentSessionSnapshot());
    mockSessionCreate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });
    await __assessmentSessionsBeginHandler(makeRequest());
    expect(mockRecipientCreationSet).toHaveBeenCalledTimes(1);

    // Second call: recipient now exists (mocked), session exists (idempotent)
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockRecipientGet.mockResolvedValueOnce(recipientSnapshot());
    mockSessionGet.mockResolvedValueOnce(existingLiveSessionSnapshot());
    mockRecipientCreationSet.mockClear();
    const result = await __assessmentSessionsBeginHandler(makeRequest());
    expect(result).toEqual({ sessionId: SESSION_ID, alreadyLive: true });
    expect(mockRecipientCreationSet).not.toHaveBeenCalled();
  });

  it("Layer 2: concurrent repair via deterministic doc path prevents duplicate recipients", async () => {
    // The deterministic recipient doc path
    // `assignments/{assignmentId}/recipients/{studentId}` makes structural
    // duplication impossible. Two concurrent `ensureAssignmentRecipient`
    // calls for the same (assignmentId, studentId): one creates via
    // `.set()` (upsert), the other sees `exists: true` and skips. The
    // shared primitive is tested exhaustively in
    // `assignment-recipients.test.ts`; this test confirms the session-begin
    // call site feeds the right arguments to the deterministic path.
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockRecipientGet.mockReset();
    mockRecipientGet.mockResolvedValueOnce(absentRecipientSnapshot());
    mockSessionGet.mockResolvedValueOnce(absentSessionSnapshot());
    mockSessionCreate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-c", record: {} });

    await __assessmentSessionsBeginHandler(makeRequest());

    expect(mockAssignmentRecipientDocRef).toHaveBeenCalledWith(
      ASSIGNMENT_ID,
      STUDENT_UID,
    );
    expect(mockAssignmentRecipientCreationDocRef).toHaveBeenCalledWith(
      ASSIGNMENT_ID,
      STUDENT_UID,
    );
  });

  it("Layer 2: existing recipient WITHOUT active enrollment still refuses access", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockReset();
    mockEnrollmentGet.mockResolvedValueOnce(
      { exists: false, data: () => undefined },
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "enrollment-inactive" });
    // The recipient check is never reached; enrollment is the gatekeeper.
    expect(mockRecipientGet).not.toHaveBeenCalled();
    expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  // -------- Restored security tests: malformed/noncanonical recipient docs fail closed --------
  //
  // These tests prove that an existing recipient doc with mismatched
  // ownership fields is rejected by `ensureAssignmentRecipient` (via the
  // shared `isCanonicalRecipientData` predicate), resulting in a
  // fail-closed PlatformError. No session is created, no recipient is
  // overwritten. Active enrollment alone is NOT sufficient - the recipient
  // doc must also be canonical.

  it("Security: existing recipient with mismatched assignmentId fails closed - no session", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockRecipientGet.mockReset();
    mockRecipientGet.mockResolvedValueOnce(
      recipientSnapshot({ assignmentId: "wrong-assignment" }),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.recipientIntegrityViolation" });
    expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("Security: existing recipient with mismatched studentId fails closed - no session", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockRecipientGet.mockReset();
    mockRecipientGet.mockResolvedValueOnce(
      recipientSnapshot({ studentId: "wrong-student" }),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.recipientIntegrityViolation" });
    expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("Security: existing recipient with mismatched schoolId fails closed - no session", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockRecipientGet.mockReset();
    mockRecipientGet.mockResolvedValueOnce(
      recipientSnapshot({ schoolId: "wrong-school" }),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.recipientIntegrityViolation" });
    expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("Security: existing recipient with mismatched districtId fails closed - no session", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockRecipientGet.mockReset();
    mockRecipientGet.mockResolvedValueOnce(
      recipientSnapshot({ districtId: "wrong-district" }),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.recipientIntegrityViolation" });
    expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("Security: existing recipient with status removed fails closed - no session", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockRecipientGet.mockReset();
    mockRecipientGet.mockResolvedValueOnce(
      recipientSnapshot({ status: "removed" }),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.recipientIntegrityViolation" });
    expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("Security: existing recipient with undefined data fails closed - no session", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockRecipientGet.mockReset();
    mockRecipientGet.mockResolvedValueOnce({ exists: true, data: () => undefined });
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.recipientIntegrityViolation" });
    expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("Security: malformed recipient is NOT silently overwritten with canonical values", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockRecipientGet.mockReset();
    mockRecipientGet.mockResolvedValueOnce(
      recipientSnapshot({ schoolId: "wrong-school" }),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.recipientIntegrityViolation" });
    expect(mockAssignmentRecipientCreationDocRef).not.toHaveBeenCalled();
    expect(mockRecipientCreationSet).not.toHaveBeenCalled();
  });

  it("Security: multiple mismatched fields still fail closed with a single integrity violation", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockRecipientGet.mockReset();
    mockRecipientGet.mockResolvedValueOnce(
      recipientSnapshot({
        assignmentId: "wrong-assignment",
        studentId: "wrong-student",
        schoolId: "wrong-school",
        districtId: "wrong-district",
        status: "removed",
      }),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.recipientIntegrityViolation" });
    expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("Security: empty-object recipient data fails closed - no session", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockRecipientGet.mockReset();
    mockRecipientGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.recipientIntegrityViolation" });
    expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("Security: recipient integrity violation is a PlatformError instance", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockRecipientGet.mockReset();
    mockRecipientGet.mockResolvedValueOnce(
      recipientSnapshot({ schoolId: "wrong-school" }),
    );
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toBeInstanceOf(PlatformError);
  });

  it("I-3: maps a create-time ALREADY_EXISTS race to assessmentSessions.conflict", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSessionGet.mockResolvedValueOnce(absentSessionSnapshot());
    const alreadyExists = Object.assign(new Error("already exists"), {
      code: 6,
    });
    mockSessionCreate.mockRejectedValueOnce(alreadyExists);
    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assessmentSessions.conflict" });
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  // -------- F5.2 Slice 6 - session binding + delivery outcome --------

  it("Slice 6: freezes differentiated + pair from a valid launch grant", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSessionGet.mockResolvedValueOnce(absentSessionSnapshot());
    // The grant is bound to the assignment-frozen lessonSlug. Active
    // accommodation is irrelevant on the grant path; leave the default absent.
    mockGrantGet.mockResolvedValueOnce(differentiatedGrantSnapshot());
    mockSessionCreate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-d", record: {} });

    const result = await __assessmentSessionsBeginHandler(
      makeRequest({ data: { assignmentId: ASSIGNMENT_ID, launchRef: VALID_LAUNCH_REF } }),
    );

    expect(result).toEqual({ sessionId: SESSION_ID, alreadyLive: false });
    expect(mockLaunchGrantDocRef).toHaveBeenCalledWith(VALID_LAUNCH_REF);
    expect(mockSessionCreate).toHaveBeenCalledTimes(1);
    expect(mockSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryOutcome: "differentiated",
        variantKey: VARIANT_KEY,
        presentationRevisionId: REVISION_A,
      }),
    );
  });

  it("Slice 6: freezes canonicalFallback (no pair) from a valid fallback grant", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSessionGet.mockResolvedValueOnce(absentSessionSnapshot());
    mockGrantGet.mockResolvedValueOnce(fallbackGrantSnapshot());
    mockSessionCreate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-f", record: {} });

    await __assessmentSessionsBeginHandler(
      makeRequest({ data: { assignmentId: ASSIGNMENT_ID, launchRef: VALID_LAUNCH_REF } }),
    );

    const write = mockSessionCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(write.deliveryOutcome).toBe("canonicalFallback");
    expect(write).not.toHaveProperty("variantKey");
    expect(write).not.toHaveProperty("presentationRevisionId");
  });

  it("Slice 6 (T-N3): refuses an unknown launch grant, creating no session or audit", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSessionGet.mockResolvedValueOnce(absentSessionSnapshot());
    mockGrantGet.mockResolvedValueOnce({ exists: false, data: () => undefined });

    await expect(
      __assessmentSessionsBeginHandler(
        makeRequest({ data: { assignmentId: ASSIGNMENT_ID, launchRef: VALID_LAUNCH_REF } }),
      ),
    ).rejects.toMatchObject({ code: "LAUNCH_REF_INVALID" });
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("Slice 6 (T-N4): refuses another student's grant", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSessionGet.mockResolvedValueOnce(absentSessionSnapshot());
    mockGrantGet.mockResolvedValueOnce(
      differentiatedGrantSnapshot({ studentId: "other-uid" }),
    );
    await expect(
      __assessmentSessionsBeginHandler(
        makeRequest({ data: { assignmentId: ASSIGNMENT_ID, launchRef: VALID_LAUNCH_REF } }),
      ),
    ).rejects.toMatchObject({ code: "LAUNCH_REF_INVALID" });
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("Slice 6 (T-N6): refuses an expired grant with the retriable LAUNCH_REF_EXPIRED", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSessionGet.mockResolvedValueOnce(absentSessionSnapshot());
    mockGrantGet.mockResolvedValueOnce(
      differentiatedGrantSnapshot({ expiresAt: { toMillis: () => 1 } }),
    );
    await expect(
      __assessmentSessionsBeginHandler(
        makeRequest({ data: { assignmentId: ASSIGNMENT_ID, launchRef: VALID_LAUNCH_REF } }),
      ),
    ).rejects.toMatchObject({ code: "LAUNCH_REF_EXPIRED" });
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("Slice 6: no accommodation + no ref freezes canonical", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSessionGet.mockResolvedValueOnce(absentSessionSnapshot());
    // Default accommodation fixture is absent.
    mockSessionCreate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-c", record: {} });

    await __assessmentSessionsBeginHandler(makeRequest());
    const write = mockSessionCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(write.deliveryOutcome).toBe("canonical");
    expect(write).not.toHaveProperty("variantKey");
  });

  it("Slice 6 (T-R4): active accommodation + delivery disabled + no ref freezes canonicalFallback", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSessionGet.mockResolvedValueOnce(absentSessionSnapshot());
    mockAccommodationGet.mockReset();
    mockAccommodationGet.mockResolvedValue(activeAccommodationSnapshot());
    mockIsDeliveryEnabled.mockReset();
    mockIsDeliveryEnabled.mockResolvedValue(false);
    mockSessionCreate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-df", record: {} });

    await __assessmentSessionsBeginHandler(makeRequest());
    const write = mockSessionCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(write.deliveryOutcome).toBe("canonicalFallback");
    expect(write).not.toHaveProperty("presentationRevisionId");
    // The index is never consulted while delivery is disabled.
    expect(mockIndexGet).not.toHaveBeenCalled();
  });

  it("Slice 6 (T-R2): active accommodation + coverage absent + no ref freezes canonicalFallback", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSessionGet.mockResolvedValueOnce(absentSessionSnapshot());
    mockAccommodationGet.mockReset();
    mockAccommodationGet.mockResolvedValue(activeAccommodationSnapshot());
    // Index absent (default fixture).
    mockSessionCreate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-cf", record: {} });

    await __assessmentSessionsBeginHandler(makeRequest());
    const write = mockSessionCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(write.deliveryOutcome).toBe("canonicalFallback");
  });

  it("Slice 6 (T-R1): active accommodation + active coverage + enabled + no ref => BEGIN_REQUIRES_LAUNCH, no session/attempt", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      assignmentSnapshot({ lessonSlug: VARIANT_LESSON_SLUG }),
    );
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSessionGet.mockResolvedValueOnce(absentSessionSnapshot());
    mockAccommodationGet.mockReset();
    mockAccommodationGet.mockResolvedValue(activeAccommodationSnapshot());
    mockIndexGet.mockReset();
    mockIndexGet.mockResolvedValue(activeIndexSnapshot(VARIANT_LESSON_SLUG));

    await expect(
      __assessmentSessionsBeginHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "BEGIN_REQUIRES_LAUNCH" });
    // Downgrade-hole proof: available required support is not suppressed by an
    // omitted ref. No session, no audit.
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("Slice 6 (Slice 5 downgrade defense): a ref discarded after variant load-failure cannot begin canonically", async () => {
    // Slice 5 discards the differentiated launchRef when the artifact fails to
    // load, so begin arrives with no ref. With active coverage still published
    // the server must refuse rather than record a false canonical session.
    mockAssignmentGet.mockResolvedValueOnce(
      assignmentSnapshot({ lessonSlug: VARIANT_LESSON_SLUG }),
    );
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSessionGet.mockResolvedValueOnce(absentSessionSnapshot());
    mockAccommodationGet.mockReset();
    mockAccommodationGet.mockResolvedValue(activeAccommodationSnapshot());
    mockIndexGet.mockReset();
    mockIndexGet.mockResolvedValue(activeIndexSnapshot(VARIANT_LESSON_SLUG));

    await expect(
      __assessmentSessionsBeginHandler(makeRequest()), // no launchRef
    ).rejects.toMatchObject({ code: "BEGIN_REQUIRES_LAUNCH" });
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("Slice 6: an existing Live session ignores a supplied launchRef (idempotent, no re-validation)", async () => {
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockResolvedValueOnce(enrollmentSnapshot());
    mockSessionGet.mockResolvedValueOnce(existingLiveSessionSnapshot());

    const result = await __assessmentSessionsBeginHandler(
      makeRequest({ data: { assignmentId: ASSIGNMENT_ID, launchRef: VALID_LAUNCH_REF } }),
    );
    expect(result).toEqual({ sessionId: SESSION_ID, alreadyLive: true });
    // The grant is never read; frozen fields never change on a repeated begin.
    expect(mockGrantGet).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("Slice 6 (tamper): rejects a client-asserted deliveryOutcome", async () => {
    await expect(
      __assessmentSessionsBeginHandler(
        makeRequest({ data: { assignmentId: ASSIGNMENT_ID, deliveryOutcome: "differentiated" } }),
      ),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidRequest" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
  });

  it("Slice 6 (tamper): rejects a client-asserted presentation pair", async () => {
    await expect(
      __assessmentSessionsBeginHandler(
        makeRequest({
          data: {
            assignmentId: ASSIGNMENT_ID,
            variantKey: "reading-adapted",
            presentationRevisionId: REVISION_A,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidRequest" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
  });

  it("Slice 6 (tamper): rejects a client-supplied studentId selector", async () => {
    await expect(
      __assessmentSessionsBeginHandler(
        makeRequest({ data: { assignmentId: ASSIGNMENT_ID, studentId: "victim-uid" } }),
      ),
    ).rejects.toMatchObject({ code: "assessmentSessions.invalidRequest" });
  });

  it("Slice 6 (tamper): a launchRef cannot bypass enrollment authorization", async () => {
    // A perfectly valid grant does not rescue a caller who is not enrolled:
    // enrollment authorization runs to completion BEFORE recipient repair or
    // any grant validation.
    mockAssignmentGet.mockResolvedValueOnce(assignmentSnapshot());
    mockEnrollmentGet.mockReset();
    mockEnrollmentGet.mockResolvedValueOnce(
      { exists: false, data: () => undefined },
    );
    mockGrantGet.mockResolvedValue(differentiatedGrantSnapshot());

    await expect(
      __assessmentSessionsBeginHandler(
        makeRequest({ data: { assignmentId: ASSIGNMENT_ID, launchRef: VALID_LAUNCH_REF } }),
      ),
    ).rejects.toMatchObject({ code: "enrollment-inactive" });
    // Enrollment failed — neither recipient repair nor grant validation
    // is reached; no session created.
    expect(mockRecipientGet).not.toHaveBeenCalled();
    expect(mockRecipientCreationSet).not.toHaveBeenCalled();
    expect(mockGrantGet).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });
});
