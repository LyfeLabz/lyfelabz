// Phase 8G.12 / 8G.12A - First Platform Administrator Bootstrap (pure core).
//
// This module contains the entire decision and orchestration logic for the
// operator-only first-platform-administrator bootstrap, expressed against an
// injected port surface (`BootstrapPorts`) so it is fully unit-testable
// without Firebase Auth, Firestore, or the emulator. The CLI entrypoint
// (`bootstrap-platform-administrator.ts`) is the only place that constructs
// the real firebase-admin-backed ports and parses operator arguments.
//
// It is a server-side operator tool. It is NEVER exported from the Cloud
// Functions bundle (`src/index.ts`) and is NEVER wrapped as a callable.
//
// Design invariants (see docs/platform/PLATFORM_ADMIN_BOOTSTRAP_RUNBOOK.md):
//   - No production identity (email, UID, project, school, district) is
//     compiled into this module. Every such value arrives as an explicit
//     operator option and is validated against live state.
//   - Default mode is DRY RUN. Mutation requires explicit acknowledgements.
//   - Fail closed on any missing prerequisite (Auth identity, canonical
//     user, canonical shape, school/district, wrong project, disabled
//     identity, mismatched UID/email/role/school, conflicting existing
//     administrator, unexpected privileged target, missing/mismatched
//     durable lineage). Never fabricate identity or user state.
//   - Ordering is canonical-first: the Firestore role transition, the durable
//     bootstrap lineage write, and the `users.roleChanged` audit commit
//     atomically in ONE transaction; only after that commits are custom
//     claims replaced (canonical shape, not merged) and refresh tokens
//     revoked. Never claims-first.
//   - Exactly one `users.roleChanged` audit event per canonical transition.
//     An Auth-repair replay against an already-transitioned record emits
//     NONE.
//   - 8G.12A: bootstrap ownership is proven by a durable singleton lineage
//     record, not inferred from `users/{uid}.role`. Repair replay, rollback
//     target/destination, and correlation all derive from that record. A
//     canonical administrator role with absent or conflicting lineage fails
//     closed rather than being adopted as if this tool created it.

import { PlatformError } from "../../shared/errors/platform-error";
import { normalizeEmail } from "../../shared/config/teacher-pilot-allowlist";
import {
  PLATFORM_ADMIN_BOOTSTRAP_VERSION,
  isCanonicalTimestamp,
} from "../../shared/types/platform-admin-bootstrap";
import type {
  BootstrapLineageState,
  PlatformAdminBootstrapRecord,
} from "../../shared/types/platform-admin-bootstrap";
import type { Role } from "../../shared/types/user";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Stable, non-PII actor id stamped on the `users.roleChanged` audit event.
// The actor role is the `system` sentinel; this is the operator/bootstrap
// actor identifier the audit vocabulary comment mandates. It is NOT a human
// UID and carries no PII.
export const BOOTSTRAP_ACTOR_ID = "system-bootstrap-platform-administrator";

// Explicit operator acknowledgements. These are generic opt-in tokens, not
// production values. Apply mode requires the production acknowledgement PLUS
// the operation-specific apply/rollback acknowledgement.
export const PRODUCTION_ACKNOWLEDGEMENT = "I_UNDERSTAND_THIS_MUTATES_PRODUCTION";
export const APPLY_ACKNOWLEDGEMENT = "I_UNDERSTAND_THIS_APPLIES_A_ROLE_CHANGE";
export const ROLLBACK_ACKNOWLEDGEMENT =
  "I_UNDERSTAND_THIS_ROLLS_BACK_A_ROLE_CHANGE";

// Low-cardinality audit `reason` categories. Never free text.
export const INITIAL_BOOTSTRAP_REASON = "initialBootstrap";
export const ROLLBACK_REASON = "rollback";

// Constrained operator change/correlation identifier. Bounded length, safe
// token character set only: no whitespace, control characters, newlines, or
// free-form prose, and nothing email-like.
export const CHANGE_TICKET_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

const PLATFORM_ADMINISTRATOR: Role = "platformAdministrator";
const VALID_ROLES: readonly Role[] = [
  "teacher",
  "student",
  "platformAdministrator",
];

// The exact source roles this bootstrap supports (Phase 8G.12B, Correction 5).
// A first administrator is promoted from a `teacher` only, and rollback may
// therefore only restore `teacher`. This is enforced at option validation (the
// fresh bootstrap source role and the rollback destination role) and at
// lineage validation (the recorded `previousRole`), so an unsupported role -
// even one present in malformed Firestore data - can never become the rollback
// destination, and `platformAdministrator` is never a valid source/destination.
const SUPPORTED_BOOTSTRAP_SOURCE_ROLES: readonly Role[] = ["teacher"];

