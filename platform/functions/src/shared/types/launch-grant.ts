import type { Timestamp } from "firebase-admin/firestore";

// F5.2 Implementation Specification §3.6 - Persistent Student Differentiation,
// Slice 4 (server resolution + launch grants). This is the NEW
// `launchGrants/{grantId}` record family: server-issued, non-forgeable,
// TTL-bounded EVIDENCE of which presentation a specific authorized launch
// resolution delivered.
//
// A launch grant is presentation-binding evidence, NOT authorization (§7.2).
// It authorizes nothing by itself; `assessmentSessionsBegin` (Slice 6)
// performs its full existing authentication and assignment/enrollment
// authorization BEFORE any grant validation. Possession alone bypasses no
// check. A grant only proves which server-authorized presentation was
// resolved for that authorized (student, assignment) launch.
//
// Zero direct client access for any role (deny-all Rules block, mirroring
// `studentAccommodations`, `presentationVariants`, `auditEvents`). The
// student receives only the opaque `grantId` (transported as `launchRef`);
// the grant's content fields are server-written at issuance and never named
// by a client (§7.2, §11).
//
// This record stores NO IEP/504 text, NO diagnosis, NO accommodation level or
// status, and NO plan data. `variantKey`/`presentationRevisionId` are the
// delivered presentation identity, not plan data (§8.1, §11).

export const LAUNCH_GRANTS_COLLECTION = "launchGrants";

// §3.6 - the certified V1 TTL. `expiresAt = issuedAt + LAUNCH_GRANT_TTL_MS`,
// sized to cover one study window (6 hours). Never accepted from client
// input; both timestamps are server-derived (§ grant TTL).
export const LAUNCH_GRANT_TTL_MS = 6 * 60 * 60 * 1000;

// §3.6 grant-id contract: a >=128-bit CSPRNG value represented as exactly 32
// lowercase hexadecimal characters. Never derived from content or predictable
// inputs. Generation lives in `../presentation/launch-grant-id` (needs
// node:crypto); this module owns only the pure format validator so the type
// contract stays dependency-free.
const GRANT_ID_RE = /^[0-9a-f]{32}$/;

export function isValidGrantId(value: unknown): value is string {
  return typeof value === "string" && GRANT_ID_RE.test(value);
}

// §3.6/§8.1 - the two delivery outcomes a grant can record at issuance.
// `"canonical"` (no support expected) mints NO grant, so it is intentionally
// not a member of this union: a grant exists only for a differentiated or a
// canonical-fallback launch.
export type LaunchGrantOutcomeAtIssuance = "differentiated" | "canonicalFallback";

// Canonical read shape for `launchGrants/{grantId}` per §3.6. The pair invariant
// (`variantKey` and `presentationRevisionId` both present iff
// `outcomeAtIssuance:"differentiated"`) is enforced by
// `assertLaunchGrantPairInvariant` before any write and is expressed here as a
// discriminated union so a fallback grant cannot even be typed with a pair.
export type LaunchGrantRecord =
  | {
      readonly grantId: string;
      readonly studentId: string;
      readonly assignmentId: string;
      readonly lessonSlug: string;
      readonly outcomeAtIssuance: "differentiated";
      readonly variantKey: string;
      readonly presentationRevisionId: string;
      readonly issuedAt: Timestamp;
      readonly expiresAt: Timestamp;
    }
  | {
      readonly grantId: string;
      readonly studentId: string;
      readonly assignmentId: string;
      readonly lessonSlug: string;
      readonly outcomeAtIssuance: "canonicalFallback";
      readonly issuedAt: Timestamp;
      readonly expiresAt: Timestamp;
    };

// Creation-write shape for `launchGrants/{grantId}`, applied via
// `Transaction`/`DocumentReference.create()` so a (astronomically unlikely)
// grant-id collision is a non-overwrite. `issuedAt`/`expiresAt` are concrete
// server-computed `Timestamp`s (never a client value, never a mutable
// sentinel) so `expiresAt` can be checked directly at begin (Slice 6) without
// depending on TTL-deletion latency.
export type LaunchGrantCreationWrite =
  | {
      readonly grantId: string;
      readonly studentId: string;
      readonly assignmentId: string;
      readonly lessonSlug: string;
      readonly outcomeAtIssuance: "differentiated";
      readonly variantKey: string;
      readonly presentationRevisionId: string;
      readonly issuedAt: Timestamp;
      readonly expiresAt: Timestamp;
    }
  | {
      readonly grantId: string;
      readonly studentId: string;
      readonly assignmentId: string;
      readonly lessonSlug: string;
      readonly outcomeAtIssuance: "canonicalFallback";
      readonly issuedAt: Timestamp;
      readonly expiresAt: Timestamp;
    };

// The §3.6 / §8.1 pair invariant, asserted at the write boundary so a fallback
// grant can never carry a fake/stale presentation pair and a differentiated
// grant can never be minted without its exact pair. Both fields present or
// both absent; exactly one present is invalid by construction.
export function assertLaunchGrantPairInvariant(grant: {
  readonly outcomeAtIssuance: LaunchGrantOutcomeAtIssuance;
  readonly variantKey?: string;
  readonly presentationRevisionId?: string;
}): void {
  const hasVariantKey =
    typeof grant.variantKey === "string" && grant.variantKey.length > 0;
  const hasRevisionId =
    typeof grant.presentationRevisionId === "string" &&
    grant.presentationRevisionId.length > 0;

  if (hasVariantKey !== hasRevisionId) {
    throw new Error(
      "[launch-grant] pair invariant violated: variantKey and presentationRevisionId must be BOTH present or BOTH absent",
    );
  }
  if (grant.outcomeAtIssuance === "differentiated" && !hasVariantKey) {
    throw new Error(
      "[launch-grant] a differentiated grant must carry both variantKey and presentationRevisionId",
    );
  }
  if (grant.outcomeAtIssuance === "canonicalFallback" && hasVariantKey) {
    throw new Error(
      "[launch-grant] a canonicalFallback grant must NOT carry a presentation pair (no fake/stale pair, §8.1)",
    );
  }
}

// Deterministic derivation of the expiry instant from a server-derived
// issuance instant (epoch ms). Kept pure (ms in, ms out) so both the type
// contract and the tests can assert `expiresAt === issuedAt + TTL` without a
// Firestore or crypto import.
export function computeGrantExpiryMs(issuedAtMs: number): number {
  return issuedAtMs + LAUNCH_GRANT_TTL_MS;
}
