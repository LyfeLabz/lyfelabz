import { buildAssignmentLaunchUrl, buildLessonBasePath } from "./launch";
import type { AssignmentsListForStudentItem } from "./types";

// F5.2 §7.3 - Persistent Student Differentiation Slice 5: the single client
// routing decision helper and its navigation executor.
//
// SECURITY PRINCIPLE (§7.3, §11). The SERVER chooses the presentation; the
// CLIENT only transports that choice. This module NEVER inspects accommodation
// state, derives a `variantKey`, constructs a variant path from a `lessonSlug`,
// decodes the `launchRef`, or chooses between presentations. Its only inputs are
// the server-returned `presentation.path` (opaque) and `launchRef` (opaque), and
// the canonical lesson URL built by the certified `launch.ts` helpers.
//
// The decision (per launch):
//   - Server returned a differentiated `presentation` whose `path` passes the
//     same-origin variant-path grammar -> route to that exact server-selected
//     path, transporting `launchRef`.
//   - Server returned a differentiated `presentation` whose `path` is unsafe or
//     unusable -> this is a differentiated-artifact delivery failure (§7.3): do
//     NOT navigate to the unsafe path, DISCARD the `launchRef` (never reuse it to
//     claim differentiated), emit the variant-load-failure anomaly, and fall back
//     visually to the canonical target.
//   - Server returned only a `launchRef` (canonicalFallback) -> route canonical,
//     transporting the fallback `launchRef` so Slice 6 can bind truthful fallback
//     evidence.
//   - Server returned neither (canonical / expected-canonical) -> route canonical
//     with no `launchRef`, byte-identical to pre-feature behavior.
//
// NAVIGATION FAILURE (§7.3, C3). For a differentiated target the executor
// load-probes the artifact before committing the full-page navigation (the
// static-site analogue of "load of presentation.path fails"). On probe failure it
// falls back VISUALLY to the canonical target, DISCARDS the `launchRef` (the
// canonical fallback URL carries no ref), and emits the anomaly. Discarding the
// ref only ever downgrades toward canonical; the client never mints, alters, or
// upgrades a grant, and never routes to any differentiated target other than the
// one the server selected. It is never authoritative for fallback legitimacy -
// with active server coverage, Slice 6's ref-less begin will refuse
// `BEGIN_REQUIRES_LAUNCH` and require fresh re-resolution rather than record a
// false differentiated (or a client-authored canonicalFallback) outcome.

// The launch query parameter name the assessment runtime reads on the lesson
// page to detect assignment context (Sprint 17). Mirrors runtime/entry.ts.
const ASSIGNMENT_PARAM = "assignment";
// F5.2 §4.3/§8 - the single new optional field `assessmentSessionsBegin` accepts.
// The client transports the opaque grant id under this name and never decodes it.
const LAUNCH_REF_PARAM = "launchRef";

// §5.2/M4 opaque artifact-path grammar, matching the server's authoritative
// `variantRelativeOutputPath` / `assertActivateWriteConsistent` formula
// (`app/lessons/variants/lesson_{lessonSlug}__{presentationRevisionId}.html`,
// no leading slash on the wire). Validated here as a TRUST BOUNDARY, not to
// re-derive presentation identity: the whole string is checked against one safe
// shape and then used verbatim. The strict grammar makes an open redirect
// impossible - `https://evil`, `//evil`, `javascript:`, `data:`, backslashes,
// `..`, query/fragment smuggling, and any other host or scheme all fail it.
const SAFE_VARIANT_PATH_RE =
  /^app\/lessons\/variants\/lesson_[a-z0-9-]+__pr[0-9a-f]{64}\.html$/;

// Opaque launch-grant token bound: a URL-safe token of sane length. The server
// mints 32 lowercase hex chars (§3.6); this stays intentionally permissive
// (opaque transport) while refusing anything that could smuggle URL structure.
const SAFE_LAUNCH_REF_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function isSafeVariantPath(path: unknown): path is string {
  return typeof path === "string" && SAFE_VARIANT_PATH_RE.test(path);
}

export function isSafeLaunchRef(ref: unknown): ref is string {
  return typeof ref === "string" && SAFE_LAUNCH_REF_RE.test(ref);
}

