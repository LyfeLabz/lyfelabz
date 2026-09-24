import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assignmentDocRef,
  assignmentRecipientsCollectionGroupRef,
  assessmentSessionsCollectionRef,
  classDocRef,
  log,
  requireDistrictContext,
  type AssessmentSessionRecord,
  type AssignmentRecipientRecord,
  type AssignmentRecord,
  type ClassRecord,
} from "../shared";
import {
  createClassAssignmentsLoader,
  occurrenceScopeOf,
  resolveCurrentOccurrenceGroup,
} from "../assignments/current-occurrence-group";

// Student Progress & Assignment Membership, Phase A Slice 4: certified
// enumeration of the assignment instances one specific, teacher-owned
// student is an expected recipient of within one teacher-owned class, plus
// whether each currently has a live (in-progress) assessment session.
//
// Purpose: the teacher-facing Student Detail surface previously derived its
// entire display from `assessmentAttemptsListForClass`, which is blind to
// any assignment a student has never attempted. A student with assigned but
// unstarted work therefore looked identical to a student with no assigned
// work at all. This callable supplies the missing half: the set of
// assignments the student is actually expected to complete, independent of
// whether they have attempted anything.
//
// Confidentiality boundary (intentionally the narrowest surface that
// answers the question): the response carries only `assignmentId` and a
// boolean `hasLiveSession`. No score, percentage, answer, session content,
// title, Google/Classroom identifier, or any other PII crosses this
// boundary. "Completed" is deliberately NOT computed or asserted here — the
// client already derives completion from the certified
// `assessmentAttemptsListForClass` result it separately fetches, so this
// callable never invents a second, competing definition of "completed."
//
// Authorization mirrors `assessmentAttemptsListForClass` /
// `enrollmentsListForClass`: active-teacher role, owning teacher, same
// school, district boundary via `requireDistrictContext`, then explicit
// class ownership verification before any recipient or session data is
// read. `studentId` is a required input (unlike the class-scoped siblings,
// which forbid it) because this callable is one of the few that legitimately
// names a specific student on behalf of the owning teacher, exactly as
// `assignmentsRecipientAdd` and `assignmentsRecipientCandidatesList` already
// do. A `studentId` outside this teacher's class yields an empty result,
// never an error, so no cross-owner existence information leaks.
//
// Query shape: a single collection-group query on `recipients` filtered by
// `studentId`, reusing the collection-group index already declared in
// `firestore.indexes.json` for the certified student-facing
// `assignmentsListForStudent` callable — no new index is introduced. Session
// liveness is read with a single `classId`-scoped query on
// `assessmentSessions`, the same single-field-equality shape
// `assessmentAttemptsListForClass` already uses against `attempts`. Every
// candidate assignment is additionally re-loaded and cross-checked against
// its own record (mirrors `assignments-list-for-student.ts`'s
// `loadAssignmentIfVisible`) so a stale or malformed recipient row can never
// be amplified into a client-visible result.

export type AssessmentStudentAssignmentsForClassRequest = {
  readonly classId: string;
  readonly studentId: string;
};

export type AssessmentStudentExpectedAssignment = {
  readonly assignmentId: string;
  readonly hasLiveSession: boolean;
};

// Reassignment model (additive): the student's work grouped by class +
// lesson through the ONE canonical occurrence-grouping primitive
// (`resolveCurrentOccurrenceGroup`, shared with My Science, launch gating,
// and Classroom passback). Student Detail renders one card per group:
//   - "valid"      - one card for the class + lesson. The operational
//                    assignment is Current; `assignmentIds` lists EVERY
//                    occurrence in the group (Current included), so the
//                    student's attempts on any of them form the card's
//                    cumulative history. Title / status / publishedAt /
//                    hasLiveSession describe Current.
//   - "inactive"   - managed Current closed/archived: one history-only card,
//                    `operationalAssignmentId` null, never launchable, and
//                    no older occurrence is resurrected. Title / status /
//                    publishedAt describe the closed Current the pointer
//                    names (null when that cannot be confirmed).
//   - "unresolved" - legacy (no authoritative pointer, including a
//                    malformed / cross-scope / missing one): NO grouping. One
//                    entry per assignment, exactly one id in
//                    `assignmentIds`.
// Only ids, the teacher's own assignment title, lifecycle status, and
// publication time cross this boundary - nothing about any other student.
export type AssessmentStudentAssignmentGroupResolution =
  | "valid"
  | "inactive"
  | "unresolved";

