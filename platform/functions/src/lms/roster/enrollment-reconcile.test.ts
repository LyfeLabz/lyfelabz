/* eslint-disable @typescript-eslint/require-await */
// Teacher-controlled manual roster refresh: end-to-end coverage of
// `refreshClassRosterMemberships({ reconcileEnrollments: true })` - the real
// membership capture, the real enrollment reconciliation, and the real
// canonical membership-enrollment step - against an in-memory Firestore
// fake. Only the Classroom adapter, the credential resolver, and recipient
// reconciliation are stubbed. Every identifier is fictional.

type Doc = Record<string, unknown>;

const store = {
  classes: new Map<string, Doc>(),
  links: new Map<string, Doc>(),
  connections: new Map<string, Doc>(),
  memberships: new Map<string, Doc>(),
  identities: new Map<string, Doc>(),
  users: new Map<string, Doc>(),
  enrollments: new Map<string, Doc>(),
  schools: new Map<string, Doc>(),
};
const writes: string[] = [];
const mockWriteAuditEvent = jest.fn();
const mockReconcileRecipients = jest.fn();
const mockListClassRoster = jest.fn();

const snap = (id: string, data: Doc | undefined) => ({
  id,
  exists: data !== undefined,
  data: () => (data === undefined ? undefined : { ...data }),
});
const docRef = (map: Map<string, Doc>, label: string) => (id: string) => ({
  get: async () => snap(id, map.get(id)),
  set: async (data: Doc) => {
    writes.push(`${label}.set:${id}`);
    map.set(id, { ...data });
  },
  update: async (patch: Doc) => {
    writes.push(`${label}.update:${id}`);
    const existing = map.get(id);
    if (existing === undefined) throw new Error(`update of missing ${label} ${id}`);
    const next: Doc = { ...existing };
    for (const [k, v] of Object.entries(patch)) {
      if (v === "__delete__") delete next[k];
      else next[k] = v;
    }
    map.set(id, next);
  },
});
const query = (map: Map<string, Doc>) => {
  const make = (filters: Array<[string, unknown]>, limit?: number) => ({
    where: (field: string, _op: string, value: unknown) =>
      make([...filters, [field, value]], limit),
    limit: (n: number) => make(filters, n),
    get: async () => {
      let docs = [...map.entries()]
        .filter(([, d]) => filters.every(([f, v]) => d[f] === v))
        .map(([id, d]) => snap(id, d));
      if (limit !== undefined) docs = docs.slice(0, limit);
      return { empty: docs.length === 0, size: docs.length, docs };
    },
  });
  return () => make([]);
};

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__ts__", delete: () => "__delete__" },
}));

jest.mock("../../shared", () => {
  const { PlatformError } = jest.requireActual("../../shared/errors/platform-error");
  const { computeExternalIdentityDocId, assertValidProviderAccountId } = jest.requireActual(
    "../../shared/identity/external-identity-doc-id",
  );
  return {
    PlatformError,
    computeExternalIdentityDocId,
    assertValidProviderAccountId,
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    classDocRef: docRef(store.classes, "class"),
    lmsClassLinksCollectionRef: query(store.links),
    lmsConnectionDocRef: docRef(store.connections, "connection"),
    lmsRosterMembershipsCollectionRef: query(store.memberships),
    lmsRosterMembershipCreationDocRef: docRef(store.memberships, "membership"),
    lmsRosterMembershipReaffirmDocRef: docRef(store.memberships, "membership"),
    lmsRosterMembershipRemovalDocRef: docRef(store.memberships, "membership"),
    enrollmentDocRef: docRef(store.enrollments, "enrollment"),
    enrollmentCreationDocRef: docRef(store.enrollments, "enrollment"),
    enrollmentStatusChangeDocRef: docRef(store.enrollments, "enrollment"),
    enrollmentClassroomWithdrawalDocRef: docRef(store.enrollments, "enrollment"),
    enrollmentClassroomReactivationDocRef: docRef(store.enrollments, "enrollment"),
    // Pass-through transaction over the same in-memory store.
    runFirestoreTransaction: async (
      fn: (tx: {
        get: (ref: { get: () => unknown }) => unknown;
        update: (ref: { update: (d: Doc) => unknown }, d: Doc) => unknown;
      }) => unknown,
    ) => fn({ get: (ref) => ref.get(), update: (ref, d) => ref.update(d) }),
    userRecordDocRef: docRef(store.users, "user"),
    schoolDocRef: docRef(store.schools, "school"),
    writeAuditEvent: (e: unknown) => mockWriteAuditEvent(e),
    resolveActiveUserIdByExternalIdentityDocId: async (hash: string) => {
      const m = store.identities.get(hash);
      return m && m.status === "active" && typeof m.userId === "string" ? m.userId : null;
    },
  };
});

