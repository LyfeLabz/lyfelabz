/* eslint-disable @typescript-eslint/require-await */
// Phase 8G.12A - Emulator-backed bootstrap transaction & concurrency proofs.
//
// These tests run against the REAL Firestore emulator (launched by
// `npm run test:emulator` via `firebase emulators:exec`), exercising the
// real firebase-admin transaction path - NOT mocked ports - to prove the
// properties that mocks cannot fully establish:
//
//   - the role transition, durable lineage create, and audit commit
//     ATOMICALLY in one real Firestore transaction (a mid-transaction failure
//     writes nothing);
//   - two concurrent first-admin attempts against DIFFERENT targets are
//     serialized by the singleton lineage document: exactly one admin, one
//     lineage, one audit; the loser fails closed.
//
// Auth-side ports (getAuthUser*, claims, revoke) are faked; only Firestore is
// real. Skips gracefully if the emulator env var is absent.

import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

import {
  writeAuditEventInTransaction,
  platformAdminBootstrapCreationDocRef,
  platformAdminBootstrapDocRef,
  platformAdminBootstrapRollbackDocRef,
  schoolDocRef,
  userRecordDocRef,
  PLATFORM_ADMIN_BOOTSTRAP_VERSION,
  type PlatformAdminBootstrapCreationWrite,
  type PlatformAdminBootstrapRollbackWrite,
} from "../../shared";
import { USERS_COLLECTION } from "../../shared/types/user";
import {
  runBootstrap,
  BOOTSTRAP_ACTOR_ID,
  APPLY_ACKNOWLEDGEMENT,
  PRODUCTION_ACKNOWLEDGEMENT,
  type BootstrapAuthIdentity,
  type BootstrapOptions,
  type BootstrapPorts,
  type BootstrapTransaction,
} from "./bootstrap-platform-administrator-core";

const PROJECT = "demo-bootstrap";
const SCHOOL_ID = "school-emu";
const DISTRICT_ID = "district-emu";
const hasEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const d = hasEmulator ? describe : describe.skip;

// Correction 12 - emulator harness fail-closed safety. This suite must ONLY
// run against the Firestore emulator with an approved demo/test project, and
// must never fall through to ADC-backed production Firestore. When the
// emulator host is absent the suite is skipped (cannot contact anything); when
// it IS present, we hard-refuse a production/staging or non-demo project.
const APPROVED_EMULATOR_PROJECTS = new Set(["demo-bootstrap"]);
function assertEmulatorHarnessSafe(): void {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "Emulator tests require FIRESTORE_EMULATOR_HOST; run via `npm run test:emulator`.",
    );
  }
  const envProject =
    process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? PROJECT;
  for (const p of [PROJECT, envProject]) {
    if (p === "lyfelabz-prod" || p === "lyfelabz-staging") {
      throw new Error(
        `Refusing to run emulator tests against "${p}"; a demo/test project is required.`,
      );
    }
  }
  if (!APPROVED_EMULATOR_PROJECTS.has(PROJECT)) {
    throw new Error(
      `Refusing: emulator project "${PROJECT}" is not an approved demo project.`,
    );
  }
}

// Correction 6: the harness safety guard runs UNCONDITIONALLY before any app
// reuse OR creation whenever the emulator is present - not only when no app
// exists yet. This guarantees every emulator test process validates the
// host + approved demo project (and refuses prod/staging) before Firestore is
// touched, even if a Firebase app was already initialized by another module.
if (hasEmulator) {
  assertEmulatorHarnessSafe();
  if (getApps().length === 0) {
    initializeApp({ projectId: PROJECT });
  }
}
// Only touch Firestore when the emulator is present; otherwise the suite is
// skipped and `db` is never used (avoids an import-time default-app throw and
// any possibility of contacting production).
const db = hasEmulator ? getFirestore() : (undefined as never);

// Fake Auth registry the ports read from.
const authUsers = new Map<string, BootstrapAuthIdentity>();
const authByEmail = new Map<string, BootstrapAuthIdentity>();
const claims = new Map<string, { role?: string; schoolId?: string; districtId?: string }>();
const revoked: string[] = [];

