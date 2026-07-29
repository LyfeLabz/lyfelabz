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

// Sprint 23D. Rules coverage for the durable OAuth-state and
// token-bundle storage collections. Both are server-only per the
// LMS integration architecture (LMS_INTEGRATION_ARCHITECTURE.md
// §5.3, §5.5); every client role is denied every operation via an
// explicit `allow read, write: if false;` block. The suite is
// symmetric with the auditEvents, assessmentAnswerKeys, and
// externalIdentities rules tests.

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

const FIXTURE_STATE =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const FIXTURE_TOKEN_REF = "lms_token_0123456789abcdef0123456789abcdef";

function everyClientDenied(
  collectionName: string,
  fixtureId: string,
  seed: Record<string, unknown>,
): void {
  describe(`Firestore Rules: ${collectionName}/{docId}`, () => {
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
        await setDoc(doc(ctx.firestore(), collectionName, fixtureId), seed);
      });
    });

    describe("read - every client role is denied", () => {
      it("denies unauthenticated get", async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(db, collectionName, fixtureId)));
      });

      it("denies a student get", async () => {
        const db = testEnv
          .authenticatedContext(STUDENT_UID, STUDENT_TOKEN)
          .firestore();
        await assertFails(getDoc(doc(db, collectionName, fixtureId)));
      });

      it("denies a teacher get", async () => {
        const db = testEnv
          .authenticatedContext(TEACHER_UID, TEACHER_TOKEN)
          .firestore();
        await assertFails(getDoc(doc(db, collectionName, fixtureId)));
      });

      it("denies a platformAdministrator get", async () => {
        const db = testEnv
          .authenticatedContext(ADMIN_UID, ADMIN_TOKEN)
          .firestore();
        await assertFails(getDoc(doc(db, collectionName, fixtureId)));
      });

      it("denies a teacher list", async () => {
        const db = testEnv
          .authenticatedContext(TEACHER_UID, TEACHER_TOKEN)
          .firestore();
        await assertFails(getDocs(collection(db, collectionName)));
      });
    });

    describe("write - every client role is denied create, update, delete", () => {
      const NEW_ID = `${fixtureId}-new`;

      it("denies unauthenticated create", async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(
          setDoc(doc(db, collectionName, NEW_ID), { attempted: true }),
        );
      });

      it("denies a student create", async () => {
        const db = testEnv
          .authenticatedContext(STUDENT_UID, STUDENT_TOKEN)
          .firestore();
        await assertFails(
          setDoc(doc(db, collectionName, NEW_ID), { attempted: true }),
        );
      });

      it("denies a teacher update", async () => {
        const db = testEnv
          .authenticatedContext(TEACHER_UID, TEACHER_TOKEN)
          .firestore();
        await assertFails(
          updateDoc(doc(db, collectionName, fixtureId), { tampered: true }),
        );
      });

      it("denies a platformAdministrator delete", async () => {
        const db = testEnv
          .authenticatedContext(ADMIN_UID, ADMIN_TOKEN)
          .firestore();
        await assertFails(deleteDoc(doc(db, collectionName, fixtureId)));
      });
    });
  });
}

everyClientDenied("lmsOAuthStates", FIXTURE_STATE, {
  teacherId: "teacher-uid",
  providerId: "googleClassroom",
  redirectUri: "https://fixture.example.invalid/lms-callback",
  codeVerifier: "fixture-code-verifier",
  codeChallenge: "fixture-code-challenge",
  issuedAt: new Date("2026-01-01T00:00:00Z"),
  expiresAt: new Date("2026-01-01T00:10:00Z"),
  consumedAt: null,
});

everyClientDenied("lmsTokenBundles", FIXTURE_TOKEN_REF, {
  providerId: "googleClassroom",
  teacherId: "teacher-uid",
  accessToken: "fixture-access-token",
  refreshToken: "fixture-refresh-token",
  scopes: ["scope.a"],
  upstreamAccountIdentifier: "upstream-id",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});
