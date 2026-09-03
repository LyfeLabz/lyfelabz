import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assessmentSessionCreationDocRef,
  assessmentSessionDocRef,
  assignmentDocRef,
  enrollmentDocRef,
  log,
  parseAssessmentIdFromRevisionId,
  requireDistrictContext,
  writeAuditEvent,
  type AssessmentSessionCreationWrite,
  type AssessmentSessionRecord,
  type AssignmentRecord,
  type EnrollmentRecord,
  type SessionDeliveryFreeze,
} from "../shared";

import { isCanonicalRecipient } from "../assignments/assignment-recipients";
import { resolveBeginDelivery } from "./resolve-begin-delivery";
import { buildBeginDeliveryPorts } from "./begin-delivery-deps";

// Client-supplied request payload for assessmentSessionsBegin per
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §21. The authenticated student
// supplies only the target `assignmentId`; every ownership field on the
// resulting session is server-derived from the referenced assignment
// record (§13) and the caller's verified district context (§17). No
// client-authoritative revision, score, correctness marker, or explanation
// payload is accepted onto a session at any point in its lifecycle.
// F5.2 §4.3/§8 - the client may add exactly one new optional field,
// `launchRef`: the OPAQUE server-issued launch-grant id transported from server
// resolution (§7). It can name no content - the grant's content binding is
// server-written at issuance and the client transports only the id. Every
// authoritative delivery selector (`variantKey`, `presentationRevisionId`,
// `deliveryOutcome`, `outcomeAtIssuance`, a presentation path, an accommodation
// status/level, `configRevision`, `studentId`, grant contents) is a FORBIDDEN
// request key, refused at the boundary (§4.3): delivery identity is
// server-derived, never client-asserted.
export type AssessmentSessionsBeginRequest = {
  readonly assignmentId: string;
  readonly launchRef?: string;
};

// Return payload of a successful session-begin call. `sessionId` is the
// deterministic composite defined in ASSESSMENT_IMPLEMENTATION_CONTRACT.md
// §12 for the first session on this (assignmentId, studentId) pair.
// `alreadyLive` is `true` when the call is a no-op idempotent replay that
// returned the existing Live session per §6 (one Live session per
// (studentId, activityId, classId, assignmentId) tuple), and `false` when
// this call wrote the canonical assessmentSessions/{sessionId} document.
export type AssessmentSessionsBeginResponse = {
  readonly sessionId: string;
  readonly alreadyLive: boolean;
};

const ASSIGNMENT_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;

// First-session ordinal per ASSESSMENT_IMPLEMENTATION_CONTRACT.md §12.
// Multi-session ordinal semantics (new ordinal after archival) require the
// archived-session lifecycle introduced by `assessmentSessionsSweepExpired`
// and `assessmentSessionsRecover`. Both callables are explicitly deferred
// beyond this slice per the sprint scope, so this slice writes only the
// first session for a (studentId, assignmentId) pair. A second Live
// session with an existing ordinal 1 record is refused (see below).
const FIRST_SESSION_ORDINAL = 1;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function assertActiveStudentInDistrict(
  request: CallableRequest<unknown>,
): Promise<{
  readonly uid: string;
  readonly schoolId: string;
  readonly districtId: string;
}> {
  const context = await requireDistrictContext(request);
  if (context.role !== "student") {
    throw new PlatformError(
      "role-forbidden",
      "Caller must be an active student.",
    );
  }
  return {
    uid: context.uid,
    schoolId: context.schoolId,
    districtId: context.districtId,
  };
}

// F5.2 §4.3 forbidden request-shape coverage for begin. Every authoritative
// delivery/presentation selector and every launch-grant content field is
// refused with a request-shape error rather than silently ignored, so a broken
// or tampering client is surfaced immediately and no laundering path exists.
// `launchRef` (the sole new accepted field) is intentionally NOT in this list.
const FORBIDDEN_REQUEST_KEYS: readonly string[] = [
  "variantKey",
  "presentationRevisionId",
  "readingLevel",
  "level",
  "accommodation",
  "presentation",
  "path",
  "deliveryOutcome",
  "outcomeAtIssuance",
  "studentId",
  "configRevision",
  "status",
  "issuedAt",
  "expiresAt",
  "lessonSlug",
  "grantId",
];

