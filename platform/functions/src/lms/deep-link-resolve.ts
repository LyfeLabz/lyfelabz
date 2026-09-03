import { Timestamp } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assignmentDocRef,
  createRequestLaunchPresentationResolver,
  enrollmentDocRef,
  log,
  requireDistrictContext,
  writeAuditEvent,
  type AssignmentRecord,
  type EnrollmentRecord,
  type LaunchPresentation,
} from "../shared";

import { isCanonicalRecipient } from "../assignments/assignment-recipients";
import { enrollmentIdFor } from "../enrollments/enrollments-join-by-code";

// lmsDeepLinkResolve
//
// Sprint 27 Phase 4 (blueprint Decision 4; PDR-027 §10, §17). The read-only
// server-side resolver a student's browser invokes after arriving on a
// Google Classroom deep link (`/app/a/{assignmentId}`). It is the sole
// authorized path from a deep-link arrival to an authorized LyfeLabz
// assignment context.
//
// Security posture (PDR-027 §10.3, §19; definition §10):
//   - URL possession is NEVER authorization. The URL carries only an opaque
//     assignmentId; every access decision is made server-side against
//     canonical LyfeLabz state (identity, district, enrollment, recipient).
//   - Read-only against LyfeLabz DOMAIN state. It never creates, mutates, or
//     deletes a session, attempt, assignment, publication, enrollment,
//     recipient, or link record. It writes the append-only
//     `lms.deepLinkResolved` audit event on a successful resolution, and -
//     as authorized by F5.2 §4 Op C (Slice 4) - it may mint a TTL-transient
//     `launchGrants/{grantId}` record for an accommodated student on a launch
//     target. The launch grant is non-domain, non-authoritative presentation
//     EVIDENCE (§7.2), not domain state; PDR-027 §17's domain-write
//     prohibition is preserved. Grant minting is best-effort: any failure
//     degrades to a canonical response (no grant), never blocking the launch.
//   - Classroom-agnostic. It never calls Google Classroom, never reads an
//     OAuth token, and never returns anything derived from the caller's
//     Classroom account or grant.
//   - Session creation remains the sole responsibility of
//     `assessmentSessionsBegin`; the resolver never begins a session. Its
//     authorization is at least as strict as session begin so it can never
//     route a student into a context session begin would immediately refuse.
//
// The resolver returns enough to route correctly and nothing more (PDR-027
// §10.2). It never returns a recipient list, an enrollment list, a teacher
// identity, another student, a Google identifier, OAuth metadata, an answer
// key, a score, or unpublished assessment configuration.

export type LmsDeepLinkResolveRequest = {
  readonly assignmentId: string;
};

// Where the client should route after a successful resolution.
//   - `assignmentLaunch`: an enrolled recipient of a published, open,
//     classroom-mode assignment. The client hands off to the existing
//     assignment-aware launch/runtime (silent arrival, PDR-024h).
//   - `lessonPractice`: a published practice-mode assignment. The client
//     opens the lesson surface without invoking the assessment pipeline.
//   - `informational`: the caller is enrolled but cannot begin an attempt
//     right now (not a recipient, the window is closed, or the assignment is
//     closed). The client shows a calm, non-leaking informational surface.
export type LmsDeepLinkInternalTarget =
  | "assignmentLaunch"
  | "lessonPractice"
  | "informational";

// `authorized` when a new session MAY be begun for this caller by the
// assessment pipeline; `informational` otherwise (PDR-027 §10.2).
export type LmsDeepLinkAttemptContext = "authorized" | "informational";

