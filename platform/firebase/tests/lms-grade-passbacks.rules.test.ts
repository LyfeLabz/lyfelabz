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

// Sprint 30A.2 Firestore Rules coverage for `lmsGradePassbacks`, the
// server-only Google Classroom best-score grade-passback synchronization
// state. Mirrors the certified `lmsAssignmentPublications` coverage
// pattern exactly (Sprint 8D.1): owner-scoped reads succeed, cross-teacher
// reads fail, unauthenticated reads fail, a student is denied, and every
// client write (create, update, delete) fails.

const OWNER_UID = "teacher-owner-uid";
const OTHER_TEACHER_UID = "teacher-other-uid";
const STUDENT_UID = "student-uid";
const PROVIDER_ID = "googleClassroom";
const CONNECTION_ID = "googleclassroom__teacher-owner-uid";
const GRADE_PASSBACK_ID = "assign-owner-1__student-uid";
const OTHER_GRADE_PASSBACK_ID = "assign-other-1__student-uid";

describe("Firestore Rules: lmsGradePassbacks (Sprint 30A.2)", () => {
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
      await setDoc(doc(db, "users", OWNER_UID), {
        authUid: OWNER_UID,
        status: "active",
        role: "teacher",
        schoolId: "school-a",
        displayName: "Active Teacher",
        createdAt: new Date("2026-08-15T00:00:00Z"),
      });
      await setDoc(doc(db, "users", STUDENT_UID), {
        authUid: STUDENT_UID,
        status: "active",
        role: "student",
        schoolId: "school-a",
        displayName: "Active Student",
        createdAt: new Date("2026-08-15T00:00:00Z"),
      });
      await setDoc(doc(db, "lmsGradePassbacks", GRADE_PASSBACK_ID), {
        assignmentId: "assign-owner-1",
        studentId: STUDENT_UID,
        classId: "class-owner-1",
        ownerUid: OWNER_UID,
        schoolId: "school-a",
        districtId: "district-1",
        providerId: PROVIDER_ID,
        connectionId: CONNECTION_ID,
        lmsClassId: "gc-course-1",
        lmsAssignmentId: "gc-assign-1",
        lmsPublicationRef: "assign-owner-1__googleclassroom__pubhash",
        maxPoints: 20,
        desiredBestPercentage: 90,
        desiredEarnedPoints: 18,
        bestAttemptId: "assign-owner-1__student-uid__a1",
        syncGeneration: 1,
        lastSyncedGeneration: 1,
        lastSyncedEarnedPoints: 18,
        status: "synced",
        createdAt: new Date("2026-08-15T00:00:00Z"),
        updatedAt: new Date("2026-08-15T00:00:00Z"),
      });
      await setDoc(doc(db, "lmsGradePassbacks", OTHER_GRADE_PASSBACK_ID), {
        assignmentId: "assign-other-1",
        studentId: STUDENT_UID,
        classId: "class-other-1",
        ownerUid: OTHER_TEACHER_UID,
        schoolId: "school-a",
        districtId: "district-1",
        providerId: PROVIDER_ID,
        connectionId: "googleclassroom__teacher-other-uid",
        lmsClassId: "gc-course-2",
        lmsAssignmentId: "gc-assign-2",
        lmsPublicationRef: "assign-other-1__googleclassroom__pubhash",
        maxPoints: 10,
        desiredBestPercentage: 50,
        desiredEarnedPoints: 5,
        bestAttemptId: "assign-other-1__student-uid__a1",
        syncGeneration: 1,
        lastSyncedGeneration: 0,
        status: "pending",
        createdAt: new Date("2026-08-15T00:00:00Z"),
        updatedAt: new Date("2026-08-15T00:00:00Z"),
      });
    });
  });

  it("owning teacher may get a passback record for an assignment they own", async () => {
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertSucceeds(getDoc(doc(db, "lmsGradePassbacks", GRADE_PASSBACK_ID)));
  });

  it("owning teacher may list their own passback records filtered by ownerUid", async () => {
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertSucceeds(
      getDocs(
        query(collection(db, "lmsGradePassbacks"), where("ownerUid", "==", OWNER_UID)),
      ),
    );
  });

  it("denies a different teacher from getting a passback record they do not own", async () => {
    const db = testEnv.authenticatedContext(OTHER_TEACHER_UID).firestore();
    await assertFails(getDoc(doc(db, "lmsGradePassbacks", GRADE_PASSBACK_ID)));
  });

  it("denies an unscoped list and a cross-teacher list", async () => {
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertFails(getDocs(collection(db, "lmsGradePassbacks")));
    await assertFails(
      getDocs(
        query(collection(db, "lmsGradePassbacks"), where("ownerUid", "==", OTHER_TEACHER_UID)),
      ),
    );
  });

  it("denies the affected student from reading their own passback record", async () => {
    const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
    await assertFails(getDoc(doc(db, "lmsGradePassbacks", GRADE_PASSBACK_ID)));
    await assertFails(
      getDocs(
        query(collection(db, "lmsGradePassbacks"), where("studentId", "==", STUDENT_UID)),
      ),
    );
  });

  it("denies unauthenticated get and list", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "lmsGradePassbacks", GRADE_PASSBACK_ID)));
    await assertFails(getDocs(collection(db, "lmsGradePassbacks")));
  });

  it("denies every client write, including a self-owned create", async () => {
    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    await assertFails(
      setDoc(doc(db, "lmsGradePassbacks", "would-be-mine"), {
        assignmentId: "assign-owner-1",
        studentId: STUDENT_UID,
        classId: "class-owner-1",
        ownerUid: OWNER_UID,
        schoolId: "school-a",
        districtId: "district-1",
        providerId: PROVIDER_ID,
        connectionId: CONNECTION_ID,
        lmsClassId: "gc-course-1",
        lmsAssignmentId: "gc-assign-1",
        lmsPublicationRef: "x",
        maxPoints: 20,
        desiredBestPercentage: 100,
        desiredEarnedPoints: 20,
        bestAttemptId: "x",
        syncGeneration: 1,
        lastSyncedGeneration: 0,
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    await assertFails(
      updateDoc(doc(db, "lmsGradePassbacks", GRADE_PASSBACK_ID), {
        desiredEarnedPoints: 999,
      }),
    );
    await assertFails(deleteDoc(doc(db, "lmsGradePassbacks", GRADE_PASSBACK_ID)));
  });

  it("denies a suspended owning teacher (stale claim) from getting or listing their passback records", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", OWNER_UID), {
        authUid: OWNER_UID,
        status: "suspended",
        role: "teacher",
        schoolId: "school-a",
        displayName: "Suspended Teacher",
        createdAt: new Date("2026-08-15T00:00:00Z"),
      });
    });
    const db = testEnv
      .authenticatedContext(OWNER_UID, { role: "teacher", schoolId: "school-a" })
      .firestore();
    await assertFails(getDoc(doc(db, "lmsGradePassbacks", GRADE_PASSBACK_ID)));
    await assertFails(
      getDocs(
        query(collection(db, "lmsGradePassbacks"), where("ownerUid", "==", OWNER_UID)),
      ),
    );
  });
});
