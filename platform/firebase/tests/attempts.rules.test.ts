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

// Sprint 12B Slice 1: attempts/{attemptId} Rules coverage.
// The immutable authoritative scored attempt record. Reads: owning student
// or owning teacher, in both cases the caller's verified `districtId` claim
// MUST match the attempt's frozen `districtId`. `teacherId` on the attempt
// is the class-owning teacher denormalized through the session from the
// assignment; immutable class ownership per PDR-005 makes this a safe
// class-ownership proxy the Rule can evaluate on the document itself.
// Same-district access alone is NOT sufficient. Every direct client write
// is denied by an explicit `create, update, delete: if false;` block.

const STUDENT_UID = "student-owner-uid";
const OTHER_STUDENT_UID = "student-other-uid";
const OTHER_DISTRICT_STUDENT_UID = "student-other-district-uid";
const TEACHER_UID = "teacher-owner-uid";
const OTHER_TEACHER_UID = "teacher-other-uid";
const OTHER_DISTRICT_TEACHER_UID = "teacher-other-district-uid";

const SCHOOL_ID = "school-a";
const OTHER_SCHOOL_ID = "school-b";
const DISTRICT_ID = "district-a";
const OTHER_DISTRICT_ID = "district-b";

const CLASS_ID = "class-owner-1";
const OTHER_CLASS_ID = "class-other-1";
const ASSIGNMENT_ID = "assign-owner-1";
const OTHER_ASSIGNMENT_ID = "assign-other-1";
const ACTIVITY_ID = "lesson_g7_earths-layers";
const ASSESSMENT_ID = `assessment_${ACTIVITY_ID}`;
const REVISION_ID = `${ASSESSMENT_ID}__r1`;

const OWNER_ATTEMPT_ID = `${ASSIGNMENT_ID}__${STUDENT_UID}__a1`;
const OTHER_TEACHER_ATTEMPT_ID = `${OTHER_ASSIGNMENT_ID}__${OTHER_STUDENT_UID}__a1`;
const OTHER_DISTRICT_ATTEMPT_ID = `${OTHER_ASSIGNMENT_ID}__${OTHER_DISTRICT_STUDENT_UID}__a1`;

const OWNER_STUDENT_TOKEN = { role: "student", schoolId: SCHOOL_ID, districtId: DISTRICT_ID };
const OTHER_STUDENT_TOKEN = { role: "student", schoolId: SCHOOL_ID, districtId: DISTRICT_ID };
const OTHER_DISTRICT_STUDENT_TOKEN = {
  role: "student",
  schoolId: OTHER_SCHOOL_ID,
  districtId: OTHER_DISTRICT_ID,
};
const OWNER_TEACHER_TOKEN = { role: "teacher", schoolId: SCHOOL_ID, districtId: DISTRICT_ID };
const OTHER_TEACHER_TOKEN = { role: "teacher", schoolId: SCHOOL_ID, districtId: DISTRICT_ID };
const OTHER_DISTRICT_TEACHER_TOKEN = {
  role: "teacher",
  schoolId: OTHER_SCHOOL_ID,
  districtId: OTHER_DISTRICT_ID,
};

const FORGED_DISTRICT_TEACHER_TOKEN = {
  role: "teacher",
  schoolId: SCHOOL_ID,
  districtId: OTHER_DISTRICT_ID,
};

function baseAttempt() {
  return {
    activityId: ACTIVITY_ID,
    assessmentId: ASSESSMENT_ID,
    assessmentRevisionId: REVISION_ID,
    attemptNumber: 1,
    score: 1,
    maxScore: 1,
    percentage: 100,
    responses: [{ itemId: "q1", response: "o2" }],
    itemResults: [
      {
        itemId: "q1",
        isCorrect: true,
        pointsEarned: 1,
        correctOptionId: "o2",
        explanation: "The outer core is molten iron and nickel.",
        studentResponse: "o2",
      },
    ],
    idempotencyKey: "idem-1",
    submittedAt: new Date("2026-09-01T00:10:00Z"),
  };
}

