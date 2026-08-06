import { FieldValue } from "firebase-admin/firestore";

import {
  assertClassSupports,
  PlatformError,
  classDocRef,
  enrollmentCreationDocRef,
  enrollmentDocRef,
  enrollmentStatusChangeDocRef,
  enrollmentsCollectionRef,
  lmsClassLinksCollectionRef,
  lmsConnectionDocRef,
  log,
  resolveActiveExternalIdentity,
  type EnrollmentCreationWrite,
  type EnrollmentStatusChangeWrite,
  type LmsClassLinkRecord,
  type LmsConnectionRecord,
  type LmsProviderId,
} from "../../shared";

import { getProviderAdapter } from "../providers/registry";
import type { LmsProviderAdapter, LmsRosterStudent } from "../providers/provider";
import { getLmsTokenStore } from "../tokens/token-store";
import { enrollmentIdFor } from "../../enrollments/enrollments-join-by-code";

// Provider-neutral roster synchronization engine.
//
// Sprint 23C. Reconciles ONE linked upstream LMS class roster with the
// enrollments on ONE LyfeLabz class. The engine is intentionally
// provider-neutral (PDR-020f): no Google-specific concern lives here.
// The engine depends only on:
//
//   - the vendor-neutral provider adapter (LmsProviderAdapter)
//   - the existing provider registry
//   - the existing token-store boundary
//   - the existing `lmsConnections/{connectionId}` records
//   - the existing `lmsClassLinks/{linkId}` records
//   - the certified external identity bridge
//     (`resolveActiveExternalIdentity`)
//   - the existing enrollment records, deterministic
//     `enrollmentIdFor(...)`, and enrollment-write helpers
//
// The engine is invoked by `lmsClassesSyncRoster` (Sprint 23C callable)
// after that callable has validated the authenticated teacher and the
// caller's ownership of the target LyfeLabz class. The engine does not
// re-authenticate the caller: it assumes ownership has already been
// established and re-verifies the class ownership invariants against
// the persisted records as a defense-in-depth check.
//
// ------------------- Enrollment lifecycle boundary -------------------
//
// The certified enrollment lifecycle table (`enrollments-set-status.ts`)
// defines:
//
//   active      -> transferred | withdrawn | archived
//   transferred -> archived
//   withdrawn   -> archived
//   archived    -> (terminal)
//
// There is NO authorized inactive-to-active transition. Roster
// synchronization therefore does NOT reactivate a prior `transferred`,
// `withdrawn`, or `archived` enrollment even if the same student
// re-appears in the upstream roster. This lifecycle gap is documented
// in the Sprint 23C completion report. A returning student is
// classified as `skipped` and no write is performed; the teacher
// resolves the situation through the certified `enrollmentsTeacherAdd`
// path once the lifecycle table admits a reactivation transition.
//
// Removals apply the single authorized exit transition for LMS-driven
// reconciliation: `active -> withdrawn`. `archived` is reserved for
// class-archival driven transitions and is not used by roster
// synchronization.

export type RosterSyncSummary = {
  readonly classId: string;
  readonly providerId: LmsProviderId;
  readonly linkId: string;
  readonly added: number;
  readonly reactivated: number;
  readonly unchanged: number;
  readonly withdrawn: number;
  readonly unresolved: number;
  readonly skipped: number;
  readonly upstreamRosterEmpty: boolean;
};

export type RosterSyncInput = {
  readonly actor: {
    readonly uid: string;
    readonly schoolId: string;
    readonly districtId?: string;
  };
  readonly classId: string;
};

// ------------------- Internal plan shape (not exposed) -------------------

type PlannedAdd = {
  readonly enrollmentId: string;
  readonly studentUserId: string;
};

type PlannedWithdraw = {
  readonly enrollmentId: string;
  readonly studentUserId: string;
  readonly previousStatus: "active";
};

