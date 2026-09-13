// Phase 8G.12 / 8G.12A - First Platform Administrator Bootstrap (operator CLI).
//
// Repository-local, operator-only entrypoint for the first-platform-
// administrator bootstrap. It parses explicit operator arguments, HARD-BINDS
// Firebase Admin to the acknowledged project, constructs the real
// firebase-admin-backed ports, and delegates ALL decision logic to the pure
// core in `bootstrap-platform-administrator-core.ts`.
//
// This file is NEVER exported from the Cloud Functions bundle (`src/index.ts`
// does not import it) and is NEVER wrapped as a Firebase callable. It runs
// only when invoked directly:
//
//   npm --prefix platform/functions run build
//   node platform/functions/lib/scripts/admin/bootstrap-platform-administrator.js \
//     --operation bootstrap --mode dryRun \
//     --project-id <PROJECT> --target-uid <UID> --target-email <EMAIL> \
//     --expected-current-role teacher --target-role platformAdministrator \
//     --expected-school-id <SCHOOL_ID> --change-ticket <TICKET>
//
// Apply mode additionally requires:
//   --mode apply \
//   --production-ack I_UNDERSTAND_THIS_MUTATES_PRODUCTION \
//   --apply-ack I_UNDERSTAND_THIS_APPLIES_A_ROLE_CHANGE
//
// See docs/platform/PLATFORM_ADMIN_BOOTSTRAP_RUNBOOK.md for the full runbook,
// prerequisites, fail-closed behavior, partial-failure repair, and rollback.
//
// No production identity (email, UID, project, school, district) is compiled
// into this file. Every value is an explicit argument.

