import { createHash } from "node:crypto";

import { PlatformError } from "../errors/platform-error";
import type { ExternalIdentityProviderId } from "../types/external-identity";

// Sprint 23C-I - external-identity document ID helper.
//
// The canonical Firestore document identifier for a mapping in
// `externalIdentities/{externalIdentityId}` is a deterministic
// SHA-256 hash of a strictly versioned, NUL-separated canonical
// input:
//
//   "v1" + "\x00" + providerId + "\x00" + providerAccountId
//
// - The "v1" prefix pins the derivation to a specific canonical
//   layout. Any future change to the layout (new separator strategy,
//   new provider namespace, provider-scoped normalization) increments
//   the prefix, so pre-existing document IDs never collide with a
//   post-migration derivation.
// - "\x00" NUL separators are load-bearing. They prevent an
//   adversarial provider id or account id from ambiguating boundaries
//   between the fields (e.g. providerId="google" +
//   providerAccountId=".com\x00abc" cannot collide with
//   providerId="google.com" + providerAccountId="abc"). The source
//   uses explicit `"\x00"` escapes rather than literal NUL bytes so
//   the string round-trips safely through editors and code review.
// - SHA-256 is rendered as lowercase hex; the output is always
//   exactly 64 characters.
// - The raw provider account identifier NEVER appears in the derived
//   document identifier; the hash is a one-way function of it.
//
// The same helper is used by every writer and every reader. A drift
// between the two (e.g. one caller normalizing case, the other not)
// would create silently unresolvable mappings, so the derivation is
// centralized here and validated with a dedicated test suite.

const CANONICAL_INPUT_VERSION_PREFIX = "v1";
const NUL_SEPARATOR = "\x00";

// Upper bound on the accepted provider account identifier length.
// The Google Classroom `Student.userId` is a numeric-looking string
// but Google documents it as an opaque identifier of unspecified
// length. 512 bytes comfortably exceeds any observed identifier while
// keeping a hard ceiling that prevents unbounded input from reaching
// the hasher.
const MAX_PROVIDER_ACCOUNT_ID_LENGTH = 512;

// Approved provider vocabulary. Kept in one place so a caller cannot
// silently introduce a new provider without an explicit update here.
const APPROVED_PROVIDER_IDS: readonly ExternalIdentityProviderId[] = [
  "google.com",
];

function isApprovedProviderId(
  value: unknown,
): value is ExternalIdentityProviderId {
  return (
    typeof value === "string" &&
    (APPROVED_PROVIDER_IDS as readonly string[]).includes(value)
  );
}

// Validate a provider account identifier per the Sprint 23C-I
// directive: opaque string; require string type; require non-empty;
// reject whitespace-only; enforce reasonable maximum length; preserve
// the exact string bytes (never parse as number, never convert via
// JavaScript numeric types, never trim, never coerce case). Long
// numeric-looking identifiers MUST be preserved exactly to avoid
// precision loss that would otherwise be introduced by any numeric
// conversion.
//
// This helper is exported so both the doc-id derivation and the store
// use one consistent validator.
export function assertValidProviderAccountId(value: unknown): string {
  if (typeof value !== "string") {
    throw new PlatformError(
      "identity.invalidProviderAccountId",
      "providerAccountId must be a string.",
    );
  }
  if (value.length === 0) {
    throw new PlatformError(
      "identity.invalidProviderAccountId",
      "providerAccountId must be a non-empty string.",
    );
  }
  if (value.trim().length === 0) {
    throw new PlatformError(
      "identity.invalidProviderAccountId",
      "providerAccountId must not be whitespace-only.",
    );
  }
  if (value.length > MAX_PROVIDER_ACCOUNT_ID_LENGTH) {
    throw new PlatformError(
      "identity.invalidProviderAccountId",
      "providerAccountId exceeds the maximum accepted length.",
    );
  }
  if (value.indexOf(NUL_SEPARATOR) >= 0) {
    // A literal NUL byte in the input would forge a separator
    // boundary and defeat the collision-resistance argument for the
    // NUL-separated canonical layout. This is not a realistic upstream
    // identifier; reject rather than silently sanitize.
    throw new PlatformError(
      "identity.invalidProviderAccountId",
      "providerAccountId must not contain a NUL byte.",
    );
  }
  return value;
}

export function assertValidProviderId(
  value: unknown,
): ExternalIdentityProviderId {
  if (!isApprovedProviderId(value)) {
    throw new PlatformError(
      "identity.invalidProviderId",
      "providerId is not an approved external-identity provider.",
    );
  }
  return value;
}

export type ExternalIdentityDocIdInput = {
  readonly providerId: ExternalIdentityProviderId;
  readonly providerAccountId: string;
};

// Compute the canonical document identifier for
// `externalIdentities/{externalIdentityId}` from the (providerId,
// providerAccountId) pair. Deterministic: identical input always
// yields the identical 64-character lowercase hex output. The raw
// provider account identifier is NEVER embedded in the output.
export function computeExternalIdentityDocId(
  input: ExternalIdentityDocIdInput,
): string {
  const providerId = assertValidProviderId(input.providerId);
  const providerAccountId = assertValidProviderAccountId(
    input.providerAccountId,
  );
  const canonical =
    CANONICAL_INPUT_VERSION_PREFIX +
    NUL_SEPARATOR +
    providerId +
    NUL_SEPARATOR +
    providerAccountId;
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
