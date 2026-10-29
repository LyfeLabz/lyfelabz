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
  // The class record's `block`, read by the server at list time (null when
  // absent, or from a server that predates the field).
  readonly classBlock: string | null;
};

// "Mr. Brown · Science 7 · B Block": classroom teacher, class, block. The
// block is omitted when absent or when the class name already carries it
// ("Science 7B", "Science B Block", "Block B Science"), so it never repeats.
export function sharedStudentContextLabel(student: SharedStudent): string {
  const parts = [student.ownerDisplayName, student.classTitle];
  // A block stored as "Block B" or "B Block" is the block "B".
  const block = (student.classBlock ?? "").trim().replace(/^block\s+|\s+block$/i, "").trim();
  if (block.length > 0 && !classTitleIncludesBlock(student.classTitle, block)) {
    parts.push(`${block} Block`);
  }
  return parts.join(" · ");
}

export function classTitleIncludesBlock(title: string, block: string): boolean {
  const b = block.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    new RegExp(`(^|[^A-Za-z0-9])(block\\s*${b}|${b}\\s*block)([^A-Za-z0-9]|$)`, "i").test(title) ||
    new RegExp(`(^|[^A-Za-z0-9])${b}([^A-Za-z0-9]|$)`).test(title) ||
    new RegExp(`[0-9]${b}([^A-Za-z0-9]|$)`).test(title)
  );
}

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
