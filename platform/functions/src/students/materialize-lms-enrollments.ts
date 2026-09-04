import { FieldValue } from "firebase-admin/firestore";

import {
  PlatformError,
  classDocRef,
  enrollmentCreationDocRef,
  enrollmentDocRef,
  listActiveExternalIdentityHashesForUser,
  lmsRosterMembershipsCollectionRef,
  log,
  writeAuditEvent,
  type EnrollmentCreationWrite,
} from "../shared";

import { enrollmentIdFor } from "../enrollments/enrollments-join-by-code";

// Sprint 29G.5K - zero-coordination enrollment materialization.
//
// Bridges the two independently trusted facts:
//   1. Trusted Classroom membership: the server-only
//      `lmsRosterMemberships` cache captured at import/refresh time, keyed
//      by the canonical identity hash.
//   2. Authenticated identity: the student's own `google.com` external
//      identity mapping, created by `authOnUserCreate` on their first
//      Google sign-in. Its document id IS the same identity hash.
//
// Only when a stored `member` membership's hash equals one of the
// authenticated student's own active identity hashes does this create the
// canonical enrollment. Membership presence alone never enrolls anyone;
// the student's own Google authentication is mandatory and supplies the
// matching hash server-side. A client can neither forge the membership
// (server-only collection) nor forge the hash (derived from their verified
// Firebase Auth `google.com` provider identity).
//
// This runs at the start of the LMS onboarding activation for a
// `provisioned` student, BEFORE `resolveLmsSchoolId`, so the student's own
// FIRST `Continue with Google Classroom` both enrolls and activates them -
// with no teacher roster sync and no second student action.

export type MaterializeLmsEnrollmentsResult = {
  // Number of NEW active enrollments created this call (idempotent replays
  // that find an existing enrollment do not count).
  readonly created: number;
  // Number of classes the student was matched into (created or already
  // enrolled).
  readonly matchedClasses: number;
  // The single resolved school when all matches agree; null when there were
  // no matches. Cross-school ambiguity throws before returning.
  readonly schoolId: string | null;
};

// Match the authenticated student against trusted memberships and
// materialize enrollments. Idempotent: an existing enrollment at the
// deterministic id is preserved, not duplicated. Cross-school membership
// ambiguity fails closed (`students.conflictingLmsEnrollment`) BEFORE any
// enrollment is written, so a student is never partially enrolled across
// incompatible schools.
export async function materializeLmsEnrollmentsFromMembership(input: {
  readonly uid: string;
}): Promise<MaterializeLmsEnrollmentsResult> {
  const { uid } = input;

  // The student's own active Google identity hashes. Normally exactly one.
  const identityHashes = await listActiveExternalIdentityHashesForUser(
    uid,
    "google.com",
  );
  if (identityHashes.length === 0) {
    return { created: 0, matchedClasses: 0, schoolId: null };
  }

  // Collect distinct target classes across all of the student's identity
  // hashes. A `member` membership references an imported class; validate
  // the class is an active LMS class before enrolling.
  const targetsByClassId = new Map<
    string,
    { readonly classId: string; readonly schoolId: string }
  >();
  const schoolIds = new Set<string>();

  for (const identityHash of identityHashes) {
    // eslint-disable-next-line no-await-in-loop
    const membershipSnap = await lmsRosterMembershipsCollectionRef()
      .where("identityHash", "==", identityHash)
      .where("status", "==", "member")
      .get();

    for (const doc of membershipSnap.docs) {
      const membership = doc.data();
      const classId = membership.classId;
      if (typeof classId !== "string" || classId.length === 0) continue;
      if (targetsByClassId.has(classId)) continue;

      // eslint-disable-next-line no-await-in-loop
      const classSnap = await classDocRef(classId).get();
      if (!classSnap.exists) continue;
      const classRecord = classSnap.data();
      if (!classRecord) continue;
      // A membership only enrolls when its class is an ACTIVE LMS class.
      // A `needsSetup` (grade/block not yet confirmed) or `archived` class
      // is skipped, exactly as `resolveLmsSchoolId` requires.
      if (classRecord.status !== "active") continue;
      if (classRecord.enrollmentSource !== "lms") continue;
      if (
        typeof classRecord.schoolId !== "string" ||
        classRecord.schoolId.length === 0
      ) {
        continue;
      }

      targetsByClassId.set(classId, {
        classId,
        schoolId: classRecord.schoolId,
      });
      schoolIds.add(classRecord.schoolId);
    }
  }

  if (targetsByClassId.size === 0) {
    return { created: 0, matchedClasses: 0, schoolId: null };
  }

  // Cross-school ambiguity fails closed BEFORE any write. Multiple classes
  // in the SAME school are the normal multi-class case and are allowed.
  if (schoolIds.size > 1) {
    throw new PlatformError(
      "students.conflictingLmsEnrollment",
      "This account is a member of Classroom classes across more than one school; activation cannot proceed.",
    );
  }
  const resolvedSchoolId = [...schoolIds][0];

  // Deterministic ordering so replays produce identical write/audit order.
  const targets = [...targetsByClassId.values()].sort((a, b) =>
    a.classId < b.classId ? -1 : a.classId > b.classId ? 1 : 0,
  );

  let created = 0;
  for (const target of targets) {
    const enrollmentId = enrollmentIdFor(target.classId, uid);
    // eslint-disable-next-line no-await-in-loop
    const existing = await enrollmentDocRef(enrollmentId).get();
    if (existing.exists) {
      // Idempotent: preserve whatever lifecycle state exists. A prior
      // `active` enrollment is left intact; a terminal enrollment is NOT
      // reactivated here (no authorized inactive->active transition), which
      // matches the certified roster-sync engine's posture.
      continue;
    }
    const creation: EnrollmentCreationWrite = {
      studentId: uid,
      classId: target.classId,
      schoolId: target.schoolId,
      status: "active",
      enrolledAt: FieldValue.serverTimestamp(),
    };
    // eslint-disable-next-line no-await-in-loop
    await enrollmentCreationDocRef(enrollmentId).set(creation);
    created += 1;

    // eslint-disable-next-line no-await-in-loop
    await writeAuditEvent({
      actorUserId: uid,
      actorRole: "student",
      action: "lms.membershipEnrollmentCreated",
      targetType: "class",
      targetId: target.classId,
      schoolId: target.schoolId,
      payload: { providerId: "googleClassroom", source: "lmsMembership" },
    });
  }

  try {
    log.info("lms.membershipEnrollmentsMaterialized", {
      uid,
      matchedClasses: targetsByClassId.size,
      created,
    });
  } catch {
    // Logging is observability, not lifecycle.
  }

  return {
    created,
    matchedClasses: targetsByClassId.size,
    schoolId: resolvedSchoolId,
  };
}
