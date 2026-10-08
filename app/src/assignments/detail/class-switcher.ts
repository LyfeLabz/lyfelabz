import type { CurrentForFamily } from "./grade-sync-context";
import type { AssignmentDetailMetadata } from "./types";

// Same-assignment class selector: pure eligibility and target selection for
// the Assignment Detail class switcher. Firebase-free and side-effect free.
//
// A class is offered only when it is one of the teacher's own authorized
// classes (the already-loaded, already-ordered class list), it is `active`,
// it is not the class being viewed, and the session's teacher assignment
// registry (hydrated from `assignmentsTeacherList`, which already collapses
// published occurrences to the canonical Current where one is valid) holds
// at least one PUBLISHED occurrence of the same lesson for it. Matching is by
// canonical `lessonSlug`, never by display title. Drafts and legacy Closed
// records never make a class eligible.
//
// Target selection never guesses between historical occurrences:
//   - exactly one published occurrence -> that occurrence;
//   - more than one (legacy unresolved state, or the in-session registry
//     still holding an occurrence a same-session reassignment superseded)
//     -> the class's canonical Current must be resolved on selection
//     (`chooseCurrentTarget`); anything other than a valid Current present
//     among those occurrences falls back to the class's Assignments list.

export type ClassSwitcherClass = {
  readonly id: string;
  readonly title: string;
  readonly status: string;
};

export type ClassSwitchTarget =
  | { readonly kind: "assignment"; readonly assignmentId: string }
  | {
      readonly kind: "resolveCurrent";
      readonly lessonSlug: string;
      readonly publishedAssignmentIds: ReadonlyArray<string>;
    };

export type ClassSwitchOption = {
  readonly classId: string;
  readonly className: string;
  readonly target: ClassSwitchTarget;
};

// Injected Assignment Detail seam. `options` is synchronous and reads only
// data already in memory (zero network requests); it returns null while the
// class list it depends on has not loaded yet, in which case the surface keeps
// the static class label and re-reads `options` once `ready` settles (when
// supplied). `select` performs the navigation; `isActive` reports whether the
// originating Assignment Detail is still on screen, so a selection whose
// Current lookup resolves after the teacher has moved on does nothing.
export type AssignmentDetailClassSwitcher = {
  readonly options: (
    metadata: AssignmentDetailMetadata,
  ) => ReadonlyArray<ClassSwitchOption> | null;
  readonly ready?: Promise<void>;
  readonly select: (
    option: ClassSwitchOption,
    context: { readonly isActive: () => boolean },
  ) => Promise<void>;
};

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

export function listClassSwitchOptions(input: {
  readonly source: AssignmentDetailMetadata;
  // The teacher's authorized classes in their saved display order.
  readonly classes: ReadonlyArray<ClassSwitcherClass>;
  // The session's teacher assignment registry contents.
  readonly assignments: ReadonlyArray<AssignmentDetailMetadata>;
}): ReadonlyArray<ClassSwitchOption> {
  const lessonSlug = input.source.lessonSlug;
  const sourceClassId = input.source.classId;
  if (!isNonEmptyString(lessonSlug) || !isNonEmptyString(sourceClassId)) {
    return [];
  }
  const options: ClassSwitchOption[] = [];
  const seenClasses = new Set<string>();
  for (const cls of input.classes) {
    if (!isNonEmptyString(cls.id) || !isNonEmptyString(cls.title)) continue;
    if (cls.id === sourceClassId || cls.status !== "active") continue;
    if (seenClasses.has(cls.id)) continue;
    seenClasses.add(cls.id);
    const published: string[] = [];
    for (const meta of input.assignments) {
      if (
        meta.classId === cls.id &&
        meta.lessonSlug === lessonSlug &&
        meta.status === "published" &&
        isNonEmptyString(meta.assignmentId) &&
        isNonEmptyString(meta.title) &&
        isNonEmptyString(meta.className) &&
        !published.includes(meta.assignmentId)
      ) {
        published.push(meta.assignmentId);
      }
    }
    const [only] = published;
    if (only === undefined) continue;
    options.push(
      Object.freeze({
        classId: cls.id,
        className: cls.title,
        target:
          published.length === 1
            ? Object.freeze({ kind: "assignment" as const, assignmentId: only })
            : Object.freeze({
                kind: "resolveCurrent" as const,
                lessonSlug,
                publishedAssignmentIds: Object.freeze([...published]),
              }),
      }),
    );
  }
  return options;
}

// The assignment to open for a `resolveCurrent` target, or null when the
// class must fall back to its Assignments list: Current unknown, unresolved,
// invalid, inactive, or naming an assignment that is not one of the class's
// published occurrences in the registry.
export function chooseCurrentTarget(
  publishedAssignmentIds: ReadonlyArray<string>,
  current: CurrentForFamily | null,
): string | null {
  if (current === null || current.resolution !== "valid") return null;
  const id = current.currentAssignmentId;
  if (id === null || !publishedAssignmentIds.includes(id)) return null;
  return id;
}
