import { FieldValue, type DocumentReference, type Transaction } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  assignmentDocRef,
  attemptsCollectionRef,
  classDocRef,
  isTransactionContention,
  log,
  platformCallable,
  requireDistrictContext,
  runFirestoreTransaction,
  type AssessmentAttemptRecord,
  type AssignmentRecord,
  type ClassRecord,
} from "../shared";
import { getAdminFirestore } from "../shared/firestore/admin";
import { authorizeStudentScopedRead } from "../supportAccess/authorize";

import {
  deriveEffectiveAcknowledgment,
  deriveGradeImprovementState,
  type DerivationEvent,
  type GradeImprovementState,
} from "./derive";
import {
  GRADE_IMPROVEMENT_ACKS_COLLECTION,
  GRADE_IMPROVEMENT_EVENTS_SUBCOLLECTION,
  gradeImprovementEventId,
  gradeImprovementRecordId,
  type GradeImprovementAckRecord,
  type GradeImprovementAckRecordWrite,
  type GradeImprovementEffectiveAck,
  type GradeImprovementEventRecord,
  type GradeImprovementEventWrite,
} from "./types";

// Grade Improvements V1 callables.
//
//   gradeImprovementsListForAssignment  { assignmentId }
//   gradeImprovementsListForStudent     { classId, studentId }
//   gradeImprovementsAcknowledge        { assignmentId, studentId, attemptId, percentage }
//   gradeImprovementsReverse            { assignmentId, studentId, eventId }
//
// Authorization (every call): `requireDistrictContext` (authenticated,
// active, canonical claims), role teacher, then the loaded assignment/class
// must be owned by the caller (frozen teacherId + schoolId on both, and
// agreeing with each other). The caller never supplies ownership: any
// teacherId/classId/schoolId/districtId/uid key on an assignment-scoped
// request is refused. Student association is proven by the student's own
// attempt records on that assignment, admitted only when every frozen
// ownership field matches.
//
// Concurrency: acknowledge and reverse run in one Firestore transaction that
// reads the parent record, the full event log, and the assignment's attempts,
// then appends one event with `create` (never overwrite) and updates the
// parent's cached effective acknowledgment. A concurrent writer forces a
// retry that re-derives from the committed state.

const ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,254}[a-zA-Z0-9])?$/;
const EVENT_ID_PATTERN = /^e\d{6}$/;
const OWNERSHIP_KEYS = ["uid", "userId", "teacherId", "schoolId", "districtId"] as const;

type Actor = { readonly uid: string; readonly schoolId: string; readonly districtId: string };
type Owned = {
  readonly assignmentId: string;
  readonly classId: string;
  readonly actor: Actor;
};

function invalid(message: string): never {
  throw new PlatformError("gradeImprovements.invalidRequest", message);
}

function asPayload(data: unknown, forbidden: readonly string[]): Record<string, unknown> {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    invalid("Request payload must be a structured object.");
  }
  const payload = data as Record<string, unknown>;
  for (const key of forbidden) {
    if (key in payload) invalid(`Field "${key}" is not permitted on the request.`);
  }
  return payload;
}

function readId(payload: Record<string, unknown>, key: string, pattern = ID_PATTERN): string {
  const value = payload[key];
  if (typeof value !== "string" || !pattern.test(value)) invalid(`${key} is invalid.`);
  return value;
}

async function requireTeacher(request: CallableRequest<unknown>): Promise<Actor> {
  const context = await requireDistrictContext(request);
  if (context.role !== "teacher") {
    throw new PlatformError("role-forbidden", "Caller must be an active teacher.");
  }
  return { uid: context.uid, schoolId: context.schoolId, districtId: context.districtId };
}

async function loadOwnedClass(classId: string, actor: Actor): Promise<ClassRecord> {
  const snap = await classDocRef(classId).get();
  const data = snap.exists ? snap.data() : undefined;
  if (!data) throw new PlatformError("classes.notFound", "Class was not found.");
  if (data.teacherId !== actor.uid || data.schoolId !== actor.schoolId) {
    throw new PlatformError("classes.forbidden", "Caller does not own this class.");
  }
  return data;
}

