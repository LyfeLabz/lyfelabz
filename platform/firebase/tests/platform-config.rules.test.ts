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

// Sprint 29C - platformConfig/{configId} Rules coverage. The platform
// configuration collection is server-only: the
// `platformConfig/teacherPilotAllowlist` document holds the private pilot
// allowlist and confers authorization, so every client role is denied every
// operation via an explicit `allow read, write: if false;` block. The sole
// reader is the `teachersApproveVerification` callable running under Admin
// SDK authority (which bypasses Rules). This suite is symmetric with
// `external-identities.rules.test.ts` and `assessment-answer-keys.rules.test.ts`.

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

const ALLOWLIST_DOC_ID = "teacherPilotAllowlist";

describe("Firestore Rules: platformConfig/{configId}", () => {
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
      await setDoc(doc(db, "platformConfig", ALLOWLIST_DOC_ID), {
        emails: ["seed.member@example.org"],
      });
    });
  });

  describe("read - every client role is denied", () => {
    it("denies unauthenticated get", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, "platformConfig", ALLOWLIST_DOC_ID)));
    });

    it("denies a student get", async () => {
      const db = testEnv
        .authenticatedContext(STUDENT_UID, STUDENT_TOKEN)
        .firestore();
      await assertFails(getDoc(doc(db, "platformConfig", ALLOWLIST_DOC_ID)));
    });

    it("denies a teacher get", async () => {
      const db = testEnv
        .authenticatedContext(TEACHER_UID, TEACHER_TOKEN)
        .firestore();
      await assertFails(getDoc(doc(db, "platformConfig", ALLOWLIST_DOC_ID)));
    });

    it("denies a platformAdministrator get", async () => {
      const db = testEnv
        .authenticatedContext(ADMIN_UID, ADMIN_TOKEN)
        .firestore();
      await assertFails(getDoc(doc(db, "platformConfig", ALLOWLIST_DOC_ID)));
    });

    it("denies a platformAdministrator list", async () => {
      const db = testEnv
        .authenticatedContext(ADMIN_UID, ADMIN_TOKEN)
        .firestore();
      await assertFails(getDocs(collection(db, "platformConfig")));
    });
  });

  describe("write - every client role is denied create, update, delete", () => {
    it("denies a platformAdministrator create", async () => {
      const db = testEnv
        .authenticatedContext(ADMIN_UID, ADMIN_TOKEN)
        .firestore();
      await assertFails(
        setDoc(doc(db, "platformConfig", "someOtherConfig"), {
          emails: ["x@example.org"],
        }),
      );
    });

    it("denies a platformAdministrator update", async () => {
      const db = testEnv
        .authenticatedContext(ADMIN_UID, ADMIN_TOKEN)
        .firestore();
      await assertFails(
        updateDoc(doc(db, "platformConfig", ALLOWLIST_DOC_ID), {
          emails: ["attacker@example.org"],
        }),
      );
    });

    it("denies a teacher update", async () => {
      const db = testEnv
        .authenticatedContext(TEACHER_UID, TEACHER_TOKEN)
        .firestore();
      await assertFails(
        updateDoc(doc(db, "platformConfig", ALLOWLIST_DOC_ID), {
          emails: ["attacker@example.org"],
        }),
      );
    });

    it("denies a platformAdministrator delete", async () => {
      const db = testEnv
        .authenticatedContext(ADMIN_UID, ADMIN_TOKEN)
        .firestore();
      await assertFails(
        deleteDoc(doc(db, "platformConfig", ALLOWLIST_DOC_ID)),
      );
    });
  });

  // F5.2 §8.6/§11 (T-R5, P2-B) - the server-owned operational
  // differentiated-delivery flag lives at
  // `platformConfig/differentiatedDelivery` and is covered by the same
  // deny-all block. No student can set/override it, no teacher can assert it,
  // and no ordinary client can flip it; only an Admin-credentialed operator
  // (bypassing Rules) changes it.
  describe("differentiatedDelivery operational flag - server-owned", () => {
    const FLAG_DOC_ID = "differentiatedDelivery";

    it("denies a student read of the flag", async () => {
      const db = testEnv
        .authenticatedContext(STUDENT_UID, STUDENT_TOKEN)
        .firestore();
      await assertFails(getDoc(doc(db, "platformConfig", FLAG_DOC_ID)));
    });

    it("denies a student create of the flag (cannot assert delivery state)", async () => {
      const db = testEnv
        .authenticatedContext(STUDENT_UID, STUDENT_TOKEN)
        .firestore();
      await assertFails(
        setDoc(doc(db, "platformConfig", FLAG_DOC_ID), { enabled: true }),
      );
    });

    it("denies a teacher update of the flag (cannot override the disable)", async () => {
      const db = testEnv
        .authenticatedContext(TEACHER_UID, TEACHER_TOKEN)
        .firestore();
      await assertFails(
        updateDoc(doc(db, "platformConfig", FLAG_DOC_ID), { enabled: false }),
      );
    });
  });
});
