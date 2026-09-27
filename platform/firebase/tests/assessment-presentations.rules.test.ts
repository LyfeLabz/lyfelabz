import {
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc } from "firebase/firestore";

import { createTestEnvironment } from "./setup";

// F5.3 Accessible Assessment Presentations, Slice 3. The
// `assessmentPresentations/{ap<sha256>}` family is server-owned and immutable:
// zero direct client read/write for ANY role. The publish tooling (a later
// slice) is the sole writer, through the Admin SDK, bypassing Rules.

const TEACHER_UID = "teacher-uid";
const STUDENT_UID = "student-uid";
const AP_ID = `ap${"a".repeat(64)}`;

describe("Firestore Rules: assessmentPresentations/{assessmentPresentationRevisionId}", () => {
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
      await setDoc(doc(ctx.firestore(), "assessmentPresentations", AP_ID), {
        schemaVersion: 1,
        kind: "lyfelabz.assessmentPresentation",
        lessonSlug: "earths-layers",
        assessmentRevisionId: "assessment_earths-layers__r1",
        traits: { language: "adapted", choiceCount: 3 },
      });
    });
  });

  for (const [label, uid] of [["student", STUDENT_UID], ["teacher", TEACHER_UID]] as const) {
    it(`denies a ${label}'s direct read`, async () => {
      const db = testEnv.authenticatedContext(uid).firestore();
      await assertFails(getDoc(doc(db, "assessmentPresentations", AP_ID)));
    });

    it(`denies ${label} collection enumeration (list)`, async () => {
      const db = testEnv.authenticatedContext(uid).firestore();
      await assertFails(getDocs(collection(db, "assessmentPresentations")));
    });

    it(`denies a ${label} create, update, and delete`, async () => {
      const db = testEnv.authenticatedContext(uid).firestore();
      await assertFails(setDoc(doc(db, "assessmentPresentations", `ap${"b".repeat(64)}`), { lessonSlug: "x" }));
      await assertFails(updateDoc(doc(db, "assessmentPresentations", AP_ID), { lessonSlug: "x" }));
      await assertFails(deleteDoc(doc(db, "assessmentPresentations", AP_ID)));
    });
  }

  it("denies an unauthenticated read and write", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "assessmentPresentations", AP_ID)));
    await assertFails(setDoc(doc(db, "assessmentPresentations", AP_ID), { lessonSlug: "x" }));
  });
});