function validateRequest(data: unknown): {
  readonly assignmentId: string;
  readonly launchRef?: string;
} {
  if (data === null || typeof data !== "object") {
    throw new PlatformError(
      "assessmentSessions.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
  for (const key of FORBIDDEN_REQUEST_KEYS) {
    if (key in payload) {
      throw new PlatformError(
        "assessmentSessions.invalidRequest",
        `Server-owned field "${key}" is not permitted on the request.`,
      );
    }
  }
  if (!isNonEmptyString(payload.assignmentId)) {
    throw new PlatformError(
      "assessmentSessions.invalidAssignmentId",
      "assignmentId must be a non-empty string.",
    );
  }
  const assignmentId = payload.assignmentId.trim();
  if (!ASSIGNMENT_ID_PATTERN.test(assignmentId)) {
    throw new PlatformError(
      "assessmentSessions.invalidAssignmentId",
      "assignmentId must be a URL-safe token.",
    );
  }

  // The optional opaque launch reference. Only its SHAPE is checked here (a
  // present-but-non-string or empty value is a request-shape error). Its FORMAT
  // and validity (unknown/forged/expired/mismatched) are decided at consumption
  // by the grant validator, which returns the stable `LAUNCH_REF_INVALID` /
  // `LAUNCH_REF_EXPIRED` codes rather than a generic request error.
  let launchRef: string | undefined;
  if ("launchRef" in payload && payload.launchRef !== undefined) {
    if (!isNonEmptyString(payload.launchRef)) {
      throw new PlatformError(
        "assessmentSessions.invalidRequest",
        "launchRef must be a non-empty string when present.",
      );
    }
    launchRef = payload.launchRef.trim();
  }

  return launchRef === undefined ? { assignmentId } : { assignmentId, launchRef };
}

async function loadAssignment(assignmentId: string): Promise<AssignmentRecord> {
  const snapshot = await assignmentDocRef(assignmentId).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "assignment-not-found",
      "Referenced assignment was not found.",
    );
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError(
      "assignment-not-found",
      "Referenced assignment record was empty.",
    );
  }
  return data;
}

async function loadActiveEnrollment(
  classId: string,
  studentId: string,
): Promise<EnrollmentRecord> {
  const id = `${classId}__${studentId}`;
  const snapshot = await enrollmentDocRef(id).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "enrollment-inactive",
      "Caller is not enrolled in the referenced class.",
    );
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError(
      "enrollment-inactive",
      "Caller is not enrolled in the referenced class.",
    );
  }
  if (data.status !== "active") {
    throw new PlatformError(
      "enrollment-inactive",
      "Caller is not actively enrolled in the referenced class.",
    );
  }
  return data;
}

// Availability + close-window enforcement per
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §17 and §21. `assessmentSessionsBegin`
// refuses when the assignment has not become available yet, and refuses
// when the window is closed (no grace period applies at begin time - the
// grace period governs finalize of a session that was Live at the close
// moment, per §7 and §17). Every refusal identifier below is drawn from
// the certified refusal set (§25).
function assertAssignmentBeginWindow(assignment: AssignmentRecord): void {
  const now = Timestamp.now();

  if (assignment.availableAt && assignment.availableAt.toMillis() > now.toMillis()) {
    throw new PlatformError(
      "assignment-window-closed",
      "Assignment is not yet available.",
    );
  }
  if (
    assignment.windowClosesAt &&
    assignment.windowClosesAt.toMillis() <= now.toMillis()
  ) {
    throw new PlatformError(
      "assignment-window-closed",
      "Assignment window has closed.",
    );
  }
}

