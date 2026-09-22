import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assignmentDocRef,
  assignmentRecipientsCollectionGroupRef,
  createRequestLaunchPresentationResolver,
  log,
  requireDistrictContext,
  type AssignmentRecord,
  type AssignmentRecipientRecord,
  type LaunchPresentation,
} from "../shared";
import {
  createClassAssignmentsLoader,
  occurrenceScopeOf,
  resolveCurrentOccurrenceGroup,
} from "./current-occurrence-group";

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
//
// Availability scope: a published assignment whose `availableAt` is still in
// the future is not a discovery target either. Data Model §3.6 defines
// `availableAt` as "hidden from students until this time", and
// `assessmentSessionsBegin` / `lmsDeepLinkResolve` already refuse (or render
// informational) before that instant; discovery applies the same instant so
// the list never offers work the launch path would refuse. At or after
// `availableAt` the item is listed normally. An absent `availableAt` means
// immediately available (unchanged pre-feature behavior).

// Client-visible per-item shape. Intentionally minimal: only the fields
// required by the `activeStudent` surface (title, publishedAt for ordering)
// and the assignment launcher (assignmentId, lessonSlug) cross the boundary.
// Fields present on the persisted record but not required by Sprint 17
// (instructions, windowClosesAt, availableAt, mode,
// assessmentRevisionId, lmsPublicationRef) are structurally excluded.
export type AssignmentsListForStudentItem = {
  readonly assignmentId: string;
  readonly lessonSlug: string;
  readonly title: string;
  readonly status: "published";
  readonly publishedAt: number | null;
  // F5.2 §7.1/§7.3 additive, optional differentiation fields (Slice 4),
  // resolved per item by server-authoritative Op C from the authenticated
  // student uid. Present ONLY for an accommodated student:
  //   - `presentation` iff a `differentiated` grant was minted for this item;
  //   - `launchRef` iff any grant was minted (`differentiated` or
  //     `canonicalFallback`).
  // Entirely absent for canonical-expected students, so existing consumers
  // that ignore the fields are unaffected. The Slice 4 client ignores both;
  // routing/transport is Slice 5/6. The student never asserts either field.
  readonly presentation?: LaunchPresentation;
  readonly launchRef?: string;
  // Reassignment model: present ONLY on the operational Current item of a
  // class + lesson with a valid Current, and only when non-empty. Lists the
  // other occurrences of that same class + lesson (canonical occurrence
  // group, `current-occurrence-group.ts`) that the caller holds recipient
  // membership on. The student's own attempts on this item AND on these
  // occurrences together form the tile's cumulative attempt history. Never
  // includes a not-yet-available occurrence.
  readonly relatedAssignmentIds?: ReadonlyArray<string>;
};

export type AssignmentsListForStudentRequest = Record<string, never>;

