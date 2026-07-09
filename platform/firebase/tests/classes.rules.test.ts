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

describe("Firestore Rules: classes/{classId}", () => {
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
        teacherId: OWNER_UID,
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
    });
  });

  describe("read", () => {
    it("allows the owning teacher to get their own class document", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertSucceeds(getDoc(doc(db, "classes", CLASS_ID)));
    });

    it("denies a different teacher from getting a class they do not own", async () => {
      const db = testEnv.authenticatedContext(OTHER_TEACHER_UID).firestore();
      await assertFails(getDoc(doc(db, "classes", CLASS_ID)));
    });

    it("denies a teacher from another school from getting a class outside their school", async () => {
      const db = testEnv
        .authenticatedContext(CROSS_SCHOOL_TEACHER_UID)
        .firestore();
      await assertFails(getDoc(doc(db, "classes", CLASS_ID)));
    });

    it("denies an unauthenticated caller from getting any class", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, "classes", CLASS_ID)));
    });
  });

  describe("list", () => {
    it("allows a teacher to list classes filtered by their own teacherId", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertSucceeds(
        getDocs(
          query(collection(db, "classes"), where("teacherId", "==", OWNER_UID)),
        ),
      );
    });

    it("denies an unscoped classes collection list", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(getDocs(collection(db, "classes")));
    });

    it("denies a teacher from listing classes filtered by another teacher's uid", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        getDocs(
          query(
            collection(db, "classes"),
            where("teacherId", "==", OTHER_TEACHER_UID),
          ),
        ),
      );
    });

    it("denies an unauthenticated caller from listing classes at all", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        getDocs(
          query(collection(db, "classes"), where("teacherId", "==", OWNER_UID)),
        ),
      );
    });
  });

  describe("write", () => {
    it("denies the owning teacher from creating a class document from the client", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        setDoc(doc(db, "classes", "new-class-id"), {
          teacherId: OWNER_UID,
          schoolId: SCHOOL_ID,
          title: "Client-created class",
          grade: "7",
          block: "D",
          joinCode: "ZZZZZZZZ",
          status: "active",
          createdAt: new Date("2026-08-15T00:00:00Z"),
        }),
      );
    });

    it("denies the owning teacher from updating any field on their class from the client", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        updateDoc(doc(db, "classes", CLASS_ID), { title: "Renamed" }),
      );
    });

    it("denies the owning teacher from deleting their class from the client", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(deleteDoc(doc(db, "classes", CLASS_ID)));
    });

    it("denies a non-owner teacher from updating a class from the client", async () => {
      const db = testEnv.authenticatedContext(OTHER_TEACHER_UID).firestore();
      await assertFails(
        updateDoc(doc(db, "classes", CLASS_ID), { title: "Hijacked" }),
      );
    });

    it("denies an unauthenticated caller from any write against classes", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        setDoc(doc(db, "classes", "another-class"), {
          teacherId: OWNER_UID,
          schoolId: SCHOOL_ID,
          title: "Anon",
          grade: "7",
          block: "E",
          joinCode: "AAAAAAAA",
          status: "active",
          createdAt: new Date("2026-08-15T00:00:00Z"),
        }),
      );
    });
  });
});
