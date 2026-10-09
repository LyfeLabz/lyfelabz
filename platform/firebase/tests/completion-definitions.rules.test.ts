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

// RA-3B frozen completion definitions. `completionDefinitions/{revisionId}`
// is server-owned: no Rules block opens it, so the terminal default-deny
// refuses every client role. `deployAssessmentRevision` is the only writer
// and the publication and evidence services the only readers, all through
// the Admin SDK. No Rules change was made for RA-3B; these tests pin that
// the default-deny covers the new collection and that no client can write
// an assignment's `completionBinding`.

const STUDENT_UID = "student-uid";
const TEACHER_UID = "teacher-uid";
const ADMIN_UID = "admin-uid";
const REVISION_ID = "assessment_simulation-gravity-wells__r1";
const DEFINITION_PATH = ["completionDefinitions", REVISION_ID] as const;
const ASSIGNMENT_PATH = ["assignments", "asg-1"] as const;

describe("Firestore Rules: completionDefinitions/{revisionId} (default-deny)", () => {
  let testEnv: RulesTestEnvironment;
  let databases: ReturnType<ReturnType<RulesTestEnvironment["unauthenticatedContext"]>["firestore"]>[];
  let teacherDb: (typeof databases)[number];

  beforeAll(async () => {
    testEnv = await createTestEnvironment();
    databases = [
      testEnv.authenticatedContext(STUDENT_UID, { role: "student", schoolId: "school-a", districtId: "district-a" }),
      testEnv.authenticatedContext(TEACHER_UID, { role: "teacher", schoolId: "school-a", districtId: "district-a" }),
      testEnv.authenticatedContext(ADMIN_UID, { role: "platformAdministrator", schoolId: "school-a", districtId: "district-a" }),
      testEnv.unauthenticatedContext(),
    ].map((context) => context.firestore());
    teacherDb = databases[1];
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "users", TEACHER_UID), { status: "active", role: "teacher", schoolId: "school-a" });
      await setDoc(doc(db, ...DEFINITION_PATH), {
        recordSchemaVersion: 1,
        assessmentRevisionId: REVISION_ID,
        resourceId: "simulation-gravity-wells",
        definitionHash: "0".repeat(64),
        definitionJson: "{}",
      });
      await setDoc(doc(db, ...ASSIGNMENT_PATH), {
        classId: "class-1",
        teacherId: TEACHER_UID,
        schoolId: "school-a",
        lessonSlug: "simulation-gravity-wells",
        resourceType: "simulation",
        mode: "classroom",
        status: "draft",
      });
    });
  });

  it("denies every role a direct read or list of a definition", async () => {
    for (const db of databases) {
      await assertFails(getDoc(doc(db, ...DEFINITION_PATH)));
      await assertFails(getDocs(collection(db, "completionDefinitions")));
    }
  });

  it("denies every role creating, updating, or deleting a definition", async () => {
    for (const db of databases) {
      await assertFails(setDoc(doc(db, "completionDefinitions", "assessment_simulation-x__r1"), { definitionJson: "{}" }));
      await assertFails(updateDoc(doc(db, ...DEFINITION_PATH), { definitionHash: "1".repeat(64) }));
      await assertFails(deleteDoc(doc(db, ...DEFINITION_PATH)));
    }
  });

  it("denies every role, including the owning teacher, writing an assignment completion binding", async () => {
    const binding = { definitionHash: "1".repeat(64), assessmentRevisionId: REVISION_ID };
    await assertFails(updateDoc(doc(teacherDb, ...ASSIGNMENT_PATH), { completionBinding: binding }));
    for (const db of databases) {
      await assertFails(updateDoc(doc(db, ...ASSIGNMENT_PATH), { completionBinding: binding, status: "published" }));
    }
  });
});
