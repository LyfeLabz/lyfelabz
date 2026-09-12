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
      // Phase 8G.3: shared authenticated read surfaces require an active
      // canonical user record for the caller.
      await setDoc(doc(db, "users", STUDENT_UID), {
        authUid: STUDENT_UID,
        status: "active",
        role: "student",
        schoolId: "school-a",
        displayName: "Active Student",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
      await setDoc(doc(db, "users", TEACHER_UID), {
        authUid: TEACHER_UID,
        status: "active",
        role: "teacher",
        schoolId: "school-a",
        displayName: "Active Teacher",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
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

    // Phase 8G.3 - suspension enforcement on the shared authenticated surface.
    it("denies a suspended teacher carrying stale teacher claims", async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), "users", TEACHER_UID), {
          authUid: TEACHER_UID,
          status: "suspended",
          role: "teacher",
          schoolId: "school-a",
          displayName: "Suspended Teacher",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        });
      });
      // TEACHER_TOKEN still carries role: teacher (stale claim).
      const db = testEnv
        .authenticatedContext(TEACHER_UID, TEACHER_TOKEN)
        .firestore();
      await assertFails(getDoc(doc(db, "assessments", ASSESSMENT_ID)));
    });

    it("denies a suspended student", async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), "users", STUDENT_UID), {
          authUid: STUDENT_UID,
          status: "suspended",
          role: "student",
          schoolId: "school-a",
          displayName: "Suspended Student",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        });
      });
      const db = testEnv
        .authenticatedContext(STUDENT_UID, STUDENT_TOKEN)
        .firestore();
      await assertFails(getDoc(doc(db, "assessments", ASSESSMENT_ID)));
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
