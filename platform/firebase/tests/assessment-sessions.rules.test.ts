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

// Sprint 12B Slice 1: assessmentSessions/{sessionId} Rules coverage.
// The transient per-student working state for a Live attempt. Only the
// owning student may `get` their own session, and only when the caller's
// verified `districtId` claim matches the session's frozen `districtId`.
// Teachers do NOT read live sessions per PDR-026. Every direct client
// write is denied because begin, autosave, and finalize are Admin SDK
// callables.

const STUDENT_UID = "student-owner-uid";
const OTHER_STUDENT_UID = "student-other-uid";
const OTHER_DISTRICT_STUDENT_UID = "student-other-district-uid";
const TEACHER_UID = "teacher-owner-uid";

const SCHOOL_ID = "school-a";
const DISTRICT_ID = "district-a";
const OTHER_DISTRICT_ID = "district-b";

const CLASS_ID = "class-owner-1";
const ASSIGNMENT_ID = "assign-owner-1";
const ACTIVITY_ID = "lesson_g7_earths-layers";
const ASSESSMENT_ID = `assessment_${ACTIVITY_ID}`;
const REVISION_ID = `${ASSESSMENT_ID}__r1`;

const OWNER_SESSION_ID = `${ASSIGNMENT_ID}__${STUDENT_UID}__1`;
const OTHER_STUDENT_SESSION_ID = `${ASSIGNMENT_ID}__${OTHER_STUDENT_UID}__1`;
const OTHER_DISTRICT_SESSION_ID = `${ASSIGNMENT_ID}__${OTHER_DISTRICT_STUDENT_UID}__1`;

const OWNER_STUDENT_TOKEN = { role: "student", schoolId: SCHOOL_ID, districtId: DISTRICT_ID };
const OTHER_STUDENT_TOKEN = { role: "student", schoolId: SCHOOL_ID, districtId: DISTRICT_ID };
const OTHER_DISTRICT_STUDENT_TOKEN = {
  role: "student",
  schoolId: "school-b",
  districtId: OTHER_DISTRICT_ID,
};
const TEACHER_TOKEN = { role: "teacher", schoolId: SCHOOL_ID, districtId: DISTRICT_ID };

// A forged claim represents the adversarial case where a caller's uid does
// not match the resource's studentId or the caller's districtId claim does
// not match the resource's districtId. The Rule refuses because both
// comparisons are decided on the trusted resource document itself.
const FORGED_DISTRICT_STUDENT_TOKEN = {
  role: "student",
  schoolId: SCHOOL_ID,
  districtId: OTHER_DISTRICT_ID,
};

