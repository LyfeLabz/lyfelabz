import type { CallableRequest } from "firebase-functions/v2/https";

// Student Support Access (PDR-032) hermetic security suite. One in-memory
// document store backs every typed reference the touched modules read, so
// the REAL authorization helper, grant callables, and student-scoped reads
// run end to end against it.

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

type Data = Record<string, unknown>;
const store = new Map<string, Data>();
const audits: Data[] = [];
let mockContext: { uid: string; role: string; schoolId: string; districtId: string } | null = null;

type Snap = { id: string; exists: boolean; data: () => Data | undefined };
const snapOf = (path: string): Snap => {
  const data = store.get(path);
  return { id: path.split("/").pop()!, exists: data !== undefined, data: () => (data === undefined ? undefined : { ...data }) };
};

type FakeQuery = { where: (f: string, op: string, v: unknown) => FakeQuery; get: () => Promise<{ docs: Snap[] }> };
function queryOver(match: (path: string) => boolean, filters: Array<[string, unknown]> = []): FakeQuery {
  return {
    where: (f, _op, v) => queryOver(match, [...filters, [f, v]]),
    get: () =>
      Promise.resolve({
        docs: Array.from(store.entries())
          .filter(([path, data]) => match(path) && filters.every(([f, v]) => data[f] === v))
          .map(([path]) => snapOf(path)),
      }),
  };
}
const topLevel = (collection: string) => (path: string) => {
  const parts = path.split("/");
  return parts.length === 2 && parts[0] === collection;
};
const docRef = (collection: string) => (id: string) => ({
  path: `${collection}/${id}`,
  get: () => Promise.resolve(snapOf(`${collection}/${id}`)),
});

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual("../shared/errors/platform-error");
  const { normalizeEmail } = jest.requireActual("../shared/config/teacher-pilot-allowlist");
  return {
    PlatformError,
    normalizeEmail,
    platformCallable: (handler: unknown) => handler,
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    requireDistrictContext: () =>
      mockContext === null
        ? Promise.reject(new PlatformError("unauthenticated", "no caller") as Error)
        : Promise.resolve(mockContext),
    isTransactionContention: () => false,
    classDocRef: docRef("classes"),
    enrollmentDocRef: docRef("enrollments"),
    userRecordDocRef: docRef("users"),
    attemptDocRef: docRef("attempts"),
    assignmentDocRef: docRef("assignments"),
    studentSupportGrantDocRef: docRef("studentSupportGrants"),
    studentSupportGrantWriteDocRef: docRef("studentSupportGrants"),
    studentSupportGrantRevokeDocRef: docRef("studentSupportGrants"),
    studentSupportGrantIdFor: (c: string, s: string, g: string) => `${c}__${s}__${g}`,
    studentSupportGrantsCollectionRef: () => queryOver(topLevel("studentSupportGrants")),
    attemptsCollectionRef: () => queryOver(topLevel("attempts")),
    enrollmentsCollectionRef: () => queryOver(topLevel("enrollments")),
    usersByEmailQuery: (email: string) => queryOver(topLevel("users")).where("email", "==", email),
    assignmentRecipientsCollectionGroupRef: () => queryOver((p) => /^assignments\/[^/]+\/recipients\/[^/]+$/.test(p)),
    assessmentSessionsCollectionRef: () => queryOver(topLevel("assessmentSessions")),
    assignmentsCollectionRef: () => queryOver(topLevel("assignments")),
    assignmentsCurrentDocRef: (classId: string, slug: string) => docRef(`classes/${classId}/assignmentsCurrent`)(slug),
    runFirestoreTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const writes: Array<() => void> = [];
      const tx = {
        get: async (ref: { path?: string; get: () => Promise<Snap> }) => ref.get(),
        set: (ref: { path: string }, data: Data) => writes.push(() => store.set(ref.path, { ...data })),
        update: (ref: { path: string }, data: Data) =>
          writes.push(() => store.set(ref.path, { ...(store.get(ref.path) ?? {}), ...data })),
      };
      const result = await fn(tx);
      writes.forEach((w) => w());
      return result;
    },
    writeAuditEventInTransaction: (_tx: unknown, input: Data) => {
      audits.push(input);
      return { eventId: `audit-${audits.length}`, record: input };
    },
  };
});

