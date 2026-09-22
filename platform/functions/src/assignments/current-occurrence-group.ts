import {
  assignmentDocRef,
  assignmentsCollectionRef,
  assignmentsCurrentDocRef,
  type AssignmentRecord,
} from "../shared";
import {
  isWellFormedAssignmentCurrentRecord,
  resolveValidCurrentAssignmentId,
} from "./resolve-current-assignment";

// Canonical class + lesson occurrence grouping (Sprint 30 reassignment
// model).
//
//   ASSIGNMENT RECORDS ARE HISTORICAL. CURRENT IS OPERATIONAL.
//   ATTEMPTS ARE CUMULATIVE. BEST PERFORMANCE IS CUMULATIVE.
//   CLASSROOM GRADE DESTINATION IS CURRENT.
//
// This module is the ONE definition of "the assignment occurrences related
// to one another by intentional reassignment" and of "which of them is
// operational." Every consumer uses it rather than re-deriving either
// concept:
//   - `assignmentsListForStudent` (one operational tile per class + lesson,
//     plus the related occurrences whose attempts the tile aggregates);
//   - `assessmentSessionsBegin` and `lmsDeepLinkResolve` (a non-operational
//     occurrence of a managed class + lesson can never begin an attempt);
//   - the Classroom grade-passback engine (cumulative best across the
//     group, destination = Current).
//
// Definitions:
//   - Occurrence scope: (classId, lessonSlug, teacherId, schoolId), taken
//     from an assignment record's own frozen, immutable ownership fields.
//     The Current pointer is keyed by (classId, lessonSlug) and validated
//     against teacherId/schoolId, so this is exactly the scope the pointer
//     governs.
//   - Scope state, derived ONLY from the canonical
//     `resolveValidCurrentAssignmentId` result (no fallback selection of any
//     kind: no newest/oldest/most-attempts/grading/publication heuristic):
//       * "valid"      - an authoritative pointer names a published, in-scope
//                        assignment: that assignment is the operational
//                        Current.
//       * "inactive"   - MANAGED BUT NO LONGER OPERATIONAL. The pointer is
//                        well-formed and in scope and names an existing
//                        in-scope assignment, but that assignment is no
//                        longer published (closed/archived). The canonical
//                        resolver reports exactly this state, and only this
//                        state, as `assignmentNotPublished` (every pointer and
//                        scope check has already passed). There is NO
//                        operational assignment: no occurrence is listed or
//                        launchable, and no replacement is chosen.
//       * "unresolved" - LEGACY: no authoritative pointer (missing,
//                        malformed, cross-scope, or naming a missing or
//                        out-of-scope assignment). Every consumer keeps its
//                        pre-existing per-assignment behavior.
//   - Occurrence group (valid or inactive): every assignment record in the
//     same occurrence scope, in any lifecycle status. Drafts carry no
//     attempts; closed and archived occurrences keep their attempts, which
//     is why they remain group members.
//
// Nothing here writes, merges, or rewrites any record. Reads:
//   - Scope state: the canonical resolver's own reads (pointer, then the
//     referenced assignment only when the pointer is present and in scope).
//   - Group enumeration (valid/inactive only): ONE single-field `classId`
//     equality query per class, memoized per loader instance. This is the
//     same query shape `reconcileRecipientsForNewEnrollment`,
//     `loadInitialRecipientPopulation`, and `assignmentsRecipientsReconcile`
//     already use, served by Firestore's automatic single-field index; no
//     composite index is introduced. Lesson and ownership scoping are
//     applied in code.
//   - Inactive only: one re-read of the pointer to learn which assignment it
//     names (the resolver deliberately returns no id for a non-valid
//     result), cross-checked against the enumerated group.

export type OccurrenceScope = {
  readonly classId: string;
  readonly lessonSlug: string;
  readonly teacherId: string;
  readonly schoolId: string;
};

export type AssignmentOccurrence = {
  readonly assignmentId: string;
  readonly record: AssignmentRecord;
};

export function occurrenceScopeOf(
  record: Pick<AssignmentRecord, "classId" | "lessonSlug" | "teacherId" | "schoolId">,
): OccurrenceScope {
  return {
    classId: record.classId,
    lessonSlug: record.lessonSlug,
    teacherId: record.teacherId,
    schoolId: record.schoolId,
  };
}

function inScope(record: AssignmentRecord, scope: OccurrenceScope): boolean {
  return (
    record.classId === scope.classId &&
    record.lessonSlug === scope.lessonSlug &&
    record.teacherId === scope.teacherId &&
    record.schoolId === scope.schoolId
  );
}

export type CurrentScopeState =
  | { readonly state: "valid"; readonly currentAssignmentId: string }
  | { readonly state: "inactive" }
  | { readonly state: "unresolved" };

