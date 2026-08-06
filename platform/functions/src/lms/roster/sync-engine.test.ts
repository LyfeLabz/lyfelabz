/* eslint-disable @typescript-eslint/require-await */
// Sprint 23C. Comprehensive unit coverage for the provider-neutral
// roster synchronization engine. Every identifier in this file is
// fictional. No real teacher, student, school, OAuth credential, or
// LyfeLabz-affiliated identifier is used.

const mockClassGet = jest.fn();
const mockClassDocRef = jest.fn(() => ({ get: mockClassGet }));

const mockLinksWhere1 = jest.fn();
const mockLinksWhere2 = jest.fn();
const mockLinksLimit = jest.fn();
const mockLinksGet = jest.fn();
const mockLmsClassLinksCollectionRef = jest.fn(() => ({
  where: mockLinksWhere1,
}));

const mockConnectionGet = jest.fn();
const mockLmsConnectionDocRef = jest.fn(() => ({ get: mockConnectionGet }));

const mockEnrollmentsWhere1 = jest.fn();
const mockEnrollmentsWhere2 = jest.fn();
const mockEnrollmentsGet = jest.fn();
const mockEnrollmentsCollectionRef = jest.fn(() => ({
  where: mockEnrollmentsWhere1,
}));

const mockEnrollmentGet = jest.fn();
const mockEnrollmentDocRef = jest.fn(() => ({ get: mockEnrollmentGet }));

const mockEnrollmentCreationSet = jest.fn();
const mockEnrollmentCreationDocRef = jest.fn(() => ({
  set: mockEnrollmentCreationSet,
}));

const mockEnrollmentStatusChangeUpdate = jest.fn();
const mockEnrollmentStatusChangeDocRef = jest.fn(() => ({
  update: mockEnrollmentStatusChangeUpdate,
}));

const mockResolveActiveExternalIdentity = jest.fn();

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

const mockTokenResolve = jest.fn();
const mockGetAdapter = jest.fn();

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => "__ts__",
    delete: () => "__delete__",
  },
}));

jest.mock("../../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../../shared/errors/platform-error",
  );
  const { assertClassSupports } = jest.requireActual(
    "../../shared/classes/eligibility",
  );
  return {
    PlatformError,
    assertClassSupports,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    classDocRef: mockClassDocRef,
    enrollmentCreationDocRef: mockEnrollmentCreationDocRef,
    enrollmentDocRef: mockEnrollmentDocRef,
    enrollmentStatusChangeDocRef: mockEnrollmentStatusChangeDocRef,
    enrollmentsCollectionRef: mockEnrollmentsCollectionRef,
    lmsClassLinksCollectionRef: mockLmsClassLinksCollectionRef,
    lmsConnectionDocRef: mockLmsConnectionDocRef,
    resolveActiveExternalIdentity: mockResolveActiveExternalIdentity,
  };
});

jest.mock("../tokens/token-store", () => ({
  getLmsTokenStore: () => ({ resolve: mockTokenResolve }),
}));

jest.mock("../providers/registry", () => ({
  getProviderAdapter: () => mockGetAdapter(),
}));

jest.mock("../../enrollments/enrollments-join-by-code", () => ({
  enrollmentIdFor: (classId: string, studentId: string) =>
    `${classId}__${studentId}`,
}));

import { PlatformError } from "../../shared/errors/platform-error";
import { synchronizeClassRoster } from "./sync-engine";

const CLASS_ID = "class-777";
const SCHOOL_ID = "school-alpha";
const DISTRICT_ID = "district-alpha";
const TEACHER_UID = "teacher-uid-1";
const LINK_ID = "class-777__googleclassroom__abcd1234";
const LMS_CLASS_ID = "gc-course-1";
const CONNECTION_ID = "googleclassroom__teacher-uid-1";

function actor() {
  return { uid: TEACHER_UID, schoolId: SCHOOL_ID, districtId: DISTRICT_ID };
}

function classSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      status: "active",
      enrollmentSource: "lms",
      ...overrides,
    }),
  };
}

