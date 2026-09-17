import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assignmentsCollectionRef,
  assignmentRecipientsCollectionRef,
  classDocRef,
  enrollmentsCollectionRef,
  log,
  requireDistrictContext,
  type AssignmentRecord,
  type AssignmentRecipientRecord,
  type AssignmentStatus,
  type ClassRecord,
  type EnrollmentRecord,
} from "../shared";

import { isCanonicalRecipientData } from "./assignment-recipients";

// Phase B Core, Curriculum Lifecycle Server/Data slice.
//
// Read-only, teacher-authorized callable that returns the assignment
// lifecycle state for a specific (classId, lessonSlug) pair. The later
// Curriculum UI consumes this to derive one of five mutually exclusive
// states without relying on the current slug-only local Set.
//
// This callable writes NOTHING. It never creates, updates, or deletes
// any Firestore document. It never calls any Google Classroom API.
// Recipient repair is performed only when the teacher explicitly
// invokes `assignmentsRecipientsReconcile`.

export type AssignmentsLifecycleStateRequest = {
  readonly classId: string;
  readonly lessonSlug: string;
};

export type AssignmentCandidate = {
  readonly assignmentId: string;
  readonly title: string;
  readonly status: Exclude<AssignmentStatus, "archived">;
  readonly publishedAt: number | null;
  readonly recipientCount: number;
  readonly activeEnrollmentCount: number;
  readonly missingRecipientCount: number;
};

export type AssignmentsLifecycleState =
  | "neverAssigned"
  | "onePublishedFullyCurrent"
  | "onePublishedMissingRecipients"
  | "multiplePublished"
  | "historicalOnly";