type RosterSyncPlan = {
  readonly toAdd: readonly PlannedAdd[];
  readonly toWithdraw: readonly PlannedWithdraw[];
  readonly unchanged: number;
  readonly unresolved: number;
  readonly skipped: number;
};

// ------------------- Helpers -------------------

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

async function loadClassLink(
  classId: string,
): Promise<{
  readonly link: LmsClassLinkRecord;
  readonly linkId: string;
}> {
  // A LyfeLabz class carries at most one `linked` LMS link at a time
  // per `classes-import.ts`. Resolve the current active link here.
  const snapshot = await lmsClassLinksCollectionRef()
    .where("classId", "==", classId)
    .where("status", "==", "linked")
    .limit(2)
    .get();
  if (snapshot.empty) {
    throw new PlatformError(
      "lms.classNotLinked",
      "This LyfeLabz class is not linked to an LMS class.",
    );
  }
  if (snapshot.size > 1) {
    throw new PlatformError(
      "lms.classLinkAmbiguous",
      "This LyfeLabz class has more than one active LMS link.",
    );
  }
  const doc = snapshot.docs[0];
  return { link: doc.data(), linkId: doc.id };
}

async function loadConnection(
  connectionId: string,
): Promise<LmsConnectionRecord> {
  const snapshot = await lmsConnectionDocRef(connectionId).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "lms.connectionNotFound",
      "No connection matches this identifier.",
    );
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError(
      "lms.connectionNotFound",
      "Connection record was empty.",
    );
  }
  return data;
}

function loadAdapter(providerId: LmsProviderId): LmsProviderAdapter {
  return getProviderAdapter(providerId);
}

// Read all active enrollments for one class. The read is scoped by
// (classId, status="active") so archived/exited history remains
// untouched.
async function loadCurrentActiveEnrollments(
  classId: string,
): Promise<
  ReadonlyMap<
    string,
    { readonly enrollmentId: string; readonly studentId: string }
  >
> {
  const snapshot = await enrollmentsCollectionRef()
    .where("classId", "==", classId)
    .where("status", "==", "active")
    .get();
  const out = new Map<
    string,
    { enrollmentId: string; studentId: string }
  >();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (typeof data.studentId === "string" && data.studentId.length > 0) {
      out.set(data.studentId, { enrollmentId: doc.id, studentId: data.studentId });
    }
  }
  return out;
}

// Read the enrollment doc if it exists. The deterministic
// `enrollmentIdFor` ID means there is at most one document per
// (classId, studentId) pair, ever.
async function loadEnrollmentForStudent(
  classId: string,
  studentUserId: string,
): Promise<{ readonly status: string } | null> {
  const snap = await enrollmentDocRef(
    enrollmentIdFor(classId, studentUserId),
  ).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  return { status: data.status };
}

