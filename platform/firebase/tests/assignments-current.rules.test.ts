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

const OWNER_TEACHER_UID = "teacher-owner-uid";
const OTHER_TEACHER_UID = "teacher-other-uid";
const STUDENT_UID = "student-owner-uid";
const SCHOOL_ID = "school-a";
const CLASS_ID = "class-owner-1";
const LESSON_SLUG = "lesson_g7_earths-layers";
const ASSIGNMENT_ID = "assign-owner-1";

// Historical Assignment Resolution, Implementation Slice 2.
//
// Proves the deny-all boundary for the Current-assignment pointer at
// classes/{classId}/assignmentsCurrent/{lessonSlug}. This is a
// server-owned internal pointer (see
// platform/functions/src/shared/types/assignment-current.ts); no client
// role has any legitimate reason to read or write it directly, and there
// is no ownership/school/district exception. The decisive proof is that
// even the most privileged legitimate client for this class - the owning
// active teacher - has zero direct access, identical to a student, another
// teacher, or an unauthenticated caller.
describe("Firestore Rules: classes/{classId}/assignmentsCurrent/{lessonSlug}", () => {
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
      // Phase 8G.1: teacher-read branches require an active teacher record.
      // Deny-all does not consult this at all, but seeding it proves the
      // boundary holds even for the most privileged legitimate caller, not
      // merely an inactive or malformed one.
      await setDoc(doc(db, "users", OWNER_TEACHER_UID), {
        authUid: OWNER_TEACHER_UID,
        status: "active",
        role: "teacher",
        schoolId: SCHOOL_ID,
        displayName: "Owner Teacher",
        createdAt: new Date("2026-08-15T00:00:00Z"),
      });
      await setDoc(doc(db, "classes", CLASS_ID), {
        teacherId: OWNER_TEACHER_UID,
        schoolId: SCHOOL_ID,
        title: "Grade 7 Science, Block C",
        grade: "7",
        block: "C",
        joinCode: "ABCD1234",
        status: "active",
        createdAt: new Date("2026-08-15T00:00:00Z"),
      });
      await setDoc(
        doc(db, "classes", CLASS_ID, "assignmentsCurrent", LESSON_SLUG),
        {
          classId: CLASS_ID,
          lessonSlug: LESSON_SLUG,
          assignmentId: ASSIGNMENT_ID,
          teacherId: OWNER_TEACHER_UID,
          schoolId: SCHOOL_ID,
          setAt: new Date("2026-08-15T00:00:00Z"),
          setBy: OWNER_TEACHER_UID,
          source: "publish",
        },
      );
    });
  });

  describe("read", () => {
    it("denies the owning active teacher from getting the pointer directly", async () => {
      const db = testEnv.authenticatedContext(OWNER_TEACHER_UID).firestore();
      await assertFails(
        getDoc(
          doc(db, "classes", CLASS_ID, "assignmentsCurrent", LESSON_SLUG),
        ),
      );
    });

    it("denies the owning active teacher from listing the assignmentsCurrent subcollection", async () => {
      const db = testEnv.authenticatedContext(OWNER_TEACHER_UID).firestore();
      await assertFails(
        getDocs(collection(db, "classes", CLASS_ID, "assignmentsCurrent")),
      );
    });

    it("denies a different teacher from getting the pointer", async () => {
      const db = testEnv.authenticatedContext(OTHER_TEACHER_UID).firestore();
      await assertFails(
        getDoc(
          doc(db, "classes", CLASS_ID, "assignmentsCurrent", LESSON_SLUG),
        ),
      );
    });

    it("denies a student from getting the pointer", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
      await assertFails(
        getDoc(
          doc(db, "classes", CLASS_ID, "assignmentsCurrent", LESSON_SLUG),
        ),
      );
    });

    it("denies an unauthenticated caller from getting the pointer", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        getDoc(
          doc(db, "classes", CLASS_ID, "assignmentsCurrent", LESSON_SLUG),
        ),
      );
    });
  });

  describe("write", () => {
    it("denies the owning active teacher from creating a pointer from the client", async () => {
      const db = testEnv.authenticatedContext(OWNER_TEACHER_UID).firestore();
      await assertFails(
        setDoc(
          doc(db, "classes", CLASS_ID, "assignmentsCurrent", "other-lesson"),
          {
            classId: CLASS_ID,
            lessonSlug: "other-lesson",
            assignmentId: "assign-client-forged",
            teacherId: OWNER_TEACHER_UID,
            schoolId: SCHOOL_ID,
            setAt: new Date("2026-08-15T00:00:00Z"),
            setBy: OWNER_TEACHER_UID,
            source: "teacherResolution",
          },
        ),
      );
    });

    it("denies the owning active teacher from updating the pointer's assignmentId from the client", async () => {
      const db = testEnv.authenticatedContext(OWNER_TEACHER_UID).firestore();
      await assertFails(
        updateDoc(
          doc(db, "classes", CLASS_ID, "assignmentsCurrent", LESSON_SLUG),
          { assignmentId: "assign-client-hijacked" },
        ),
      );
    });

    it("denies the owning active teacher from deleting the pointer from the client", async () => {
      const db = testEnv.authenticatedContext(OWNER_TEACHER_UID).firestore();
      await assertFails(
        deleteDoc(
          doc(db, "classes", CLASS_ID, "assignmentsCurrent", LESSON_SLUG),
        ),
      );
    });

    it("denies a different teacher from updating the pointer", async () => {
      const db = testEnv.authenticatedContext(OTHER_TEACHER_UID).firestore();
      await assertFails(
        updateDoc(
          doc(db, "classes", CLASS_ID, "assignmentsCurrent", LESSON_SLUG),
          { assignmentId: "assign-cross-teacher-hijacked" },
        ),
      );
    });

    it("denies a student from creating a pointer from the client", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
      await assertFails(
        setDoc(
          doc(
            db,
            "classes",
            CLASS_ID,
            "assignmentsCurrent",
            "student-forged-lesson",
          ),
          {
            classId: CLASS_ID,
            lessonSlug: "student-forged-lesson",
            assignmentId: "assign-student-forged",
            teacherId: OWNER_TEACHER_UID,
            schoolId: SCHOOL_ID,
            setAt: new Date("2026-08-15T00:00:00Z"),
            setBy: STUDENT_UID,
            source: "teacherResolution",
          },
        ),
      );
    });

    it("denies an unauthenticated caller from creating a pointer from the client", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        setDoc(
          doc(
            db,
            "classes",
            CLASS_ID,
            "assignmentsCurrent",
            "anonymous-forged-lesson",
          ),
          {
            classId: CLASS_ID,
            lessonSlug: "anonymous-forged-lesson",
            assignmentId: "assign-anonymous-forged",
            teacherId: OWNER_TEACHER_UID,
            schoolId: SCHOOL_ID,
            setAt: new Date("2026-08-15T00:00:00Z"),
            setBy: "anonymous",
            source: "teacherResolution",
          },
        ),
      );
    });
  });
});
