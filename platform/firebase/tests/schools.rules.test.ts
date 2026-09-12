import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from "firebase/firestore";

import { createTestEnvironment } from "./setup";

const AUTH_UID = "reader-uid";
const SCHOOL_ID = "school-a";
const DISTRICT_ID = "district-a";

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
      // Phase 8G.3: shared authenticated read surfaces require an active
      // canonical user record.
      await setDoc(doc(db, "users", AUTH_UID), {
        authUid: AUTH_UID,
        status: "active",
        role: "student",
        schoolId: SCHOOL_ID,
        displayName: "Active Reader",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
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

    // Phase 8G.3/8G.5 - suspension enforcement on the shared authenticated surface.
    // The token carries stale teacher claims (role, schoolId, districtId) as they
    // would appear on an already-issued ID token immediately after suspension.
    // Canonical users/{uid}.status === "suspended" must override those stale claims.
    it("denies a suspended teacher with stale claims from getting a school", async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), "users", AUTH_UID), {
          authUid: AUTH_UID,
          status: "suspended",
          role: "teacher",
          schoolId: SCHOOL_ID,
          displayName: "Suspended Teacher",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        });
      });
      const STALE_TEACHER_TOKEN = {
        role: "teacher",
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
      };
      const db = testEnv
        .authenticatedContext(AUTH_UID, STALE_TEACHER_TOKEN)
        .firestore();
      await assertFails(getDoc(doc(db, "schools", SCHOOL_ID)));
    });

    it("denies a caller with no canonical user record (fails closed)", async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await deleteDoc(doc(ctx.firestore(), "users", AUTH_UID));
      });
      const db = testEnv.authenticatedContext(AUTH_UID).firestore();
      await assertFails(getDoc(doc(db, "schools", SCHOOL_ID)));
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
