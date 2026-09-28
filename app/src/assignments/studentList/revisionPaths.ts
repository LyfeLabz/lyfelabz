import tableJson from "./assessment-revision-paths.json";

// F5.3 Slice 9D (addendum 21.5): revision-bound canonical routing for
// assignment-associated launches.
//
// The table is the build-generated F5.3 Slice 9B revision-to-path table
// (`app/lessons/assessment-revisions/revision-paths.json`), bundled from its
// byte-identical, drift-checked copy beside this file. It maps each
// (lessonSlug, assessmentRevisionId) to the page that displays EXACTLY that
// assessment revision: the unversioned v2 page while a lesson has one
// revision, else that revision's rendition.
//
// AUTHORITY. The revision always comes from the server (the assignment's
// frozen `assessmentRevisionId` on the list item or deep-link resolution).
// This module only maps it to a path; it never chooses, infers, upgrades, or
// substitutes a revision, and there is deliberately no fallback: an unknown
// lesson, an unknown revision, a malformed revision, or a revision of another
// lesson resolves to null, and the caller fails closed (no navigation).

type RevisionPathTable = {
  readonly schemaVersion: number;
  readonly kind: string;
  readonly lessons: Readonly<Record<string, Readonly<Record<string, string>>>>;
};

const TABLE_KIND = "lyfelabz.assessmentRevisionPaths";
const TABLE_SCHEMA_VERSION = 1;
const LESSON_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const table = tableJson as RevisionPathTable;

function own(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

// The canonical page path for exactly (lessonSlug, assessmentRevisionId), or
// null. `source` is injectable for tests; production uses the bundled table.
export function resolveAssessmentRevisionPath(
  lessonSlug: string,
  assessmentRevisionId: unknown,
  source: RevisionPathTable = table,
): string | null {
  if (typeof lessonSlug !== "string" || !LESSON_SLUG_RE.test(lessonSlug)) return null;
  if (typeof assessmentRevisionId !== "string") return null;
  const match = /^assessment_([a-z0-9]+(?:-[a-z0-9]+)*)__r([1-9][0-9]*)$/.exec(assessmentRevisionId);
  if (match === null || match[1] !== lessonSlug) return null;
  if (!source || source.kind !== TABLE_KIND || source.schemaVersion !== TABLE_SCHEMA_VERSION) return null;
  const lessons = source.lessons;
  if (!lessons || typeof lessons !== "object" || !own(lessons, lessonSlug)) return null;
  const revisions = lessons[lessonSlug];
  if (!revisions || typeof revisions !== "object" || !own(revisions, assessmentRevisionId)) return null;
  const path = revisions[assessmentRevisionId];
  // Defense in depth: only the two same-origin shapes the 9B build emits.
  const unversioned = `/app/lessons/lesson_${lessonSlug}.html`;
  const rendition = `/app/lessons/assessment-revisions/lesson_${lessonSlug}__r${match[2]}.html`;
  return path === unversioned || path === rendition ? path : null;
}