// Same ownership chain as `assessmentAssignmentSummary`.
async function loadOwnedAssignment(assignmentId: string, actor: Actor): Promise<Owned> {
  const snap = await assignmentDocRef(assignmentId).get();
  const assignment: AssignmentRecord | undefined = snap.exists ? snap.data() : undefined;
  if (!assignment) throw new PlatformError("assignments.notFound", "Assignment was not found.");
  if (assignment.teacherId !== actor.uid || assignment.schoolId !== actor.schoolId) {
    throw new PlatformError("assignments.forbidden", "Caller does not own this assignment.");
  }
  if (typeof assignment.classId !== "string" || assignment.classId.length === 0) {
    throw new PlatformError("assignments.notFound", "Assignment is missing its class reference.");
  }
  const classRecord = await loadOwnedClass(assignment.classId, actor);
  if (assignment.teacherId !== classRecord.teacherId || assignment.schoolId !== classRecord.schoolId) {
    throw new PlatformError("assignments.notFound", "Assignment ownership is inconsistent.");
  }
  return { assignmentId, classId: assignment.classId, actor };
}

type AttemptEntry = { readonly id: string; readonly data: AssessmentAttemptRecord };

function admitAttempt(owned: Owned, data: AssessmentAttemptRecord | undefined): data is AssessmentAttemptRecord {
  return (
    data !== undefined &&
    data.assignmentId === owned.assignmentId &&
    data.classId === owned.classId &&
    data.teacherId === owned.actor.uid &&
    data.schoolId === owned.actor.schoolId &&
    data.districtId === owned.actor.districtId &&
    typeof data.studentId === "string" &&
    data.studentId.length > 0
  );
}

function groupAttemptsByStudent(
  owned: Owned,
  docs: ReadonlyArray<{ readonly id: string; data: () => AssessmentAttemptRecord | undefined }>,
): Map<string, AttemptEntry[]> {
  const byStudent = new Map<string, AttemptEntry[]>();
  for (const doc of docs) {
    const data = doc.data();
    if (!admitAttempt(owned, data)) continue;
    const bucket = byStudent.get(data.studentId) ?? [];
    bucket.push({ id: doc.id, data });
    byStudent.set(data.studentId, bucket);
  }
  return byStudent;
}

function recordRef(recordId: string): DocumentReference<GradeImprovementAckRecord> {
  return getAdminFirestore()
    .collection(GRADE_IMPROVEMENT_ACKS_COLLECTION)
    .doc(recordId) as DocumentReference<GradeImprovementAckRecord>;
}

function recordWriteRef(recordId: string): DocumentReference<GradeImprovementAckRecordWrite> {
  return recordRef(recordId);
}

function eventsRef(recordId: string) {
  return recordRef(recordId).collection(GRADE_IMPROVEMENT_EVENTS_SUBCOLLECTION);
}

// A stored record is used only when its frozen fields match the authorized
// scope; anything else (including a doc-id collision) is ignored.
function recordMatches(
  data: GradeImprovementAckRecord | undefined,
  scope: { assignmentId?: string; studentId?: string; classId: string; actor: Actor },
): data is GradeImprovementAckRecord {
  return (
    data !== undefined &&
    (scope.assignmentId === undefined || data.assignmentId === scope.assignmentId) &&
    (scope.studentId === undefined || data.studentId === scope.studentId) &&
    data.classId === scope.classId &&
    data.teacherId === scope.actor.uid &&
    data.schoolId === scope.actor.schoolId &&
    data.districtId === scope.actor.districtId
  );
}

// ---------- Wire projections ----------

export type GradeImprovementPending = {
  readonly assignmentId: string;
  readonly studentId: string;
  readonly baselinePercentage: number;
  readonly baselineSource: "firstAttempt" | "acknowledged";
  readonly bestPercentage: number;
  readonly bestAttemptId: string;
};

export type GradeImprovementEventView = {
  readonly eventId: string;
  readonly type: "acknowledged" | "reversed";
  readonly percentage: number;
  readonly attemptId: string;
  readonly baselinePercentage: number | null;
  readonly targetEventId: string | null;
  readonly createdAt: number | null;
  readonly byCaller: boolean;
};

export type GradeImprovementHistory = {
  readonly assignmentId: string;
  readonly studentId: string;
  readonly effective: GradeImprovementEffectiveAck | null;
  // Newest first.
  readonly events: readonly GradeImprovementEventView[];
};

function toPending(assignmentId: string, studentId: string, state: GradeImprovementState): GradeImprovementPending | null {
  if (state.pending === null) return null;
  return { assignmentId, studentId, ...state.pending };
}

