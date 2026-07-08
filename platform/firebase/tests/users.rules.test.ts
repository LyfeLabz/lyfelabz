import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

import { createTestEnvironment } from "./setup";

const SELF_UID = "self-uid";
const OTHER_UID = "other-uid";

// Provisioning-and-activation-shaped seed: every server-managed field
// enumerated in the Sprint 2 Data Model is present so that the
// client-side deny paths exercise a real "the field already exists"
// diff rather than an "adding a new field" diff.
function seededUserDoc(uid: string) {
  return {
    authUid: uid,
    status: "active",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    role: "student",
    schoolId: "school-a",
    displayName: "Original Name",
    email: "student@school.edu",
    grade: "6",
    studentProfile: {},
    consentState: {},
    teacherProfile: {},
  };
}

describe("Firestore Rules: users/{uid}", () => {
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
      await setDoc(doc(db, "users", SELF_UID), seededUserDoc(SELF_UID));
      await setDoc(doc(db, "users", OTHER_UID), seededUserDoc(OTHER_UID));
    });
  });

  describe("read", () => {
    it("allows self read of own document", async () => {
      const db = testEnv.authenticatedContext(SELF_UID).firestore();
      await assertSucceeds(getDoc(doc(db, "users", SELF_UID)));
    });

    it("denies cross-user read", async () => {
      const db = testEnv.authenticatedContext(SELF_UID).firestore();
      await assertFails(getDoc(doc(db, "users", OTHER_UID)));
    });

    it("denies unauthenticated read", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, "users", SELF_UID)));
    });
  });

  describe("update - allowlist enforcement", () => {
    it("allows self update of displayName", async () => {
      const db = testEnv.authenticatedContext(SELF_UID).firestore();
      await assertSucceeds(
        updateDoc(doc(db, "users", SELF_UID), { displayName: "New Name" }),
      );
    });

    it("denies self update of role", async () => {
      const db = testEnv.authenticatedContext(SELF_UID).firestore();
      await assertFails(
        updateDoc(doc(db, "users", SELF_UID), { role: "teacher" }),
      );
    });

    it("denies self update of schoolId", async () => {
      const db = testEnv.authenticatedContext(SELF_UID).firestore();
      await assertFails(
        updateDoc(doc(db, "users", SELF_UID), { schoolId: "school-b" }),
      );
    });

    it("denies self update of status", async () => {
      const db = testEnv.authenticatedContext(SELF_UID).firestore();
      await assertFails(
        updateDoc(doc(db, "users", SELF_UID), { status: "suspended" }),
      );
    });

    it("denies self update of authUid", async () => {
      const db = testEnv.authenticatedContext(SELF_UID).firestore();
      await assertFails(
        updateDoc(doc(db, "users", SELF_UID), { authUid: "spoofed-uid" }),
      );
    });

    it("denies self update of createdAt", async () => {
      const db = testEnv.authenticatedContext(SELF_UID).firestore();
      await assertFails(
        updateDoc(doc(db, "users", SELF_UID), {
          createdAt: new Date("2000-01-01T00:00:00Z"),
        }),
      );
    });

    it("denies self update of consentState", async () => {
      const db = testEnv.authenticatedContext(SELF_UID).firestore();
      await assertFails(
        updateDoc(doc(db, "users", SELF_UID), { consentState: { accepted: true } }),
      );
    });

    it("denies self update of teacherProfile", async () => {
      const db = testEnv.authenticatedContext(SELF_UID).firestore();
      await assertFails(
        updateDoc(doc(db, "users", SELF_UID), { teacherProfile: { note: "x" } }),
      );
    });

    it("denies self update of studentProfile", async () => {
      const db = testEnv.authenticatedContext(SELF_UID).firestore();
      await assertFails(
        updateDoc(doc(db, "users", SELF_UID), { studentProfile: { note: "x" } }),
      );
    });

    it("denies update that mixes displayName with a disallowed field", async () => {
      const db = testEnv.authenticatedContext(SELF_UID).firestore();
      await assertFails(
        updateDoc(doc(db, "users", SELF_UID), {
          displayName: "New Name",
          role: "teacher",
        }),
      );
    });

    it("denies cross-user displayName update", async () => {
      const db = testEnv.authenticatedContext(SELF_UID).firestore();
      await assertFails(
        updateDoc(doc(db, "users", OTHER_UID), { displayName: "Hacked" }),
      );
    });
  });

  describe("create and delete remain server-only", () => {
    it("denies client create of a new users doc", async () => {
      const db = testEnv.authenticatedContext("brand-new-uid").firestore();
      await assertFails(
        setDoc(doc(db, "users", "brand-new-uid"), {
          authUid: "brand-new-uid",
          status: "provisioned",
        }),
      );
    });
  });
});
