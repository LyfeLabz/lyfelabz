// F5.2 §7.3/§8 (Persistent Student Differentiation Slice 5): read the opaque
// launch-grant reference the launcher hands off on the lesson URL. Extracted
// from the runtime entry as a pure, Firebase-free function so the transport seam
// is unit-testable without booting the assessment runtime.
//
// The launcher appends `?launchRef=<opaque>` ONLY on a differentiated or
// canonicalFallback launch. The value is an opaque server-minted grant id; this
// function reads it VERBATIM and never decodes, derives, interprets, or replaces
// it - the runtime only transports it to `assessmentSessionsBegin`, and the
// server (Slice 6) is the sole authority on its validity. A light URL-safe /
// length sanity bound refuses any value that could smuggle URL structure.
// Absent on canonical launches, which keeps begin byte-identical to pre-feature
// behavior.

const LAUNCH_REF_SANITY_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function detectLaunchRef(win: Window): string | null {
  try {
    const readParam = (raw: string | null): string | null =>
      typeof raw === "string" && LAUNCH_REF_SANITY_RE.test(raw) ? raw : null;
    const search = win.location.search ?? "";
    if (search.length > 0) {
      const found = readParam(new URLSearchParams(search).get("launchRef"));
      if (found !== null) return found;
    }
    const hash = win.location.hash ?? "";
    if (hash.length > 0) {
      const hashParams = new URLSearchParams(
        hash.startsWith("#") ? hash.slice(1) : hash,
      );
      const found = readParam(hashParams.get("launchRef"));
      if (found !== null) return found;
    }
  } catch {
    return null;
  }
  return null;
}
