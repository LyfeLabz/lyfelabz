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
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import { createTestEnvironment } from "./setup";

// Student Support Access (PDR-032, docs/platform/STUDENT_SUPPORT_ACCESS.md).
// `studentSupportGrants/{grantId}` is server-owned. No explicit Rules block
// exists: the terminal default-deny refuses every client role every
// operation, the owner and the grantee included. The `supportAccess*`
// callables are the sole readers and writers via the Admin SDK.
//
// A grant also confers NO direct document access: the grantee is refused the
// owner's class, the student's enrollment, and the student's attempts, which
// stay reachable only through the authorized callables.

const OWNER_UID = "owner-teacher-uid";
const GRANTEE_UID = "grantee-teacher-uid";
const STUDENT_UID = "student-uid";
const SCHOOL_ID = "school-a";
const DISTRICT_ID = "district-a";
const CLASS_ID = "class-1";
const GRANT_ID = `${CLASS_ID}__${STUDENT_UID}__${GRANTEE_UID}`;
const GRANT_PATH = `studentSupportGrants/${GRANT_ID}`;
const ATTEMPT_PATH = `attempts/asg-1__${STUDENT_UID}__1`;
const ENROLLMENT_PATH = `enrollments/${CLASS_ID}__${STUDENT_UID}`;

const TEACHER_CLAIMS = { role: "teacher", schoolId: SCHOOL_ID, districtId: DISTRICT_ID };

describe("Firestore Rules: studentSupportGrants (default-deny)", () => {
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
      const activeTeacher = (uid: string) => ({
        authUid: uid,
        status: "active",
        role: "teacher",
        schoolId: SCHOOL_ID,
        createdAt: new Date(),
      });
      await setDoc(doc(db, `users/${OWNER_UID}`), activeTeacher(OWNER_UID));
      await setDoc(doc(db, `users/${GRANTEE_UID}`), activeTeacher(GRANTEE_UID));
      await setDoc(doc(db, `schools/${SCHOOL_ID}`), { districtId: DISTRICT_ID, name: "School A" });
      await setDoc(doc(db, GRANT_PATH), {
        classId: CLASS_ID,
        studentId: STUDENT_UID,
        ownerTeacherId: OWNER_UID,
        granteeUid: GRANTEE_UID,
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
        status: "active",
        grantedBy: OWNER_UID,
      });
      await setDoc(doc(db, `classes/${CLASS_ID}`), {
        teacherId: OWNER_UID,
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
        title: "Science 7",
        status: "active",
      });
      await setDoc(doc(db, ENROLLMENT_PATH), {
        studentId: STUDENT_UID,
        classId: CLASS_ID,
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
        status: "active",
      });
      await setDoc(doc(db, ATTEMPT_PATH), {
        studentId: STUDENT_UID,
        classId: CLASS_ID,
        teacherId: OWNER_UID,
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
        assignmentId: "asg-1",
      });
    });
  });

  it("denies get, list, create, update, and delete on grants for every role", async () => {
    const databases = [
      testEnv.authenticatedContext(OWNER_UID, TEACHER_CLAIMS),
      testEnv.authenticatedContext(GRANTEE_UID, TEACHER_CLAIMS),
      testEnv.authenticatedContext(STUDENT_UID, { role: "student", schoolId: SCHOOL_ID, districtId: DISTRICT_ID }),
      testEnv.authenticatedContext("admin-uid", { role: "platformAdministrator", schoolId: SCHOOL_ID, districtId: DISTRICT_ID }),
      testEnv.unauthenticatedContext(),
    ].map((context) => context.firestore());
    for (const db of databases) {
      await assertFails(getDoc(doc(db, GRANT_PATH)));
      await assertFails(getDocs(collection(db, "studentSupportGrants")));
      await assertFails(getDocs(query(collection(db, "studentSupportGrants"), where("granteeUid", "==", GRANTEE_UID))));
      await assertFails(setDoc(doc(db, GRANT_PATH), { status: "active" }));
      await assertFails(setDoc(doc(db, "studentSupportGrants/forged"), { granteeUid: GRANTEE_UID, status: "active" }));
      await assertFails(updateDoc(doc(db, GRANT_PATH), { status: "revoked" }));
      await assertFails(deleteDoc(doc(db, GRANT_PATH)));
    }
  });

  it("gives the grantee no direct access to the owner's class, enrollment, or the student's attempts", async () => {
    const grantee = testEnv.authenticatedContext(GRANTEE_UID, TEACHER_CLAIMS).firestore();
    await assertFails(getDoc(doc(grantee, `classes/${CLASS_ID}`)));
    await assertFails(getDoc(doc(grantee, ENROLLMENT_PATH)));
    await assertFails(getDocs(query(collection(grantee, "enrollments"), where("classId", "==", CLASS_ID))));
    await assertFails(getDoc(doc(grantee, ATTEMPT_PATH)));
    await assertFails(getDocs(query(collection(grantee, "attempts"), where("classId", "==", CLASS_ID))));
  });
});
