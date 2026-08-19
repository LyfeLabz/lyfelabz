import { PlatformError } from "../shared";

// Sprint 27 Phase 4 (blueprint Decision 4; PDR-027 §8, §26 item 2).
//
// The single authorized producer of the Google Classroom deep-link URL. No
// other code path constructs the URL; the client never supplies it. This
// closes the pre-Sprint-27 defect where the publication callable accepted a
// client-supplied `lyfelabzAssignmentUrl` and passed it verbatim to Google
// Classroom, letting a compromised or buggy client point coursework at an
// arbitrary destination.
//
// URL shape (PDR-027 §8.1):
//
//   https://app.lyfelabz.com/app/a/{assignmentId}
//
// Host correction (blueprint §8.1, definition §16). PDR-027 §8.1 names the
// canonical origin `https://lyfelabz.com`, but that origin is a documented
// FUTURE target state reached only after Firebase Hosting takes over the apex
// from GitHub Pages. Today the apex and `www` still resolve to the legacy
// GitHub Pages curriculum site, which does not carry the `/app/**` bundle; a
// Classroom link written to `https://lyfelabz.com/app/a/{id}` would land the
// student on a page with no app and fail to resolve. The authenticated
// platform serves from `https://app.lyfelabz.com/app/` (the live LMS OAuth
// callback is `https://app.lyfelabz.com/app/lms-callback.html`). Sprint 27
// therefore emits the `app.lyfelabz.com` host. The `/app/a/{assignmentId}`
// route shape is host-independent, so when the apex migration completes the
// only change is this single constant moving to `lyfelabz.com`.
//
// The origin is a fixed production constant, not a client input and not an
// environment value the client can influence. This is deliberately the
// narrowest server-authoritative mechanism (blueprint §8.1): a single
// constant owned by the sole URL producer, asserted by deterministic tests.
// It is not a generalized URL/configuration framework.
export const CANONICAL_APP_ORIGIN = "https://app.lyfelabz.com";

// Canonical assignment identifier grammar. Identical to the pattern enforced
// by `assessmentSessionsBegin` and `assignmentsRecipientAdd`: a URL-safe
// token of 1-64 characters drawn only from `[a-zA-Z0-9_-]` and never leading
// or trailing with `_`/`-`. Because the grammar admits no `:`, `/`, `?`, `#`,
// `.`, or whitespace, an id that passes it cannot smuggle a query parameter,
// a fragment, an alternate host, a scheme, or a second path segment into the
// emitted URL. Refusal of every prohibited URL content (PDR-027 §8.2) is
// therefore structural: the builder simply has no parameter for a lesson
// slug, a token, a score, or any identifier other than the assignmentId.
const ASSIGNMENT_ID_PATTERN =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;

// Build the canonical deep-link URL for one LyfeLabz assignment. Throws
// `deep-link-shape-invalid` (PDR-027 §21) when the assignmentId is not a
// canonical URL-safe token, so a non-canonical identifier can never produce
// a malformed Classroom link. The returned string is always exactly
// `https://app.lyfelabz.com/app/a/{assignmentId}` with no query, no fragment,
// and no alternate host.
export function buildAssignmentDeepLinkUrl(assignmentId: string): string {
  if (
    typeof assignmentId !== "string" ||
    !ASSIGNMENT_ID_PATTERN.test(assignmentId)
  ) {
    throw new PlatformError(
      "deep-link-shape-invalid",
      "assignmentId must be a canonical URL-safe token to build a deep-link URL.",
    );
  }
  return `${CANONICAL_APP_ORIGIN}/app/a/${assignmentId}`;
}