// Deterministic session identifier for the first session on a
// (assignmentId, studentId) pair per
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §12. Uniqueness is enforced at the
// write boundary without a hot document or a transactional query.
// Ordinal-bearing successor sessions (created after archival) will be
// produced by a later slice.
export function sessionIdFor(
  assignmentId: string,
  studentId: string,
  sessionOrdinal: number = FIRST_SESSION_ORDINAL,
): string {
  return `${assignmentId}__${studentId}__${sessionOrdinal}`;
}

// Denormalized assessment identifiers per
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §12 (`assessment_{activityId}`).
// The scorable-content revision is not derived here: the referenced
// assignment carries a frozen `assessmentRevisionId` stamped at
// publication by `assignmentsPublish` from the currently deployed
// revision of the referenced assessment. The identifier grammar is owned
// by `shared/assessment-identifiers.ts`; the parent `assessmentId` and
// the deployment-side `activityId` (equal to `lessonSlug` in v1) are
// derived from the frozen revision identifier, so no site outside the
// shared helper reconstructs identifier structure.
type DerivedAssessmentIdentifiers = {
  readonly activityId: string;
  readonly assessmentId: string;
  readonly assessmentRevisionId: string;
};

function deriveAssessmentIdentifiersFromAssignment(
  assignment: AssignmentRecord,
): DerivedAssessmentIdentifiers {
  const assessmentRevisionId = assignment.assessmentRevisionId;
  if (
    typeof assessmentRevisionId !== "string" ||
    assessmentRevisionId.length === 0
  ) {
    throw new PlatformError(
      "assignment-not-published",
      "Assignment is missing its frozen assessmentRevisionId.",
    );
  }
  const assessmentId = parseAssessmentIdFromRevisionId(assessmentRevisionId);
  if (assessmentId === undefined) {
    throw new PlatformError(
      "assignment-not-published",
      "Assignment carries a non-canonical assessmentRevisionId.",
    );
  }
  return {
    activityId: assignment.lessonSlug,
    assessmentId,
    assessmentRevisionId,
  };
}

