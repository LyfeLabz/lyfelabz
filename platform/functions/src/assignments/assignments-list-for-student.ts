import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assignmentDocRef,
  assignmentRecipientsCollectionGroupRef,
  log,
  requireDistrictContext,
  type AssignmentRecord,
  type AssignmentRecipientRecord,
} from "../shared";

// Sprint 17 Slice 2: certified student assignment-discovery callable.
//
// Purpose: after an authenticated student signs in, return the minimal set
// of assignment metadata required for the Sprint 17 `activeStudent` surface
// and the assignment launcher (Slice 4). The callable is the single new
// backend capability approved by the Sprint 17 Certification Contract and
// Implementation Specification §4; it exists because the certified per-
// assignment callables (`assessmentSessionsBegin`, `assessmentAttemptGet`,
// `assessmentAttemptsList`) require an already-known `assignmentId`, and no
// existing surface enumerates the assignments a specific student is
// permitted to work on.
//
// Confidentiality: aggregate-only, student-owned assignment metadata. No
// teacher-only field, recipient document, session, attempt, or answer-key
// material crosses the callable boundary.
//
// Authorization: active-student role plus district context via
// `requireDistrictContext`. Recipient enforcement is server-authoritative
// via the frozen `assignments/{assignmentId}/recipients/{studentId}`
// document (Sprint 12E Slice 2A / PDR-029h). Client-supplied identifiers
// are ignored; the request payload carries no authority fields.
//
// Status scope: only `published` assignments are returned. `draft` is
// teacher-only; `closed` and `archived` are not discovery targets (a closed
// assignment's history is retrieved through `assessmentAttemptsList` /
// `assessmentAttemptGet`, not through discovery). Restricting the discovery
// surface to `published` matches the `assessmentSessionsBegin` acceptance
// contract (assessment-sessions-begin.ts:304-315).

// Client-visible per-item shape. Intentionally minimal: only the fields
// required by the `activeStudent` surface (title, publishedAt for ordering)
// and the assignment launcher (assignmentId, lessonSlug) cross the boundary.
// Fields present on the persisted record but not required by Sprint 17
// (instructions, windowClosesAt, availableAt, mode, lessonVersion,
// lmsPublicationRef) are structurally excluded.
export type AssignmentsListForStudentItem = {
  readonly assignmentId: string;
  readonly lessonSlug: string;
  readonly title: string;
  readonly status: "published";
  readonly publishedAt: number | null;
};

export type AssignmentsListForStudentRequest = Record<string, never>;

export type AssignmentsListForStudentResponse = {
  readonly items: ReadonlyArray<AssignmentsListForStudentItem>;
};

// Forbidden top-level keys on the discovery request. The callable never
// accepts a student identifier or any district-scoping input; caller
// identity is the sole authorization source. Rejecting the field on shape
// is preferred to silent ignore so a broken client is surfaced quickly and
// no laundering path can suggest cross-student access.
const FORBIDDEN_REQUEST_KEYS: readonly string[] = [
  "studentId",
  "uid",
  "userId",
  "districtId",
  "schoolId",
  "classId",
  "teacherId",
  "assignmentId",
];

