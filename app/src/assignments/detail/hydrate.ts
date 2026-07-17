import type { AssignmentDetailRegistry } from "./registry";
import type {
  AssignmentDetailMetadata,
  AssignmentStatus,
} from "./types";

// Sprint 13C: certified teacher assignment enumeration seam.
//
// This module hydrates the Sprint 13B session-scoped assignment-detail
// registry so a full page reload restores the Curriculum `View summary`
// affordance without requiring the teacher to republish. The module is
// intentionally firebase-free; the entry point provides the callable
// through the injected `AssignmentsTeacherListCallable` seam (see
// `hydrate-wire.ts`). Confidentiality: only teacher-owned assignment
// metadata is ever passed through this seam.

type CallableRecord = Readonly<Record<string, unknown>>;

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

// Sprint 13F: draft records are now allowed through the certified
// enumeration path when the caller opts in through
// `includeDrafts: true`. The parser accepts every non-archived status
// so a `draft` item registered through the widened callable is
// recognized. Older callable responses omit drafts entirely, so the
// widened parser stays backward compatible.
const isReturnedStatus = (
  v: unknown,
): v is Extract<AssignmentStatus, "published" | "closed" | "draft"> =>
  v === "published" || v === "closed" || v === "draft";

export function parseAssignmentsTeacherListItem(
  raw: unknown,
): AssignmentDetailMetadata | null {
  if (raw === null || typeof raw !== "object") return null;
  const item = raw as CallableRecord;
  if (
    !isNonEmptyString(item.assignmentId) ||
    !isNonEmptyString(item.lessonSlug) ||
    !isNonEmptyString(item.title) ||
    !isNonEmptyString(item.classId) ||
    !isNonEmptyString(item.className) ||
    !isReturnedStatus(item.status)
  ) {
    return null;
  }
  return Object.freeze({
    assignmentId: item.assignmentId,
    title: item.title,
    className: item.className,
    status: item.status,
    lessonSlug: item.lessonSlug,
    classId: item.classId,
  });
}

export type AssignmentsTeacherListCallable = () => Promise<
  ReadonlyArray<AssignmentDetailMetadata>
>;

// Hydrate the session-scoped registry from the certified retrieval path.
// Failure is calm: an error resolves silently so the workspace still
// renders and current-session publication still populates the registry
// through the Sprint 13B publish path.
export async function hydrateAssignmentDetailRegistry(
  registry: AssignmentDetailRegistry,
  list: AssignmentsTeacherListCallable,
): Promise<void> {
  try {
    const items = await list();
    for (const item of items) {
      registry.register(item);
    }
  } catch {
    // Calm degradation. The teacher workspace should never be blocked by
    // enumeration failure; newly published assignments in the current
    // session still register through the Sprint 13B path.
  }
}
