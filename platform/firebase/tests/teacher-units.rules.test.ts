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

// U1A - Rules tests for `teacherUnits/{unitId}` and the server-only
// `teacherUnitCreateReceipts/{receiptId}`.
//
// Access model: the owning teacher may get/list their own units while their
// canonical record is an active teacher and the unit belongs to their
// current school. Every direct client write is denied for every role; the
// `teacherUnits*` callables are the sole writers (Admin SDK).

const OWNER_UID = "teacher-owner-uid";
const OTHER_TEACHER_UID = "teacher-other-uid";
const STUDENT_UID = "student-uid";
const SCHOOL_ID = "school-a";
const OTHER_SCHOOL_ID = "school-b";
const UNIT_ID = "unitOwnerAAAAAAAAAAA";
const OWNER_OTHER_SCHOOL_UNIT_ID = "unitOwnerOldSchoolAA";
const OTHER_TEACHER_UNIT_ID = "unitOtherTeacherAAAA";

function userDoc(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    authUid: uid,
    status: "active",
    role: "teacher",
    schoolId: SCHOOL_ID,
    displayName: "Teacher",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    ...overrides,
  };
}

function unitDoc(teacherId: string, schoolId: string, title = "Earth Systems") {
  return {
    teacherId,
    schoolId,
    grade: "7",
    title,
    description: "",
    status: "active",
    archivedAt: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    resourceIds: [],
    sortOrder: 0,
    revision: 1,
  };
}