function validateRequest(data: unknown): void {
  if (data === undefined || data === null) return;
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new PlatformError(
      "assignments.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
  for (const key of FORBIDDEN_REQUEST_KEYS) {
    if (key in payload) {
      throw new PlatformError(
        "assignments.invalidRequest",
        `Field "${key}" is not permitted on the request.`,
      );
    }
  }
}

async function assertActiveStudentInDistrict(
  request: CallableRequest<unknown>,
): Promise<{
  readonly uid: string;
  readonly schoolId: string;
  readonly districtId: string;
}> {
  const context = await requireDistrictContext(request);
  if (context.role !== "student") {
    throw new PlatformError(
      "role-forbidden",
      "Caller must be an active student.",
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// A minimal internal projection of the recipient record used to gate the
// parent assignment read. Every field is required and cross-checked against
// the verified district context; any mismatch is a silent drop consistent
// with the defense-in-depth filtering pattern used by
// `assessmentAttemptsList`.
type FrozenRecipientTuple = {
  readonly assignmentId: string;
  readonly teacherId: string;
  readonly classId: string;
};

function projectRecipient(
  record: AssignmentRecipientRecord | undefined,
  actor: { readonly uid: string; readonly schoolId: string; readonly districtId: string },
): FrozenRecipientTuple | null {
  if (!record) return null;
  if (!isNonEmptyString(record.assignmentId)) return null;
  if (record.studentId !== actor.uid) return null;
  if (record.districtId !== actor.districtId) return null;
  if (record.schoolId !== actor.schoolId) return null;
  if (record.status !== "assigned") return null;
  if (!isNonEmptyString(record.teacherId)) return null;
  if (!isNonEmptyString(record.classId)) return null;
  return {
    assignmentId: record.assignmentId,
    teacherId: record.teacherId,
    classId: record.classId,
  };
}

function timestampToMillis(value: unknown): number | null {
  if (!value) return null;
  const candidate = value as { toMillis?: () => number };
  if (typeof candidate.toMillis !== "function") return null;
  try {
    const ms = candidate.toMillis();
    return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

// Load one assignment document and gate the record against the frozen
// recipient snapshot and the verified district context. The parent read is
// mandatory because `lessonSlug`, `title`, `status`, and `publishedAt` are
// not denormalized on the recipient record per PDR-029h; the recipient
// snapshot only carries ownership fields. Every mismatch is a silent drop
// so a stale or malformed recipient never amplifies into a client-visible
// error.
async function loadAssignmentIfVisible(
  recipient: FrozenRecipientTuple,
  actor: {
    readonly uid: string;
    readonly schoolId: string;
    readonly districtId: string;
  },
): Promise<
  | (AssignmentRecord & { readonly assignmentId: string })
  | null
> {
  let snap: Awaited<ReturnType<ReturnType<typeof assignmentDocRef>["get"]>>;
  try {
    snap = await assignmentDocRef(recipient.assignmentId).get();
  } catch {
    return null;
  }
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  // Defense-in-depth. Recipient snapshots are frozen at write time, so a
  // divergence between the recipient and the assignment record indicates a
  // data-invariant violation the discovery layer must not amplify.
  if (data.schoolId !== actor.schoolId) return null;
  if (data.teacherId !== recipient.teacherId) return null;
  if (data.classId !== recipient.classId) return null;
  // Only `published` assignments are discovery targets. `draft` is teacher-
  // only; `closed` and `archived` are retrieved through the attempt-history
  // callables, not through discovery.
  if (data.status !== "published") return null;
  if (data.mode !== "classroom") return null;
  if (!isNonEmptyString(data.lessonSlug)) return null;
  return { ...data, assignmentId: snap.id };
}

async function assignmentsListForStudentHandler(
  request: CallableRequest<unknown>,
): Promise<AssignmentsListForStudentResponse> {
  const actor = await assertActiveStudentInDistrict(request);
  validateRequest(request.data);

  // Canonical query: enumerate every recipient document across every
  // assignment where the caller is the frozen student. `districtId` and
  // `schoolId` scoping is applied server-side after the read against the
  // verified district context so no client-supplied identifier participates
  // and no cross-district record can be returned even under a stale index.
  // A single-field collection-group index on `recipients.studentId` is
  // declared in `firestore.indexes.json`.
  const recipientSnapshot = await assignmentRecipientsCollectionGroupRef()
    .where("studentId", "==", actor.uid)
    .get();

  const frozen: FrozenRecipientTuple[] = [];
  const seenAssignmentIds = new Set<string>();
  for (const doc of recipientSnapshot.docs) {
    const projected = projectRecipient(doc.data(), actor);
    if (!projected) continue;
    if (seenAssignmentIds.has(projected.assignmentId)) continue;
    seenAssignmentIds.add(projected.assignmentId);
    frozen.push(projected);
  }

  const loaded = await Promise.all(
    frozen.map((recipient) => loadAssignmentIfVisible(recipient, actor)),
  );

  const items: AssignmentsListForStudentItem[] = [];
  for (const record of loaded) {
    if (!record) continue;
    const rawTitle = record.title;
    const title =
      typeof rawTitle === "string" && rawTitle.length > 0
        ? rawTitle
        : record.lessonSlug;
    items.push({
      assignmentId: record.assignmentId,
      lessonSlug: record.lessonSlug,
      title,
      status: "published",
      publishedAt: timestampToMillis(record.publishedAt),
    });
  }

  // Deterministic ordering: publishedAt desc when present (newest first),
  // with `null` last, and assignmentId asc as a stable tiebreaker so
  // repeated calls return identical results without a Firestore composite
  // index.
  items.sort((a, b) => {
    const ap = a.publishedAt;
    const bp = b.publishedAt;
    if (ap !== bp) {
      if (ap === null) return 1;
      if (bp === null) return -1;
      return bp - ap;
    }
    if (a.assignmentId !== b.assignmentId) {
      return a.assignmentId < b.assignmentId ? -1 : 1;
    }
    return 0;
  });

  safeLog(() =>
    log.info("assignments.listForStudent", {
      actorUserId: actor.uid,
      returned: items.length,
    }),
  );

  return { items };
}

export const assignmentsListForStudent = platformCallable(
  assignmentsListForStudentHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assignmentsListForStudentHandler =
  assignmentsListForStudentHandler;