// Firebase Auth email lookup is case-insensitive; the fake mirrors that over
// the same store (Auth holds the lowercased address).
const authLookups: string[] = [];
let authFailure: Error | null = null;
jest.mock("../shared/auth/admin", () => ({
  getAdminAuth: () => ({
    getUserByEmail: (email: string) => {
      authLookups.push(email);
      if (authFailure !== null) return Promise.reject(authFailure);
      for (const [path, data] of store.entries()) {
        if (path.startsWith("users/") && typeof data.email === "string" && data.email.toLowerCase() === email.toLowerCase()) {
          return Promise.resolve({ uid: path.slice("users/".length) });
        }
      }
      return Promise.reject(Object.assign(new Error("no user"), { code: "auth/user-not-found" }));
    },
  }),
}));

jest.mock("../shared/firestore/admin", () => ({
  getAdminFirestore: () => ({
    collection: (name: string) => {
      const base = queryOver(topLevel(name));
      return {
        ...base,
        doc: (id: string) => ({
          collection: (sub: string) => queryOver((p) => p.startsWith(`${name}/${id}/${sub}/`) && p.split("/").length === 4),
        }),
      };
    },
  }),
}));

import { PlatformError } from "../shared/errors/platform-error";
import { __supportAccessHandlers } from "./callables";
import { __assessmentAttemptsListForStudentHandler } from "../assessments/assessment-attempts-list-for-student";
import { __assessmentAttemptsListForClassHandler } from "../assessments/assessment-attempts-list-for-class";
import { __assessmentAttemptGetForTeacherHandler } from "../assessments/assessment-attempt-get-for-teacher";
import { __assessmentStudentAssignmentsForClassHandler } from "../assessments/assessment-student-assignments-for-class";
import { __gradeImprovementHandlers } from "../gradeImprovements/callables";

const SCHOOL = "school-a";
const DISTRICT = "district-a";
const OWNER = "owner-1";
const GRANTEE = "grantee-1";
const OTHER_TEACHER = "teacher-2";
const OTHER_SCHOOL_TEACHER = "teacher-far";
const STUDENT = "student-1";
const CLASSMATE = "student-2";
const CLASS = "class-1";
const OTHER_CLASS = "class-2";
const GRANT_ID = `${CLASS}__${STUDENT}__${GRANTEE}`;

const ts = (ms: number) => ({ toMillis: () => ms });

function teacher(uid: string, overrides: Data = {}): Data {
  return { authUid: uid, status: "active", role: "teacher", schoolId: SCHOOL, displayName: `Teacher ${uid}`, email: `${uid}@school.org`, ...overrides };
}

function attempt(studentId: string, classId: string, n: number, overrides: Data = {}): Data {
  return {
    studentId,
    classId,
    assignmentId: "asg-1",
    teacherId: OWNER,
    schoolId: SCHOOL,
    districtId: DISTRICT,
    activityId: "act",
    assessmentId: "assessment_earths-layers",
    assessmentRevisionId: "assessment_earths-layers__r1",
    attemptNumber: n,
    score: 7,
    maxScore: 10,
    percentage: 70,
    responses: [],
    itemResults: [{ itemId: "q1", isCorrect: false, pointsEarned: 0, correctOptionId: "B", explanation: "Because.", studentResponse: "A" }],
    idempotencyKey: `k-${studentId}-${n}`,
    submittedAt: ts(1000 + n),
    ...overrides,
  };
}

