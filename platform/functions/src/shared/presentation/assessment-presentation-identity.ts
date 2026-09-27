import { createHash } from "crypto";

import {
  canonicalJson,
  isValidAssessmentPresentationRevisionId,
  type AssessmentPresentationRecord,
} from "../types/assessment-presentation";

export { canonicalJson };

// F5.3 Slice 5 - server-side identity and integrity for assessment
// presentations (`assessmentPresentations/{ap<sha256>}`).
//
// The id is "ap" + sha256(canonicalJson(record)). This is the SAME procedure
// as the build tooling (app/scripts/lessonBuilder/assessmentPresentation.cjs,
// `canonicalJson` / `assessmentPresentationRevisionIdFor`); a parity test pins
// the two. Every server boundary that consumes a presentation (session begin,
// autosave, finalize) re-derives the id from the stored content, so a record
// that was altered, or stored under the wrong id, is never honored.
//
// The record carries no correctness data; it only maps each item's displayed
// choices onto canonical optionIds. The canonical assessment revision and its
// answer key remain the scoring authority.

export function computeAssessmentPresentationRevisionId(record: unknown): string {
  return `ap${createHash("sha256").update(canonicalJson(record)).digest("hex")}`;
}

export type AssessmentPresentationCheck =
  | { readonly ok: true; readonly record: AssessmentPresentationRecord }
  | { readonly ok: false; readonly reason: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// Verifies a stored presentation document against its id and the expected
// lesson / canonical assessment revision. Structural checks are limited to
// what the server consumes (item ids and displayed canonical optionIds); the
// full content validation ran at build and publish time.
export function checkAssessmentPresentationDoc(
  assessmentPresentationRevisionId: string,
  data: unknown,
  expected: { readonly lessonSlug?: string; readonly assessmentRevisionId: string },
): AssessmentPresentationCheck {
  if (!isValidAssessmentPresentationRevisionId(assessmentPresentationRevisionId)) {
    return { ok: false, reason: "malformedId" };
  }
  if (data === undefined || data === null || typeof data !== "object") {
    return { ok: false, reason: "missing" };
  }
  let actualId: string;
  try {
    actualId = computeAssessmentPresentationRevisionId(data);
  } catch {
    return { ok: false, reason: "unhashable" };
  }
  if (actualId !== assessmentPresentationRevisionId) {
    return { ok: false, reason: "contentMismatch" };
  }
  const record = data as Partial<AssessmentPresentationRecord>;
  if (record.schemaVersion !== 1 || record.kind !== "lyfelabz.assessmentPresentation") {
    return { ok: false, reason: "schema" };
  }
  if (expected.lessonSlug !== undefined && record.lessonSlug !== expected.lessonSlug) {
    return { ok: false, reason: "lessonMismatch" };
  }
  if (record.assessmentRevisionId !== expected.assessmentRevisionId) {
    return { ok: false, reason: "assessmentRevisionMismatch" };
  }
  const items: unknown = record.items;
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, reason: "schema" };
  }
  const seen = new Set<string>();
  for (const raw of items as unknown[]) {
    const item = raw as { readonly itemId?: unknown; readonly displayedOptions?: unknown } | null;
    if (!item || !isNonEmptyString(item.itemId) || seen.has(item.itemId) || !Array.isArray(item.displayedOptions)) {
      return { ok: false, reason: "schema" };
    }
    seen.add(item.itemId);
    const ids = (item.displayedOptions as unknown[]).map((o) =>
      o !== null && typeof o === "object" ? (o as { readonly optionId?: unknown }).optionId : undefined,
    );
    if (ids.length < 2 || !ids.every(isNonEmptyString) || new Set(ids).size !== ids.length) {
      return { ok: false, reason: "schema" };
    }
  }
  return { ok: true, record: data as AssessmentPresentationRecord };
}

// itemId -> the canonical optionIds DISPLAYED for that item. The response
// validator intersects this with the canonical revision's options.
export function displayedOptionIdsByItem(
  record: AssessmentPresentationRecord,
): ReadonlyMap<string, ReadonlySet<string>> {
  return new Map(
    record.items.map((item) => [item.itemId, new Set(item.displayedOptions.map((o) => o.optionId))]),
  );
}
