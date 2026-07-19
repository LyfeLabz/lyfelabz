import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

import type {
  AssignmentsListForStudentCallable,
  AssignmentsListForStudentItem,
  AssignmentsListForStudentResponse,
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
  return Object.freeze({
    assignmentId,
    lessonSlug,
    title,
    status: "published",
    publishedAt,
  });
}

function parseResponse(raw: unknown): AssignmentsListForStudentResponse {
  const record = (raw ?? {}) as CallableRecord;
  const items = record.items;
  if (!Array.isArray(items)) {
    return Object.freeze({ items: Object.freeze([]) });
  }
  const parsed: AssignmentsListForStudentItem[] = [];
  for (const entry of items) {
    const item = parseAssignmentsListForStudentItem(entry);
    if (item !== null) parsed.push(item);
  }
  return Object.freeze({ items: Object.freeze(parsed) });
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