function seed(): void {
  store.clear();
  audits.length = 0;
  authLookups.length = 0;
  authFailure = null;
  store.set(`users/${OWNER}`, teacher(OWNER));
  store.set(`users/${GRANTEE}`, teacher(GRANTEE));
  store.set(`users/${OTHER_TEACHER}`, teacher(OTHER_TEACHER));
  store.set(`users/${OTHER_SCHOOL_TEACHER}`, teacher(OTHER_SCHOOL_TEACHER, { schoolId: "school-b" }));
  store.set(`users/${STUDENT}`, { authUid: STUDENT, status: "active", role: "student", schoolId: SCHOOL, displayName: "Ada Student", email: "ada@school.org" });
  store.set(`users/${CLASSMATE}`, { authUid: CLASSMATE, status: "active", role: "student", schoolId: SCHOOL, displayName: "Ben Student" });
  store.set(`classes/${CLASS}`, { teacherId: OWNER, schoolId: SCHOOL, title: "Science 7B", status: "active", grade: "7", block: "B" });
  store.set(`classes/${OTHER_CLASS}`, { teacherId: OTHER_TEACHER, schoolId: SCHOOL, title: "Science 7C", status: "active", grade: "7", block: "C" });
  for (const [classId, studentId] of [[CLASS, STUDENT], [CLASS, CLASSMATE], [OTHER_CLASS, STUDENT]] as const) {
    store.set(`enrollments/${classId}__${studentId}`, { studentId, classId, schoolId: SCHOOL, status: "active", enrolledAt: ts(1) });
  }
  store.set(`attempts/asg-1__${STUDENT}__1`, attempt(STUDENT, CLASS, 1));
  store.set(`attempts/asg-1__${STUDENT}__2`, attempt(STUDENT, CLASS, 2, { percentage: 90, score: 9 }));
  store.set(`attempts/asg-1__${CLASSMATE}__1`, attempt(CLASSMATE, CLASS, 1));
  store.set(`attempts/asg-9__${STUDENT}__1`, attempt(STUDENT, OTHER_CLASS, 1, { assignmentId: "asg-9", teacherId: OTHER_TEACHER }));
}

function activeGrant(overrides: Data = {}): Data {
  return { classId: CLASS, studentId: STUDENT, ownerTeacherId: OWNER, granteeUid: GRANTEE, schoolId: SCHOOL, districtId: DISTRICT, status: "active", grantedAt: ts(5), grantedBy: OWNER, ...overrides };
}

function as(uid: string, overrides: Partial<NonNullable<typeof mockContext>> = {}): void {
  mockContext = { uid, role: "teacher", schoolId: SCHOOL, districtId: DISTRICT, ...overrides };
}

const req = (data: unknown): CallableRequest<unknown> => ({ data } as unknown as CallableRequest<unknown>);

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(PlatformError);
  await promise.catch((err: unknown) => expect((err as PlatformError).code).toBe(code));
}

const listForStudent = (classId: string, studentId: string) =>
  __assessmentAttemptsListForStudentHandler(req({ classId, studentId }));

beforeEach(() => {
  seed();
  mockContext = null;
});

describe("assessmentAttemptsListForStudent", () => {
  it("returns only the requested student's attempts to the owner, newest first", async () => {
    as(OWNER);
    const result = await listForStudent(CLASS, STUDENT);
    expect(result.attempts.map((a) => a.attemptId)).toEqual([`asg-1__${STUDENT}__2`, `asg-1__${STUDENT}__1`]);
    expect(result.attempts.every((a) => a.studentId === STUDENT)).toBe(true);
    expect(result.attempts[0]?.studentDisplayName).toBe("Ada Student");
  });

  it("returns the same summaries to an active grantee and never a classmate's", async () => {
    as(OWNER);
    const ownerView = await listForStudent(CLASS, STUDENT);
    store.set(`studentSupportGrants/${GRANT_ID}`, activeGrant());
    as(GRANTEE);
    const granteeView = await listForStudent(CLASS, STUDENT);
    expect(granteeView).toEqual(ownerView);
    await expectCode(listForStudent(CLASS, CLASSMATE), "classes.forbidden");
  });

  it("drops attempt rows whose frozen ownership disagrees with the class owner", async () => {
    store.set(`attempts/asg-1__${STUDENT}__3`, attempt(STUDENT, CLASS, 3, { teacherId: OTHER_TEACHER }));
    as(OWNER);
    const result = await listForStudent(CLASS, STUDENT);
    expect(result.attempts.map((a) => a.attemptNumber)).toEqual([2, 1]);
  });

  it("refuses ownership keys on the request", async () => {
    as(OWNER);
    await expectCode(__assessmentAttemptsListForStudentHandler(req({ classId: CLASS, studentId: STUDENT, teacherId: OWNER })), "assessmentAttempts.invalidRequest");
  });
});