export type AssignmentsLifecycleStateResponse = {
  readonly state: AssignmentsLifecycleState;
  readonly candidates: ReadonlyArray<AssignmentCandidate>;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

async function assertActiveTeacherInDistrict(
  request: CallableRequest<unknown>,
): Promise<{
  readonly uid: string;
  readonly schoolId: string;
  readonly districtId: string;
}> {
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

function validateRequest(data: unknown): AssignmentsLifecycleStateRequest {
  if (data === null || typeof data !== "object") {
    throw new PlatformError(
      "invalid-argument",
      "Request must be an object with classId and lessonSlug.",
    );
  }
  const obj = data as Record<string, unknown>;
  if (!isNonEmptyString(obj.classId)) {
    throw new PlatformError(
      "invalid-argument",
      "classId is required and must be a non-empty string.",
    );
  }
  if (!isNonEmptyString(obj.lessonSlug)) {
    throw new PlatformError(
      "invalid-argument",
      "lessonSlug is required and must be a non-empty string.",
    );
  }
  return { classId: obj.classId, lessonSlug: obj.lessonSlug };
}

async function loadActiveEnrollmentStudentIds(
  classId: string,
  schoolId: string,
): Promise<ReadonlySet<string>> {
  const snapshot = await enrollmentsCollectionRef()
    .where("classId", "==", classId)
    .get();
  const seen = new Set<string>();
  for (const doc of snapshot.docs) {
    const data = doc.data() as EnrollmentRecord | undefined;
    if (!data) continue;
    if (data.classId !== classId) continue;
    if (data.schoolId !== schoolId) continue;
    if (data.status !== "active") continue;
    if (!isNonEmptyString(data.studentId)) continue;
    seen.add(data.studentId);
  }
  return seen;
}

async function loadCanonicalRecipientStudentIds(
  assignmentId: string,
  classId: string,
  actor: { readonly schoolId: string; readonly districtId: string },
  assignment: { readonly teacherId: string; readonly schoolId: string },
): Promise<ReadonlySet<string>> {
  const snapshot = await assignmentRecipientsCollectionRef(assignmentId).get();
  const seen = new Set<string>();
  for (const doc of snapshot.docs) {
    const data = doc.data() as AssignmentRecipientRecord | undefined;
    if (!data) continue;
    if (doc.id !== data.studentId) continue;
    if (data.assignmentId !== assignmentId) continue;
    if (data.classId !== classId) continue;
    if (data.teacherId !== assignment.teacherId) continue;
    if (data.schoolId !== assignment.schoolId) continue;
    if (data.schoolId !== actor.schoolId) continue;
    if (data.districtId !== actor.districtId) continue;
    if (!isCanonicalRecipientData(data, {
      assignmentId,
      studentId: data.studentId,
      schoolId: actor.schoolId,
      districtId: actor.districtId,
    })) continue;
    if (!isNonEmptyString(data.studentId)) continue;
    seen.add(data.studentId);
  }
  return seen;
}

function deriveState(
  candidates: ReadonlyArray<AssignmentCandidate>,
): AssignmentsLifecycleState {
  const published = candidates.filter((c) => c.status === "published");
  if (candidates.length === 0) return "neverAssigned";
  if (published.length === 0) return "historicalOnly";
  if (published.length > 1) return "multiplePublished";
  if (published[0].missingRecipientCount > 0) {
    return "onePublishedMissingRecipients";
  }
  return "onePublishedFullyCurrent";
}

async function assignmentsLifecycleStateHandler(
  request: CallableRequest<unknown>,
): Promise<AssignmentsLifecycleStateResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  const classSnap = await classDocRef(input.classId).get();
  if (!classSnap.exists) {
    throw new PlatformError(
      "assignments.classNotFound",
      "Class not found.",
    );
  }
  const classData: ClassRecord | undefined = classSnap.data();
  if (!classData) {
    throw new PlatformError(
      "assignments.classNotFound",
      "Class data unavailable.",
    );
  }
  if (
    classData.teacherId !== actor.uid ||
    classData.schoolId !== actor.schoolId
  ) {
    throw new PlatformError(
      "assignments.forbidden",
      "Caller does not own this class.",
    );
  }

  const assignmentSnapshot = await assignmentsCollectionRef()
    .where("classId", "==", input.classId)
    .where("lessonSlug", "==", input.lessonSlug)
    .get();

  const raw: Array<{
    readonly assignmentId: string;
    readonly record: AssignmentRecord;
  }> = [];
  for (const doc of assignmentSnapshot.docs) {
    const data = doc.data();
    if (!data) continue;
    if (data.teacherId !== actor.uid) continue;
    if (data.schoolId !== actor.schoolId) continue;
    if (data.classId !== input.classId) continue;
    if (data.lessonSlug !== input.lessonSlug) continue;
    if (data.status === "archived") continue;
    raw.push({ assignmentId: doc.id, record: data });
  }

  if (raw.length === 0) {
    safeLog(() =>
      log.info("assignments.lifecycleState", {
        classId: input.classId,
        lessonSlug: input.lessonSlug,
        state: "neverAssigned",
      }),
    );
    return { state: "neverAssigned", candidates: [] };
  }

  const publishedAssignments = raw.filter(
    (r) => r.record.status === "published",
  );

  let activeEnrollments: ReadonlySet<string> | null = null;
  if (publishedAssignments.length > 0) {
    activeEnrollments = await loadActiveEnrollmentStudentIds(
      input.classId,
      actor.schoolId,
    );
  }

  const candidates: AssignmentCandidate[] = [];
  for (const { assignmentId, record } of raw) {
    if (record.status === "published" && activeEnrollments !== null) {
      const canonicalRecipients = await loadCanonicalRecipientStudentIds(
        assignmentId,
        input.classId,
        actor,
        record,
      );

      let missingCount = 0;
      for (const studentId of activeEnrollments) {
        if (!canonicalRecipients.has(studentId)) {
          missingCount++;
        }
      }

      const title =
        typeof record.title === "string" && record.title.length > 0
          ? record.title
          : record.lessonSlug;

      let publishedAt: number | null = null;
      const ts = record.publishedAt;
      if (
        ts &&
        typeof (ts as { toMillis?: () => number }).toMillis === "function"
      ) {
        publishedAt = (ts as { toMillis: () => number }).toMillis();
      }

      candidates.push({
        assignmentId,
        title,
        status: "published",
        publishedAt,
        recipientCount: canonicalRecipients.size,
        activeEnrollmentCount: activeEnrollments.size,
        missingRecipientCount: missingCount,
      });
    } else if (
      record.status === "closed" ||
      record.status === "draft"
    ) {
      const title =
        typeof record.title === "string" && record.title.length > 0
          ? record.title
          : record.lessonSlug;

      let publishedAt: number | null = null;
      if (record.status === "closed") {
        const ts = record.publishedAt;
        if (
          ts &&
          typeof (ts as { toMillis?: () => number }).toMillis === "function"
        ) {
          publishedAt = (ts as { toMillis: () => number }).toMillis();
        }
      }

      candidates.push({
        assignmentId,
        title,
        status: record.status,
        publishedAt,
        recipientCount: 0,
        activeEnrollmentCount: 0,
        missingRecipientCount: 0,
      });
    }
  }

  candidates.sort((a, b) => {
    if (a.status !== b.status) {
      const order: Record<string, number> = {
        published: 0,
        closed: 1,
        draft: 2,
      };
      return (order[a.status] ?? 3) - (order[b.status] ?? 3);
    }
    return a.assignmentId < b.assignmentId ? -1 : 1;
  });

  const state = deriveState(candidates);

  safeLog(() =>
    log.info("assignments.lifecycleState", {
      classId: input.classId,
      lessonSlug: input.lessonSlug,
      state,
      candidateCount: candidates.length,
    }),
  );

  return { state, candidates };
}

export const assignmentsLifecycleState = platformCallable(
  assignmentsLifecycleStateHandler,
);

export const __assignmentsLifecycleStateHandler =
  assignmentsLifecycleStateHandler;
