import type { AttemptsListForStudentCallable } from "../assignments/detail/attempts-wire";
import type { AssessmentRevisionContentReader } from "../assignments/detail/question-summary";

// Student Support Access (PDR-032): firebase-free types and helpers shared by
// the wire (`./wire.ts`) and the surfaces, so surfaces never load the
// Firebase SDK.

export type SharedStudent = {
  readonly grantId: string;
  readonly classId: string;
  readonly classTitle: string;
  readonly studentId: string;
  readonly studentDisplayName: string;
  readonly ownerDisplayName: string;
};

export type SupportGrant = {
  readonly grantId: string;
  readonly classId: string;
  readonly studentId: string;
  readonly studentDisplayName: string;
  readonly granteeDisplayName: string;
  readonly granteeEmail: string | null;
};

export type SupportGrantFailureReason =
  | "invalidEmail"
  | "granteeUnavailable"
  | "studentNotEnrolled"
  | "recordInconsistent"
  | "writeConflict"
  | "unavailable";

// One entry per (student, recipient) pair of `supportAccessGrantMany`
// (STUDENT_SUPPORT_ACCESS.md section 3.1).
export type SupportGrantManyResult = {
  readonly studentId: string;
  readonly granteeEmail: string;
  readonly outcome: "shared" | "alreadyShared" | "failed";
  readonly reason: SupportGrantFailureReason | null;
};

export type SupportRevokeManyResult = {
  readonly grantId: string;
  readonly outcome: "revoked" | "alreadyRevoked" | "failed";
};

export type StudentSupportSeam = {
  // Grantee: students shared with the signed-in teacher.
  readonly listShared: () => Promise<ReadonlyArray<SharedStudent>>;
  // Owner: active grants on one owned class.
  readonly listForClass: (classId: string) => Promise<ReadonlyArray<SupportGrant>>;
  // Owner: share each student with each recipient. Per-pair results;
  // partial success is normal.
  readonly grantMany: (input: {
    readonly classId: string;
    readonly studentIds: ReadonlyArray<string>;
    readonly granteeEmails: ReadonlyArray<string>;
  }) => Promise<ReadonlyArray<SupportGrantManyResult>>;
  readonly revoke: (grantId: string) => Promise<void>;
  readonly revokeMany: (grantIds: ReadonlyArray<string>) => Promise<ReadonlyArray<SupportRevokeManyResult>>;
  // Student-scoped attempts (owner or grantee); the grantee's Student Detail
  // source in place of the owner-only class-wide list.
  readonly listAttemptsForStudent: AttemptsListForStudentCallable;
  // Immutable assessment revision text for Student Detail question review
  // (owners and grantees; Rules allow active-user `get`).
  readonly revisionContent: AssessmentRevisionContentReader | null;
};

// The server's PlatformError id travels in `HttpsError.details.code`
// (same convention as `isStaleGradeImprovementError`).
export function supportAccessErrorCode(err: unknown): string | null {
  if (err === null || typeof err !== "object") return null;
  const details = (err as { details?: unknown }).details;
  if (details === null || typeof details !== "object") return null;
  const code = (details as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}