describe("authorizeStudentScopedRead: grantee refusals", () => {
  beforeEach(() => {
    store.set(`studentSupportGrants/${GRANT_ID}`, activeGrant());
  });

  const refusals: Array<[string, () => void, string, string]> = [
    ["no grant at all", () => store.delete(`studentSupportGrants/${GRANT_ID}`), CLASS, STUDENT],
    ["another student in the same class", () => undefined, CLASS, CLASSMATE],
    ["the same student in another teacher's class", () => undefined, OTHER_CLASS, STUDENT],
    ["a revoked grant", () => store.set(`studentSupportGrants/${GRANT_ID}`, activeGrant({ status: "revoked" })), CLASS, STUDENT],
    ["an archived class", () => store.set(`classes/${CLASS}`, { ...store.get(`classes/${CLASS}`), status: "archived" }), CLASS, STUDENT],
    ["a withdrawn student", () => store.set(`enrollments/${CLASS}__${STUDENT}`, { ...store.get(`enrollments/${CLASS}__${STUDENT}`), status: "withdrawn" }), CLASS, STUDENT],
    ["a suspended owner", () => store.set(`users/${OWNER}`, teacher(OWNER, { status: "suspended" })), CLASS, STUDENT],
    ["an owner who moved school", () => store.set(`users/${OWNER}`, teacher(OWNER, { schoolId: "school-b" })), CLASS, STUDENT],
    ["a grant naming another owner", () => store.set(`studentSupportGrants/${GRANT_ID}`, activeGrant({ ownerTeacherId: OTHER_TEACHER })), CLASS, STUDENT],
    ["a grant from another district", () => store.set(`studentSupportGrants/${GRANT_ID}`, activeGrant({ districtId: "district-b" })), CLASS, STUDENT],
    // Defense in depth: a record stored under a classmate's grant id whose
    // frozen fields name a different student never authorizes the classmate.
    ["a grant record whose frozen student disagrees with its id", () => store.set(`studentSupportGrants/${CLASS}__${CLASSMATE}__${GRANTEE}`, activeGrant()), CLASS, CLASSMATE],
    ["a grant record whose frozen class disagrees with its id", () => store.set(`studentSupportGrants/${OTHER_CLASS}__${STUDENT}__${GRANTEE}`, activeGrant()), OTHER_CLASS, STUDENT],
  ];

  it.each(refusals)("refuses %s", async (_label, mutate, classId, studentId) => {
    mutate();
    as(GRANTEE);
    await expectCode(listForStudent(classId, studentId), "classes.forbidden");
  });

  it("refuses a grantee whose verified school differs from the class", async () => {
    as(GRANTEE, { schoolId: "school-b" });
    await expectCode(listForStudent(CLASS, STUDENT), "classes.forbidden");
  });

  it("refuses a non-teacher caller", async () => {
    as(STUDENT, { role: "student" });
    await expectCode(listForStudent(CLASS, STUDENT), "role-forbidden");
  });

  it("refuses the grantee every class-wide and owner-only callable", async () => {
    as(GRANTEE);
    await expectCode(__assessmentAttemptsListForClassHandler(req({ classId: CLASS })), "classes.forbidden");
    await expectCode(
      __gradeImprovementHandlers.reverse(req({ assignmentId: "asg-1", studentId: STUDENT, eventId: "e000001" })),
      "assignments.notFound",
    );
    store.set("assignments/asg-1", { classId: CLASS, teacherId: OWNER, schoolId: SCHOOL, status: "published" });
    await expectCode(
      __gradeImprovementHandlers.reverse(req({ assignmentId: "asg-1", studentId: STUDENT, eventId: "e000001" })),
      "assignments.forbidden",
    );
    await expectCode(
      __gradeImprovementHandlers.acknowledge(req({ assignmentId: "asg-1", studentId: STUDENT, attemptId: `asg-1__${STUDENT}__2`, percentage: 90 })),
      "assignments.forbidden",
    );
    await expectCode(__gradeImprovementHandlers.listForAssignment(req({ assignmentId: "asg-1" })), "assignments.forbidden");
    await expectCode(__supportAccessHandlers.listForClass(req({ classId: CLASS })), "classes.forbidden");
    await expectCode(
      __supportAccessHandlers.grant(req({ classId: CLASS, studentId: CLASSMATE, granteeEmail: `${OTHER_TEACHER}@school.org` })),
      "classes.forbidden",
    );
  });
});

