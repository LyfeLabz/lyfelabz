import {
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

import { createTestEnvironment } from "./setup";

const AUTH_UID = "test-user-uid";
const ARBITRARY_COLLECTION = "arbitraryCollection";
const ARBITRARY_DOC_ID = "arbitraryDocId";

// Sprint 2 Step 7: the terminal default-deny rule still governs every
// collection that has not been explicitly opened. Per-collection allow
// paths are exercised in the dedicated test suites for users/{uid},
// schools/{schoolId}, and auditEvents/{eventId}.
describe("Firestore Rules: default-deny remains for unopened collections", () => {
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
      await setDoc(doc(db, ARBITRARY_COLLECTION, ARBITRARY_DOC_ID), { seeded: true });
    });
  });

  it("denies unauthenticated read of an arbitrary collection", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, ARBITRARY_COLLECTION, ARBITRARY_DOC_ID)));
  });

  it("denies unauthenticated write to an arbitrary collection", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(db, ARBITRARY_COLLECTION, "new-doc"), { attempted: true }),
    );
  });

  it("denies authenticated read of an arbitrary collection", async () => {
    const db = testEnv.authenticatedContext(AUTH_UID).firestore();
    await assertFails(getDoc(doc(db, ARBITRARY_COLLECTION, ARBITRARY_DOC_ID)));
  });

  it("denies authenticated write to an arbitrary collection", async () => {
    const db = testEnv.authenticatedContext(AUTH_UID).firestore();
    await assertFails(
      setDoc(doc(db, ARBITRARY_COLLECTION, "new-doc"), { attempted: true }),
    );
  });
});
