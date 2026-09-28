import {
  assertActivateWriteConsistent,
  isValidLessonSlugForVariant,
  isValidVariantKey,
} from "../types/presentation-variant";

// F5.3 Slice 9C-1 - the ONE revision-aware coverage evaluator
// (DIFFERENTIATION_F5_3_ASSESSMENT_ACCESSIBILITY_ADDENDUM.md sections 21.6,
// 21.7, 21.8; PDR-031e; S9-D1, S9-D2, S9-U1).
//
// Launch resolution (Op C, `resolve-launch-presentation.ts`) and begin
// (`resolve-begin-delivery.ts`) both classify differentiated coverage through
// `readRevisionCoverage` below, so the two can never disagree about whether a
// (lesson, variant key, frozen assessment revision) is covered. The callers
// keep their own accommodation read and operational-flag gate, which run
// BEFORE this evaluator, and their own fail-safe direction (launch degrades
// to canonical; begin refuses).
//
// Lookup, for (lessonSlug, variantKey, frozen assessmentRevisionId):
//   1. Scoped document `presentationVariants/{lessonSlug}__{variantKey}__r{N}`
//      (N = the frozen revision's ordinal). If it exists it ALONE decides:
//      active (only when its identity and `assessmentRevisionId` agree with
//      the request), retired, or malformed. It never falls through to the
//      legacy document.
//   2. Otherwise the legacy document `presentationVariants/{lessonSlug}__{variantKey}`:
//      - bound (carries an assessment revision): honored only when that
//        revision equals the frozen revision (Slice 5 rule);
//      - unbound with no recorded revision: the legacy-r1 rule, honored only
//        when the frozen revision is `assessment_{lessonSlug}__r1` (historical
//        `prff01d9...375c`); never for r2 or later;
//      - anything else is an assessment mismatch (a legitimate coverage gap
//        for this revision, never a defect).
//   3. No usable frozen revision (missing, malformed, or another lesson's)
//      means no revision guess: no scoped read, and legacy coverage is never
//      honored (mismatch).
//
// The evaluation carries no student, accommodation, or answer data. Only the
// launch resolver consumes the `active` pair (to mint a grant); begin
// collapses the result to a kind and never selects a revision from it.

// A document read, decoupled from Firestore so the evaluator is pure.
export type CoverageDocRead =
  | { readonly exists: false }
  | { readonly exists: true; readonly data: unknown };

export type RevisionCoverageSource = "scoped" | "legacyBound" | "legacyUnboundR1";

export type RevisionCoverageEvaluation =
  | { readonly kind: "absent" }
  | { readonly kind: "retired" }
  | { readonly kind: "malformed" }
  | { readonly kind: "assessmentMismatch" }
  | {
      readonly kind: "active";
      // Which record covered the revision (diagnostic only; decisions never
      // depend on it). Always set by this evaluator.
      readonly source?: RevisionCoverageSource;
      readonly variantKey: string;
      readonly presentationRevisionId: string;
      readonly path: string;
      // Present iff the covering record binds an assessment presentation; its
      // `assessmentRevisionId` always equals the frozen revision.
      readonly assessmentBinding?: {
        readonly assessmentRevisionId: string;
        readonly assessmentPresentationRevisionId: string;
      };
    };

export type RevisionCoverageInput = {
  readonly lessonSlug: string;
  readonly variantKey: string;
  // The assignment's FROZEN revision, server-derived; never client input.
  readonly assessmentRevisionId?: string;
};

export type RevisionCoverageReads = {
  readonly readScoped: (
    lessonSlug: string,
    variantKey: string,
    revisionOrdinal: number,
  ) => Promise<CoverageDocRead>;
  readonly readLegacy: (lessonSlug: string, variantKey: string) => Promise<CoverageDocRead>;
};