describe("student-scoped reads extended to grantees", () => {
  beforeEach(() => {
    store.set(`studentSupportGrants/${GRANT_ID}`, activeGrant());
  });

  it("assessmentAttemptGetForTeacher returns the granted student's attempt and refuses a classmate's", async () => {
    as(GRANTEE);
    const result = await __assessmentAttemptGetForTeacherHandler(req({ attemptId: `asg-1__${STUDENT}__1` }));
    expect(result.attempt.studentId).toBe(STUDENT);
    expect(result.attempt.itemResults[0]).toEqual(
      expect.objectContaining({ itemId: "q1", isCorrect: false, correctOptionId: "B", studentResponse: "A" }),
    );
    await expectCode(__assessmentAttemptGetForTeacherHandler(req({ attemptId: `asg-1__${CLASSMATE}__1` })), "classes.forbidden");
    await expectCode(__assessmentAttemptGetForTeacherHandler(req({ attemptId: `asg-9__${STUDENT}__1` })), "classes.forbidden");
  });

  it("assessmentAttemptGetForTeacher refuses after revocation", async () => {
    store.set(`studentSupportGrants/${GRANT_ID}`, activeGrant({ status: "revoked" }));
    as(GRANTEE);
    await expectCode(__assessmentAttemptGetForTeacherHandler(req({ attemptId: `asg-1__${STUDENT}__1` })), "classes.forbidden");
  });

  it("assessmentStudentAssignmentsForClass admits the grantee for the granted student only", async () => {
    store.set(`assignments/asg-1`, { classId: CLASS, teacherId: OWNER, schoolId: SCHOOL, status: "published", lessonSlug: "earths-layers", title: "Earth's Layers", publishedAt: ts(10) });
    store.set(`assignments/asg-1/recipients/${STUDENT}`, { studentId: STUDENT, classId: CLASS, teacherId: OWNER, schoolId: SCHOOL, districtId: DISTRICT, status: "assigned", assignmentId: "asg-1" });
    as(OWNER);
    const ownerView = await __assessmentStudentAssignmentsForClassHandler(req({ classId: CLASS, studentId: STUDENT }));
    as(GRANTEE);
    const granteeView = await __assessmentStudentAssignmentsForClassHandler(req({ classId: CLASS, studentId: STUDENT }));
    expect(granteeView).toEqual(ownerView);
    expect(granteeView.assignments.map((a) => a.assignmentId)).toEqual(["asg-1"]);
    await expectCode(__assessmentStudentAssignmentsForClassHandler(req({ classId: CLASS, studentId: CLASSMATE })), "classes.forbidden");
  });

  it("gradeImprovementsListForStudent shows the owner's history to the grantee, attributed to another teacher", async () => {
    const recordId = `asg-1__${STUDENT}`;
    const owned = { assignmentId: "asg-1", studentId: STUDENT, classId: CLASS, teacherId: OWNER, schoolId: SCHOOL, districtId: DISTRICT };
    store.set(`gradeImprovementAcks/${recordId}`, { ...owned, eventCount: 1 });
    store.set(`gradeImprovementAcks/${recordId}/events/e000001`, {
      ...owned, eventId: "e000001", sequence: 1, type: "acknowledged", percentage: 90, attemptId: `asg-1__${STUDENT}__2`,
      baselinePercentage: 70, actorUid: OWNER, createdAt: ts(20),
    });
    as(GRANTEE);
    const result = await __gradeImprovementHandlers.listForStudent(req({ classId: CLASS, studentId: STUDENT }));
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.events.every((e) => e.byCaller === false)).toBe(true);
    await expectCode(__gradeImprovementHandlers.listForStudent(req({ classId: CLASS, studentId: CLASSMATE })), "classes.forbidden");
  });
});

