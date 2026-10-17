// Grade Improvements V1 emulator-backed proofs.
//
// Runs against the REAL Firestore emulator (`npm run test:emulator`, offline
// `demo-bootstrap` project): real `requireDistrictContext` reads, real
// transactions, `create` semantics, and contention. Every record is synthetic
// emulator data. Skips when the emulator host is absent.

import { getApps, initializeApp } from "firebase-admin/app";
import { DocumentReference, Timestamp, Transaction, getFirestore } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";

import { __gradeImprovementHandlers as h } from "./callables";

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
  readonly districtId: string;
  readonly classId: string;
  readonly otherClassId: string;
  readonly teacher: string;
  readonly otherTeacher: string;
  readonly studentA: string;
  readonly studentB: string;
  readonly assignmentId: string;
  readonly reassignmentId: string;
  readonly otherAssignmentId: string;
};

async function seedWorld(): Promise<World> {
  const ns = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const w: World = {
    ns,
    schoolId: `school-${ns}`,
    districtId: `district-${ns}`,
    classId: `class-${ns}`,
    otherClassId: `class-other-${ns}`,
    teacher: `teacher-${ns}`,
    otherTeacher: `teacher-other-${ns}`,
    studentA: `student-a-${ns}`,
    studentB: `student-b-${ns}`,
    assignmentId: `asg-${ns}`,
    reassignmentId: `asg-re-${ns}`,
    otherAssignmentId: `asg-other-${ns}`,
  };
  const batch = db.batch();
  batch.set(db.doc(`schools/${w.schoolId}`), { districtId: w.districtId, name: "Emulator School" });
  for (const t of [w.teacher, w.otherTeacher]) {
    batch.set(db.doc(`users/${t}`), { status: "active", role: "teacher", schoolId: w.schoolId });
  }
  for (const s of [w.studentA, w.studentB]) {
    batch.set(db.doc(`users/${s}`), { status: "active", role: "student", schoolId: w.schoolId });
  }
  batch.set(db.doc(`classes/${w.classId}`), { teacherId: w.teacher, schoolId: w.schoolId, title: "Class" });
  batch.set(db.doc(`classes/${w.otherClassId}`), { teacherId: w.otherTeacher, schoolId: w.schoolId, title: "Other" });
  for (const [id, classId, teacherId] of [
    [w.assignmentId, w.classId, w.teacher],
    [w.reassignmentId, w.classId, w.teacher],
    [w.otherAssignmentId, w.otherClassId, w.otherTeacher],
  ] as const) {
    batch.set(db.doc(`assignments/${id}`), {
      classId,
      teacherId,
      schoolId: w.schoolId,
      lessonSlug: "lesson_g7_earths-layers",
      status: "published",
      createdAt: Timestamp.now(),
    });
  }
  await batch.commit();
  return w;
}

let attemptCounter = 0;
async function seedAttempt(
  w: World,
  studentId: string,
  attemptNumber: number,
  percentage: number,
  assignmentId = w.assignmentId,
): Promise<string> {
  attemptCounter += 1;
  const id = `att-${w.ns}-${attemptCounter}`;
  const own = assignmentId === w.otherAssignmentId;
  await db.doc(`attempts/${id}`).set({
    studentId,
    assignmentId,
    classId: own ? w.otherClassId : w.classId,
    teacherId: own ? w.otherTeacher : w.teacher,
    schoolId: w.schoolId,
    districtId: w.districtId,
    attemptNumber,
    percentage,
    score: percentage / 10,
    maxScore: 10,
    submittedAt: Timestamp.fromMillis(1_700_000_000_000 + attemptCounter * 1000),
    status: "completed",
  });
  return id;
}

function req(w: World, uid: string, data: unknown, role = "teacher"): CallableRequest<unknown> {
  return {
    data,
    auth: { uid, token: { role, schoolId: w.schoolId, districtId: w.districtId } },
  } as unknown as CallableRequest<unknown>;
}

async function pendingFor(w: World, studentId: string, assignmentId = w.assignmentId) {
  const res = await h.listForAssignment(req(w, w.teacher, { assignmentId }));
  return res.improvements.find((i) => i.studentId === studentId) ?? null;
}

