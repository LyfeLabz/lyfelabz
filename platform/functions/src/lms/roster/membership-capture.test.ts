/* eslint-disable @typescript-eslint/require-await */
// Sprint 29G.5K. Unit coverage for the trusted Classroom roster-membership
// capture engine. Every identifier is fictional; no real teacher, student,
// school, OAuth credential, or LyfeLabz-affiliated identifier is used.

const mockMembershipsWhere = jest.fn();
const mockMembershipsGet = jest.fn();
const mockMembershipsCollectionRef = jest.fn(() => ({
  where: mockMembershipsWhere,
}));

const mockCreationSet = jest.fn();
const mockCreationDocRef = jest.fn(() => ({ set: mockCreationSet }));
const mockReaffirmUpdate = jest.fn();
const mockReaffirmDocRef = jest.fn(() => ({ update: mockReaffirmUpdate }));
const mockRemovalUpdate = jest.fn();
const mockRemovalDocRef = jest.fn(() => ({ update: mockRemovalUpdate }));

const mockEnrollmentGet = jest.fn();
const mockEnrollmentDocRef = jest.fn(() => ({ get: mockEnrollmentGet }));
const mockEnrollmentStatusChangeUpdate = jest.fn();
const mockEnrollmentStatusChangeDocRef = jest.fn(() => ({
  update: mockEnrollmentStatusChangeUpdate,
}));

const mockResolveActiveUserIdByDocId = jest.fn();
const mockLogInfo = jest.fn();

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__ts__" },
}));

jest.mock("../../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../../shared/errors/platform-error",
  );
  const {
    computeExternalIdentityDocId,
    assertValidProviderAccountId,
  } = jest.requireActual("../../shared/identity/external-identity-doc-id");
  return {
    PlatformError,
    computeExternalIdentityDocId,
    assertValidProviderAccountId,
    log: { info: mockLogInfo, warn: jest.fn(), error: jest.fn() },
    classDocRef: jest.fn(),
    enrollmentDocRef: mockEnrollmentDocRef,
    enrollmentStatusChangeDocRef: mockEnrollmentStatusChangeDocRef,
    lmsClassLinksCollectionRef: jest.fn(),
    lmsConnectionDocRef: jest.fn(),
    lmsRosterMembershipCreationDocRef: mockCreationDocRef,
    lmsRosterMembershipReaffirmDocRef: mockReaffirmDocRef,
    lmsRosterMembershipRemovalDocRef: mockRemovalDocRef,
    lmsRosterMembershipsCollectionRef: mockMembershipsCollectionRef,
    resolveActiveUserIdByExternalIdentityDocId: mockResolveActiveUserIdByDocId,
  };
});

jest.mock("../providers/registry", () => ({ getProviderAdapter: jest.fn() }));
jest.mock("../tokens/credential-resolver", () => ({
  resolveLiveCredential: jest.fn(),
}));
jest.mock("../../enrollments/enrollments-join-by-code", () => ({
  enrollmentIdFor: (classId: string, studentId: string) =>
    `${classId}__${studentId}`,
}));

import { captureRosterMemberships } from "./membership-capture";
import { computeExternalIdentityDocId } from "../../shared/identity/external-identity-doc-id";

const CLASS_ID = "class-alpha";
const LINK_ID = "class-alpha__googleclassroom__abcd1234";
const SCHOOL_ID = "school-alpha";
const OWNER = "teacher-uid-1";

function ctx() {
  return {
    classId: CLASS_ID,
    linkId: LINK_ID,
    ownerUid: OWNER,
    schoolId: SCHOOL_ID,
    providerId: "googleClassroom" as const,
  };
}

function hashFor(accountId: string): string {
  return computeExternalIdentityDocId({
    providerId: "google.com",
    providerAccountId: accountId,
  });
}

function existingMembershipsSnapshot(
  records: readonly { readonly identityHash: string; readonly status: string }[],
) {
  return {
    docs: records.map((r) => ({
      id: `${LINK_ID}__${r.identityHash}`,
      data: () => ({
        classId: CLASS_ID,
        linkId: LINK_ID,
        ownerUid: OWNER,
        schoolId: SCHOOL_ID,
        providerId: "googleClassroom",
        identityHash: r.identityHash,
        status: r.status,
      }),
    })),
  };
}