describe("supportAccessGrant / supportAccessRevoke", () => {
  const grant = (data: Data) => __supportAccessHandlers.grant(req(data));

  it("grants by same-school email, writes the record and one audit event, and is idempotent", async () => {
    as(OWNER);
    const first = await grant({ classId: CLASS, studentId: STUDENT, granteeEmail: ` ${GRANTEE.toUpperCase()}@School.org ` });
    expect(first.grant).toEqual(expect.objectContaining({ grantId: GRANT_ID, studentDisplayName: "Ada Student", granteeDisplayName: `Teacher ${GRANTEE}` }));
    expect(store.get(`studentSupportGrants/${GRANT_ID}`)).toEqual(
      expect.objectContaining({ classId: CLASS, studentId: STUDENT, ownerTeacherId: OWNER, granteeUid: GRANTEE, schoolId: SCHOOL, districtId: DISTRICT, status: "active", grantedBy: OWNER }),
    );
    expect(audits).toEqual([
      expect.objectContaining({ action: "supportAccess.granted", targetType: "studentSupportGrant", targetId: GRANT_ID, actorUserId: OWNER, schoolId: SCHOOL, districtId: DISTRICT, payload: { classId: CLASS, studentId: STUDENT, granteeUid: GRANTEE } }),
    ]);
    await grant({ classId: CLASS, studentId: STUDENT, granteeEmail: `${GRANTEE}@school.org` });
    expect(audits).toHaveLength(1);
  });

  it("does not consult Firebase Auth when the stored email matches directly", async () => {
    as(OWNER);
    await grant({ classId: CLASS, studentId: STUDENT, granteeEmail: `${GRANTEE}@school.org` });
    expect(authLookups).toEqual([]);
  });

  it("finds a teacher whose stored email differs only in capitalization, through one Auth lookup", async () => {
    store.set(`users/${GRANTEE}`, teacher(GRANTEE, { email: "Grantee.One@School.org" }));
    as(OWNER);
    const result = await grant({ classId: CLASS, studentId: STUDENT, granteeEmail: "grantee.one@school.org" });
    expect(result.grant.grantId).toBe(GRANT_ID);
    expect(authLookups).toEqual(["grantee.one@school.org"]);
    expect(store.get(`studentSupportGrants/${GRANT_ID}`)).toEqual(expect.objectContaining({ granteeUid: GRANTEE, status: "active" }));
  });

  it("still applies every same-school active-teacher check to the Auth candidate", async () => {
    store.set(`users/${OTHER_SCHOOL_TEACHER}`, teacher(OTHER_SCHOOL_TEACHER, { schoolId: "school-b", email: "Far.Teacher@School.org" }));
    store.set(`users/${GRANTEE}`, teacher(GRANTEE, { status: "suspended", email: "Grantee.One@School.org" }));
    store.set(`users/${OWNER}`, teacher(OWNER, { email: "Owner.One@School.org" }));
    as(OWNER);
    for (const email of ["far.teacher@school.org", "grantee.one@school.org", "owner.one@school.org"]) {
      await expectCode(grant({ classId: CLASS, studentId: STUDENT, granteeEmail: email }), "supportAccess.granteeUnavailable");
    }
    authFailure = new Error("auth unavailable");
    await expectCode(grant({ classId: CLASS, studentId: STUDENT, granteeEmail: "nobody@school.org" }), "supportAccess.granteeUnavailable");
    expect(audits).toHaveLength(0);
  });

  it("refuses every non-match with one uniform code", async () => {
    store.set(`users/inactive`, teacher("inactive", { status: "suspended" }));
    as(OWNER);
    for (const email of ["nobody@school.org", `${OTHER_SCHOOL_TEACHER}@school.org`, "inactive@school.org", "ada@school.org", `${OWNER}@school.org`]) {
      await expectCode(grant({ classId: CLASS, studentId: STUDENT, granteeEmail: email }), "supportAccess.granteeUnavailable");
    }
    expect(audits).toHaveLength(0);
  });

  it("refuses a class the caller does not own, an inactive class, and a withdrawn student", async () => {
    as(OWNER);
    await expectCode(grant({ classId: OTHER_CLASS, studentId: STUDENT, granteeEmail: `${GRANTEE}@school.org` }), "classes.forbidden");
    store.set(`enrollments/${CLASS}__${CLASSMATE}`, { ...store.get(`enrollments/${CLASS}__${CLASSMATE}`), status: "withdrawn" });
    await expectCode(grant({ classId: CLASS, studentId: CLASSMATE, granteeEmail: `${GRANTEE}@school.org` }), "supportAccess.studentNotEnrolled");
    store.set(`classes/${CLASS}`, { ...store.get(`classes/${CLASS}`), status: "archived" });
    await expectCode(grant({ classId: CLASS, studentId: STUDENT, granteeEmail: `${GRANTEE}@school.org` }), "supportAccess.classNotActive");
    await expectCode(grant({ classId: CLASS, studentId: STUDENT, granteeEmail: `${GRANTEE}@school.org`, schoolId: SCHOOL }), "supportAccess.invalidRequest");
    expect(audits).toHaveLength(0);
  });

  it("revokes (owner only, idempotent), denies the next read, and reactivates on re-grant", async () => {
    as(OWNER);
    await grant({ classId: CLASS, studentId: STUDENT, granteeEmail: `${GRANTEE}@school.org` });
    as(GRANTEE);
    await expect(listForStudent(CLASS, STUDENT)).resolves.toBeDefined();
    await expectCode(__supportAccessHandlers.revoke(req({ grantId: GRANT_ID })), "supportAccess.notFound");

    as(OWNER);
    await expect(__supportAccessHandlers.revoke(req({ grantId: GRANT_ID }))).resolves.toEqual({ grantId: GRANT_ID, status: "revoked" });
    await __supportAccessHandlers.revoke(req({ grantId: GRANT_ID }));
    expect(audits.map((a) => a.action)).toEqual(["supportAccess.granted", "supportAccess.revoked"]);

    as(GRANTEE);
    await expectCode(listForStudent(CLASS, STUDENT), "classes.forbidden");

    as(OWNER);
    await grant({ classId: CLASS, studentId: STUDENT, granteeEmail: `${GRANTEE}@school.org` });
    expect(store.get(`studentSupportGrants/${GRANT_ID}`)!.status).toBe("active");
    expect(store.get(`studentSupportGrants/${GRANT_ID}`)).not.toHaveProperty("revokedBy");
    expect(audits.map((a) => a.action)).toEqual(["supportAccess.granted", "supportAccess.revoked", "supportAccess.granted"]);
  });
});

