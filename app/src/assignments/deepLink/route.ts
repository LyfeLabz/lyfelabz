// Sprint 27 Phase 4 (blueprint §8.2, §8.3): the client-side parser for the
// Google Classroom deep-link arrival route.
//
//   /app/a/{assignmentId}
//
// This is the sole client consumer of the deep-link route shape. It extracts
// and validates the opaque assignmentId from a pathname and rejects anything
// that is not the exact canonical shape. It performs NO authorization: the
// assignmentId is handed to the server resolver, which is the authorization
// boundary. Possession or guessing of the URL never grants access.
//
// The route is host-independent by design (it is always an absolute
// `/app/a/{id}` path), so this parser reads only `window.location.pathname`
// and never trusts a query string or fragment as authorization input.

// Canonical assignment identifier grammar. Identical to the server-side
// grammar in `platform/functions/src/lms/deep-link-url.ts` and the resolver:
// a URL-safe token of 1-64 characters from `[a-zA-Z0-9_-]` that never leads
// or trails with `_`/`-`. Because the grammar admits no `/`, `?`, `#`, `.`,
// or whitespace, a path segment that passes it cannot smuggle a second
// segment, a query, or a fragment.
const ASSIGNMENT_ID_PATTERN =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;

const DEEP_LINK_PREFIX = "/app/a/";

// Parse the assignmentId out of a `/app/a/{assignmentId}` pathname. Returns
// the validated assignmentId, or null when the pathname is not a canonical
// deep-link arrival. A trailing slash is tolerated (`/app/a/{id}/`); any
// further path segment, an empty id, or a non-canonical id yields null.
//
// Only the pathname is inspected. Any query string or fragment the caller
// passes separately is ignored; this function never reads them.
export function parseDeepLinkAssignmentId(pathname: string): string | null {
  if (typeof pathname !== "string") return null;
  if (!pathname.startsWith(DEEP_LINK_PREFIX)) return null;
  let rest = pathname.slice(DEEP_LINK_PREFIX.length);
  // Tolerate a single trailing slash but nothing more.
  if (rest.endsWith("/")) rest = rest.slice(0, -1);
  if (rest.length === 0) return null;
  // Any remaining path separator means a second segment; reject.
  if (rest.includes("/")) return null;
  if (!ASSIGNMENT_ID_PATTERN.test(rest)) return null;
  return rest;
}

// True when the given pathname is a canonical deep-link arrival path.
export function isDeepLinkArrivalPath(pathname: string): boolean {
  return parseDeepLinkAssignmentId(pathname) !== null;
}
