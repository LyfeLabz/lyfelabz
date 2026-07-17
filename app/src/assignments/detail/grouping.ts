import type { AssignmentDetailMetadata, AssignmentStatus } from "./types";

// Sprint 13C remediation: pure helpers that group registered assignment
// metadata by canonical `lessonSlug`, deduplicate by canonical
// `assignmentId`, and impose a deterministic sort so multiple concurrent
// assignments for the same lesson can be surfaced through a calm
// teacher-facing selection interface. These helpers are firebase-free
// and DOM-free so they can be unit-tested in isolation.
//
// Confidentiality: only teacher-owned assignment metadata is consumed
// (assignmentId, title, className, status, lessonSlug, classId). No
// student, recipient, attempt, or session identifier is inspected.

const STATUS_RANK: Readonly<Record<AssignmentStatus, number>> = Object.freeze({
  published: 0,
  closed: 1,
  draft: 2,
});

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

const isSupportedStatus = (v: unknown): v is AssignmentStatus =>
  v === "published" || v === "closed" || v === "draft";

// A metadata entry is considered valid for surfacing when every field the
// Curriculum selection UI would render is present and well-formed. Invalid
// entries are excluded from choices without silencing valid ones.
export function isValidForSelection(
  meta: AssignmentDetailMetadata,
): boolean {
  return (
    isNonEmptyString(meta.assignmentId) &&
    isNonEmptyString(meta.lessonSlug) &&
    isNonEmptyString(meta.title) &&
    isNonEmptyString(meta.className) &&
    isSupportedStatus(meta.status)
  );
}

// Deterministic comparator. Ordering policy:
//   1. className ascending using a stable locale comparison
//   2. status order: published, closed, draft
//   3. title ascending
//   4. assignmentId ascending (final stable tie-breaker)
export function compareAssignmentsForSelection(
  a: AssignmentDetailMetadata,
  b: AssignmentDetailMetadata,
): number {
  const byClass = a.className.localeCompare(b.className, undefined, {
    sensitivity: "base",
  });
  if (byClass !== 0) return byClass;
  const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (byStatus !== 0) return byStatus;
  const byTitle = a.title.localeCompare(b.title, undefined, {
    sensitivity: "base",
  });
  if (byTitle !== 0) return byTitle;
  if (a.assignmentId < b.assignmentId) return -1;
  if (a.assignmentId > b.assignmentId) return 1;
  return 0;
}

// Group by lessonSlug, dedupe by assignmentId (last write wins on
// duplicate ids, matching the registry's deduplication contract). Invalid
// entries are excluded. Each group's list is sorted deterministically.
export function groupAssignmentsByLesson(
  entries: ReadonlyArray<AssignmentDetailMetadata>,
): Map<string, AssignmentDetailMetadata[]> {
  const byLesson = new Map<string, Map<string, AssignmentDetailMetadata>>();
  for (const entry of entries) {
    if (!isValidForSelection(entry)) continue;
    const slug = entry.lessonSlug as string;
    let bucket = byLesson.get(slug);
    if (bucket === undefined) {
      bucket = new Map<string, AssignmentDetailMetadata>();
      byLesson.set(slug, bucket);
    }
    bucket.set(entry.assignmentId, entry);
  }
  const result = new Map<string, AssignmentDetailMetadata[]>();
  for (const [slug, bucket] of byLesson) {
    const sorted = Array.from(bucket.values()).sort(
      compareAssignmentsForSelection,
    );
    result.set(slug, sorted);
  }
  return result;
}
