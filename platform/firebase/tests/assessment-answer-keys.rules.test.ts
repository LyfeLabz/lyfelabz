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

// Sprint 12B Slice 1: assessmentAnswerKeys/{revisionId} Rules coverage.
// Correct-answer material and per-item explanations are server-confidential
// for every role including `platformAdministrator` per PDR-026d and
// ASSESSMENT_IMPLEMENTATION_CONTRACT §22. The scorer inside
// `assessmentAttemptsFinalize` is the sole reader and runs under Admin SDK
// authority, bypassing Rules. Every client operation is denied by an
// explicit `allow read, write: if false;` block that documents intent and
// prevents accidental future relaxation.

const STUDENT_UID = "student-uid";
const OTHER_STUDENT_UID = "student-other-uid";
const TEACHER_UID = "teacher-uid";
const SAME_DISTRICT_TEACHER_UID = "teacher-same-district-uid";
const DISTRICT_ID = "district-a";

const ASSESSMENT_ID = "assessment_lesson_g7_earths-layers";
const REVISION_ID = `${ASSESSMENT_ID}__r1`;

const STUDENT_TOKEN = { role: "student", schoolId: "school-a", districtId: DISTRICT_ID };
const OTHER_STUDENT_TOKEN = { role: "student", schoolId: "school-b", districtId: DISTRICT_ID };
const TEACHER_TOKEN = { role: "teacher", schoolId: "school-a", districtId: DISTRICT_ID };
const SAME_DISTRICT_TEACHER_TOKEN = {
  role: "teacher",
  schoolId: "school-b",
  districtId: DISTRICT_ID,
};

describe("Firestore Rules: assessmentAnswerKeys/{revisionId}", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await createTestEnvironment();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "assessmentAnswerKeys", REVISION_ID), {
        assessmentId: ASSESSMENT_ID,
        revisionOrdinal: 1,
        items: [
          {
            itemId: "q1",
            correctOptionId: "o2",
            points: 1,
            explanation: "The outer core is molten iron and nickel.",
          },
        ],
        publishedAt: new Date("2026-09-01T00:00:00Z"),
        publishedBy: "system",
        schemaVersion: 1,
      });
    });
  });

  describe("read", () => {
    it("denies an unauthenticated caller from getting an answer key", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, "assessmentAnswerKeys", REVISION_ID)));
    });

    it("denies a student from getting an answer key", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID, STUDENT_TOKEN).firestore();
      await assertFails(getDoc(doc(db, "assessmentAnswerKeys", REVISION_ID)));
    });

    it("denies another student in the same district from getting an answer key", async () => {
      const db = testEnv
        .authenticatedContext(OTHER_STUDENT_UID, OTHER_STUDENT_TOKEN)
        .firestore();
      await assertFails(getDoc(doc(db, "assessmentAnswerKeys", REVISION_ID)));
    });

    it("denies a teacher from getting an answer key", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID, TEACHER_TOKEN).firestore();
      await assertFails(getDoc(doc(db, "assessmentAnswerKeys", REVISION_ID)));
    });

    it("denies a same-district teacher from getting an answer key", async () => {
      const db = testEnv
        .authenticatedContext(SAME_DISTRICT_TEACHER_UID, SAME_DISTRICT_TEACHER_TOKEN)
        .firestore();
      await assertFails(getDoc(doc(db, "assessmentAnswerKeys", REVISION_ID)));
    });

    it("denies a student from enumerating the answer key collection", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID, STUDENT_TOKEN).firestore();
      await assertFails(getDocs(collection(db, "assessmentAnswerKeys")));
    });

    it("denies a teacher from enumerating the answer key collection", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID, TEACHER_TOKEN).firestore();
      await assertFails(getDocs(collection(db, "assessmentAnswerKeys")));
    });
  });

  describe("write", () => {
    it("denies a student from creating an answer key", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID, STUDENT_TOKEN).firestore();
      await assertFails(
        setDoc(doc(db, "assessmentAnswerKeys", `${ASSESSMENT_ID}__r99`), {
          assessmentId: ASSESSMENT_ID,
          revisionOrdinal: 99,
          items: [],
          publishedAt: new Date("2026-09-01T00:00:00Z"),
          publishedBy: STUDENT_UID,
          schemaVersion: 1,
        }),
      );
    });

    it("denies a teacher from creating an answer key", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID, TEACHER_TOKEN).firestore();
      await assertFails(
        setDoc(doc(db, "assessmentAnswerKeys", `${ASSESSMENT_ID}__r99`), {
          assessmentId: ASSESSMENT_ID,
          revisionOrdinal: 99,
          items: [],
          publishedAt: new Date("2026-09-01T00:00:00Z"),
          publishedBy: TEACHER_UID,
          schemaVersion: 1,
        }),
      );
    });

    it("denies a teacher from updating an answer key", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID, TEACHER_TOKEN).firestore();
      await assertFails(
        updateDoc(doc(db, "assessmentAnswerKeys", REVISION_ID), {
          items: [],
        }),
      );
    });

    it("denies a teacher from deleting an answer key", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID, TEACHER_TOKEN).firestore();
      await assertFails(deleteDoc(doc(db, "assessmentAnswerKeys", REVISION_ID)));
    });
  });
});