function linkQuerySnapshot(
  linkOverrides: Record<string, unknown> = {},
  opts: { readonly empty?: boolean; readonly size?: number } = {},
) {
  const empty = opts.empty ?? false;
  if (empty) {
    return { empty: true, size: 0, docs: [] as unknown[] };
  }
  const size = opts.size ?? 1;
  const doc = {
    id: LINK_ID,
    data: () => ({
      classId: CLASS_ID,
      ownerUid: TEACHER_UID,
      schoolId: SCHOOL_ID,
      providerId: "googleClassroom",
      lmsClassId: LMS_CLASS_ID,
      connectionId: CONNECTION_ID,
      status: "linked",
      linkedAt: {},
      ...linkOverrides,
    }),
  };
  const docs =
    size === 1 ? [doc] : Array.from({ length: size }).map(() => doc);
  return { empty: false, size, docs };
}

function connectionSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      providerId: "googleClassroom",
      status: "active",
      scopes: [],
      tokenRef: "tokref-1",
      connectedAt: {},
      upstreamAccountIdentifier: "gc-owner-1",
      ...overrides,
    }),
  };
}

function tokenBundle() {
  return {
    providerId: "googleClassroom",
    teacherId: TEACHER_UID,
    accessToken: "at",
    scopes: [],
    upstreamAccountIdentifier: "gc-owner-1",
  };
}

function enrollmentsSnapshot(
  active: readonly { readonly enrollmentId: string; readonly studentId: string }[],
) {
  return {
    docs: active.map((a) => ({
      id: a.enrollmentId,
      data: () => ({
        studentId: a.studentId,
        classId: CLASS_ID,
        schoolId: SCHOOL_ID,
        status: "active",
      }),
    })),
  };
}

// Wire the fluent Firestore query builders so `.where(...).where(...).limit(...).get()` returns a
// configurable result per test.
function wireLinksQuery(result: unknown) {
  mockLinksGet.mockReset().mockResolvedValue(result);
  mockLinksLimit.mockReset().mockReturnValue({ get: mockLinksGet });
  mockLinksWhere2.mockReset().mockReturnValue({ limit: mockLinksLimit });
  mockLinksWhere1.mockReset().mockReturnValue({ where: mockLinksWhere2 });
  mockLmsClassLinksCollectionRef.mockReset();
  mockLmsClassLinksCollectionRef.mockImplementation(() => ({
    where: mockLinksWhere1,
  }));
}

function wireEnrollmentsQuery(result: unknown) {
  mockEnrollmentsGet.mockReset().mockResolvedValue(result);
  mockEnrollmentsWhere2.mockReset().mockReturnValue({ get: mockEnrollmentsGet });
  mockEnrollmentsWhere1
    .mockReset()
    .mockReturnValue({ where: mockEnrollmentsWhere2 });
  mockEnrollmentsCollectionRef.mockReset();
  mockEnrollmentsCollectionRef.mockImplementation(() => ({
    where: mockEnrollmentsWhere1,
  }));
}

// The engine uses the deterministic id `${classId}__${studentId}`.
function eid(studentId: string): string {
  return `${CLASS_ID}__${studentId}`;
}