export type AssessmentStudentAssignmentGroup = {
  readonly resolution: AssessmentStudentAssignmentGroupResolution;
  readonly lessonSlug: string;
  // valid: Current; unresolved: the assignment itself; inactive: null.
  readonly operationalAssignmentId: string | null;
  readonly assignmentIds: readonly string[];
  readonly title: string | null;
  readonly status: string | null;
  readonly publishedAt: number | null;
  // Live session on the operational assignment only (always false when
  // inactive).
  readonly hasLiveSession: boolean;
  // Whether the student is an expected recipient of the operational
  // assignment (false when inactive).
  readonly isOperationalRecipient: boolean;
};

export type AssessmentStudentAssignmentsForClassResponse = {
  readonly classId: string;
  readonly studentId: string;
  readonly assignments: readonly AssessmentStudentExpectedAssignment[];
  readonly groups: readonly AssessmentStudentAssignmentGroup[];
};

const TOKEN_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;

// Every one of these is derived server-side from the class record, the
// recipient population, or the verified district context; a client that
// supplies any of them is refused so no laundering path can suggest
// cross-owner access or a spoofed scope. `studentId` is intentionally NOT
// forbidden here - see the header comment.
const FORBIDDEN_REQUEST_KEYS: readonly string[] = [
  "uid",
  "userId",
  "districtId",
  "schoolId",
  "teacherId",
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function assertActiveTeacherInDistrict(
  request: CallableRequest<unknown>,
): Promise<{
  readonly uid: string;
  readonly schoolId: string;
  readonly districtId: string;
}> {
  const context = await requireDistrictContext(request);
  if (context.role !== "teacher") {
    throw new PlatformError(
      "role-forbidden",
      "Caller must be an active teacher.",
    );
  }
  return {
    uid: context.uid,
    schoolId: context.schoolId,
    districtId: context.districtId,
  };
}

function validateRequest(
  data: unknown,
): AssessmentStudentAssignmentsForClassRequest {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new PlatformError(
      "assessmentStudentAssignments.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
  for (const key of FORBIDDEN_REQUEST_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      throw new PlatformError(
        "assessmentStudentAssignments.invalidRequest",
        `Request payload must not include ${key}.`,
      );
    }
  }
  if (!isNonEmptyString(payload.classId)) {
    throw new PlatformError(
      "classes.invalidClassId",
      "classId must be a non-empty string.",
    );
  }
  const classId = payload.classId.trim();
  if (!TOKEN_PATTERN.test(classId)) {
    throw new PlatformError(
      "classes.invalidClassId",
      "classId must be a URL-safe token.",
    );
  }
  if (!isNonEmptyString(payload.studentId)) {
    throw new PlatformError(
      "assessmentStudentAssignments.invalidStudentId",
      "studentId must be a non-empty string.",
    );
  }
  const studentId = payload.studentId.trim();
  if (!TOKEN_PATTERN.test(studentId)) {
    throw new PlatformError(
      "assessmentStudentAssignments.invalidStudentId",
      "studentId must be a URL-safe token.",
    );
  }
  return { classId, studentId };
}

async function loadOwnedClass(
  classId: string,
  actor: { readonly uid: string; readonly schoolId: string },
): Promise<ClassRecord> {
  const snapshot = await classDocRef(classId).get();
  if (!snapshot.exists) {
    throw new PlatformError("classes.forbidden", "Class was not found.");
  }
  const data = snapshot.data();
  if (
    !data ||
    data.teacherId !== actor.uid ||
    data.schoolId !== actor.schoolId
  ) {
    throw new PlatformError(
      "classes.forbidden",
      "Caller does not own this class.",
    );
  }
  return data;
}

// A minimal internal projection of the recipient record used to gate the
// candidate assignment set. Every field is required and cross-checked
// against the verified district context and the loaded class's ownership;
// any mismatch is a silent drop consistent with the defense-in-depth
// filtering pattern used throughout this domain.
function isVisibleRecipient(
  doc: { readonly id: string },
  record: AssignmentRecipientRecord | undefined,
  input: { readonly classId: string; readonly studentId: string },
  actor: {
    readonly uid: string;
    readonly schoolId: string;
    readonly districtId: string;
  },
): record is AssignmentRecipientRecord {
  if (!record) return false;
  if (doc.id !== record.studentId) return false;
  if (record.studentId !== input.studentId) return false;
  if (record.classId !== input.classId) return false;
  if (record.teacherId !== actor.uid) return false;
  if (record.schoolId !== actor.schoolId) return false;
  if (record.districtId !== actor.districtId) return false;
  if (record.status !== "assigned") return false;
  if (!isNonEmptyString(record.assignmentId)) return false;
  return true;
}

// Defense-in-depth re-verification of a candidate assignment against its own
// record, mirroring `loadAssignmentIfVisible` in
// `assignments-list-for-student.ts`. A divergence between the recipient
// snapshot and the live assignment record indicates a data-invariant
// violation the retrieval layer must not amplify, so it is a silent drop.
async function loadAssignmentIfStillOwned(
  assignmentId: string,
  input: { readonly classId: string },
  actor: { readonly uid: string; readonly schoolId: string },
): Promise<AssignmentRecord | null> {
  let snap: Awaited<ReturnType<ReturnType<typeof assignmentDocRef>["get"]>>;
  try {
    snap = await assignmentDocRef(assignmentId).get();
  } catch {
    return null;
  }
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  if (data.classId !== input.classId) return null;
  if (data.teacherId !== actor.uid) return null;
  if (data.schoolId !== actor.schoolId) return null;
  return data;
}

function publishedAtMillis(record: AssignmentRecord | undefined): number | null {
  const ts = record?.publishedAt as { toMillis?: () => number } | undefined;
  if (ts === undefined || typeof ts.toMillis !== "function") return null;
  const ms = ts.toMillis();
  return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
}

function describeRecord(record: AssignmentRecord | undefined): {
  readonly title: string | null;
  readonly status: string | null;
  readonly publishedAt: number | null;
} {
  return {
    title: isNonEmptyString(record?.title) ? record.title : null,
    status: record?.status ?? null,
    publishedAt: publishedAtMillis(record),
  };
}

// Group the student's verified recipient assignments by occurrence scope
// (class + lesson + owning teacher + school) and resolve each scope through
// the canonical primitive. Never selects a Current: a scope without an
// authoritative pointer stays one entry per assignment.
async function buildGroups(
  verified: ReadonlyMap<string, AssignmentRecord>,
  liveSessionAssignmentIds: ReadonlySet<string>,
  districtId: string,
): Promise<AssessmentStudentAssignmentGroup[]> {
  const buckets = new Map<string, Array<{ id: string; record: AssignmentRecord }>>();
  for (const [id, record] of verified) {
    const scope = occurrenceScopeOf(record);
    const key = [scope.classId, scope.lessonSlug, scope.teacherId, scope.schoolId].join("\u0000");
    const bucket = buckets.get(key);
    if (bucket) bucket.push({ id, record });
    else buckets.set(key, [{ id, record }]);
  }

  const unresolvedEntry = (id: string, record: AssignmentRecord): AssessmentStudentAssignmentGroup => ({
    resolution: "unresolved",
    lessonSlug: record.lessonSlug,
    operationalAssignmentId: id,
    assignmentIds: [id],
    ...describeRecord(record),
    hasLiveSession: liveSessionAssignmentIds.has(id),
    isOperationalRecipient: true,
  });

  const loader = createClassAssignmentsLoader();
  const perBucket = await Promise.all(
    Array.from(buckets.values()).map(async (bucket) => {
      const first = bucket[0];
      if (first === undefined) return [];
      const group = await resolveCurrentOccurrenceGroup(
        occurrenceScopeOf(first.record),
        districtId,
        loader,
      );
      if (group.resolution === "unresolved") {
        return bucket.map((m) => unresolvedEntry(m.id, m.record));
      }
      const groupIds = new Set(group.occurrences.map((o) => o.assignmentId));
      // Defensive: a verified recipient assignment the group enumeration
      // did not see is never folded in by guesswork; it keeps its own entry.
      const strays = bucket
        .filter((m) => !groupIds.has(m.id))
        .map((m) => unresolvedEntry(m.id, m.record));
      const assignmentIds = Array.from(groupIds).sort();
      if (group.resolution === "inactive") {
        const named =
          group.currentAssignmentId === null
            ? undefined
            : group.occurrences.find((o) => o.assignmentId === group.currentAssignmentId);
        const entry: AssessmentStudentAssignmentGroup = {
          resolution: "inactive",
          lessonSlug: first.record.lessonSlug,
          operationalAssignmentId: null,
          assignmentIds,
          ...describeRecord(named?.record),
          hasLiveSession: false,
          isOperationalRecipient: false,
        };
        return [entry, ...strays];
      }
      const entry: AssessmentStudentAssignmentGroup = {
        resolution: "valid",
        lessonSlug: first.record.lessonSlug,
        operationalAssignmentId: group.currentAssignmentId,
        assignmentIds,
        ...describeRecord(group.current.record),
        hasLiveSession: liveSessionAssignmentIds.has(group.currentAssignmentId),
        isOperationalRecipient: verified.has(group.currentAssignmentId),
      };
      return [entry, ...strays];
    }),
  );
  return perBucket
    .flat()
    .sort((a, b) => {
      const ka = a.operationalAssignmentId ?? a.assignmentIds[0] ?? "";
      const kb = b.operationalAssignmentId ?? b.assignmentIds[0] ?? "";
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

async function assessmentStudentAssignmentsForClassHandler(
  request: CallableRequest<unknown>,
): Promise<AssessmentStudentAssignmentsForClassResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  await loadOwnedClass(input.classId, actor);

  // Canonical query: enumerate every recipient document for the requested
  // student across every assignment, scoped to this class and this
  // teacher's ownership after the read. Reuses the collection-group index
  // already declared for `assignmentsListForStudent`; no new index is
  // introduced.
  // The class-scoped session query is independent of the recipient work,
  // so the two run concurrently; session results are only ever filtered
  // against the verified candidate set below.
  const [recipientSnapshot, sessionsSnapshot] = await Promise.all([
    assignmentRecipientsCollectionGroupRef()
      .where("studentId", "==", input.studentId)
      .get(),
    assessmentSessionsCollectionRef()
      .where("classId", "==", input.classId)
      .get(),
  ]);

  const candidateAssignmentIds = new Set<string>();
  for (const doc of recipientSnapshot.docs) {
    const data = doc.data() as AssignmentRecipientRecord | undefined;
    if (!isVisibleRecipient(doc, data, input, actor)) continue;
    candidateAssignmentIds.add(data.assignmentId);
  }

  const verifiedRecords = new Map<string, AssignmentRecord>();
  await Promise.all(
    Array.from(candidateAssignmentIds).map(async (assignmentId) => {
      const record = await loadAssignmentIfStillOwned(assignmentId, input, actor);
      if (record !== null) verifiedRecords.set(assignmentId, record);
    }),
  );
  const verified = Array.from(verifiedRecords.keys());

  // The session read above is a single-field equality query on `classId`, the same shape
  // `assessmentAttemptsListForClass` already uses against `attempts` - no
  // new composite index required. Session content (responses, timestamps)
  // is never read into the response; only existence of a `live` session for
  // this student, scoped to a verified candidate assignment, is retained.

  const verifiedSet = new Set(verified);
  const liveSessionAssignmentIds = new Set<string>();
  for (const doc of sessionsSnapshot.docs) {
    const data = doc.data() as AssessmentSessionRecord | undefined;
    if (!data) continue;
    if (data.status !== "live") continue;
    if (data.studentId !== input.studentId) continue;
    if (data.classId !== input.classId) continue;
    if (data.teacherId !== actor.uid) continue;
    if (data.schoolId !== actor.schoolId) continue;
    if (data.districtId !== actor.districtId) continue;
    if (!isNonEmptyString(data.assignmentId)) continue;
    if (!verifiedSet.has(data.assignmentId)) continue;
    liveSessionAssignmentIds.add(data.assignmentId);
  }

  const assignments: AssessmentStudentExpectedAssignment[] = verified
    .slice()
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((assignmentId) => ({
      assignmentId,
      hasLiveSession: liveSessionAssignmentIds.has(assignmentId),
    }));

  const groups = await buildGroups(
    verifiedRecords,
    liveSessionAssignmentIds,
    actor.districtId,
  );

  safeLog(() =>
    log.info("assessmentStudentAssignments.listedForClass", {
      actorUserId: actor.uid,
      classId: input.classId,
      studentId: input.studentId,
      count: assignments.length,
      groups: groups.length,
    }),
  );

  return { classId: input.classId, studentId: input.studentId, assignments, groups };
}

export const assessmentStudentAssignmentsForClass = platformCallable(
  assessmentStudentAssignmentsForClassHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assessmentStudentAssignmentsForClassHandler =
  assessmentStudentAssignmentsForClassHandler;
