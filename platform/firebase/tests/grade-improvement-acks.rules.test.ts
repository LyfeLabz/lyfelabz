import {
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import { createTestEnvironment } from "./setup";

// Grade Improvements V1. `gradeImprovementAcks/{recordId}` and its
// append-only `events/{eventId}` subcollection are server-owned. No explicit
// Rules block exists: the terminal default-deny covers both paths, so every
// client role (the owning teacher included) is refused every operation. The
// `gradeImprovements*` callables are the sole readers/writers via the Admin SDK.

const TEACHER_UID = "teacher-uid";
const OTHER_TEACHER_UID = "other-teacher-uid";
const STUDENT_UID = "student-uid";
const RECORD_ID = `asg-1__${STUDENT_UID}`;
const RECORD_PATH = `gradeImprovementAcks/${RECORD_ID}`;
const EVENT_PATH = `gradeImprovementAcks/${RECORD_ID}/events/e000001`;

describe("Firestore Rules: gradeImprovementAcks (default-deny)", () => {
  let testEnv: RulesTestEnvironment;
  let databases: ReturnType<ReturnType<RulesTestEnvironment["unauthenticatedContext"]>["firestore"]>[];

  beforeAll(async () => {
    testEnv = await createTestEnvironment();
    databases = [
      testEnv.authenticatedContext(TEACHER_UID, { role: "teacher", schoolId: "school-a", districtId: "district-a" }),
      testEnv.authenticatedContext(OTHER_TEACHER_UID, { role: "teacher", schoolId: "school-a", districtId: "district-a" }),
      testEnv.authenticatedContext(STUDENT_UID, { role: "student", schoolId: "school-a", districtId: "district-a" }),
      testEnv.unauthenticatedContext(),
    ].map((context) => context.firestore());
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const owned = {
        assignmentId: "asg-1",
        studentId: STUDENT_UID,
        classId: "class-1",
        teacherId: TEACHER_UID,
        schoolId: "school-a",
        districtId: "district-a",
      };
      await setDoc(doc(db, RECORD_PATH), { ...owned, eventCount: 1, effective: null });
      await setDoc(doc(db, EVENT_PATH), { ...owned, eventId: "e000001", sequence: 1, type: "acknowledged" });
    });
  });

  it("denies get, list, create, update, and delete on records and events for every role", async () => {
    for (const db of databases) {
      for (const path of [RECORD_PATH, EVENT_PATH]) {
        await assertFails(getDoc(doc(db, path)));
        await assertFails(setDoc(doc(db, path), { forged: true }));
        await assertFails(updateDoc(doc(db, path), { forged: true }));
        await assertFails(deleteDoc(doc(db, path)));
      }
      await assertFails(getDocs(collection(db, "gradeImprovementAcks")));
      await assertFails(getDocs(collection(db, "gradeImprovementAcks", RECORD_ID, "events")));
      await assertFails(setDoc(doc(db, "gradeImprovementAcks", RECORD_ID, "events", "e000002"), { type: "reversed" }));
    }
  });
});