// Canonical scope state. `districtId` is the caller's verified district
// context; the canonical resolver accepts it for its established actor
// shape but enforces district isolation transitively through `schoolId`
// (see resolve-current-assignment.ts).
export async function resolveCurrentScopeState(
  scope: OccurrenceScope,
  districtId: string,
): Promise<CurrentScopeState> {
  const result = await resolveValidCurrentAssignmentId({ ...scope, districtId });
  if (result.resolution === "valid") {
    return { state: "valid", currentAssignmentId: result.assignmentId };
  }
  if (result.resolution === "assignmentNotPublished") return { state: "inactive" };
  return { state: "unresolved" };
}

// True when this occurrence must not be operational for students because
// its class + lesson is MANAGED by an authoritative Current pointer and this
// occurrence is not the operational Current:
//   - valid Current exists and it is a different assignment (superseded);
//   - or the managed Current is no longer operational ("inactive"): closing
//     Current never resurrects an older occurrence.
// A legacy/unresolved scope is never blocked here, so its existing launch
// behavior is unchanged.
export async function isSupersededOccurrence(
  assignmentId: string,
  record: AssignmentRecord,
  districtId: string,
): Promise<boolean> {
  const scopeState = await resolveCurrentScopeState(
    occurrenceScopeOf(record),
    districtId,
  );
  if (scopeState.state === "valid") {
    return scopeState.currentAssignmentId !== assignmentId;
  }
  return scopeState.state === "inactive";
}

export type ClassAssignmentsLoader = (
  classId: string,
) => Promise<ReadonlyArray<AssignmentOccurrence>>;

// Per-request memoized class enumeration, so several lesson groups in the
// same class cost one query in total.
export function createClassAssignmentsLoader(): ClassAssignmentsLoader {
  const cache = new Map<string, Promise<ReadonlyArray<AssignmentOccurrence>>>();
  return (classId) => {
    const cached = cache.get(classId);
    if (cached) return cached;
    const pending = assignmentsCollectionRef()
      .where("classId", "==", classId)
      .get()
      .then((snapshot) => {
        const out: AssignmentOccurrence[] = [];
        for (const doc of snapshot.docs) {
          const record = doc.data();
          if (record) out.push({ assignmentId: doc.id, record });
        }
        return out;
      });
    cache.set(classId, pending);
    return pending;
  };
}

export type CurrentOccurrenceGroup =
  | {
      readonly resolution: "valid";
      readonly currentAssignmentId: string;
      readonly current: AssignmentOccurrence;
      // Every occurrence in scope, INCLUDING Current, in query order.
      readonly occurrences: ReadonlyArray<AssignmentOccurrence>;
    }
  | {
      // Managed but no longer operational. `currentAssignmentId` is the
      // non-published assignment the authoritative pointer still names, or
      // null if a concurrent pointer change made that unconfirmable (fail
      // closed: still inactive, never unresolved/legacy).
      readonly resolution: "inactive";
      readonly currentAssignmentId: string | null;
      readonly occurrences: ReadonlyArray<AssignmentOccurrence>;
    }
  | { readonly resolution: "unresolved" };

export async function resolveCurrentOccurrenceGroup(
  scope: OccurrenceScope,
  districtId: string,
  loader: ClassAssignmentsLoader = createClassAssignmentsLoader(),
): Promise<CurrentOccurrenceGroup> {
  const scopeState = await resolveCurrentScopeState(scope, districtId);
  if (scopeState.state === "unresolved") return { resolution: "unresolved" };

  const occurrences = (await loader(scope.classId)).filter((o) =>
    inScope(o.record, scope),
  );

  if (scopeState.state === "inactive") {
    const pointerSnapshot = await assignmentsCurrentDocRef(
      scope.classId,
      scope.lessonSlug,
    ).get();
    const pointer = pointerSnapshot.exists ? pointerSnapshot.data() : undefined;
    const named = isWellFormedAssignmentCurrentRecord(pointer)
      ? occurrences.find((o) => o.assignmentId === pointer.assignmentId)
      : undefined;
    return {
      resolution: "inactive",
      currentAssignmentId:
        named !== undefined && named.record.status !== "published"
          ? named.assignmentId
          : null,
      occurrences,
    };
  }

  const currentAssignmentId = scopeState.currentAssignmentId;
  let current = occurrences.find((o) => o.assignmentId === currentAssignmentId);
  if (!current) {
    // The resolver has just validated Current from a live read, and the
    // class query is strongly consistent, so this is not expected. Fail
    // closed: Current stays authoritative (it is re-read directly) rather
    // than the group silently degrading to "unresolved".
    const snapshot = await assignmentDocRef(currentAssignmentId).get();
    const record = snapshot.exists ? snapshot.data() : undefined;
    if (!record || !inScope(record, scope)) {
      return { resolution: "inactive", currentAssignmentId: null, occurrences };
    }
    current = { assignmentId: currentAssignmentId, record };
    occurrences.push(current);
  }
  return { resolution: "valid", currentAssignmentId, current, occurrences };
}
