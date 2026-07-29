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

// Sprint 23C-I - externalIdentities/{externalIdentityId} Rules
// coverage. The bridge collection is server-only per Sprint 23C-I;
// every client role is denied every operation via an explicit
// `allow read, write: if false;` block. This test suite is
// symmetric with `assessment-answer-keys.rules.test.ts` and
// `audit-events.rules.test.ts`.

const UNAUTH = () => null;
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

// A representative document ID: 64-char lowercase hex output of the
// `computeExternalIdentityDocId` helper for a fictional identifier.
const EXTERNAL_IDENTITY_ID =
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

describe("Firestore Rules: externalIdentities/{externalIdentityId}", () => {
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
      await setDoc(doc(db, "externalIdentities", EXTERNAL_IDENTITY_ID), {
        providerId: "google.com",
        providerAccountId: "0000000000",
        userId: "lyfe-uid-x",
        status: "active",
        source: "authOnUserCreate",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      });
    });
  });

  describe("read - every client role is denied", () => {
    it("denies unauthenticated get", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      void UNAUTH;
      await assertFails(
        getDoc(doc(db, "externalIdentities", EXTERNAL_IDENTITY_ID)),
      );
    });

    it("denies a student get", async () => {
      const db = testEnv
        .authenticatedContext(STUDENT_UID, STUDENT_TOKEN)
        .firestore();
      await assertFails(
        getDoc(doc(db, "externalIdentities", EXTERNAL_IDENTITY_ID)),
      );
    });

    it("denies a teacher get", async () => {
      const db = testEnv
        .authenticatedContext(TEACHER_UID, TEACHER_TOKEN)
        .firestore();
      await assertFails(
        getDoc(doc(db, "externalIdentities", EXTERNAL_IDENTITY_ID)),
      );
    });

    it("denies a platformAdministrator get", async () => {
      const db = testEnv
        .authenticatedContext(ADMIN_UID, ADMIN_TOKEN)
        .firestore();
      await assertFails(
        getDoc(doc(db, "externalIdentities", EXTERNAL_IDENTITY_ID)),
      );
    });

    it("denies unauthenticated list", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDocs(collection(db, "externalIdentities")));
    });

    it("denies a student list", async () => {
      const db = testEnv
        .authenticatedContext(STUDENT_UID, STUDENT_TOKEN)
        .firestore();
      await assertFails(getDocs(collection(db, "externalIdentities")));
    });

    it("denies a teacher list", async () => {
      const db = testEnv
        .authenticatedContext(TEACHER_UID, TEACHER_TOKEN)
        .firestore();
      await assertFails(getDocs(collection(db, "externalIdentities")));
    });

    it("denies a platformAdministrator list", async () => {
      const db = testEnv
        .authenticatedContext(ADMIN_UID, ADMIN_TOKEN)
        .firestore();
      await assertFails(getDocs(collection(db, "externalIdentities")));
    });
  });

  describe("write - every client role is denied create, update, delete", () => {
    const NEW_ID =
      "1111111111111111111111111111111111111111111111111111111111111111";

    it("denies unauthenticated create", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        setDoc(doc(db, "externalIdentities", NEW_ID), {
          providerId: "google.com",
          providerAccountId: "1",
          userId: "u",
          status: "active",
          source: "authOnUserCreate",
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );
    });

    it("denies a student create", async () => {
      const db = testEnv
        .authenticatedContext(STUDENT_UID, STUDENT_TOKEN)
        .firestore();
      await assertFails(
        setDoc(doc(db, "externalIdentities", NEW_ID), {
          providerId: "google.com",
          providerAccountId: "1",
          userId: STUDENT_UID,
          status: "active",
          source: "authOnUserCreate",
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );
    });

    it("denies a teacher update", async () => {
      const db = testEnv
        .authenticatedContext(TEACHER_UID, TEACHER_TOKEN)
        .firestore();
      await assertFails(
        updateDoc(doc(db, "externalIdentities", EXTERNAL_IDENTITY_ID), {
          status: "revoked",
        }),
      );
    });

    it("denies a platformAdministrator delete", async () => {
      const db = testEnv
        .authenticatedContext(ADMIN_UID, ADMIN_TOKEN)
        .firestore();
      await assertFails(
        deleteDoc(doc(db, "externalIdentities", EXTERNAL_IDENTITY_ID)),
      );
    });

    it("denies a student delete", async () => {
      const db = testEnv
        .authenticatedContext(STUDENT_UID, STUDENT_TOKEN)
        .firestore();
      await assertFails(
        deleteDoc(doc(db, "externalIdentities", EXTERNAL_IDENTITY_ID)),
      );
    });
  });

  describe("hypothetical subcollection - denied by the terminal deny", () => {
    it("denies a teacher read on a hypothetical subcollection under externalIdentities", async () => {
      const db = testEnv
        .authenticatedContext(TEACHER_UID, TEACHER_TOKEN)
        .firestore();
      await assertFails(
        getDoc(
          doc(
            db,
            "externalIdentities",
            EXTERNAL_IDENTITY_ID,
            "hypothetical",
            "child",
          ),
        ),
      );
    });

    it("denies a teacher write on a hypothetical subcollection under externalIdentities", async () => {
      const db = testEnv
        .authenticatedContext(TEACHER_UID, TEACHER_TOKEN)
        .firestore();
      await assertFails(
        setDoc(
          doc(
            db,
            "externalIdentities",
            EXTERNAL_IDENTITY_ID,
            "hypothetical",
            "child",
          ),
          { attempted: true },
        ),
      );
    });
  });
});
