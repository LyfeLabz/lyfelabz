import {
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, updateDoc } from "firebase/firestore";

import { createTestEnvironment } from "./setup";

// F5.2 Persistent Student Differentiation, Slice 1 (accommodation record +
// teacher operations, dark). `studentAccommodations/{studentId}` and its
// `history/{revisionId}` subcollection are server-owned per F5.2 §3.1 and
// §11: zero direct client read/write for ANY role, including the owning
// student and the authorizing teacher. `accommodationsGet` and
// `accommodationsSet` are the sole readers/writers and both run through
// the Admin SDK, bypassing Rules entirely (T-A9 per F5.2 §13).

const TEACHER_UID = "teacher-uid";
const STUDENT_UID = "student-uid";
const OTHER_STUDENT_UID = "other-student-uid";
const STUDENT_ACCOMMODATION_ID = STUDENT_UID;
const REVISION_ID = "r1";

describe("Firestore Rules: studentAccommodations/{studentId}", () => {
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
      await setDoc(doc(db, "studentAccommodations", STUDENT_ACCOMMODATION_ID), {
        studentId: STUDENT_UID,
        schoolId: "school-a",
        readingAccessibility: { status: "active", level: "adapted" },
        configRevision: 1,
        createdAt: new Date("2026-08-15T00:00:00Z"),
        createdBy: TEACHER_UID,
        updatedAt: new Date("2026-08-15T00:00:00Z"),
        updatedBy: TEACHER_UID,
      });
      await setDoc(
        doc(
          db,
          "studentAccommodations",
          STUDENT_ACCOMMODATION_ID,
          "history",
          REVISION_ID,
        ),
        {
          revision: 1,
          readingAccessibility: { status: "active", level: "adapted" },
          setBy: TEACHER_UID,
          setAt: new Date("2026-08-15T00:00:00Z"),
          classId: "class-abc",
        },
      );
    });
  });

  describe("current record", () => {
    it("denies the owning student's own read", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
      await assertFails(
        getDoc(doc(db, "studentAccommodations", STUDENT_ACCOMMODATION_ID)),
      );
    });

    it("denies a different authenticated student's read", async () => {
      const db = testEnv.authenticatedContext(OTHER_STUDENT_UID).firestore();
      await assertFails(
        getDoc(doc(db, "studentAccommodations", STUDENT_ACCOMMODATION_ID)),
      );
    });

    it("denies the authorizing teacher's direct read", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
      await assertFails(
        getDoc(doc(db, "studentAccommodations", STUDENT_ACCOMMODATION_ID)),
      );
    });

    it("denies an unauthenticated read", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        getDoc(doc(db, "studentAccommodations", STUDENT_ACCOMMODATION_ID)),
      );
    });

    it("denies authenticated create", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
      await assertFails(
        setDoc(doc(db, "studentAccommodations", "new-student-id"), {
          studentId: "new-student-id",
          schoolId: "school-a",
          readingAccessibility: { status: "inactive" },
          configRevision: 1,
        }),
      );
    });

    it("denies authenticated update", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
      await assertFails(
        updateDoc(doc(db, "studentAccommodations", STUDENT_ACCOMMODATION_ID), {
          configRevision: 2,
        }),
      );
    });

    it("denies authenticated delete", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
      await assertFails(
        deleteDoc(doc(db, "studentAccommodations", STUDENT_ACCOMMODATION_ID)),
      );
    });

    it("denies unauthenticated write", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        setDoc(doc(db, "studentAccommodations", "new-student-id"), {
          studentId: "new-student-id",
        }),
      );
    });
  });

  describe("history/{revisionId}", () => {
    it("denies the owning student's read", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
      await assertFails(
        getDoc(
          doc(
            db,
            "studentAccommodations",
            STUDENT_ACCOMMODATION_ID,
            "history",
            REVISION_ID,
          ),
        ),
      );
    });

    it("denies the authorizing teacher's direct read", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
      await assertFails(
        getDoc(
          doc(
            db,
            "studentAccommodations",
            STUDENT_ACCOMMODATION_ID,
            "history",
            REVISION_ID,
          ),
        ),
      );
    });

    it("denies unauthenticated read", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        getDoc(
          doc(
            db,
            "studentAccommodations",
            STUDENT_ACCOMMODATION_ID,
            "history",
            REVISION_ID,
          ),
        ),
      );
    });

    it("denies authenticated create of a new history entry", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
      await assertFails(
        setDoc(
          doc(
            db,
            "studentAccommodations",
            STUDENT_ACCOMMODATION_ID,
            "history",
            "r2",
          ),
          { revision: 2 },
        ),
      );
    });

    it("denies authenticated update of an existing history entry (append-only, never mutated)", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
      await assertFails(
        updateDoc(
          doc(
            db,
            "studentAccommodations",
            STUDENT_ACCOMMODATION_ID,
            "history",
            REVISION_ID,
          ),
          { revision: 99 },
        ),
      );
    });

    it("denies authenticated delete of a history entry", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
      await assertFails(
        deleteDoc(
          doc(
            db,
            "studentAccommodations",
            STUDENT_ACCOMMODATION_ID,
            "history",
            REVISION_ID,
          ),
        ),
      );
    });
  });
});