jest.mock("../providers/registry", () => ({
  getProviderAdapter: () => ({ listClassRoster: (i: unknown) => mockListClassRoster(i) }),
}));
jest.mock("../tokens/credential-resolver", () => ({
  resolveLiveCredential: async () => ({ accessToken: "fake-token" }),
}));
jest.mock("../../enrollments/enrollments-join-by-code", () => ({
  enrollmentIdFor: (classId: string, studentId: string) => `${classId}__${studentId}`,
}));
jest.mock("../../assignments/assignment-recipients", () => ({
  reconcileRecipientsForNewEnrollment: (i: unknown) => mockReconcileRecipients(i),
}));

import { refreshClassRosterMemberships } from "./membership-capture";
import { computeExternalIdentityDocId } from "../../shared/identity/external-identity-doc-id";

const CLASS = "class-alpha";
const SCHOOL = "school-alpha";
const TEACHER = "teacher-1";
const LINK = "link-alpha";
const actor = { uid: TEACHER, schoolId: SCHOOL, districtId: "district-alpha" };

const hashOf = (account: string): string =>
  computeExternalIdentityDocId({ providerId: "google.com", providerAccountId: account });

// A Classroom account, optionally mapped to a LyfeLabz user.
function account(
  name: string,
  user?: { status?: string; role?: string; schoolId?: string; authUid?: string },
): string {
  const accountId = `gacct-${name}`;
  if (user !== undefined) {
    const uid = `uid-${name}`;
    store.identities.set(hashOf(accountId), { userId: uid, status: "active" });
    store.users.set(uid, {
      authUid: user.authUid ?? uid,
      status: user.status ?? "active",
      role: user.role ?? "student",
      schoolId: user.schoolId ?? SCHOOL,
    });
  }
  return accountId;
}
const enroll = (name: string, status: string, extra: Doc = {}) =>
  store.enrollments.set(`${CLASS}__uid-${name}`, {
    studentId: `uid-${name}`,
    classId: CLASS,
    schoolId: SCHOOL,
    status,
    enrolledAt: "enrolled-at-original",
    ...extra,
  });
const classroomWithdrawn = { exitSource: "lmsRosterSync", exitLinkId: LINK, exitedAt: "exited-at" };
const auditActions = () =>
  mockWriteAuditEvent.mock.calls.map((c) => (c[0] as { action: string }).action);
const membership = (accountId: string, status: string) =>
  store.memberships.set(`${LINK}__${hashOf(accountId)}`, {
    classId: CLASS,
    linkId: LINK,
    identityHash: hashOf(accountId),
    status,
  });
const upstream = (...accounts: string[]) =>
  mockListClassRoster.mockResolvedValue(accounts.map((providerAccountId) => ({ providerAccountId })));
const enrollmentStatus = (name: string) => store.enrollments.get(`${CLASS}__uid-${name}`)?.status;
const refresh = (reconcileEnrollments = true) =>
  refreshClassRosterMemberships({ actor, classId: CLASS, reconcileEnrollments });

beforeEach(() => {
  for (const map of Object.values(store)) map.clear();
  writes.length = 0;
  jest.clearAllMocks();
  mockWriteAuditEvent.mockResolvedValue({ eventId: "evt" });
  mockReconcileRecipients.mockResolvedValue({ assignmentsConsidered: 1, recipientsAdded: 1 });
  store.classes.set(CLASS, {
    teacherId: TEACHER,
    schoolId: SCHOOL,
    status: "active",
    enrollmentSource: "lms",
  });
  store.links.set(LINK, {
    classId: CLASS,
    status: "linked",
    ownerUid: TEACHER,
    schoolId: SCHOOL,
    connectionId: "conn-1",
    providerId: "googleClassroom",
    lmsClassId: "gc-course-1",
  });
  store.connections.set("conn-1", {
    teacherId: TEACHER,
    status: "active",
    providerId: "googleClassroom",
    tokenRef: "token-1",
  });
  store.schools.set(SCHOOL, { districtId: "district-alpha" });
});

