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

// Sprint 29G.5K - lmsRosterMemberships/{membershipId} Rules coverage.
//
// The trusted Google Classroom roster-membership cache is server-only. Its
// body confers eligibility for automatic enrollment (a client that could
// read it would learn class membership; a client that could write it could
// forge membership and self-authorize), so every client role is denied
// every operation via an explicit `allow read, write: if false;` block. The
// sole readers/writers are the `lmsClassesRefreshRoster` callable and the
// `studentsCompleteLmsOnboarding` materialization step, both running under
// Admin SDK authority (which bypasses Rules). This suite is symmetric with
// `external-identities.rules.test.ts` and `platform-config.rules.test.ts`.

const STUDENT_UID = "student-uid";
const STUDENT_TOKEN = {
  role: "student",
  schoolId: "school-a",
  districtId: "district-a",
};
const TEACHER_UID = "teacher-uid";
const TEACHER_TOKEN = {
  role: "teacher",
  schoolId: "school-a",
  districtId: "district-a",
};
const ADMIN_UID = "admin-uid";
const ADMIN_TOKEN = {
  role: "platformAdministrator",
  schoolId: "school-a",
  districtId: "district-a",
};

const MEMBERSHIP_ID = "link-1__deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

describe("Firestore Rules: lmsRosterMemberships/{membershipId}", () => {
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
      await setDoc(doc(db, "lmsRosterMemberships", MEMBERSHIP_ID), {
        classId: "class-1",
        linkId: "link-1",
        ownerUid: "teacher-uid",
        schoolId: "school-a",
        providerId: "googleClassroom",
        identityHash:
          "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        status: "member",
      });
    });
  });

  describe("read - every client role is denied", () => {
    it("denies an unauthenticated get", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, "lmsRosterMemberships", MEMBERSHIP_ID)));
    });

    it("denies a student get (cannot learn membership)", async () => {
      const db = testEnv
        .authenticatedContext(STUDENT_UID, STUDENT_TOKEN)
        .firestore();
      await assertFails(getDoc(doc(db, "lmsRosterMemberships", MEMBERSHIP_ID)));
    });

    it("denies a teacher get", async () => {
      const db = testEnv
        .authenticatedContext(TEACHER_UID, TEACHER_TOKEN)
        .firestore();
      await assertFails(getDoc(doc(db, "lmsRosterMemberships", MEMBERSHIP_ID)));
    });

    it("denies a teacher list", async () => {
      const db = testEnv
        .authenticatedContext(TEACHER_UID, TEACHER_TOKEN)
        .firestore();
      await assertFails(getDocs(collection(db, "lmsRosterMemberships")));
    });

    it("denies a platformAdministrator get", async () => {
      const db = testEnv
        .authenticatedContext(ADMIN_UID, ADMIN_TOKEN)
        .firestore();
      await assertFails(getDoc(doc(db, "lmsRosterMemberships", MEMBERSHIP_ID)));
    });
  });

  describe("write - every client role is denied create, update, delete", () => {
    it("denies a student create (cannot forge membership to self-authorize)", async () => {
      const db = testEnv
        .authenticatedContext(STUDENT_UID, STUDENT_TOKEN)
        .firestore();
      await assertFails(
        setDoc(doc(db, "lmsRosterMemberships", "link-1__forged"), {
          classId: "class-1",
          linkId: "link-1",
          ownerUid: "teacher-uid",
          schoolId: "school-a",
          providerId: "googleClassroom",
          identityHash: "forged",
          status: "member",
        }),
      );
    });

    it("denies a teacher create (cannot manufacture membership from a client)", async () => {
      const db = testEnv
        .authenticatedContext(TEACHER_UID, TEACHER_TOKEN)
        .firestore();
      await assertFails(
        setDoc(doc(db, "lmsRosterMemberships", "link-1__teacher-forged"), {
          classId: "class-1",
          linkId: "link-1",
          ownerUid: "teacher-uid",
          schoolId: "school-a",
          providerId: "googleClassroom",
          identityHash: "teacher-forged",
          status: "member",
        }),
      );
    });

    it("denies a teacher update", async () => {
      const db = testEnv
        .authenticatedContext(TEACHER_UID, TEACHER_TOKEN)
        .firestore();
      await assertFails(
        updateDoc(doc(db, "lmsRosterMemberships", MEMBERSHIP_ID), {
          status: "removed",
        }),
      );
    });

    it("denies a platformAdministrator delete", async () => {
      const db = testEnv
        .authenticatedContext(ADMIN_UID, ADMIN_TOKEN)
        .firestore();
      await assertFails(
        deleteDoc(doc(db, "lmsRosterMemberships", MEMBERSHIP_ID)),
      );
    });
  });
});
