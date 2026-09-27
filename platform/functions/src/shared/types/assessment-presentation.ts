// F5.3 Slice 3 - Accessible assessment presentations
// (docs/platform/DIFFERENTIATION_F5_3_ASSESSMENT_ACCESSIBILITY_ADDENDUM.md).
//
// `assessmentPresentations/{assessmentPresentationRevisionId}` is a RESERVED,
// server-owned record family: an immutable, content-addressed
// student-facing presentation of exactly one canonical assessment revision.
// The id is "ap" + sha256(canonical JSON of the record); the canonical
// serialization, validation, and certification tooling live in
// app/scripts/lessonBuilder/assessmentPresentation.cjs, and retained records
// are committed under src/scripts/assessment-presentations/. Nothing writes
// or reads this collection yet; the publisher writes it (create-or-verify-
// equal, never update/delete) in a later slice, and it is deny-all to every
// client (firestore.rules).
//
// The record carries NO correctness, points, or scoring data. The canonical
// assessment revision and its server-only answer key remain the sole scoring
// authority; a presentation only maps displayed choices onto canonical
// optionIds.

export const ASSESSMENT_PRESENTATIONS_COLLECTION = "assessmentPresentations";

const ASSESSMENT_PRESENTATION_REVISION_ID_RE = /^ap[0-9a-f]{64}$/;

export function isValidAssessmentPresentationRevisionId(id: string): boolean {
  return ASSESSMENT_PRESENTATION_REVISION_ID_RE.test(id);
}

export type AssessmentPresentationLanguage = "canonical" | "adapted";

export type AssessmentPresentationRecord = {
  readonly schemaVersion: 1;
  readonly kind: "lyfelabz.assessmentPresentation";
  readonly lessonSlug: string;
  // The one canonical revision this presentation maps onto; scoring always
  // uses this revision's answer key.
  readonly assessmentRevisionId: string;
  readonly traits: {
    readonly language: AssessmentPresentationLanguage;
    readonly choiceCount: number;
  };
  readonly directions: string | null;
  readonly items: ReadonlyArray<{
    readonly itemId: string;
    readonly stem: string;
    // Display order; each choice carries its canonical optionId.
    readonly displayedOptions: ReadonlyArray<{ readonly optionId: string; readonly text: string }>;
    // Deliberately omitted canonical distractors (reduced choice).
    readonly omittedOptions: ReadonlyArray<{ readonly optionId: string; readonly rationale: string }>;
    // Adapted student-facing explanation; null = canonical explanation.
    readonly feedback: string | null;
  }>;
  readonly showYourThinking: {
    readonly prompt: string;
    readonly modelAnswer: string;
    readonly requiredTerms: ReadonlyArray<string>;
  } | null;
};

// Deterministic serialization behind the content-addressed id (object keys
// sorted by UTF-16 code unit, arrays in order, no insignificant whitespace,
// NFC strings only, safe integers only). Identical to the build tooling's
// `canonicalJson` (app/scripts/lessonBuilder/assessmentPresentation.cjs); a
// parity test pins the two. Dependency-free so pure modules can use it; the
// sha256 lives in shared/presentation/assessment-presentation-identity.ts.
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    if (value !== value.normalize("NFC")) {
      throw new Error("[assessment-presentation] strings must be Unicode NFC-normalized");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("[assessment-presentation] only safe integers are allowed in a record");
    }
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`;
  }
  throw new Error(`[assessment-presentation] unsupported value type in record: ${typeof value}`);
}