describe("Firestore Rules: attempts/{attemptId}", () => {
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

      // Backend-seeded attempt owned by (STUDENT_UID) in class (CLASS_ID)
      // taught by (TEACHER_UID). This is the fixture the positive Rules
      // paths must accept and every adversarial path must be denied.
      await setDoc(doc(db, "attempts", OWNER_ATTEMPT_ID), {
        ...baseAttempt(),
        studentId: STUDENT_UID,
        assignmentId: ASSIGNMENT_ID,
        classId: CLASS_ID,
        teacherId: TEACHER_UID,
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
      });

      // Same-district attempt in a different teacher's class. Used to
      // prove the same-district clause alone does not authorize a
      // non-owning teacher; class ownership (matched by `teacherId`) is
      // required.
      await setDoc(doc(db, "attempts", OTHER_TEACHER_ATTEMPT_ID), {
        ...baseAttempt(),
        studentId: OTHER_STUDENT_UID,
        assignmentId: OTHER_ASSIGNMENT_ID,
        classId: OTHER_CLASS_ID,
        teacherId: OTHER_TEACHER_UID,
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
      });

      // Cross-district attempt. Used to prove district isolation for
      // both student and teacher paths.
      await setDoc(doc(db, "attempts", OTHER_DISTRICT_ATTEMPT_ID), {
        ...baseAttempt(),
        studentId: OTHER_DISTRICT_STUDENT_UID,
        assignmentId: OTHER_ASSIGNMENT_ID,
        classId: OTHER_CLASS_ID,
        teacherId: OTHER_DISTRICT_TEACHER_UID,
        schoolId: OTHER_SCHOOL_ID,
        districtId: OTHER_DISTRICT_ID,
      });
    });
  });

  describe("read", () => {
    it("allows the owning student in the same district to get their own attempt", async () => {
      const db = testEnv
        .authenticatedContext(STUDENT_UID, OWNER_STUDENT_TOKEN)
        .firestore();
      await assertSucceeds(getDoc(doc(db, "attempts", OWNER_ATTEMPT_ID)));
    });

    it("allows the owning teacher in the same district to get an attempt in their class", async () => {
      const db = testEnv
        .authenticatedContext(TEACHER_UID, OWNER_TEACHER_TOKEN)
        .firestore();
      await assertSucceeds(getDoc(doc(db, "attempts", OWNER_ATTEMPT_ID)));
    });

    it("denies an unauthenticated caller from getting an attempt", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, "attempts", OWNER_ATTEMPT_ID)));
    });

    it("denies another student in the same district from getting the owning student's attempt", async () => {
      const db = testEnv
        .authenticatedContext(OTHER_STUDENT_UID, OTHER_STUDENT_TOKEN)
        .firestore();
      await assertFails(getDoc(doc(db, "attempts", OWNER_ATTEMPT_ID)));
    });

    it("denies a student in another district from getting an attempt in this district", async () => {
      const db = testEnv
        .authenticatedContext(OTHER_DISTRICT_STUDENT_UID, OTHER_DISTRICT_STUDENT_TOKEN)
        .firestore();
      await assertFails(getDoc(doc(db, "attempts", OWNER_ATTEMPT_ID)));
    });

    it("denies a teacher in another district from getting an attempt in this district", async () => {
      const db = testEnv
        .authenticatedContext(OTHER_DISTRICT_TEACHER_UID, OTHER_DISTRICT_TEACHER_TOKEN)
        .firestore();
      await assertFails(getDoc(doc(db, "attempts", OWNER_ATTEMPT_ID)));
    });

    it("denies a same-district teacher without class ownership from getting the attempt", async () => {
      const db = testEnv
        .authenticatedContext(OTHER_TEACHER_UID, OTHER_TEACHER_TOKEN)
        .firestore();
      await assertFails(getDoc(doc(db, "attempts", OWNER_ATTEMPT_ID)));
    });

    it("denies a teacher whose uid does not match teacherId even when they carry a matching district claim", async () => {
      // Forged class id path: the caller supplies a matching districtId but
      // is not the resource's teacherId. The Rule refuses because the
      // teacher path requires teacherId equality on the resource itself;
      // supplying or forging a classId in the request is irrelevant since
      // every client write is denied.
      const db = testEnv
        .authenticatedContext(OTHER_TEACHER_UID, {
          role: "teacher",
          schoolId: SCHOOL_ID,
          districtId: DISTRICT_ID,
        })
        .firestore();
      await assertFails(getDoc(doc(db, "attempts", OWNER_ATTEMPT_ID)));
    });

    it("denies the owning teacher when their district claim is forged", async () => {
      const db = testEnv
        .authenticatedContext(TEACHER_UID, FORGED_DISTRICT_TEACHER_TOKEN)
        .firestore();
      await assertFails(getDoc(doc(db, "attempts", OWNER_ATTEMPT_ID)));
    });

    it("denies collection enumeration of attempts even when filtered by studentId", async () => {
      const db = testEnv
        .authenticatedContext(STUDENT_UID, OWNER_STUDENT_TOKEN)
        .firestore();
      await assertFails(
        getDocs(
          query(
            collection(db, "attempts"),
            where("studentId", "==", STUDENT_UID),
          ),
        ),
      );
    });

    it("denies collection enumeration of attempts even when filtered by teacherId", async () => {
      const db = testEnv
        .authenticatedContext(TEACHER_UID, OWNER_TEACHER_TOKEN)
        .firestore();
      await assertFails(
        getDocs(
          query(
            collection(db, "attempts"),
            where("teacherId", "==", TEACHER_UID),
          ),
        ),
      );
    });
  });

  describe("write", () => {
    it("denies a student from creating an attempt", async () => {
      const db = testEnv
        .authenticatedContext(STUDENT_UID, OWNER_STUDENT_TOKEN)
        .firestore();
      await assertFails(
        setDoc(doc(db, "attempts", `${ASSIGNMENT_ID}__${STUDENT_UID}__a2`), {
          ...baseAttempt(),
          studentId: STUDENT_UID,
          assignmentId: ASSIGNMENT_ID,
          classId: CLASS_ID,
          teacherId: TEACHER_UID,
          schoolId: SCHOOL_ID,
          districtId: DISTRICT_ID,
          attemptNumber: 2,
        }),
      );
    });

    it("denies a teacher from creating an attempt", async () => {
      const db = testEnv
        .authenticatedContext(TEACHER_UID, OWNER_TEACHER_TOKEN)
        .firestore();
      await assertFails(
        setDoc(doc(db, "attempts", `${ASSIGNMENT_ID}__${STUDENT_UID}__a3`), {
          ...baseAttempt(),
          studentId: STUDENT_UID,
          assignmentId: ASSIGNMENT_ID,
          classId: CLASS_ID,
          teacherId: TEACHER_UID,
          schoolId: SCHOOL_ID,
          districtId: DISTRICT_ID,
          attemptNumber: 3,
        }),
      );
    });

    it("denies the owning student from updating their own attempt (score fields are immutable)", async () => {
      const db = testEnv
        .authenticatedContext(STUDENT_UID, OWNER_STUDENT_TOKEN)
        .firestore();
      await assertFails(
        updateDoc(doc(db, "attempts", OWNER_ATTEMPT_ID), {
          score: 999,
          percentage: 100,
        }),
      );
    });

    it("denies the owning teacher from updating an attempt (score correction is not permitted)", async () => {
      const db = testEnv
        .authenticatedContext(TEACHER_UID, OWNER_TEACHER_TOKEN)
        .firestore();
      await assertFails(
        updateDoc(doc(db, "attempts", OWNER_ATTEMPT_ID), {
          score: 0,
        }),
      );
    });

    it("denies the owning student from deleting their own attempt", async () => {
      const db = testEnv
        .authenticatedContext(STUDENT_UID, OWNER_STUDENT_TOKEN)
        .firestore();
      await assertFails(deleteDoc(doc(db, "attempts", OWNER_ATTEMPT_ID)));
    });

    it("denies the owning teacher from deleting an attempt", async () => {
      const db = testEnv
        .authenticatedContext(TEACHER_UID, OWNER_TEACHER_TOKEN)
        .firestore();
      await assertFails(deleteDoc(doc(db, "attempts", OWNER_ATTEMPT_ID)));
    });
  });
});
