import { randomBytes } from "node:crypto";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import {
  PlatformError,
  assignmentDocRef,
  attemptsCollectionRef,
  lmsAssignmentPublicationDocRef,
  lmsGradePassbackDocRef,
  log,
  resolveActiveProviderAccountIdForUser,
  runFirestoreTransaction,
  writeAuditEvent,
  type AssessmentAttemptRecord,
} from "../../shared";
import {
  selectHighestCompletedAttempt,
  type SelectedCompletedAttempt,
} from "../../assessments/best-attempt";
import {
  occurrenceScopeOf,
  resolveCurrentOccurrenceGroup,
} from "../../assignments/current-occurrence-group";
import { ensureGoogleClassroomProductionBindings } from "../providers/google-classroom/config-firebase";
import { lmsGradePassbackIdFor } from "../shared/ids";
import {
  readStudentSubmission,
  resolveLiveGradeDestination,
  type GradeDestinationFailureStatus,
  type LiveGradeDestination,
} from "./destination";
import { computeGradePassbackEarnedPoints } from "./grade-calculation";
import {
  WRITE_ACTIONS,
  decideGradeAction,
  type GradeReconciliationAction,
} from "./reconciliation-plan";
import { isInGradeSyncRoster } from "./roster";

// Sprint 30A.2 - Google Classroom best-score grade-passback synchronization
// engine.
//
// -------------------- Product contract --------------------
//
// LyfeLabz preserves every valid quiz attempt. Classroom receives only the
// BEST valid LyfeLabz normalized performance for a graded assignment,
// scaled to the teacher-selected Classroom max points:
//
//   earnedPoints = halfEvenRound(bestPercentage / 100 * maxPoints, 2 dp)
//
// -------------------- Reassignment model (Sprint 30) --------------------
//
// When a class + lesson has a VALID Current (canonical occurrence grouping,
// `assignments/current-occurrence-group.ts`), the passback TARGET is
// Current - whichever occurrence the triggering attempt belongs to - and
// the attempt set is the student's attempts on EVERY occurrence in that
// group (published, closed, archived; graded or ungraded). "Ungraded"
// only controls whether an occurrence itself is a grade destination; it
// never erases demonstrated performance. Current's own grading snapshot and
// maxPoints govern the conversion; an ungraded Current, or one with no
// succeeded Classroom publication, sends no grade anywhere (never falling
// back to older coursework). Historical coursework therefore never
// receives a grade because of a newer Current. The per-(target, student)
// passback document, lease, and monotonic generation machinery below are
// unchanged; they are simply keyed by Current.
//
// A MANAGED scope whose Current is no longer operational (the authoritative
// pointer names a closed/archived in-scope assignment) keeps that pointed
// assignment as the only destination, with the same cumulative attempt set:
// no older occurrence is ever resurrected as a destination and no
// replacement is chosen. This keeps a teacher retry of a failed sync
// possible after the Current assignment is closed (as it was before the
// reassignment model); there is no new grace-period rule. If the pointed
// assignment cannot be confirmed (a concurrent pointer change), no grade is
// sent.
//
// With NO authoritative pointer (unresolved legacy scope), behavior is
// exactly the pre-existing per-assignment contract: target = the triggering
// assignment, attempt set = that assignment's attempts. No Current is
// ever guessed.
//
// `bestPercentage` is recomputed in FULL from the canonical current
// attempt set on every evaluation (never incrementally from one new
// attempt), via the single authoritative `selectHighestCompletedAttempt`.
// Because that selection is a max over a set that only grows, the desired
// value is monotonic by construction: a later lower-scoring attempt can
// never lower it. Classroom's own stored grade is NEVER read back as
// authoritative; LyfeLabz's attempt history is the sole source of truth.
//
// -------------------- Canonical write safety --------------------
//
// No grade is ever written merely because a publication is stored, a
// passback record exists, or a LyfeLabz score was computed. Before any
// PATCH, on every route (automatic post-attempt passback, teacher Retry,
// teacher reconciliation apply), this engine establishes fresh truth:
//   1. the destination (Current, or the locked legacy/closed-Current
//      destination) from the canonical occurrence grouping;
//   2. the LIVE destination preflight (`resolveLiveGradeDestination`):
//      graded, succeeded publication, own active connection, live
//      coursework exists + PUBLISHED + graded + live maxPoints equal to the
//      stored grading maxPoints. Any failure: no write
//      (`destinationUnavailable`);
//   3. the canonical grade-sync roster (`isInGradeSyncRoster`);
//   4. the canonical cumulative best (unchanged, below);
//   5. UNDER THE LEASE, a fresh read of the student's live Classroom
//      submission and the canonical decision (`decideGradeAction`): only a
//      write action (fill blank / raise / replace a narrow missing-work
//      draft zero) PATCHes. Equal or higher Classroom grades and protected
//      zeros/divergent grades are recorded without any upstream write.
// The decision is re-evaluated after every PATCH in the reconciliation
// loop, so a newer target is re-checked against fresh Classroom state too.
//
// -------------------- Concurrency design --------------------
//
// The hard problem this engine solves is NOT "what is the best score" (the
// recomputation above already answers that monotonically) - it is
// preventing an ALREADY-DISPATCHED, slower/older upstream PATCH from
// landing at Classroom AFTER a newer/higher PATCH, which would leave
// Classroom showing a lower grade than LyfeLabz's own state agrees is
// correct.
//
// Mutual exclusion is enforced with a lease held in exactly one Firestore
// document per (assignmentId, studentId), acquired transactionally.
// Firestore's own optimistic-concurrency control on a transactional write
// is the actual mutual-exclusion primitive: if two concurrent invocations
// both attempt to acquire the same currently-unheld lease in the same
// transaction step, Firestore commits exactly one of the two conflicting
// writes and retries the other's transaction body against the now-updated
// document, at which point the retried attempt observes the lease already
// held and defers instead of double-acquiring it. See
// `advanceDesiredStateAndAcquireLease` below.
//
// Only the transaction that actually acquires the lease (or extends its
// own already-held lease during in-flight convergence, see the
// reconciliation loop in `performUpstreamSyncLoop`) is authorized to issue
// an upstream call. A worker that cannot acquire the lease still safely
// persists the newer desired state (bumping `syncGeneration`) and returns
// `"deferred"` WITHOUT calling Classroom - the current lease owner is
// responsible for noticing the advance on its own next reconciliation and
// converging to it before releasing authority. This is what "at most one
// active outbound worker at a time" actually means here: never zero
// bookkeeping progress, but genuinely zero concurrent upstream calls.
//
// A bounded lease TTL (`LEASE_TTL_MS`) plus a bounded per-upstream-call
// timeout (`GRADE_PATCH_TIMEOUT_MS` on the adapter, mirroring the existing
// `publishAssignment` precedent) together bound how long a crashed or
// hung worker can hold the lease before another invocation may reclaim
// it. See `ARCHITECTURE.md`... (no such file - this comment block, and
// the accompanying test suite `engine.concurrency.test.ts`, are the
// authoritative documentation of the proof, per the Sprint 30A.2
// specification's residual-risk disclosure requirement: a worker whose
// PATCH is still physically in flight on the network at the exact moment
// its lease is reclaimed as expired is a residual, bounded, and
// self-healing risk - see the module-level comment on
// `GRADE_PATCH_TIMEOUT_MS` below and the Sprint 30A.2 implementation
// report's "Residual Risks" section.