async function planReconciliation(input: {
  readonly classId: string;
  readonly schoolId: string;
  readonly upstreamRoster: readonly LmsRosterStudent[];
}): Promise<RosterSyncPlan> {
  const { classId, upstreamRoster } = input;
  const currentActive = await loadCurrentActiveEnrollments(classId);

  // Resolve each upstream member through the certified bridge. The
  // bridge is the ONLY authorized identity resolution path.
  const resolvedUpstreamStudentIds = new Set<string>();
  const toAdd: PlannedAdd[] = [];
  let unresolved = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const member of upstreamRoster) {
    const resolution = await resolveActiveExternalIdentity({
      providerId: "google.com",
      providerAccountId: member.providerAccountId,
    });
    if (!resolution.resolved) {
      unresolved += 1;
      continue;
    }
    const studentUserId = resolution.userId;
    if (resolvedUpstreamStudentIds.has(studentUserId)) {
      // Two upstream provider accounts resolving to the same
      // LyfeLabz Firebase UID would be a duplicate local enrollment
      // attempt on the same deterministic ID. Skip the duplicate;
      // the first occurrence has already been counted.
      continue;
    }
    resolvedUpstreamStudentIds.add(studentUserId);

    if (currentActive.has(studentUserId)) {
      unchanged += 1;
      continue;
    }
    // Not currently active; check if a terminal-state prior
    // enrollment blocks re-add. There is no authorized
    // inactive-to-active transition, so we do not reactivate.
    const priorEnrollment = await loadEnrollmentForStudent(
      classId,
      studentUserId,
    );
    if (priorEnrollment !== null) {
      // Prior enrollment exists in a non-active status. Skip; no
      // write. The lifecycle gap is documented in the Sprint 23C
      // completion report.
      skipped += 1;
      continue;
    }
    toAdd.push({
      enrollmentId: enrollmentIdFor(classId, studentUserId),
      studentUserId,
    });
  }

  // Compute withdrawals: active local enrollments not present in the
  // resolved upstream roster. Because a class carrying an LMS link
  // rejects join-code enrollment (see `classes-import.ts` +
  // enrollment-source enforcement), every active enrollment on a
  // linked class was itself sourced from a prior roster sync.
  const toWithdraw: PlannedWithdraw[] = [];
  for (const [studentUserId, existing] of currentActive.entries()) {
    if (!resolvedUpstreamStudentIds.has(studentUserId)) {
      toWithdraw.push({
        enrollmentId: existing.enrollmentId,
        studentUserId,
        previousStatus: "active",
      });
    }
  }

  return {
    toAdd,
    toWithdraw,
    unchanged,
    unresolved,
    skipped,
  };
}

// Apply the plan. Each write goes through the certified narrow-write
// helper. Writes are deterministically ordered so a replay produces
// identical audit-log-adjacent side effects.
async function applyPlan(input: {
  readonly classId: string;
  readonly schoolId: string;
  readonly plan: RosterSyncPlan;
}): Promise<{ readonly added: number; readonly withdrawn: number }> {
  const { classId, schoolId, plan } = input;
  let added = 0;
  let withdrawn = 0;

  const orderedAdds = [...plan.toAdd].sort((a, b) =>
    a.enrollmentId < b.enrollmentId
      ? -1
      : a.enrollmentId > b.enrollmentId
        ? 1
        : 0,
  );
  for (const add of orderedAdds) {
    const existing = await enrollmentDocRef(add.enrollmentId).get();
    if (existing.exists) {
      // Concurrent write raced us to the deterministic ID. Preserve
      // the pre-existing record: do not overwrite. Idempotency
      // upholds the "no duplicate enrollment documents" invariant.
      continue;
    }
    const creation: EnrollmentCreationWrite = {
      studentId: add.studentUserId,
      classId,
      schoolId,
      status: "active",
      enrolledAt: FieldValue.serverTimestamp(),
    };
    await enrollmentCreationDocRef(add.enrollmentId).set(creation);
    added += 1;
  }

  const orderedWithdraws = [...plan.toWithdraw].sort((a, b) =>
    a.enrollmentId < b.enrollmentId
      ? -1
      : a.enrollmentId > b.enrollmentId
        ? 1
        : 0,
  );
  for (const w of orderedWithdraws) {
    const existing = await enrollmentDocRef(w.enrollmentId).get();
    if (!existing.exists) continue;
    const data = existing.data();
    if (!data || data.status !== "active") continue;
    const change: EnrollmentStatusChangeWrite = {
      status: "withdrawn",
      exitedAt: FieldValue.serverTimestamp(),
    };
    await enrollmentStatusChangeDocRef(w.enrollmentId).update(change);
    withdrawn += 1;
  }

  return { added, withdrawn };
}

// ------------------- Public entry point -------------------