function toEventView(e: GradeImprovementEventRecord, callerUid: string): GradeImprovementEventView {
  const ts = e.createdAt as unknown as { toMillis?: () => number } | null;
  return {
    eventId: e.eventId,
    type: e.type,
    percentage: e.percentage,
    attemptId: e.attemptId,
    baselinePercentage: e.baselinePercentage,
    targetEventId: e.targetEventId,
    createdAt: ts && typeof ts.toMillis === "function" ? ts.toMillis() : null,
    byCaller: e.actorTeacherId === callerUid,
  };
}

function newestFirst(events: readonly GradeImprovementEventRecord[]): GradeImprovementEventRecord[] {
  return [...events].sort((a, b) => b.sequence - a.sequence);
}

function admittedEvents(
  docs: ReadonlyArray<{ readonly id: string; data: () => unknown }>,
  record: GradeImprovementAckRecord,
): GradeImprovementEventRecord[] {
  const out: GradeImprovementEventRecord[] = [];
  for (const doc of docs) {
    const e = doc.data() as GradeImprovementEventRecord | undefined;
    if (!e || e.eventId !== doc.id) continue;
    if (e.assignmentId !== record.assignmentId || e.studentId !== record.studentId) continue;
    if (e.type !== "acknowledged" && e.type !== "reversed") continue;
    out.push(e);
  }
  return out;
}

