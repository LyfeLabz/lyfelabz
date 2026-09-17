/* eslint-disable @typescript-eslint/require-await */
// Sprint 29G.5K. Unit coverage for zero-coordination enrollment
// materialization. Every identifier is fictional.

const mockClassGet = jest.fn();
const mockClassDocRef = jest.fn(() => ({ get: mockClassGet }));

const mockMembershipsWhere1 = jest.fn();
const mockMembershipsWhere2 = jest.fn();
const mockMembershipsGet = jest.fn();
const mockMembershipsCollectionRef = jest.fn(() => ({
  where: mockMembershipsWhere1,
}));

const mockEnrollmentGet = jest.fn();
const mockEnrollmentDocRef = jest.fn(() => ({ get: mockEnrollmentGet }));
const mockEnrollmentCreationSet = jest.fn();
const mockEnrollmentCreationDocRef = jest.fn(() => ({
  set: mockEnrollmentCreationSet,
}));

const mockListHashes = jest.fn();
const mockWriteAuditEvent = jest.fn();
const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();

// Phase B Core, Automatic Enrollment Reconciliation slice: `schoolDocRef`
// backs this file's new local `resolveDistrictId`, and
// `reconcileRecipientsForNewEnrollment` is mocked at the module boundary
// (its own correctness is covered by `assignment-recipients.test.ts` Part
// A) so these tests assert only the integration contract.
const mockSchoolGet = jest.fn();
const mockSchoolDocRef = jest.fn(() => ({ get: mockSchoolGet }));
const mockReconcileRecipientsForNewEnrollment = jest.fn();

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__ts__" },
}));

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: jest.fn() },
    classDocRef: mockClassDocRef,
    enrollmentCreationDocRef: mockEnrollmentCreationDocRef,
    enrollmentDocRef: mockEnrollmentDocRef,
    listActiveExternalIdentityHashesForUser: mockListHashes,
    lmsRosterMembershipsCollectionRef: mockMembershipsCollectionRef,
    schoolDocRef: mockSchoolDocRef,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

jest.mock("../enrollments/enrollments-join-by-code", () => ({
  enrollmentIdFor: (classId: string, studentId: string) =>
    `${classId}__${studentId}`,
}));

jest.mock("../assignments/assignment-recipients", () => ({
  reconcileRecipientsForNewEnrollment: mockReconcileRecipientsForNewEnrollment,
}));

import { PlatformError } from "../shared/errors/platform-error";
import { materializeLmsEnrollmentsFromMembership } from "./materialize-lms-enrollments";

const UID = "student-uid-1";
const HASH = "hash-of-student-google-account";

function membershipDoc(classId: string) {
  return {
    id: `link__${HASH}`,
    data: () => ({
      classId,
      linkId: "link",
      ownerUid: "teacher-1",
      schoolId: "school-alpha",
      providerId: "googleClassroom",
      identityHash: HASH,
      status: "member",
    }),
  };
}

// membership query is `.where(identityHash).where(status).get()`. Tests use
// a single identity hash, so a fixed docs result is sufficient.
function wireMemberships(docs: readonly unknown[]) {
  mockMembershipsGet.mockReset().mockResolvedValue({ docs });
  mockMembershipsWhere2.mockReset().mockReturnValue({ get: mockMembershipsGet });
  mockMembershipsWhere1.mockReset().mockReturnValue({
    where: mockMembershipsWhere2,
  });
  mockMembershipsCollectionRef.mockReset().mockImplementation(() => ({
    where: mockMembershipsWhere1,
  }));
}

function classSnap(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      status: "active",
      enrollmentSource: "lms",
      schoolId: "school-alpha",
      ...overrides,
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEnrollmentGet.mockResolvedValue({ exists: false });
  mockSchoolGet.mockResolvedValue({
    exists: true,
    data: () => ({ districtId: "district-1" }),
  });
  mockReconcileRecipientsForNewEnrollment.mockResolvedValue({
    assignmentsConsidered: 0,
    recipientsAdded: 0,
  });
});

