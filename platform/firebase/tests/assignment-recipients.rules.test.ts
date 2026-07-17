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
const CROSS_DISTRICT_TEACHER_UID = "teacher-cross-district-uid";
const STUDENT_UID = "student-owner-uid";
const OTHER_STUDENT_UID = "student-other-uid";
const SCHOOL_ID = "school-a";
const CLASS_ID = "class-owner-1";
const ASSIGNMENT_ID = "assign-owner-1";

describe("Firestore Rules: assignments/{assignmentId}/recipients/{studentId}", () => {
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
      await setDoc(doc(db, "assignments", ASSIGNMENT_ID), {
        classId: CLASS_ID,
        teacherId: OWNER_TEACHER_UID,
        schoolId: SCHOOL_ID,
        lessonSlug: "lesson_g7_earths-layers",
        lessonVersion: "1",
        mode: "classroom",
        status: "published",
        createdAt: new Date("2026-08-15T00:00:00Z"),
      });
      await setDoc(
        doc(
          db,
          "assignments",
          ASSIGNMENT_ID,
          "recipients",
          STUDENT_UID,
        ),
        {
          assignmentId: ASSIGNMENT_ID,
          studentId: STUDENT_UID,
          classId: CLASS_ID,
          teacherId: OWNER_TEACHER_UID,
          schoolId: SCHOOL_ID,
          districtId: "district-1",
          assignedBy: OWNER_TEACHER_UID,
          assignedAt: new Date("2026-08-15T00:00:00Z"),
          source: "classPublication",
          status: "assigned",
        },
      );
      await setDoc(
        doc(
          db,
          "assignments",
          ASSIGNMENT_ID,
          "recipients",
          OTHER_STUDENT_UID,
        ),
        {
          assignmentId: ASSIGNMENT_ID,
          studentId: OTHER_STUDENT_UID,
          classId: CLASS_ID,
          teacherId: OWNER_TEACHER_UID,
          schoolId: SCHOOL_ID,
          districtId: "district-1",
          assignedBy: OWNER_TEACHER_UID,
          assignedAt: new Date("2026-08-15T00:00:00Z"),
          source: "classPublication",
          status: "assigned",
        },
      );
    });
  });

  describe("read", () => {
    it("denies an unauthenticated caller from getting any recipient", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        getDoc(
          doc(db, "assignments", ASSIGNMENT_ID, "recipients", STUDENT_UID),
        ),
      );
    });

    it("denies the owning student from getting their own recipient directly", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
      await assertFails(
        getDoc(
          doc(db, "assignments", ASSIGNMENT_ID, "recipients", STUDENT_UID),
        ),
      );
    });

    it("denies a student from getting another student's recipient", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
      await assertFails(
        getDoc(
          doc(
            db,
            "assignments",
            ASSIGNMENT_ID,
            "recipients",
            OTHER_STUDENT_UID,
          ),
        ),
      );
    });

    it("denies the owning teacher from getting a recipient directly", async () => {
      const db = testEnv.authenticatedContext(OWNER_TEACHER_UID).firestore();
      await assertFails(
        getDoc(
          doc(db, "assignments", ASSIGNMENT_ID, "recipients", STUDENT_UID),
        ),
      );
    });

    it("denies the owning teacher from listing the recipients subcollection", async () => {
      const db = testEnv.authenticatedContext(OWNER_TEACHER_UID).firestore();
      await assertFails(
        getDocs(
          collection(db, "assignments", ASSIGNMENT_ID, "recipients"),
        ),
      );
    });

    it("denies a cross-district teacher from getting a recipient", async () => {
      const db = testEnv
        .authenticatedContext(CROSS_DISTRICT_TEACHER_UID)
        .firestore();
      await assertFails(
        getDoc(
          doc(db, "assignments", ASSIGNMENT_ID, "recipients", STUDENT_UID),
        ),
      );
    });

    it("denies a non-owning teacher from listing the recipients subcollection", async () => {
      const db = testEnv.authenticatedContext(OTHER_TEACHER_UID).firestore();
      await assertFails(
        getDocs(
          collection(db, "assignments", ASSIGNMENT_ID, "recipients"),
        ),
      );
    });
  });

  describe("write", () => {
    it("denies the owning teacher from creating a recipient from the client", async () => {
      const db = testEnv.authenticatedContext(OWNER_TEACHER_UID).firestore();
      await assertFails(
        setDoc(
          doc(
            db,
            "assignments",
            ASSIGNMENT_ID,
            "recipients",
            "brand-new-student",
          ),
          {
            assignmentId: ASSIGNMENT_ID,
            studentId: "brand-new-student",
            classId: CLASS_ID,
            teacherId: OWNER_TEACHER_UID,
            schoolId: SCHOOL_ID,
            districtId: "district-1",
            assignedBy: OWNER_TEACHER_UID,
            assignedAt: new Date("2026-08-15T00:00:00Z"),
            source: "manualAddition",
            status: "assigned",
          },
        ),
      );
    });

    it("denies the owning student from creating their own recipient from the client", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
      await assertFails(
        setDoc(
          doc(
            db,
            "assignments",
            ASSIGNMENT_ID,
            "recipients",
            "student-self-created",
          ),
          {
            assignmentId: ASSIGNMENT_ID,
            studentId: "student-self-created",
            classId: CLASS_ID,
            teacherId: OWNER_TEACHER_UID,
            schoolId: SCHOOL_ID,
            districtId: "district-1",
            assignedBy: STUDENT_UID,
            assignedAt: new Date("2026-08-15T00:00:00Z"),
            source: "manualAddition",
            status: "assigned",
          },
        ),
      );
    });

    it("denies the owning teacher from updating any field on an existing recipient", async () => {
      const db = testEnv.authenticatedContext(OWNER_TEACHER_UID).firestore();
      await assertFails(
        updateDoc(
          doc(db, "assignments", ASSIGNMENT_ID, "recipients", STUDENT_UID),
          { status: "removed" },
        ),
      );
    });

    it("denies the owning student from updating their own recipient", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
      await assertFails(
        updateDoc(
          doc(db, "assignments", ASSIGNMENT_ID, "recipients", STUDENT_UID),
          { source: "manualAddition" },
        ),
      );
    });

    it("denies the owning teacher from deleting a recipient", async () => {
      const db = testEnv.authenticatedContext(OWNER_TEACHER_UID).firestore();
      await assertFails(
        deleteDoc(
          doc(db, "assignments", ASSIGNMENT_ID, "recipients", STUDENT_UID),
        ),
      );
    });

    it("denies the owning student from deleting their own recipient", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
      await assertFails(
        deleteDoc(
          doc(db, "assignments", ASSIGNMENT_ID, "recipients", STUDENT_UID),
        ),
      );
    });

    it("denies an unauthenticated caller from any recipient write", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        setDoc(
          doc(
            db,
            "assignments",
            ASSIGNMENT_ID,
            "recipients",
            "anonymous-created",
          ),
          {
            assignmentId: ASSIGNMENT_ID,
            studentId: "anonymous-created",
            classId: CLASS_ID,
            teacherId: OWNER_TEACHER_UID,
            schoolId: SCHOOL_ID,
            districtId: "district-1",
            assignedBy: "anonymous",
            assignedAt: new Date("2026-08-15T00:00:00Z"),
            source: "manualAddition",
            status: "assigned",
          },
        ),
      );
    });
  });
});