function isSupportedBootstrapSourceRole(value: unknown): value is Role {
  return (
    typeof value === "string" &&
    (SUPPORTED_BOOTSTRAP_SOURCE_ROLES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Option, result, and port types
// ---------------------------------------------------------------------------

export type BootstrapMode = "dryRun" | "apply";
export type BootstrapOperation = "bootstrap" | "rollback";

export type BootstrapOptions = {
  // "bootstrap" promotes an eligible canonical user to platformAdministrator.
  // "rollback" is the paired, audited demotion back to the recorded prior
  // role; its target and destination role are taken from durable lineage.
  readonly operation: BootstrapOperation;
  // Default is "dryRun". "apply" requires the acknowledgements below.
  readonly mode: BootstrapMode;
  // The expected Firebase project id. Must equal the runtime-bound project or
  // the run fails closed (`bootstrap.projectMismatch`).
  readonly projectId: string;
  readonly targetUid: string;
  readonly targetEmail: string;
  // The role the operator asserts the canonical record CURRENTLY holds:
  //   - bootstrap: the source role (e.g. "teacher"); must NOT be
  //     platformAdministrator.
  //   - rollback: must be platformAdministrator.
  readonly expectedCurrentRole: Role;
  // For bootstrap: must be platformAdministrator. For rollback: the operator's
  // asserted destination role, which MUST equal the durable lineage
  // `previousRole` (the tool refuses an arbitrary destination); the effective
  // destination is always the lineage value.
  readonly targetRole: Role;
  // The school the operator acknowledges the target belongs to. Must match the
  // canonical `users/{uid}.schoolId` (bootstrap) or the lineage `schoolId`
  // (rollback) exactly.
  readonly expectedSchoolId: string;
  // Constrained change-ticket / correlation identifier. Stamped as the audit
  // `correlationId` and persisted on the lineage record.
  readonly changeTicket: string;
  // Required (and validated) only in apply mode.
  readonly productionAcknowledgement?: string;
  readonly applyAcknowledgement?: string;
  readonly rollbackAcknowledgement?: string;
};

export type BootstrapOutcome =
  // Dry run: every prerequisite validated, nothing mutated.
  | "dryRunOk"
  // Apply: fresh canonical role transition + lineage + audit committed, claims
  // replaced, refresh tokens revoked.
  | "applied"
  // Apply replay: canonical role was already transitioned (lineage proven);
  // claims were inconsistent and were repaired (no second audit). Refresh
  // tokens re-revoked idempotently.
  | "repairedAuth"
  // Apply replay: canonical role already transitioned (lineage proven) AND
  // claims already consistent. No audit, no claims write. Refresh tokens
  // re-revoked idempotently (fail-toward-revoked; state cannot be read back).
  | "alreadyComplete";

export type BootstrapResult = {
  readonly operation: BootstrapOperation;
  readonly mode: BootstrapMode;
  readonly outcome: BootstrapOutcome;
  readonly targetUid: string;
  readonly previousRole: Role;
  readonly newRole: Role;
  readonly schoolId: string;
  readonly districtId: string;
  readonly reason: string;
  readonly auditWritten: boolean;
  readonly lineageWritten: boolean;
  readonly claimsReplaced: boolean;
  readonly refreshTokensRevoked: boolean;
  readonly steps: readonly string[];
};

// A Firebase Auth identity projection. Only the fields the bootstrap needs;
// no token, no provider data, no PII beyond the email it is validating.
export type BootstrapAuthIdentity = {
  readonly uid: string;
  readonly email?: string;
  readonly disabled: boolean;
};

// Read view of a canonical `users/{uid}` document. Fields are `unknown` so
// the core validates shape rather than trusting the adapter.
export type BootstrapCanonicalUser = {
  readonly authUid?: unknown;
  readonly status?: unknown;
  readonly role?: unknown;
  readonly schoolId?: unknown;
  readonly displayName?: unknown;
  readonly email?: unknown;
  readonly createdAt?: unknown;
};

export type RoleChangedAuditInput = {
  readonly targetUid: string;
  readonly schoolId: string;
  readonly districtId: string;
  readonly previousRole: Role;
  readonly newRole: Role;
  readonly reason: string;
  readonly correlationId: string;
};

export type CreateBootstrapLineageInput = {
  readonly targetUid: string;
  readonly previousRole: Role;
  readonly newRole: Role;
  readonly schoolId: string;
  readonly districtId: string;
  readonly correlationId: string;
  readonly reason: string;
};

export type RollbackBootstrapLineageInput = {
  readonly rollbackCorrelationId: string;
};

// The transaction-scoped port. All authoritative reads and the paired
// role-update + lineage write + audit write happen through this, so the role
// change, its durable lineage, and its audit event are one atomic Firestore
// transaction.
export type BootstrapTransaction = {
  getUser(uid: string): Promise<BootstrapCanonicalUser | null>;
  getSchoolDistrictId(schoolId: string): Promise<string | null>;
  // The durable singleton lineage record, read transactionally. Reading it in
  // every path also provides the serialization point: two concurrent fresh
  // bootstraps contend on this document and Firestore admits exactly one.
  getBootstrapRecord(): Promise<PlatformAdminBootstrapRecord | null>;
  // UIDs of every user with role === platformAdministrator AND
  // status === active, read transactionally.
  getActiveAdministratorUids(): Promise<readonly string[]>;
  setUserRole(uid: string, role: Role): void;
  // Creates the singleton lineage record; MUST fail if it already exists
  // (the real adapter uses tx.create).
  createBootstrapRecord(input: CreateBootstrapLineageInput): void;
  updateBootstrapRecordToRolledBack(input: RollbackBootstrapLineageInput): void;
  writeRoleChangedAudit(input: RoleChangedAuditInput): void;
};

export type BootstrapClaimsView = {
  readonly role?: string;
  readonly schoolId?: string;
  readonly districtId?: string;
};

export type BootstrapPorts = {
  getConfiguredProjectId(): string | undefined;
  getAuthUserByUid(uid: string): Promise<BootstrapAuthIdentity | null>;
  getAuthUserByEmail(email: string): Promise<BootstrapAuthIdentity | null>;
  readCurrentClaims(uid: string): Promise<BootstrapClaimsView>;
  runTransaction<T>(fn: (tx: BootstrapTransaction) => Promise<T>): Promise<T>;
  // Replaces (never merges) custom claims with the canonical
  // { role, schoolId, districtId } shape. Backed by the shared
  // `writeCustomClaims` helper in the real adapter.
  replaceCustomClaims(input: {
    readonly uid: string;
    readonly role: Role;
    readonly schoolId: string;
    readonly districtId: string;
  }): Promise<void>;
  revokeRefreshTokens(uid: string): Promise<void>;
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidRole(value: unknown): value is Role {
  return (
    typeof value === "string" &&
    (VALID_ROLES as readonly string[]).includes(value)
  );
}

function fail(code: string, message: string): never {
  throw new PlatformError(code, message);
}

// Validate option shape and the operation/role/acknowledgement/change-ticket
// contract. Throws before any I/O so a malformed invocation never touches
// production.
function validateOptions(options: BootstrapOptions): {
  readonly reason: string;
} {
  if (options.operation !== "bootstrap" && options.operation !== "rollback") {
    fail("bootstrap.invalidOptions", "operation must be bootstrap or rollback.");
  }
  if (options.mode !== "dryRun" && options.mode !== "apply") {
    fail("bootstrap.invalidOptions", "mode must be dryRun or apply.");
  }
  for (const [name, value] of [
    ["projectId", options.projectId],
    ["targetUid", options.targetUid],
    ["targetEmail", options.targetEmail],
    ["expectedSchoolId", options.expectedSchoolId],
    ["changeTicket", options.changeTicket],
  ] as const) {
    if (!isNonEmptyString(value)) {
      fail("bootstrap.invalidOptions", `${name} must be a non-empty string.`);
    }
  }
  // Constrained change/correlation identifier (Correction 8): bounded length,
  // safe token characters only, no whitespace/control/newline/free-form text.
  if (!CHANGE_TICKET_PATTERN.test(options.changeTicket)) {
    fail(
      "bootstrap.invalidChangeTicket",
      "changeTicket must match [A-Za-z0-9._:-] and be 1-64 characters.",
    );
  }
  if (!isValidRole(options.expectedCurrentRole)) {
    fail("bootstrap.invalidOptions", "expectedCurrentRole must be a valid role.");
  }
  if (!isValidRole(options.targetRole)) {
    fail("bootstrap.invalidOptions", "targetRole must be a valid role.");
  }
  if (options.expectedCurrentRole === options.targetRole) {
    fail(
      "bootstrap.invalidOptions",
      "expectedCurrentRole and targetRole must differ.",
    );
  }
  const normalizedTargetEmail = normalizeEmail(options.targetEmail);
  if (!normalizedTargetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedTargetEmail)) {
    fail("bootstrap.invalidOptions", "targetEmail must be a valid email.");
  }

  let reason: string;
  if (options.operation === "bootstrap") {
    if (options.targetRole !== PLATFORM_ADMINISTRATOR) {
      fail(
        "bootstrap.invalidOptions",
        "bootstrap targetRole must be platformAdministrator.",
      );
    }
    // Source role must be one this bootstrap actually supports (teacher only),
    // never platformAdministrator and never an unsupported role.
    if (!isSupportedBootstrapSourceRole(options.expectedCurrentRole)) {
      fail(
        "bootstrap.invalidOptions",
        `bootstrap expectedCurrentRole must be a supported source role (${SUPPORTED_BOOTSTRAP_SOURCE_ROLES.join(", ")}).`,
      );
    }
    reason = INITIAL_BOOTSTRAP_REASON;
  } else {
    if (options.expectedCurrentRole !== PLATFORM_ADMINISTRATOR) {
      fail(
        "bootstrap.invalidOptions",
        "rollback expectedCurrentRole must be platformAdministrator.",
      );
    }
    // The acknowledged destination role (a cross-check only; the effective
    // destination comes from the lineage) must be a supported source role.
    if (!isSupportedBootstrapSourceRole(options.targetRole)) {
      fail(
        "bootstrap.invalidOptions",
        `rollback targetRole must be a supported source role (${SUPPORTED_BOOTSTRAP_SOURCE_ROLES.join(", ")}).`,
      );
    }
    reason = ROLLBACK_REASON;
  }

  if (options.mode === "apply") {
    if (options.productionAcknowledgement !== PRODUCTION_ACKNOWLEDGEMENT) {
      fail(
        "bootstrap.acknowledgementMissing",
        "apply mode requires the exact production acknowledgement.",
      );
    }
    if (options.operation === "bootstrap") {
      if (options.applyAcknowledgement !== APPLY_ACKNOWLEDGEMENT) {
        fail(
          "bootstrap.acknowledgementMissing",
          "bootstrap apply requires the exact apply acknowledgement.",
        );
      }
    } else if (options.rollbackAcknowledgement !== ROLLBACK_ACKNOWLEDGEMENT) {
      fail(
        "bootstrap.acknowledgementMissing",
        "rollback apply requires the exact rollback acknowledgement.",
      );
    }
  }

  return { reason };
}

// Validate the canonical `users/{uid}` record shape for a legitimate active
// user of the expected role. Beyond the authorization fields, the current
// data model requires `authUid`, `status`, `createdAt`, `role`, `schoolId`,
// `displayName`, and (for a real signed-in identity) `email`. The canonical
// email is cross-checked against the acknowledged Auth identity email. Throws
// `bootstrap.malformedCanonicalUser` / `bootstrap.schoolMismatch` /
// `bootstrap.authEmailMismatch` on any deviation.
function validateCanonicalUserShape(
  user: BootstrapCanonicalUser,
  expected: {
    readonly uid: string;
    readonly role: Role;
    readonly schoolId: string;
    readonly authEmail: string;
  },
): { readonly role: Role; readonly schoolId: string } {
  if (user.authUid !== expected.uid) {
    fail(
      "bootstrap.malformedCanonicalUser",
      "Canonical user authUid does not match the target UID.",
    );
  }
  if (user.status !== "active") {
    fail(
      "bootstrap.malformedCanonicalUser",
      `Canonical user status must be "active" (current: "${String(user.status)}").`,
    );
  }
  if (!isValidRole(user.role)) {
    fail("bootstrap.malformedCanonicalUser", "Canonical user has no valid role.");
  }
  // createdAt must be the canonical Firestore timestamp representation, not a
  // string, number, or arbitrary object (Correction 8). No coercion.
  if (!isCanonicalTimestamp(user.createdAt)) {
    fail(
      "bootstrap.malformedCanonicalUser",
      "Canonical user createdAt is not a valid timestamp.",
    );
  }
  if (!isNonEmptyString(user.displayName)) {
    fail(
      "bootstrap.malformedCanonicalUser",
      "Canonical user has no displayName.",
    );
  }
  if (!isNonEmptyString(user.schoolId)) {
    fail(
      "bootstrap.malformedCanonicalUser",
      "Canonical user has no schoolId recorded.",
    );
  }
  if (user.schoolId !== expected.schoolId) {
    fail(
      "bootstrap.schoolMismatch",
      "Canonical schoolId does not match the acknowledged school.",
    );
  }
  // Canonical email must be present and well-formed. Surrounding whitespace is
  // treated as MALFORMED canonical state (fail closed) rather than silently
  // normalized into acceptance (Correction 9); only case differences are
  // tolerated, via lowercase comparison against the acknowledged Auth identity
  // email (which is itself trimmed+lowercased by normalizeEmail).
  const rawEmail = user.email;
  if (typeof rawEmail !== "string" || rawEmail.length === 0) {
    fail(
      "bootstrap.malformedCanonicalUser",
      "Canonical user has no email recorded.",
    );
  }
  if (rawEmail !== rawEmail.trim()) {
    fail(
      "bootstrap.malformedCanonicalUser",
      "Canonical user email has surrounding whitespace (malformed).",
    );
  }
  if (rawEmail.toLowerCase() !== expected.authEmail) {
    fail(
      "bootstrap.authEmailMismatch",
      "Canonical user email does not match the acknowledged Auth identity email.",
    );
  }
  return { role: user.role, schoolId: user.schoolId };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

type TransitionPlan = {
  readonly freshTransition: boolean;
  readonly claimsConsistent: boolean;
  readonly toRole: Role;
  readonly previousRole: Role;
  readonly schoolId: string;
  readonly districtId: string;
};

// Closed lineage-state vocabulary. Any value outside this set is unknown /
// future / malformed and fails closed - "anything except rolledBack" is NEVER
// treated as active.
const LINEAGE_STATES: readonly BootstrapLineageState[] = ["active", "rolledBack"];

// The single authoritative structural + semantic validator for the durable
// lineage record (Phase 8G.12B, Correction 4/5/7). Fails closed on unknown,
// malformed, future, or incompatible lineage. Used by BOTH the bootstrap
// replay path and rollback, so they cannot diverge. It validates:
//   - version == supported version (else unsupported);
//   - reason == initialBootstrap;
//   - newRole == platformAdministrator;
//   - previousRole is a supported non-admin source role (allowlist);
//   - targetUid / schoolId / districtId are non-empty strings;
//   - correlationId is a valid change ticket;
//   - state is a known state (closed vocabulary);
//   - createdAt is a canonical timestamp;
//   - when state == rolledBack: rolledBackAt is a canonical timestamp AND
//     rollbackCorrelationId is a valid change ticket.
function assertLineageStructurallyValid(
  record: PlatformAdminBootstrapRecord,
): void {
  if (record.version !== PLATFORM_ADMIN_BOOTSTRAP_VERSION) {
    fail(
      "bootstrap.lineageVersionUnsupported",
      `Lineage version "${String(record.version)}" is not supported (expected ${PLATFORM_ADMIN_BOOTSTRAP_VERSION}).`,
    );
  }
  if (record.reason !== INITIAL_BOOTSTRAP_REASON) {
    fail("bootstrap.lineageConflict", "Lineage reason is not initialBootstrap.");
  }
  if (record.newRole !== PLATFORM_ADMINISTRATOR) {
    fail("bootstrap.lineageConflict", "Lineage newRole is not platformAdministrator.");
  }
  if (!isSupportedBootstrapSourceRole(record.previousRole)) {
    fail(
      "bootstrap.lineageConflict",
      `Lineage previousRole "${String(record.previousRole)}" is not a supported source role.`,
    );
  }
  if (!isNonEmptyString(record.targetUid)) {
    fail("bootstrap.lineageConflict", "Lineage targetUid is malformed.");
  }
  if (!isNonEmptyString(record.schoolId)) {
    fail("bootstrap.lineageConflict", "Lineage schoolId is malformed.");
  }
  if (!isNonEmptyString(record.districtId)) {
    fail("bootstrap.lineageConflict", "Lineage districtId is malformed.");
  }
  if (
    typeof record.correlationId !== "string" ||
    !CHANGE_TICKET_PATTERN.test(record.correlationId)
  ) {
    fail("bootstrap.lineageConflict", "Lineage correlationId is malformed.");
  }
  if (!(LINEAGE_STATES as readonly string[]).includes(record.state)) {
    fail(
      "bootstrap.lineageConflict",
      `Lineage state "${String(record.state)}" is not a known state.`,
    );
  }
  if (!isCanonicalTimestamp(record.createdAt)) {
    fail("bootstrap.lineageConflict", "Lineage createdAt is not a valid timestamp.");
  }
  if (record.state === "rolledBack") {
    if (!isCanonicalTimestamp(record.rolledBackAt)) {
      fail(
        "bootstrap.lineageConflict",
        "Rolled-back lineage has no valid rolledBackAt timestamp.",
      );
    }
    if (
      typeof record.rollbackCorrelationId !== "string" ||
      !CHANGE_TICKET_PATTERN.test(record.rollbackCorrelationId)
    ) {
      fail(
        "bootstrap.lineageConflict",
        "Rolled-back lineage has a malformed rollbackCorrelationId.",
      );
    }
  }
}

// Cross-check that a structurally-valid lineage matches THIS initial bootstrap
// (same target, source role, tenant, correlation, and required state). Assumes
// `assertLineageStructurallyValid` has already passed.
function lineageMatchesInitialBootstrap(
  record: PlatformAdminBootstrapRecord,
  expected: {
    readonly targetUid: string;
    readonly previousRole: Role;
    readonly schoolId: string;
    readonly districtId: string;
    readonly correlationId: string;
    readonly requiredState: BootstrapLineageState;
  },
): boolean {
  return (
    record.targetUid === expected.targetUid &&
    record.previousRole === expected.previousRole &&
    record.newRole === PLATFORM_ADMINISTRATOR &&
    record.schoolId === expected.schoolId &&
    record.districtId === expected.districtId &&
    record.reason === INITIAL_BOOTSTRAP_REASON &&
    record.correlationId === expected.correlationId &&
    record.version === PLATFORM_ADMIN_BOOTSTRAP_VERSION &&
    record.state === expected.requiredState
  );
}

export async function runBootstrap(
  options: BootstrapOptions,
  ports: BootstrapPorts,
): Promise<BootstrapResult> {
  const { reason } = validateOptions(options);
  const steps: string[] = [];

  // 1. Project guard. The real adapter binds Firebase Admin explicitly to the
  //    acknowledged project and returns that bound project here, so this is a
  //    genuine check that the effective client targets the acknowledged
  //    project - not a comparison of ambient environment strings.
  const configuredProject = ports.getConfiguredProjectId();
  if (!isNonEmptyString(configuredProject)) {
    fail(
      "bootstrap.projectMismatch",
      "The runtime does not expose a bound project id.",
    );
  }
  if (configuredProject !== options.projectId) {
    fail(
      "bootstrap.projectMismatch",
      `Bound project "${configuredProject}" does not match the acknowledged project "${options.projectId}".`,
    );
  }
  steps.push(`project verified: ${configuredProject}`);

  // 2. Auth identity prerequisites. FAIL CLOSED if the identity is absent;
  //    never create it here.
  const byUid = await ports.getAuthUserByUid(options.targetUid);
  if (!byUid) {
    fail(
      "bootstrap.missingAuthIdentity",
      "No Firebase Auth identity exists for the target UID.",
    );
  }
  if (byUid.uid !== options.targetUid) {
    fail("bootstrap.authUidMismatch", "Auth identity UID does not match.");
  }
  if (byUid.disabled) {
    fail(
      "bootstrap.authIdentityDisabled",
      "The target Firebase Auth identity is disabled.",
    );
  }
  const expectedEmail = normalizeEmail(options.targetEmail);
  const authEmail = normalizeEmail(
    typeof byUid.email === "string" ? byUid.email : "",
  );
  if (!authEmail || authEmail !== expectedEmail) {
    fail(
      "bootstrap.authEmailMismatch",
      "Auth identity email does not match the acknowledged target email.",
    );
  }
  const byEmail = await ports.getAuthUserByEmail(options.targetEmail);
  if (!byEmail) {
    fail(
      "bootstrap.missingAuthIdentity",
      "No Firebase Auth identity resolves for the target email.",
    );
  }
  if (byEmail.uid !== options.targetUid) {
    fail(
      "bootstrap.authUidMismatch",
      "The target email resolves to a different Firebase Auth UID.",
    );
  }
  steps.push("auth identity verified (uid, email, enabled)");

  // 3. Read current claims for split-brain / privileged-target detection.
  const currentClaims = await ports.readCurrentClaims(options.targetUid);

  // 4. Authoritative canonical read + decision, all inside one transaction so
  //    the role update, the durable lineage write, and the audit event are
  //    atomic and cannot race a concurrent administrator creation.
  const plan = await ports.runTransaction<TransitionPlan>(async (tx) => {
    const lineage = await tx.getBootstrapRecord();

    if (options.operation === "bootstrap") {
      return planBootstrap(tx, options, currentClaims, authEmail, lineage);
    }
    return planRollback(tx, options, currentClaims, lineage);
  });

  const schoolId = plan.schoolId;
  const districtId = plan.districtId;
  const toRole = plan.toRole;

  // 5. Dry run stops here: no Auth-side mutation.
  if (options.mode === "dryRun") {
    steps.push(
      plan.freshTransition
        ? "dry run: would transition canonical role, write lineage + audit, replace claims, revoke tokens"
        : "dry run: canonical role already transitioned (lineage proven); would repair claims/tokens",
    );
    return {
      operation: options.operation,
      mode: options.mode,
      outcome: "dryRunOk",
      targetUid: options.targetUid,
      previousRole: plan.previousRole,
      newRole: toRole,
      schoolId,
      districtId,
      reason,
      auditWritten: false,
      lineageWritten: false,
      claimsReplaced: false,
      refreshTokensRevoked: false,
      steps,
    };
  }

  // 6. Auth-side steps, AFTER the durable Firestore transaction. Order:
  //    claims replacement, then refresh-token revocation. Both are idempotent
  //    and safe to re-run on a repair replay.
  if (plan.freshTransition) {
    steps.push("canonical role transition + lineage + audit committed");
  }

  let claimsReplaced = false;
  if (plan.freshTransition || !plan.claimsConsistent) {
    await ports.replaceCustomClaims({
      uid: options.targetUid,
      role: toRole,
      schoolId,
      districtId,
    });
    claimsReplaced = true;
    steps.push("custom claims replaced with canonical shape");
  } else {
    steps.push("custom claims already consistent; no replacement needed");
  }

  await ports.revokeRefreshTokens(options.targetUid);
  steps.push("refresh tokens revoked");

  const outcome: BootstrapOutcome = plan.freshTransition
    ? "applied"
    : plan.claimsConsistent
      ? "alreadyComplete"
      : "repairedAuth";

  return {
    operation: options.operation,
    mode: options.mode,
    outcome,
    targetUid: options.targetUid,
    previousRole: plan.previousRole,
    newRole: toRole,
    schoolId,
    districtId,
    reason,
    auditWritten: plan.freshTransition,
    lineageWritten: plan.freshTransition,
    claimsReplaced,
    refreshTokensRevoked: true,
    steps,
  };
}

async function planBootstrap(
  tx: BootstrapTransaction,
  options: BootstrapOptions,
  currentClaims: BootstrapClaimsView,
  authEmail: string,
  lineage: PlatformAdminBootstrapRecord | null,
): Promise<TransitionPlan> {
  const fromRole = options.expectedCurrentRole;
  const toRole = options.targetRole; // platformAdministrator

  const user = await tx.getUser(options.targetUid);
  if (!user) {
    fail(
      "bootstrap.missingCanonicalUser",
      "No canonical users/{uid} record exists for the target.",
    );
  }
  const canonicalRole: Role = isValidRole(user.role) ? user.role : fromRole;

  // Full canonical shape validation (Correction 9). For the fresh-bootstrap
  // path the source-role record must be a complete active user; validate the
  // shape against the expected source role and school.
  if (canonicalRole === toRole) {
    // Replay path: the record is now an administrator. Validate the shape
    // against the administrator role and the acknowledged school.
    const shape = validateCanonicalUserShape(user, {
      uid: options.targetUid,
      role: toRole,
      schoolId: options.expectedSchoolId,
      authEmail,
    });
    const districtId = await tx.getSchoolDistrictId(shape.schoolId);
    if (!isNonEmptyString(districtId)) {
      fail(
        "bootstrap.districtUnresolved",
        "The target school does not resolve to a canonical district.",
      );
    }

    // Lineage is REQUIRED, must be structurally valid, and must match this
    // exact initial bootstrap. A canonical administrator with absent /
    // malformed / conflicting lineage is refused; never adopt manually created
    // administrator state.
    if (!lineage) {
      fail(
        "bootstrap.lineageMissing",
        "Target is already an administrator but no durable bootstrap lineage exists; refusing.",
      );
    }
    assertLineageStructurallyValid(lineage);
    if (
      !lineageMatchesInitialBootstrap(lineage, {
        targetUid: options.targetUid,
        previousRole: fromRole,
        schoolId: shape.schoolId,
        districtId,
        correlationId: options.changeTicket,
        requiredState: "active",
      })
    ) {
      fail(
        "bootstrap.lineageConflict",
        "Durable bootstrap lineage does not match this initial bootstrap; refusing.",
      );
    }

    // The sole active administrator permitted at replay is the target itself.
    const adminUids = await tx.getActiveAdministratorUids();
    const others = adminUids.filter((u) => u !== options.targetUid);
    if (others.length > 0) {
      fail(
        "bootstrap.administratorConflict",
        "Another active platformAdministrator exists; refusing.",
      );
    }

    const claimsConsistent =
      currentClaims.role === toRole &&
      currentClaims.schoolId === shape.schoolId &&
      currentClaims.districtId === districtId;

    return {
      freshTransition: false,
      claimsConsistent,
      toRole,
      previousRole: fromRole,
      schoolId: shape.schoolId,
      districtId,
    };
  }

  // Fresh transition path: the canonical role must equal the acknowledged
  // source role. Anything else is drift / wrong expected role.
  if (canonicalRole !== fromRole) {
    fail(
      "bootstrap.roleMismatch",
      `Canonical role "${canonicalRole}" is neither the acknowledged source "${fromRole}" nor the target "${toRole}".`,
    );
  }

  const shape = validateCanonicalUserShape(user, {
    uid: options.targetUid,
    role: fromRole,
    schoolId: options.expectedSchoolId,
    authEmail,
  });
  const districtId = await tx.getSchoolDistrictId(shape.schoolId);
  if (!isNonEmptyString(districtId)) {
    fail(
      "bootstrap.districtUnresolved",
      "The target school does not resolve to a canonical district.",
    );
  }

  // A fresh bootstrap requires the durable lineage to be ABSENT. A lineage
  // present while the target is not an administrator is drift/conflict.
  if (lineage) {
    fail(
      "bootstrap.lineageConflict",
      "A durable bootstrap lineage already exists; initialBootstrap refuses.",
    );
  }

  // Unexpected privileged target: the canonical role is the source role yet
  // the identity already carries an administrator claim (split-brain).
  if (currentClaims.role === PLATFORM_ADMINISTRATOR) {
    fail(
      "bootstrap.unexpectedPrivilegedTarget",
      "Target carries an administrator claim without the canonical administrator role.",
    );
  }

  // Zero-existing-administrator precondition for the first-admin bootstrap.
  const adminUids = await tx.getActiveAdministratorUids();
  if (adminUids.length > 0) {
    fail(
      "bootstrap.administratorExists",
      "An active platformAdministrator already exists; initialBootstrap refuses.",
    );
  }

  if (options.mode === "apply") {
    // Canonical-first, atomic: role update + durable lineage create + exactly
    // one audit event. `createBootstrapRecord` fails if the singleton already
    // exists, which - together with the transactional read of the lineage
    // above - serializes concurrent first-admin attempts to exactly one.
    tx.setUserRole(options.targetUid, toRole);
    tx.createBootstrapRecord({
      targetUid: options.targetUid,
      previousRole: fromRole,
      newRole: toRole,
      schoolId: shape.schoolId,
      districtId,
      correlationId: options.changeTicket,
      reason: INITIAL_BOOTSTRAP_REASON,
    });
    tx.writeRoleChangedAudit({
      targetUid: options.targetUid,
      schoolId: shape.schoolId,
      districtId,
      previousRole: fromRole,
      newRole: toRole,
      reason: INITIAL_BOOTSTRAP_REASON,
      correlationId: options.changeTicket,
    });
  }

  return {
    freshTransition: true,
    claimsConsistent: false,
    toRole,
    previousRole: fromRole,
    schoolId: shape.schoolId,
    districtId,
  };
}

async function planRollback(
  tx: BootstrapTransaction,
  options: BootstrapOptions,
  currentClaims: BootstrapClaimsView,
  lineage: PlatformAdminBootstrapRecord | null,
): Promise<TransitionPlan> {
  // Rollback derives its authoritative target and destination role from the
  // durable lineage, never from an arbitrary operator argument. The lineage
  // must first be structurally and semantically valid (closed state
  // vocabulary, supported previousRole, valid timestamps/correlation, supported
  // version) or rollback refuses.
  if (!lineage) {
    fail(
      "bootstrap.lineageMissing",
      "No durable bootstrap lineage exists to roll back.",
    );
  }
  assertLineageStructurallyValid(lineage);

  // Guaranteed by the validator to be a supported non-admin source role.
  const destinationRole = lineage.previousRole;

  // Operator cross-checks (defense in depth): the acknowledged target/school
  // must match the lineage, and the operator's asserted destination role
  // (targetRole) must equal the lineage previousRole. An arbitrary destination
  // is impossible.
  if (options.targetUid !== lineage.targetUid) {
    fail(
      "bootstrap.rollbackTargetMismatch",
      "Acknowledged target UID does not match the lineage target.",
    );
  }
  if (options.expectedSchoolId !== lineage.schoolId) {
    fail(
      "bootstrap.rollbackTargetMismatch",
      "Acknowledged school does not match the lineage school.",
    );
  }
  if (options.targetRole !== destinationRole) {
    fail(
      "bootstrap.rollbackDestinationMismatch",
      "Acknowledged destination role does not match the lineage previousRole.",
    );
  }

  const user = await tx.getUser(lineage.targetUid);
  if (!user) {
    fail(
      "bootstrap.missingCanonicalUser",
      "No canonical users/{uid} record exists for the rollback target.",
    );
  }
  if (user.authUid !== lineage.targetUid) {
    fail(
      "bootstrap.malformedCanonicalUser",
      "Canonical user authUid does not match the lineage target UID.",
    );
  }
  if (user.status !== "active") {
    fail(
      "bootstrap.malformedCanonicalUser",
      `Canonical user status must be "active" (current: "${String(user.status)}").`,
    );
  }
  if (user.schoolId !== lineage.schoolId) {
    fail(
      "bootstrap.rollbackDrift",
      "Canonical schoolId has drifted from the lineage school.",
    );
  }
  const districtId = await tx.getSchoolDistrictId(lineage.schoolId);
  if (!isNonEmptyString(districtId) || districtId !== lineage.districtId) {
    fail(
      "bootstrap.rollbackDrift",
      "Canonical district has drifted from the lineage district.",
    );
  }

  const claimsConsistent =
    currentClaims.role === destinationRole &&
    currentClaims.schoolId === lineage.schoolId &&
    currentClaims.districtId === lineage.districtId;

  if (lineage.state === "rolledBack") {
    // Rollback replay: the canonical role must already be the destination.
    if (user.role !== destinationRole) {
      fail(
        "bootstrap.rollbackDrift",
        "Lineage is rolled back but the canonical role does not match the restored role.",
      );
    }
    // Bind repair to the stored rollback correlation (Correction 6): the
    // operator MUST supply the exact rollbackCorrelationId recorded at the
    // original rollback. A different ticket refuses BEFORE any Auth mutation
    // and emits no audit. (The stored value's format was validated above.)
    if (options.changeTicket !== lineage.rollbackCorrelationId) {
      fail(
        "bootstrap.rollbackCorrelationMismatch",
        "Rollback repair requires the exact rollbackCorrelationId of the original rollback.",
      );
    }
    return {
      freshTransition: false,
      claimsConsistent,
      toRole: destinationRole,
      previousRole: PLATFORM_ADMINISTRATOR,
      schoolId: lineage.schoolId,
      districtId: lineage.districtId,
    };
  }

  // Fresh rollback: lineage.state === "active"; the canonical role must still
  // be administrator (no unexpected drift).
  if (user.role !== PLATFORM_ADMINISTRATOR) {
    fail(
      "bootstrap.rollbackDrift",
      `Rollback requires the target to currently be platformAdministrator (current: "${String(user.role)}").`,
    );
  }

  if (options.mode === "apply") {
    tx.setUserRole(lineage.targetUid, destinationRole);
    tx.updateBootstrapRecordToRolledBack({
      rollbackCorrelationId: options.changeTicket,
    });
    tx.writeRoleChangedAudit({
      targetUid: lineage.targetUid,
      schoolId: lineage.schoolId,
      districtId: lineage.districtId,
      previousRole: PLATFORM_ADMINISTRATOR,
      newRole: destinationRole,
      reason: ROLLBACK_REASON,
      correlationId: options.changeTicket,
    });
  }

  return {
    freshTransition: true,
    claimsConsistent: false,
    toRole: destinationRole,
    previousRole: PLATFORM_ADMINISTRATOR,
    schoolId: lineage.schoolId,
    districtId: lineage.districtId,
  };
}