describe("supportAccessListForClass / supportAccessListMine", () => {
  it("lists active grants on an owned class for the owner only", async () => {
    store.set(`studentSupportGrants/${GRANT_ID}`, activeGrant());
    store.set(`studentSupportGrants/${CLASS}__${CLASSMATE}__${GRANTEE}`, activeGrant({ studentId: CLASSMATE, status: "revoked" }));
    as(OWNER);
    const result = await __supportAccessHandlers.listForClass(req({ classId: CLASS }));
    expect(result.grants).toEqual([
      expect.objectContaining({ grantId: GRANT_ID, studentId: STUDENT, studentDisplayName: "Ada Student", granteeEmail: `${GRANTEE}@school.org` }),
    ]);
    as(OTHER_TEACHER);
    await expectCode(__supportAccessHandlers.listForClass(req({ classId: CLASS })), "classes.forbidden");
  });

  it("lists only the caller's grants that pass the full read check right now", async () => {
    store.set(`studentSupportGrants/${GRANT_ID}`, activeGrant());
    store.set(`studentSupportGrants/${CLASS}__${CLASSMATE}__${GRANTEE}`, activeGrant({ studentId: CLASSMATE }));
    store.set(`enrollments/${CLASS}__${CLASSMATE}`, { ...store.get(`enrollments/${CLASS}__${CLASSMATE}`), status: "withdrawn" });
    store.set(`studentSupportGrants/${CLASS}__${STUDENT}__${OTHER_TEACHER}`, activeGrant({ granteeUid: OTHER_TEACHER }));
    as(GRANTEE);
    const result = await __supportAccessHandlers.listMine(req({}));
    expect(result.students).toEqual([
      { grantId: GRANT_ID, classId: CLASS, classTitle: "Science 7B", studentId: STUDENT, studentDisplayName: "Ada Student", ownerDisplayName: `Teacher ${OWNER}` },
    ]);
    as(OWNER);
    await expect(__supportAccessHandlers.listMine(req({}))).resolves.toEqual({ students: [] });
  });
});
