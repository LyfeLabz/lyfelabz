import {
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import { createTestEnvironment } from "./setup";

// RA-3A resource evidence. `resourceEvidence/{recordId}` and its
// `submissions/submitted` snapshot are server-owned. No Rules block opens
// them: the terminal default-deny refuses every client role (the owning
// student, another student, the assignment's teacher, a platform
// administrator, and an unauthenticated caller), so a student can never
// write evidence, a verified outcome, eligibility, or a snapshot directly.
// The RA-3A services are the only readers/writers, through the Admin SDK.

const STUDENT_UID = "student-uid";
const OTHER_STUDENT_UID = "other-student-uid";
const TEACHER_UID = "teacher-uid";
const ADMIN_UID = "admin-uid";
const RECORD_ID = `asg-1__${STUDENT_UID}`;
const RECORD_PATH = ["resourceEvidence", RECORD_ID] as const;
const SNAPSHOT_PATH = ["resourceEvidence", RECORD_ID, "submissions", "submitted"] as const;

describe("Firestore Rules: resourceEvidence/{recordId} (default-deny)", () => {
  let testEnv: RulesTestEnvironment;
  let databases: ReturnType<ReturnType<RulesTestEnvironment["unauthenticatedContext"]>["firestore"]>[];
  let ownStudentDb: (typeof databases)[number];

  beforeAll(async () => {
    testEnv = await createTestEnvironment();
    databases = [
      testEnv.authenticatedContext(STUDENT_UID, { role: "student", schoolId: "school-a", districtId: "district-a" }),
      testEnv.authenticatedContext(OTHER_STUDENT_UID, { role: "student", schoolId: "school-a", districtId: "district-a" }),
      testEnv.authenticatedContext(TEACHER_UID, { role: "teacher", schoolId: "school-a", districtId: "district-a" }),
      testEnv.authenticatedContext(ADMIN_UID, { role: "platformAdministrator", schoolId: "school-a", districtId: "district-a" }),
      testEnv.unauthenticatedContext(),
    ].map((context) => context.firestore());
    ownStudentDb = databases[0];
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, ...RECORD_PATH), {
        schemaVersion: 1,
        recordId: RECORD_ID,
        studentId: STUDENT_UID,
        assignmentId: "asg-1",
        classId: "class-1",
        teacherId: TEACHER_UID,
        schoolId: "school-a",
        districtId: "district-a",
        resourceId: "simulation-gravity-wells",
        resourceType: "simulation",
        assessmentRevisionId: "assessment_simulation-gravity-wells__r1",
        definitionVersion: 1,
        status: "submitted",
        workingJson: "{}",
        workingRevision: 1,
        runs: [],
        runsRevision: 0,
        evidenceEligibleAt: new Date("2026-10-09T00:00:00Z"),
      });
      await setDoc(doc(db, ...SNAPSHOT_PATH), { recordId: RECORD_ID, eligible: true, snapshotJson: "{}" });
    });
  });

  it("denies every role a direct read of a record or its snapshot", async () => {
    for (const db of databases) {
      await assertFails(getDoc(doc(db, ...RECORD_PATH)));
      await assertFails(getDoc(doc(db, ...SNAPSHOT_PATH)));
    }
  });

  it("denies every role listing records or snapshots", async () => {
    for (const db of databases) {
      await assertFails(getDocs(collection(db, "resourceEvidence")));
      await assertFails(getDocs(collection(db, "resourceEvidence", RECORD_ID, "submissions")));
      await assertFails(getDocs(collectionGroup(db, "submissions")));
    }
  });

  it("denies every role creating, updating, or deleting evidence", async () => {
    for (const db of databases) {
      await assertFails(setDoc(doc(db, "resourceEvidence", "asg-2__x"), { studentId: "x" }));
      await assertFails(updateDoc(doc(db, ...RECORD_PATH), { runs: [{ outcomes: ["earth-orbit"] }] }));
      await assertFails(deleteDoc(doc(db, ...RECORD_PATH)));
      await assertFails(updateDoc(doc(db, ...SNAPSHOT_PATH), { eligible: false }));
      await assertFails(deleteDoc(doc(db, ...SNAPSHOT_PATH)));
    }
  });

  it("denies the owning student forging eligibility or a snapshot", async () => {
    await assertFails(updateDoc(doc(ownStudentDb, ...RECORD_PATH), { evidenceEligibleAt: new Date(), status: "submitted" }));
    await assertFails(
      setDoc(doc(ownStudentDb, "resourceEvidence", `asg-9__${STUDENT_UID}`, "submissions", "submitted"), {
        eligible: true,
      }),
    );
  });
});