describe("Firestore Rules: assessmentSessions/{sessionId}", () => {
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

      const baseSession = {
        assignmentId: ASSIGNMENT_ID,
        classId: CLASS_ID,
        teacherId: TEACHER_UID,
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
        activityId: ACTIVITY_ID,
        assessmentId: ASSESSMENT_ID,
        assessmentRevisionId: REVISION_ID,
        sessionOrdinal: 1,
        status: "live" as const,
        startedAt: new Date("2026-09-01T00:00:00Z"),
      };

      await setDoc(doc(db, "assessmentSessions", OWNER_SESSION_ID), {
        ...baseSession,
        studentId: STUDENT_UID,
      });
      await setDoc(doc(db, "assessmentSessions", OTHER_STUDENT_SESSION_ID), {
        ...baseSession,
        studentId: OTHER_STUDENT_UID,
      });
      await setDoc(doc(db, "assessmentSessions", OTHER_DISTRICT_SESSION_ID), {
        ...baseSession,
        studentId: OTHER_DISTRICT_STUDENT_UID,
        schoolId: "school-b",
        districtId: OTHER_DISTRICT_ID,
      });
    });
  });

  describe("read", () => {
    it("allows the owning student in the same district to get their own session", async () => {
      const db = testEnv
        .authenticatedContext(STUDENT_UID, OWNER_STUDENT_TOKEN)
        .firestore();
      await assertSucceeds(
        getDoc(doc(db, "assessmentSessions", OWNER_SESSION_ID)),
      );
    });

    it("denies an unauthenticated caller from getting a session", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        getDoc(doc(db, "assessmentSessions", OWNER_SESSION_ID)),
      );
    });

    it("denies another student in the same district from getting the owning student's session", async () => {
      const db = testEnv
        .authenticatedContext(OTHER_STUDENT_UID, OTHER_STUDENT_TOKEN)
        .firestore();
      await assertFails(
        getDoc(doc(db, "assessmentSessions", OWNER_SESSION_ID)),
      );
    });

    it("denies a student in another district from getting a session in this district", async () => {
      const db = testEnv
        .authenticatedContext(OTHER_DISTRICT_STUDENT_UID, OTHER_DISTRICT_STUDENT_TOKEN)
        .firestore();
      await assertFails(
        getDoc(doc(db, "assessmentSessions", OWNER_SESSION_ID)),
      );
    });

    it("denies the class teacher from getting a Live session for their own class", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID, TEACHER_TOKEN).firestore();
      await assertFails(
        getDoc(doc(db, "assessmentSessions", OWNER_SESSION_ID)),
      );
    });

    it("denies a caller whose uid matches studentId but whose district claim is forged", async () => {
      const db = testEnv
        .authenticatedContext(STUDENT_UID, FORGED_DISTRICT_STUDENT_TOKEN)
        .firestore();
      await assertFails(
        getDoc(doc(db, "assessmentSessions", OWNER_SESSION_ID)),
      );
    });

    it("denies collection enumeration of sessions even filtered by the caller's uid", async () => {
      const db = testEnv
        .authenticatedContext(STUDENT_UID, OWNER_STUDENT_TOKEN)
        .firestore();
      await assertFails(
        getDocs(
          query(
            collection(db, "assessmentSessions"),
            where("studentId", "==", STUDENT_UID),
          ),
        ),
      );
    });
  });

  describe("write", () => {
    it("denies the owning student from creating a session directly", async () => {
      const db = testEnv
        .authenticatedContext(STUDENT_UID, OWNER_STUDENT_TOKEN)
        .firestore();
      await assertFails(
        setDoc(doc(db, "assessmentSessions", `${ASSIGNMENT_ID}__${STUDENT_UID}__2`), {
          studentId: STUDENT_UID,
          assignmentId: ASSIGNMENT_ID,
          classId: CLASS_ID,
          teacherId: TEACHER_UID,
          schoolId: SCHOOL_ID,
          districtId: DISTRICT_ID,
          activityId: ACTIVITY_ID,
          assessmentId: ASSESSMENT_ID,
          assessmentRevisionId: REVISION_ID,
          sessionOrdinal: 2,
          status: "live",
          startedAt: new Date("2026-09-01T00:10:00Z"),
        }),
      );
    });

    it("denies the owning student from updating their own session (autosave is server-only)", async () => {
      const db = testEnv
        .authenticatedContext(STUDENT_UID, OWNER_STUDENT_TOKEN)
        .firestore();
      await assertFails(
        updateDoc(doc(db, "assessmentSessions", OWNER_SESSION_ID), {
          responses: [{ itemId: "q1", response: "o1" }],
        }),
      );
    });

    it("denies the owning student from deleting their own session", async () => {
      const db = testEnv
        .authenticatedContext(STUDENT_UID, OWNER_STUDENT_TOKEN)
        .firestore();
      await assertFails(
        deleteDoc(doc(db, "assessmentSessions", OWNER_SESSION_ID)),
      );
    });

    it("denies another student from mutating the owning student's session", async () => {
      const db = testEnv
        .authenticatedContext(OTHER_STUDENT_UID, OTHER_STUDENT_TOKEN)
        .firestore();
      await assertFails(
        updateDoc(doc(db, "assessmentSessions", OWNER_SESSION_ID), {
          responses: [{ itemId: "q1", response: "o1" }],
        }),
      );
    });

    it("denies the class teacher from mutating a session for their own class", async () => {
      const db = testEnv.authenticatedContext(TEACHER_UID, TEACHER_TOKEN).firestore();
      await assertFails(
        updateDoc(doc(db, "assessmentSessions", OWNER_SESSION_ID), {
          status: "archived",
        }),
      );
    });
  });
});