// 5 minutes. Load-bearing relationship: both upstream-calling adapter
// operations this engine uses (`resolveStudentSubmission`,
// `patchStudentSubmissionGrade`) are independently bounded at 15s each by
// their own AbortController-backed timeouts
// (`google-classroom/adapter.ts`), so a single reconciliation pass's
// worst-case network time (~30s) stays comfortably under this TTL. A
// worker therefore always fails/releases its lease client-side long
// before another worker could ever legitimately reclaim it as expired -
// the "worker still physically in flight when its lease is reclaimed"
// race the Sprint 30A.2 specification warns about structurally cannot
// occur through this engine's own calls. The one caveat (documented as a
// residual risk in the implementation report, not hidden here): Google
// may have already durably received and begun processing an aborted
// request before the abort signal reaches it, so a timed-out call is not
// a guaranteed no-op on Google's side - only guaranteed to stop this
// engine from treating it as authoritative going forward.
const LEASE_TTL_MS = 5 * 60 * 1000;

export type GradePassbackSyncOutcome =
  | { readonly outcome: "notApplicable" }
  | { readonly outcome: "noPublication" }
  | { readonly outcome: "noAttempts" }
  | { readonly outcome: "deferred" }
  | { readonly outcome: "alreadySynced" }
  | {
      readonly outcome: "synced";
      readonly earnedPoints: number;
      readonly action: GradeReconciliationAction;
    }
  // Fresh Classroom state needed no write (equal, or Classroom higher).
  | { readonly outcome: "noChange"; readonly action: GradeReconciliationAction }
  // Fresh Classroom state is a protected grade; nothing written.
  | { readonly outcome: "protected"; readonly action: GradeReconciliationAction }
  | { readonly outcome: "outsideRoster" }
  | {
      readonly outcome: "destinationUnavailable";
      readonly status: GradeDestinationFailureStatus;
    }
  // The caller's expected destination (e.g. a teacher's previewed Current,
  // coursework, and maxPoints) no longer matches the fresh destination.
  | { readonly outcome: "destinationChanged" }
  | { readonly outcome: "failed"; readonly errorCode: string };

