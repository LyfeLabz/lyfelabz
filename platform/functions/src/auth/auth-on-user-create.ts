import { FieldValue } from "firebase-admin/firestore";
import { auth } from "firebase-functions/v1";

import type { UserRecord } from "firebase-admin/auth";

import {
  PlatformError,
  createOrConfirmExternalIdentity,
  log,
  userDocRef,
  writeAuditEvent,
  type CreateOrConfirmOutcome,
  type UserProvisioningWrite,
} from "../shared";

const FIRESTORE_ALREADY_EXISTS = 6;

function isAlreadyExistsError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === FIRESTORE_ALREADY_EXISTS
  );
}

function resolveProvider(user: UserRecord): string {
  return user.providerData[0]?.providerId ?? "unknown";
}

function buildPayload(user: UserRecord): UserProvisioningWrite {
  const optional: {
    email?: string;
    displayName?: string;
  } = {};
  if (user.email) optional.email = user.email;
  if (user.displayName) optional.displayName = user.displayName;

  return {
    authUid: user.uid,
    status: "provisioned",
    createdAt: FieldValue.serverTimestamp(),
    ...optional,
  };
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not provisioning. A logger failure after the
    // Firestore write has succeeded (or after a failure is already being
    // rethrown) must not itself become the outcome of the trigger.
  }
}

// Sprint 23C-I. Extract the sole `google.com` provider entry from the
// Auth record if and only if it is well-formed. Returns `undefined`
// when the identity bridge should NOT act on this record:
//   - no `google.com` provider entry present,
//   - more than one `google.com` provider entry present (malformed),
//   - the single `google.com` entry is missing a non-empty `uid`.
//
// The trigger MUST NOT guess. Ambiguous provider data leaves the
// identity bridge untouched; the eventual reconciliation path
// (`reconcileMyExternalIdentity` callable, or the emulator-only admin
// migration) is the recovery lane.
function extractSingleGoogleProviderAccountId(
  user: UserRecord,
): string | undefined {
  const googleEntries = user.providerData.filter(
    (p) => p.providerId === "google.com",
  );
  if (googleEntries.length !== 1) return undefined;
  const providerAccountId = googleEntries[0].uid;
  if (typeof providerAccountId !== "string" || providerAccountId.length === 0) {
    return undefined;
  }
  return providerAccountId;
}