function toDerivation(e: GradeImprovementEventRecord): DerivationEvent {
  return {
    eventId: e.eventId,
    sequence: e.sequence,
    type: e.type,
    percentage: e.percentage,
    attemptId: e.attemptId,
    targetEventId: e.targetEventId,
  };
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

// ---------- gradeImprovementsListForAssignment ----------

export type GradeImprovementsListForAssignmentResponse = {
  readonly assignmentId: string;
  readonly improvements: readonly GradeImprovementPending[];
};

async function listForAssignmentHandler(
  request: CallableRequest<unknown>,
): Promise<GradeImprovementsListForAssignmentResponse> {
  const actor = await requireTeacher(request);
  const payload = asPayload(request.data, [...OWNERSHIP_KEYS, "classId", "studentId"]);
  const owned = await loadOwnedAssignment(readId(payload, "assignmentId"), actor);

  // Assignment-scoped reads only (single-field equality, no composite index).
  const [attemptsSnap, recordsSnap] = await Promise.all([
    attemptsCollectionRef().where("assignmentId", "==", owned.assignmentId).get(),
    getAdminFirestore()
      .collection(GRADE_IMPROVEMENT_ACKS_COLLECTION)
      .where("assignmentId", "==", owned.assignmentId)
      .get(),
  ]);

  const effectiveByStudent = new Map<string, GradeImprovementEffectiveAck | null>();
  for (const doc of recordsSnap.docs) {
    const data = doc.data() as GradeImprovementAckRecord | undefined;
    if (!recordMatches(data, { assignmentId: owned.assignmentId, classId: owned.classId, actor })) continue;
    if (doc.id !== gradeImprovementRecordId(data.assignmentId, data.studentId)) continue;
    effectiveByStudent.set(data.studentId, data.effective ?? null);
  }

  const improvements: GradeImprovementPending[] = [];
  for (const [studentId, attempts] of groupAttemptsByStudent(owned, attemptsSnap.docs)) {
    const state = deriveGradeImprovementState(attempts, effectiveByStudent.get(studentId) ?? null);
    const pending = toPending(owned.assignmentId, studentId, state);
    if (pending !== null) improvements.push(pending);
  }
  improvements.sort((a, b) => (a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0));

  safeLog(() =>
    log.info("gradeImprovements.listedForAssignment", {
      actorUserId: actor.uid,
      assignmentId: owned.assignmentId,
      pendingCount: improvements.length,
    }),
  );
  return { assignmentId: owned.assignmentId, improvements };
}

// ---------- gradeImprovementsListForStudent ----------

export type GradeImprovementsListForStudentResponse = {
  readonly classId: string;
  readonly studentId: string;
  readonly records: readonly GradeImprovementHistory[];
};

async function listForStudentHandler(
  request: CallableRequest<unknown>,
): Promise<GradeImprovementsListForStudentResponse> {
  const actor = await requireTeacher(request);
  const payload = asPayload(request.data, [...OWNERSHIP_KEYS, "assignmentId"]);
  const classId = readId(payload, "classId");
  const studentId = readId(payload, "studentId");
  // Student Support Access (PDR-032c): the owner, or a grantee holding an
  // active grant for exactly this (class, student). History only; every
  // write path below stays owner-only. Rows are matched against the class
  // OWNER, while `byCaller` attribution still compares to the caller.
  const access = await authorizeStudentScopedRead(actor, classId, studentId);
  const owner: Actor = { uid: access.ownerTeacherId, schoolId: actor.schoolId, districtId: actor.districtId };

  // Student-scoped read; every row is re-checked against the owned class.
  const recordsSnap = await getAdminFirestore()
    .collection(GRADE_IMPROVEMENT_ACKS_COLLECTION)
    .where("studentId", "==", studentId)
    .get();

  const records: GradeImprovementHistory[] = [];
  for (const doc of recordsSnap.docs) {
    const data = doc.data() as GradeImprovementAckRecord | undefined;
    if (!recordMatches(data, { studentId, classId, actor: owner })) continue;
    if (doc.id !== gradeImprovementRecordId(data.assignmentId, data.studentId)) continue;
    const eventsSnap = await eventsRef(doc.id).get();
    const events = admittedEvents(eventsSnap.docs, data);
    if (events.length === 0) continue;
    records.push({
      assignmentId: data.assignmentId,
      studentId,
      effective: deriveEffectiveAcknowledgment(events.map(toDerivation)),
      events: newestFirst(events).map((e) => toEventView(e, actor.uid)),
    });
  }
  records.sort((a, b) => (a.assignmentId < b.assignmentId ? -1 : a.assignmentId > b.assignmentId ? 1 : 0));
  return { classId, studentId, records };
}

// ---------- Shared transactional core ----------

type TxSnapshot = {
  readonly record: GradeImprovementAckRecord | null;
  readonly events: GradeImprovementEventRecord[];
  readonly attempts: AttemptEntry[];
};

async function readInTransaction(
  tx: Transaction,
  owned: Owned,
  studentId: string,
): Promise<TxSnapshot> {
  const recordId = gradeImprovementRecordId(owned.assignmentId, studentId);
  const recordSnap = await tx.get(recordRef(recordId));
  const eventsSnap = await tx.get(eventsRef(recordId));
  // Student-scoped: only this student's attempts on this occurrence are read
  // (and held) by the transaction. Same equality-only query shape as the
  // passback engine and finalize; no composite index.
  const attemptsSnap = await tx.get(
    attemptsCollectionRef()
      .where("studentId", "==", studentId)
      .where("assignmentId", "==", owned.assignmentId),
  );
  const raw = recordSnap.exists ? recordSnap.data() : undefined;
  let record: GradeImprovementAckRecord | null = null;
  if (raw !== undefined) {
    if (!recordMatches(raw, { assignmentId: owned.assignmentId, studentId, classId: owned.classId, actor: owned.actor })) {
      throw new PlatformError("gradeImprovements.notFound", "Grade improvement record is inconsistent.");
    }
    record = raw;
  }
  const events = record === null ? [] : admittedEvents(eventsSnap.docs, record);
  const attempts = groupAttemptsByStudent(owned, attemptsSnap.docs).get(studentId) ?? [];
  return { record, events, attempts };
}

function appendEvent(
  tx: Transaction,
  owned: Owned,
  studentId: string,
  snapshot: TxSnapshot,
  event: Pick<GradeImprovementEventWrite, "type" | "percentage" | "attemptId" | "baselinePercentage" | "targetEventId">,
): GradeImprovementEventRecord[] {
  const recordId = gradeImprovementRecordId(owned.assignmentId, studentId);
  // eventCount and the stored events must agree; a gap means a corrupted log.
  const priorCount = snapshot.record?.eventCount ?? 0;
  if (priorCount !== snapshot.events.length) {
    throw new PlatformError("gradeImprovements.notFound", "Grade improvement history is inconsistent.");
  }
  const sequence = priorCount + 1;
  const eventId = gradeImprovementEventId(sequence);
  const write: GradeImprovementEventWrite = {
    eventId,
    sequence,
    assignmentId: owned.assignmentId,
    studentId,
    classId: owned.classId,
    schoolId: owned.actor.schoolId,
    districtId: owned.actor.districtId,
    actorTeacherId: owned.actor.uid,
    createdAt: FieldValue.serverTimestamp(),
    ...event,
  };
  const nextEvents: GradeImprovementEventRecord[] = [
    ...snapshot.events,
    { ...write, createdAt: null as unknown as GradeImprovementEventRecord["createdAt"] },
  ];
  const effective = deriveEffectiveAcknowledgment(nextEvents.map(toDerivation));
  // `create` fails if the event id already exists: history is never overwritten.
  tx.create(eventsRef(recordId).doc(eventId) as unknown as DocumentReference<GradeImprovementEventWrite>, write);
  tx.set(recordWriteRef(recordId), {
    assignmentId: owned.assignmentId,
    studentId,
    classId: owned.classId,
    teacherId: owned.actor.uid,
    schoolId: owned.actor.schoolId,
    districtId: owned.actor.districtId,
    eventCount: sequence,
    effective,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return nextEvents;
}

async function runMutation<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  try {
    return await runFirestoreTransaction(fn);
  } catch (err) {
    if (isTransactionContention(err)) {
      throw new PlatformError("gradeImprovements.writeConflict", "Another update was in progress. Please try again.", err);
    }
    throw err;
  }
}

// After a committed append, replace the new event's placeholder `createdAt`
// with the server timestamp Firestore actually stored. Read-only: no second
// write. The append already committed, so a failed or incomplete read is
// logged and the success response is returned with `createdAt: null`
// (never surfaced as a retryable failure that could invite a duplicate).
async function withPersistedTimestamp(
  owned: Owned,
  studentId: string,
  events: GradeImprovementEventRecord[],
): Promise<GradeImprovementEventRecord[]> {
  const created = events[events.length - 1];
  if (created === undefined) return events;
  try {
    const snap = await eventsRef(gradeImprovementRecordId(owned.assignmentId, studentId))
      .doc(created.eventId)
      .get();
    const stored = snap.exists ? (snap.data() as GradeImprovementEventRecord | undefined) : undefined;
    const ts = stored?.createdAt as unknown as { toMillis?: () => number } | null | undefined;
    if (stored !== undefined && ts && typeof ts.toMillis === "function") {
      return [...events.slice(0, -1), { ...created, createdAt: stored.createdAt }];
    }
  } catch {
    // Fall through: the event is committed; only the echo is incomplete.
  }
  safeLog(() =>
    log.warn("gradeImprovements.timestampUnavailable", {
      assignmentId: owned.assignmentId,
      studentId,
      eventId: created.eventId,
    }),
  );
  return events;
}

export type GradeImprovementMutationResponse = {
  readonly status: "acknowledged" | "alreadyAcknowledged" | "reversed" | "alreadyReversed";
  readonly pending: GradeImprovementPending | null;
  readonly history: GradeImprovementHistory;
};

function mutationResponse(
  status: GradeImprovementMutationResponse["status"],
  owned: Owned,
  studentId: string,
  attempts: readonly AttemptEntry[],
  events: readonly GradeImprovementEventRecord[],
): GradeImprovementMutationResponse {
  const effective = deriveEffectiveAcknowledgment(events.map(toDerivation));
  const state = deriveGradeImprovementState(attempts, effective);
  return {
    status,
    pending: toPending(owned.assignmentId, studentId, state),
    history: {
      assignmentId: owned.assignmentId,
      studentId,
      effective,
      events: newestFirst(events).map((e) => toEventView(e, owned.actor.uid)),
    },
  };
}

// ---------- gradeImprovementsAcknowledge ----------

async function acknowledgeHandler(
  request: CallableRequest<unknown>,
): Promise<GradeImprovementMutationResponse> {
  const actor = await requireTeacher(request);
  const payload = asPayload(request.data, [...OWNERSHIP_KEYS, "classId"]);
  const assignmentId = readId(payload, "assignmentId");
  const studentId = readId(payload, "studentId");
  const attemptId = readId(payload, "attemptId");
  const percentage = payload.percentage;
  if (typeof percentage !== "number" || !Number.isFinite(percentage)) invalid("percentage is invalid.");
  const owned = await loadOwnedAssignment(assignmentId, actor);

  const result = await runMutation(async (tx) => {
    const snapshot = await readInTransaction(tx, owned, studentId);
    if (snapshot.attempts.length === 0) {
      throw new PlatformError("gradeImprovements.notFound", "No completed attempts for this student.");
    }
    const effective = deriveEffectiveAcknowledgment(snapshot.events.map(toDerivation));
    // Idempotent: the exact score the teacher confirmed is already in effect
    // (double click, retried request, or a concurrent duplicate). A newer
    // improvement, if any, stays pending.
    if (effective !== null && effective.attemptId === attemptId && effective.percentage === percentage) {
      return { status: "alreadyAcknowledged" as const, events: snapshot.events, attempts: snapshot.attempts };
    }
    const state = deriveGradeImprovementState(snapshot.attempts, effective);
    // Stale: the teacher confirmed a score that is no longer the pending best.
    // Never acknowledge a score the teacher was not shown.
    if (state.pending === null || state.pending.bestAttemptId !== attemptId || state.pending.bestPercentage !== percentage) {
      throw new PlatformError(
        "gradeImprovements.stale",
        "This grade improvement changed. Refresh to see the latest score.",
        undefined,
        state.pending === null
          ? { pending: false }
          : { pending: true, bestPercentage: state.pending.bestPercentage },
      );
    }
    const events = appendEvent(tx, owned, studentId, snapshot, {
      type: "acknowledged",
      percentage,
      attemptId,
      baselinePercentage: state.pending.baselinePercentage,
      targetEventId: null,
    });
    return { status: "acknowledged" as const, events, attempts: snapshot.attempts };
  });

  safeLog(() =>
    log.info("gradeImprovements.acknowledged", {
      actorUserId: actor.uid,
      assignmentId,
      studentId,
      status: result.status,
    }),
  );
  const events =
    result.status === "acknowledged"
      ? await withPersistedTimestamp(owned, studentId, result.events)
      : result.events;
  return mutationResponse(result.status, owned, studentId, result.attempts, events);
}

// ---------- gradeImprovementsReverse ----------

async function reverseHandler(
  request: CallableRequest<unknown>,
): Promise<GradeImprovementMutationResponse> {
  const actor = await requireTeacher(request);
  const payload = asPayload(request.data, [...OWNERSHIP_KEYS, "classId"]);
  const assignmentId = readId(payload, "assignmentId");
  const studentId = readId(payload, "studentId");
  const eventId = readId(payload, "eventId", EVENT_ID_PATTERN);
  const owned = await loadOwnedAssignment(assignmentId, actor);

  const result = await runMutation(async (tx) => {
    const snapshot = await readInTransaction(tx, owned, studentId);
    const target = snapshot.events.find((e) => e.eventId === eventId && e.type === "acknowledged");
    if (target === undefined) {
      throw new PlatformError("gradeImprovements.notFound", "Acknowledgment was not found.");
    }
    // Idempotent: already undone (double click or retried request).
    if (snapshot.events.some((e) => e.type === "reversed" && e.targetEventId === eventId)) {
      return { status: "alreadyReversed" as const, events: snapshot.events, attempts: snapshot.attempts };
    }
    // Only the acknowledgment currently in effect can be undone, so an Undo
    // shown for an older acknowledgment can never cancel a newer one.
    const effective = deriveEffectiveAcknowledgment(snapshot.events.map(toDerivation));
    if (effective === null || effective.eventId !== eventId) {
      throw new PlatformError(
        "gradeImprovements.stale",
        "This grade update changed. Refresh to see the latest history.",
      );
    }
    const events = appendEvent(tx, owned, studentId, snapshot, {
      type: "reversed",
      percentage: target.percentage,
      attemptId: target.attemptId,
      baselinePercentage: null,
      targetEventId: eventId,
    });
    return { status: "reversed" as const, events, attempts: snapshot.attempts };
  });

  safeLog(() =>
    log.info("gradeImprovements.reversed", {
      actorUserId: actor.uid,
      assignmentId,
      studentId,
      status: result.status,
    }),
  );
  const events =
    result.status === "reversed"
      ? await withPersistedTimestamp(owned, studentId, result.events)
      : result.events;
  return mutationResponse(result.status, owned, studentId, result.attempts, events);
}

export const gradeImprovementsListForAssignment = platformCallable(listForAssignmentHandler);
export const gradeImprovementsListForStudent = platformCallable(listForStudentHandler);
export const gradeImprovementsAcknowledge = platformCallable(acknowledgeHandler);
export const gradeImprovementsReverse = platformCallable(reverseHandler);

// Exported for direct testing without the callable wrapper.
export const __gradeImprovementHandlers = {
  listForAssignment: listForAssignmentHandler,
  listForStudent: listForStudentHandler,
  acknowledge: acknowledgeHandler,
  reverse: reverseHandler,
};