export type LmsDeepLinkResolveResponse = {
  readonly assignmentId: string;
  readonly classId: string;
  readonly lessonSlug: string;
  readonly internalTarget: LmsDeepLinkInternalTarget;
  readonly attemptContext: LmsDeepLinkAttemptContext;
  // F5.2 §7.1 additive, optional differentiation fields (Slice 4). Present
  // ONLY when server-authoritative resolution (Op C) minted a grant for an
  // accommodated student on a launch target (`assignmentLaunch`/
  // `lessonPractice`):
  //   - `presentation` iff a `differentiated` grant was minted;
  //   - `launchRef` iff any grant was minted (`differentiated` or
  //     `canonicalFallback`).
  // Both are ENTIRELY ABSENT for canonical-expected students (no accommodation
  // / inactive), whose response stays byte-shape-identical to pre-feature
  // behavior. The Slice 4 client ignores both fields; client routing on
  // `presentation.path` and `launchRef` transport are Slice 5/6. The student
  // never asserts either field (see FORBIDDEN_REQUEST_KEYS).
  readonly presentation?: LaunchPresentation;
  readonly launchRef?: string;
};

// Canonical assignment identifier grammar (identical to
// `assessmentSessionsBegin`, `assignmentsRecipientAdd`, and the deep-link URL
// builder). A malformed identifier is refused with `deep-link-shape-invalid`
// (PDR-027 §21) before any read, so a caller cannot probe assignment
// existence with a junk id.
const ASSIGNMENT_ID_PATTERN =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;

// Authority-bearing keys a caller must never assert on this path. Their
// presence is a hard refusal (fail closed) rather than a silent drop, so the
// trust boundary is observable and no laundering path can suggest
// cross-student, cross-class, or cross-district access.
const FORBIDDEN_REQUEST_KEYS: readonly string[] = [
  "studentId",
  "uid",
  "userId",
  "districtId",
  "schoolId",
  "classId",
  "teacherId",
  "recipientId",
  "sessionId",
  // F5.2 §4.3 - differentiation selector fields the student must never assert.
  // Resolution is server-authoritative from the authenticated uid; the client
  // never chooses its presentation, and `launchRef` is response-only on this
  // surface (never accepted here). Presence of any of these fails closed.
  "variantKey",
  "presentationRevisionId",
  "readingLevel",
  "accommodation",
  "accommodationStatus",
  "presentation",
  "launchRef",
  "deliveryOutcome",
  "outcomeAtIssuance",
  "configRevision",
  "issuedAt",
  "expiresAt",
];

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
  // requireDistrictContext enforces PDR-027 §10.1 steps 1, 3, and the
  // record/claims-consistency check: authenticated caller, an `active`
  // canonical user record, a resolvable district, and token/record agreement
  // (else `unauthenticated`, `account-inactive`, `claim-*`, or
  // `district-*`). A `provisioned` student who arrives on the deep link is
  // refused here with `account-inactive`; the client routes them to
  // onboarding and re-resolves after activation.
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

function parseAssignmentId(data: unknown): string {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new PlatformError(
      "deep-link-shape-invalid",
      "Request payload must be a structured object carrying only assignmentId.",
    );
  }
  const payload = data as Record<string, unknown>;
  for (const key of FORBIDDEN_REQUEST_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      throw new PlatformError(
        "deep-link-shape-invalid",
        "The deep-link resolver derives every authority fact from server state; the client must not assert them.",
      );
    }
  }
  if (!isNonEmptyString(payload.assignmentId)) {
    throw new PlatformError(
      "deep-link-shape-invalid",
      "assignmentId must be a non-empty string.",
    );
  }
  const assignmentId = payload.assignmentId.trim();
  if (!ASSIGNMENT_ID_PATTERN.test(assignmentId)) {
    throw new PlatformError(
      "deep-link-shape-invalid",
      "assignmentId must be a canonical URL-safe token.",
    );
  }
  return assignmentId;
}

async function loadAssignment(assignmentId: string): Promise<AssignmentRecord> {
  const snapshot = await assignmentDocRef(assignmentId).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "assignment-not-found",
      "No assignment matches this identifier.",
    );
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError(
      "assignment-not-found",
      "Assignment record was empty.",
    );
  }
  return data;
}

