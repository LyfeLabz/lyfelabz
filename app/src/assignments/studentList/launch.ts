import type { AssignmentsListForStudentItem } from "./types";
import { LESSON_LAUNCH_OVERRIDES } from "./launchOverrides";
import { resolveAssessmentRevisionPath } from "./revisionPaths";

// Sprint 17 Slice 4: assignment launcher URL builder.
//
// The launcher navigates a student to the canonical lesson page
// associated with an assignment and hands the runtime the single piece
// of context it needs to detect assignment mode: the assignmentId. The
// runtime handles authentication, session creation, autosave, and
// finalization in Slice 5. This module is intentionally inert with
// respect to any of that; it composes a URL and nothing else.
//
// URL contract (per Sprint 17 Implementation Specification §4 and
// §5.1, as hardened below):
//
//   <revision page>#assignment=<encodedAssignmentId>
//
// Launch-context hardening (security backlog
// SECURITY_BACKLOG_LAUNCH_URL_ANALYTICS.md): the assignment context, and the
// launch-grant reference added by launchRouting.ts, ride in the URL FRAGMENT,
// never the query string. A fragment is never sent in an HTTP request or a
// Referer header, and the lesson pages' analytics page view (whose page
// location is the URL without its fragment) never receives it. The assessment
// runtime reads the query first and then the fragment (runtime/entry.ts,
// runtime/launchParams.ts), so legacy query-form links keep working.
//
// Confidentiality: only the assignmentId crosses into the URL. No UID,
// schoolId, districtId, teacherId, classId, recipient identifier,
// session identifier, token, or score is ever exposed. The runtime
// re-derives the authenticated identity from the certified auth session
// on lesson load; the browser is not the authorization authority.
//
// Preservation: the canonical lesson URL is untouched by a standalone
// (unassigned) visit. Removing the `#assignment` fragment must leave the
// lesson at its byte-for-byte practice-mode URL.

const LESSON_SLUG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,126}[A-Za-z0-9])?$/;

// Resolve the canonical lesson base path for a slug (override-aware), or
// null when the slug is malformed. This is the practice-mode lesson URL: the
// same path a classroom launch uses, without the `?assignment=` query. It is
// the single home for the Sprint 18 override-table consultation so the
// assignment launcher and the Sprint 27 deep-link practice handoff stay in
// lockstep.
export function buildLessonBasePath(lessonSlug: string): string | null {
  if (typeof lessonSlug !== "string" || lessonSlug.length === 0) return null;
  if (!LESSON_SLUG_PATTERN.test(lessonSlug)) return null;
  // Sprint 18: consult the narrow slug-keyed override table. If the pilot
  // lesson has a v2 artifact, use its `/app/lessons/...` path; otherwise emit
  // the v1 path byte-for-byte identical to Sprint 17.
  const override = LESSON_LAUNCH_OVERRIDES[lessonSlug];
  return override ? override.path : `/lesson_${lessonSlug}.html`;
}

// The launcher accepts only the frozen tuple the server returns via
// `assignmentsListForStudent`. Every field is re-checked here so a
// malformed item (already dropped by parseAssignmentsListForStudentItem
// in wire.ts) cannot slip through a code path that bypassed the parser.
//
// F5.3 Slice 9D (addendum 21.5): the base path is the canonical page of the
// assignment's FROZEN assessment revision, from the build-generated
// revision-path table. Returns null (fail closed: no navigation) when the item
// carries no usable revision or the exact (lesson, revision) pair has no page;
// it never falls back to the unversioned or current lesson page.
export function buildAssignmentLaunchUrl(
  item: AssignmentsListForStudentItem,
): string | null {
  const { assignmentId, lessonSlug } = item;
  if (typeof assignmentId !== "string" || assignmentId.length === 0) {
    return null;
  }
  const basePath = buildRevisionBoundLessonPath(lessonSlug, item.assessmentRevisionId);
  if (basePath === null) return null;
  return withLaunchContext(basePath, ASSIGNMENT_CONTEXT_PARAM, assignmentId);
}

// The launch-context parameter names the assessment runtime reads
// (runtime/entry.ts, runtime/launchParams.ts).
export const ASSIGNMENT_CONTEXT_PARAM = "assignment";
export const LAUNCH_REF_CONTEXT_PARAM = "launchRef";

// Append one launch-context parameter to an internal page URL's FRAGMENT
// (`#k=v`, or `&k=v` when a fragment already exists). Never touches the query
// string. encodeURIComponent covers every reserved URL character including
// `&`, `?`, `#`, `=`, and `/`; the value is treated as opaque.
export function withLaunchContext(url: string, key: string, value: string): string {
  const sep = url.includes("#") ? "&" : "#";
  return `${url}${sep}${key}=${encodeURIComponent(value)}`;
}

// F5.3 Slice 9D: the practice-mode (no `?assignment=`) canonical page of an
// assignment's frozen revision, for assignment-associated practice. Null when
// the revision is missing or unmapped (fail closed).
export function buildRevisionBoundLessonPath(
  lessonSlug: string,
  assessmentRevisionId: unknown,
): string | null {
  if (typeof lessonSlug !== "string" || !LESSON_SLUG_PATTERN.test(lessonSlug)) return null;
  return resolveAssessmentRevisionPath(lessonSlug, assessmentRevisionId);
}
