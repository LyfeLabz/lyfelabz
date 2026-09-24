import type { Timestamp } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  classDocRef,
  lmsAssignmentPublicationDocRef,
  lmsConnectionDocRef,
  type AssignmentRecord,
  type AssignmentStatus,
  type LmsAssignmentPublicationRecord,
  type LmsAssignmentPublicationStatus,
  type LmsProviderId,
} from "../shared";
import {
  createClassAssignmentsLoader,
  resolveCurrentOccurrenceGroup,
  type OccurrenceScope,
} from "../assignments/current-occurrence-group";

import {
  ensureGoogleClassroomProductionBindings,
  googleClassroomProductionSecrets,
} from "./providers/google-classroom/config-firebase";
import type { LmsAssignmentLiveState, LmsAssignmentSnapshot } from "./providers/provider";
import { getProviderAdapter } from "./providers/registry";
import { assertAuthenticatedTeacherForLms, requireNonEmptyString } from "./shared/actor";
import { resolveLiveCredential } from "./tokens/credential-resolver";

// lmsCourseworkInspect
//
// Teacher-facing, READ-ONLY Classroom coursework health diagnostic for one
// class + lesson family. LyfeLabz stores the Classroom coursework id each
// successful publication created, but nothing re-checks that coursework
// afterwards: a teacher can delete it, or change its points, in Classroom.
// This callable observes the live configuration of every coursework item
// the family's publication records point at, and compares it with what
// LyfeLabz recorded at publication time.
//
// Contract:
//   - Caller: an active teacher (canonical LMS actor gate) who owns the
//     LyfeLabz class in their own authoritative school.
//   - Input: only `classId` + `lessonSlug`. Classroom course and coursework
//     ids are NEVER accepted from the caller; they are read server-side
//     from publication records whose ownership, class, and assignment all
//     match the caller's own family, so the callable cannot probe
//     arbitrary Classroom resources.
//   - Classroom access: one `fetchAssignment` (`courseWork.get`) per stored
//     coursework id, using the owning teacher's connection through the
//     canonical credential resolver. The resolver's normal access-token
//     refresh (and its persistence) is the ONLY write this callable can
//     cause.
//   - Observation only: never writes an assignment, publication, Current
//     pointer, grade, or Classroom resource; never calls the grade-passback
//     engine. A missing Current coursework is reported, never acted on.
//   - Never returns or logs credential material.

export type LmsCourseworkInspectRequest = {
  readonly classId: string;
  readonly lessonSlug: string;
};

export type LmsCourseworkExistence =
  | "exists"
  | "notFound"
  | "inaccessible"
  | "error"
  | "notChecked";

export type LmsCourseworkHealthStatus =
  | "healthy"
  | "notPublishedToClassroom"
  | "publicationNotSucceeded"
  | "connectionUnavailable"
  | "courseworkNotFound"
  | "courseworkNotPublished"
  | "gradingMismatch"
  | "maxPointsMismatch"
  | "inaccessible"
  | "error";

export type LmsCourseworkInspectAssignment = {
  readonly assignmentId: string;
  readonly assignmentStatus: AssignmentStatus;
  readonly isCurrent: boolean;
  readonly createdAt: string | null;
  readonly publishedAt: string | null;
  readonly stored: {
    readonly gradingMode: "graded" | "ungraded";
    readonly maxPoints: number | null;
    readonly publicationStatus: LmsAssignmentPublicationStatus | null;
    readonly lmsAssignmentId: string | null;
  };
  readonly live: {
    readonly existence: LmsCourseworkExistence;
    readonly errorCode: string | null;
    readonly title: string | null;
    readonly state: LmsAssignmentLiveState | null;
    readonly maxPoints: number | null;
    readonly createdAt: string | null;
    readonly updatedAt: string | null;
    readonly dueDate: string | null;
    readonly dueTime: string | null;
    readonly lmsAssignmentUrl: string | null;
  };
  readonly gradingModeAgrees: boolean | null;
  readonly maxPointsAgree: boolean | null;
  readonly status: LmsCourseworkHealthStatus;
};

export type LmsCourseworkInspectResponse = {
  readonly classId: string;
  readonly lessonSlug: string;
  readonly currentResolution: "valid" | "inactive" | "unresolved";
  readonly currentAssignmentId: string | null;
  readonly assignments: readonly LmsCourseworkInspectAssignment[];
};

const CLASS_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;
const LESSON_SLUG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,126}[A-Za-z0-9])?$/;