describe("Firestore Rules: teacherUnits/{unitId}", () => {
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
      await setDoc(doc(db, "users", OWNER_UID), userDoc(OWNER_UID));
      await setDoc(doc(db, "users", OTHER_TEACHER_UID), userDoc(OTHER_TEACHER_UID));
      await setDoc(doc(db, "users", STUDENT_UID), userDoc(STUDENT_UID, { role: "student" }));
      await setDoc(doc(db, "teacherUnits", UNIT_ID), unitDoc(OWNER_UID, SCHOOL_ID));
      // A unit the owner created at a previous school (the owner has since
      // moved to SCHOOL_ID).
      await setDoc(
        doc(db, "teacherUnits", OWNER_OTHER_SCHOOL_UNIT_ID),
        unitDoc(OWNER_UID, OTHER_SCHOOL_ID, "Old School Unit"),
      );
      await setDoc(
        doc(db, "teacherUnits", OTHER_TEACHER_UNIT_ID),
        unitDoc(OTHER_TEACHER_UID, SCHOOL_ID, "Other Teacher Unit"),
      );
    });
  });

  async function setOwnerRecord(overrides: Record<string, unknown>): Promise<void> {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", OWNER_UID), userDoc(OWNER_UID, overrides));
    });
  }

  function ownQuery(db: ReturnType<ReturnType<RulesTestEnvironment["authenticatedContext"]>["firestore"]>) {
    return query(
      collection(db, "teacherUnits"),
      where("teacherId", "==", OWNER_UID),
      where("schoolId", "==", SCHOOL_ID),
    );
  }

  describe("get", () => {
    it("allows the owning active teacher to get their own unit", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertSucceeds(getDoc(doc(db, "teacherUnits", UNIT_ID)));
    });

    it("denies another teacher in the same school", async () => {
      const db = testEnv.authenticatedContext(OTHER_TEACHER_UID).firestore();
      await assertFails(getDoc(doc(db, "teacherUnits", UNIT_ID)));
    });

    it("denies the owner a unit from a school that is no longer theirs", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(getDoc(doc(db, "teacherUnits", OWNER_OTHER_SCHOOL_UNIT_ID)));
    });

    it("denies a suspended owner holding a stale teacher token", async () => {
      await setOwnerRecord({ status: "suspended" });
      const db = testEnv
        .authenticatedContext(OWNER_UID, { role: "teacher", schoolId: SCHOOL_ID })
        .firestore();
      await assertFails(getDoc(doc(db, "teacherUnits", UNIT_ID)));
    });

    it("denies an owner whose canonical role is no longer teacher", async () => {
      await setOwnerRecord({ role: "platformAdministrator" });
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(getDoc(doc(db, "teacherUnits", UNIT_ID)));
    });

    it("denies an owner with no canonical user record", async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await deleteDoc(doc(ctx.firestore(), "users", OWNER_UID));
      });
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(getDoc(doc(db, "teacherUnits", UNIT_ID)));
    });

    it("denies a student", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
      await assertFails(getDoc(doc(db, "teacherUnits", UNIT_ID)));
    });

    it("denies an unauthenticated caller", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, "teacherUnits", UNIT_ID)));
    });
  });

  describe("list", () => {
    it("allows the owner to list own units scoped by teacherId and schoolId", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      const snapshot = await assertSucceeds(getDocs(ownQuery(db)));
      expect(snapshot.docs.map((d) => d.id)).toEqual([UNIT_ID]);
    });

    it("denies a list scoped only by teacherId (could include another school's units)", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        getDocs(query(collection(db, "teacherUnits"), where("teacherId", "==", OWNER_UID))),
      );
    });

    it("denies an unscoped collection list", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(getDocs(collection(db, "teacherUnits")));
    });

    it("denies a list scoped only by schoolId (would enumerate other teachers)", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        getDocs(query(collection(db, "teacherUnits"), where("schoolId", "==", SCHOOL_ID))),
      );
    });

    it("denies a teacher listing another teacher's units", async () => {
      const db = testEnv.authenticatedContext(OTHER_TEACHER_UID).firestore();
      await assertFails(getDocs(ownQuery(db)));
    });

    it("denies a list of the owner's units at another school", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        getDocs(
          query(
            collection(db, "teacherUnits"),
            where("teacherId", "==", OWNER_UID),
            where("schoolId", "==", OTHER_SCHOOL_ID),
          ),
        ),
      );
    });

    it("denies a suspended owner from listing", async () => {
      await setOwnerRecord({ status: "suspended" });
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(getDocs(ownQuery(db)));
    });

    it("denies an unauthenticated list", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDocs(ownQuery(db)));
    });
  });

  describe("direct client writes", () => {
    it("denies the owner creating a unit", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        setDoc(doc(db, "teacherUnits", "unitNewAAAAAAAAAAAAA"), unitDoc(OWNER_UID, SCHOOL_ID)),
      );
    });

    it("denies the owner updating their own unit (title)", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(updateDoc(doc(db, "teacherUnits", UNIT_ID), { title: "Renamed" }));
    });

    it("denies the owner updating identity fields", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(updateDoc(doc(db, "teacherUnits", UNIT_ID), { teacherId: OTHER_TEACHER_UID }));
      await assertFails(updateDoc(doc(db, "teacherUnits", UNIT_ID), { grade: "8" }));
      await assertFails(updateDoc(doc(db, "teacherUnits", UNIT_ID), { revision: 99 }));
    });

    it("denies the owner deleting their own unit", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(deleteDoc(doc(db, "teacherUnits", UNIT_ID)));
    });

    it("denies another teacher writing the owner's unit", async () => {
      const db = testEnv.authenticatedContext(OTHER_TEACHER_UID).firestore();
      await assertFails(updateDoc(doc(db, "teacherUnits", UNIT_ID), { title: "Hijacked" }));
      await assertFails(deleteDoc(doc(db, "teacherUnits", UNIT_ID)));
    });

    it("denies unauthenticated writes", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        setDoc(doc(db, "teacherUnits", "unitNewAAAAAAAAAAAAA"), unitDoc(OWNER_UID, SCHOOL_ID)),
      );
      await assertFails(deleteDoc(doc(db, "teacherUnits", UNIT_ID)));
    });
  });

  describe("teacherUnitCreateReceipts/{receiptId} (server-only)", () => {
    const RECEIPT_ID = "a".repeat(64);

    beforeEach(async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), "teacherUnitCreateReceipts", RECEIPT_ID), {
          teacherId: OWNER_UID,
          schoolId: SCHOOL_ID,
          unitId: UNIT_ID,
          requestHash: "b".repeat(64),
          createdAt: new Date("2026-10-01T00:00:00Z"),
          expiresAt: new Date("2026-10-08T00:00:00Z"),
        });
      });
    });

    it("denies the owning teacher reading or listing their own receipt", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(getDoc(doc(db, "teacherUnitCreateReceipts", RECEIPT_ID)));
      await assertFails(
        getDocs(query(collection(db, "teacherUnitCreateReceipts"), where("teacherId", "==", OWNER_UID))),
      );
    });

    it("denies every client write, including the owner", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        setDoc(doc(db, "teacherUnitCreateReceipts", "c".repeat(64)), {
          teacherId: OWNER_UID,
          schoolId: SCHOOL_ID,
          unitId: UNIT_ID,
        }),
      );
      await assertFails(updateDoc(doc(db, "teacherUnitCreateReceipts", RECEIPT_ID), { unitId: "x" }));
      await assertFails(deleteDoc(doc(db, "teacherUnitCreateReceipts", RECEIPT_ID)));
    });

    it("denies unauthenticated access", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, "teacherUnitCreateReceipts", RECEIPT_ID)));
    });
  });
});
