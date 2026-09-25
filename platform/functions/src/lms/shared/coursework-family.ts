import {
  PlatformError,
  classDocRef,
  lmsAssignmentPublicationDocRef,
  lmsConnectionDocRef,
  type AssignmentRecord,
  type LmsAssignmentPublicationRecord,
  type LmsProviderId,
} from "../../shared";
import {
  type AssignmentOccurrence,
  type ClassAssignmentsLoader,
  type OccurrenceScope,
} from "../../assignments/current-occurrence-group";
import { resolveLiveCredential } from "../tokens/credential-resolver";

import type { LmsAuthenticatedTeacher } from "./actor";
import { requireNonEmptyString } from "./actor";

// Shared, read-only building blocks for teacher-facing Classroom callables
// that operate on one class + lesson family (`lmsCourseworkInspect`,
// `lmsGradePassbacksPreview`). Every Classroom identifier these callables
// use is derived here from authoritative LyfeLabz records owned by the
// caller; none is ever accepted from a client. Nothing here writes a
// business record. The only incidental write reachable from this module is
// the canonical credential resolver's access-token refresh.

export type FamilyRequest = {
  readonly classId: string;
  readonly lessonSlug: string;
};

const CLASS_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;
const LESSON_SLUG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,126}[A-Za-z0-9])?$/;

// Only `classId` and `lessonSlug` are read; any other payload field
// (including Classroom course/coursework ids) is ignored.
export function parseFamilyRequest(data: unknown): FamilyRequest {
  if (data === null || typeof data !== "object") {
    throw new PlatformError(
      "lms.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
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
  return { classId, lessonSlug };
}

// Class ownership in the caller's authoritative school. A missing class and
// a foreign class are indistinguishable to the caller.
export async function assertOwnedClass(
  classId: string,
  actor: LmsAuthenticatedTeacher,
): Promise<void> {
  const snapshot = await classDocRef(classId).get();
  const cls = snapshot.exists ? snapshot.data() : undefined;
  if (!cls || cls.teacherId !== actor.uid || cls.schoolId !== actor.schoolId) {
    throw new PlatformError("lms.forbidden", "Caller does not own this class.");
  }
}

export function familyScopeFor(
  request: FamilyRequest,
  actor: LmsAuthenticatedTeacher,
): OccurrenceScope {
  return {
    classId: request.classId,
    lessonSlug: request.lessonSlug,
    teacherId: actor.uid,
    schoolId: actor.schoolId,
  };
}

// Every assignment in the family scope, oldest first (ties by id).
export async function loadFamilyOccurrences(
  scope: OccurrenceScope,
  loader: ClassAssignmentsLoader,
): Promise<AssignmentOccurrence[]> {
  return (await loader(scope.classId))
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
}

// The assignment's publication record, honored only when it belongs to this
// exact assignment, class, and owner; anything else is treated as absent.
export async function loadOwnedPublication(
  assignmentId: string,
  record: AssignmentRecord,
  ownerUid: string,
): Promise<LmsAssignmentPublicationRecord | undefined> {
  const publicationId = record.lmsPublicationRef;
  if (typeof publicationId !== "string" || publicationId.length === 0) {
    return undefined;
  }
  const snapshot = await lmsAssignmentPublicationDocRef(publicationId).get();
  const data = snapshot.exists ? snapshot.data() : undefined;
  if (
    data &&
    data.assignmentId === assignmentId &&
    data.classId === record.classId &&
    data.ownerUid === ownerUid
  ) {
    return data;
  }
  return undefined;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

// What LyfeLabz told Classroom: the publication's own grading snapshot when
// present, else the assignment's configuration.
export function storedGradingOf(
  publication: LmsAssignmentPublicationRecord | undefined,
  record: AssignmentRecord,
): { readonly graded: boolean; readonly maxPoints: number | null } {
  const grading = publication?.classroomGrading ?? record.classroomGrading;
  const graded =
    grading?.mode === "graded" && isPositiveFiniteNumber(grading.maxPoints);
  return { graded, maxPoints: graded ? grading.maxPoints : null };
}

// The stored Classroom coursework id, only for a succeeded publication.
export function succeededCourseworkIdOf(
  publication: LmsAssignmentPublicationRecord | undefined,
): string | null {
  return publication?.status === "succeeded" &&
    typeof publication.lmsAssignmentId === "string" &&
    publication.lmsAssignmentId.length > 0
    ? publication.lmsAssignmentId
    : null;
}

export type ConnectionAccess =
  | {
      readonly ok: true;
      readonly providerId: LmsProviderId;
      readonly accessToken: string;
    }
  | { readonly ok: false };

// Memoized per-request access to the caller's OWN active connections. A
// connection owned by anyone else, or not active, is unavailable and no
// credential is resolved for it. A credential that cannot be refreshed
// propagates (the teacher must reconnect), as in every LMS callable.
export function createConnectionAccessResolver(
  ownerUid: string,
): (connectionId: string) => Promise<ConnectionAccess> {
  const connections = new Map<string, Promise<ConnectionAccess>>();
  return (connectionId) => {
    let pending = connections.get(connectionId);
    if (!pending) {
      pending = (async (): Promise<ConnectionAccess> => {
        const snapshot = await lmsConnectionDocRef(connectionId).get();
        const connection = snapshot.exists ? snapshot.data() : undefined;
        if (
          !connection ||
          connection.teacherId !== ownerUid ||
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
}

// Classify a failed upstream read. 404 means the item does not exist;
// authorization/scope failures mean it cannot be read by this teacher.
export function classifyUpstreamReadError(err: unknown): {
  readonly kind: "notFound" | "inaccessible" | "error";
  readonly errorCode: string;
} {
  const errorCode =
    err instanceof PlatformError ? err.code : "lms.upstreamCallFailed";
  const kind =
    errorCode === "lms.upstreamResourceNotFound"
      ? "notFound"
      : errorCode === "lms.upstreamAuthorizationFailed" ||
          errorCode === "lms.insufficientScope"
        ? "inaccessible"
        : "error";
  return { kind, errorCode };
}
