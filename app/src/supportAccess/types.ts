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

export type StudentSupportSeam = {
  // Grantee: students shared with the signed-in teacher.
  readonly listShared: () => Promise<ReadonlyArray<SharedStudent>>;
  // Owner: active grants on one owned class.
  readonly listForClass: (classId: string) => Promise<ReadonlyArray<SupportGrant>>;
  readonly grant: (input: {
    readonly classId: string;
    readonly studentId: string;
    readonly granteeEmail: string;
  }) => Promise<SupportGrant>;
  readonly revoke: (grantId: string) => Promise<void>;
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
