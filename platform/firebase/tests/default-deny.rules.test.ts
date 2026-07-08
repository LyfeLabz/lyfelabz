import {
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

import { createTestEnvironment } from "./setup";

const AUTH_UID = "test-user-uid";
const ARBITRARY_COLLECTION = "arbitraryCollection";
const ARBITRARY_DOC_ID = "arbitraryDocId";
const AUDIT_EVENT_ID = "audit-event-id";

describe("Firestore Rules: strict default-deny baseline", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await createTestEnvironment();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    // Seed documents via a rules-bypassing context so "read denied" tests
    // exercise an actual existing document, not a missing-doc path.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, ARBITRARY_COLLECTION, ARBITRARY_DOC_ID), { seeded: true });
      await setDoc(doc(db, "users", AUTH_UID), { uid: AUTH_UID });
      await setDoc(doc(db, "auditEvents", AUDIT_EVENT_ID), { type: "seed" });
    });
  });

  describe("arbitrary paths", () => {
    it("denies unauthenticated read", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, ARBITRARY_COLLECTION, ARBITRARY_DOC_ID)));
    });

    it("denies unauthenticated write", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        setDoc(doc(db, ARBITRARY_COLLECTION, "new-doc"), { attempted: true }),
      );
    });

    it("denies authenticated read", async () => {
      const db = testEnv.authenticatedContext(AUTH_UID).firestore();
      await assertFails(getDoc(doc(db, ARBITRARY_COLLECTION, ARBITRARY_DOC_ID)));
    });

    it("denies authenticated write", async () => {
      const db = testEnv.authenticatedContext(AUTH_UID).firestore();
      await assertFails(
        setDoc(doc(db, ARBITRARY_COLLECTION, "new-doc"), { attempted: true }),
      );
    });
  });

  describe("users/{uid} is closed even to the matching authenticated user", () => {
    it("denies self-read of users/{uid}", async () => {
      const db = testEnv.authenticatedContext(AUTH_UID).firestore();
      await assertFails(getDoc(doc(db, "users", AUTH_UID)));
    });

    it("denies self-write of users/{uid}", async () => {
      const db = testEnv.authenticatedContext(AUTH_UID).firestore();
      await assertFails(
        setDoc(doc(db, "users", AUTH_UID), { uid: AUTH_UID, tampered: true }),
      );
    });
  });

  describe("auditEvents/{id} is closed to all clients", () => {
    it("denies authenticated read of auditEvents/{id}", async () => {
      const db = testEnv.authenticatedContext(AUTH_UID).firestore();
      await assertFails(getDoc(doc(db, "auditEvents", AUDIT_EVENT_ID)));
    });

    it("denies authenticated write of auditEvents/{id}", async () => {
      const db = testEnv.authenticatedContext(AUTH_UID).firestore();
      await assertFails(
        setDoc(doc(db, "auditEvents", "new-event"), { type: "attempted" }),
      );
    });
  });
});