function realFirestorePorts(): BootstrapPorts {
  return {
    getConfiguredProjectId: () => PROJECT,
    getAuthUserByUid: async (uid) => authUsers.get(uid) ?? null,
    getAuthUserByEmail: async (email) => authByEmail.get(email.toLowerCase()) ?? null,
    readCurrentClaims: async (uid) => claims.get(uid) ?? {},
    runTransaction: async (fn) =>
      db.runTransaction(async (rawTx) => {
        const adapter: BootstrapTransaction = {
          getUser: async (uid) => {
            const snap = await rawTx.get(userRecordDocRef(uid));
            return snap.exists ? (snap.data() ?? null) : null;
          },
          getSchoolDistrictId: async (schoolId) => {
            const snap = await rawTx.get(schoolDocRef(schoolId));
            if (!snap.exists) return null;
            const data = snap.data() as { districtId?: unknown } | undefined;
            const districtId = data?.districtId;
            return typeof districtId === "string" && districtId.trim().length > 0
              ? districtId
              : null;
          },
          getBootstrapRecord: async () => {
            const snap = await rawTx.get(platformAdminBootstrapDocRef());
            return snap.exists ? (snap.data() ?? null) : null;
          },
          getActiveAdministratorUids: async () => {
            const query = db
              .collection(USERS_COLLECTION)
              .where("role", "==", "platformAdministrator")
              .where("status", "==", "active");
            const snap = await rawTx.get(query);
            return snap.docs.map((doc) => doc.id);
          },
          setUserRole: (uid, role) => {
            rawTx.update(userRecordDocRef(uid), { role });
          },
          createBootstrapRecord: (input) => {
            const write: PlatformAdminBootstrapCreationWrite = {
              targetUid: input.targetUid,
              previousRole: input.previousRole,
              newRole: input.newRole,
              schoolId: input.schoolId,
              districtId: input.districtId,
              correlationId: input.correlationId,
              reason: input.reason,
              state: "active",
              version: PLATFORM_ADMIN_BOOTSTRAP_VERSION,
              createdAt: FieldValue.serverTimestamp(),
            };
            rawTx.create(platformAdminBootstrapCreationDocRef(), write);
          },
          updateBootstrapRecordToRolledBack: (input) => {
            const write: PlatformAdminBootstrapRollbackWrite = {
              state: "rolledBack",
              rolledBackAt: FieldValue.serverTimestamp(),
              rollbackCorrelationId: input.rollbackCorrelationId,
            };
            rawTx.update(platformAdminBootstrapRollbackDocRef(), write);
          },
          writeRoleChangedAudit: (input) => {
            writeAuditEventInTransaction(rawTx, {
              actorUserId: BOOTSTRAP_ACTOR_ID,
              actorRole: "system",
              action: "users.roleChanged",
              targetType: "user",
              targetId: input.targetUid,
              schoolId: input.schoolId,
              districtId: input.districtId,
              payload: {
                previousRole: input.previousRole,
                newRole: input.newRole,
                reason: input.reason,
              },
              correlationId: input.correlationId,
            });
          },
        };
        return fn(adapter);
      }),
    replaceCustomClaims: async (input) => {
      claims.set(input.uid, { role: input.role, schoolId: input.schoolId, districtId: input.districtId });
    },
    revokeRefreshTokens: async (uid) => {
      revoked.push(uid);
    },
  };
}

async function clearCollection(name: string): Promise<void> {
  const snap = await db.collection(name).get();
  await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
}

async function seedTeacher(uid: string, email: string): Promise<void> {
  authUsers.set(uid, { uid, email, disabled: false });
  authByEmail.set(email.toLowerCase(), { uid, email, disabled: false });
  await db.collection(USERS_COLLECTION).doc(uid).set({
    authUid: uid,
    status: "active",
    role: "teacher",
    schoolId: SCHOOL_ID,
    displayName: "Emu Teacher",
    email,
    createdAt: FieldValue.serverTimestamp(),
  });
}

function applyOpts(uid: string, email: string, ticket: string): BootstrapOptions {
  return {
    operation: "bootstrap",
    mode: "apply",
    projectId: PROJECT,
    targetUid: uid,
    targetEmail: email,
    expectedCurrentRole: "teacher",
    targetRole: "platformAdministrator",
    expectedSchoolId: SCHOOL_ID,
    changeTicket: ticket,
    productionAcknowledgement: PRODUCTION_ACKNOWLEDGEMENT,
    applyAcknowledgement: APPLY_ACKNOWLEDGEMENT,
  };
}