export type AssignmentsListForStudentResponse = {
  readonly items: ReadonlyArray<AssignmentsListForStudentItem>;
  // Every non-Current occurrence (any lifecycle status) of a class + lesson
  // with a valid Current that the caller holds recipient membership on,
  // whether or not the Current tile itself is currently shown (a
  // future-scheduled Current is hidden until `availableAt`). The student
  // surface never renders a separate card for these: their attempts belong
  // to the Current tile's cumulative history, and while Current is hidden
  // there is deliberately no substitute tile. Never includes a
  // not-yet-available occurrence.
  readonly supersededAssignmentIds: ReadonlyArray<string>;
  // Managed class + lesson whose Current is no longer operational (closed or
  // archived; canonical scope state "inactive"). Such a group has NO
  // operational item and none of its occurrences is ever listed as one or
  // launchable. Each entry lists the occurrences of one such group that the
  // caller holds recipient membership on, so the student surface can keep
  // the caller's completed work visible as ONE non-launchable history card
  // (the same treatment any closed assignment's results already receive)
  // instead of one card per historical occurrence.
  readonly historyOnlyGroups: ReadonlyArray<{
    readonly assignmentIds: ReadonlyArray<string>;
  }>;
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
  // F5.2 §4.3 - differentiation selector fields the student must never assert.
  // Resolution is server-authoritative per item from the authenticated uid;
  // the client never chooses a variant/revision/path, and `launchRef` is
  // response-only here.
  "variantKey",
  "presentationRevisionId",
  "readingLevel",
  "accommodation",
  "accommodationStatus",
  "presentation",
  "launchRef",
  "deliveryOutcome",
  "outcomeAtIssuance",
  "configRevision",
  "issuedAt",
  "expiresAt",
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

// True when the assignment has become available at `nowMs`. Mirrors the
// `availableAt` half of `assessmentSessionsBegin`'s begin-window check and
// `lmsDeepLinkResolve.isBeginWindowOpen`, so discovery, deep-link arrival,
// and session begin all agree on the same instant. A malformed value is
// treated as not yet available (fail closed), never as available.
function isAvailableAt(record: AssignmentRecord, nowMs: number): boolean {
  const availableAt = record.availableAt;
  if (availableAt === undefined || availableAt === null) return true;
  const ms = timestampToMillis(availableAt);
  if (ms === null) return false;
  return ms <= nowMs;
}

// Load one assignment document and gate the record against the frozen
// recipient snapshot and the verified district context. The parent read is
// mandatory because `lessonSlug`, `title`, `status`, and `publishedAt` are
// not denormalized on the recipient record per PDR-029h; the recipient
// snapshot only carries ownership fields. Every mismatch is a silent drop
// so a stale or malformed recipient never amplifies into a client-visible
// error.
//
// Returns the caller's recipient MEMBERSHIP in any lifecycle status. Only
// `published` memberships can become discovery items (see the handler);
// `closed`/`archived` memberships are kept solely so their attempts can be
// attributed to a valid Current's occurrence group rather than surfacing
// as unrelated history. `draft` is teacher-only and never has recipients.
type Membership = AssignmentRecord & { readonly assignmentId: string };

async function loadMembership(
  recipient: FrozenRecipientTuple,
  actor: {
    readonly uid: string;
    readonly schoolId: string;
    readonly districtId: string;
  },
): Promise<Membership | null> {
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
  if (data.status === "draft") return null;
  if (data.mode !== "classroom") return null;
  if (!isNonEmptyString(data.lessonSlug)) return null;
  return { ...data, assignmentId: snap.id };
}

function occurrenceScopeKey(record: AssignmentRecord): string {
  return [record.classId, record.lessonSlug, record.teacherId, record.schoolId].join(
    "\u0000",
  );
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
    frozen.map((recipient) => loadMembership(recipient, actor)),
  );
  const memberships = loaded.filter(
    (record): record is Membership => record !== null,
  );

  // Reassignment model: one operational item per class + lesson with a
  // valid Current. Memberships are bucketed by occurrence scope and each
  // scope is resolved through the ONE canonical grouping primitive
  // (`resolveCurrentOccurrenceGroup`), shared with launch authorization and
  // Classroom passback:
  //   - valid Current -> the Current occurrence is the only operational
  //     item (none, if the caller is not a recipient of it). Every other
  //     group occurrence the caller holds is superseded: never an item and
  //     never offered as a substitute, but its id rides on the Current item
  //     (`relatedAssignmentIds`) so the tile can present the caller's
  //     cumulative attempt history;
  //   - managed Current no longer operational (pointer names a closed or
  //     archived in-scope assignment) -> NO operational item; no older
  //     occurrence is resurrected; the caller's occurrences are returned as
  //     one history-only group;
  //   - no authoritative pointer (legacy missing/malformed/cross-scope) ->
  //     every published occurrence stays listed exactly as before; no
  //     heuristic picks one.
  // Ownership fields are used only for this server-side grouping and never
  // cross the response boundary.
  const buckets = new Map<string, Membership[]>();
  for (const membership of memberships) {
    const key = occurrenceScopeKey(membership);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(membership);
    else buckets.set(key, [membership]);
  }

  // Availability gate, applied strictly AFTER Current resolution so a
  // future-scheduled Current still owns its class + lesson: it is hidden
  // until `availableAt`, and an older occurrence is never exposed in its
  // place.
  const nowMs = Date.now();
  const classAssignments = createClassAssignmentsLoader();
  type Operational = {
    readonly record: Membership;
    readonly relatedAssignmentIds: ReadonlyArray<string>;
  };
  const resolvedBuckets = await Promise.all(
    Array.from(buckets.values()).map(async (bucket) => {
      const first = bucket[0];
      if (first === undefined) {
        return {
          operational: [] as Operational[],
          superseded: [] as string[],
          historyOnly: [] as string[],
        };
      }
      const group = await resolveCurrentOccurrenceGroup(
        occurrenceScopeOf(first),
        actor.districtId,
        classAssignments,
      );
      if (group.resolution === "unresolved") {
        return {
          operational: bucket
            .filter((m) => m.status === "published" && isAvailableAt(m, nowMs))
            .map((record): Operational => ({ record, relatedAssignmentIds: [] })),
          superseded: [] as string[],
          historyOnly: [] as string[],
        };
      }
      const groupIds = new Set(group.occurrences.map((o) => o.assignmentId));
      if (group.resolution === "inactive") {
        // Managed but no longer operational: closing Current never
        // resurrects an older occurrence and never invents a replacement.
        return {
          operational: [] as Operational[],
          superseded: [] as string[],
          historyOnly: bucket
            .filter((m) => groupIds.has(m.assignmentId) && isAvailableAt(m, nowMs))
            .map((m) => m.assignmentId)
            .sort(),
        };
      }
      const superseded = bucket
        .filter(
          (m) =>
            m.assignmentId !== group.currentAssignmentId &&
            groupIds.has(m.assignmentId) &&
            isAvailableAt(m, nowMs),
        )
        .map((m) => m.assignmentId)
        .sort();
      const current = bucket.find(
        (m) => m.assignmentId === group.currentAssignmentId,
      );
      const operational: Operational[] =
        current !== undefined &&
        current.status === "published" &&
        isAvailableAt(current, nowMs)
          ? [{ record: current, relatedAssignmentIds: superseded }]
          : [];
      return { operational, superseded, historyOnly: [] as string[] };
    }),
  );
  const collapsed = resolvedBuckets.flatMap((b) => b.operational);
  const supersededAssignmentIds = resolvedBuckets
    .flatMap((b) => b.superseded)
    .sort();
  const historyOnlyGroups = resolvedBuckets
    .filter((b) => b.historyOnly.length > 0)
    .map((b) => ({ assignmentIds: b.historyOnly }));

  // F5.2 §4 Op C / §7.3 (Slice 4): server-authoritative presentation
  // resolution per visible item, strictly AFTER the authorization/visibility
  // gates above. One resolver per call memoizes the single accommodation read
  // and the single operational-flag read, and memoizes the index read per
  // distinct lessonSlug (§7.3); a grant is minted per item because grants are
  // assignment-bound. A canonical-expected student (no accommodation /
  // inactive) resolves to no grant and no presentation, so the items stay
  // shape-identical to pre-feature behavior. An internal failure for one item
  // degrades that item to canonical (§8.5 row 8) without failing the list.
  const launchResolver = createRequestLaunchPresentationResolver();

  const items: AssignmentsListForStudentItem[] = [];
  for (const { record, relatedAssignmentIds } of collapsed) {
    const rawTitle = record.title;
    const title =
      typeof rawTitle === "string" && rawTitle.length > 0
        ? rawTitle
        : record.lessonSlug;

    const resolution = await launchResolver.resolve({
      studentId: actor.uid,
      assignmentId: record.assignmentId,
      lessonSlug: record.lessonSlug,
    });
    let presentation: LaunchPresentation | undefined;
    let launchRef: string | undefined;
    if (resolution.kind === "differentiated") {
      presentation = resolution.presentation;
      launchRef = resolution.launchRef;
    } else if (resolution.kind === "canonicalFallback") {
      launchRef = resolution.launchRef;
    }

    items.push({
      assignmentId: record.assignmentId,
      lessonSlug: record.lessonSlug,
      title,
      status: "published",
      publishedAt: timestampToMillis(record.publishedAt),
      ...(presentation !== undefined ? { presentation } : {}),
      ...(launchRef !== undefined ? { launchRef } : {}),
      ...(relatedAssignmentIds.length > 0 ? { relatedAssignmentIds } : {}),
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
      superseded: supersededAssignmentIds.length,
    }),
  );

  return { items, supersededAssignmentIds, historyOnlyGroups };
}

export const assignmentsListForStudent = platformCallable(
  assignmentsListForStudentHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assignmentsListForStudentHandler =
  assignmentsListForStudentHandler;
