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

// Sprint 12B Slice 1: assessmentRevisions/{revisionId} Rules coverage.
// Revisions are the district-neutral scorable content shape (items, options,
// ordering rule, points) with no correct-answer material. The paired
// assessmentAnswerKeys/{revisionId} document holds the answer key. Every
// authenticated caller may `get` a revision. Every client write is denied.

const STUDENT_UID = "student-uid";
const TEACHER_UID = "teacher-uid";
const DISTRICT_ID = "district-a";

const ASSESSMENT_ID = "assessment_lesson_g7_earths-layers";
const REVISION_ID = `${ASSESSMENT_ID}__r1`;

const STUDENT_TOKEN = { role: "student", schoolId: "school-a", districtId: DISTRICT_ID };
const TEACHER_TOKEN = { role: "teacher", schoolId: "school-a", districtId: DISTRICT_ID };

describe("Firestore Rules: assessmentRevisions/{revisionId}", () => {
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
      await setDoc(doc(db, "assessmentRevisions", REVISION_ID), {
        assessmentId: ASSESSMENT_ID,
        revisionOrdinal: 1,
        activityId: "lesson_g7_earths-layers",
        itemOrderingRule: "fixed",
        items: [
          {
            itemId: "q1",
            itemType: "multiple-choice",
            stem: "Which layer of Earth is molten?",
            options: [
              { optionId: "o1", label: "Crust" },
              { optionId: "o2", label: "Outer core" },
            ],
            points: 1,
          },
        ],
        publishedAt: new Date("2026-09-01T00:00:00Z"),
        publishedBy: "system",
        schemaVersion: 1,
      });
    });
  });

  describe("read", () => {
    it("allows an authenticated student to get a revision", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID, STUDENT_TOKEN).firestore();
      await assertSucceeds(getDoc(doc(db, "assessmentRevisions", REVISION_ID)));
    });

    it("allows an authenticated teacher to get a revision", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID, TEACHER_TOKEN).firestore();
      await assertSucceeds(getDoc(doc(db, "assessmentRevisions", REVISION_ID)));
    });

    it("denies an unauthenticated caller from getting a revision", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, "assessmentRevisions", REVISION_ID)));
    });

    it("denies collection enumeration of revisions", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID, TEACHER_TOKEN).firestore();
      await assertFails(getDocs(collection(db, "assessmentRevisions")));
    });
  });

  describe("write", () => {
    it("denies a student from creating a revision", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID, STUDENT_TOKEN).firestore();
      await assertFails(
        setDoc(doc(db, "assessmentRevisions", `${ASSESSMENT_ID}__r99`), {
          assessmentId: ASSESSMENT_ID,
          revisionOrdinal: 99,
          activityId: "lesson_forged",
          itemOrderingRule: "fixed",
          items: [],
          publishedAt: new Date("2026-09-01T00:00:00Z"),
          publishedBy: STUDENT_UID,
          schemaVersion: 1,
        }),
      );
    });

    it("denies a teacher from updating a revision", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID, TEACHER_TOKEN).firestore();
      await assertFails(
        updateDoc(doc(db, "assessmentRevisions", REVISION_ID), {
          items: [],
        }),
      );
    });

    it("denies a teacher from deleting a revision", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID, TEACHER_TOKEN).firestore();
      await assertFails(deleteDoc(doc(db, "assessmentRevisions", REVISION_ID)));
    });
  });
});
