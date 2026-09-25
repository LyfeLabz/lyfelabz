import type {
  AssignmentRecord,
  LmsAssignmentPublicationRecord,
  LmsProviderId,
} from "../../shared";

import type {
  LmsAssignmentLiveState,
  LmsProviderAdapter,
  LmsSubmissionGrade,
} from "../providers/provider";
import { getProviderAdapter } from "../providers/registry";
import {
  classifyUpstreamReadError,
  createConnectionAccessResolver,
  loadOwnedPublication,
  storedGradingOf,
  succeededCourseworkIdOf,
} from "../shared/coursework-family";

// Canonical LIVE grade-destination preflight, shared by every route that
// reads or writes a Classroom grade (reconciliation preview/apply,
// automatic passback, Retry). A grade may only ever be written to a
// destination that passes this check freshly, immediately before the write
// decision:
//   1. the destination assignment is graded (its own grading snapshot);
//   2. it has a succeeded Classroom publication owned by its teacher;
//   3. the teacher's own connection is active (credential resolved through
//      the canonical resolver; its refresh is the only incidental write);
//   4. the live Classroom coursework exists, is PUBLISHED, is graded, and
//      its live maxPoints equals the stored grading maxPoints.
// Which assignment IS the destination is decided by the caller from the
// canonical Current resolution; this module never picks one itself, so
// historical coursework can never become a destination here.

export type GradeDestinationFailureStatus =
  | "currentUngraded"
  | "currentNotPublishedToClassroom"
  | "connectionUnavailable"
  | "courseworkNotFound"
  | "courseworkDeleted"
  | "courseworkNotPublished"
  | "courseworkUngraded"
  | "maxPointsMismatch"
  | "courseworkInaccessible"
  | "courseworkError";

export type LiveGradeDestination = {
  readonly assignmentId: string;
  readonly record: AssignmentRecord;
  readonly publication: LmsAssignmentPublicationRecord;
  readonly providerId: LmsProviderId;
  readonly adapter: LmsProviderAdapter;
  readonly accessToken: string;
  readonly lmsClassId: string;
  readonly lmsAssignmentId: string;
  readonly maxPoints: number;
  readonly liveState: LmsAssignmentLiveState;
  readonly liveTitle: string | null;
};

// What was observed, for reporting (never credential material).
export type GradeDestinationObservation = {
  readonly lmsAssignmentId: string | null;
  readonly storedMaxPoints: number | null;
  readonly liveMaxPoints: number | null;
  readonly liveState: LmsAssignmentLiveState | null;
  readonly liveTitle: string | null;
  readonly errorCode: string | null;
};

export type GradeDestinationResult =
  | {
      readonly ok: true;
      readonly destination: LiveGradeDestination;
      readonly observed: GradeDestinationObservation;
    }
  | {
      readonly ok: false;
      readonly status: GradeDestinationFailureStatus;
      readonly observed: GradeDestinationObservation;
    };

export async function resolveLiveGradeDestination(
  assignmentId: string,
  record: AssignmentRecord,
): Promise<GradeDestinationResult> {
  let observed: GradeDestinationObservation = {
    lmsAssignmentId: null,
    storedMaxPoints: null,
    liveMaxPoints: null,
    liveState: null,
    liveTitle: null,
    errorCode: null,
  };
  const fail = (
    status: GradeDestinationFailureStatus,
    extra: Partial<GradeDestinationObservation> = {},
  ): GradeDestinationResult => ({ ok: false, status, observed: { ...observed, ...extra } });

  const publication = await loadOwnedPublication(assignmentId, record, record.teacherId);
  const stored = storedGradingOf(publication, record);
  observed = { ...observed, storedMaxPoints: stored.maxPoints };
  if (record.classroomGrading?.mode !== "graded" || !stored.graded || stored.maxPoints === null) {
    return fail("currentUngraded");
  }
  const lmsAssignmentId = succeededCourseworkIdOf(publication);
  if (publication === undefined || lmsAssignmentId === null) {
    return fail("currentNotPublishedToClassroom");
  }
  observed = { ...observed, lmsAssignmentId };

  const access = await createConnectionAccessResolver(record.teacherId)(
    publication.connectionId,
  );
  if (!access.ok) return fail("connectionUnavailable");
  const adapter = getProviderAdapter(access.providerId);

  let snapshot;
  try {
    snapshot = await adapter.fetchAssignment({
      accessToken: access.accessToken,
      lmsClassId: publication.lmsClassId,
      lmsAssignmentId,
    });
  } catch (err) {
    const { kind, errorCode } = classifyUpstreamReadError(err);
    return fail(
      kind === "notFound"
        ? "courseworkNotFound"
        : kind === "inaccessible"
          ? "courseworkInaccessible"
          : "courseworkError",
      { errorCode },
    );
  }
  observed = {
    ...observed,
    liveState: snapshot.state,
    liveTitle: snapshot.title ?? null,
    liveMaxPoints: snapshot.maxPoints ?? null,
  };
  if (snapshot.state === "deleted") return fail("courseworkDeleted");
  if (snapshot.state !== "published") return fail("courseworkNotPublished");
  if (snapshot.maxPoints === undefined) return fail("courseworkUngraded");
  if (snapshot.maxPoints !== stored.maxPoints) return fail("maxPointsMismatch");

  return {
    ok: true,
    observed,
    destination: {
      assignmentId,
      record,
      publication,
      providerId: access.providerId,
      adapter,
      accessToken: access.accessToken,
      lmsClassId: publication.lmsClassId,
      lmsAssignmentId,
      maxPoints: stored.maxPoints,
      liveState: snapshot.state,
      liveTitle: snapshot.title ?? null,
    },
  };
}

export type StudentSubmissionRead =
  | { readonly kind: "found"; readonly submission: LmsSubmissionGrade }
  | { readonly kind: "none" }
  | { readonly kind: "ambiguous" };

// Fresh read of ONE student's live submission on the destination. Exactly
// one matching submission is required; zero or several are reported, never
// guessed at. Upstream failures propagate to the caller.
export async function readStudentSubmission(
  destination: Pick<LiveGradeDestination, "adapter" | "accessToken" | "lmsClassId" | "lmsAssignmentId">,
  studentProviderAccountId: string,
): Promise<StudentSubmissionRead> {
  const submissions = await destination.adapter.listSubmissionGrades({
    accessToken: destination.accessToken,
    lmsClassId: destination.lmsClassId,
    lmsAssignmentId: destination.lmsAssignmentId,
    studentProviderAccountId,
  });
  const matches = submissions.filter(
    (s) => s.studentProviderAccountId === studentProviderAccountId,
  );
  if (matches.length === 0) return { kind: "none" };
  if (matches.length > 1) return { kind: "ambiguous" };
  return { kind: "found", submission: matches[0] };
}
