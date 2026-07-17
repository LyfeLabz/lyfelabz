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
// Status scope: `published` and `closed` are always returned. Sprint 13F
// adds optional draft enumeration through the additive
// `includeDrafts` request flag. When the flag is present and true, `draft`
// records owned by the caller are also returned so the client can restore
// the persistent draft discovery affordance after a full page reload.
// `archived` records remain terminal per Data Model §3.6 and are never
// returned.

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
  readonly status: Exclude<AssignmentStatus, "archived">;
  // Sprint 13G scope completion: additive optional projection of the
  // canonical `instructions` field per Data Model §3.6. Absent when the
  // stored record has never carried instructions; present when it does.
  // The addition is backward compatible: pre-Sprint-13G clients ignore
  // the field, and the Sprint 13C hydrate parser continues to accept
  // items without it.
  readonly instructions?: string;
};

// Sprint 13F: the request payload gains a single optional boolean field
// that opts the caller in to draft enumeration. Every existing caller
// (Sprint 13C hydration prior to this sprint) passes `{}` and continues
// to receive published and closed items only, unchanged.
export type AssignmentsTeacherListRequest = {
  readonly includeDrafts?: boolean;
};

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

const PUBLISHED_CLOSED_STATUSES: ReadonlyArray<AssignmentStatus> = [
  "published",
  "closed",
];
const PUBLISHED_CLOSED_DRAFT_STATUSES: ReadonlyArray<AssignmentStatus> = [
  "published",
  "closed",
  "draft",
];

function isReturnedStatus(
  status: AssignmentStatus,
  includeDrafts: boolean,
): status is Exclude<AssignmentStatus, "archived"> {
  if (status === "published" || status === "closed") return true;
  if (includeDrafts && status === "draft") return true;
  return false;
}

function readIncludeDraftsFlag(data: unknown): boolean {
  if (data === null || typeof data !== "object") return false;
  const flag = (data as { readonly includeDrafts?: unknown }).includeDrafts;
  return flag === true;
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
  const includeDrafts = readIncludeDraftsFlag(request.data);

  // Canonical query: filter by teacher ownership and the teacher's own
  // school. Both fields are denormalized on the assignment record
  // (Data Model §3.6). The status filter is applied server-side. Sprint
  // 13F opts the caller in to draft enumeration by widening the status
  // `in` clause; ownership and district scoping are unchanged.
  const returnedStatuses = includeDrafts
    ? PUBLISHED_CLOSED_DRAFT_STATUSES
    : PUBLISHED_CLOSED_STATUSES;
  const snapshot = await assignmentsCollectionRef()
    .where("teacherId", "==", actor.uid)
    .where("schoolId", "==", actor.schoolId)
    .where("status", "in", returnedStatuses as string[])
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
    if (!isReturnedStatus(data.status, includeDrafts)) continue;
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
    if (!isReturnedStatus(record.status, includeDrafts)) continue;
    const title =
      typeof record.title === "string" && record.title.length > 0
        ? record.title
        : record.lessonSlug;
    const item: {
      assignmentId: string;
      lessonSlug: string;
      title: string;
      classId: string;
      className: string;
      status: Exclude<AssignmentStatus, "archived">;
      instructions?: string;
    } = {
      assignmentId,
      lessonSlug: record.lessonSlug,
      title,
      classId: record.classId,
      className,
      status: record.status,
    };
    if (
      typeof record.instructions === "string" &&
      record.instructions.length > 0
    ) {
      item.instructions = record.instructions;
    }
    items.push(item);
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
      includeDrafts,
    }),
  );

  return { items };
}

export const assignmentsTeacherList = platformCallable(
  assignmentsTeacherListHandler,
);

export const __assignmentsTeacherListHandler = assignmentsTeacherListHandler;
