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
      await assertFails(getDoc(doc(db, "assessmentRevisions", REVISION_ID)));
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
      await assertFails(getDoc(doc(db, "assessmentRevisions", REVISION_ID)));
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