// Who triggered the evaluation. `attempt` (post-finalize) keeps the
// established short-circuit: nothing is re-sent when the desired value has
// not advanced past the last confirmed sync. `teacher` (Retry, reconciliation
// apply) is an explicit request to re-evaluate against fresh Classroom
// state even when LyfeLabz believes it is already synced.
export type GradePassbackTrigger = "attempt" | "teacher";

export type GradePassbackExpectedDestination = {
  readonly assignmentId: string;
  readonly lmsAssignmentId: string;
  readonly maxPoints: number;
};

type Phase1Deferred = {
  readonly kind:
    | "notApplicable"
    | "noPublication"
    | "noAttempts"
    | "deferred"
    | "alreadySynced";
};

type Phase1Acquired = {
  readonly kind: "acquired";
  readonly gradePassbackId: string;
  readonly leaseToken: string;
  readonly targetGeneration: number;
  readonly targetEarnedPoints: number;
  readonly studentId: string;
};

type Phase1Result = Phase1Deferred | Phase1Acquired;

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

function isPositiveFiniteInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0
  );
}

// Phase 1: recompute the canonical desired state from the FULL current
// attempt set and, if there is unsynced work, either acquire the
// synchronization lease or persist the advance and defer to whichever
// worker already owns it. Every read and write in this function happens
// inside the transaction the caller supplies; there is no network call
// here, satisfying "do not hold a Firestore transaction open across a
// network call."
async function advanceDesiredStateAndAcquireLease(
  assignmentId: string,
  occurrenceAssignmentIds: ReadonlyArray<string>,
  studentId: string,
  force: boolean,
): Promise<Phase1Result> {
  return runFirestoreTransaction<Phase1Result>(async (tx) => {
    const assignmentSnap = await tx.get(assignmentDocRef(assignmentId));
    if (!assignmentSnap.exists) return { kind: "notApplicable" };
    const assignment = assignmentSnap.data();
    if (!assignment) return { kind: "notApplicable" };
    if (assignment.classroomGrading?.mode !== "graded") {
      return { kind: "notApplicable" };
    }
    const publicationId = assignment.lmsPublicationRef;
    if (typeof publicationId !== "string" || publicationId.length === 0) {
      return { kind: "noPublication" };
    }

    const publicationSnap = await tx.get(
      lmsAssignmentPublicationDocRef(publicationId),
    );
    if (!publicationSnap.exists) return { kind: "noPublication" };
    const publication = publicationSnap.data();
    if (!publication || publication.status !== "succeeded") {
      return { kind: "noPublication" };
    }
    if (
      publication.classroomGrading?.mode !== "graded" ||
      !isPositiveFiniteInteger(publication.classroomGrading.maxPoints) ||
      typeof publication.lmsAssignmentId !== "string" ||
      publication.lmsAssignmentId.length === 0
    ) {
      // Defensive: the publication's own grading snapshot must cohere
      // with a graded target. Sprint 30A v1 freezes maxPoints once
      // published, so this should not occur in practice; treat it as "no
      // valid publication to target" rather than guessing a value.
      return { kind: "noPublication" };
    }
    const maxPoints = publication.classroomGrading.maxPoints;

    // One (studentId, assignmentId) equality query per occurrence - the
    // exact query shape this engine has always issued, so no new index is
    // needed. A legacy/unresolved scope has exactly one occurrence (the
    // target itself), reproducing the pre-existing single query.
    const attempts: {
      readonly id: string;
      readonly data: AssessmentAttemptRecord;
    }[] = [];
    for (const occurrenceAssignmentId of occurrenceAssignmentIds) {
      const attemptsSnap = await tx.get(
        attemptsCollectionRef()
          .where("studentId", "==", studentId)
          .where("assignmentId", "==", occurrenceAssignmentId),
      );
      for (const doc of attemptsSnap.docs) {
        const data = doc.data();
        if (data) attempts.push({ id: doc.id, data });
      }
    }
    const best: SelectedCompletedAttempt | null =
      selectHighestCompletedAttempt(attempts);
    if (best === null) return { kind: "noAttempts" };

    const districtId =
      attempts.find((a) => a.id === best.attemptId)?.data.districtId ??
      attempts[0]?.data.districtId;
    if (typeof districtId !== "string" || districtId.length === 0) {
      return { kind: "noAttempts" };
    }

    const desiredEarnedPoints = computeGradePassbackEarnedPoints(
      best.percentage,
      maxPoints,
    );

    const gradePassbackId = lmsGradePassbackIdFor(assignmentId, studentId);
    const ref = lmsGradePassbackDocRef(gradePassbackId);
    const existingSnap = await tx.get(ref);
    const existing = existingSnap.exists ? existingSnap.data() : undefined;

    const now = Timestamp.now();

    // Determine the current desired state WITHOUT writing yet. Monotonic
    // by construction: `best.percentage` is a max over the full, only-
    // ever-growing attempt set, so it is never lower than a previously
    // stored value - "advanced" therefore only ever means "increased or
    // first-seen," never "decreased."
    const advanced = existing === undefined || best.percentage > existing.desiredBestPercentage;
    const syncGeneration = !existing
      ? 1
      : advanced
        ? existing.syncGeneration + 1
        : existing.syncGeneration;
    const lastSyncedGeneration = existing?.lastSyncedGeneration ?? 0;

    if (syncGeneration <= lastSyncedGeneration && !force) {
      // No write needed: nothing advanced and the document already
      // reflects a fully-synced state. A teacher-triggered evaluation
      // (`force`) still proceeds, to re-check fresh Classroom state.
      return { kind: "alreadySynced" };
    }

    const leaseHeld =
      existing?.leaseOwnerToken !== undefined &&
      existing?.leaseExpiresAt !== undefined &&
      existing.leaseExpiresAt.toMillis() > now.toMillis();

    if (leaseHeld) {
      // (Also covers a forced evaluation while another worker is active:
      // that worker re-reads Classroom itself before any write.)
      // Another worker already owns synchronization authority. Persist
      // the advance (if any) so that worker converges to it on its own
      // next reconciliation, but issue NO upstream call ourselves - this
      // is the "at most one active worker" invariant in action. A single
      // `tx.set` covers both "nothing changed" (fields identical to
      // current) and "advanced" (fields updated) without a second write
      // to this document in this transaction.
      if (advanced) {
        tx.set(
          ref,
          {
            desiredBestPercentage: best.percentage,
            desiredEarnedPoints,
            bestAttemptId: best.attemptId,
            syncGeneration,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
      return { kind: "deferred" };
    }

    // No valid lease is held (absent, or expired and now reclaimable).
    // Acquire it in the SAME write that also persists any advance, so
    // exactly one `tx.set` is issued against this document in this
    // transaction.
    const leaseToken = randomBytes(16).toString("hex");
    const leaseExpiresAt = Timestamp.fromMillis(now.toMillis() + LEASE_TTL_MS);

    if (!existing) {
      tx.set(ref, {
        assignmentId,
        studentId,
        classId: assignment.classId,
        ownerUid: assignment.teacherId,
        schoolId: assignment.schoolId,
        districtId,
        providerId: publication.providerId,
        connectionId: publication.connectionId,
        lmsClassId: publication.lmsClassId,
        lmsAssignmentId: publication.lmsAssignmentId,
        lmsPublicationRef: publicationId,
        maxPoints,
        desiredBestPercentage: best.percentage,
        desiredEarnedPoints,
        bestAttemptId: best.attemptId,
        syncGeneration,
        lastSyncedGeneration,
        status: "syncing",
        leaseOwnerToken: leaseToken,
        leaseGeneration: syncGeneration,
        leaseExpiresAt,
        lastAttemptedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      tx.set(
        ref,
        {
          ...(advanced
            ? {
                desiredBestPercentage: best.percentage,
                desiredEarnedPoints,
                bestAttemptId: best.attemptId,
                syncGeneration,
              }
            : {}),
          status: "syncing",
          leaseOwnerToken: leaseToken,
          leaseGeneration: syncGeneration,
          leaseExpiresAt,
          lastAttemptedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    return {
      kind: "acquired",
      gradePassbackId,
      leaseToken,
      targetGeneration: syncGeneration,
      targetEarnedPoints: desiredEarnedPoints,
      studentId,
    };
  });
}

// Reconcile after an upstream success: confirm we still own the lease,
// record the confirmed-synced generation/points, and report whether a
// NEWER desired value appeared while the call was in flight (in which
// case the caller continues in the same lease rather than releasing it).
type ReconcileOutcome =
  | { readonly kind: "supersededSilently" }
  | { readonly kind: "converged" }
  | {
      readonly kind: "advance";
      readonly targetGeneration: number;
      readonly targetEarnedPoints: number;
    };

async function reconcileAfterUpstreamSuccess(
  gradePassbackId: string,
  leaseToken: string,
  syncedGeneration: number,
  syncedEarnedPoints: number,
  action: GradeReconciliationAction,
): Promise<ReconcileOutcome> {
  return runFirestoreTransaction<ReconcileOutcome>(async (tx) => {
    const ref = lmsGradePassbackDocRef(gradePassbackId);
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : undefined;
    if (!data || data.leaseOwnerToken !== leaseToken) {
      // Lost ownership (lease expired and was reclaimed elsewhere) between
      // dispatching the call and this reconciliation. Do not write
      // "synced" - it is not this worker's authority to claim anymore.
      return { kind: "supersededSilently" };
    }
    if (data.syncGeneration > syncedGeneration) {
      // A newer desired value appeared while the call was in flight.
      // Extend the SAME lease and report the new target; the caller keeps
      // going without releasing authority.
      const now = Timestamp.now();
      tx.set(
        ref,
        {
          leaseExpiresAt: Timestamp.fromMillis(now.toMillis() + LEASE_TTL_MS),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return {
        kind: "advance",
        targetGeneration: data.syncGeneration,
        targetEarnedPoints: data.desiredEarnedPoints,
      };
    }
    // Fully caught up. Persist confirmed sync and release the lease.
    tx.set(
      ref,
      {
        lastSyncedGeneration: syncedGeneration,
        lastSyncedEarnedPoints: syncedEarnedPoints,
        lastSyncedAt: FieldValue.serverTimestamp(),
        lastDecision: action,
        lastDecisionAt: FieldValue.serverTimestamp(),
        status: "synced",
        leaseOwnerToken: FieldValue.delete(),
        leaseGeneration: FieldValue.delete(),
        leaseExpiresAt: FieldValue.delete(),
        lastErrorCode: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { kind: "converged" };
  });
}

// Reconcile after an upstream failure (or a resolution failure before any
// PATCH was attempted): release the lease if we still hold it so a future
// retry/finalize is never blocked by a stuck lease, and record a bounded
// error code. Never throws.
async function reconcileAfterFailure(
  gradePassbackId: string,
  leaseToken: string,
  errorCode: string,
): Promise<void> {
  try {
    await runFirestoreTransaction<void>(async (tx) => {
      const ref = lmsGradePassbackDocRef(gradePassbackId);
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : undefined;
      if (!data || data.leaseOwnerToken !== leaseToken) return;
      tx.set(
        ref,
        {
          status: "failed",
          lastErrorCode: errorCode,
          leaseOwnerToken: FieldValue.delete(),
          leaseGeneration: FieldValue.delete(),
          leaseExpiresAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
  } catch {
    // Persistence of the failure marker is best-effort; the bounded
    // outcome returned to the caller already reports the failure.
  }
}

// Reconcile after a fresh decision that required NO upstream write:
// confirm we still own the lease; if a newer desired value appeared
// meanwhile, keep the lease and report it (the loop re-evaluates); otherwise
// record the decision and release the lease.
//   - alreadyEqual / preservedClassroomHigher: Classroom already satisfies
//     LyfeLabz, so this generation is recorded as synced (no retry needed).
//   - protected*: status `protected`; the generation is NOT marked synced,
//     so a later attempt or teacher action re-evaluates fresh state.
async function reconcileAfterNoWrite(
  gradePassbackId: string,
  leaseToken: string,
  evaluatedGeneration: number,
  evaluatedEarnedPoints: number,
  action: GradeReconciliationAction,
): Promise<ReconcileOutcome> {
  return runFirestoreTransaction<ReconcileOutcome>(async (tx) => {
    const ref = lmsGradePassbackDocRef(gradePassbackId);
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : undefined;
    if (!data || data.leaseOwnerToken !== leaseToken) {
      return { kind: "supersededSilently" };
    }
    if (data.syncGeneration > evaluatedGeneration) {
      const now = Timestamp.now();
      tx.set(
        ref,
        {
          leaseExpiresAt: Timestamp.fromMillis(now.toMillis() + LEASE_TTL_MS),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return {
        kind: "advance",
        targetGeneration: data.syncGeneration,
        targetEarnedPoints: data.desiredEarnedPoints,
      };
    }
    const satisfied = action === "alreadyEqual" || action === "preservedClassroomHigher";
    tx.set(
      ref,
      {
        ...(satisfied
          ? {
              status: "synced",
              lastSyncedGeneration: evaluatedGeneration,
              ...(action === "alreadyEqual"
                ? { lastSyncedEarnedPoints: evaluatedEarnedPoints }
                : {}),
            }
          : { status: "protected" }),
        lastDecision: action,
        lastDecisionAt: FieldValue.serverTimestamp(),
        leaseOwnerToken: FieldValue.delete(),
        leaseGeneration: FieldValue.delete(),
        leaseExpiresAt: FieldValue.delete(),
        lastErrorCode: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { kind: "converged" };
  });
}

// Phase 2: while holding the lease, freshly read the student's live
// Classroom submission, decide canonically, and PATCH only when the decision
// permits it - reconciling (and continuing upward, per the module comment)
// after every step until converged, then release authority. The destination
// was live-verified immediately before this phase.
async function performUpstreamSyncLoop(
  acquired: Phase1Acquired,
  destination: LiveGradeDestination,
): Promise<GradePassbackSyncOutcome> {
  let currentGeneration = acquired.targetGeneration;
  let currentEarnedPoints = acquired.targetEarnedPoints;

  for (;;) {
    try {
      const studentProviderAccountId = await resolveActiveProviderAccountIdForUser(
        acquired.studentId,
        "google.com",
      );
      if (studentProviderAccountId === null) {
        throw new PlatformError(
          "gradePassback.studentIdentityUnresolved",
          "The student's upstream Google identity could not be resolved.",
        );
      }

      const read = await readStudentSubmission(destination, studentProviderAccountId);
      if (read.kind === "none") {
        throw new PlatformError(
          "gradePassback.submissionNotFound",
          "No Classroom submission exists yet for this student.",
        );
      }
      if (read.kind === "ambiguous") {
        throw new PlatformError(
          "gradePassback.submissionAmbiguous",
          "More than one Classroom submission matched this student.",
        );
      }

      // Defensive re-check immediately before any upstream write: a worker
      // that was suspended for a long time (e.g. resuming after being
      // stuck past the lease TTL, per the module comment on
      // `LEASE_TTL_MS`) may have already lost authority to a worker that
      // reclaimed the lease and finished. Catching this here means a
      // resumed-stale worker aborts WITHOUT issuing even a redundant
      // upstream call. This does not eliminate the irreducible network-layer
      // race (a request already in flight when this check runs) - see the
      // `LEASE_TTL_MS` comment.
      const ownershipSnap = await lmsGradePassbackDocRef(acquired.gradePassbackId).get();
      const ownershipData = ownershipSnap.exists ? ownershipSnap.data() : undefined;
      if (!ownershipData || ownershipData.leaseOwnerToken !== acquired.leaseToken) {
        return { outcome: "failed", errorCode: "gradePassback.lostLeaseAuthority" };
      }

      const decision = decideGradeAction(currentEarnedPoints, read.submission);

      if (!WRITE_ACTIONS.has(decision.action)) {
        const reconciled = await reconcileAfterNoWrite(
          acquired.gradePassbackId,
          acquired.leaseToken,
          currentGeneration,
          currentEarnedPoints,
          decision.action,
        );
        if (reconciled.kind === "supersededSilently") {
          return { outcome: "failed", errorCode: "gradePassback.lostLeaseAuthority" };
        }
        if (reconciled.kind === "advance") {
          currentGeneration = reconciled.targetGeneration;
          currentEarnedPoints = reconciled.targetEarnedPoints;
          continue;
        }
        safeLog(() =>
          log.info("lms.gradePassbackNoWrite", {
            gradePassbackId: acquired.gradePassbackId,
            action: decision.action,
          }),
        );
        return decision.action === "alreadyEqual" ||
          decision.action === "preservedClassroomHigher"
          ? { outcome: "noChange", action: decision.action }
          : { outcome: "protected", action: decision.action };
      }

      await destination.adapter.patchStudentSubmissionGrade({
        accessToken: destination.accessToken,
        lmsClassId: destination.lmsClassId,
        lmsAssignmentId: destination.lmsAssignmentId,
        submissionId: read.submission.submissionId,
        earnedPoints: currentEarnedPoints,
      });

      const reconciled = await reconcileAfterUpstreamSuccess(
        acquired.gradePassbackId,
        acquired.leaseToken,
        currentGeneration,
        currentEarnedPoints,
        decision.action,
      );
      if (reconciled.kind === "supersededSilently") {
        return { outcome: "failed", errorCode: "gradePassback.lostLeaseAuthority" };
      }
      if (reconciled.kind === "converged") {
        return {
          outcome: "synced",
          earnedPoints: currentEarnedPoints,
          action: decision.action,
        };
      }
      // kind === "advance": continue the loop with the newer target, same
      // lease; the next iteration re-reads Classroom before writing again.
      currentGeneration = reconciled.targetGeneration;
      currentEarnedPoints = reconciled.targetEarnedPoints;
      continue;
    } catch (err) {
      const errorCode =
        err instanceof PlatformError ? err.code : "gradePassback.syncFailed";
      safeLog(() =>
        log.warn("lms.gradePassbackAttemptFailed", {
          gradePassbackId: acquired.gradePassbackId,
          errorCode,
        }),
      );
      await reconcileAfterFailure(
        acquired.gradePassbackId,
        acquired.leaseToken,
        errorCode,
      );
      return { outcome: "failed", errorCode };
    }
  }
}

// Public entry point. Invoked either as a post-commit side effect of
// `assessmentAttemptsFinalize` (only on a genuine new attempt write) or by
// the teacher-facing manual retry callable (`lmsGradePassbacksRetry`).
// Never throws: every failure is reported as a bounded outcome so a caller
// can never accidentally propagate a Classroom-side failure through an
// already-committed LyfeLabz operation.
// Map the triggering assignment to its passback target and attempt scope
// through the canonical occurrence grouping. Read-only.
async function resolvePassbackScope(
  assignmentId: string,
  districtId: string,
): Promise<{
  readonly targetAssignmentId: string;
  readonly occurrenceAssignmentIds: ReadonlyArray<string>;
} | null> {
  const legacy = {
    targetAssignmentId: assignmentId,
    occurrenceAssignmentIds: [assignmentId],
  };
  const snapshot = await assignmentDocRef(assignmentId).get();
  const record = snapshot.exists ? snapshot.data() : undefined;
  if (!record) return legacy;
  const group = await resolveCurrentOccurrenceGroup(
    occurrenceScopeOf(record),
    districtId,
  );
  if (group.resolution === "unresolved") return legacy;
  if (group.currentAssignmentId === null) return null;
  return {
    targetAssignmentId: group.currentAssignmentId,
    occurrenceAssignmentIds: group.occurrences.map((o) => o.assignmentId),
  };
}

export async function synchronizeGradePassback(input: {
  // The assignment the triggering attempt belongs to (finalize), the
  // assignment a teacher asked to retry, or Current (reconciliation apply).
  // Under a valid Current the grade destination is Current, not
  // necessarily this assignment.
  readonly assignmentId: string;
  readonly studentId: string;
  // The caller's verified district context (finalize: the student actor;
  // retry/apply: the teacher actor), passed to canonical Current
  // resolution and the roster check.
  readonly districtId: string;
  readonly trigger?: GradePassbackTrigger;
  // When supplied, the fresh destination must match exactly or nothing is
  // written (`destinationChanged`).
  readonly expectedDestination?: GradePassbackExpectedDestination;
}): Promise<GradePassbackSyncOutcome> {
  // This engine is invoked from callables that may not otherwise touch the
  // Google Classroom provider, so - mirroring `lmsAssignmentsPublish`'s own
  // handler-entry call - it must independently bind its own transport
  // rather than depend on a sibling callable having already run in the
  // same worker. The installer is idempotent and respects a test-injected
  // transport.
  ensureGoogleClassroomProductionBindings();

  let phase1: Phase1Result;
  let targetAssignmentId = input.assignmentId;
  let destination: LiveGradeDestination;
  try {
    const scope = await resolvePassbackScope(input.assignmentId, input.districtId);
    if (scope === null) return { outcome: "notApplicable" };
    targetAssignmentId = scope.targetAssignmentId;

    const targetSnap = await assignmentDocRef(targetAssignmentId).get();
    const target = targetSnap.exists ? targetSnap.data() : undefined;
    if (!target || target.classroomGrading?.mode !== "graded") {
      return { outcome: "notApplicable" };
    }

    const resolved = await resolveLiveGradeDestination(targetAssignmentId, target);
    if (!resolved.ok) {
      if (
        resolved.status === "currentUngraded" ||
        resolved.status === "currentNotPublishedToClassroom"
      ) {
        // The destination's own grading/publication is not a valid graded
        // Classroom target (unpublished, failed publication, or a
        // publication grading snapshot that does not cohere): never fall
        // back to any other coursework.
        return { outcome: "noPublication" };
      }
      await auditOutcome(input.studentId, targetAssignmentId, {
        outcome: "failed",
        errorCode: `gradePassback.destination.${resolved.status}`,
      });
      return { outcome: "destinationUnavailable", status: resolved.status };
    }
    destination = resolved.destination;

    const expected = input.expectedDestination;
    if (
      expected !== undefined &&
      (expected.assignmentId !== destination.assignmentId ||
        expected.lmsAssignmentId !== destination.lmsAssignmentId ||
        expected.maxPoints !== destination.maxPoints)
    ) {
      return { outcome: "destinationChanged" };
    }

    const inRoster = await isInGradeSyncRoster({
      assignmentId: targetAssignmentId,
      record: target,
      studentId: input.studentId,
      districtId: input.districtId,
    });
    if (!inRoster) return { outcome: "outsideRoster" };

    phase1 = await advanceDesiredStateAndAcquireLease(
      scope.targetAssignmentId,
      scope.occurrenceAssignmentIds,
      input.studentId,
      input.trigger === "teacher",
    );
  } catch (err) {
    safeLog(() =>
      log.warn("lms.gradePassbackPhase1Failed", {
        assignmentId: input.assignmentId,
        studentId: input.studentId,
        errorCode: err instanceof PlatformError ? err.code : "unknown",
      }),
    );
    return {
      outcome: "failed",
      errorCode:
        err instanceof PlatformError ? err.code : "gradePassback.syncFailed",
    };
  }

  if (phase1.kind !== "acquired") {
    return { outcome: phase1.kind };
  }

  const result = await performUpstreamSyncLoop(phase1, destination);
  await auditOutcome(input.studentId, targetAssignmentId, result, destination.providerId);
  return result;
}

async function auditOutcome(
  studentId: string,
  targetAssignmentId: string,
  result: GradePassbackSyncOutcome,
  providerId?: string,
): Promise<void> {
  const auditPayload = {
    assignmentId: targetAssignmentId,
    ...(providerId !== undefined ? { providerId } : {}),
  };
  try {
    if (result.outcome === "synced") {
      await writeAuditEvent({
        actorUserId: studentId,
        actorRole: "system",
        action: "lms.gradePassbackSucceeded",
        targetType: "assignment",
        targetId: targetAssignmentId,
        payload: { ...auditPayload, earnedPoints: result.earnedPoints, decision: result.action },
      });
    } else if (result.outcome === "failed") {
      await writeAuditEvent({
        actorUserId: studentId,
        actorRole: "system",
        action: "lms.gradePassbackFailed",
        targetType: "assignment",
        targetId: targetAssignmentId,
        payload: { ...auditPayload, errorCode: result.errorCode },
      });
    }
  } catch {
    // Audit failure is non-blocking, matching the existing lms.* convention.
  }
}