d("bootstrap against the real Firestore emulator", () => {
  beforeEach(async () => {
    authUsers.clear();
    authByEmail.clear();
    claims.clear();
    revoked.length = 0;
    await clearCollection(USERS_COLLECTION);
    await clearCollection("platformAdminBootstrap");
    await clearCollection("auditEvents");
    await db.collection("schools").doc(SCHOOL_ID).set({
      name: "Emu School",
      timezone: "America/New_York",
      districtId: DISTRICT_ID,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  test("fresh bootstrap commits role + lineage + audit atomically in real Firestore", async () => {
    await seedTeacher("uid-a", "a@example.org");
    const result = await runBootstrap(applyOpts("uid-a", "a@example.org", "CHANGE-1"), realFirestorePorts());
    expect(result.outcome).toBe("applied");

    const user = (await db.collection(USERS_COLLECTION).doc("uid-a").get()).data();
    expect(user?.role).toBe("platformAdministrator");
    // Unrelated fields preserved.
    expect(user?.displayName).toBe("Emu Teacher");
    expect(user?.email).toBe("a@example.org");

    const lineage = (await db.collection("platformAdminBootstrap").doc("initial").get()).data();
    expect(lineage).toMatchObject({
      targetUid: "uid-a",
      previousRole: "teacher",
      newRole: "platformAdministrator",
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      correlationId: "CHANGE-1",
      reason: "initialBootstrap",
      state: "active",
      version: PLATFORM_ADMIN_BOOTSTRAP_VERSION,
    });

    const audits = await db
      .collection("auditEvents")
      .where("action", "==", "users.roleChanged")
      .get();
    expect(audits.size).toBe(1);
    expect(audits.docs[0].data().payload).toEqual({
      previousRole: "teacher",
      newRole: "platformAdministrator",
      reason: "initialBootstrap",
    });
  });

  test("a mid-transaction failure writes nothing (atomicity): unresolved district", async () => {
    await seedTeacher("uid-b", "b@example.org");
    // Remove the school's district so the transaction fails AFTER the admin
    // gate but before writes complete.
    await db.collection("schools").doc(SCHOOL_ID).set({ name: "Emu School" });

    await expect(
      runBootstrap(applyOpts("uid-b", "b@example.org", "CHANGE-2"), realFirestorePorts()),
    ).rejects.toMatchObject({ code: "bootstrap.districtUnresolved" });

    const user = (await db.collection(USERS_COLLECTION).doc("uid-b").get()).data();
    expect(user?.role).toBe("teacher"); // unchanged
    const lineage = await db.collection("platformAdminBootstrap").doc("initial").get();
    expect(lineage.exists).toBe(false);
    const audits = await db.collection("auditEvents").get();
    expect(audits.size).toBe(0);
  });

  test("repeated concurrent first-admin races on DIFFERENT targets: exactly one wins each time", async () => {
    const REPS = 5;
    for (let i = 0; i < REPS; i += 1) {
      // Fresh state per repetition.
      await clearCollection(USERS_COLLECTION);
      await clearCollection("platformAdminBootstrap");
      await clearCollection("auditEvents");
      authUsers.clear();
      authByEmail.clear();
      claims.clear();
      revoked.length = 0;

      const emailA = `a${i}@example.org`;
      const emailB = `b${i}@example.org`;
      await seedTeacher("uid-A", emailA);
      await seedTeacher("uid-B", emailB);
      const beforeA = (await db.collection(USERS_COLLECTION).doc("uid-A").get()).data();
      const beforeB = (await db.collection(USERS_COLLECTION).doc("uid-B").get()).data();

      const results = await Promise.allSettled([
        runBootstrap(applyOpts("uid-A", emailA, `CHANGE-A${i}`), realFirestorePorts()),
        runBootstrap(applyOpts("uid-B", emailB, `CHANGE-B${i}`), realFirestorePorts()),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      // The refusal is an EXPECTED race outcome: either the bootstrap's own
      // lineage/admin-exists conflict (the loser observed the winner's lineage
      // on transaction retry), or a raw Firestore transaction-contention abort
      // (the loser's transaction was aborted by the singleton write conflict
      // and never committed). Both mean the loser wrote nothing; the
      // singleton-serialization invariants below (exactly one admin / lineage /
      // audit, loser byte-for-byte preserved) are the authoritative proof.
      const reason = rejected[0].reason as { code?: unknown; message?: unknown };
      const reasonCode =
        typeof reason?.code === "string" || typeof reason?.code === "number"
          ? String(reason.code)
          : "";
      const reasonMessage =
        typeof reason?.message === "string" ? reason.message : "";
      const isBootstrapConflict =
        /^bootstrap\.(lineageConflict|administratorExists|lineageCreateConflict)$/.test(
          reasonCode,
        );
      // Correction 5: accept a raw Firestore refusal ONLY when it is a clearly
      // identifiable transaction contention/abort - matched on the specific
      // messages the emulator actually produces for this singleton race
      // ("Transaction is invalid or closed", ABORTED, ALREADY_EXISTS, too much
      // contention), or the well-known contention gRPC codes ALREADY_EXISTS(6)
      // / ABORTED(10). A bare numeric code 3 (INVALID_ARGUMENT) is NOT accepted
      // on its own, because code 3 can represent unrelated failures; it counts
      // only when its message is the transaction-invalid/closed contention text.
      const isFirestoreContention =
        /ALREADY_EXISTS|already exists|ABORTED|Transaction is invalid or closed|too much contention|contention/i.test(
          reasonMessage,
        ) ||
        reasonCode === "6" ||
        reasonCode === "10";
      expect(isBootstrapConflict || isFirestoreContention).toBe(true);

      // Exactly one active administrator, one lineage, one initial audit.
      const admins = await db
        .collection(USERS_COLLECTION)
        .where("role", "==", "platformAdministrator")
        .where("status", "==", "active")
        .get();
      expect(admins.size).toBe(1);
      const lineage = await db.collection("platformAdminBootstrap").doc("initial").get();
      expect(lineage.exists).toBe(true);
      const audits = await db
        .collection("auditEvents")
        .where("action", "==", "users.roleChanged")
        .get();
      expect(audits.size).toBe(1);
      // No unexpected audit documents beyond the single role-change audit.
      const allAudits = await db.collection("auditEvents").get();
      expect(allAudits.size).toBe(1);

      const winnerUid = admins.docs[0].id;
      const loserUid = winnerUid === "uid-A" ? "uid-B" : "uid-A";
      expect(lineage.data()?.targetUid).toBe(winnerUid);

      // Winner changed ONLY the role field.
      const winnerAfter = (await db.collection(USERS_COLLECTION).doc(winnerUid).get()).data();
      const winnerBefore = winnerUid === "uid-A" ? beforeA : beforeB;
      expect(winnerAfter).toEqual({ ...winnerBefore, role: "platformAdministrator" });

      // Losing target document equals its pre-race state (byte-for-byte).
      const loserAfter = (await db.collection(USERS_COLLECTION).doc(loserUid).get()).data();
      const loserBefore = loserUid === "uid-A" ? beforeA : beforeB;
      expect(loserAfter).toEqual(loserBefore);
      expect(loserAfter?.role).toBe("teacher");
    }
  });

  test("replay against real lineage is idempotent (no second lineage or audit)", async () => {
    await seedTeacher("uid-c", "c@example.org");
    await runBootstrap(applyOpts("uid-c", "c@example.org", "CHANGE-C"), realFirestorePorts());
    const second = await runBootstrap(applyOpts("uid-c", "c@example.org", "CHANGE-C"), realFirestorePorts());
    expect(["alreadyComplete", "repairedAuth"]).toContain(second.outcome);
    const audits = await db
      .collection("auditEvents")
      .where("action", "==", "users.roleChanged")
      .get();
    expect(audits.size).toBe(1);
  });

  test("replay with a mismatched change ticket fails closed (lineage conflict)", async () => {
    await seedTeacher("uid-d", "d@example.org");
    await runBootstrap(applyOpts("uid-d", "d@example.org", "CHANGE-D"), realFirestorePorts());
    await expect(
      runBootstrap(applyOpts("uid-d", "d@example.org", "DIFFERENT-9"), realFirestorePorts()),
    ).rejects.toMatchObject({ code: "bootstrap.lineageConflict" });
  });
});