describe("manual roster refresh: enrollment reconciliation", () => {
  test("A: a member already actively enrolled stays active with no duplicate enrollment or audit", async () => {
    const a = account("ann", {});
    enroll("ann", "active");
    upstream(a);
    const result = await refresh();
    expect(result.enrollmentReconciliation).toMatchObject({ added: 0, alreadyEnrolled: 1 });
    expect(enrollmentStatus("ann")).toBe("active");
    expect(writes.filter((w) => w.startsWith("enrollment."))).toEqual([]);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  test("B: a member who never signed in is cached for first sign-in and nothing else is created", async () => {
    const b = account("ben"); // no identity mapping
    upstream(b);
    const result = await refresh();
    expect(result.enrollmentReconciliation).toMatchObject({ added: 0, awaitingFirstSignIn: 1 });
    expect(store.memberships.get(`${LINK}__${hashOf(b)}`)?.status).toBe("member");
    expect(store.enrollments.size).toBe(0);
    expect(store.users.size).toBe(0);
  });

  test("B: a mapped but still-provisioned account is left to its own first sign-in (no enrollment)", async () => {
    const p = account("pat", { status: "provisioned" });
    upstream(p);
    const result = await refresh();
    expect(result.enrollmentReconciliation).toMatchObject({ awaitingFirstSignIn: 1, added: 0 });
    expect(store.enrollments.size).toBe(0);
    expect(store.memberships.get(`${LINK}__${hashOf(p)}`)?.status).toBe("member");
  });

  test("C: an ALREADY-active LyfeLabz student newly in this Classroom class is enrolled through the canonical step", async () => {
    const c = account("cal", {});
    upstream(c);
    const result = await refresh();
    expect(result.enrollmentReconciliation).toMatchObject({ added: 1, alreadyEnrolled: 0 });
    expect(store.enrollments.get(`${CLASS}__uid-cal`)).toMatchObject({
      studentId: "uid-cal",
      classId: CLASS,
      schoolId: SCHOOL,
      status: "active",
    });
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: TEACHER,
        actorRole: "teacher",
        action: "lms.membershipEnrollmentCreated",
        targetType: "class",
        targetId: CLASS,
        payload: { providerId: "googleClassroom", source: "teacherRosterRefresh" },
      }),
    );
    // Added as a recipient of the class's published assignments.
    expect(mockReconcileRecipients).toHaveBeenCalledWith({
      classId: CLASS,
      studentId: "uid-cal",
      schoolId: SCHOOL,
      districtId: "district-alpha",
    });
  });

  test("a historical withdrawal with NO provenance is never reactivated (unknown source is never inferred)", async () => {
    const w = account("wes", {});
    enroll("wes", "withdrawn", { exitedAt: "exited-at" });
    membership(w, "removed"); // even with a removed-membership row
    upstream(w);
    const result = await refresh();
    expect(result.enrollmentReconciliation).toMatchObject({ notReactivated: 1, reactivated: 0, added: 0 });
    expect(enrollmentStatus("wes")).toBe("withdrawn");
    expect(writes.filter((x) => x.startsWith("enrollment."))).toEqual([]);
  });

  test.each([
    ["another school", { schoolId: "school-other" }],
    ["not a student", { role: "teacher" }],
    ["a suspended account", { status: "suspended" }],
    ["a user record that disagrees with the mapping", { authUid: "someone-else" }],
  ])("an unsafe match (%s) is never enrolled", async (_label, user) => {
    const x = account("xan", user);
    upstream(x);
    const result = await refresh();
    expect(result.enrollmentReconciliation).toMatchObject({ notMatched: 1, added: 0 });
    expect(store.enrollments.size).toBe(0);
  });

  test("D: a student removed from Classroom is withdrawn; the enrollment record and history are kept", async () => {
    const stay = account("sue", {});
    const gone = account("gus", {});
    enroll("sue", "active");
    enroll("gus", "active");
    membership(stay, "member");
    membership(gone, "member");
    upstream(stay);
    const result = await refresh();
    expect(result.withdrawnEnrollments).toBe(1);
    expect(result.enrollmentReconciliation).toMatchObject({ withdrawn: 1 });
    expect(store.enrollments.get(`${CLASS}__uid-gus`)).toMatchObject({
      status: "withdrawn",
      exitedAt: "__ts__",
      exitSource: "lmsRosterSync",
      exitLinkId: LINK,
      studentId: "uid-gus",
      enrolledAt: "enrolled-at-original",
    });
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "lms.classroomEnrollmentWithdrawn",
        actorUserId: TEACHER,
        targetType: "enrollment",
        targetId: `${CLASS}__uid-gus`,
      }),
    );
    expect(enrollmentStatus("sue")).toBe("active");
  });

  test("D: a student added some other way (never a member of this Classroom class) is never withdrawn", async () => {
    const stay = account("sue", {});
    account("tia", {}); // enrolled by the teacher, never in Classroom
    enroll("sue", "active");
    enroll("tia", "active");
    upstream(stay);
    await refresh();
    expect(enrollmentStatus("tia")).toBe("active");
  });

  test("E: an empty Classroom roster withdraws nobody and removes no membership", async () => {
    const sue = account("sue", {});
    enroll("sue", "active");
    membership(sue, "member");
    // Also a leftover removed membership that would otherwise be retried.
    const old = account("old", {});
    enroll("old", "active");
    membership(old, "removed");
    upstream();
    const result = await refresh();
    expect(result.upstreamRosterEmpty).toBe(true);
    expect(result.enrollmentReconciliation).toMatchObject({ withdrawn: 0, added: 0 });
    expect(enrollmentStatus("sue")).toBe("active");
    expect(enrollmentStatus("old")).toBe("active");
    expect(store.memberships.get(`${LINK}__${hashOf(sue)}`)?.status).toBe("member");
  });

  test("F: a withdrawal interrupted by an earlier failure is completed on retry", async () => {
    // Earlier run marked the membership removed, then failed before
    // withdrawing the enrollment.
    const stay = account("sue", {});
    const gone = account("gus", {});
    enroll("gus", "active");
    membership(stay, "member");
    membership(gone, "removed");
    upstream(stay);
    const result = await refresh();
    expect(enrollmentStatus("gus")).toBe("withdrawn");
    expect(result.enrollmentReconciliation).toMatchObject({ withdrawn: 1 });
  });

  test("F: an upstream failure writes nothing", async () => {
    const c = account("cal", {});
    membership(c, "member");
    mockListClassRoster.mockRejectedValue(new Error("classroom unavailable"));
    await expect(refresh()).rejects.toThrow("classroom unavailable");
    expect(writes).toEqual([]);
  });

  test("retry is idempotent: a second identical refresh creates and withdraws nothing", async () => {
    const a = account("ann", {});
    const c = account("cal", {});
    const g = account("gus", {});
    enroll("ann", "active");
    enroll("gus", "active");
    membership(g, "member");
    upstream(a, c);
    const first = await refresh();
    expect(first.enrollmentReconciliation).toMatchObject({ added: 1, alreadyEnrolled: 1, withdrawn: 1 });
    const enrollmentsAfterFirst = new Map(store.enrollments);
    mockWriteAuditEvent.mockClear();

    const second = await refresh();
    expect(second.enrollmentReconciliation).toMatchObject({ added: 0, alreadyEnrolled: 2, withdrawn: 0 });
    expect(store.enrollments).toEqual(enrollmentsAfterFirst);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  test("two Classroom accounts resolving to one LyfeLabz user enroll that user once", async () => {
    const one = account("dup", {});
    const two = "gacct-dup-2";
    store.identities.set(hashOf(two), { userId: "uid-dup", status: "active" });
    upstream(one, two);
    const result = await refresh();
    expect(result.enrollmentReconciliation).toMatchObject({ added: 1 });
    expect(writes.filter((w) => w === `enrollment.set:${CLASS}__uid-dup`)).toHaveLength(1);
  });
});