import { FieldValue } from "firebase-admin/firestore";
import { applicationDefault, getApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

import {
  PLATFORM_ADMIN_BOOTSTRAP_VERSION,
  readCustomClaims,
  revokeUserRefreshTokens,
  writeCustomClaims,
  writeAuditEventInTransaction,
  type PlatformAdminBootstrapCreationWrite,
  type PlatformAdminBootstrapRollbackWrite,
} from "../../shared";
import { getAdminFirestore } from "../../shared/firestore/admin";
import {
  platformAdminBootstrapCreationDocRef,
  platformAdminBootstrapDocRef,
  platformAdminBootstrapRollbackDocRef,
  schoolDocRef,
  userRecordDocRef,
} from "../../shared/firestore/typed-ref";
import { USERS_COLLECTION, type Role } from "../../shared/types/user";
import {
  runBootstrap,
  BOOTSTRAP_ACTOR_ID,
  type BootstrapOptions,
  type BootstrapMode,
  type BootstrapOperation,
  type BootstrapPorts,
  type BootstrapTransaction,
} from "./bootstrap-platform-administrator-core";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

type RawArgs = Record<string, string | undefined>;

const FLAG_MAP: Readonly<Record<string, keyof RawArgs>> = {
  "--operation": "operation",
  "--mode": "mode",
  "--project-id": "projectId",
  "--target-uid": "targetUid",
  "--target-email": "targetEmail",
  "--expected-current-role": "expectedCurrentRole",
  "--target-role": "targetRole",
  "--expected-school-id": "expectedSchoolId",
  "--change-ticket": "changeTicket",
  "--production-ack": "productionAcknowledgement",
  "--apply-ack": "applyAcknowledgement",
  "--rollback-ack": "rollbackAcknowledgement",
};

function parseArgs(argv: readonly string[]): RawArgs {
  const args: RawArgs = {};
  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    const key = FLAG_MAP[flag];
    if (!key) {
      throw new Error(`Unknown or unexpected argument: ${flag}`);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function toOptions(args: RawArgs): BootstrapOptions {
  const operation = (args.operation ?? "bootstrap") as BootstrapOperation;
  const mode = (args.mode ?? "dryRun") as BootstrapMode;
  return {
    operation,
    mode,
    projectId: args.projectId ?? "",
    targetUid: args.targetUid ?? "",
    targetEmail: args.targetEmail ?? "",
    expectedCurrentRole: (args.expectedCurrentRole ?? "") as Role,
    targetRole: (args.targetRole ?? "") as Role,
    expectedSchoolId: args.expectedSchoolId ?? "",
    changeTicket: args.changeTicket ?? "",
    ...(args.productionAcknowledgement !== undefined
      ? { productionAcknowledgement: args.productionAcknowledgement }
      : {}),
    ...(args.applyAcknowledgement !== undefined
      ? { applyAcknowledgement: args.applyAcknowledgement }
      : {}),
    ...(args.rollbackAcknowledgement !== undefined
      ? { rollbackAcknowledgement: args.rollbackAcknowledgement }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Explicit project binding (Phase 8G.12A, Correction 1)
// ---------------------------------------------------------------------------

// Minimal shape of a firebase-admin App we read the bound project from. Kept
// local so the binding logic is unit-testable with a fake app object.
export type AppLike = { readonly options: { readonly projectId?: unknown } };

// Read the project id the App was EXPLICITLY bound to at initialization. This
// is `app.options.projectId`, which is populated only from the explicit
// `initializeApp({ projectId })` argument here - never from ambient
// GCLOUD_PROJECT / GCP_PROJECT / credential inference. Returns undefined when
// no explicit binding is present, so the caller fails closed.
export function readBoundProjectId(app: AppLike): string | undefined {
  const projectId = app.options.projectId;
  return typeof projectId === "string" && projectId.trim().length > 0
    ? projectId.trim()
    : undefined;
}

// Independently verify the bound project matches the acknowledged project id.
// Fails closed (throws) on any divergence or missing binding, BEFORE any
// production read or write. Pure and unit-testable.
export function assertProjectBinding(
  boundProjectId: string | undefined,
  acknowledgedProjectId: string,
): void {
  if (!boundProjectId) {
    throw new Error(
      "Firebase Admin is not explicitly bound to a project id; refusing.",
    );
  }
  if (boundProjectId !== acknowledgedProjectId) {
    throw new Error(
      `Firebase Admin is bound to "${boundProjectId}" but the acknowledged project is "${acknowledgedProjectId}"; refusing.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Emulator endpoint rejection (Phase 8G.12B, Correction 1)
// ---------------------------------------------------------------------------

// firebase-admin silently honors these env vars and redirects the
// corresponding service to a local emulator. The production administrator
// bootstrap touches ONLY Firestore and Auth, so if either endpoint override
// is present it could create a split-brain (e.g. Firestore validation against
// the emulator while Auth claim replacement / token revocation hit
// production) even though the acknowledged project string still matches. This
// tool must NEVER permit mixed emulator/production operation. We refuse rather
// than sanitize or unset. Only the two variables that redirect services THIS
// tool uses are checked; unrelated emulator variables (RTDB, PubSub, Storage,
// etc.) are intentionally not touched.
export const REJECTED_EMULATOR_ENDPOINT_VARS = [
  "FIRESTORE_EMULATOR_HOST",
  "FIREBASE_AUTH_EMULATOR_HOST",
] as const;

export function assertNoEmulatorEndpointOverrides(
  env: NodeJS.ProcessEnv,
): void {
  for (const name of REJECTED_EMULATOR_ENDPOINT_VARS) {
    const value = env[name];
    if (typeof value === "string" && value.trim().length > 0) {
      throw new Error(
        `Refusing to run: ${name} is set ("${value.trim()}"). The production platform-administrator bootstrap must never mix emulator and production endpoints; unset it and re-run against the real project.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Firebase app resolution / binding (Phase 8G.12B, Correction 3)
// ---------------------------------------------------------------------------

// Injectable seam around Firebase Admin app initialization so the binding path
// (not merely a detached string helper) is unit-testable without production
// credentials.
export type BootstrapAppEnv = {
  // Returns the existing [DEFAULT] app, or null if none exists. Must use the
  // getApp()-throws pattern, NOT getApps().length (which is non-empty even
  // when only a named app exists).
  getExistingDefaultApp: () => AppLike | null;
  // Initializes the [DEFAULT] app bound EXPLICITLY to `projectId` and returns
  // it. Application Default Credentials supply auth material only.
  initializeDefaultApp: (projectId: string) => AppLike;
};

// Resolve the exact Firebase Admin app the bootstrap will use, and validate it
// is explicitly bound to the acknowledged project. Chosen pattern (Option B in
// the runbook): the tool uses and validates the [DEFAULT] app, because every
// canonical shared helper (getAdminFirestore, typed refs, writeCustomClaims,
// writeAuditEventInTransaction, revokeUserRefreshTokens) derives from it.
//
//   - No [DEFAULT] app exists (even if some unrelated NAMED app does):
//     initialize a fresh [DEFAULT] app bound to the acknowledged project. The
//     unrelated named app is never reused.
//   - A [DEFAULT] app already exists: it is reused ONLY if it is explicitly
//     bound to the acknowledged project; otherwise fail closed (never adopt an
//     unrelated / wrong-project / another-script's default app).
//
// Never deletes or mutates any existing Firebase app.
export function resolveBootstrapApp(
  env: BootstrapAppEnv,
  acknowledgedProjectId: string,
): AppLike {
  const existing = env.getExistingDefaultApp();
  const app = existing ?? env.initializeDefaultApp(acknowledgedProjectId);
  // Whether reused or freshly created, the app MUST be explicitly bound to the
  // acknowledged project before any client derives from it.
  assertProjectBinding(readBoundProjectId(app), acknowledgedProjectId);
  return app;
}

function realAppEnv(): BootstrapAppEnv {
  return {
    getExistingDefaultApp: () => {
      try {
        return getApp();
      } catch {
        return null;
      }
    },
    initializeDefaultApp: (projectId) =>
      initializeApp({ credential: applicationDefault(), projectId }),
  };
}

// ---------------------------------------------------------------------------
// Real firebase-admin-backed ports
// ---------------------------------------------------------------------------

export function buildRealPorts(): BootstrapPorts {
  const auth = getAuth();
  const db = getAdminFirestore();

  return {
    // The project guard reads the EXPLICITLY BOUND project of the default app
    // (see main()'s initializeApp({ projectId })), never an environment
    // variable or credential inference, so the core's project check is a
    // genuine cross-check that the effective client targets the acknowledged
    // project.
    getConfiguredProjectId: () => {
      try {
        return readBoundProjectId(getApp());
      } catch {
        return undefined;
      }
    },

    getAuthUserByUid: async (uid) => {
      try {
        const record = await auth.getUser(uid);
        return {
          uid: record.uid,
          ...(record.email !== undefined ? { email: record.email } : {}),
          disabled: record.disabled === true,
        };
      } catch {
        return null;
      }
    },

    getAuthUserByEmail: async (email) => {
      try {
        const record = await auth.getUserByEmail(email);
        return {
          uid: record.uid,
          ...(record.email !== undefined ? { email: record.email } : {}),
          disabled: record.disabled === true,
        };
      } catch {
        return null;
      }
    },

    readCurrentClaims: async (uid) => {
      const view = await readCustomClaims(uid);
      return {
        ...(view.role !== undefined ? { role: view.role } : {}),
        ...(view.schoolId !== undefined ? { schoolId: view.schoolId } : {}),
        ...(view.districtId !== undefined
          ? { districtId: view.districtId }
          : {}),
      };
    },

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
            const data = snap.data() as
              | (Record<string, unknown> & { districtId?: unknown })
              | undefined;
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
            // `create` fails if the singleton already exists, so a concurrent
            // second first-admin attempt cannot overwrite the lineage.
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
      // writeCustomClaims replaces the claim payload atomically with the
      // canonical { role, schoolId, districtId } shape (no merge of stale
      // claims). status "active" is required by the helper's invariant.
      await writeCustomClaims({
        uid: input.uid,
        status: "active",
        role: input.role,
        schoolId: input.schoolId,
        districtId: input.districtId,
      });
    },

    revokeRefreshTokens: async (uid) => {
      await revokeUserRefreshTokens(uid);
    },
  };
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = toOptions(parseArgs(process.argv));

  // CRITICAL, BEFORE any app init / client / read / write: refuse if a
  // Firestore or Auth emulator endpoint override is present. This prevents a
  // mixed emulator/production split-brain even when the project string
  // matches.
  assertNoEmulatorEndpointOverrides(process.env);

  // HARD-BIND Firebase Admin to the acknowledged project via the injectable
  // seam, and validate the resolved app is explicitly bound to that project
  // BEFORE any client derives from it. Never reuses an unrelated/wrong-project
  // app.
  resolveBootstrapApp(realAppEnv(), options.projectId);

  const ports = buildRealPorts();
  const result = await runBootstrap(options, ports);

  // Print only non-sensitive result fields. Never print tokens or secrets.
  // Role/schoolId/districtId are canonical, non-secret authorization context.
  console.log(JSON.stringify(result, null, 2));

  if (options.mode === "dryRun") {
    console.log(
      "\n[bootstrap] DRY RUN only. No production state was mutated. Re-run with --mode apply and the required acknowledgements to apply.",
    );
  } else {
    console.log(
      "\n[bootstrap] APPLY complete. The target must SIGN OUT and back in so a fresh ID token carries the replaced claims.",
    );
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    const code =
      err && typeof err === "object" && "code" in err
        ? String(err.code)
        : "unknown";
    const message = err instanceof Error ? err.message : String(err);
    // Fail closed and loud. No secrets are included in PlatformError messages.
    console.error(`[bootstrap] FAILED (${code}): ${message}`);
    process.exitCode = 1;
  });
}
