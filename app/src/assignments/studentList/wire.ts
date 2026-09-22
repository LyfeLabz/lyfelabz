import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

import type {
  HistoryOnlyGroup,
  AssignmentsListForStudentCallable,
  AssignmentsListForStudentItem,
  AssignmentsListForStudentResponse,
  LaunchPresentation,
} from "./types";

// Sprint 17 Slice 4 entry-point wiring for the certified
// `assignmentsListForStudent` callable. This module is the seam that
// keeps the active-student surface free of firebase/* imports. It is
// imported only by src/index.ts and follows the pattern established by
// src/assignments/summary/wire.ts and src/settings/integrations/wire.ts.
//
// The callable contract is defined by Sprint 17 Slice 2 and lives at
// `platform/functions/src/assignments/assignments-list-for-student.ts`.
// The backend is authoritative for authorization, recipient enforcement,
// and lifecycle scoping; this wire never derives, aggregates, or filters
// authoritatively - it only rejects malformed items so a broken server
// contract cannot silently propagate into a rendered surface or a
// generated launcher URL.

type CallableRecord = Readonly<Record<string, unknown>>;

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const isNullableFiniteNumber = (v: unknown): v is number | null =>
  v === null || isFiniteNumber(v);

// A single item is normalized to the client-side type or dropped. The
// callable contract fixes `status` at the literal `"published"`; any
// other value indicates a broken server contract or a laundered response
// and must not be surfaced. Returning null (rather than throwing) allows
// the caller to skip malformed items without discarding the entire
// response, which matches the spec's "ignore malformed items safely"
// requirement.
// F5.2 §7.1 optional differentiation fields. Parsed defensively and additively:
// a malformed `presentation` or `launchRef` is DROPPED (the item still renders
// and launches canonically), never a reason to discard the whole item. The
// client never authors these; it only transports what the server sent. The
// `path` is NOT validated for routing safety here (that is the routing layer's
// trust boundary, launchRouting.ts); this parser only asserts the wire SHAPE so
// a non-string can never flow downstream.
function parseLaunchPresentation(raw: unknown): LaunchPresentation | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const record = raw as CallableRecord;
  const variantKey = record.variantKey;
  const presentationRevisionId = record.presentationRevisionId;
  const path = record.path;
  if (!isNonEmptyString(variantKey)) return undefined;
  if (!isNonEmptyString(presentationRevisionId)) return undefined;
  if (!isNonEmptyString(path)) return undefined;
  return Object.freeze({ variantKey, presentationRevisionId, path });
}

export function parseAssignmentsListForStudentItem(
  raw: unknown,
): AssignmentsListForStudentItem | null {
  if (raw === null || typeof raw !== "object") return null;
  const record = raw as CallableRecord;
  const assignmentId = record.assignmentId;
  const lessonSlug = record.lessonSlug;
  const title = record.title;
  const status = record.status;
  const publishedAt = record.publishedAt;
  if (!isNonEmptyString(assignmentId)) return null;
  if (!isNonEmptyString(lessonSlug)) return null;
  if (!isNonEmptyString(title)) return null;
  if (status !== "published") return null;
  if (!isNullableFiniteNumber(publishedAt)) return null;
  const presentation = parseLaunchPresentation(record.presentation);
  const launchRef = isNonEmptyString(record.launchRef)
    ? record.launchRef
    : undefined;
  // Reassignment model: server-listed related occurrences. Parsed
  // defensively like the superseded list below; a malformed value only ever
  // narrows the tile's history, never changes which item is operational.
  const relatedAssignmentIds = Array.isArray(record.relatedAssignmentIds)
    ? Object.freeze(record.relatedAssignmentIds.filter(isNonEmptyString))
    : undefined;
  return Object.freeze({
    assignmentId,
    lessonSlug,
    title,
    status: "published",
    publishedAt,
    ...(presentation !== undefined ? { presentation } : {}),
    ...(launchRef !== undefined ? { launchRef } : {}),
    ...(relatedAssignmentIds !== undefined && relatedAssignmentIds.length > 0
      ? { relatedAssignmentIds }
      : {}),
  });
}

// Superseded ids are parsed defensively: a non-array is treated as none and
// any non-string entry is dropped, so a malformed value can only ever make
// the surface show MORE of the student's own completed work, never hide an
// operational item (operational items come solely from `items`).
function parseSupersededAssignmentIds(raw: unknown): ReadonlyArray<string> {
  if (!Array.isArray(raw)) return Object.freeze([]);
  return Object.freeze(raw.filter(isNonEmptyString));
}

// History-only groups are parsed defensively: a non-array is none, and a
// malformed group (non-object, non-array ids, or no valid id) is dropped.
// Dropping a group only falls back to the legacy per-assignment history
// cards; it can never make an occurrence operational.
function parseHistoryOnlyGroups(raw: unknown): ReadonlyArray<HistoryOnlyGroup> {
  if (!Array.isArray(raw)) return Object.freeze([]);
  const out: HistoryOnlyGroup[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const ids = (entry as CallableRecord).assignmentIds;
    if (!Array.isArray(ids)) continue;
    const assignmentIds = ids.filter(isNonEmptyString);
    if (assignmentIds.length === 0) continue;
    out.push(Object.freeze({ assignmentIds: Object.freeze(assignmentIds) }));
  }
  return Object.freeze(out);
}

function parseResponse(raw: unknown): AssignmentsListForStudentResponse {
  const record = (raw ?? {}) as CallableRecord;
  const items = record.items;
  const supersededAssignmentIds = parseSupersededAssignmentIds(
    record.supersededAssignmentIds,
  );
  const historyOnlyGroups = parseHistoryOnlyGroups(record.historyOnlyGroups);
  if (!Array.isArray(items)) {
    return Object.freeze({
      items: Object.freeze([]),
      supersededAssignmentIds,
      historyOnlyGroups,
    });
  }
  const parsed: AssignmentsListForStudentItem[] = [];
  for (const entry of items) {
    const item = parseAssignmentsListForStudentItem(entry);
    if (item !== null) parsed.push(item);
  }
  return Object.freeze({
    items: Object.freeze(parsed),
    supersededAssignmentIds,
    historyOnlyGroups,
  });
}

export function createAssignmentsListForStudentCallable(
  functions: Functions,
): AssignmentsListForStudentCallable {
  const callable = httpsCallable(functions, "assignmentsListForStudent");
  return async () => {
    // The callable request payload is the empty object per the certified
    // contract. Caller identity is the sole authorization source; no
    // identifiers are sent from the browser.
    const res = await callable({});
    return parseResponse(res.data);
  };
}
