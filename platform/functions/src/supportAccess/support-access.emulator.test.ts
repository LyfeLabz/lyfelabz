// Student Support Access (PDR-032) emulator-backed proofs for the single and
// bulk grant/revoke callables.
//
// Runs against the REAL Firestore emulator (`npm run test:emulator`, offline
// `demo-bootstrap` project): real `requireDistrictContext` reads, real
// firebase-admin transactions (lazy start, read-before-write, rollback,
// contention retry), and real audit writes. Every record is synthetic
// emulator data in a per-test namespace. Skips when the emulator host is
// absent.
//
// Only two seams are replaced. The Firebase Auth email fallback rejects
// every lookup (no Auth emulator runs, and this suite must never reach a
// network Auth service); stored emails here match directly, so the fallback
// is never needed. `writeAuditEventInTransaction` wraps the real writer so a
// test can make one transaction throw mid-body and prove its rollback.

import { getApps, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";

jest.mock("../shared/auth/admin", () => ({
  getAdminAuth: () => ({
    getUserByEmail: () => Promise.reject(Object.assign(new Error("no user"), { code: "auth/user-not-found" })),
  }),
}));

let mockAuditFailTarget: string | null = null;
jest.mock("../shared", () => {
  const actual = jest.requireActual("../shared");
  return {
    ...actual,
    writeAuditEventInTransaction: (tx: unknown, input: { targetId: string }) => {
      if (mockAuditFailTarget !== null && input.targetId === mockAuditFailTarget) {
        throw new Error("injected audit failure");
      }
      return actual.writeAuditEventInTransaction(tx, input);
    },
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __supportAccessHandlers as h } from "./callables";

const PROJECT = "demo-bootstrap";
const hasEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const d = hasEmulator ? describe : describe.skip;

if (hasEmulator) {
  const envProject = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? PROJECT;
  for (const p of [PROJECT, envProject]) {
    if (p === "lyfelabz-prod" || p === "lyfelabz-staging" || !p.startsWith("demo-")) {
      throw new Error(`Refusing to run emulator tests against "${p}"; a demo project is required.`);
    }
  }
  if (getApps().length === 0) initializeApp({ projectId: PROJECT });
}
const db = hasEmulator ? getFirestore() : (undefined as never);

type World = {
  readonly ns: string;
  readonly schoolId: string;
  readonly otherSchoolId: string;
  readonly districtId: string;
  readonly classId: string;
  readonly otherClassId: string;
  readonly owner: string;
  readonly granteeA: string;
  readonly granteeB: string;
  readonly otherOwner: string;
  readonly farTeacher: string;
  readonly inactiveTeacher: string;
  readonly students: readonly string[];
  readonly withdrawn: string;
};

const emailOf = (uid: string) => `${uid}@emu.test`;

async function seedWorld(opts: { students?: number; extraTeachers?: number } = {}): Promise<World & { extraTeachers: string[] }> {
  const ns = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const students = Array.from({ length: opts.students ?? 3 }, (_, i) => `stu-${i}-${ns}`);
  const w = {
    ns,
    schoolId: `school-${ns}`,
    otherSchoolId: `school-far-${ns}`,
    districtId: `district-${ns}`,
    classId: `class-${ns}`,
    otherClassId: `class-other-${ns}`,
    owner: `owner-${ns}`,
    granteeA: `granteea-${ns}`,
    granteeB: `granteeb-${ns}`,
    otherOwner: `otherowner-${ns}`,
    farTeacher: `far-${ns}`,
    inactiveTeacher: `inactive-${ns}`,
    students,
    withdrawn: `stu-withdrawn-${ns}`,
    extraTeachers: Array.from({ length: opts.extraTeachers ?? 0 }, (_, i) => `extra-${i}-${ns}`),
  };
  const writer = db.bulkWriter();
  void writer.set(db.doc(`schools/${w.schoolId}`), { districtId: w.districtId, name: "Emulator School" });
  void writer.set(db.doc(`schools/${w.otherSchoolId}`), { districtId: w.districtId, name: "Far School" });
  const teacher = (uid: string, schoolId = w.schoolId, status = "active") =>
    void writer.set(db.doc(`users/${uid}`), { authUid: uid, status, role: "teacher", schoolId, displayName: `T ${uid}`, email: emailOf(uid) });
  for (const t of [w.owner, w.granteeA, w.granteeB, w.otherOwner, ...w.extraTeachers]) teacher(t);
  teacher(w.farTeacher, w.otherSchoolId);
  teacher(w.inactiveTeacher, w.schoolId, "suspended");
  for (const s of [...students, w.withdrawn]) {
    void writer.set(db.doc(`users/${s}`), { authUid: s, status: "active", role: "student", schoolId: w.schoolId, displayName: `S ${s}`, email: emailOf(s) });
  }
  void writer.set(db.doc(`classes/${w.classId}`), { teacherId: w.owner, schoolId: w.schoolId, title: "Science 7B", status: "active", grade: "7", block: "B", createdAt: Timestamp.now() });
  void writer.set(db.doc(`classes/${w.otherClassId}`), { teacherId: w.otherOwner, schoolId: w.schoolId, title: "Science 7C", status: "active", grade: "7", block: "C", createdAt: Timestamp.now() });
  for (const s of students) {
    void writer.set(db.doc(`enrollments/${w.classId}__${s}`), { studentId: s, classId: w.classId, schoolId: w.schoolId, status: "active", enrolledAt: Timestamp.now() });
  }
  void writer.set(db.doc(`enrollments/${w.classId}__${w.withdrawn}`), { studentId: w.withdrawn, classId: w.classId, schoolId: w.schoolId, status: "withdrawn", enrolledAt: Timestamp.now() });
  void writer.set(db.doc(`enrollments/${w.otherClassId}__${students[0]}`), { studentId: students[0], classId: w.otherClassId, schoolId: w.schoolId, status: "active", enrolledAt: Timestamp.now() });
  await writer.close();
  return w;
}

function req(w: World, uid: string, data: unknown, schoolId = w.schoolId, role = "teacher"): CallableRequest<unknown> {
  return { data, auth: { uid, token: { role, schoolId, districtId: w.districtId } } } as unknown as CallableRequest<unknown>;
}

const gid = (w: World, studentId: string, granteeUid: string, classId = w.classId) => `${classId}__${studentId}__${granteeUid}`;

async function grantDoc(grantId: string): Promise<Record<string, unknown> | undefined> {
  return (await db.doc(`studentSupportGrants/${grantId}`).get()).data();
}

async function auditsFor(grantIds: readonly string[]): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for (const grantId of grantIds) {
    const snap = await db.collection("auditEvents").where("targetId", "==", grantId).get();
    out.push(...snap.docs.map((doc) => doc.data()));
  }
  return out;
}

async function seedGrant(w: World, studentId: string, granteeUid: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const classId = (overrides.classId as string | undefined) ?? w.classId;
  const grantId = gid(w, studentId, granteeUid, classId);
  await db.doc(`studentSupportGrants/${grantId}`).set({
    classId,
    studentId,
    ownerTeacherId: w.owner,
    granteeUid,
    schoolId: w.schoolId,
    districtId: w.districtId,
    status: "active",
    grantedAt: Timestamp.fromMillis(1_000),
    grantedBy: w.owner,
    ...overrides,
  });
  return grantId;
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(PlatformError);
  expect((err as PlatformError).code).toBe(code);
}

d("supportAccess (emulator)", () => {
  afterEach(() => {
    mockAuditFailTarget = null;
  });

  describe("single grant and revoke", () => {
    it("grant, repeat, revoke, repeat, and re-grant behave as V1 with one audit per change", async () => {
      const w = await seedWorld();
      const [s0] = w.students as [string];
      const grantId = gid(w, s0, w.granteeA);
      const input = { classId: w.classId, studentId: s0, granteeEmail: ` ${emailOf(w.granteeA).toUpperCase()} ` };

      const first = await h.grant(req(w, w.owner, input));
      expect(first.outcome).toBe("shared");
      expect(first.grant).toEqual(expect.objectContaining({ grantId, classId: w.classId, studentId: s0, granteeEmail: emailOf(w.granteeA) }));
      expect(typeof first.grant.grantedAt).toBe("number");
      expect((await h.grant(req(w, w.owner, input))).outcome).toBe("alreadyShared");

      await expect(h.revoke(req(w, w.owner, { grantId }))).resolves.toEqual({ grantId, status: "revoked" });
      await expect(h.revoke(req(w, w.owner, { grantId }))).resolves.toEqual({ grantId, status: "revoked" });
      expect(await grantDoc(grantId)).toEqual(expect.objectContaining({ status: "revoked", revokedBy: w.owner }));

      expect((await h.grant(req(w, w.owner, input))).outcome).toBe("shared");
      const reactivated = await grantDoc(grantId);
      expect(reactivated).toEqual(expect.objectContaining({ status: "active", grantedBy: w.owner }));
      expect(reactivated).not.toHaveProperty("revokedAt");
      expect(reactivated).not.toHaveProperty("revokedBy");

      const audits = await auditsFor([grantId]);
      expect(audits.map((a) => a.action).sort()).toEqual(["supportAccess.granted", "supportAccess.granted", "supportAccess.revoked"]);
      for (const a of audits) {
        expect(a).toEqual(expect.objectContaining({ actorUserId: w.owner, targetType: "studentSupportGrant", schoolId: w.schoolId, districtId: w.districtId }));
        expect(a.payload).toEqual({ classId: w.classId, studentId: s0, granteeUid: w.granteeA });
      }
    });

    it("keeps V1 refusals: uniform recipient refusal, ownership, enrollment, another owner's revoke", async () => {
      const w = await seedWorld();
      const [s0] = w.students as [string];
      for (const uid of [w.farTeacher, w.inactiveTeacher, w.owner, s0, `nobody-${w.ns}`]) {
        await expectCode(h.grant(req(w, w.owner, { classId: w.classId, studentId: s0, granteeEmail: emailOf(uid) })), "supportAccess.granteeUnavailable");
      }
      await expectCode(h.grant(req(w, w.owner, { classId: w.otherClassId, studentId: s0, granteeEmail: emailOf(w.granteeA) })), "classes.forbidden");
      await expectCode(h.grant(req(w, w.owner, { classId: w.classId, studentId: w.withdrawn, granteeEmail: emailOf(w.granteeA) })), "supportAccess.studentNotEnrolled");
      const othersGrant = await seedGrant(w, s0, w.granteeA, { classId: w.otherClassId, ownerTeacherId: w.otherOwner });
      await expectCode(h.revoke(req(w, w.owner, { grantId: othersGrant })), "supportAccess.notFound");
      expect((await grantDoc(othersGrant))?.status).toBe("active");
      expect(await auditsFor([othersGrant, gid(w, s0, w.farTeacher)])).toHaveLength(0);
    });
  });

  describe("supportAccessGrantMany", () => {
    it("writes one independent grant and one audit event per student and recipient", async () => {
      const w = await seedWorld();
      const result = await h.grantMany(req(w, w.owner, { classId: w.classId, studentIds: w.students, granteeEmails: [emailOf(w.granteeA), emailOf(w.granteeB)] }));
      expect(result.summary).toEqual({ shared: 6, alreadyShared: 0, failed: 0 });
      const ids = w.students.flatMap((s) => [gid(w, s, w.granteeA), gid(w, s, w.granteeB)]);
      expect(result.results.map((r) => r.grantId)).toEqual(ids);
      for (const grantId of ids) {
        const record = await grantDoc(grantId);
        expect(Object.keys(record ?? {}).sort()).toEqual(
          ["classId", "districtId", "grantedAt", "grantedBy", "granteeUid", "ownerTeacherId", "schoolId", "status", "studentId"],
        );
        expect(record?.grantedAt).toBeInstanceOf(Timestamp);
      }
      const audits = await auditsFor(ids);
      expect(audits).toHaveLength(6);
      expect(audits.every((a) => a.action === "supportAccess.granted" && a.actorUserId === w.owner)).toBe(true);

      // Each grantee sees exactly their granted students, with the class block.
      const mine = await h.listMine(req(w, w.granteeA, {}));
      expect(mine.students.map((s) => s.studentId).sort()).toEqual([...w.students].sort());
      expect(mine.students.every((s) => s.classBlock === "B" && s.classId === w.classId)).toBe(true);
    });

    it("leaves active grants untouched, reactivates revoked ones, and is idempotent on retry", async () => {
      const w = await seedWorld();
      const [s0, s1] = w.students as [string, string];
      const active = await seedGrant(w, s0, w.granteeA);
      const revoked = await seedGrant(w, s1, w.granteeA, { status: "revoked", revokedAt: Timestamp.fromMillis(2_000), revokedBy: w.owner });
      const input = { classId: w.classId, studentIds: [s0, s1], granteeEmails: [emailOf(w.granteeA)] };

      const result = await h.grantMany(req(w, w.owner, input));
      expect(result.results.map((r) => r.outcome)).toEqual(["alreadyShared", "shared"]);
      expect(((await grantDoc(active))?.grantedAt as Timestamp).toMillis()).toBe(1_000);
      const reactivated = await grantDoc(revoked);
      expect(reactivated?.status).toBe("active");
      expect(reactivated).not.toHaveProperty("revokedAt");
      expect(await auditsFor([active])).toHaveLength(0);
      expect(await auditsFor([revoked])).toHaveLength(1);

      const retry = await h.grantMany(req(w, w.owner, input));
      expect(retry.summary).toEqual({ shared: 0, alreadyShared: 2, failed: 0 });
      expect(await auditsFor([active, revoked])).toHaveLength(1);
    });

    it("shares the valid pairs and reports invalid students and recipients without identifying accounts", async () => {
      const w = await seedWorld();
      const [s0] = w.students as [string];
      const refused = [w.farTeacher, w.inactiveTeacher, w.owner, s0, `nobody-${w.ns}`].map(emailOf);
      const result = await h.grantMany(req(w, w.owner, {
        classId: w.classId,
        studentIds: [s0, w.withdrawn, `ghost-${w.ns}`],
        granteeEmails: [emailOf(w.granteeA), ...refused, "not-an-email"],
      }));
      const by = new Map(result.results.map((r) => [`${r.studentId}|${r.granteeEmail}`, r]));
      expect(by.get(`${s0}|${emailOf(w.granteeA)}`)).toEqual(expect.objectContaining({ outcome: "shared" }));
      expect(by.get(`${w.withdrawn}|${emailOf(w.granteeA)}`)).toEqual(expect.objectContaining({ outcome: "failed", reason: "studentNotEnrolled" }));
      expect(by.get(`ghost-${w.ns}|${emailOf(w.granteeA)}`)).toEqual(expect.objectContaining({ outcome: "failed", reason: "studentNotEnrolled" }));
      for (const email of refused) {
        // Recipient failure takes priority over the withdrawn student, uniformly.
        for (const studentId of [s0, w.withdrawn]) {
          expect(by.get(`${studentId}|${email}`)).toEqual({ studentId, granteeEmail: email, outcome: "failed", grantId: null, granteeDisplayName: null, reason: "granteeUnavailable" });
        }
      }
      expect(by.get(`${s0}|not-an-email`)?.reason).toBe("invalidEmail");
      expect(result.summary).toEqual({ shared: 1, alreadyShared: 0, failed: 20 });
      const serialized = JSON.stringify(result);
      for (const uid of [w.farTeacher, w.inactiveTeacher, w.otherSchoolId]) {
        expect(serialized).not.toContain(`"${uid}"`);
        expect(serialized).not.toContain(`T ${uid}`);
      }
      const written = await db.collection("studentSupportGrants").where("classId", "==", w.classId).get();
      expect(written.docs.map((doc) => doc.id)).toEqual([gid(w, s0, w.granteeA)]);
    });

    it("refuses the whole request for a class the caller does not own, from another school, or not active", async () => {
      const w = await seedWorld();
      const input = { classId: w.classId, studentIds: w.students, granteeEmails: [emailOf(w.granteeB)] };
      await expectCode(h.grantMany(req(w, w.granteeA, input)), "classes.forbidden");
      await expectCode(h.grantMany(req(w, w.farTeacher, input, w.otherSchoolId)), "classes.forbidden");
      await expectCode(h.grantMany(req(w, w.owner, { ...input, classId: w.otherClassId })), "classes.forbidden");
      await db.doc(`classes/${w.classId}`).update({ status: "archived" });
      await expectCode(h.grantMany(req(w, w.owner, input)), "supportAccess.classNotActive");
      const written = await db.collection("studentSupportGrants").where("classId", "==", w.classId).get();
      expect(written.size).toBe(0);
    });

    it("rolls back a failed student's transaction entirely and reports only committed pairs as shared", async () => {
      const w = await seedWorld();
      const [s0, s1, s2] = w.students as [string, string, string];
      // The second write of s1's transaction throws after its first grant was
      // already queued with tx.set: both s1 grants must be absent.
      mockAuditFailTarget = gid(w, s1, w.granteeB);
      const result = await h.grantMany(req(w, w.owner, { classId: w.classId, studentIds: [s0, s1, s2], granteeEmails: [emailOf(w.granteeA), emailOf(w.granteeB)] }));
      expect(result.results.map((r) => [r.studentId, r.outcome, r.reason])).toEqual([
        [s0, "shared", null], [s0, "shared", null],
        [s1, "failed", "unavailable"], [s1, "failed", "unavailable"],
        [s2, "shared", null], [s2, "shared", null],
      ]);
      expect(await grantDoc(gid(w, s1, w.granteeA))).toBeUndefined();
      expect(await grantDoc(gid(w, s1, w.granteeB))).toBeUndefined();
      expect(await auditsFor([gid(w, s1, w.granteeA), gid(w, s1, w.granteeB)])).toHaveLength(0);
      // Every pair reported shared is really committed, with its audit event.
      for (const r of result.results.filter((x) => x.outcome === "shared")) {
        expect((await grantDoc(r.grantId!))?.status).toBe("active");
        expect(await auditsFor([r.grantId!])).toHaveLength(1);
      }

      mockAuditFailTarget = null;
      const retry = await h.grantMany(req(w, w.owner, { classId: w.classId, studentIds: [s0, s1, s2], granteeEmails: [emailOf(w.granteeA), emailOf(w.granteeB)] }));
      expect(retry.summary).toEqual({ shared: 2, alreadyShared: 4, failed: 0 });
    });

    it("concurrent overlapping bulk and single grants converge to one record and one event per pair", async () => {
      const w = await seedWorld();
      const [s0, s1] = w.students as [string, string];
      const emails = [emailOf(w.granteeA), emailOf(w.granteeB)];
      const calls = [
        ...Array.from({ length: 3 }, () => h.grantMany(req(w, w.owner, { classId: w.classId, studentIds: [s0, s1], granteeEmails: emails }))),
        h.grant(req(w, w.owner, { classId: w.classId, studentId: s0, granteeEmail: emails[0] })),
        h.grant(req(w, w.owner, { classId: w.classId, studentId: s1, granteeEmail: emails[1] })),
      ];
      const settled = await Promise.allSettled(calls);
      const ids = [gid(w, s0, w.granteeA), gid(w, s0, w.granteeB), gid(w, s1, w.granteeA), gid(w, s1, w.granteeB)];
      // Count every "shared" claim per grant id across all responses.
      const sharedClaims = new Map<string, number>(ids.map((id) => [id, 0]));
      for (const s of settled) {
        if (s.status !== "fulfilled") continue;
        const value = s.value as { results?: Array<{ grantId: string | null; outcome: string }>; grant?: { grantId: string }; outcome?: string };
        if (value.results) {
          for (const r of value.results) if (r.outcome === "shared" && r.grantId) sharedClaims.set(r.grantId, (sharedClaims.get(r.grantId) ?? 0) + 1);
        } else if (value.outcome === "shared" && value.grant) {
          sharedClaims.set(value.grant.grantId, (sharedClaims.get(value.grant.grantId) ?? 0) + 1);
        }
      }
      for (const grantId of ids) {
        const record = await grantDoc(grantId);
        const audits = await auditsFor([grantId]);
        // A pair may end unshared only if every call touching it failed.
        expect(audits.length).toBeLessThanOrEqual(1);
        expect(sharedClaims.get(grantId)).toBe(audits.length);
        if (audits.length === 1) expect(record?.status).toBe("active");
      }
    });
  });

  describe("supportAccessRevokeMany", () => {
    it("revokes the caller's grants, skips revoked ones, refuses another owner's, and denies the next read", async () => {
      const w = await seedWorld();
      const [s0, s1] = w.students as [string, string];
      const a = await seedGrant(w, s0, w.granteeA);
      const b = await seedGrant(w, s1, w.granteeA);
      const already = await seedGrant(w, s0, w.granteeB, { status: "revoked", revokedAt: Timestamp.fromMillis(3_000), revokedBy: w.owner });
      const others = await seedGrant(w, s0, w.granteeA, { classId: w.otherClassId, ownerTeacherId: w.otherOwner });
      const missing = gid(w, `ghost-${w.ns}`, w.granteeA);

      const result = await h.revokeMany(req(w, w.owner, { grantIds: [a, b, already, others, missing, a] }));
      expect(result.results).toEqual([
        { grantId: a, outcome: "revoked", reason: null },
        { grantId: b, outcome: "revoked", reason: null },
        { grantId: already, outcome: "alreadyRevoked", reason: null },
        { grantId: others, outcome: "failed", reason: "notFound" },
        { grantId: missing, outcome: "failed", reason: "notFound" },
      ]);
      expect((await grantDoc(a))).toEqual(expect.objectContaining({ status: "revoked", revokedBy: w.owner }));
      expect(((await grantDoc(already))?.revokedAt as Timestamp).toMillis()).toBe(3_000);
      expect(await grantDoc(others)).toEqual(expect.objectContaining({ status: "active", ownerTeacherId: w.otherOwner }));
      expect(await grantDoc(missing)).toBeUndefined();
      const audits = await auditsFor([a, b, already, others, missing]);
      expect(audits.map((x) => [x.action, x.targetId]).sort()).toEqual([["supportAccess.revoked", a], ["supportAccess.revoked", b]]);

      expect((await h.listMine(req(w, w.granteeA, {}))).students.map((s) => s.grantId)).toEqual([others]);

      const retry = await h.revokeMany(req(w, w.owner, { grantIds: [a, b] }));
      expect(retry.summary).toEqual({ revoked: 0, alreadyRevoked: 2, failed: 0 });
      expect(await auditsFor([a, b])).toHaveLength(2);
    });

    it("gives a grantee or another teacher only notFound and changes nothing", async () => {
      const w = await seedWorld();
      const [s0] = w.students as [string];
      const a = await seedGrant(w, s0, w.granteeA);
      for (const uid of [w.granteeA, w.otherOwner]) {
        const result = await h.revokeMany(req(w, uid, { grantIds: [a] }));
        expect(result.results).toEqual([{ grantId: a, outcome: "failed", reason: "notFound" }]);
      }
      const far = await h.revokeMany(req(w, w.farTeacher, { grantIds: [a] }, w.otherSchoolId));
      expect(far.results).toEqual([{ grantId: a, outcome: "failed", reason: "notFound" }]);
      expect((await grantDoc(a))?.status).toBe("active");
      expect(await auditsFor([a])).toHaveLength(0);
    });

    it("rolls back a failed chunk entirely and never reports its grants as revoked", async () => {
      const w = await seedWorld({ students: 1 });
      const ids: string[] = [];
      for (let i = 0; i < 60; i += 1) ids.push(await seedGrant(w, `bulk-${i}-${w.ns}`, w.granteeA));
      // Fail inside the second chunk (grants 50-59) after earlier updates were queued.
      mockAuditFailTarget = ids[55]!;
      const result = await h.revokeMany(req(w, w.owner, { grantIds: ids }));
      expect(result.summary).toEqual({ revoked: 50, alreadyRevoked: 0, failed: 10 });
      for (const [i, grantId] of ids.entries()) {
        const status = (await grantDoc(grantId))?.status;
        expect([i, status]).toEqual([i, i < 50 ? "revoked" : "active"]);
      }
      expect(result.results.slice(50).every((r) => r.outcome === "failed" && r.reason === "unavailable")).toBe(true);
      expect(await auditsFor(ids.slice(50))).toHaveLength(0);
    });
  });

  describe("server-side limits and worst-case timing", () => {
    it("rejects over-cap requests before any write", async () => {
      const w = await seedWorld();
      const tooManyStudents = Array.from({ length: 41 }, (_, i) => `s${i}`);
      await expectCode(h.grantMany(req(w, w.owner, { classId: w.classId, studentIds: tooManyStudents, granteeEmails: [emailOf(w.granteeA)] })), "supportAccess.invalidRequest");
      await expectCode(h.grantMany(req(w, w.owner, { classId: w.classId, studentIds: w.students, granteeEmails: Array.from({ length: 11 }, (_, i) => `t${i}@emu.test`) })), "supportAccess.invalidRequest");
      await expectCode(h.revokeMany(req(w, w.owner, { grantIds: Array.from({ length: 201 }, (_, i) => `${w.classId}__s${i}__${w.granteeA}`) })), "supportAccess.invalidRequest");
      const written = await db.collection("studentSupportGrants").where("classId", "==", w.classId).get();
      expect(written.size).toBe(0);
    });

    it("measures 40 students x 10 recipients (400 new grants) and 200 revocations", async () => {
      const w = await seedWorld({ students: 40, extraTeachers: 8 });
      const recipients = [w.granteeA, w.granteeB, ...w.extraTeachers];
      expect(recipients).toHaveLength(10);

      const t0 = Date.now();
      const granted = await h.grantMany(req(w, w.owner, { classId: w.classId, studentIds: w.students, granteeEmails: recipients.map(emailOf) }));
      const grantMs = Date.now() - t0;
      expect(granted.summary).toEqual({ shared: 400, alreadyShared: 0, failed: 0 });

      const t1 = Date.now();
      const repeat = await h.grantMany(req(w, w.owner, { classId: w.classId, studentIds: w.students, granteeEmails: recipients.map(emailOf) }));
      const repeatMs = Date.now() - t1;
      expect(repeat.summary).toEqual({ shared: 0, alreadyShared: 400, failed: 0 });

      const revokeIds = granted.results.slice(0, 200).map((r) => r.grantId!);
      const t2 = Date.now();
      const revoked = await h.revokeMany(req(w, w.owner, { grantIds: revokeIds }));
      const revokeMs = Date.now() - t2;
      expect(revoked.summary).toEqual({ revoked: 200, alreadyRevoked: 0, failed: 0 });
      expect(await auditsFor(revokeIds.slice(0, 5))).toHaveLength(10);

      // Emulator timings (local, no network latency); reported, not asserted.
      // eslint-disable-next-line no-console
      console.log(`SUPPORT_ACCESS_TIMING grantMany400=${grantMs}ms grantMany400repeat=${repeatMs}ms revokeMany200=${revokeMs}ms`);
    }, 120_000);
  });
});
