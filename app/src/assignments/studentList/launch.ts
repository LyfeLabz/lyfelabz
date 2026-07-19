import type { AssignmentsListForStudentItem } from "./types";

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
// §5.1):
//
//   /lesson_<slug>.html?assignment=<encodedAssignmentId>
//
// Confidentiality: only the assignmentId crosses into the URL. No UID,
// schoolId, districtId, teacherId, classId, recipient identifier,
// session identifier, token, or score is ever exposed. The runtime
// re-derives the authenticated identity from the certified auth session
// on lesson load; the browser is not the authorization authority.
//
// Preservation: the canonical lesson URL is untouched by a standalone
// (unassigned) visit. Removing the `?assignment` query parameter must
// leave the lesson at its byte-for-byte practice-mode URL.

const LESSON_SLUG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,126}[A-Za-z0-9])?$/;

// The launcher accepts only the frozen tuple the server returns via
// `assignmentsListForStudent`. Every field is re-checked here so a
// malformed item (already dropped by parseAssignmentsListForStudentItem
// in wire.ts) cannot slip through a code path that bypassed the parser.
export function buildAssignmentLaunchUrl(
  item: AssignmentsListForStudentItem,
): string | null {
  const { assignmentId, lessonSlug } = item;
  if (typeof assignmentId !== "string" || assignmentId.length === 0) {
    return null;
  }
  if (typeof lessonSlug !== "string" || lessonSlug.length === 0) {
    return null;
  }
  if (!LESSON_SLUG_PATTERN.test(lessonSlug)) return null;
  // encodeURIComponent covers every reserved URL character including
  // `&`, `?`, `#`, `=`, and `/`; the assignmentId is treated as opaque.
  const encoded = encodeURIComponent(assignmentId);
  return `/lesson_${lessonSlug}.html?assignment=${encoded}`;
}