export async function synchronizeClassRoster(
  input: RosterSyncInput,
): Promise<RosterSyncSummary> {
  const { actor, classId } = input;

  // Class ownership defense-in-depth (the callable already checked;
  // the engine re-verifies against the persisted record so a stale
  // callable can never drive a cross-teacher write).
  const classSnapshot = await classDocRef(classId).get();
  if (!classSnapshot.exists) {
    throw new PlatformError(
      "lms.classNotFound",
      "Class was not found.",
    );
  }
  const classRecord = classSnapshot.data();
  if (!classRecord) {
    throw new PlatformError(
      "lms.classNotFound",
      "Class record was empty.",
    );
  }
  if (classRecord.teacherId !== actor.uid) {
    throw new PlatformError(
      "lms.forbidden",
      "Caller does not own this class.",
    );
  }
  if (classRecord.schoolId !== actor.schoolId) {
    throw new PlatformError(
      "lms.forbidden",
      "Caller schoolId does not match class schoolId.",
    );
  }
  // Shared eligibility gate. `rosterSync` requires the class to be
  // `active` per Phase 2B Spec §6 Option B (roster materialization is
  // deferred until after activation). `needsSetup` and `archived` are
  // refused with the historical `lms.classNotActive` code preserved.
  assertClassSupports("rosterSync", classRecord);
  if (classRecord.enrollmentSource !== "lms") {
    throw new PlatformError(
      "lms.classNotLinked",
      "Class is not sourced from an LMS.",
    );
  }

  const { link, linkId } = await loadClassLink(classId);
  if (link.ownerUid !== actor.uid || link.schoolId !== actor.schoolId) {
    throw new PlatformError(
      "lms.forbidden",
      "Caller does not own the LMS link for this class.",
    );
  }

  const connection = await loadConnection(link.connectionId);
  if (connection.teacherId !== actor.uid) {
    throw new PlatformError(
      "lms.forbidden",
      "Caller does not own the LMS connection backing this link.",
    );
  }
  if (connection.status !== "active") {
    throw new PlatformError(
      "lms.connectionNotActive",
      "LMS connection is not active.",
    );
  }
  if (connection.providerId !== link.providerId) {
    throw new PlatformError(
      "lms.connectionMismatch",
      "LMS connection does not match the class link's provider.",
    );
  }

  const bundle = await getLmsTokenStore().resolve(connection.tokenRef);
  const adapter = loadAdapter(connection.providerId);

  // Phase 1: read + plan. If the roster retrieval fails, the engine
  // performs NO writes. If any page fails after earlier pages
  // succeeded, the adapter rejects the whole call, so we never see a
  // partial roster here.
  const upstreamRoster = await adapter.listClassRoster({
    accessToken: bundle.accessToken,
    lmsClassId: link.lmsClassId,
  });

  const plan = await planReconciliation({
    classId,
    schoolId: classRecord.schoolId,
    upstreamRoster,
  });

  // Phase 2: apply. Individual per-enrollment writes use the certified
  // narrow-write helpers. Firestore batches do not fit the shape here
  // (each write is scoped by a different deterministic document ID and
  // the certified narrow writers are per-document); the loop uses
  // per-document idempotency plus deterministic ordering to keep
  // replays safe.
  const applied = await applyPlan({
    classId,
    schoolId: classRecord.schoolId,
    plan,
  });

  const summary: RosterSyncSummary = {
    classId,
    providerId: link.providerId,
    linkId,
    added: applied.added,
    reactivated: 0,
    unchanged: plan.unchanged,
    withdrawn: applied.withdrawn,
    unresolved: plan.unresolved,
    skipped: plan.skipped,
    upstreamRosterEmpty: upstreamRoster.length === 0,
  };

  safeLog(() =>
    log.info("lms.rosterSynchronized", {
      actorUserId: actor.uid,
      classId,
      providerId: link.providerId,
      linkId,
      added: summary.added,
      unchanged: summary.unchanged,
      withdrawn: summary.withdrawn,
      unresolved: summary.unresolved,
      skipped: summary.skipped,
      upstreamRosterEmpty: summary.upstreamRosterEmpty,
    }),
  );

  return summary;
}