async function loadActiveEnrollment(
  classId: string,
  studentId: string,
): Promise<EnrollmentRecord> {
  const snapshot = await enrollmentDocRef(
    enrollmentIdFor(classId, studentId),
  ).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "enrollment-inactive",
      "Caller is not enrolled in the referenced class.",
    );
  }
  const data = snapshot.data();
  if (!data || data.status !== "active") {
    throw new PlatformError(
      "enrollment-inactive",
      "Caller is not actively enrolled in the referenced class.",
    );
  }
  return data;
}

// True when the assignment's availability window is open at `now`. Mirrors
// `assessmentSessionsBegin.assertAssignmentBeginWindow` (no grace at begin
// time): not-yet-available or already-closed windows are treated as closed,
// which the resolver surfaces as `informational` rather than a refusal so a
// student who is a genuine recipient of a closed-window assignment still
// lands on a calm surface.
function isBeginWindowOpen(assignment: AssignmentRecord): boolean {
  const now = Timestamp.now().toMillis();
  if (assignment.availableAt && assignment.availableAt.toMillis() > now) {
    return false;
  }
  if (
    assignment.windowClosesAt &&
    assignment.windowClosesAt.toMillis() <= now
  ) {
    return false;
  }
  return true;
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

// Resolve one deep-link arrival. Authorization order follows PDR-027 §10.1
// and is at least as strict as `assessmentSessionsBegin`:
//   1. authenticated caller under an active LyfeLabz identity
//   2. role === "student"
//   3. status === "active" (via requireDistrictContext)
//   4. claims/record consistency (via requireDistrictContext)
//   5. assignment exists
//   6. same-school invariant (PDR-025 §10: a same-school target is a
//      same-district target; the AssignmentRecord carries schoolId, not
//      districtId, so this is the canonical district check, identical to the
//      one session begin enforces) -> else `district-mismatch`
//   7. assignment is published or closed (draft -> `assignment-not-published`,
//      archived -> `assignment-archived`)
//   8. caller holds an active enrollment in the assignment's class
//   9. recipient-aware attemptContext (published + classroom + open window +
//      canonical recipient -> `authorized`; otherwise `informational`)
async function lmsDeepLinkResolveHandler(
  request: CallableRequest<unknown>,
): Promise<LmsDeepLinkResolveResponse> {
  const actor = await assertActiveStudentInDistrict(request);
  const assignmentId = parseAssignmentId(request.data);

  const assignment = await loadAssignment(assignmentId);

  // Same-school invariant as the district boundary (PDR-025 §10). The
  // assignment record denormalizes schoolId, not districtId; session begin
  // enforces the identical check. A cross-school (hence non-same-district)
  // caller is refused with the canonical `district-mismatch` identifier and
  // learns nothing beyond that stable code.
  if (assignment.schoolId !== actor.schoolId) {
    throw new PlatformError(
      "district-mismatch",
      "Caller does not have access to this assignment.",
    );
  }

  if (assignment.status === "draft") {
    throw new PlatformError(
      "assignment-not-published",
      "This assignment is not available yet.",
    );
  }
  if (assignment.status === "archived") {
    throw new PlatformError(
      "assignment-archived",
      "This assignment is no longer available.",
    );
  }
  // Only `published` and `closed` remain (AssignmentStatus is a closed
  // union). Both resolve; `closed` yields an informational context.

  // Enrollment gate (PDR-027 §10.1 step 6). Mirrors session begin exactly.
  await loadActiveEnrollment(assignment.classId, actor.uid);

  // Compute the recipient-aware attemptContext (blueprint §8.4). This is
  // stricter than the literal PDR-027 §10.1 enrollment check and never a
  // widening: `authorized` is returned only when session begin would also
  // admit the caller (published + classroom + open window + canonical
  // recipient). Every other resolvable state is `informational`.
  let internalTarget: LmsDeepLinkInternalTarget;
  let attemptContext: LmsDeepLinkAttemptContext;

  if (assignment.status === "closed") {
    internalTarget = "informational";
    attemptContext = "informational";
  } else if (assignment.mode !== "classroom") {
    // Practice-mode assignment: route to the lesson without the assessment
    // pipeline (PDR-027 §10.2). No recipient concept applies.
    internalTarget = "lessonPractice";
    attemptContext = "informational";
  } else if (!isBeginWindowOpen(assignment)) {
    internalTarget = "informational";
    attemptContext = "informational";
  } else {
    // Recipient enforcement (PDR-029l), read-only. `isCanonicalRecipient`
    // performs exactly one document read and never mutates. A non-recipient
    // (including a late-enrolled student who was never seated into the frozen
    // population) is `informational`, never `authorized`: URL possession and
    // enrollment alone never confer recipient membership.
    const isRecipient = await isCanonicalRecipient(
      {
        assignmentId,
        studentId: actor.uid,
        schoolId: actor.schoolId,
        districtId: actor.districtId,
      },
      (ref) => ref.get(),
    );
    if (isRecipient) {
      internalTarget = "assignmentLaunch";
      attemptContext = "authorized";
    } else {
      internalTarget = "informational";
      attemptContext = "informational";
    }
  }

  // F5.2 §4 Op C / §7.3 (Slice 4): server-authoritative presentation
  // resolution, strictly AFTER the full authorization chain above. Op C runs
  // only for actual launch targets (`assignmentLaunch`, `lessonPractice`) - a
  // student who reaches an `informational` surface is not launching a lesson,
  // begin would refuse them, and minting a never-consumed grant would
  // contradict the grant's meaning (§7.2). For a canonical-expected student
  // (no accommodation / inactive) Op C returns no grant and no presentation,
  // and the response stays shape-identical to pre-feature behavior. Any
  // internal failure degrades to canonical (§8.5 row 8): the launch is never
  // blocked by a differentiation-resolution problem.
  let presentation: LaunchPresentation | undefined;
  let launchRef: string | undefined;
  if (
    internalTarget === "assignmentLaunch" ||
    internalTarget === "lessonPractice"
  ) {
    const resolution = await createRequestLaunchPresentationResolver().resolve({
      studentId: actor.uid,
      assignmentId,
      lessonSlug: assignment.lessonSlug,
    });
    if (resolution.kind === "differentiated") {
      presentation = resolution.presentation;
      launchRef = resolution.launchRef;
    } else if (resolution.kind === "canonicalFallback") {
      launchRef = resolution.launchRef;
    }
    // `expectedCanonical` and `internalFailure` attach nothing.
  }

  // PDR-027 §10.1 step 9 / §23: emit the resolution audit event. Best-effort
  // so an audit outage never blocks a legitimate student; it is the ONLY
  // document this resolver writes. The payload carries no PII, no classmate
  // identifier, no Classroom identifier, and no Google account.
  try {
    await writeAuditEvent({
      actorUserId: actor.uid,
      actorRole: "student",
      action: "lms.deepLinkResolved",
      targetType: "assignment",
      targetId: assignmentId,
      schoolId: actor.schoolId,
      districtId: actor.districtId,
      payload: { attemptContext, internalTarget },
    });
  } catch {
    safeLog(() =>
      log.error("lms.deepLinkResolveAuditFailed", {
        actorUserId: actor.uid,
        assignmentId,
      }),
    );
  }

  safeLog(() =>
    log.info("lms.deepLinkResolved", {
      actorUserId: actor.uid,
      assignmentId,
      attemptContext,
      internalTarget,
    }),
  );

  return {
    assignmentId,
    classId: assignment.classId,
    lessonSlug: assignment.lessonSlug,
    internalTarget,
    attemptContext,
    // Additive, optional (§7.1): present only for an accommodated launch.
    ...(presentation !== undefined ? { presentation } : {}),
    ...(launchRef !== undefined ? { launchRef } : {}),
  };
}

export const lmsDeepLinkResolve = platformCallable(lmsDeepLinkResolveHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __lmsDeepLinkResolveHandler = lmsDeepLinkResolveHandler;