describe("manual roster refresh: Classroom-managed reactivation (withdrawal provenance)", () => {
  test("full cycle: active -> left Classroom -> withdrawn WITH provenance -> returns -> SAME enrollment active again", async () => {
    const stay = account("sue", {});
    const cal = account("cal", {});
    enroll("sue", "active");
    enroll("cal", "active", { displayNameOverride: "Cal R." });
    membership(stay, "member");
    membership(cal, "member");

    // Cal leaves the Classroom class.
    upstream(stay);
    await refresh();
    const withdrawn = store.enrollments.get(`${CLASS}__uid-cal`)!;
    expect(withdrawn).toMatchObject({
      status: "withdrawn",
      exitSource: "lmsRosterSync",
      exitLinkId: LINK,
      exitedAt: "__ts__",
    });

    // Cal is added back to the same Classroom class.
    mockWriteAuditEvent.mockClear();
    mockReconcileRecipients.mockClear();
    writes.length = 0;
    upstream(stay, cal);
    const result = await refresh();

    expect(result.enrollmentReconciliation).toMatchObject({
      reactivated: 1,
      added: 0, // restored, never "new"
      alreadyEnrolled: 1,
      notReactivated: 0,
    });
    // The SAME enrollment document, identity and history preserved; the
    // withdrawn-only fields are cleared.
    const restored = store.enrollments.get(`${CLASS}__uid-cal`)!;
    expect(restored).toEqual({
      studentId: "uid-cal",
      classId: CLASS,
      schoolId: SCHOOL,
      status: "active",
      enrolledAt: "enrolled-at-original",
      displayNameOverride: "Cal R.",
    });
    expect(writes.filter((w) => w.startsWith("enrollment."))).toEqual([
      `enrollment.update:${CLASS}__uid-cal`,
    ]);
    // No new enrollment was created; the reactivation is audited distinctly.
    expect(auditActions()).toEqual(["lms.classroomEnrollmentReactivated"]);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "lms.classroomEnrollmentReactivated",
        actorUserId: TEACHER,
        actorRole: "teacher",
        targetType: "enrollment",
        targetId: `${CLASS}__uid-cal`,
        schoolId: SCHOOL,
        payload: {
          classId: CLASS,
          studentId: "uid-cal",
          providerId: "googleClassroom",
          previousStatus: "withdrawn",
        },
      }),
    );
    // Published-assignment recipients restored through the same logic new
    // enrollments use.
    expect(mockReconcileRecipients).toHaveBeenCalledWith({
      classId: CLASS,
      studentId: "uid-cal",
      schoolId: SCHOOL,
      districtId: "district-alpha",
    });
  });

  test("a repeated refresh after reactivation is a no-op for that enrollment", async () => {
    const cal = account("cal", {});
    enroll("cal", "withdrawn", classroomWithdrawn);
    upstream(cal);
    const first = await refresh();
    expect(first.enrollmentReconciliation).toMatchObject({ reactivated: 1 });

    mockWriteAuditEvent.mockClear();
    mockReconcileRecipients.mockClear();
    writes.length = 0;
    const second = await refresh();
    expect(second.enrollmentReconciliation).toMatchObject({ reactivated: 0, alreadyEnrolled: 1, added: 0 });
    expect(writes.filter((w) => w.startsWith("enrollment."))).toEqual([]);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    expect(mockReconcileRecipients).not.toHaveBeenCalled();
  });

  test.each([
    ["a TEACHER withdrawal", { exitSource: "teacher", exitedAt: "t" }, "withdrawn"],
    ["a withdrawal from a DIFFERENT Classroom link", { ...classroomWithdrawn, exitLinkId: "link-old" }, "withdrawn"],
    ["an ARCHIVED enrollment (even with Classroom provenance)", classroomWithdrawn, "archived"],
    ["a TRANSFERRED enrollment (even with Classroom provenance)", classroomWithdrawn, "transferred"],
  ])("never reactivates %s", async (_label, extra, status) => {
    const w = account("wes", {});
    enroll("wes", status, extra);
    const before = { ...store.enrollments.get(`${CLASS}__uid-wes`)! };
    upstream(w);
    const result = await refresh();
    expect(result.enrollmentReconciliation).toMatchObject({ reactivated: 0, notReactivated: 1, added: 0 });
    expect(store.enrollments.get(`${CLASS}__uid-wes`)).toEqual(before);
    expect(auditActions()).not.toContain("lms.classroomEnrollmentReactivated");
  });

  test.each([
    ["another school", { schoolId: "school-other" }],
    ["not a student", { role: "teacher" }],
    ["a suspended account", { status: "suspended" }],
    ["a user record that disagrees with the mapping", { authUid: "someone-else" }],
  ])("a Classroom-withdrawn enrollment stays withdrawn for an unsafe match (%s)", async (_label, user) => {
    const x = account("xan", user);
    enroll("xan", "withdrawn", classroomWithdrawn);
    upstream(x);
    const result = await refresh();
    expect(result.enrollmentReconciliation).toMatchObject({ reactivated: 0, notMatched: 1 });
    expect(enrollmentStatus("xan")).toBe("withdrawn");
  });

  test("a revoked identity mapping never reactivates (unsafe identity)", async () => {
    const x = account("xan", {});
    store.identities.set(hashOf(x), { userId: "uid-xan", status: "revoked" });
    enroll("xan", "withdrawn", classroomWithdrawn);
    upstream(x);
    const result = await refresh();
    expect(result.enrollmentReconciliation).toMatchObject({ reactivated: 0, awaitingFirstSignIn: 1 });
    expect(enrollmentStatus("xan")).toBe("withdrawn");
  });

  test("a teacher withdrawal that landed first is never overwritten with Classroom provenance", async () => {
    const stay = account("sue", {});
    const t = account("tom", {});
    membership(stay, "member");
    membership(t, "member");
    enroll("tom", "withdrawn", { exitSource: "teacher", exitedAt: "t" });
    upstream(stay);
    await refresh();
    expect(store.enrollments.get(`${CLASS}__uid-tom`)).toMatchObject({
      status: "withdrawn",
      exitSource: "teacher",
    });
    expect(store.enrollments.get(`${CLASS}__uid-tom`)).not.toHaveProperty("exitLinkId");
  });

  test("audit evidence distinguishes new enrollment, Classroom withdrawal, and Classroom reactivation", async () => {
    const newcomer = account("nia", {});
    const leaver = account("lee", {});
    const returner = account("ray", {});
    enroll("lee", "active");
    membership(leaver, "member");
    enroll("ray", "withdrawn", classroomWithdrawn);
    upstream(newcomer, returner);
    const result = await refresh();
    expect(result.enrollmentReconciliation).toMatchObject({ added: 1, reactivated: 1, withdrawn: 1 });
    expect(auditActions().sort()).toEqual([
      "lms.classroomEnrollmentReactivated",
      "lms.classroomEnrollmentWithdrawn",
      "lms.membershipEnrollmentCreated",
    ]);
  });

  test("Import (no reconcileEnrollments) never reactivates a returning student", async () => {
    const cal = account("cal", {});
    enroll("cal", "withdrawn", classroomWithdrawn);
    upstream(cal);
    const result = await refresh(false);
    expect(result.enrollmentReconciliation).toBeUndefined();
    expect(enrollmentStatus("cal")).toBe("withdrawn");
  });
});