// The ordinal of a frozen revision that is a canonical revision of THIS
// lesson's assessment (`assessment_{lessonSlug}__r{N}`, N >= 1, no leading
// zero), or undefined when it is not usable.
export function frozenRevisionOrdinal(
  lessonSlug: string,
  assessmentRevisionId: unknown,
): number | undefined {
  if (typeof assessmentRevisionId !== "string") return undefined;
  const prefix = `assessment_${lessonSlug}__r`;
  if (!assessmentRevisionId.startsWith(prefix)) return undefined;
  const tail = assessmentRevisionId.slice(prefix.length);
  if (!/^[1-9][0-9]*$/.test(tail)) return undefined;
  const ordinal = Number(tail);
  return Number.isSafeInteger(ordinal) ? ordinal : undefined;
}

// The frozen revision exactly as stored, when usable for this lesson; else
// undefined (callers then omit it rather than guess).
export function usableFrozenAssessmentRevisionId(
  lessonSlug: string,
  assessmentRevisionId: unknown,
): string | undefined {
  return frozenRevisionOrdinal(lessonSlug, assessmentRevisionId) !== undefined
    ? (assessmentRevisionId as string)
    : undefined;
}

type IndexData = {
  readonly lessonSlug?: unknown;
  readonly variantKey?: unknown;
  readonly currentPresentationRevisionId?: unknown;
  readonly currentPath?: unknown;
  readonly contentSha256?: unknown;
  readonly status?: unknown;
  readonly assessmentRevisionId?: unknown;
  readonly assessmentPresentationRevisionId?: unknown;
};

type ActivePair = {
  readonly variantKey: string;
  readonly presentationRevisionId: string;
  readonly path: string;
  readonly assessmentRevisionId?: string;
  readonly assessmentPresentationRevisionId?: string;
};

function asIndexData(data: unknown): IndexData | undefined {
  return data !== null && typeof data === "object" && !Array.isArray(data)
    ? data
    : undefined;
}

// Internal consistency of an active record (doc identity, path/hash/id
// agreement, well-formed binding). Undefined when malformed. A legacy record's
// binding is both-or-neither (Slice 5). A scoped record ALWAYS carries its
// `assessmentRevisionId` (addendum 21.7), already proven equal to the frozen
// revision by the caller, so only its optional presentation id decides
// whether it is bound.
function consistentActivePair(
  data: IndexData,
  lessonSlug: string,
  variantKey: string,
  scoped: boolean,
): ActivePair | undefined {
  if (data.lessonSlug !== lessonSlug || data.variantKey !== variantKey) return undefined;
  if (
    typeof data.currentPresentationRevisionId !== "string" ||
    typeof data.currentPath !== "string" ||
    typeof data.contentSha256 !== "string"
  ) {
    return undefined;
  }
  const bound = scoped ? data.assessmentPresentationRevisionId !== undefined : true;
  try {
    assertActivateWriteConsistent({
      lessonSlug,
      variantKey,
      currentPresentationRevisionId: data.currentPresentationRevisionId,
      currentPath: data.currentPath,
      contentSha256: data.contentSha256,
      ...(bound
        ? {
            assessmentRevisionId: data.assessmentRevisionId,
            assessmentPresentationRevisionId: data.assessmentPresentationRevisionId,
          }
        : {}),
    });
  } catch {
    return undefined;
  }
  return {
    variantKey,
    presentationRevisionId: data.currentPresentationRevisionId,
    path: data.currentPath,
    ...(bound && typeof data.assessmentRevisionId === "string" ? { assessmentRevisionId: data.assessmentRevisionId } : {}),
    ...(bound && typeof data.assessmentPresentationRevisionId === "string"
      ? { assessmentPresentationRevisionId: data.assessmentPresentationRevisionId }
      : {}),
  };
}

function active(source: RevisionCoverageSource, pair: ActivePair): RevisionCoverageEvaluation {
  return {
    kind: "active",
    source,
    variantKey: pair.variantKey,
    presentationRevisionId: pair.presentationRevisionId,
    path: pair.path,
    ...(pair.assessmentRevisionId !== undefined && pair.assessmentPresentationRevisionId !== undefined
      ? {
          assessmentBinding: {
            assessmentRevisionId: pair.assessmentRevisionId,
            assessmentPresentationRevisionId: pair.assessmentPresentationRevisionId,
          },
        }
      : {}),
  };
}

