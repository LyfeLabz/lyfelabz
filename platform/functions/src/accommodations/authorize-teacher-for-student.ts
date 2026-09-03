import type { Transaction } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  classDocRef,
  enrollmentDocRef,
  requireDistrictContext,
} from "../shared";
import { enrollmentIdFor } from "../enrollments/enrollments-join-by-code";

// F5.2 Implementation Specification §4 - the V1 teacher-authorization
// invariant for the differentiation accommodation surface, verified per
// call. No reusable teacher->student authorization combinator exists
// elsewhere in the platform; this module assembles the invariant from the
// same class-ownership and enrollment primitives `enrollmentsSetStatus`
// and `enrollmentsTeacherAdd` already use.

export type AccommodationTeacherActor = {
  readonly uid: string;
  readonly schoolId: string;
  readonly districtId: string;
};

// Shared "authenticated, verified, active teacher" gate. A `users/{uid}`
// record only reaches `status: "active"` after teacher verification
// (PLATFORM_STATE_MACHINE.md §3), so `requireDistrictContext`'s active-only
// check already establishes "verified"; this adds the role check.
export async function assertActiveTeacherInDistrict(
  request: CallableRequest<unknown>,
): Promise<AccommodationTeacherActor> {
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

// F5.2 §4: "actor is an authenticated, verified, `active` teacher T;
// request names `studentId S`, `classId C`; server verifies in one
// consistent read set that `classes/{C}` is active with
// `teacherId == T.uid` and `schoolId == T.schoolId`, and
// `enrollments/{C}__{S}` is active. Same-school is the enforced boundary;
// `classId` is claimed context granting nothing."
//
// Every failure mode - class not found, class not owned, class inactive,
// cross-school class, enrollment not found, enrollment inactive, enrollment
// for a different student/class/school - collapses to the SAME
// `accommodations.forbidden` refusal. Per F5.2 §4 Op A: "refusals never
// reveal record existence." A caller can never distinguish "this class
// doesn't exist" from "this class exists but isn't yours" from "this
// student isn't enrolled in it."
//
// Pass `tx` to re-verify the invariant transactionally. `accommodationsSet`
// pre-checks outside a transaction for a cheap early refusal, then
// re-checks inside the CAS transaction (mirroring `classesActivate`'s
// pre-check + re-check-inside-transaction pattern) so a concurrent
// class/enrollment change between the two reads cannot leave a stale
// authorization decision standing.
export async function assertTeacherAuthorizedForStudent(
  actor: AccommodationTeacherActor,
  classId: string,
  studentId: string,
  tx?: Transaction,
): Promise<void> {
  const classRef = classDocRef(classId);
  const classSnap = tx ? await tx.get(classRef) : await classRef.get();
  const classRecord = classSnap.exists ? classSnap.data() : undefined;
  const classOk =
    !!classRecord &&
    classRecord.status === "active" &&
    classRecord.teacherId === actor.uid &&
    classRecord.schoolId === actor.schoolId;

  const enrollmentRef = enrollmentDocRef(enrollmentIdFor(classId, studentId));
  const enrollmentSnap = tx
    ? await tx.get(enrollmentRef)
    : await enrollmentRef.get();
  const enrollmentRecord = enrollmentSnap.exists
    ? enrollmentSnap.data()
    : undefined;
  const enrollmentOk =
    !!enrollmentRecord &&
    enrollmentRecord.status === "active" &&
    enrollmentRecord.studentId === studentId &&
    enrollmentRecord.classId === classId &&
    enrollmentRecord.schoolId === actor.schoolId;

  if (!classOk || !enrollmentOk) {
    throw new PlatformError(
      "accommodations.forbidden",
      "Caller is not authorized to access this student's accommodation configuration.",
    );
  }
}