async function eventDocs(w: World, studentId: string, assignmentId = w.assignmentId) {
  const snap = await db.collection(`gradeImprovementAcks/${assignmentId}__${studentId}/events`).get();
  type EventDoc = Record<string, unknown> & { id: string };
  return snap.docs
    .map((doc): EventDoc => ({ ...doc.data(), id: doc.id }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

d("Grade Improvements (emulator)", () => {
  let w: World;
  beforeEach(async () => {
    w = await seedWorld();
  });

  describe("detection on Assignment Detail", () => {
    it("first attempt alone is not pending; a higher retake is", async () => {
      await seedAttempt(w, w.studentA, 1, 60);
      expect(await pendingFor(w, w.studentA)).toBeNull();
      const t2 = await seedAttempt(w, w.studentA, 2, 70);
      expect(await pendingFor(w, w.studentA)).toMatchObject({
        baselinePercentage: 60,
        baselineSource: "firstAttempt",
        bestPercentage: 70,
        bestAttemptId: t2,
      });
    });

    it("lower and equal retakes are not pending", async () => {
      await seedAttempt(w, w.studentA, 1, 80);
      await seedAttempt(w, w.studentA, 2, 70);
      await seedAttempt(w, w.studentA, 3, 80);
      expect(await pendingFor(w, w.studentA)).toBeNull();
    });

    it("reassigned occurrences stay separate", async () => {
      await seedAttempt(w, w.studentA, 1, 60, w.assignmentId);
      await seedAttempt(w, w.studentA, 1, 90, w.reassignmentId);
      // 60 on one occurrence and 90 on the other is not an improvement on either.
      expect(await pendingFor(w, w.studentA, w.assignmentId)).toBeNull();
      expect(await pendingFor(w, w.studentA, w.reassignmentId)).toBeNull();
      await seedAttempt(w, w.studentA, 2, 95, w.reassignmentId);
      expect(await pendingFor(w, w.studentA, w.reassignmentId)).toMatchObject({ baselinePercentage: 90, bestPercentage: 95 });
      expect(await pendingFor(w, w.studentA, w.assignmentId)).toBeNull();
    });

    it("drops attempts whose frozen ownership disagrees with the assignment", async () => {
      await seedAttempt(w, w.studentA, 1, 60);
      await db.doc(`attempts/forged-${w.ns}`).set({
        studentId: w.studentA,
        assignmentId: w.assignmentId,
        classId: w.otherClassId,
        teacherId: w.teacher,
        schoolId: w.schoolId,
        districtId: w.districtId,
        attemptNumber: 2,
        percentage: 100,
        score: 10,
        maxScore: 10,
        submittedAt: Timestamp.now(),
      });
      expect(await pendingFor(w, w.studentA)).toBeNull();
    });
  });

  describe("acknowledgment", () => {
    it("acknowledges the exact displayed score, persists it, and records history", async () => {
      await seedAttempt(w, w.studentA, 1, 60);
      await seedAttempt(w, w.studentA, 2, 70);
      const t3 = await seedAttempt(w, w.studentA, 3, 90);
      const pending = await pendingFor(w, w.studentA);
      expect(pending).toMatchObject({ baselinePercentage: 60, bestPercentage: 90 });

      const res = await h.acknowledge(
        req(w, w.teacher, { assignmentId: w.assignmentId, studentId: w.studentA, attemptId: t3, percentage: 90 }),
      );
      expect(res.status).toBe("acknowledged");
      expect(res.pending).toBeNull();
      expect(res.history.effective).toMatchObject({ eventId: "e000001", attemptId: t3, percentage: 90 });

      // Persisted: a fresh read (another session/device) sees no pending state.
      expect(await pendingFor(w, w.studentA)).toBeNull();
      const events = await eventDocs(w, w.studentA);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "acknowledged",
        actorTeacherId: w.teacher,
        studentId: w.studentA,
        classId: w.classId,
        assignmentId: w.assignmentId,
        percentage: 90,
        baselinePercentage: 60,
        attemptId: t3,
      });
      expect(events[0].createdAt).toBeInstanceOf(Timestamp);
    });

    it("a duplicate confirmation is idempotent", async () => {
      await seedAttempt(w, w.studentA, 1, 60);
      const t2 = await seedAttempt(w, w.studentA, 2, 90);
      const input = { assignmentId: w.assignmentId, studentId: w.studentA, attemptId: t2, percentage: 90 };
      expect((await h.acknowledge(req(w, w.teacher, input))).status).toBe("acknowledged");
      expect((await h.acknowledge(req(w, w.teacher, input))).status).toBe("alreadyAcknowledged");
      expect(await eventDocs(w, w.studentA)).toHaveLength(1);
    });

    it("concurrent confirmations write exactly one event", async () => {
      await seedAttempt(w, w.studentA, 1, 60);
      const t2 = await seedAttempt(w, w.studentA, 2, 90);
      const input = { assignmentId: w.assignmentId, studentId: w.studentA, attemptId: t2, percentage: 90 };
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => h.acknowledge(req(w, w.teacher, input))),
      );
      const statuses = results.map((r) => (r.status === "fulfilled" ? r.value.status : "rejected"));
      expect(statuses.filter((s) => s === "acknowledged")).toHaveLength(1);
      for (const s of statuses) expect(["acknowledged", "alreadyAcknowledged", "rejected"]).toContain(s);
      expect(await eventDocs(w, w.studentA)).toHaveLength(1);
    });

    it("a new improvement after acknowledgment appears again", async () => {
      await seedAttempt(w, w.studentA, 1, 60);
      const t2 = await seedAttempt(w, w.studentA, 2, 90);
      await h.acknowledge(req(w, w.teacher, { assignmentId: w.assignmentId, studentId: w.studentA, attemptId: t2, percentage: 90 }));
      const t3 = await seedAttempt(w, w.studentA, 3, 100);
      expect(await pendingFor(w, w.studentA)).toMatchObject({
        baselinePercentage: 90,
        baselineSource: "acknowledged",
        bestPercentage: 100,
        bestAttemptId: t3,
      });
    });

    it("a stale confirmation cannot dismiss a newer improvement", async () => {
      await seedAttempt(w, w.studentA, 1, 60);
      const t2 = await seedAttempt(w, w.studentA, 2, 70);
      // Teacher opened the dialog for 70%; the student then scores 90%.
      const t3 = await seedAttempt(w, w.studentA, 3, 90);
      await expect(
        h.acknowledge(req(w, w.teacher, { assignmentId: w.assignmentId, studentId: w.studentA, attemptId: t2, percentage: 70 })),
      ).rejects.toMatchObject({ code: "gradeImprovements.stale" });
      expect(await eventDocs(w, w.studentA)).toHaveLength(0);
      expect(await pendingFor(w, w.studentA)).toMatchObject({ bestPercentage: 90, bestAttemptId: t3 });
    });

    it("refuses a percentage that does not match the best attempt", async () => {
      await seedAttempt(w, w.studentA, 1, 60);
      const t2 = await seedAttempt(w, w.studentA, 2, 90);
      await expect(
        h.acknowledge(req(w, w.teacher, { assignmentId: w.assignmentId, studentId: w.studentA, attemptId: t2, percentage: 95 })),
      ).rejects.toMatchObject({ code: "gradeImprovements.stale" });
    });

    it("refuses when nothing is pending", async () => {
      const t1 = await seedAttempt(w, w.studentA, 1, 60);
      await expect(
        h.acknowledge(req(w, w.teacher, { assignmentId: w.assignmentId, studentId: w.studentA, attemptId: t1, percentage: 60 })),
      ).rejects.toMatchObject({ code: "gradeImprovements.stale" });
    });
  });

  describe("reversal", () => {
    async function ackBest(studentId: string, attemptId: string, percentage: number) {
      return h.acknowledge(req(w, w.teacher, { assignmentId: w.assignmentId, studentId, attemptId, percentage }));
    }

    it("undo restores the pending state and keeps the original event", async () => {
      await seedAttempt(w, w.studentA, 1, 60);
      const t2 = await seedAttempt(w, w.studentA, 2, 90);
      await ackBest(w.studentA, t2, 90);
      const res = await h.reverse(req(w, w.teacher, { assignmentId: w.assignmentId, studentId: w.studentA, eventId: "e000001" }));
      expect(res.status).toBe("reversed");
      expect(res.history.effective).toBeNull();
      expect(res.pending).toMatchObject({ baselinePercentage: 60, bestPercentage: 90 });
      expect(await pendingFor(w, w.studentA)).toMatchObject({ baselinePercentage: 60, bestPercentage: 90 });
      const events = await eventDocs(w, w.studentA);
      expect(events.map((e) => e.type)).toEqual(["acknowledged", "reversed"]);
      expect(events[1]).toMatchObject({ targetEventId: "e000001", percentage: 90, attemptId: t2 });
      // Attempts are untouched.
      const attempts = await db.collection("attempts").where("assignmentId", "==", w.assignmentId).get();
      expect(attempts.size).toBe(2);
    });

    it("duplicate undo is idempotent", async () => {
      await seedAttempt(w, w.studentA, 1, 60);
      const t2 = await seedAttempt(w, w.studentA, 2, 90);
      await ackBest(w.studentA, t2, 90);
      const input = { assignmentId: w.assignmentId, studentId: w.studentA, eventId: "e000001" };
      expect((await h.reverse(req(w, w.teacher, input))).status).toBe("reversed");
      expect((await h.reverse(req(w, w.teacher, input))).status).toBe("alreadyReversed");
      expect(await eventDocs(w, w.studentA)).toHaveLength(2);
    });

    it("undoing the newest acknowledgment falls back to the earlier one", async () => {
      await seedAttempt(w, w.studentA, 1, 60);
      const t2 = await seedAttempt(w, w.studentA, 2, 90);
      await ackBest(w.studentA, t2, 90);
      const t3 = await seedAttempt(w, w.studentA, 3, 100);
      await ackBest(w.studentA, t3, 100);
      const res = await h.reverse(req(w, w.teacher, { assignmentId: w.assignmentId, studentId: w.studentA, eventId: "e000002" }));
      expect(res.history.effective).toMatchObject({ eventId: "e000001", percentage: 90 });
      expect(res.pending).toMatchObject({ baselinePercentage: 90, baselineSource: "acknowledged", bestPercentage: 100 });
    });

    it("a stale undo of an older acknowledgment cannot erase a later one", async () => {
      await seedAttempt(w, w.studentA, 1, 60);
      const t2 = await seedAttempt(w, w.studentA, 2, 90);
      await ackBest(w.studentA, t2, 90);
      const t3 = await seedAttempt(w, w.studentA, 3, 100);
      await ackBest(w.studentA, t3, 100);
      await expect(
        h.reverse(req(w, w.teacher, { assignmentId: w.assignmentId, studentId: w.studentA, eventId: "e000001" })),
      ).rejects.toMatchObject({ code: "gradeImprovements.stale" });
      expect(await eventDocs(w, w.studentA)).toHaveLength(2);
      expect(await pendingFor(w, w.studentA)).toBeNull();
    });

    it("re-acknowledging after undo appends; history is never rewritten", async () => {
      await seedAttempt(w, w.studentA, 1, 60);
      const t2 = await seedAttempt(w, w.studentA, 2, 90);
      await ackBest(w.studentA, t2, 90);
      await h.reverse(req(w, w.teacher, { assignmentId: w.assignmentId, studentId: w.studentA, eventId: "e000001" }));
      const res = await ackBest(w.studentA, t2, 90);
      expect(res.status).toBe("acknowledged");
      expect(res.history.effective?.eventId).toBe("e000003");
      expect(res.history.events.map((e) => e.eventId)).toEqual(["e000003", "e000002", "e000001"]);
    });

    it("Student Detail history lists events newest first, scoped to the class", async () => {
      await seedAttempt(w, w.studentA, 1, 60);
      const t2 = await seedAttempt(w, w.studentA, 2, 90);
      await ackBest(w.studentA, t2, 90);
      await h.reverse(req(w, w.teacher, { assignmentId: w.assignmentId, studentId: w.studentA, eventId: "e000001" }));
      const res = await h.listForStudent(req(w, w.teacher, { classId: w.classId, studentId: w.studentA }));
      expect(res.records).toHaveLength(1);
      expect(res.records[0].effective).toBeNull();
      expect(res.records[0].events.map((e) => [e.eventId, e.type, e.byCaller])).toEqual([
        ["e000002", "reversed", true],
        ["e000001", "acknowledged", true],
      ]);
      expect(typeof res.records[0].events[0].createdAt).toBe("number");
      const empty = await h.listForStudent(req(w, w.teacher, { classId: w.classId, studentId: w.studentB }));
      expect(empty.records).toEqual([]);
    });
  });

  describe("certification corrections", () => {
    it("acknowledge returns the persisted server timestamp, matching a reload", async () => {
      await seedAttempt(w, w.studentA, 1, 60);
      const t2 = await seedAttempt(w, w.studentA, 2, 90);
      const before = Date.now();
      const res = await h.acknowledge(
        req(w, w.teacher, { assignmentId: w.assignmentId, studentId: w.studentA, attemptId: t2, percentage: 90 }),
      );
      const created = res.history.events[0];
      expect(created.eventId).toBe("e000001");
      expect(typeof created.createdAt).toBe("number");
      expect(created.createdAt!).toBeGreaterThan(before - 60_000);
      const stored = await eventDocs(w, w.studentA);
      expect(created.createdAt).toBe((stored[0].createdAt as Timestamp).toMillis());
      const reload = await h.listForStudent(req(w, w.teacher, { classId: w.classId, studentId: w.studentA }));
      expect(reload.records[0].events[0].createdAt).toBe(created.createdAt);
    });

    it("reverse returns the persisted server timestamp, matching a reload", async () => {
      await seedAttempt(w, w.studentA, 1, 60);
      const t2 = await seedAttempt(w, w.studentA, 2, 90);
      await h.acknowledge(req(w, w.teacher, { assignmentId: w.assignmentId, studentId: w.studentA, attemptId: t2, percentage: 90 }));
      const res = await h.reverse(req(w, w.teacher, { assignmentId: w.assignmentId, studentId: w.studentA, eventId: "e000001" }));
      expect(res.history.events.map((e) => e.eventId)).toEqual(["e000002", "e000001"]);
      for (const e of res.history.events) expect(typeof e.createdAt).toBe("number");
      const stored = await eventDocs(w, w.studentA);
      expect(res.history.events[0].createdAt).toBe((stored[1].createdAt as Timestamp).toMillis());
      const reload = await h.listForStudent(req(w, w.teacher, { classId: w.classId, studentId: w.studentA }));
      expect(reload.records[0].events.map((e) => e.createdAt)).toEqual(res.history.events.map((e) => e.createdAt));
    });

    it("an unreadable post-commit event still reports the committed success, with no second write", async () => {
      await seedAttempt(w, w.studentA, 1, 60);
      const t2 = await seedAttempt(w, w.studentA, 2, 90);
      const realGet = DocumentReference.prototype.get;
      const spy = jest.spyOn(DocumentReference.prototype, "get").mockImplementation(function (this: DocumentReference) {
        if (this.path.includes("/events/")) return Promise.reject(new Error("read failed"));
        return realGet.call(this) as never;
      });
      try {
        const res = await h.acknowledge(
          req(w, w.teacher, { assignmentId: w.assignmentId, studentId: w.studentA, attemptId: t2, percentage: 90 }),
        );
        expect(res.status).toBe("acknowledged");
        expect(res.history.events[0].createdAt).toBeNull();
      } finally {
        spy.mockRestore();
      }
      expect(await eventDocs(w, w.studentA)).toHaveLength(1);
      expect(await pendingFor(w, w.studentA)).toBeNull();
    });

    it("the transaction reads only the target student's attempts on the assignment", async () => {
      await seedAttempt(w, w.studentA, 1, 60);
      const t2 = await seedAttempt(w, w.studentA, 2, 90);
      // Another student on the same assignment with a higher score.
      await seedAttempt(w, w.studentB, 1, 50);
      await seedAttempt(w, w.studentB, 2, 100);
      // Same student on another occurrence.
      await seedAttempt(w, w.studentA, 1, 99, w.reassignmentId);
      const attemptRows: Array<{ studentId: unknown; assignmentId: unknown }> = [];
      const realGet = Transaction.prototype.get;
      const wrapped = async function (this: Transaction, ref: unknown): Promise<unknown> {
        const out = (await (realGet as (r: unknown) => Promise<unknown>).call(this, ref)) as {
          docs?: Array<{ ref: { parent: { id: string } }; data: () => Record<string, unknown> }>;
        };
        for (const d of out.docs ?? []) {
          if (d.ref.parent.id === "attempts") attemptRows.push({ studentId: d.data().studentId, assignmentId: d.data().assignmentId });
        }
        return out;
      };
      const spy = jest.spyOn(Transaction.prototype, "get").mockImplementation(wrapped as never);
      try {
        const res = await h.acknowledge(
          req(w, w.teacher, { assignmentId: w.assignmentId, studentId: w.studentA, attemptId: t2, percentage: 90 }),
        );
        expect(res.status).toBe("acknowledged");
      } finally {
        spy.mockRestore();
      }
      expect(attemptRows).toHaveLength(2);
      for (const row of attemptRows) {
        expect(row).toEqual({ studentId: w.studentA, assignmentId: w.assignmentId });
      }
      // Student B is unaffected and still pending at their own best.
      expect(await pendingFor(w, w.studentB)).toMatchObject({ baselinePercentage: 50, bestPercentage: 100 });
    });
  });

  describe("authorization", () => {
    it("denies unauthenticated callers", async () => {
      const unauth = { data: { assignmentId: w.assignmentId }, auth: undefined } as unknown as CallableRequest<unknown>;
      await expect(h.listForAssignment(unauth)).rejects.toMatchObject({ code: "unauthenticated" });
      await expect(h.acknowledge(unauth)).rejects.toMatchObject({ code: "unauthenticated" });
      await expect(h.reverse(unauth)).rejects.toMatchObject({ code: "unauthenticated" });
      await expect(h.listForStudent(unauth)).rejects.toMatchObject({ code: "unauthenticated" });
    });

    it("denies students", async () => {
      await expect(
        h.listForAssignment(req(w, w.studentA, { assignmentId: w.assignmentId }, "student")),
      ).rejects.toMatchObject({ code: "role-forbidden" });
    });

    it("denies another teacher on every callable", async () => {
      await seedAttempt(w, w.studentA, 1, 60);
      const t2 = await seedAttempt(w, w.studentA, 2, 90);
      await expect(h.listForAssignment(req(w, w.otherTeacher, { assignmentId: w.assignmentId }))).rejects.toMatchObject({
        code: "assignments.forbidden",
      });
      await expect(
        h.acknowledge(req(w, w.otherTeacher, { assignmentId: w.assignmentId, studentId: w.studentA, attemptId: t2, percentage: 90 })),
      ).rejects.toMatchObject({ code: "assignments.forbidden" });
      await expect(
        h.reverse(req(w, w.otherTeacher, { assignmentId: w.assignmentId, studentId: w.studentA, eventId: "e000001" })),
      ).rejects.toMatchObject({ code: "assignments.forbidden" });
      await expect(
        h.listForStudent(req(w, w.otherTeacher, { classId: w.classId, studentId: w.studentA })),
      ).rejects.toMatchObject({ code: "classes.forbidden" });
      expect(await eventDocs(w, w.studentA)).toHaveLength(0);
    });

    it("refuses client-supplied ownership fields", async () => {
      for (const key of ["teacherId", "schoolId", "districtId", "classId", "uid"]) {
        await expect(
          h.acknowledge(
            req(w, w.teacher, { assignmentId: w.assignmentId, studentId: w.studentA, attemptId: "x", percentage: 1, [key]: "forged" }),
          ),
        ).rejects.toMatchObject({ code: "gradeImprovements.invalidRequest" });
      }
    });

    it("refuses cross-student manipulation (attempt belongs to another student)", async () => {
      await seedAttempt(w, w.studentA, 1, 60);
      const a2 = await seedAttempt(w, w.studentA, 2, 90);
      await seedAttempt(w, w.studentB, 1, 50);
      await expect(
        h.acknowledge(req(w, w.teacher, { assignmentId: w.assignmentId, studentId: w.studentB, attemptId: a2, percentage: 90 })),
      ).rejects.toMatchObject({ code: "gradeImprovements.stale" });
      expect(await eventDocs(w, w.studentB)).toHaveLength(0);
      expect(await pendingFor(w, w.studentA)).toMatchObject({ bestAttemptId: a2 });
    });

    it("refuses cross-class manipulation (student with no attempt on the assignment)", async () => {
      const other = await seedAttempt(w, w.studentB, 1, 50, w.otherAssignmentId);
      await expect(
        h.acknowledge(req(w, w.teacher, { assignmentId: w.assignmentId, studentId: w.studentB, attemptId: other, percentage: 50 })),
      ).rejects.toMatchObject({ code: "gradeImprovements.notFound" });
    });
  });
});
