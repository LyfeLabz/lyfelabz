import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from "firebase/firestore";

import { createTestEnvironment } from "./setup";

const AUTH_UID = "reader-uid";
const SCHOOL_ID = "school-a";

describe("Firestore Rules: schools/{schoolId}", () => {
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
      await setDoc(doc(db, "schools", SCHOOL_ID), {
        name: "Test Regional School",
        shortName: "TRS",
        timezone: "America/New_York",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
      await setDoc(doc(db, "schools", "school-b"), {
        name: "Other School",
        shortName: "OS",
        timezone: "America/Los_Angeles",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
    });
  });

  describe("read", () => {
    it("allows authenticated get of a school metadata document", async () => {
      const db = testEnv.authenticatedContext(AUTH_UID).firestore();
      await assertSucceeds(getDoc(doc(db, "schools", SCHOOL_ID)));
    });

    it("denies unauthenticated get of a school metadata document", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, "schools", SCHOOL_ID)));
    });

    it("denies collection list of schools", async () => {
      const db = testEnv.authenticatedContext(AUTH_UID).firestore();
      await assertFails(getDocs(collection(db, "schools")));
    });
  });

  describe("write", () => {
    it("denies authenticated create", async () => {
      const db = testEnv.authenticatedContext(AUTH_UID).firestore();
      await assertFails(
        setDoc(doc(db, "schools", "new-school"), {
          name: "New School",
          shortName: "NS",
          timezone: "America/New_York",
        }),
      );
    });

    it("denies authenticated update of an existing school", async () => {
      const db = testEnv.authenticatedContext(AUTH_UID).firestore();
      await assertFails(
        setDoc(
          doc(db, "schools", SCHOOL_ID),
          { name: "Renamed School" },
          { merge: true },
        ),
      );
    });
  });
});