export const authOnUserCreate = auth.user().onCreate(async (user) => {
  if (!user.uid) {
    const err = new PlatformError(
      "auth.invalidUserRecord",
      "Auth user record is missing uid.",
    );
    safeLog(() =>
      log.error("auth.userCreateFailed", { uid: null, cause: err.code }),
    );
    throw err;
  }

  const provider = resolveProvider(user);

  try {
    await userDocRef(user.uid).create(buildPayload(user));
  } catch (err) {
    if (isAlreadyExistsError(err)) {
      // Idempotent replay: a prior invocation already provisioned this
      // user and already emitted the `auth.userProvisioned` audit event.
      // Emitting the event here would violate the
      // one-audit-event-per-state-transition invariant in
      // PLATFORM_STATE_MACHINE.md §3, so this branch remains observability
      // only.
      safeLog(() =>
        log.info("auth.userCreateSkipped", {
          uid: user.uid,
          reason: "already-exists",
        }),
      );
      return;
    }
    const cause = err instanceof Error ? err.name : "unknown";
    safeLog(() => log.error("auth.userCreateFailed", { uid: user.uid, cause }));
    throw err;
  }

  // Canonical `auth.userProvisioned` audit event per Sprint 2 §4.5 and the
  // transition table in PLATFORM_STATE_MACHINE.md §3. Emitted only after
  // the users/{uid} create succeeds so the audit stream never records a
  // transition that did not happen.
  //
  // System-authored per the amended Data Model §3.8: actorRole is `system`
  // because no user actor initiated the transition, and schoolId is
  // omitted because no school association exists at provisioning time.
  // The subject of the event is the newly provisioned user, recorded as
  // both actorUserId and targetId per §3.8.
  try {
    await writeAuditEvent({
      actorUserId: user.uid,
      actorRole: "system",
      action: "auth.userProvisioned",
      targetType: "user",
      targetId: user.uid,
    });
  } catch (err) {
    const cause = err instanceof Error ? err.name : "unknown";
    safeLog(() =>
      log.error("auth.userProvisionedAuditFailed", { uid: user.uid, cause }),
    );
    throw err;
  }

  // Sprint 23C-I: server-controlled external identity bridge.
  //
  // Immediately after the canonical provisioning audit, attempt to
  // record the (google.com, providerAccountId) -> Firebase UID
  // mapping in the `externalIdentities` collection. This is a
  // separate transition from `auth.userProvisioned`; the two audit
  // events are emitted independently to preserve the one-audit-per-
  // transition invariant.
  //
  // Semantics:
  //   - No `google.com` provider entry - valid case, no mapping
  //     written, no audit noise.
  //   - Multiple providers with exactly one `google.com` entry -
  //     bridge writes using the single Google entry.
  //   - Malformed / conflicting Google provider data - the bridge
  //     does NOT guess. The mapping failure is surfaced through the
  //     structured log stream as `identity.bridgeSkippedMalformed`;
  //     the provisioning transition itself is NOT retried, and the
  //     eventual-consistency recovery path is the
  //     `reconcileMyExternalIdentity` callable.
  //
  // Trigger retry behavior for the identity-bridge sub-step:
  //   - A collision or second-active refusal from the store is a
  //     stable, safe refusal; it is logged and swallowed so the
  //     trigger does not enter a Firebase-retry loop that could
  //     never make progress. Recovery is manual (operator invokes
  //     admin migration or the caller re-invokes the reconciliation
  //     callable after resolving the conflict).
  //   - Any OTHER error is re-thrown so Firebase's built-in trigger
  //     retry can heal a transient Firestore error. The provisioned
  //     user document and its canonical audit event are already
  //     durable; the identity bridge is the only side effect that
  //     can retry, and it does so idempotently because
  //     `createOrConfirmExternalIdentity` treats an existing active
  //     mapping for the same UID as `confirmedNoop`.
  const providerAccountId = extractSingleGoogleProviderAccountId(user);
  if (providerAccountId !== undefined) {
    let outcome: CreateOrConfirmOutcome | undefined;
    let externalIdentityId: string | undefined;
    try {
      const result = await createOrConfirmExternalIdentity({
        providerId: "google.com",
        providerAccountId,
        userId: user.uid,
        source: "authOnUserCreate",
      });
      outcome = result.outcome;
      externalIdentityId = result.externalIdentityId;
    } catch (err) {
      if (
        err instanceof PlatformError &&
        (err.code === "identity.collision" ||
          err.code === "identity.secondActiveForUser")
      ) {
        // Safe, stable refusal. Emit a safe collision-observation
        // audit event (target ID is a stable structural marker; the
        // raw provider account identifier NEVER appears in the audit
        // stream on this path) and log a structured failure. Do
        // NOT re-throw; the provisioning transition is already
        // committed.
        try {
          await writeAuditEvent({
            actorUserId: user.uid,
            actorRole: "system",
            action: "identity.collisionDetected",
            targetType: "externalIdentity",
            targetId: `authOnUserCreate-${user.uid}`,
          });
        } catch (auditErr) {
          safeLog(() =>
            log.error("identity.bridgeCollisionAuditFailed", {
              uid: user.uid,
              cause:
                auditErr instanceof Error ? auditErr.name : "unknown",
            }),
          );
        }
        safeLog(() =>
          log.warn("identity.bridgeSkippedCollision", {
            uid: user.uid,
            code: err.code,
          }),
        );
        return;
      }
      // Any other error - log and re-throw so Firebase retries the
      // trigger. The users/{uid} document create and its provisioning
      // audit are idempotent via the ALREADY_EXISTS branch above; the
      // identity bridge is idempotent via `createOrConfirm`.
      const cause = err instanceof Error ? err.name : "unknown";
      safeLog(() =>
        log.error("identity.bridgeWriteFailed", { uid: user.uid, cause }),
      );
      throw err;
    }

    if (outcome === "created" || outcome === "restored") {
      try {
        await writeAuditEvent({
          actorUserId: user.uid,
          actorRole: "system",
          action:
            outcome === "created"
              ? "identity.mappingCreated"
              : "identity.mappingRestored",
          targetType: "externalIdentity",
          targetId: externalIdentityId,
        });
      } catch (err) {
        const cause = err instanceof Error ? err.name : "unknown";
        safeLog(() =>
          log.error("identity.bridgeAuditFailed", { uid: user.uid, cause }),
        );
        throw err;
      }
    }
    // `confirmedNoop` does not emit an audit event: no state
    // transition occurred, and emitting one would violate the
    // one-audit-per-transition invariant.
  } else if (user.providerData.filter((p) => p.providerId === "google.com").length > 0) {
    // Google provider entries WERE present but did not pass the
    // single-well-formed-entry gate. Surface as a structured warning
    // so an operator can investigate; do NOT log the raw provider
    // account identifier, email, or displayName.
    safeLog(() =>
      log.warn("identity.bridgeSkippedMalformed", { uid: user.uid }),
    );
  }

  safeLog(() => log.info("auth.userCreated", { uid: user.uid, provider }));
});