function wireExisting(records: readonly { identityHash: string; status: string }[]) {
  mockMembershipsGet.mockReset().mockResolvedValue(
    existingMembershipsSnapshot(records),
  );
  mockMembershipsWhere.mockReset().mockReturnValue({ get: mockMembershipsGet });
  mockMembershipsCollectionRef.mockReset().mockImplementation(() => ({
    where: mockMembershipsWhere,
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEnrollmentGet.mockResolvedValue({ exists: false });
  mockResolveActiveUserIdByDocId.mockResolvedValue(null);
});

describe("captureRosterMemberships", () => {
  it("creates a new member document for each never-seen upstream account", async () => {
    wireExisting([]);
    const summary = await captureRosterMemberships(ctx(), [
      { providerAccountId: "g-100" },
      { providerAccountId: "g-200" },
    ]);
    expect(summary.membersSeen).toBe(2);
    expect(summary.added).toBe(2);
    expect(summary.reaffirmed).toBe(0);
    expect(summary.removed).toBe(0);
    expect(summary.upstreamRosterEmpty).toBe(false);
    expect(mockCreationSet).toHaveBeenCalledTimes(2);
    // No enrollment/user side effect from capturing pre-auth membership.
    expect(mockEnrollmentStatusChangeUpdate).not.toHaveBeenCalled();
  });

  it("re-affirms existing members idempotently without creating duplicates", async () => {
    wireExisting([
      { identityHash: hashFor("g-100"), status: "member" },
      { identityHash: hashFor("g-200"), status: "member" },
    ]);
    const summary = await captureRosterMemberships(ctx(), [
      { providerAccountId: "g-100" },
      { providerAccountId: "g-200" },
    ]);
    expect(summary.added).toBe(0);
    expect(summary.reaffirmed).toBe(2);
    expect(summary.removed).toBe(0);
    expect(mockCreationSet).not.toHaveBeenCalled();
    expect(mockReaffirmUpdate).toHaveBeenCalledTimes(2);
  });

  it("re-adds a previously removed member who reappears upstream", async () => {
    wireExisting([{ identityHash: hashFor("g-100"), status: "removed" }]);
    const summary = await captureRosterMemberships(ctx(), [
      { providerAccountId: "g-100" },
    ]);
    expect(summary.added).toBe(1);
    expect(summary.reaffirmed).toBe(0);
    expect(mockReaffirmUpdate).toHaveBeenCalledTimes(1);
  });

  it("marks a member absent from a fresh non-empty roster as removed", async () => {
    wireExisting([
      { identityHash: hashFor("g-100"), status: "member" },
      { identityHash: hashFor("g-200"), status: "member" },
    ]);
    const summary = await captureRosterMemberships(ctx(), [
      { providerAccountId: "g-100" },
    ]);
    expect(summary.removed).toBe(1);
    expect(mockRemovalUpdate).toHaveBeenCalledTimes(1);
    // g-200 never signed in -> no enrollment to withdraw.
    expect(summary.withdrawnEnrollments).toBe(0);
    expect(mockEnrollmentStatusChangeUpdate).not.toHaveBeenCalled();
  });

  it("withdraws the active enrollment of a removed member who had signed in", async () => {
    wireExisting([{ identityHash: hashFor("g-200"), status: "member" }]);
    mockResolveActiveUserIdByDocId.mockResolvedValue("student-uid-9");
    mockEnrollmentGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: "active" }),
    });
    const summary = await captureRosterMemberships(ctx(), [
      { providerAccountId: "g-999" },
    ]);
    expect(summary.removed).toBe(1);
    expect(summary.withdrawnEnrollments).toBe(1);
    expect(mockEnrollmentStatusChangeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "withdrawn" }),
    );
  });

  it("does NOT reactivate a terminal enrollment on removal", async () => {
    wireExisting([{ identityHash: hashFor("g-200"), status: "member" }]);
    mockResolveActiveUserIdByDocId.mockResolvedValue("student-uid-9");
    mockEnrollmentGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: "withdrawn" }),
    });
    const summary = await captureRosterMemberships(ctx(), [
      { providerAccountId: "g-999" },
    ]);
    expect(summary.withdrawnEnrollments).toBe(0);
    expect(mockEnrollmentStatusChangeUpdate).not.toHaveBeenCalled();
  });

  it("SAFETY: an empty upstream roster removes nothing and withdraws nothing", async () => {
    wireExisting([
      { identityHash: hashFor("g-100"), status: "member" },
      { identityHash: hashFor("g-200"), status: "member" },
    ]);
    const summary = await captureRosterMemberships(ctx(), []);
    expect(summary.upstreamRosterEmpty).toBe(true);
    expect(summary.membersSeen).toBe(0);
    expect(summary.removed).toBe(0);
    expect(summary.withdrawnEnrollments).toBe(0);
    expect(mockRemovalUpdate).not.toHaveBeenCalled();
    expect(mockEnrollmentStatusChangeUpdate).not.toHaveBeenCalled();
  });
});
