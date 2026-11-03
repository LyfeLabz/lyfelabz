// Real Firestore lifecycle coverage for the additive begin written-response
// contract. Uses the existing direct-handler seams, with no handler, auth-helper,
// persistence, transaction, or Classroom transport mocks. Synthetic ungraded
// assignments keep the real passback engine on its no-provider-work path.
import { getApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";

import { deployAssessmentRevision } from "./assessment-deployment";
import { __assessmentAttemptsFinalizeHandler as finalize } from "./assessment-attempts-finalize";
import { __assessmentSessionsAutosaveHandler as autosave } from "./assessment-sessions-autosave";
import { __assessmentSessionsBeginHandler as begin } from "./assessment-sessions-begin";

const PROJECT = "demo-bootstrap";
const host = process.env.FIRESTORE_EMULATOR_HOST;
const hasEmulator = !!host;
const describeEmulator = hasEmulator ? describe : describe.skip;

if (hasEmulator) {
  if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host)) {
    throw new Error("Lifecycle tests require a loopback Firestore emulator.");
  }
  for (const project of [process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT]) {
    if (project !== undefined && project !== PROJECT) {
      throw new Error(`Refusing lifecycle tests for project "${project}"; expected ${PROJECT}.`);
    }
  }
  let app;
  try {
    app = getApp();
  } catch {
    app = initializeApp({ projectId: PROJECT });
  }
  if (app.options.projectId !== PROJECT) {
    throw new Error("Lifecycle tests require the demo project's default Admin app.");
  }
}
const db = hasEmulator ? getFirestore() : (undefined as never);

type World = {
  assignmentId: string;
  classId: string;
  schoolId: string;
  districtId: string;
  student: string;
  otherStudent: string;
};

async function seedWorld(): Promise<World> {
  const ns = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const w: World = {
    assignmentId: `assignment-${ns}`,
    classId: `class-${ns}`,
    schoolId: `school-${ns}`,
    districtId: `district-${ns}`,
    student: `student-${ns}`,
    otherStudent: `other-${ns}`,
  };
  const lessonSlug = `autosave-${ns}`;
  const deployed = await deployAssessmentRevision({
    activityId: lessonSlug,
    revisionOrdinal: 1,
    itemOrderingRule: "authoredOrder",
    schemaVersion: 1,
    publishedBy: "emulator-lifecycle",
    items: Array.from({ length: 10 }, (_, i) => ({
      itemId: `q${String(i + 1)}`,
      itemType: "singleChoice" as const,
      stem: `Question ${String(i + 1)}?`,
      options: [
        { optionId: "A", text: "One" },
        { optionId: "B", text: "Two" },
      ],
      points: 1 as const,
      correctOptionId: "A",
      explanation: "One is correct.",
    })),
  });
  const batch = db.batch();
  batch.set(db.doc(`schools/${w.schoolId}`), { districtId: w.districtId });
  for (const uid of [w.student, w.otherStudent]) {
    batch.set(db.doc(`users/${uid}`), {
      status: "active", role: "student", schoolId: w.schoolId,
    });
    batch.set(db.doc(`enrollments/${w.classId}__${uid}`), {
      studentId: uid, classId: w.classId, schoolId: w.schoolId, status: "active",
    });
  }
  batch.set(db.doc(`assignments/${w.assignmentId}`), {
    classId: w.classId,
    teacherId: `teacher-${ns}`,
    schoolId: w.schoolId,
    lessonSlug,
    assessmentRevisionId: deployed.revisionId,
    mode: "classroom",
    status: "published",
    classroomGrading: { mode: "ungraded" },
    createdAt: Timestamp.now(),
  });
  await batch.commit();
  return w;
}

function req(w: World, data: unknown, uid = w.student): CallableRequest<unknown> {
  return {
    data,
    auth: { uid, token: { role: "student", schoolId: w.schoolId, districtId: w.districtId } },
  } as unknown as CallableRequest<unknown>;
}

const RESPONSES = Array.from({ length: 10 }, (_, i) => ({
  itemId: `q${String(i + 1)}`, response: "A",
}));

async function replayUnchanged(w: World, sessionId: string) {
  const ref = db.doc(`assessmentSessions/${sessionId}`);
  const before = await ref.get();
  const replay = await begin(req(w, { assignmentId: w.assignmentId }));
  const after = await ref.get();
  expect(replay).toMatchObject({ sessionId, alreadyLive: true, responses: RESPONSES });
  expect(after.data()).toEqual(before.data());
  expect(after.updateTime?.isEqual(before.updateTime!)).toBe(true);
  return replay;
}

