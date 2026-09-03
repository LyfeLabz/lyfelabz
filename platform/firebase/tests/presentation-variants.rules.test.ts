import {
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc } from "firebase/firestore";

import { createTestEnvironment } from "./setup";

// F5.2 Persistent Student Differentiation, Slice 3 (publication state machine
// + runtime current-presentation index + retention gating). The
// `presentationVariants/{lessonSlug}__{variantKey}` current-index family is
// server-owned per F5.2 §3.5/§5.3 and §11: zero direct client read/write for
// ANY role - students cannot read it, enumerate variants, discover a
// variantKey, or write/repoint/retire it, and teachers cannot mutate it via
// ordinary client Firestore access. The Slice 3 publish tooling is the sole
// writer and runs through the Admin SDK, bypassing Rules entirely (T-A9 per
// F5.2 §13).

const TEACHER_UID = "teacher-uid";
const STUDENT_UID = "student-uid";
const INDEX_ID = "earths-layers__reading-adapted";

describe("Firestore Rules: presentationVariants/{indexId}", () => {
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
      await setDoc(doc(db, "presentationVariants", INDEX_ID), {
        lessonSlug: "earths-layers",
        variantKey: "reading-adapted",
        currentPresentationRevisionId: `pr${"a".repeat(64)}`,
        currentPath: `app/lessons/variants/lesson_earths-layers__pr${"a".repeat(64)}.html`,
        contentSha256: "a".repeat(64),
        status: "active",
        updatedAt: new Date("2026-09-03T00:00:00Z"),
        publishedBy: "operator-uid",
      });
    });
  });

  it("denies an authenticated student's read (no variant discovery)", async () => {
    const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
    await assertFails(getDoc(doc(db, "presentationVariants", INDEX_ID)));
  });

  it("denies a teacher's direct read", async () => {
    const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
    await assertFails(getDoc(doc(db, "presentationVariants", INDEX_ID)));
  });

  it("denies an unauthenticated read", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "presentationVariants", INDEX_ID)));
  });

  it("denies collection enumeration (list) for a student", async () => {
    const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
    await assertFails(getDocs(collection(db, "presentationVariants")));
  });

  it("denies collection enumeration (list) for a teacher", async () => {
    const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
    await assertFails(getDocs(collection(db, "presentationVariants")));
  });

  it("denies an authenticated create (publish/repoint via client)", async () => {
    const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
    await assertFails(
      setDoc(doc(db, "presentationVariants", "other-lesson__reading-adapted"), {
        lessonSlug: "other-lesson",
        variantKey: "reading-adapted",
        status: "active",
      }),
    );
  });

  it("denies an authenticated update (repoint/retire via client)", async () => {
    const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "presentationVariants", INDEX_ID), { status: "retired" }),
    );
  });

  it("denies an authenticated delete", async () => {
    const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
    await assertFails(deleteDoc(doc(db, "presentationVariants", INDEX_ID)));
  });

  it("denies an unauthenticated write", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(db, "presentationVariants", "x__reading-adapted"), { lessonSlug: "x" }),
    );
  });
});
