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
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import { createTestEnvironment } from "./setup";

const TEACHER_UID = "teacher-owner-uid";
const OTHER_TEACHER_UID = "teacher-other-uid";
const CROSS_SCHOOL_TEACHER_UID = "teacher-cross-school-uid";
const STUDENT_UID = "student-owner-uid";
const OTHER_STUDENT_UID = "student-other-uid";
const CROSS_SCHOOL_STUDENT_UID = "student-cross-school-uid";

const SCHOOL_ID = "school-a";
const OTHER_SCHOOL_ID = "school-b";

const CLASS_ID = "class-owner-1";
const OTHER_CLASS_ID = "class-other-1";
const CROSS_SCHOOL_CLASS_ID = "class-cross-school-1";

const ASSIGNMENT_ID = "assign-owner-1";
const OTHER_ASSIGNMENT_ID = "assign-other-1";
const CROSS_SCHOOL_ASSIGNMENT_ID = "assign-cross-school-1";

const SUBMISSION_ID = `${ASSIGNMENT_ID}__${STUDENT_UID}`;
const OTHER_SUBMISSION_ID = `${OTHER_ASSIGNMENT_ID}__${OTHER_STUDENT_UID}`;
const CROSS_SCHOOL_SUBMISSION_ID = `${CROSS_SCHOOL_ASSIGNMENT_ID}__${CROSS_SCHOOL_STUDENT_UID}`;