function isoOf(value: Timestamp | undefined): string | null {
  return value !== undefined && typeof value.toDate === "function"
    ? value.toDate().toISOString()
    : null;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

const NOT_CHECKED_LIVE: LmsCourseworkInspectAssignment["live"] = {
  existence: "notChecked",
  errorCode: null,
  title: null,
  state: null,
  maxPoints: null,
  createdAt: null,
  updatedAt: null,
  dueDate: null,
  dueTime: null,
  lmsAssignmentUrl: null,
};

function liveFromSnapshot(
  snapshot: LmsAssignmentSnapshot,
): LmsCourseworkInspectAssignment["live"] {
  return {
    existence: "exists",
    errorCode: null,
    title: snapshot.title ?? null,
    state: snapshot.state,
    maxPoints: snapshot.maxPoints ?? null,
    createdAt: snapshot.createdAt ?? null,
    updatedAt: snapshot.updatedAt ?? null,
    dueDate: snapshot.dueDate ?? null,
    dueTime: snapshot.dueTime ?? null,
    lmsAssignmentUrl: snapshot.lmsAssignmentUrl ?? null,
  };
}

function liveFromError(err: unknown): LmsCourseworkInspectAssignment["live"] {
  const errorCode =
    err instanceof PlatformError ? err.code : "lms.upstreamCallFailed";
  const existence: LmsCourseworkExistence =
    errorCode === "lms.upstreamResourceNotFound"
      ? "notFound"
      : errorCode === "lms.upstreamAuthorizationFailed" ||
          errorCode === "lms.insufficientScope"
        ? "inaccessible"
        : "error";
  return { ...NOT_CHECKED_LIVE, existence, errorCode };
}

function statusFor(
  live: LmsCourseworkInspectAssignment["live"],
  gradingModeAgrees: boolean | null,
  maxPointsAgree: boolean | null,
): LmsCourseworkHealthStatus {
  switch (live.existence) {
    case "notFound":
      return "courseworkNotFound";
    case "inaccessible":
      return "inaccessible";
    case "error":
      return "error";
    case "notChecked":
      return "connectionUnavailable";
    case "exists":
      break;
  }
  if (live.state !== "published") return "courseworkNotPublished";
  if (gradingModeAgrees === false) return "gradingMismatch";
  if (maxPointsAgree === false) return "maxPointsMismatch";
  return "healthy";
}

type ConnectionAccess =
  | {
      readonly ok: true;
      readonly providerId: LmsProviderId;
      readonly accessToken: string;
    }
  | { readonly ok: false };

async function handler(
  request: CallableRequest<unknown>,
): Promise<LmsCourseworkInspectResponse> {
  ensureGoogleClassroomProductionBindings();
  const actor = await assertAuthenticatedTeacherForLms(request);
  if (request.data === null || typeof request.data !== "object") {
    throw new PlatformError(
      "lms.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = request.data as Record<string, unknown>;
  const classId = requireNonEmptyString(
    payload.classId,
    "lms.invalidClassId",
    "classId must be a non-empty string.",
  );
  const lessonSlug = requireNonEmptyString(
    payload.lessonSlug,
    "lms.invalidLessonSlug",
    "lessonSlug must be a non-empty string.",
  );
  if (!CLASS_ID_PATTERN.test(classId)) {
    throw new PlatformError("lms.invalidClassId", "classId is malformed.");
  }
  if (!LESSON_SLUG_PATTERN.test(lessonSlug)) {
    throw new PlatformError("lms.invalidLessonSlug", "lessonSlug is malformed.");
  }

  // Class ownership in the caller's authoritative school. A missing class
  // and a foreign class are indistinguishable to the caller.
  const classSnapshot = await classDocRef(classId).get();
  const cls = classSnapshot.exists ? classSnapshot.data() : undefined;
  if (!cls || cls.teacherId !== actor.uid || cls.schoolId !== actor.schoolId) {
    throw new PlatformError("lms.forbidden", "Caller does not own this class.");
  }

  const scope: OccurrenceScope = {
    classId,
    lessonSlug,
    teacherId: actor.uid,
    schoolId: actor.schoolId,
  };
  const loader = createClassAssignmentsLoader();
  const group = await resolveCurrentOccurrenceGroup(scope, actor.districtId, loader);
  const currentAssignmentId =
    group.resolution === "unresolved" ? null : group.currentAssignmentId;

  const occurrences = (await loader(classId))
    .filter(
      ({ record }) =>
        record.classId === scope.classId &&
        record.lessonSlug === scope.lessonSlug &&
        record.teacherId === scope.teacherId &&
        record.schoolId === scope.schoolId,
    )
    .sort((a, b) => {
      const at = a.record.createdAt.toMillis();
      const bt = b.record.createdAt.toMillis();
      return at !== bt ? at - bt : a.assignmentId.localeCompare(b.assignmentId);
    });

  // One credential resolution per connection, shared across this family.
  const connections = new Map<string, Promise<ConnectionAccess>>();
  const accessFor = (connectionId: string): Promise<ConnectionAccess> => {
    let pending = connections.get(connectionId);
    if (!pending) {
      pending = (async (): Promise<ConnectionAccess> => {
        const snapshot = await lmsConnectionDocRef(connectionId).get();
        const connection = snapshot.exists ? snapshot.data() : undefined;
        if (
          !connection ||
          connection.teacherId !== actor.uid ||
          connection.status !== "active"
        ) {
          return { ok: false };
        }
        const bundle = await resolveLiveCredential(connection.tokenRef);
        return {
          ok: true,
          providerId: connection.providerId,
          accessToken: bundle.accessToken,
        };
      })();
      connections.set(connectionId, pending);
    }
    return pending;
  };

  const assignments: LmsCourseworkInspectAssignment[] = [];
  for (const { assignmentId, record } of occurrences) {
    assignments.push(
      await inspectOne(assignmentId, record, currentAssignmentId, actor.uid, accessFor),
    );
  }

  return {
    classId,
    lessonSlug,
    currentResolution: group.resolution,
    currentAssignmentId,
    assignments,
  };
}

async function inspectOne(
  assignmentId: string,
  record: AssignmentRecord,
  currentAssignmentId: string | null,
  ownerUid: string,
  accessFor: (connectionId: string) => Promise<ConnectionAccess>,
): Promise<LmsCourseworkInspectAssignment> {
  const base = {
    assignmentId,
    assignmentStatus: record.status,
    isCurrent: assignmentId === currentAssignmentId,
    createdAt: isoOf(record.createdAt),
    publishedAt: isoOf(record.publishedAt),
  };
  const assignmentGrading = record.classroomGrading;

  let publication: LmsAssignmentPublicationRecord | undefined;
  const publicationId = record.lmsPublicationRef;
  if (typeof publicationId === "string" && publicationId.length > 0) {
    const snapshot = await lmsAssignmentPublicationDocRef(publicationId).get();
    const data = snapshot.exists ? snapshot.data() : undefined;
    // A publication is honored only when it belongs to this exact
    // assignment, class, and owner; anything else is treated as absent.
    if (
      data &&
      data.assignmentId === assignmentId &&
      data.classId === record.classId &&
      data.ownerUid === ownerUid
    ) {
      publication = data;
    }
  }

  // What LyfeLabz told Classroom: the publication's own grading snapshot
  // when present, else the assignment's configuration.
  const grading = publication?.classroomGrading ?? assignmentGrading;
  const storedGraded =
    grading?.mode === "graded" && isPositiveFiniteNumber(grading.maxPoints);
  const storedMaxPoints = storedGraded ? grading.maxPoints : null;
  const lmsAssignmentId =
    publication?.status === "succeeded" &&
    typeof publication.lmsAssignmentId === "string" &&
    publication.lmsAssignmentId.length > 0
      ? publication.lmsAssignmentId
      : null;
  const stored = {
    gradingMode: storedGraded ? ("graded" as const) : ("ungraded" as const),
    maxPoints: storedMaxPoints,
    publicationStatus: publication?.status ?? null,
    lmsAssignmentId,
  };

  if (!publication) {
    return {
      ...base,
      stored,
      live: NOT_CHECKED_LIVE,
      gradingModeAgrees: null,
      maxPointsAgree: null,
      status: "notPublishedToClassroom",
    };
  }
  if (lmsAssignmentId === null) {
    return {
      ...base,
      stored,
      live: NOT_CHECKED_LIVE,
      gradingModeAgrees: null,
      maxPointsAgree: null,
      status: "publicationNotSucceeded",
    };
  }

  const access = await accessFor(publication.connectionId);
  if (!access.ok) {
    return {
      ...base,
      stored,
      live: NOT_CHECKED_LIVE,
      gradingModeAgrees: null,
      maxPointsAgree: null,
      status: "connectionUnavailable",
    };
  }

  let live: LmsCourseworkInspectAssignment["live"];
  try {
    const snapshot = await getProviderAdapter(access.providerId).fetchAssignment({
      accessToken: access.accessToken,
      lmsClassId: publication.lmsClassId,
      lmsAssignmentId,
    });
    live = liveFromSnapshot(snapshot);
  } catch (err) {
    live = liveFromError(err);
  }

  const liveGraded = live.maxPoints !== null;
  const gradingModeAgrees =
    live.existence === "exists" ? liveGraded === storedGraded : null;
  const maxPointsAgree =
    live.existence === "exists" && storedGraded && liveGraded
      ? live.maxPoints === storedMaxPoints
      : null;

  return {
    ...base,
    stored,
    live,
    gradingModeAgrees,
    maxPointsAgree,
    status: statusFor(live, gradingModeAgrees, maxPointsAgree),
  };
}

export const lmsCourseworkInspect = platformCallable(
  { secrets: [...googleClassroomProductionSecrets] },
  handler,
);
export const __lmsCourseworkInspectHandler = handler;
