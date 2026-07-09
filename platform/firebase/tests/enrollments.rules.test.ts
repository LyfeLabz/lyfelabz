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

const ENROLLMENT_ID = `${CLASS_ID}__${STUDENT_UID}`;
const OTHER_ENROLLMENT_ID = `${OTHER_CLASS_ID}__${OTHER_STUDENT_UID}`;
const CROSS_SCHOOL_ENROLLMENT_ID = `${CROSS_SCHOOL_CLASS_ID}__${CROSS_SCHOOL_STUDENT_UID}`;

describe("Firestore Rules: enrollments/{enrollmentId}", () => {
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

      await setDoc(doc(db, "classes", CLASS_ID), {
        teacherId: TEACHER_UID,
        schoolId: SCHOOL_ID,
        title: "Grade 7 Science, Block C",
        grade: "7",
        block: "C",
        joinCode: "ABCD1234",
        status: "active",
        createdAt: new Date("2026-08-15T00:00:00Z"),
      });
      await setDoc(doc(db, "classes", OTHER_CLASS_ID), {
        teacherId: OTHER_TEACHER_UID,
        schoolId: SCHOOL_ID,
        title: "Grade 8 Science, Block A",
        grade: "8",
        block: "A",
        joinCode: "EFGH5678",
        status: "active",
        createdAt: new Date("2026-08-15T00:00:00Z"),
      });
      await setDoc(doc(db, "classes", CROSS_SCHOOL_CLASS_ID), {
        teacherId: CROSS_SCHOOL_TEACHER_UID,
        schoolId: OTHER_SCHOOL_ID,
        title: "Grade 7 Science, Block B",
        grade: "7",
        block: "B",
        joinCode: "IJKL9012",
        status: "active",
        createdAt: new Date("2026-08-15T00:00:00Z"),
      });

      await setDoc(doc(db, "enrollments", ENROLLMENT_ID), {
        studentId: STUDENT_UID,
        classId: CLASS_ID,
        schoolId: SCHOOL_ID,
        status: "active",
        enrolledAt: new Date("2026-08-20T00:00:00Z"),
      });
      await setDoc(doc(db, "enrollments", OTHER_ENROLLMENT_ID), {
        studentId: OTHER_STUDENT_UID,
        classId: OTHER_CLASS_ID,
        schoolId: SCHOOL_ID,
        status: "active",
        enrolledAt: new Date("2026-08-20T00:00:00Z"),
      });
      await setDoc(doc(db, "enrollments", CROSS_SCHOOL_ENROLLMENT_ID), {
        studentId: CROSS_SCHOOL_STUDENT_UID,
        classId: CROSS_SCHOOL_CLASS_ID,
        schoolId: OTHER_SCHOOL_ID,
        status: "active",
        enrolledAt: new Date("2026-08-20T00:00:00Z"),
      });
    });
  });

  describe("read", () => {
    it("allows the enrolled student to get their own enrollment", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
      await assertSucceeds(getDoc(doc(db, "enrollments", ENROLLMENT_ID)));
    });

    it("allows the owning teacher to get an enrollment in their classroom", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
      await assertSucceeds(getDoc(doc(db, "enrollments", ENROLLMENT_ID)));
    });

    it("denies a different teacher from getting an enrollment in another teacher's class", async () => {
      const db = testEnv.authenticatedContext(OTHER_TEACHER_UID).firestore();
      await assertFails(getDoc(doc(db, "enrollments", ENROLLMENT_ID)));
    });

    it("denies a teacher from another school from getting a cross-school enrollment", async () => {
      const db = testEnv
        .authenticatedContext(CROSS_SCHOOL_TEACHER_UID)
        .firestore();
      await assertFails(getDoc(doc(db, "enrollments", ENROLLMENT_ID)));
    });

    it("denies a different student from getting another student's enrollment", async () => {
      const db = testEnv.authenticatedContext(OTHER_STUDENT_UID).firestore();
      await assertFails(getDoc(doc(db, "enrollments", ENROLLMENT_ID)));
    });

    it("denies an unauthenticated caller from getting any enrollment", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, "enrollments", ENROLLMENT_ID)));
    });
  });

  describe("list", () => {
    it("allows a student to list enrollments filtered by their own studentId", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
      await assertSucceeds(
        getDocs(
          query(
            collection(db, "enrollments"),
            where("studentId", "==", STUDENT_UID),
          ),
        ),
      );
    });

    it("allows the owning teacher to list enrollments filtered by their classId", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
      await assertSucceeds(
        getDocs(
          query(
            collection(db, "enrollments"),
            where("classId", "==", CLASS_ID),
          ),
        ),
      );
    });

    it("denies an unscoped enrollments collection list", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
      await assertFails(getDocs(collection(db, "enrollments")));
    });

    it("denies a student from listing enrollments filtered by another student's uid", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
      await assertFails(
        getDocs(
          query(
            collection(db, "enrollments"),
            where("studentId", "==", OTHER_STUDENT_UID),
          ),
        ),
      );
    });

    it("denies a teacher from listing enrollments in a class they do not own", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
      await assertFails(
        getDocs(
          query(
            collection(db, "enrollments"),
            where("classId", "==", OTHER_CLASS_ID),
          ),
        ),
      );
    });

    it("denies a teacher from another school from listing cross-school enrollments", async () => {
      const db = testEnv
        .authenticatedContext(CROSS_SCHOOL_TEACHER_UID)
        .firestore();
      await assertFails(
        getDocs(
          query(
            collection(db, "enrollments"),
            where("classId", "==", CLASS_ID),
          ),
        ),
      );
    });

    it("denies an unauthenticated caller from listing enrollments at all", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        getDocs(
          query(
            collection(db, "enrollments"),
            where("studentId", "==", STUDENT_UID),
          ),
        ),
      );
    });
  });

  describe("write", () => {
    it("denies a student from creating an enrollment document from the client", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
      await assertFails(
        setDoc(doc(db, "enrollments", "new-enrollment"), {
          studentId: STUDENT_UID,
          classId: CLASS_ID,
          schoolId: SCHOOL_ID,
          status: "active",
          enrolledAt: new Date("2026-08-20T00:00:00Z"),
        }),
      );
    });

    it("denies the owning teacher from creating an enrollment document from the client", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
      await assertFails(
        setDoc(doc(db, "enrollments", "new-enrollment"), {
          studentId: OTHER_STUDENT_UID,
          classId: CLASS_ID,
          schoolId: SCHOOL_ID,
          status: "active",
          enrolledAt: new Date("2026-08-20T00:00:00Z"),
        }),
      );
    });

    it("denies the enrolled student from updating any field on their own enrollment", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
      await assertFails(
        updateDoc(doc(db, "enrollments", ENROLLMENT_ID), {
          status: "withdrawn",
        }),
      );
    });

    it("denies the owning teacher from updating an enrollment from the client", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
      await assertFails(
        updateDoc(doc(db, "enrollments", ENROLLMENT_ID), {
          status: "withdrawn",
        }),
      );
    });

    it("denies the enrolled student from deleting their own enrollment", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
      await assertFails(deleteDoc(doc(db, "enrollments", ENROLLMENT_ID)));
    });

    it("denies an unauthenticated caller from any write against enrollments", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        setDoc(doc(db, "enrollments", "another-enrollment"), {
          studentId: STUDENT_UID,
          classId: CLASS_ID,
          schoolId: SCHOOL_ID,
          status: "active",
          enrolledAt: new Date("2026-08-20T00:00:00Z"),
        }),
      );
    });
  });
});