describeEmulator("assessment written-response lifecycle (real Firestore emulator)", () => {
  afterAll(async () => {
    if (hasEmulator) await db.terminate();
  });

  it("saves, restores without a write, finalizes, and keeps completed text isolated from a retake", async () => {
    const w = await seedWorld();
    const text = "Density compares mass to volume.";
    const started = await begin(req(w, { assignmentId: w.assignmentId }));
    expect(started.alreadyLive).toBe(false);
    expect(started).not.toHaveProperty("writtenResponse");
    const saved = await autosave(req(w, {
      sessionId: started.sessionId, responses: RESPONSES, writtenResponse: `  ${text}\n`,
    }));
    expect(saved.persisted).toBe(true);
    expect((await db.doc(`assessmentSessions/${started.sessionId}`).get()).get("writtenResponse")).toBe(text);
    expect(await replayUnchanged(w, started.sessionId)).toHaveProperty("writtenResponse", text);

    const finalized = await finalize(req(w, { sessionId: started.sessionId, idempotencyKey: "first-submit" }));
    const attempt = db.doc(`attempts/${finalized.attemptId}`);
    const original = await attempt.get();
    expect(original.data()).toMatchObject({ studentId: w.student, writtenResponse: text, responses: RESPONSES });
    expect(finalized).toMatchObject({ attemptNumber: 1, score: 10, maxScore: 10, replay: false });
    expect((await db.doc(`assessmentSessions/${started.sessionId}`).get()).exists).toBe(false);
    expect(await finalize(req(w, { sessionId: started.sessionId, idempotencyKey: "first-submit" })))
      .toMatchObject({ attemptId: finalized.attemptId, replay: true });
    const afterReplay = await attempt.get();
    expect(afterReplay.data()).toEqual(original.data());
    expect(afterReplay.updateTime?.isEqual(original.updateTime!)).toBe(true);

    const retake = await begin(req(w, { assignmentId: w.assignmentId }));
    expect(retake.alreadyLive).toBe(false);
    expect(retake).not.toHaveProperty("writtenResponse");
    await autosave(req(w, { sessionId: retake.sessionId, responses: RESPONSES, writtenResponse: "Retake thinking." }));
    const second = await finalize(req(w, { sessionId: retake.sessionId, idempotencyKey: "second-submit" }));
    expect(second.attemptNumber).toBe(2);
    expect(second.attemptId).not.toBe(finalized.attemptId);
    expect((await db.doc(`attempts/${second.attemptId}`).get()).get("writtenResponse")).toBe("Retake thinking.");
    expect((await attempt.get()).data()).toEqual(original.data());

    const audits = await db.collection("auditEvents").where("actorUserId", "==", w.student).get();
    expect(JSON.stringify(audits.docs.map(doc => doc.data()))).not.toContain(text);
  });

  it.each(["absent", "blank", "cleared"] as const)("does not restore or finalize %s text", async (mode) => {
    const w = await seedWorld();
    const started = await begin(req(w, { assignmentId: w.assignmentId }));
    if (mode === "cleared") {
      await autosave(req(w, { sessionId: started.sessionId, responses: RESPONSES, writtenResponse: "Remove me." }));
      await autosave(req(w, { sessionId: started.sessionId, responses: RESPONSES }));
      expect((await db.doc(`assessmentSessions/${started.sessionId}`).get()).get("writtenResponse")).toBe("Remove me.");
    }
    await autosave(req(w, {
      sessionId: started.sessionId,
      responses: RESPONSES,
      ...(mode === "absent" ? {} : { writtenResponse: " \n\t " }),
    }));
    expect((await db.doc(`assessmentSessions/${started.sessionId}`).get()).data()).not.toHaveProperty("writtenResponse");
    expect(await replayUnchanged(w, started.sessionId)).not.toHaveProperty("writtenResponse");
    const finalized = await finalize(req(w, { sessionId: started.sessionId, idempotencyKey: `submit-${mode}` }));
    expect((await db.doc(`attempts/${finalized.attemptId}`).get()).data()).not.toHaveProperty("writtenResponse");
  });

  it("refuses another active student's ownership access without changing the owner's session", async () => {
    const w = await seedWorld();
    const started = await begin(req(w, { assignmentId: w.assignmentId }));
    await autosave(req(w, { sessionId: started.sessionId, responses: RESPONSES, writtenResponse: "Private student thinking." }));
    const ref = db.doc(`assessmentSessions/${started.sessionId}`);
    const before = await ref.get();
    await expect(autosave(req(w, {
      sessionId: started.sessionId, responses: RESPONSES, writtenResponse: "Overwrite.",
    }, w.otherStudent))).rejects.toMatchObject({ code: "assessmentSessions.notOwned" });
    await expect(finalize(req(w, {
      sessionId: started.sessionId, idempotencyKey: "not-mine",
    }, w.otherStudent))).rejects.toMatchObject({ code: "assessmentAttempts.notOwned" });
    await expect(begin(req(w, {
      assignmentId: w.assignmentId, studentId: w.student,
    }, w.otherStudent))).rejects.toMatchObject({ code: "assessmentSessions.invalidRequest" });
    const ownBegin = await begin(req(w, { assignmentId: w.assignmentId }, w.otherStudent));
    expect(ownBegin.sessionId).not.toBe(started.sessionId);
    expect(ownBegin).not.toHaveProperty("writtenResponse");
    const after = await ref.get();
    expect(after.data()).toEqual(before.data());
    expect(after.updateTime?.isEqual(before.updateTime!)).toBe(true);
    expect((await db.collection("attempts").where("assignmentId", "==", w.assignmentId).get()).empty).toBe(true);
  });
});