function existingMatchesRequest(
  existing: AssessmentSessionRecord,
  actor: { uid: string; schoolId: string; districtId: string },
  assignmentId: string,
  assignment: AssignmentRecord,
  derived: DerivedAssessmentIdentifiers,
): boolean {
  if (existing.status !== "live") return false;
  if (existing.studentId !== actor.uid) return false;
  if (existing.assignmentId !== assignmentId) return false;
  if (existing.schoolId !== actor.schoolId) return false;
  if (existing.districtId !== actor.districtId) return false;
  if (existing.classId !== assignment.classId) return false;
  if (existing.teacherId !== assignment.teacherId) return false;
  if (existing.activityId !== derived.activityId) return false;
  if (existing.assessmentId !== derived.assessmentId) return false;
  if (existing.assessmentRevisionId !== derived.assessmentRevisionId) {
    return false;
  }
  if (existing.sessionOrdinal !== FIRST_SESSION_ORDINAL) return false;
  return true;
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

// assessmentSessionsBegin
//
// Canonical initialization of the assessment-attempt lifecycle per
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §6, §11, §12, §17, §21 (PDR-026).
// Callable by an authenticated student whose canonical custom claims
// (`{ role, schoolId, districtId }`) resolve to an active student in the
// same district as the referenced assignment. This slice writes only the
// initialization document; autosave, resume, sweep, recover, purge, and
// the finalize/scorer transaction that produces attempts/{attemptId} are
// deferred to later Sprint 11C slices.
//
// Ownership fields are server-derived and frozen at session creation:
//   - `studentId` is the caller's uid
//   - `classId`, `teacherId`, and `schoolId` are denormalized from the
//     referenced assignment record per §13
//   - `districtId` is the caller's verified district per PDR-025 §6, §17
//     and is cross-checked against the assignment's school through the
//     shared schoolId invariant (a same-school target is a same-district
//     target under PDR-025 §10)
//   - `activityId`, `assessmentId`, and `assessmentRevisionId` are derived
//     deterministically from the assignment's frozen lesson identity per
//     §12 and §9
//
// Every side effect flows through the canonical shared helpers:
//   - assignment read via `assignmentDocRef(...).get()`                      (typed ref)
//   - enrollment read via `enrollmentDocRef(...).get()`                      (typed ref)
//   - existing-record read via `assessmentSessionDocRef(...).get()`          (typed ref)
//   - creation write via `assessmentSessionCreationDocRef(...).set(...)`     (typed ref)
//   - audit event via `writeAuditEvent({ action: "assessment.sessionBegan" })`
//
// The assignment must be `published` and in `classroom` mode; a `practice`
// assignment is client-only per Cloud Function Charter §2.5 and never
// produces a session (§17). Cross-district targets are rejected via the
// same-schoolId invariant per PDR-025 §10.
//
// Idempotency (§6 one-Live-session invariant): a Live session already
// owned by the caller for the same (studentId, assignmentId) pair with
// matching canonical fields returns `alreadyLive: true` with no second
// write and no second audit event. Every other conflict is rejected with
// `assessmentSessions.conflict`.
async function assessmentSessionsBeginHandler(
  request: CallableRequest<unknown>,
): Promise<AssessmentSessionsBeginResponse> {
  const actor = await assertActiveStudentInDistrict(request);
  const input = validateRequest(request.data);

  const assignment = await loadAssignment(input.assignmentId);

  if (assignment.schoolId !== actor.schoolId) {
    throw new PlatformError(
      "assessmentSessions.forbidden",
      "Caller does not have access to this assignment.",
    );
  }
  if (assignment.mode !== "classroom") {
    throw new PlatformError(
      "assignment-mode-invalid",
      "Sessions are only recorded for classroom-mode assignments.",
    );
  }
  if (assignment.status === "closed") {
    throw new PlatformError(
      "assignment-window-closed",
      "Assignment is closed to new sessions.",
    );
  }
  if (assignment.status !== "published") {
    throw new PlatformError(
      "assignment-not-published",
      "Sessions may only be created against a published assignment.",
    );
  }

  assertAssignmentBeginWindow(assignment);

  await loadActiveEnrollment(assignment.classId, actor.uid);

  // PDR-029l recipient enforcement. Assignment-linked session creation
  // requires the caller to be a canonical recipient of the target
  // assignment. Recipient membership is server-authoritative via the
  // frozen `assignments/{assignmentId}/recipients/{studentId}` document
  // (Sprint 12E Slice 2A) and no client-supplied ownership value
  // participates. Fails closed on any anomaly (missing, malformed,
  // wrong-owner, non-`assigned`) with the narrow refusal identifier so no
  // session is created and no audit event is emitted.
  const recipientOk = await isCanonicalRecipient(
    {
      assignmentId: input.assignmentId,
      studentId: actor.uid,
      schoolId: actor.schoolId,
      districtId: actor.districtId,
    },
    (ref) => ref.get(),
  );
  if (!recipientOk) {
    throw new PlatformError(
      "assessmentSessions.recipientRequired",
      "Caller is not a recipient of the referenced assignment.",
    );
  }

  const derived = deriveAssessmentIdentifiersFromAssignment(assignment);
  const { activityId, assessmentId, assessmentRevisionId } = derived;

  const sessionId = sessionIdFor(input.assignmentId, actor.uid);
  const existingSnapshot = await assessmentSessionDocRef(sessionId).get();
  if (existingSnapshot.exists) {
    const existing = existingSnapshot.data();
    if (
      existing &&
      existingMatchesRequest(
        existing,
        actor,
        input.assignmentId,
        assignment,
        derived,
      )
    ) {
      // §8.2 step 1 - idempotency first. An existing Live session is returned
      // as-is; its frozen presentation/delivery fields never change and a
      // supplied `launchRef` is IGNORED (never re-validated, never joins the
      // request-match comparison). Repeated begin cannot mutate a frozen
      // session, so grant replay within TTL is harmless.
      safeLog(() =>
        log.info("assessmentSessions.beginIdempotent", {
          actorUserId: actor.uid,
          sessionId,
        }),
      );
      return { sessionId, alreadyLive: true };
    }
    throw new PlatformError(
      "assessmentSessions.conflict",
      "A session for this assignment and student already exists.",
    );
  }

  // Slice 6 authoritative delivery freeze (§8). AFTER the full existing
  // authorization chain and the idempotency check, and BEFORE the create, the
  // server derives the durable `deliveryOutcome` (and, iff differentiated, the
  // exact presentation pair) from a validated launch grant or the no-ref
  // legitimacy check. This is the single freeze point: the value is computed
  // here and written once by the create below, and never changes thereafter for
  // this session. A refusal (BEGIN_REQUIRES_LAUNCH, LAUNCH_REF_INVALID,
  // LAUNCH_REF_EXPIRED, BEGIN_VALIDATION_UNAVAILABLE) throws BEFORE the create,
  // so no session and no attempt are ever produced on a refused begin. The
  // grant is never re-resolved against the current index (the A->B invariant),
  // and the no-ref coverage check never selects a revision.
  const delivery: SessionDeliveryFreeze = await resolveBeginDelivery(
    buildBeginDeliveryPorts(),
    {
      studentId: actor.uid,
      assignmentId: input.assignmentId,
      lessonSlug: assignment.lessonSlug,
      launchRef: input.launchRef,
    },
  );

  const creation: AssessmentSessionCreationWrite = {
    studentId: actor.uid,
    assignmentId: input.assignmentId,
    classId: assignment.classId,
    teacherId: assignment.teacherId,
    schoolId: assignment.schoolId,
    districtId: actor.districtId,
    activityId,
    assessmentId,
    assessmentRevisionId,
    sessionOrdinal: FIRST_SESSION_ORDINAL,
    status: "live",
    startedAt: FieldValue.serverTimestamp(),
    ...delivery,
  };

  // Sprint 11D I-3. Use `create` (server-enforced "must-not-exist"
  // precondition) rather than `set` to eliminate the read/write race
  // between the pre-check `assessmentSessionDocRef(sessionId).get()`
  // above and this write. Two concurrent begin calls for the same
  // deterministic sessionId will both observe `exists === false` at the
  // pre-check; without `create` semantics the second write would
  // silently overwrite the first-committed session. `create` refuses the
  // second write at the write boundary; we translate that specific
  // `ALREADY_EXISTS` failure into the canonical
  // `assessmentSessions.conflict` refusal so the caller sees the same
  // identifier they would have seen on a mid-check-only conflict.
  try {
    await assessmentSessionCreationDocRef(sessionId).create(creation);
  } catch (err) {
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in (err as Record<string, unknown>) &&
      ((err as { code?: unknown }).code === 6 ||
        (err as { code?: unknown }).code === "already-exists")
    ) {
      throw new PlatformError(
        "assessmentSessions.conflict",
        "A session for this assignment and student already exists.",
      );
    }
    throw err;
  }

  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "student",
    action: "assessment.sessionBegan",
    targetType: "assessmentSession",
    targetId: sessionId,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
    payload: {
      assignmentId: input.assignmentId,
      classId: assignment.classId,
      activityId,
      assessmentId,
      assessmentRevisionId,
      sessionOrdinal: FIRST_SESSION_ORDINAL,
      districtId: actor.districtId,
    },
  });

  safeLog(() =>
    log.info("assessmentSessions.began", {
      actorUserId: actor.uid,
      sessionId,
      assignmentId: input.assignmentId,
    }),
  );

  return { sessionId, alreadyLive: false };
}

export const assessmentSessionsBegin = platformCallable(assessmentSessionsBeginHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assessmentSessionsBeginHandler = assessmentSessionsBeginHandler;
