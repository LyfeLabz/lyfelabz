import { PlatformError } from "../shared/errors/platform-error";
import type { SessionDeliveryFreeze } from "../shared/types/assessment-session";
import type { ReadingLevel } from "../shared/types/student-accommodation";
import type { ReadingResolution } from "../shared/presentation/resolve-launch-presentation";

// F5.2 §8 (C1, C5, P1/P2) - the PURE begin-time delivery-freeze decision core,
// Persistent Student Differentiation Slice 6.
//
// This module owns the single authoritative decision of what `deliveryOutcome`
// (and, iff differentiated, what `(variantKey, presentationRevisionId)` pair) a
// NEW assessment session freezes at begin. Like the Slice 4 resolver it is a
// pure orchestrator: every side effect (reading the launch grant, the
// accommodation record, the operational flag, the current-presentation index,
// emitting telemetry, reading the clock) is an INJECTED PORT, so the whole
// decision table is unit-testable with fakes and imports no firebase-admin,
// crypto, or config module. The real ports live in `./begin-delivery-deps`.
//
// TWO ENTRY CONDITIONS (§8.2):
//   1. A `launchRef` is supplied  -> validate the server-issued grant and
//      freeze exactly what it recorded at issuance. The grant is IMMUTABLE
//      issuance evidence: a grant that validly bound revision A freezes A even
//      if the index has since moved to B or the accommodation was later
//      deactivated (the A->B invariant). The grant confers NO authorization -
//      begin's full existing auth chain already ran before this module.
//   2. No `launchRef`  -> the P1 covered-no-ref legitimacy check. The server
//      decides whether beginning without a grant is legitimate. It NEVER
//      selects or freezes a presentation revision; when differentiated coverage
//      is currently available it REFUSES with `BEGIN_REQUIRES_LAUNCH` so the
//      client must return through fresh launch resolution, closing the
//      downgrade hole.
//
// FAIL-CLOSED DIRECTION (§8.3). At this durable freeze point the safe direction
// is REFUSAL, not a silent canonical/canonicalFallback write: any transient
// read failure or an unresolvable malformed coverage index yields a retriable
// `BEGIN_VALIDATION_UNAVAILABLE` and NO session, so a misleading durable record
// is never the failure mode of an outage. This is the opposite of the Slice 4
// resolver, whose safe direction is canonical delivery.
//
// SECURITY: the client can never assert `deliveryOutcome`, `variantKey`, or
// `presentationRevisionId` (rejected as forbidden request keys at the callable
// boundary). The differentiated pair originates ONLY from a validated grant;
// the no-ref fallback carries no pair. The opaque `launchRef` token is NEVER
// logged (telemetry carries only operational identifiers + a reason).

// Stable begin-time refusal codes (§8.2/§8.3). These are the exact F5.2
// identifiers surfaced to the client via `HttpsError.details.code`; their
// retriable/non-retriable https mapping lives in `shared/errors/https-callable`.
export const BEGIN_REQUIRES_LAUNCH = "BEGIN_REQUIRES_LAUNCH";
export const BEGIN_VALIDATION_UNAVAILABLE = "BEGIN_VALIDATION_UNAVAILABLE";
export const LAUNCH_REF_INVALID = "LAUNCH_REF_INVALID";
export const LAUNCH_REF_EXPIRED = "LAUNCH_REF_EXPIRED";

// Begin-time coverage classification for the no-ref legitimacy check. It
// answers ONLY "is differentiated coverage currently available such that this
// client must return through launch resolution?" - never "which revision should
// this session freeze?" It is therefore structurally incapable of carrying a
// presentation pair (unlike the Slice 4 resolver's `VariantIndexEvaluation`,
// whose `active` branch carries the pair for grant minting). This enforces the
// §8.2 "must not select or freeze a presentation revision" invariant by
// construction.
export type BeginCoverageKind = "absent" | "retired" | "malformed" | "active";

// Permissive read view of a `launchGrants/{grantId}` record. Read defensively
// (every field `unknown`) so a malformed grant record is caught by validation
// here rather than trusted through the discriminated read type.
export type RawLaunchGrant = {
  readonly studentId?: unknown;
  readonly assignmentId?: unknown;
  readonly lessonSlug?: unknown;
  readonly outcomeAtIssuance?: unknown;
  readonly variantKey?: unknown;
  readonly presentationRevisionId?: unknown;
  readonly expiresAt?: unknown;
};

