import {
  assertFails,
  assertSucceeds,
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

// Sprint 12B Slice 1: assessments/{assessmentId} Rules coverage.
// The assessment metadata document is district-neutral, carries no
// answer-key material, and is client-readable by any authenticated caller
// per SPRINT_12A_ASSESSMENT_DATA_ACCESS_REVIEW.md §14.3. Every direct
// client write is denied because `deployAssessmentRevision` is the sole
// writer and runs through the Admin SDK.

const STUDENT_UID = "student-uid";
const TEACHER_UID = "teacher-uid";
const DISTRICT_ID = "district-a";

const ASSESSMENT_ID = "assessment_lesson_g7_earths-layers";
const ASSESSMENT_REVISION_ID = `${ASSESSMENT_ID}__r1`;

const STUDENT_TOKEN = { role: "student", schoolId: "school-a", districtId: DISTRICT_ID };
const TEACHER_TOKEN = { role: "teacher", schoolId: "school-a", districtId: DISTRICT_ID };

describe("Firestore Rules: assessments/{assessmentId}", () => {
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
      await setDoc(doc(db, "assessments", ASSESSMENT_ID), {
        assessmentId: ASSESSMENT_ID,
        activityId: "lesson_g7_earths-layers",
        currentRevisionId: ASSESSMENT_REVISION_ID,
      });
    });
  });

  describe("read", () => {
    it("allows an authenticated student to get an assessment", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID, STUDENT_TOKEN).firestore();
      await assertSucceeds(getDoc(doc(db, "assessments", ASSESSMENT_ID)));
    });

    it("allows an authenticated teacher to get an assessment", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID, TEACHER_TOKEN).firestore();
      await assertSucceeds(getDoc(doc(db, "assessments", ASSESSMENT_ID)));
    });

    it("denies an unauthenticated caller from getting an assessment", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, "assessments", ASSESSMENT_ID)));
    });

    it("denies collection enumeration of assessments", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID, TEACHER_TOKEN).firestore();
      await assertFails(getDocs(collection(db, "assessments")));
    });
  });

  describe("write", () => {
    it("denies a student from creating an assessment", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID, STUDENT_TOKEN).firestore();
      await assertFails(
        setDoc(doc(db, "assessments", "assessment_forged"), {
          assessmentId: "assessment_forged",
          activityId: "lesson_forged",
          currentRevisionId: "assessment_forged__r1",
        }),
      );
    });

    it("denies a teacher from creating an assessment", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID, TEACHER_TOKEN).firestore();
      await assertFails(
        setDoc(doc(db, "assessments", "assessment_forged"), {
          assessmentId: "assessment_forged",
          activityId: "lesson_forged",
          currentRevisionId: "assessment_forged__r1",
        }),
      );
    });

    it("denies a teacher from updating an assessment", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID, TEACHER_TOKEN).firestore();
      await assertFails(
        updateDoc(doc(db, "assessments", ASSESSMENT_ID), {
          currentRevisionId: `${ASSESSMENT_ID}__r99`,
        }),
      );
    });

    it("denies a teacher from deleting an assessment", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID, TEACHER_TOKEN).firestore();
      await assertFails(deleteDoc(doc(db, "assessments", ASSESSMENT_ID)));
    });
  });
});
