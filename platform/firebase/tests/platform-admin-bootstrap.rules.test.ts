import {
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc } from "firebase/firestore";

import { createTestEnvironment } from "./setup";

// Phase 8G.12A - `platformAdminBootstrap/{docId}` is server-only, deny-client
// durable lineage for the first-platform-administrator bootstrap. It is
// written and read ONLY by the operator bootstrap tool under Admin SDK
// authority (which bypasses Rules); every client role is denied every
// operation on it. It is security-sensitive evidence and the serialization
// point for the first-admin lifecycle, so a client that could read it would
// learn the administrator's identity and a client that could write it could
// forge or destroy the lineage.

const TEACHER_UID = "teacher-uid";
const STUDENT_UID = "student-uid";
const ADMIN_UID = "admin-uid";
const DOC_ID = "initial";

describe("Firestore Rules: platformAdminBootstrap/{docId}", () => {
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
      await setDoc(doc(db, "platformAdminBootstrap", DOC_ID), {
        targetUid: ADMIN_UID,
        previousRole: "teacher",
        newRole: "platformAdministrator",
        schoolId: "school-1",
        districtId: "district-1",
        correlationId: "CHANGE-1",
        reason: "initialBootstrap",
        state: "active",
        version: 1,
        createdAt: new Date("2026-09-12T00:00:00Z"),
      });
    });
  });

  it("denies an administrator-claimed user's read (lineage never leaks)", async () => {
    const db = testEnv
      .authenticatedContext(ADMIN_UID, { role: "platformAdministrator" })
      .firestore();
    await assertFails(getDoc(doc(db, "platformAdminBootstrap", DOC_ID)));
  });

  it("denies a teacher's read", async () => {
    const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
    await assertFails(getDoc(doc(db, "platformAdminBootstrap", DOC_ID)));
  });

  it("denies a student's read", async () => {
    const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
    await assertFails(getDoc(doc(db, "platformAdminBootstrap", DOC_ID)));
  });

  it("denies an unauthenticated read", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "platformAdminBootstrap", DOC_ID)));
  });

  it("denies collection enumeration (list)", async () => {
    const db = testEnv
      .authenticatedContext(ADMIN_UID, { role: "platformAdministrator" })
      .firestore();
    await assertFails(getDocs(collection(db, "platformAdminBootstrap")));
  });

  it("denies a client-forged create (minting a lineage / self-elevating)", async () => {
    const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
    await assertFails(
      setDoc(doc(db, "platformAdminBootstrap", "forged"), {
        targetUid: TEACHER_UID,
        previousRole: "teacher",
        newRole: "platformAdministrator",
        schoolId: "school-1",
        districtId: "district-1",
        correlationId: "x",
        reason: "initialBootstrap",
        state: "active",
        version: 1,
      }),
    );
  });

  it("denies a client update (e.g. flipping state or retargeting)", async () => {
    const db = testEnv
      .authenticatedContext(ADMIN_UID, { role: "platformAdministrator" })
      .firestore();
    await assertFails(
      updateDoc(doc(db, "platformAdminBootstrap", DOC_ID), { state: "rolledBack" }),
    );
  });

  it("denies a client delete (destroying lineage)", async () => {
    const db = testEnv
      .authenticatedContext(ADMIN_UID, { role: "platformAdministrator" })
      .firestore();
    await assertFails(deleteDoc(doc(db, "platformAdminBootstrap", DOC_ID)));
  });

  it("denies an unauthenticated write", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(db, "platformAdminBootstrap", "forged"), { targetUid: "x" }),
    );
  });
});