// Non-sensitive begin telemetry (§ telemetry, §11). Carries only operational
// identifiers and a reason - NEVER the raw `launchRef` token, IEP/504 text, a
// diagnosis, or plan data. `variantKey` (e.g. "reading-adapted") is
// presentation identity, not plan data, so it is safe for coverage debugging.
export type BeginDeliveryTelemetryEvent =
  | {
      readonly type: "grantInvalid";
      readonly studentId: string;
      readonly assignmentId: string;
      readonly lessonSlug: string;
      readonly reason:
        | "malformedId"
        | "notFound"
        | "binding"
        | "malformedRecord"
        | "malformedPair"
        | "invalidOutcome"
        | "malformedExpiry";
    }
  | {
      readonly type: "grantExpired";
      readonly studentId: string;
      readonly assignmentId: string;
      readonly lessonSlug: string;
    }
  | {
      readonly type: "differentiatedBound";
      readonly studentId: string;
      readonly assignmentId: string;
      readonly lessonSlug: string;
      readonly variantKey: string;
      readonly presentationRevisionId: string;
    }
  | {
      readonly type: "canonicalFallbackBound";
      readonly studentId: string;
      readonly assignmentId: string;
      readonly lessonSlug: string;
    }
  | {
      readonly type: "noRefFallback";
      readonly studentId: string;
      readonly assignmentId: string;
      readonly lessonSlug: string;
      readonly variantKey: string;
      readonly reason: "operationalDisable" | "coverageAbsent" | "coverageRetired";
    }
  | {
      readonly type: "beginRequiresLaunch";
      readonly studentId: string;
      readonly assignmentId: string;
      readonly lessonSlug: string;
      readonly variantKey: string;
    }
  | {
      readonly type: "beginValidationUnavailable";
      readonly studentId: string;
      readonly assignmentId: string;
      readonly lessonSlug: string;
      readonly reason: "coverageMalformed" | "internalFailure";
    };

export type BeginDeliveryPorts = {
  // Read the launch grant by its opaque id, or `undefined` if no such doc.
  readonly readGrant: (grantId: string) => Promise<RawLaunchGrant | undefined>;
  // Trusted accommodation resolution for the authenticated student.
  readonly readAccommodation: (studentId: string) => Promise<ReadingResolution>;
  // Server-owned operational differentiated-delivery flag (§8.6), fail-closed.
  readonly isDeliveryEnabled: () => Promise<boolean>;
  // Begin-time coverage classification for (lessonSlug, variantKey). Returns a
  // KIND only; never a revision (§8.2 A->B invariant).
  readonly readCoverage: (
    lessonSlug: string,
    variantKey: string,
  ) => Promise<BeginCoverageKind>;
  // Derive the logical variant key from a reading level.
  readonly variantKeyForReadingLevel: (level: ReadingLevel) => string;
  // Opaque grant-id format validator (32 lowercase hex).
  readonly isValidGrantId: (value: unknown) => boolean;
  // Best-effort, non-sensitive telemetry.
  readonly telemetry: (event: BeginDeliveryTelemetryEvent) => void;
  // Injectable clock (epoch ms) so expiry is deterministic in tests.
  readonly nowMs: () => number;
};

