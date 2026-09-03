import type { FieldValue, Timestamp } from "firebase-admin/firestore";

import type { ReadingLevel } from "./student-accommodation";

// F5.2 Implementation Specification §3.5/§5.3 - Persistent Student
// Differentiation, Slice 3 (publication state machine + runtime index +
// retention gating). This is the NEW server-owned current-presentation index
// record family `presentationVariants/{lessonSlug}__{variantKey}`.
//
// The index is MUTABLE current-state metadata: it names, for one
// (lessonSlug, variantKey) pair, the single differentiated presentation
// revision that is currently eligible to be delivered. It is NOT the
// historical retention ledger - historical truth lives in the immutable
// artifact files and the append-only manifest (app/lessons/variants/
// manifest.json, §6). Old revisions become historical simply by no longer
// being pointed to; nothing here is ever the durable record of a delivered
// attempt (attempts self-carry their frozen ids, §3.4).
//
// This record stores NO student identity, NO assignment identity, NO
// accommodation-plan text, and never a copy of the whole manifest (§3.5,
// §11). Zero direct client access for any role (deny-all Rules block); the
// only writer is the Slice 3 publish tooling, which advances the pointer
// exclusively through the §6.8 index-last state machine.

export const PRESENTATION_VARIANTS_COLLECTION = "presentationVariants";

// §5.3 - an index doc is `"active"` while its current revision is eligible
// for differentiated resolution, or `"retired"` when the logical variant has
// been withdrawn from new differentiated resolution. Retirement never
// deletes the artifact or its manifest entry (§ retirement).
export type PresentationVariantStatus = "active" | "retired";

export const PRESENTATION_VARIANT_STATUSES: readonly PresentationVariantStatus[] = [
  "active",
  "retired",
];

// §5.1/M3 charset. A lessonSlug participating in variant publication must
// match this (no underscore) so the "__" delimiter in the index doc ID and
// in manifest keys stays unambiguous. Mirrors LESSON_SLUG_VARIANT_RE in the
// build tooling's variantIdentity.cjs; the two encode the same contract in
// their two runtimes (build tooling vs Cloud Functions) and must not drift.
const LESSON_SLUG_VARIANT_RE = /^[a-z0-9-]+$/;

// §3.2 - V1 variantKey vocabulary is the closed, deterministic set
// { "reading-adapted" }. A variantKey never contains an underscore (so the
// "__" doc-ID delimiter is unambiguous) and never appears in a
// student-visible artifact path (M4).
const VARIANT_KEY_RE = /^[a-z0-9-]+$/;

// "pr" + full 64 lowercase-hex-char SHA-256 digest (M2). Mirrors
// PRESENTATION_REVISION_ID_RE in variantIdentity.cjs.
const PRESENTATION_REVISION_ID_RE = /^pr[0-9a-f]{64}$/;

const SHA256_RE = /^[0-9a-f]{64}$/;

// §3.2 - deterministic derivation of the logical presentation identity from
// a reading-accessibility level. `variantKey = "reading-" + level`; V1's
// only member is "reading-adapted".
export function variantKeyForReadingLevel(level: ReadingLevel): string {
  return `reading-${level}`;
}

export function isValidLessonSlugForVariant(slug: string): boolean {
  return typeof slug === "string" && LESSON_SLUG_VARIANT_RE.test(slug);
}

export function isValidVariantKey(variantKey: string): boolean {
  return (
    typeof variantKey === "string" &&
    VARIANT_KEY_RE.test(variantKey) &&
    !variantKey.includes("__")
  );
}

export function isValidPresentationRevisionId(id: string): boolean {
  return typeof id === "string" && PRESENTATION_REVISION_ID_RE.test(id);
}

// §3.5/§5.3 - the deterministic index document ID for one (lessonSlug,
// variantKey) pair. The "__" delimiter is unambiguous because neither
// component may contain an underscore (validated above). Throws on an
// invalid component so a malformed pair can never silently produce a
// colliding or ambiguous doc ID.
export function presentationVariantIndexDocId(lessonSlug: string, variantKey: string): string {
  if (!isValidLessonSlugForVariant(lessonSlug)) {
    throw new Error(
      `[presentation-variant] lessonSlug "${lessonSlug}" is not valid for variant publication (must match ^[a-z0-9-]+$)`,
    );
  }
  if (!isValidVariantKey(variantKey)) {
    throw new Error(
      `[presentation-variant] variantKey "${variantKey}" is invalid (must match ^[a-z0-9-]+$ and contain no "__")`,
    );
  }
  return `${lessonSlug}__${variantKey}`;
}