describe("manual roster refresh: authorization and scope", () => {
  test("Import (no reconcileEnrollments) is unchanged: no enrollment is created for an active student", async () => {
    const c = account("cal", {});
    upstream(c);
    const result = await refresh(false);
    expect(result.enrollmentReconciliation).toBeUndefined();
    expect(store.enrollments.size).toBe(0);
    expect(store.memberships.get(`${LINK}__${hashOf(c)}`)?.status).toBe("member");
  });

  test("a class that is not active is refused before any Classroom read or write", async () => {
    store.classes.set(CLASS, { ...store.classes.get(CLASS)!, status: "needsSetup" });
    upstream(account("cal", {}));
    await expect(refresh()).rejects.toMatchObject({ code: "lms.classNotActive" });
    expect(mockListClassRoster).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  test.each([
    ["another teacher's class", { teacherId: "teacher-other" }],
    ["a class in another school", { schoolId: "school-other" }],
    ["a class not linked to Classroom", { enrollmentSource: "manual" }],
  ])("%s is refused with no write", async (_label, overrides) => {
    store.classes.set(CLASS, { ...store.classes.get(CLASS)!, ...overrides });
    upstream(account("cal", {}));
    await expect(refresh()).rejects.toMatchObject({
      code: expect.stringMatching(/^lms\.(forbidden|classNotLinked)$/),
    });
    expect(mockListClassRoster).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  test("a missing class is refused", async () => {
    store.classes.clear();
    await expect(refresh()).rejects.toMatchObject({ code: "lms.classNotFound" });
  });
});