describe("materializeLmsEnrollmentsFromMembership", () => {
  it("no-ops when the student has no active identity hash", async () => {
    mockListHashes.mockResolvedValue([]);
    const result = await materializeLmsEnrollmentsFromMembership({ uid: UID });
    expect(result).toEqual({ created: 0, matchedClasses: 0, schoolId: null });
    expect(mockEnrollmentCreationSet).not.toHaveBeenCalled();
  });

  it("creates one enrollment for a matched member of an active LMS class", async () => {
    mockListHashes.mockResolvedValue([HASH]);
    wireMemberships([membershipDoc("class-alpha")]);
    mockClassGet.mockResolvedValue(classSnap());
    const result = await materializeLmsEnrollmentsFromMembership({ uid: UID });
    expect(result.created).toBe(1);
    expect(result.matchedClasses).toBe(1);
    expect(result.schoolId).toBe("school-alpha");
    expect(mockEnrollmentCreationSet).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: UID,
        classId: "class-alpha",
        status: "active",
      }),
    );
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "lms.membershipEnrollmentCreated" }),
    );
  });

  it("is idempotent: an existing enrollment is not duplicated", async () => {
    mockListHashes.mockResolvedValue([HASH]);
    wireMemberships([membershipDoc("class-alpha")]);
    mockClassGet.mockResolvedValue(classSnap());
    mockEnrollmentGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: "active" }),
    });
    const result = await materializeLmsEnrollmentsFromMembership({ uid: UID });
    expect(result.created).toBe(0);
    expect(result.matchedClasses).toBe(1);
    expect(mockEnrollmentCreationSet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("enrolls into ALL valid classes in the same school (multi-class)", async () => {
    mockListHashes.mockResolvedValue([HASH]);
    wireMemberships([membershipDoc("class-alpha"), membershipDoc("class-beta")]);
    mockClassGet.mockResolvedValue(classSnap());
    const result = await materializeLmsEnrollmentsFromMembership({ uid: UID });
    expect(result.created).toBe(2);
    expect(result.matchedClasses).toBe(2);
    expect(mockEnrollmentCreationSet).toHaveBeenCalledTimes(2);
  });

  it("fails closed on cross-school membership before writing any enrollment", async () => {
    mockListHashes.mockResolvedValue([HASH]);
    wireMemberships([membershipDoc("class-alpha"), membershipDoc("class-beta")]);
    mockClassGet
      .mockResolvedValueOnce(classSnap({ schoolId: "school-alpha" }))
      .mockResolvedValueOnce(classSnap({ schoolId: "school-beta" }));
    await expect(
      materializeLmsEnrollmentsFromMembership({ uid: UID }),
    ).rejects.toMatchObject({ code: "students.conflictingLmsEnrollment" });
    expect(mockEnrollmentCreationSet).not.toHaveBeenCalled();
  });

  it("skips a membership whose class is not yet active (needsSetup)", async () => {
    mockListHashes.mockResolvedValue([HASH]);
    wireMemberships([membershipDoc("class-alpha")]);
    mockClassGet.mockResolvedValue(classSnap({ status: "needsSetup" }));
    const result = await materializeLmsEnrollmentsFromMembership({ uid: UID });
    expect(result.created).toBe(0);
    expect(result.matchedClasses).toBe(0);
    expect(result.schoolId).toBeNull();
    expect(mockEnrollmentCreationSet).not.toHaveBeenCalled();
  });

  it("skips a membership whose class is not LMS-sourced", async () => {
    mockListHashes.mockResolvedValue([HASH]);
    wireMemberships([membershipDoc("class-alpha")]);
    mockClassGet.mockResolvedValue(classSnap({ enrollmentSource: "joinCode" }));
    const result = await materializeLmsEnrollmentsFromMembership({ uid: UID });
    expect(result.created).toBe(0);
    expect(result.matchedClasses).toBe(0);
    expect(mockEnrollmentCreationSet).not.toHaveBeenCalled();
  });

  it("ignores PlatformError typing import (sanity)", () => {
    expect(new PlatformError("x", "y").code).toBe("x");
  });

  describe("Phase B Core, Automatic Enrollment Reconciliation", () => {
    it("invokes reconciliation with the resolved trusted districtId after a genuinely new active enrollment is materialized", async () => {
      mockListHashes.mockResolvedValue([HASH]);
      wireMemberships([membershipDoc("class-alpha")]);
      mockClassGet.mockResolvedValue(classSnap());
      mockReconcileRecipientsForNewEnrollment.mockResolvedValueOnce({
        assignmentsConsidered: 2,
        recipientsAdded: 1,
      });

      const result = await materializeLmsEnrollmentsFromMembership({ uid: UID });

      expect(result.created).toBe(1);
      expect(mockSchoolDocRef).toHaveBeenCalledWith("school-alpha");
      expect(mockReconcileRecipientsForNewEnrollment).toHaveBeenCalledWith({
        classId: "class-alpha",
        studentId: UID,
        schoolId: "school-alpha",
        districtId: "district-1",
      });
    });

    it("isolates a reconciliation failure for one class so it does not break materialization of an unrelated class", async () => {
      mockListHashes.mockResolvedValue([HASH]);
      wireMemberships([membershipDoc("class-alpha"), membershipDoc("class-beta")]);
      mockClassGet.mockResolvedValue(classSnap());
      mockReconcileRecipientsForNewEnrollment
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce({ assignmentsConsidered: 1, recipientsAdded: 1 });

      const result = await materializeLmsEnrollmentsFromMembership({ uid: UID });

      expect(result.created).toBe(2);
      expect(result.matchedClasses).toBe(2);
      expect(mockEnrollmentCreationSet).toHaveBeenCalledTimes(2);
      expect(mockReconcileRecipientsForNewEnrollment).toHaveBeenCalledTimes(2);
      expect(mockLogWarn).toHaveBeenCalledWith(
        "enrollments.newEnrollmentRecipientReconciliationFailed",
        expect.objectContaining({ studentId: UID }),
      );
    });

    it("does not reconcile an already-existing active enrollment", async () => {
      mockListHashes.mockResolvedValue([HASH]);
      wireMemberships([membershipDoc("class-alpha")]);
      mockClassGet.mockResolvedValue(classSnap());
      mockEnrollmentGet.mockResolvedValue({
        exists: true,
        data: () => ({ status: "active" }),
      });

      const result = await materializeLmsEnrollmentsFromMembership({ uid: UID });

      expect(result.created).toBe(0);
      expect(mockReconcileRecipientsForNewEnrollment).not.toHaveBeenCalled();
    });
  });
});