describe("synchronizeClassRoster (Sprint 23C)", () => {
  beforeEach(() => {
    [
      mockClassGet,
      mockConnectionGet,
      mockEnrollmentGet,
      mockEnrollmentCreationSet,
      mockEnrollmentStatusChangeUpdate,
      mockResolveActiveExternalIdentity,
      mockLogInfo,
      mockLogWarn,
      mockLogError,
      mockTokenResolve,
      mockGetAdapter,
    ].forEach((m) => m.mockReset());
    mockClassDocRef
      .mockReset()
      .mockImplementation(() => ({ get: mockClassGet }));
    mockLmsConnectionDocRef
      .mockReset()
      .mockImplementation(() => ({ get: mockConnectionGet }));
    mockEnrollmentDocRef
      .mockReset()
      .mockImplementation(() => ({ get: mockEnrollmentGet }));
    mockEnrollmentCreationDocRef
      .mockReset()
      .mockImplementation(() => ({ set: mockEnrollmentCreationSet }));
    mockEnrollmentStatusChangeDocRef
      .mockReset()
      .mockImplementation(() => ({ update: mockEnrollmentStatusChangeUpdate }));
    mockTokenResolve.mockResolvedValue(tokenBundle());
    mockEnrollmentCreationSet.mockResolvedValue(undefined);
    mockEnrollmentStatusChangeUpdate.mockResolvedValue(undefined);
  });

  function primeCommonSuccess(opts: {
    readonly upstreamRoster: readonly { readonly providerAccountId: string }[];
    readonly currentActive: readonly {
      readonly enrollmentId: string;
      readonly studentId: string;
    }[];
    readonly linkOverrides?: Record<string, unknown>;
    readonly connectionOverrides?: Record<string, unknown>;
    readonly classOverrides?: Record<string, unknown>;
  }) {
    mockClassGet.mockResolvedValue(classSnapshot(opts.classOverrides));
    wireLinksQuery(linkQuerySnapshot(opts.linkOverrides ?? {}));
    mockConnectionGet.mockResolvedValue(
      connectionSnapshot(opts.connectionOverrides ?? {}),
    );
    wireEnrollmentsQuery(enrollmentsSnapshot(opts.currentActive));
    const listClassRoster = jest.fn().mockResolvedValue(opts.upstreamRoster);
    mockGetAdapter.mockReturnValue({ listClassRoster });
    return { listClassRoster };
  }

  it("initial sync creates one enrollment per resolved roster member", async () => {
    primeCommonSuccess({
      upstreamRoster: [
        { providerAccountId: "gc-100" },
        { providerAccountId: "gc-200" },
      ],
      currentActive: [],
    });
    mockResolveActiveExternalIdentity.mockImplementation(
      async ({ providerAccountId }: { providerAccountId: string }) =>
        providerAccountId === "gc-100"
          ? { resolved: true, userId: "student-100" }
          : { resolved: true, userId: "student-200" },
    );
    // Both deterministic-id docs are absent so both adds proceed.
    mockEnrollmentGet.mockResolvedValue({ exists: false });

    const summary = await synchronizeClassRoster({
      actor: actor(),
      classId: CLASS_ID,
    });

    expect(summary.added).toBe(2);
    expect(summary.unchanged).toBe(0);
    expect(summary.withdrawn).toBe(0);
    expect(summary.unresolved).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(summary.reactivated).toBe(0);
    expect(summary.upstreamRosterEmpty).toBe(false);
    expect(mockEnrollmentCreationSet).toHaveBeenCalledTimes(2);
    expect(mockEnrollmentStatusChangeUpdate).not.toHaveBeenCalled();
    // No PII from the roster ever appears on any Firestore write; the
    // creation payload uses the resolved Firebase UID only.
    const firstArg = mockEnrollmentCreationSet.mock.calls[0][0] as {
      readonly studentId: string;
    };
    expect(["student-100", "student-200"]).toContain(firstArg.studentId);
  });

  it("repeat sync is fully idempotent with no writes when the roster is unchanged", async () => {
    primeCommonSuccess({
      upstreamRoster: [{ providerAccountId: "gc-100" }],
      currentActive: [{ enrollmentId: eid("student-100"), studentId: "student-100" }],
    });
    mockResolveActiveExternalIdentity.mockResolvedValue({
      resolved: true,
      userId: "student-100",
    });

    const summary = await synchronizeClassRoster({
      actor: actor(),
      classId: CLASS_ID,
    });

    expect(summary.added).toBe(0);
    expect(summary.unchanged).toBe(1);
    expect(summary.withdrawn).toBe(0);
    expect(mockEnrollmentCreationSet).not.toHaveBeenCalled();
    expect(mockEnrollmentStatusChangeUpdate).not.toHaveBeenCalled();
  });

  it("withdraws an active enrollment whose resolved identity is no longer in the upstream roster", async () => {
    primeCommonSuccess({
      upstreamRoster: [{ providerAccountId: "gc-100" }],
      currentActive: [
        { enrollmentId: eid("student-100"), studentId: "student-100" },
        { enrollmentId: eid("student-999"), studentId: "student-999" },
      ],
    });
    mockResolveActiveExternalIdentity.mockResolvedValue({
      resolved: true,
      userId: "student-100",
    });
    mockEnrollmentGet.mockImplementation(async () => ({
      exists: true,
      data: () => ({ status: "active" }),
    }));

    const summary = await synchronizeClassRoster({
      actor: actor(),
      classId: CLASS_ID,
    });

    expect(summary.withdrawn).toBe(1);
    expect(summary.added).toBe(0);
    expect(summary.unchanged).toBe(1);
    expect(mockEnrollmentStatusChangeUpdate).toHaveBeenCalledTimes(1);
    expect(mockEnrollmentStatusChangeUpdate).toHaveBeenCalledWith({
      status: "withdrawn",
      exitedAt: "__ts__",
    });
  });

  it("counts unresolved roster members and continues processing the rest", async () => {
    primeCommonSuccess({
      upstreamRoster: [
        { providerAccountId: "gc-known" },
        { providerAccountId: "gc-orphan-a" },
        { providerAccountId: "gc-orphan-b" },
      ],
      currentActive: [],
    });
    mockResolveActiveExternalIdentity.mockImplementation(
      async ({ providerAccountId }: { providerAccountId: string }) =>
        providerAccountId === "gc-known"
          ? { resolved: true, userId: "student-known" }
          : { resolved: false },
    );
    mockEnrollmentGet.mockResolvedValue({ exists: false });

    const summary = await synchronizeClassRoster({
      actor: actor(),
      classId: CLASS_ID,
    });

    expect(summary.added).toBe(1);
    expect(summary.unresolved).toBe(2);
    expect(mockEnrollmentCreationSet).toHaveBeenCalledTimes(1);
  });

  it("skips a returning student whose prior enrollment sits in a terminal state (no reactivation transition)", async () => {
    primeCommonSuccess({
      upstreamRoster: [{ providerAccountId: "gc-back" }],
      currentActive: [],
    });
    mockResolveActiveExternalIdentity.mockResolvedValue({
      resolved: true,
      userId: "student-back",
    });
    mockEnrollmentGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: "withdrawn" }),
    });

    const summary = await synchronizeClassRoster({
      actor: actor(),
      classId: CLASS_ID,
    });

    expect(summary.added).toBe(0);
    expect(summary.reactivated).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(mockEnrollmentCreationSet).not.toHaveBeenCalled();
    expect(mockEnrollmentStatusChangeUpdate).not.toHaveBeenCalled();
  });

  it("collapses duplicate resolved identities to one add and does not write twice", async () => {
    primeCommonSuccess({
      upstreamRoster: [
        { providerAccountId: "gc-a" },
        { providerAccountId: "gc-b" },
      ],
      currentActive: [],
    });
    mockResolveActiveExternalIdentity.mockResolvedValue({
      resolved: true,
      userId: "student-shared",
    });
    mockEnrollmentGet.mockResolvedValue({ exists: false });

    const summary = await synchronizeClassRoster({
      actor: actor(),
      classId: CLASS_ID,
    });

    expect(summary.added).toBe(1);
    expect(mockEnrollmentCreationSet).toHaveBeenCalledTimes(1);
  });

  it("empty successful roster reports upstreamRosterEmpty and withdraws every active enrollment", async () => {
    primeCommonSuccess({
      upstreamRoster: [],
      currentActive: [
        { enrollmentId: eid("student-1"), studentId: "student-1" },
      ],
    });
    mockEnrollmentGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: "active" }),
    });

    const summary = await synchronizeClassRoster({
      actor: actor(),
      classId: CLASS_ID,
    });

    expect(summary.upstreamRosterEmpty).toBe(true);
    expect(summary.withdrawn).toBe(1);
  });

  it("does not overwrite a pre-existing enrollment doc during add (idempotency on concurrent race)", async () => {
    primeCommonSuccess({
      upstreamRoster: [{ providerAccountId: "gc-1" }],
      currentActive: [],
    });
    mockResolveActiveExternalIdentity.mockResolvedValue({
      resolved: true,
      userId: "student-1",
    });
    // First lookup during planning: no prior enrollment. Second during
    // apply-time race-check: pre-existing (concurrent write).
    mockEnrollmentGet
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ status: "active" }),
      });

    const summary = await synchronizeClassRoster({
      actor: actor(),
      classId: CLASS_ID,
    });

    expect(summary.added).toBe(0);
    expect(mockEnrollmentCreationSet).not.toHaveBeenCalled();
  });

  it("propagates an adapter failure and performs no writes", async () => {
    mockClassGet.mockResolvedValue(classSnapshot());
    wireLinksQuery(linkQuerySnapshot());
    mockConnectionGet.mockResolvedValue(connectionSnapshot());
    wireEnrollmentsQuery(enrollmentsSnapshot([]));
    const listClassRoster = jest
      .fn()
      .mockRejectedValue(
        new PlatformError("lms.upstreamAuthorizationFailed", "boom"),
      );
    mockGetAdapter.mockReturnValue({ listClassRoster });

    await expect(
      synchronizeClassRoster({ actor: actor(), classId: CLASS_ID }),
    ).rejects.toMatchObject({ code: "lms.upstreamAuthorizationFailed" });
    expect(mockEnrollmentCreationSet).not.toHaveBeenCalled();
    expect(mockEnrollmentStatusChangeUpdate).not.toHaveBeenCalled();
  });

  it("rejects when the class is not found", async () => {
    mockClassGet.mockResolvedValue({ exists: false });
    await expect(
      synchronizeClassRoster({ actor: actor(), classId: CLASS_ID }),
    ).rejects.toMatchObject({ code: "lms.classNotFound" });
  });

  it("rejects when the caller does not own the class", async () => {
    mockClassGet.mockResolvedValue(classSnapshot({ teacherId: "other-uid" }));
    await expect(
      synchronizeClassRoster({ actor: actor(), classId: CLASS_ID }),
    ).rejects.toMatchObject({ code: "lms.forbidden" });
  });

  it("rejects when the class is not linked to any LMS class", async () => {
    mockClassGet.mockResolvedValue(
      classSnapshot({ enrollmentSource: "joinCode" }),
    );
    await expect(
      synchronizeClassRoster({ actor: actor(), classId: CLASS_ID }),
    ).rejects.toMatchObject({ code: "lms.classNotLinked" });
  });

  it("rejects when no active link exists", async () => {
    mockClassGet.mockResolvedValue(classSnapshot());
    wireLinksQuery(linkQuerySnapshot({}, { empty: true }));
    await expect(
      synchronizeClassRoster({ actor: actor(), classId: CLASS_ID }),
    ).rejects.toMatchObject({ code: "lms.classNotLinked" });
  });

  it("rejects when the connection is not active", async () => {
    mockClassGet.mockResolvedValue(classSnapshot());
    wireLinksQuery(linkQuerySnapshot());
    mockConnectionGet.mockResolvedValue(
      connectionSnapshot({ status: "revoked" }),
    );
    await expect(
      synchronizeClassRoster({ actor: actor(), classId: CLASS_ID }),
    ).rejects.toMatchObject({ code: "lms.connectionNotActive" });
  });

  it("uses deterministic ordering: sorts adds by enrollment id before writing", async () => {
    primeCommonSuccess({
      upstreamRoster: [
        { providerAccountId: "gc-z" },
        { providerAccountId: "gc-a" },
      ],
      currentActive: [],
    });
    mockResolveActiveExternalIdentity.mockImplementation(
      async ({ providerAccountId }: { providerAccountId: string }) =>
        providerAccountId === "gc-z"
          ? { resolved: true, userId: "student-zzz" }
          : { resolved: true, userId: "student-aaa" },
    );
    mockEnrollmentGet.mockResolvedValue({ exists: false });

    await synchronizeClassRoster({ actor: actor(), classId: CLASS_ID });

    const calls = mockEnrollmentCreationDocRef.mock.calls as unknown as ReadonlyArray<
      readonly [string]
    >;
    const firstDocIdArg = calls[0][0];
    const secondDocIdArg = calls[1][0];
    expect(firstDocIdArg).toBe(eid("student-aaa"));
    expect(secondDocIdArg).toBe(eid("student-zzz"));
  });
});
