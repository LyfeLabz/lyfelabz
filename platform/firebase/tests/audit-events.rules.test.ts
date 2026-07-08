import {
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

import { createTestEnvironment } from "./setup";

const AUTH_UID = "test-user-uid";
const AUDIT_EVENT_ID = "audit-event-id";

// auditEvents remains a server-only surface per Security Model §11 and
// Cloud Function Charter §2. Sprint 2 does not open any client access.
describe("Firestore Rules: auditEvents/{eventId}", () => {
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
      await setDoc(doc(db, "auditEvents", AUDIT_EVENT_ID), { type: "seed" });
    });
  });

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

  it("denies unauthenticated read of auditEvents/{id}", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "auditEvents", AUDIT_EVENT_ID)));
  });

  it("denies unauthenticated write of auditEvents/{id}", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(db, "auditEvents", "new-event"), { type: "attempted" }),
    );
  });
});