export type ResolveBeginDeliveryInput = {
  readonly studentId: string;
  readonly assignmentId: string;
  // The assignment-FROZEN lessonSlug (server-derived), used both to bind-check
  // a supplied grant and to key the no-ref coverage check.
  readonly lessonSlug: string;
  // The opaque launch reference transported by the client, or `undefined` for a
  // canonical launch. The client supplies only this id; it can name no content.
  readonly launchRef?: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// A `Timestamp`-like `expiresAt`. A concrete server-computed `Timestamp` was
// written at issuance (§3.6), so a missing/malformed `toMillis` is a malformed
// record, not an expired one.
function readExpiryMs(expiresAt: RawLaunchGrant["expiresAt"]): number | undefined {
  if (
    expiresAt !== null &&
    typeof expiresAt === "object" &&
    typeof (expiresAt as { toMillis?: unknown }).toMillis === "function"
  ) {
    const ms = (expiresAt as { toMillis: () => number }).toMillis();
    return typeof ms === "number" && Number.isFinite(ms) ? ms : undefined;
  }
  return undefined;
}

// §8.2 step 2 - validate a supplied launch grant and return the exact delivery
// freeze it recorded, or throw a stable refusal. Never re-resolves the current
// index; the grant is immutable issuance evidence.
function resolveWithGrant(
  ports: BeginDeliveryPorts,
  input: ResolveBeginDeliveryInput,
  grant: RawLaunchGrant | undefined,
): SessionDeliveryFreeze {
  const { studentId, assignmentId, lessonSlug } = input;

  // No such grant. Byte-identical refusal shape (no existence disclosure); the
  // distinguishing reason is server-telemetry-only. (A malformed grant-id
  // FORMAT is rejected earlier in `resolveBeginDelivery`, before the read.)
  if (grant === undefined) {
    ports.telemetry({ type: "grantInvalid", studentId, assignmentId, lessonSlug, reason: "notFound" });
    throw invalidLaunchRef();
  }

  // Actor / assignment / lesson binding (§7.2). A grant is unusable by any
  // other user, for any other assignment, or against a different lesson. All
  // three collapse to the same byte-identical refusal as unknown-grant.
  if (
    grant.studentId !== studentId ||
    grant.assignmentId !== assignmentId ||
    grant.lessonSlug !== lessonSlug
  ) {
    ports.telemetry({ type: "grantInvalid", studentId, assignmentId, lessonSlug, reason: "binding" });
    throw invalidLaunchRef();
  }

  // Expiry (§8.2). A concrete `expiresAt` Timestamp was written at issuance; a
  // missing/malformed one is a malformed record (non-retriable invalid), while
  // a real past expiry is the retriable EXPIRED path (client re-resolves).
  const expiryMs = readExpiryMs(grant.expiresAt);
  if (expiryMs === undefined) {
    ports.telemetry({ type: "grantInvalid", studentId, assignmentId, lessonSlug, reason: "malformedExpiry" });
    throw invalidLaunchRef();
  }
  if (expiryMs <= ports.nowMs()) {
    ports.telemetry({ type: "grantExpired", studentId, assignmentId, lessonSlug });
    throw new PlatformError(
      LAUNCH_REF_EXPIRED,
      "The launch reference has expired; re-resolve to obtain a fresh one.",
    );
  }

  // Outcome + pair invariant (§3.6/§8.1). A differentiated grant MUST carry both
  // pair fields; a canonicalFallback grant MUST carry neither; any other shape
  // is a malformed record. The differentiated pair is the ONLY source of a
  // session's frozen presentation identity.
  if (grant.outcomeAtIssuance === "differentiated") {
    if (
      !isNonEmptyString(grant.variantKey) ||
      !isNonEmptyString(grant.presentationRevisionId)
    ) {
      ports.telemetry({ type: "grantInvalid", studentId, assignmentId, lessonSlug, reason: "malformedPair" });
      throw invalidLaunchRef();
    }
    ports.telemetry({
      type: "differentiatedBound",
      studentId,
      assignmentId,
      lessonSlug,
      variantKey: grant.variantKey,
      presentationRevisionId: grant.presentationRevisionId,
    });
    return {
      deliveryOutcome: "differentiated",
      variantKey: grant.variantKey,
      presentationRevisionId: grant.presentationRevisionId,
    };
  }

  if (grant.outcomeAtIssuance === "canonicalFallback") {
    if (
      grant.variantKey !== undefined ||
      grant.presentationRevisionId !== undefined
    ) {
      ports.telemetry({ type: "grantInvalid", studentId, assignmentId, lessonSlug, reason: "malformedPair" });
      throw invalidLaunchRef();
    }
    ports.telemetry({ type: "canonicalFallbackBound", studentId, assignmentId, lessonSlug });
    return { deliveryOutcome: "canonicalFallback" };
  }

  ports.telemetry({ type: "grantInvalid", studentId, assignmentId, lessonSlug, reason: "invalidOutcome" });
  throw invalidLaunchRef();
}

// §8.2 step 3 (P1) - the no-ref legitimacy check. Determines whether beginning
// without a grant is legitimate. NEVER selects/freezes a revision.
async function resolveWithoutGrant(
  ports: BeginDeliveryPorts,
  input: ResolveBeginDeliveryInput,
): Promise<SessionDeliveryFreeze> {
  const { studentId, assignmentId, lessonSlug } = input;

  const reading = await ports.readAccommodation(studentId);
  // Absent / inactive accommodation -> no support expected -> canonical.
  // (No launchRef is legitimate here; this is the entire canonical population.)
  if (!reading.active) {
    return { deliveryOutcome: "canonical" };
  }

  const variantKey = ports.variantKeyForReadingLevel(reading.level);

  // §8.6 operational disable is checked BEFORE the index (mirroring Op C): a
  // covered active accommodation legitimately reaches canonical delivery with
  // no grant only because delivery is intentionally disabled. The accommodation
  // record is untouched. This is the sole no-ref canonicalFallback that can
  // coexist with currently-available coverage.
  const deliveryEnabled = await ports.isDeliveryEnabled();
  if (!deliveryEnabled) {
    ports.telemetry({ type: "noRefFallback", studentId, assignmentId, lessonSlug, variantKey, reason: "operationalDisable" });
    return { deliveryOutcome: "canonicalFallback" };
  }

  // Coverage legitimacy. This read decides ONLY whether a ref-less fallback is
  // legitimate; it never yields a revision.
  const coverage = await ports.readCoverage(lessonSlug, variantKey);
  switch (coverage) {
    case "absent":
      // Legitimate coverage gap -> truthful canonicalFallback.
      ports.telemetry({ type: "noRefFallback", studentId, assignmentId, lessonSlug, variantKey, reason: "coverageAbsent" });
      return { deliveryOutcome: "canonicalFallback" };
    case "retired":
      // Legitimate coverage withdrawal -> truthful canonicalFallback.
      ports.telemetry({ type: "noRefFallback", studentId, assignmentId, lessonSlug, variantKey, reason: "coverageRetired" });
      return { deliveryOutcome: "canonicalFallback" };
    case "active":
      // THE P1 CASE. Differentiated coverage is currently available and
      // delivery is enabled, yet no valid grant was presented. A withheld,
      // discarded, or stale-client-absent launchRef must NOT suppress available
      // required support. Refuse (retriable) so the client returns through fresh
      // server launch resolution. Creates NO session and NO attempt.
      ports.telemetry({ type: "beginRequiresLaunch", studentId, assignmentId, lessonSlug, variantKey });
      throw new PlatformError(
        BEGIN_REQUIRES_LAUNCH,
        "A fresh launch is required to begin this assessment.",
      );
    case "malformed":
    default:
      // Fail safe: do NOT treat an untrusted client's omission as an ordinary
      // successful fallback when coverage state cannot be affirmatively
      // established. Refuse (retriable); never a silent freeze (§8.2/§8.3).
      ports.telemetry({ type: "beginValidationUnavailable", studentId, assignmentId, lessonSlug, reason: "coverageMalformed" });
      throw validationUnavailable();
  }
}

// The single begin-time delivery resolver entry point. Returns the exact
// `SessionDeliveryFreeze` to stamp on the new session, or throws a stable
// PlatformError refusal (in which case begin creates no session and no
// attempt). Any UNEXPECTED thrown value from a port read (transient storage
// failure) is converted to the retriable `BEGIN_VALIDATION_UNAVAILABLE`
// fail-closed refusal (§8.3); deliberate refusals thrown here (a `PlatformError`)
// pass through unchanged so an invalid grant stays LAUNCH_REF_INVALID and a
// covered no-ref stays BEGIN_REQUIRES_LAUNCH.
export async function resolveBeginDelivery(
  ports: BeginDeliveryPorts,
  input: ResolveBeginDeliveryInput,
): Promise<SessionDeliveryFreeze> {
  try {
    if (input.launchRef !== undefined) {
      // Grant-id FORMAT is validated before any read (§ launch grant
      // validation "grant ID format" first). A malformed id refuses with the
      // uniform LAUNCH_REF_INVALID shape and never touches storage.
      if (!ports.isValidGrantId(input.launchRef)) {
        ports.telemetry({
          type: "grantInvalid",
          studentId: input.studentId,
          assignmentId: input.assignmentId,
          lessonSlug: input.lessonSlug,
          reason: "malformedId",
        });
        throw invalidLaunchRef();
      }
      const grant = await ports.readGrant(input.launchRef);
      return resolveWithGrant(ports, input, grant);
    }
    return await resolveWithoutGrant(ports, input);
  } catch (err) {
    if (err instanceof PlatformError) throw err;
    // Transient internal failure in a step-2/3 read -> fail closed. No session;
    // never a silently frozen canonical/canonicalFallback (§8.3).
    ports.telemetry({
      type: "beginValidationUnavailable",
      studentId: input.studentId,
      assignmentId: input.assignmentId,
      lessonSlug: input.lessonSlug,
      reason: "internalFailure",
    });
    throw validationUnavailable();
  }
}

// Uniform non-disclosing refusal for every invalid/mismatched/malformed grant
// state (forged, unknown, cross-user, cross-assignment, cross-lesson, malformed
// record, malformed pair, invalid outcome). Non-retriable.
function invalidLaunchRef(): PlatformError {
  return new PlatformError(
    LAUNCH_REF_INVALID,
    "The launch reference is invalid.",
  );
}

// Retriable fail-closed refusal for an unresolvable coverage/validation state.
function validationUnavailable(): PlatformError {
  return new PlatformError(
    BEGIN_VALIDATION_UNAVAILABLE,
    "Assessment begin validation is temporarily unavailable; retry.",
  );
}
