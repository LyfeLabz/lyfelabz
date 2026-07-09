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

const OWNER_UID = "teacher-owner-uid";
const OTHER_TEACHER_UID = "teacher-other-uid";
const CROSS_SCHOOL_TEACHER_UID = "teacher-cross-school-uid";
const SCHOOL_ID = "school-a";
const OTHER_SCHOOL_ID = "school-b";
const CLASS_ID = "class-owner-1";
const OTHER_CLASS_ID = "class-other-1";
const CROSS_SCHOOL_CLASS_ID = "class-cross-school-1";
const ASSIGNMENT_ID = "assign-owner-1";
const OTHER_ASSIGNMENT_ID = "assign-other-1";
const CROSS_SCHOOL_ASSIGNMENT_ID = "assign-cross-school-1";

describe("Firestore Rules: assignments/{assignmentId}", () => {
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
        teacherId: OWNER_UID,
        schoolId: SCHOOL_ID,
        lessonSlug: "lesson_g7_earths-layers",
        lessonVersion: "1",
        mode: "classroom",
        status: "draft",
        createdAt: new Date("2026-08-15T00:00:00Z"),
      });
      await setDoc(doc(db, "assignments", OTHER_ASSIGNMENT_ID), {
        classId: OTHER_CLASS_ID,
        teacherId: OTHER_TEACHER_UID,
        schoolId: SCHOOL_ID,
        lessonSlug: "lesson_g7_water-cycle",
        lessonVersion: "1",
        mode: "practice",
        status: "draft",
        createdAt: new Date("2026-08-15T00:00:00Z"),
      });
      await setDoc(doc(db, "assignments", CROSS_SCHOOL_ASSIGNMENT_ID), {
        classId: CROSS_SCHOOL_CLASS_ID,
        teacherId: CROSS_SCHOOL_TEACHER_UID,
        schoolId: OTHER_SCHOOL_ID,
        lessonSlug: "lesson_g7_ecosystem-stability",
        lessonVersion: "1",
        mode: "classroom",
        status: "published",
        createdAt: new Date("2026-08-15T00:00:00Z"),
      });
    });
  });

  describe("read", () => {
    it("allows the owning teacher to get their own assignment document", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertSucceeds(getDoc(doc(db, "assignments", ASSIGNMENT_ID)));
    });

    it("denies a different teacher from getting an assignment they do not own", async () => {
      const db = testEnv.authenticatedContext(OTHER_TEACHER_UID).firestore();
      await assertFails(getDoc(doc(db, "assignments", ASSIGNMENT_ID)));
    });

    it("denies a teacher from another school from getting an assignment outside their school", async () => {
      const db = testEnv
        .authenticatedContext(CROSS_SCHOOL_TEACHER_UID)
        .firestore();
      await assertFails(getDoc(doc(db, "assignments", ASSIGNMENT_ID)));
    });

    it("denies an unauthenticated caller from getting any assignment", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, "assignments", ASSIGNMENT_ID)));
    });
  });

  describe("list", () => {
    it("allows a teacher to list assignments filtered by their own teacherId", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertSucceeds(
        getDocs(
          query(
            collection(db, "assignments"),
            where("teacherId", "==", OWNER_UID),
          ),
        ),
      );
    });

    it("denies an unscoped assignments collection list", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(getDocs(collection(db, "assignments")));
    });

    it("denies a teacher from listing assignments filtered by another teacher's uid", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        getDocs(
          query(
            collection(db, "assignments"),
            where("teacherId", "==", OTHER_TEACHER_UID),
          ),
        ),
      );
    });

    it("denies a list filtered by classId only (invalid list query)", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        getDocs(
          query(
            collection(db, "assignments"),
            where("classId", "==", CLASS_ID),
          ),
        ),
      );
    });

    it("denies an unauthenticated caller from listing assignments at all", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        getDocs(
          query(
            collection(db, "assignments"),
            where("teacherId", "==", OWNER_UID),
          ),
        ),
      );
    });
  });

  describe("write", () => {
    it("denies the owning teacher from creating an assignment document from the client", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        setDoc(doc(db, "assignments", "new-assign-id"), {
          classId: CLASS_ID,
          teacherId: OWNER_UID,
          schoolId: SCHOOL_ID,
          lessonSlug: "lesson_g7_earths-layers",
          lessonVersion: "1",
          mode: "classroom",
          status: "draft",
          createdAt: new Date("2026-08-15T00:00:00Z"),
        }),
      );
    });

    it("denies the owning teacher from updating any field on their assignment from the client", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        updateDoc(doc(db, "assignments", ASSIGNMENT_ID), {
          title: "Client-authored title",
        }),
      );
    });

    it("denies the owning teacher from advancing status from the client", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        updateDoc(doc(db, "assignments", ASSIGNMENT_ID), {
          status: "published",
        }),
      );
    });

    it("denies the owning teacher from deleting their assignment from the client", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(deleteDoc(doc(db, "assignments", ASSIGNMENT_ID)));
    });

    it("denies a non-owner teacher from updating an assignment from the client", async () => {
      const db = testEnv.authenticatedContext(OTHER_TEACHER_UID).firestore();
      await assertFails(
        updateDoc(doc(db, "assignments", ASSIGNMENT_ID), {
          title: "Hijacked",
        }),
      );
    });

    it("denies an unauthenticated caller from any write against assignments", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        setDoc(doc(db, "assignments", "another-assign"), {
          classId: CLASS_ID,
          teacherId: OWNER_UID,
          schoolId: SCHOOL_ID,
          lessonSlug: "lesson_g7_earths-layers",
          lessonVersion: "1",
          mode: "practice",
          status: "draft",
          createdAt: new Date("2026-08-15T00:00:00Z"),
        }),
      );
    });
  });
});
