import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assignmentsCollectionRef,
  classDocRef,
  log,
  requireDistrictContext,
  type AssignmentRecord,
  type AssignmentStatus,
  type ClassRecord,
} from "../shared";

// Sprint 13C: certified teacher assignment enumeration callable.
//
// Purpose: after an authenticated teacher signs in or reloads the client,
// return the minimal set of assignment metadata required to restore the
// Curriculum "View summary" affordance and open the certified Sprint 13B
// Assignment Detail surface. The callable is intentionally scoped to the
// smallest response shape that satisfies that outcome. No student, recipient,
// attempt, session, or raw assessment data is projected.
//
// Confidentiality: aggregate-only, teacher-owned assignment metadata. The
// Sprint 12E Slice 1 aggregate-only boundary is preserved unchanged.
//
// Authorization: active-teacher role plus district context via
// `requireDistrictContext`. Ownership is enforced server-side by filtering on
// `teacherId == uid` and `schoolId == context.schoolId`; the record's
// `districtId` is validated by school membership (the school owns the
// district context) and cross-district records are excluded. Client-supplied
// teacher or district identifiers are ignored; the request payload carries no
// authority fields.
//
// Status scope: `published` and `closed`. `draft` records exist only
// transiently between `assignmentsCreateDraft` and `assignmentsPublish`; they
// are never rendered in the Curriculum "View summary" affordance and are
// omitted here. `archived` records are terminal per Data Model §3.6 and are
// removed from active teacher views by definition, so they are omitted.

// Client-visible per-item shape. Deliberately mirrors the client
// `AssignmentDetailMetadata` union plus `lessonSlug` and `classId`, which are
// required to associate the assignment with a Curriculum lesson card and
// distinguish per-class copies of the same lesson.
export type AssignmentsTeacherListItem = {
  readonly assignmentId: string;
  readonly lessonSlug: string;
  readonly title: string;
  readonly classId: string;
  readonly className: string;
  readonly status: Exclude<AssignmentStatus, "draft" | "archived">;
};

export type AssignmentsTeacherListRequest = Record<string, never>;

export type AssignmentsTeacherListResponse = {
  readonly items: ReadonlyArray<AssignmentsTeacherListItem>;
};

async function assertActiveTeacherInDistrict(
  request: CallableRequest<unknown>,
): Promise<{ readonly uid: string; readonly schoolId: string; readonly districtId: string }> {
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

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

const RETURNED_STATUSES: ReadonlyArray<AssignmentStatus> = ["published", "closed"];

function isReturnedStatus(
  status: AssignmentStatus,
): status is Exclude<AssignmentStatus, "draft" | "archived"> {
  return status === "published" || status === "closed";
}

// Resolve className via a bounded batch of teacher-owned class document
// reads. `className` is not denormalized on the assignment record so a
// server-side lookup is required. Each class read is verified against the
// authenticated teacher's ownership and school to prevent a stale
// `classId` from crossing a district boundary.
async function loadClassNames(
  classIds: ReadonlyArray<string>,
  actor: { readonly uid: string; readonly schoolId: string },
): Promise<ReadonlyMap<string, string>> {
  const unique = Array.from(new Set(classIds));
  const results = await Promise.all(
    unique.map(async (classId) => {
      try {
        const snap = await classDocRef(classId).get();
        if (!snap.exists) return [classId, null] as const;
        const data: ClassRecord | undefined = snap.data();
        if (!data) return [classId, null] as const;
        if (data.teacherId !== actor.uid || data.schoolId !== actor.schoolId) {
          return [classId, null] as const;
        }
        return [classId, data.title] as const;
      } catch {
        return [classId, null] as const;
      }
    }),
  );
  const map = new Map<string, string>();
  for (const [id, title] of results) {
    if (title !== null) map.set(id, title);
  }
  return map;
}

async function assignmentsTeacherListHandler(
  request: CallableRequest<unknown>,
): Promise<AssignmentsTeacherListResponse> {
  const actor = await assertActiveTeacherInDistrict(request);

  // Canonical query: filter by teacher ownership and the teacher's own
  // school. Both fields are denormalized on the assignment record
  // (Data Model §3.6). The status filter is applied server-side.
  const snapshot = await assignmentsCollectionRef()
    .where("teacherId", "==", actor.uid)
    .where("schoolId", "==", actor.schoolId)
    .where("status", "in", RETURNED_STATUSES as string[])
    .get();

  const raw: {
    readonly assignmentId: string;
    readonly record: AssignmentRecord;
  }[] = [];
  const classIds: string[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!data) continue;
    if (data.teacherId !== actor.uid || data.schoolId !== actor.schoolId) {
      // Defense-in-depth. The query already excludes these; belt-and-suspenders
      // filtering prevents a stale index from silently returning cross-owner
      // records.
      continue;
    }
    if (!isReturnedStatus(data.status)) continue;
    if (typeof data.classId !== "string" || data.classId.length === 0) continue;
    if (typeof data.lessonSlug !== "string" || data.lessonSlug.length === 0) continue;
    raw.push({ assignmentId: doc.id, record: data });
    classIds.push(data.classId);
  }

  const classNames = await loadClassNames(classIds, actor);

  const items: AssignmentsTeacherListItem[] = [];
  for (const { assignmentId, record } of raw) {
    const className = classNames.get(record.classId);
    if (className === undefined) continue;
    if (!isReturnedStatus(record.status)) continue;
    const title =
      typeof record.title === "string" && record.title.length > 0
        ? record.title
        : record.lessonSlug;
    items.push({
      assignmentId,
      lessonSlug: record.lessonSlug,
      title,
      classId: record.classId,
      className,
      status: record.status,
    });
  }

  // Deterministic ordering: by (classId, assignmentId) so identical results
  // are returned on repeated calls without a Firestore composite index.
  items.sort((a, b) => {
    if (a.classId !== b.classId) return a.classId < b.classId ? -1 : 1;
    if (a.assignmentId !== b.assignmentId) {
      return a.assignmentId < b.assignmentId ? -1 : 1;
    }
    return 0;
  });

  safeLog(() =>
    log.info("assignments.teacherList", {
      actorUserId: actor.uid,
      returned: items.length,
    }),
  );

  return { items };
}

export const assignmentsTeacherList = platformCallable(
  assignmentsTeacherListHandler,
);

export const __assignmentsTeacherListHandler = assignmentsTeacherListHandler;
