import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

import { createTestEnvironment } from "./setup";

// Sprint 24B Phase 2B.2 - Rules tests for
// `users/{uid}/preferences/teacher`.
//
// The subdoc is the sole preference document introduced in Phase 2B.2.
// Access model: self-only direct-client `get`; every direct-client write
// (create, update, delete) is denied. The `teacherPreferencesUpdate`
// callable is the sole writer and runs under Admin SDK authority.
//
// These tests are defense in depth against a future accidental Rules
// relaxation. The callable enforces the closed-set validation of
// `defaultGrade` itself.

const SELF_UID = "self-uid";
const OTHER_UID = "other-uid";

function seededPreferencesDoc() {
  return {
    defaultGrade: "7",
    updatedAt: new Date("2026-07-31T00:00:00Z"),
  };
}

describe("Firestore Rules: users/{uid}/preferences/teacher", () => {
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
      await setDoc(
        doc(db, "users", SELF_UID, "preferences", "teacher"),
        seededPreferencesDoc(),
      );
      await setDoc(
        doc(db, "users", OTHER_UID, "preferences", "teacher"),
        seededPreferencesDoc(),
      );
    });
  });

  describe("read", () => {
    it("allows self read of own preference document", async () => {
      const db = testEnv.authenticatedContext(SELF_UID).firestore();
      await assertSucceeds(
        getDoc(doc(db, "users", SELF_UID, "preferences", "teacher")),
      );
    });

    it("denies cross-user read", async () => {
      const db = testEnv.authenticatedContext(SELF_UID).firestore();
      await assertFails(
        getDoc(doc(db, "users", OTHER_UID, "preferences", "teacher")),
      );
    });

    it("denies unauthenticated read", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        getDoc(doc(db, "users", SELF_UID, "preferences", "teacher")),
      );
    });
  });

  describe("write - callable is the only writer", () => {
    it("denies self direct create", async () => {
      const db = testEnv.authenticatedContext("brand-new-uid").firestore();
      await assertFails(
        setDoc(
          doc(db, "users", "brand-new-uid", "preferences", "teacher"),
          { defaultGrade: "6" },
        ),
      );
    });

    it("denies self direct update", async () => {
      const db = testEnv.authenticatedContext(SELF_UID).firestore();
      await assertFails(
        updateDoc(
          doc(db, "users", SELF_UID, "preferences", "teacher"),
          { defaultGrade: "8" },
        ),
      );
    });

    it("denies self direct delete", async () => {
      const db = testEnv.authenticatedContext(SELF_UID).firestore();
      await assertFails(
        deleteDoc(
          doc(db, "users", SELF_UID, "preferences", "teacher"),
        ),
      );
    });

    it("denies cross-user direct write", async () => {
      const db = testEnv.authenticatedContext(SELF_UID).firestore();
      await assertFails(
        updateDoc(
          doc(db, "users", OTHER_UID, "preferences", "teacher"),
          { defaultGrade: "6" },
        ),
      );
    });

    it("denies write to an unrelated preferences path", async () => {
      const db = testEnv.authenticatedContext(SELF_UID).firestore();
      await assertFails(
        setDoc(
          doc(db, "users", SELF_UID, "preferences", "somethingElse"),
          { unrelated: true },
        ),
      );
    });
  });
});
