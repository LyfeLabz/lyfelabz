import {
  lmsRosterMembershipsCollectionRef,
  resolveActiveUserIdByExternalIdentityDocId,
  userRecordDocRef,
} from "../../shared";

import { enrollmentIdFor } from "../../enrollments/enrollments-join-by-code";
import { createEnrollmentFromTrustedMembership } from "../../enrollments/membership-enrollment";
import {
  reactivateClassroomWithdrawnEnrollment,
  withdrawEnrollmentForClassroomSync,
} from "../../enrollments/classroom-enrollment-lifecycle";

// Teacher-requested roster refresh: reconcile ONE active Classroom-linked
// LyfeLabz class's enrollments with the Classroom roster just captured by
// `refreshClassRosterMemberships` (which has already brought the trusted
// membership cache up to date, including its own safe removals).
//
// Per Classroom member (identity hash from the fresh roster):
//   - No active LyfeLabz identity mapping, or the account is still
//     `provisioned` (never activated): nothing is created. The captured
//     membership is what lets the student's own first sign-in enroll them
//     (`materializeLmsEnrollmentsFromMembership`); counted as
//     `awaitingFirstSignIn`.
//   - An ACTIVE student account in this class's school: the enrollment is
//     created through the same canonical step first sign-in uses
//     (`createEnrollmentFromTrustedMembership`). An existing active
//     enrollment is left as it is (`alreadyEnrolled`). A `withdrawn`
//     enrollment is restored ONLY through the Classroom-managed reactivation
//     primitive, which requires durable provenance proving Classroom
//     synchronization withdrew it for this class's current link
//     (`reactivated`); a teacher withdrawal, a withdrawal with unknown
//     historical provenance, one from another link, and any transferred or
//     archived enrollment are never restored (`notReactivated`).
//   - Any other account (another school, not a student, suspended, or a
//     record that does not agree with the mapping): never enrolled
//     (`notMatched`). An unsafe match fails safe.
//
// Identity matching is exclusively the certified bridge: the identity hash
// is the doc id of the student's own `google.com` external identity
// mapping, resolved by `resolveActiveUserIdByExternalIdentityDocId` (the
// same reverse lookup membership removal uses). No provider identifier,
// email, or name participates.
//
// Removals: an active enrollment is withdrawn (with Classroom provenance,
// `withdrawEnrollmentForClassroomSync`) only for a student LyfeLabz
// knows was a member of THIS Classroom class and who is no longer in it (a
// `removed` membership for this link). Membership capture withdraws newly
// removed members itself; this pass re-applies the same withdrawal to every
// `removed` membership so a withdrawal interrupted by an earlier failure is
// completed on retry. Students added to the class some other way (for
// example by the teacher) are never withdrawn here. An empty upstream
// roster never withdraws anyone (capture marks no membership `removed`,
// and this pass is skipped). Withdrawal keeps the enrollment document and
// all of the student's work.
//
// Every step is idempotent, so a partially applied refresh is completed by
// running it again.

export type ClassEnrollmentReconciliationSummary = {
  // New active enrollments created for existing LyfeLabz students.
  readonly added: number;
  // Classroom members already actively enrolled in this class.
  readonly alreadyEnrolled: number;
  // Students whose Classroom-withdrawn enrollment in this class was restored
  // because they are back in the Classroom class (same enrollment reused).
  readonly reactivated: number;
  // Classroom members who have not activated LyfeLabz yet; they join this
  // class on their own first sign-in.
  readonly awaitingFirstSignIn: number;
  // Classroom members whose enrollment in this class was previously ended
  // and is not eligible for Classroom-managed reactivation (teacher
  // withdrawal, unknown historical provenance, another link, transferred,
  // or archived); left as it is.
  readonly notReactivated: number;
  // Classroom members whose LyfeLabz account could not be safely matched to
  // this class (another school, not a student, or not active).
  readonly notMatched: number;
  // Active enrollments withdrawn because the student left the Classroom
  // class (this refresh's capture plus any interrupted earlier withdrawal).
  readonly withdrawn: number;
};

// Withdraw the ACTIVE class enrollment of the LyfeLabz user behind one
// Classroom identity hash, if there is one (`active -> withdrawn` only, with
// Classroom provenance for `linkId`; the enrollment document and all of the
// student's history are kept). A member who never signed in has no identity
// mapping and no enrollment; a non-active enrollment is left exactly as it
// is. Returns whether a withdrawal was written. Idempotent.
export async function withdrawActiveEnrollmentForIdentity(input: {
  readonly classId: string;
  readonly linkId: string;
  readonly identityHash: string;
  readonly actorUid: string;
}): Promise<boolean> {
  const studentUserId = await resolveActiveUserIdByExternalIdentityDocId(input.identityHash);
  if (studentUserId === null) return false;
  return withdrawEnrollmentForClassroomSync({
    enrollmentId: enrollmentIdFor(input.classId, studentUserId),
    linkId: input.linkId,
    actorUid: input.actorUid,
  });
}