// Append a query parameter to an internal path, preserving any existing query.
function withParam(url: string, key: string, value: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${key}=${encodeURIComponent(value)}`;
}

// Build the same-origin navigation URL for a validated differentiated artifact
// path. The server path is a RELATIVE `app/lessons/...` string; we make it an
// absolute same-origin path (single leading slash) so it can never be read as a
// protocol-relative (`//host`) or cross-origin target. Returns null iff the path
// fails the safety grammar (caller treats that as a differentiated-load failure).
function buildVariantNavigationUrl(path: string): string | null {
  if (!isSafeVariantPath(path)) return null;
  return `/${path}`;
}

// The resolved routing plan for one launch. `canonicalUrl` never carries a
// launchRef (the ultimate fallback and the DOM-observable launch target).
export type LaunchPlan = {
  // Where to navigate first.
  readonly primaryUrl: string;
  // True iff `primaryUrl` is a differentiated artifact that must be load-probed;
  // on probe failure the executor navigates `canonicalUrl` and emits the anomaly.
  readonly differentiated: boolean;
  // Canonical target for this lesson. Never carries a launchRef. Used as the DOM
  // launch attribute and as the visual fallback when a differentiated artifact
  // (unsafe path or probe failure) cannot be delivered.
  readonly canonicalUrl: string;
  // The server offered a differentiated presentation but its path was unsafe or
  // unusable, so it was not routed. The executor emits the load-failure anomaly
  // and navigates `canonicalUrl` (the differentiated launchRef is already
  // discarded - it is never placed on `canonicalUrl`).
  readonly differentiatedRejected: boolean;
};

// Plan a classroom assignment launch (My Science card, deep-link assignmentLaunch)
// from a server list/resolution item. Returns null iff the canonical lesson URL
// is unresolvable (malformed slug) - the caller drops the item rather than render
// a dead control, exactly as before differentiation existed.
export function planAssignmentLaunch(
  item: AssignmentsListForStudentItem,
): LaunchPlan | null {
  const canonicalUrl = buildAssignmentLaunchUrl(item);
  if (canonicalUrl === null) return null;

  const presentation = item.presentation;
  if (presentation !== undefined) {
    // The server selected a differentiated presentation. Validate its opaque
    // path at the client trust boundary. Only a safe path AND a safe launchRef
    // may be routed as differentiated; anything else is a delivery failure that
    // discards the ref and falls back canonically (§7.3, no client-side upgrade).
    const variantUrl = buildVariantNavigationUrl(presentation.path);
    if (variantUrl !== null && isSafeLaunchRef(item.launchRef)) {
      let primaryUrl = withParam(variantUrl, ASSIGNMENT_PARAM, item.assignmentId);
      primaryUrl = withParam(primaryUrl, LAUNCH_REF_PARAM, item.launchRef);
      return {
        primaryUrl,
        differentiated: true,
        canonicalUrl,
        differentiatedRejected: false,
      };
    }
    return {
      primaryUrl: canonicalUrl,
      differentiated: false,
      canonicalUrl,
      differentiatedRejected: true,
    };
  }

  // No presentation. A canonicalFallback grant (launchRef only) is transported on
  // the canonical URL so Slice 6 can bind truthful fallback evidence; a plain
  // canonical launch carries no ref.
  if (isSafeLaunchRef(item.launchRef)) {
    return {
      primaryUrl: withParam(canonicalUrl, LAUNCH_REF_PARAM, item.launchRef),
      differentiated: false,
      canonicalUrl,
      differentiatedRejected: false,
    };
  }

  return {
    primaryUrl: canonicalUrl,
    differentiated: false,
    canonicalUrl,
    differentiatedRejected: false,
  };
}

// Plan a practice launch (deep-link lessonPractice). Practice never reaches
// session begin (§9): its grants are never consumed, so no launchRef is
// transported and no `?assignment=` is added - the lesson opens in standalone
// practice mode. A differentiated presentation still routes the student to the
// adapted artifact (with the same probe/fallback), because practice re-resolves
// current configuration on every launch. Returns null iff the canonical base
// path is unresolvable.
export function planPracticeLaunch(
  lessonSlug: string,
  presentation?: { readonly path: string },
): LaunchPlan | null {
  const canonicalUrl = buildLessonBasePath(lessonSlug);
  if (canonicalUrl === null) return null;

  if (presentation !== undefined) {
    const variantUrl = buildVariantNavigationUrl(presentation.path);
    if (variantUrl !== null) {
      return {
        primaryUrl: variantUrl,
        differentiated: true,
        canonicalUrl,
        differentiatedRejected: false,
      };
    }
    return {
      primaryUrl: canonicalUrl,
      differentiated: false,
      canonicalUrl,
      differentiatedRejected: true,
    };
  }

  return {
    primaryUrl: canonicalUrl,
    differentiated: false,
    canonicalUrl,
    differentiatedRejected: false,
  };
}

export type LaunchExecuteDeps = {
  // Perform the full-page navigation to an internal lesson URL
  // (window.location.assign in production). Only ever called with a helper-built
  // internal path (canonical or the server-selected differentiated artifact).
  readonly navigate: (url: string) => void;
  // Best-effort load probe for a differentiated artifact URL. Resolves true iff
  // the artifact is retrievable. Any rejection is treated as a load failure by
  // the executor (fail safe toward canonical). Production wires a same-origin
  // HEAD fetch; tests inject a deterministic fake.
  readonly probe: (url: string) => Promise<boolean>;
  // Emit the variant-load-failure anomaly (§7.3). Best-effort and non-sensitive:
  // it must NOT carry a variantKey, presentationRevisionId, launchRef, path, or
  // any accommodation detail. Optional; a no-op when omitted.
  readonly onVariantLoadFailure?: () => void;
};

// Execute a launch plan. Canonical and canonicalFallback plans navigate directly.
// A differentiated plan is load-probed first; on failure the client falls back
// visually to the canonical target, discards the launchRef (canonicalUrl carries
// none), and emits the anomaly. A plan whose differentiated path was rejected at
// build time is handled identically (anomaly + canonical fallback) without a
// probe. The executor never routes to any target other than the plan's
// server-selected `primaryUrl` or its canonical fallback.
export async function executeLaunch(
  plan: LaunchPlan,
  deps: LaunchExecuteDeps,
): Promise<void> {
  if (plan.differentiatedRejected) {
    deps.onVariantLoadFailure?.();
    deps.navigate(plan.canonicalUrl);
    return;
  }

  if (plan.differentiated) {
    let loadable = false;
    try {
      loadable = await deps.probe(plan.primaryUrl);
    } catch {
      loadable = false;
    }
    if (!loadable) {
      deps.onVariantLoadFailure?.();
      deps.navigate(plan.canonicalUrl);
      return;
    }
  }

  deps.navigate(plan.primaryUrl);
}
