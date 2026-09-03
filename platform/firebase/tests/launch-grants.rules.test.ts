import {
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc } from "firebase/firestore";

import { createTestEnvironment } from "./setup";

// F5.2 Persistent Student Differentiation, Slice 4 (server resolution + launch
// grants). The `launchGrants/{grantId}` record family is server-owned,
// TTL-transient presentation-binding EVIDENCE per F5.2 §3.6, §7.2, and §11:
// zero direct client read/write for ANY role. A grant authorizes nothing by
// itself; leaking its contents would only disclose a student's differentiation
// configuration. The Slice 4 launch resolution (Op C) is the sole writer and
// `assessmentSessionsBegin` (Slice 6) the sole reader; both run through the
// Admin SDK, bypassing Rules entirely (T-A9 per F5.2 §13).

const TEACHER_UID = "teacher-uid";
const STUDENT_UID = "student-uid";
const OWNER_STUDENT_UID = "grant-owner-uid";
const GRANT_ID = "0123456789abcdef0123456789abcdef";

describe("Firestore Rules: launchGrants/{grantId}", () => {
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
      await setDoc(doc(db, "launchGrants", GRANT_ID), {
        grantId: GRANT_ID,
        studentId: OWNER_STUDENT_UID,
        assignmentId: "assign-1",
        lessonSlug: "earths-layers",
        outcomeAtIssuance: "differentiated",
        variantKey: "reading-adapted",
        presentationRevisionId: `pr${"a".repeat(64)}`,
        issuedAt: new Date("2026-09-03T00:00:00Z"),
        expiresAt: new Date("2026-09-03T06:00:00Z"),
      });
    });
  });

  it("denies the owning student's own read (grant contents never leak)", async () => {
    const db = testEnv.authenticatedContext(OWNER_STUDENT_UID).firestore();
    await assertFails(getDoc(doc(db, "launchGrants", GRANT_ID)));
  });

  it("denies an unrelated student's read", async () => {
    const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
    await assertFails(getDoc(doc(db, "launchGrants", GRANT_ID)));
  });

  it("denies a teacher's read", async () => {
    const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
    await assertFails(getDoc(doc(db, "launchGrants", GRANT_ID)));
  });

  it("denies an unauthenticated read", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "launchGrants", GRANT_ID)));
  });

  it("denies collection enumeration (list) for a student", async () => {
    const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
    await assertFails(getDocs(collection(db, "launchGrants")));
  });

  it("denies collection enumeration (list) for a teacher", async () => {
    const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
    await assertFails(getDocs(collection(db, "launchGrants")));
  });

  it("denies a client-forged create (minting a grant)", async () => {
    const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
    await assertFails(
      setDoc(doc(db, "launchGrants", "f".repeat(32)), {
        grantId: "f".repeat(32),
        studentId: STUDENT_UID,
        assignmentId: "assign-1",
        lessonSlug: "earths-layers",
        outcomeAtIssuance: "differentiated",
        variantKey: "reading-adapted",
        presentationRevisionId: `pr${"a".repeat(64)}`,
      }),
    );
  });

  it("denies a client update (e.g. swapping the bound pair or extending TTL)", async () => {
    const db = testEnv.authenticatedContext(OWNER_STUDENT_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "launchGrants", GRANT_ID), {
        presentationRevisionId: `pr${"b".repeat(64)}`,
      }),
    );
  });

  it("denies a client delete", async () => {
    const db = testEnv.authenticatedContext(TEACHER_UID).firestore();
    await assertFails(deleteDoc(doc(db, "launchGrants", GRANT_ID)));
  });

  it("denies an unauthenticated write", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(db, "launchGrants", "e".repeat(32)), { grantId: "e".repeat(32) }),
    );
  });
});