describe("Firestore Rules: submissions/{submissionId}", () => {
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

      await setDoc(doc(db, "submissions", SUBMISSION_ID), {
        assignmentId: ASSIGNMENT_ID,
        studentId: STUDENT_UID,
        classId: CLASS_ID,
        teacherId: TEACHER_UID,
        schoolId: SCHOOL_ID,
        lessonSlug: "lesson_g7_earths-layers",
        lessonVersion: "1",
        mode: "classroom",
        status: "submitted",
        startedAt: new Date("2026-09-01T00:00:00Z"),
        responses: [],
      });
      await setDoc(doc(db, "submissions", OTHER_SUBMISSION_ID), {
        assignmentId: OTHER_ASSIGNMENT_ID,
        studentId: OTHER_STUDENT_UID,
        classId: OTHER_CLASS_ID,
        teacherId: OTHER_TEACHER_UID,
        schoolId: SCHOOL_ID,
        lessonSlug: "lesson_g7_water-cycle",
        lessonVersion: "1",
        mode: "classroom",
        status: "finalized",
        startedAt: new Date("2026-09-01T00:00:00Z"),
        submittedAt: new Date("2026-09-01T00:10:00Z"),
        responses: [],
      });
      await setDoc(doc(db, "submissions", CROSS_SCHOOL_SUBMISSION_ID), {
        assignmentId: CROSS_SCHOOL_ASSIGNMENT_ID,
        studentId: CROSS_SCHOOL_STUDENT_UID,
        classId: CROSS_SCHOOL_CLASS_ID,
        teacherId: CROSS_SCHOOL_TEACHER_UID,
        schoolId: OTHER_SCHOOL_ID,
        lessonSlug: "lesson_g7_ecosystem-stability",
        lessonVersion: "1",
        mode: "classroom",
        status: "submitted",
        startedAt: new Date("2026-09-01T00:00:00Z"),
        responses: [],
      });
    });
  });

  describe("read", () => {
    it("allows the submitting student to get their own submission", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
      await assertSucceeds(getDoc(doc(db, "submissions", SUBMISSION_ID)));
    });

    it("allows the owning teacher to get a submission in their classroom", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
      await assertSucceeds(getDoc(doc(db, "submissions", SUBMISSION_ID)));
    });

    it("denies a different student from getting another student's submission", async () => {
      const db = testEnv.authenticatedContext(OTHER_STUDENT_UID).firestore();
      await assertFails(getDoc(doc(db, "submissions", SUBMISSION_ID)));
    });

    it("denies a different teacher from getting a submission in another teacher's classroom", async () => {
      const db = testEnv.authenticatedContext(OTHER_TEACHER_UID).firestore();
      await assertFails(getDoc(doc(db, "submissions", SUBMISSION_ID)));
    });

    it("denies a teacher from another school from getting a cross-school submission", async () => {
      const db = testEnv
        .authenticatedContext(CROSS_SCHOOL_TEACHER_UID)
        .firestore();
      await assertFails(getDoc(doc(db, "submissions", SUBMISSION_ID)));
    });

    it("denies an unauthenticated caller from getting any submission", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, "submissions", SUBMISSION_ID)));
    });
  });

  describe("list", () => {
    it("allows a student to list submissions filtered by their own studentId", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
      await assertSucceeds(
        getDocs(
          query(
            collection(db, "submissions"),
            where("studentId", "==", STUDENT_UID),
          ),
        ),
      );
    });

    it("allows the owning teacher to list submissions filtered by their own teacherId", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
      await assertSucceeds(
        getDocs(
          query(
            collection(db, "submissions"),
            where("teacherId", "==", TEACHER_UID),
          ),
        ),
      );
    });

    it("denies an unscoped submissions collection list", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
      await assertFails(getDocs(collection(db, "submissions")));
    });

    it("denies a student from listing submissions filtered by another student's uid", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
      await assertFails(
        getDocs(
          query(
            collection(db, "submissions"),
            where("studentId", "==", OTHER_STUDENT_UID),
          ),
        ),
      );
    });

    it("denies a teacher from listing submissions filtered by another teacher's uid", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
      await assertFails(
        getDocs(
          query(
            collection(db, "submissions"),
            where("teacherId", "==", OTHER_TEACHER_UID),
          ),
        ),
      );
    });

    it("denies a teacher from another school from listing cross-school submissions", async () => {
      const db = testEnv
        .authenticatedContext(CROSS_SCHOOL_TEACHER_UID)
        .firestore();
      await assertFails(
        getDocs(
          query(
            collection(db, "submissions"),
            where("teacherId", "==", TEACHER_UID),
          ),
        ),
      );
    });

    it("denies an unauthenticated caller from listing submissions at all", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        getDocs(
          query(
            collection(db, "submissions"),
            where("studentId", "==", STUDENT_UID),
          ),
        ),
      );
    });
  });

  describe("write", () => {
    it("denies a student from creating a submission document from the client", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
      await assertFails(
        setDoc(doc(db, "submissions", "new-submission"), {
          assignmentId: ASSIGNMENT_ID,
          studentId: STUDENT_UID,
          classId: CLASS_ID,
          teacherId: TEACHER_UID,
          schoolId: SCHOOL_ID,
          lessonSlug: "lesson_g7_earths-layers",
          lessonVersion: "1",
          mode: "classroom",
          status: "submitted",
          startedAt: new Date("2026-09-01T00:00:00Z"),
          responses: [],
        }),
      );
    });

    it("denies the owning teacher from creating a submission document from the client", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
      await assertFails(
        setDoc(doc(db, "submissions", "new-submission"), {
          assignmentId: ASSIGNMENT_ID,
          studentId: OTHER_STUDENT_UID,
          classId: CLASS_ID,
          teacherId: TEACHER_UID,
          schoolId: SCHOOL_ID,
          lessonSlug: "lesson_g7_earths-layers",
          lessonVersion: "1",
          mode: "classroom",
          status: "submitted",
          startedAt: new Date("2026-09-01T00:00:00Z"),
          responses: [],
        }),
      );
    });

    it("denies the submitting student from updating their own submission", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
      await assertFails(
        updateDoc(doc(db, "submissions", SUBMISSION_ID), {
          status: "finalized",
        }),
      );
    });

    it("denies the owning teacher from updating a submission from the client", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
      await assertFails(
        updateDoc(doc(db, "submissions", SUBMISSION_ID), {
          score: 100,
        }),
      );
    });

    it("denies the submitting student from deleting their own submission", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
      await assertFails(deleteDoc(doc(db, "submissions", SUBMISSION_ID)));
    });

    it("denies an unauthenticated caller from any write against submissions", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        setDoc(doc(db, "submissions", "another-submission"), {
          assignmentId: ASSIGNMENT_ID,
          studentId: STUDENT_UID,
          classId: CLASS_ID,
          teacherId: TEACHER_UID,
          schoolId: SCHOOL_ID,
          lessonSlug: "lesson_g7_earths-layers",
          lessonVersion: "1",
          mode: "classroom",
          status: "submitted",
          startedAt: new Date("2026-09-01T00:00:00Z"),
          responses: [],
        }),
      );
    });
  });
});
