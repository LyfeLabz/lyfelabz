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

// Lab Report Assistant cloud autosave. `studentLabReports/{studentId}` and
// `reports/{reportId}` are server-owned: zero direct client access for any
// role (the owning student, another student, a teacher, a platform
// administrator, and an unauthenticated caller). `labReportsGet` and `labReportsSave`
// are the sole readers/writers through the Admin SDK.

const STUDENT_UID = "student-uid";
const OTHER_STUDENT_UID = "other-student-uid";
const TEACHER_UID = "teacher-uid";
const ADMIN_UID = "admin-uid";
const REPORT_PATH = ["studentLabReports", STUDENT_UID, "reports", "active"] as const;

describe("Firestore Rules: studentLabReports/{studentId}/reports/{reportId}", () => {
  let testEnv: RulesTestEnvironment;
  // One Firestore client per identity: rules-unit-testing refuses to
  // re-initialize a context's Firestore after it has started.
  let databases: ReturnType<ReturnType<RulesTestEnvironment["unauthenticatedContext"]>["firestore"]>[];

  beforeAll(async () => {
    testEnv = await createTestEnvironment();
    databases = [
      testEnv.authenticatedContext(STUDENT_UID, { role: "student", schoolId: "school-a", districtId: "district-a" }),
      testEnv.authenticatedContext(OTHER_STUDENT_UID, { role: "student", schoolId: "school-a", districtId: "district-a" }),
      testEnv.authenticatedContext(TEACHER_UID, { role: "teacher", schoolId: "school-a", districtId: "district-a" }),
      testEnv.authenticatedContext(ADMIN_UID, { role: "platformAdministrator", schoolId: "school-a", districtId: "district-a" }),
      testEnv.unauthenticatedContext(),
    ].map((context) => context.firestore());
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), ...REPORT_PATH), {
        schemaVersion: 1,
        reportId: "active",
        scope: "personal",
        studentId: STUDENT_UID,
        schoolId: "school-a",
        districtId: "district-a",
        reportFormatVersion: 1,
        reportJson: "{}",
        reportBytes: 2,
        revision: 1,
        lastSaveId: "save-0000001",
        createdAt: new Date("2026-10-08T00:00:00Z"),
        updatedAt: new Date("2026-10-08T00:00:00Z"),
      });
    });
  });

  it("denies every role a direct read of a report", async () => {
    for (const db of databases) {
      await assertFails(getDoc(doc(db, ...REPORT_PATH)));
    }
  });

  it("denies every role listing reports", async () => {
    for (const db of databases) {
      await assertFails(getDocs(collection(db, "studentLabReports", STUDENT_UID, "reports")));
      await assertFails(getDocs(collection(db, "studentLabReports")));
    }
  });

  it("denies every role creating, updating, or deleting a report", async () => {
    for (const db of databases) {
      await assertFails(setDoc(doc(db, "studentLabReports", STUDENT_UID, "reports", "second"), { reportJson: "{}" }));
      await assertFails(updateDoc(doc(db, ...REPORT_PATH), { revision: 99 }));
      await assertFails(deleteDoc(doc(db, ...REPORT_PATH)));
      await assertFails(setDoc(doc(db, "studentLabReports", STUDENT_UID), { any: true }));
    }
  });
});