// Canonical read shape for `presentationVariants/{lessonSlug}__{variantKey}`
// per §5.3. `currentPath` may only ever reference an immutable artifact
// already confirmed retrievable (the §6.8 invariant, enforced by the publish
// tooling + suite P, never by this type alone). Absence of the document
// means "no current differentiated coverage for this pair" and resolves to
// canonical fallback (§8.5) - but no student code reads this until Slice 4.
export type PresentationVariantIndexDoc = {
  readonly lessonSlug: string;
  // Immutable for the life of the doc: it is half of the doc ID.
  readonly variantKey: string;
  readonly currentPresentationRevisionId: string;
  readonly currentPath: string;
  // Full 64-hex SHA-256 of the current revision's bytes (the manifest
  // sha256), carried so the index is internally self-consistent
  // (currentPresentationRevisionId === "pr" + contentSha256).
  readonly contentSha256: string;
  readonly status: PresentationVariantStatus;
  readonly updatedAt: Timestamp;
  // Server-owned attribution: the trusted operator/service identity that ran
  // the publish tooling. Never accepted from an arbitrary client request.
  readonly publishedBy: string;
};

// Write shape for a publish or a rollback/repoint: the pointer is (re)set to
// a retained, liveness-confirmed revision and the status is forced active.
// `updatedAt` is a server FieldValue so wall-clock time is server-authored.
export type PresentationVariantIndexActivateWrite = {
  readonly lessonSlug: string;
  readonly variantKey: string;
  readonly currentPresentationRevisionId: string;
  readonly currentPath: string;
  readonly contentSha256: string;
  readonly status: "active";
  readonly updatedAt: FieldValue;
  readonly publishedBy: string;
};

// Write shape for retirement: only the status flips (plus attribution and
// timestamp). The current pointer/hash are intentionally left in place so
// the withdrawn revision remains identifiable; the artifact and its manifest
// entry are never touched.
export type PresentationVariantIndexRetireWrite = {
  readonly status: "retired";
  readonly updatedAt: FieldValue;
  readonly publishedBy: string;
};

// Runtime self-consistency validation for a fully-formed activate write,
// independent of Firestore. The publish state machine calls this before any
// index write so an internally inconsistent pointer (path/hash/id
// disagreement) can never be written, even though every value is derived
// from the trusted manifest.
export function assertActivateWriteConsistent(write: {
  readonly lessonSlug: string;
  readonly variantKey: string;
  readonly currentPresentationRevisionId: string;
  readonly currentPath: string;
  readonly contentSha256: string;
}): void {
  if (!isValidLessonSlugForVariant(write.lessonSlug)) {
    throw new Error(`[presentation-variant] invalid lessonSlug: ${write.lessonSlug}`);
  }
  if (!isValidVariantKey(write.variantKey)) {
    throw new Error(`[presentation-variant] invalid variantKey: ${write.variantKey}`);
  }
  if (!isValidPresentationRevisionId(write.currentPresentationRevisionId)) {
    throw new Error(
      `[presentation-variant] invalid presentationRevisionId: ${write.currentPresentationRevisionId}`,
    );
  }
  if (!SHA256_RE.test(write.contentSha256)) {
    throw new Error(`[presentation-variant] contentSha256 is not a 64-hex digest: ${write.contentSha256}`);
  }
  if (write.currentPresentationRevisionId !== `pr${write.contentSha256}`) {
    throw new Error(
      "[presentation-variant] currentPresentationRevisionId does not match contentSha256 (identity self-consistency failure)",
    );
  }
  // The opaque student-visible path formula (M4): lessonSlug + revision id,
  // never a variantKey. Mirrors variantIdentity.variantRelativeOutputPath.
  const expectedPath = `app/lessons/variants/lesson_${write.lessonSlug}__${write.currentPresentationRevisionId}.html`;
  if (write.currentPath !== expectedPath) {
    throw new Error(
      `[presentation-variant] currentPath "${write.currentPath}" does not match the identity formula "${expectedPath}"`,
    );
  }
}
