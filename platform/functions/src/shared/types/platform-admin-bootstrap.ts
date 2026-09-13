import { Timestamp, type FieldValue } from "firebase-admin/firestore";

import type { Role } from "./user";

// Strict runtime guard for the canonical Firestore timestamp representation
// (Phase 8G.12C). The persisted canonical read model stores timestamps as
// firebase-admin `Timestamp` instances (that is exactly what a Firestore read
// deserializes into, in both production and the emulator). A value is a
// canonical timestamp ONLY when it is a real `Timestamp` instance from the
// Firebase Admin Firestore runtime.
//
// Deliberately rejects, with no coercion:
//   - `Date`
//   - ISO date strings and numeric epochs
//   - `null` / `undefined`
//   - plain `{ seconds, nanoseconds }` maps (structural lookalikes)
//   - arbitrary objects exposing `toDate()` or mimicking Timestamp methods
//
// This is the ONE authoritative validator for `users/{uid}.createdAt`,
// bootstrap lineage `createdAt`, and rollback lineage `rolledBackAt`.
export function isCanonicalTimestamp(value: unknown): value is Timestamp {
  return value instanceof Timestamp;
}

// Phase 8G.12A - durable first-platform-administrator bootstrap lineage.
//
// A single server-only, deny-client document records the lineage of the
// first-administrator role transition so that repair replay, already-complete
// detection, rollback target/destination, and correlation identity all derive
// from a durable authority rather than from the mutable `users/{uid}.role`
// alone. The collection is a singleton: exactly one bootstrap lineage record
// (`platformAdminBootstrap/initial`) can exist, and its own document id is the
// serialization point for concurrent first-admin attempts.
//
// The document is written and read ONLY by the operator bootstrap tool running
// under Admin SDK authority; it is denied to every client role at the Rules
// layer (mirroring `auditEvents`, `externalIdentities`, `launchGrants`). It
// stores no email, no token, and no secret.
export const PLATFORM_ADMIN_BOOTSTRAP_COLLECTION = "platformAdminBootstrap";

// Canonical singleton document id. There is exactly one first-administrator
// lineage; the fixed id makes concurrent creates contend on the same document,
// so Firestore transaction isolation admits exactly one winner.
export const INITIAL_BOOTSTRAP_DOC_ID = "initial";

// Current lineage schema/transition version. Bumped only if the record shape
// changes; replay/rollback require a compatible version.
export const PLATFORM_ADMIN_BOOTSTRAP_VERSION = 1;

// Lifecycle of the recorded transition. `active` means the initial bootstrap
// is in force (target is the administrator). `rolledBack` means the paired,
// audited rollback restored the prior role.
export type BootstrapLineageState = "active" | "rolledBack";

// Canonical read shape of `platformAdminBootstrap/initial`. Every field is
// server-controlled; no client-supplied free text beyond the constrained
// correlation identifier is stored, and no email/token/secret ever appears.
export type PlatformAdminBootstrapRecord = {
  // The administrator's UID (equals the transitioned `users/{uid}` id).
  readonly targetUid: string;
  // The role held before the initial bootstrap (the rollback destination).
  readonly previousRole: Role;
  // The role granted by the initial bootstrap (always platformAdministrator).
  readonly newRole: Role;
  readonly schoolId: string;
  readonly districtId: string;
  // Constrained operator change/correlation identifier of the initial
  // bootstrap (see the change-ticket validator in the bootstrap core).
  readonly correlationId: string;
  // Always the string "initialBootstrap"; the lineage exists only for the
  // first-administrator transition.
  readonly reason: string;
  readonly state: BootstrapLineageState;
  readonly version: number;
  readonly createdAt: Timestamp;
  // Present only once the transition has been rolled back.
  readonly rolledBackAt?: Timestamp;
  readonly rollbackCorrelationId?: string;
};

// Write shape for the initial lineage create. `createdAt` is a server
// timestamp sentinel at the write boundary.
export type PlatformAdminBootstrapCreationWrite = {
  readonly targetUid: string;
  readonly previousRole: Role;
  readonly newRole: Role;
  readonly schoolId: string;
  readonly districtId: string;
  readonly correlationId: string;
  readonly reason: string;
  readonly state: "active";
  readonly version: number;
  readonly createdAt: FieldValue;
};

// Update shape applied by rollback: flips `state` to `rolledBack`, stamps the
// rollback time and correlation. No other field is touched, preserving the
// original lineage for evidence.
export type PlatformAdminBootstrapRollbackWrite = {
  readonly state: "rolledBack";
  readonly rolledBackAt: FieldValue;
  readonly rollbackCorrelationId: string;
};