type MemberResolution =
  | { readonly kind: "awaitingFirstSignIn" }
  | { readonly kind: "notMatched" }
  | { readonly kind: "eligible"; readonly studentId: string };

async function resolveMember(
  identityHash: string,
  schoolId: string,
): Promise<MemberResolution> {
  const userId = await resolveActiveUserIdByExternalIdentityDocId(identityHash);
  if (userId === null) return { kind: "awaitingFirstSignIn" };
  const snap = await userRecordDocRef(userId).get();
  if (!snap.exists) return { kind: "notMatched" };
  const user = snap.data();
  if (!user || user.authUid !== userId) return { kind: "notMatched" };
  if (user.status === "provisioned") return { kind: "awaitingFirstSignIn" };
  if (user.status !== "active") return { kind: "notMatched" };
  if (user.role !== "student") return { kind: "notMatched" };
  if (user.schoolId !== schoolId) return { kind: "notMatched" };
  return { kind: "eligible", studentId: userId };
}

export async function reconcileClassEnrollmentsWithRoster(input: {
  readonly classId: string;
  readonly linkId: string;
  // The class's own (trusted) school.
  readonly schoolId: string;
  // The teacher who requested the refresh (audit actor).
  readonly actorUid: string;
  // Identity hashes of the fresh upstream roster.
  readonly upstreamHashes: ReadonlySet<string>;
  // Active enrollments already withdrawn by this refresh's capture.
  readonly withdrawnByCapture: number;
}): Promise<ClassEnrollmentReconciliationSummary> {
  const { classId, schoolId } = input;

  // Resolve every member first (reads only), then write in deterministic
  // order so replays produce the same write sequence.
  const orderedHashes = [...input.upstreamHashes].sort();
  const resolutions = await Promise.all(
    orderedHashes.map((hash) => resolveMember(hash, schoolId)),
  );

  let awaitingFirstSignIn = 0;
  let notMatched = 0;
  const eligible = new Set<string>();
  for (const resolution of resolutions) {
    if (resolution.kind === "awaitingFirstSignIn") awaitingFirstSignIn += 1;
    else if (resolution.kind === "notMatched") notMatched += 1;
    // Two hashes resolving to one account (structurally prevented by the
    // one-active-mapping-per-provider invariant) enroll that account once.
    else eligible.add(resolution.studentId);
  }

  let added = 0;
  let alreadyEnrolled = 0;
  let reactivated = 0;
  let notReactivated = 0;
  for (const studentId of [...eligible].sort()) {
    // eslint-disable-next-line no-await-in-loop
    const outcome = await createEnrollmentFromTrustedMembership({
      classId,
      schoolId,
      studentId,
      actor: { userId: input.actorUid, role: "teacher" },
      source: "teacherRosterRefresh",
    });
    if (outcome.kind === "created") {
      added += 1;
    } else if (outcome.status === "active") {
      alreadyEnrolled += 1;
    } else if (outcome.status === "withdrawn") {
      // Only Classroom-caused withdrawals for THIS link are restored; the
      // primitive re-checks provenance and status transactionally.
      // eslint-disable-next-line no-await-in-loop
      const reactivation = await reactivateClassroomWithdrawnEnrollment({
        enrollmentId: enrollmentIdFor(classId, studentId),
        classId,
        studentId,
        schoolId,
        linkId: input.linkId,
        actorUid: input.actorUid,
      });
      if (reactivation === "reactivated") reactivated += 1;
      else if (reactivation === "alreadyActive") alreadyEnrolled += 1;
      else notReactivated += 1;
    } else {
      notReactivated += 1;
    }
  }

  // Complete any withdrawal an earlier, interrupted refresh left behind.
  // Skipped for an empty roster, exactly like capture's own removals.
  let withdrawnRetried = 0;
  if (input.upstreamHashes.size > 0) {
    const membershipsSnap = await lmsRosterMembershipsCollectionRef()
      .where("linkId", "==", input.linkId)
      .get();
    const removed = membershipsSnap.docs
      .filter((doc) => {
        const data = doc.data();
        return (
          data.status === "removed" &&
          typeof data.identityHash === "string" &&
          data.identityHash.length > 0 &&
          !input.upstreamHashes.has(data.identityHash)
        );
      })
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const doc of removed) {
      // eslint-disable-next-line no-await-in-loop
      const withdrew = await withdrawActiveEnrollmentForIdentity({
        classId,
        linkId: input.linkId,
        identityHash: doc.data().identityHash,
        actorUid: input.actorUid,
      });
      if (withdrew) {
        withdrawnRetried += 1;
      }
    }
  }

  return {
    added,
    alreadyEnrolled,
    reactivated,
    awaitingFirstSignIn,
    notReactivated,
    notMatched,
    withdrawn: input.withdrawnByCapture + withdrawnRetried,
  };
}