// Pure. A scoped record that exists is authoritative: its identity (lesson,
// variant key, and exactly the frozen revision) is checked before its status,
// so a record naming another revision is malformed whatever its status.
export function evaluateScopedRecord(
  data: unknown,
  lessonSlug: string,
  variantKey: string,
  frozenRevisionId: string,
): RevisionCoverageEvaluation {
  const doc = asIndexData(data);
  if (!doc) return { kind: "malformed" };
  if (
    doc.lessonSlug !== lessonSlug ||
    doc.variantKey !== variantKey ||
    doc.assessmentRevisionId !== frozenRevisionId
  ) {
    return { kind: "malformed" };
  }
  if (doc.status === "retired") return { kind: "retired" };
  if (doc.status !== "active") return { kind: "malformed" };
  const pair = consistentActivePair(doc, lessonSlug, variantKey, true);
  if (!pair) return { kind: "malformed" };
  return active("scoped", pair);
}

// Pure. The legacy (unscoped) record, read only when no scoped record exists.
// Its classification of absent / retired / malformed is exactly the pre-Slice-9
// one; only an active record's revision compatibility is new.
export function evaluateLegacyRecord(
  data: unknown,
  lessonSlug: string,
  variantKey: string,
  frozenRevisionId: string | undefined,
): RevisionCoverageEvaluation {
  const doc = asIndexData(data);
  if (!doc) return { kind: "malformed" };
  if (doc.status === "retired") return { kind: "retired" };
  if (doc.status !== "active") return { kind: "malformed" };
  const pair = consistentActivePair(doc, lessonSlug, variantKey, false);
  if (!pair) return { kind: "malformed" };
  if (frozenRevisionId === undefined) return { kind: "assessmentMismatch" };
  if (pair.assessmentRevisionId !== undefined) {
    return pair.assessmentRevisionId === frozenRevisionId
      ? active("legacyBound", pair)
      : { kind: "assessmentMismatch" };
  }
  // Legacy-r1 rule (S9-D2): an unbound legacy record predates recorded
  // revisions and was published while r1 was the only revision.
  return frozenRevisionId === `assessment_${lessonSlug}__r1`
    ? active("legacyUnboundR1", pair)
    : { kind: "assessmentMismatch" };
}

// The shared evaluator. A thrown read propagates to the caller, which applies
// its own fail-safe direction (launch: canonical with no grant; begin:
// BEGIN_VALIDATION_UNAVAILABLE).
export async function readRevisionCoverage(
  reads: RevisionCoverageReads,
  input: RevisionCoverageInput,
): Promise<RevisionCoverageEvaluation> {
  const { lessonSlug, variantKey } = input;
  // A lesson slug or variant key outside the variant charset can never carry
  // an index document: a legitimate coverage gap, not an error.
  if (!isValidLessonSlugForVariant(lessonSlug) || !isValidVariantKey(variantKey)) {
    return { kind: "absent" };
  }
  const ordinal = frozenRevisionOrdinal(lessonSlug, input.assessmentRevisionId);
  const frozenRevisionId = ordinal !== undefined ? input.assessmentRevisionId : undefined;
  if (ordinal !== undefined && frozenRevisionId !== undefined) {
    const scoped = await reads.readScoped(lessonSlug, variantKey, ordinal);
    if (scoped.exists) return evaluateScopedRecord(scoped.data, lessonSlug, variantKey, frozenRevisionId);
  }
  const legacy = await reads.readLegacy(lessonSlug, variantKey);
  if (!legacy.exists) return { kind: "absent" };
  return evaluateLegacyRecord(legacy.data, lessonSlug, variantKey, frozenRevisionId);
}
