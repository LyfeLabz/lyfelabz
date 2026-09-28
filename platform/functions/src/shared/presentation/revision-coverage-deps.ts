import type { DocumentReference } from "firebase-admin/firestore";

import type { PresentationVariantIndexDoc } from "../types/presentation-variant";
import {
  readRevisionCoverage,
  type CoverageDocRead,
  type RevisionCoverageEvaluation,
  type RevisionCoverageInput,
  type RevisionCoverageReads,
} from "./revision-coverage";

// F5.3 Slice 9C-1 - Firestore wiring for the shared revision-aware coverage
// evaluator (`./revision-coverage`). Both the launch resolver
// (`launch-presentation-deps.ts`) and begin (`assessments/begin-delivery-deps.ts`)
// classify coverage ONLY through `readRevisionCoverageWith`, so they share one
// lookup order and one classification. Each caller passes the two typed
// document-reference factories from its own import boundary (which is also
// where its tests substitute fakes). Server (Admin SDK) reads only; no
// writes. A thrown read propagates to the caller's fail-safe handling.

export type RevisionCoverageRefs = {
  readonly scopedRef: (
    lessonSlug: string,
    variantKey: string,
    revisionOrdinal: number,
  ) => Pick<DocumentReference<PresentationVariantIndexDoc>, "get">;
  readonly legacyRef: (
    lessonSlug: string,
    variantKey: string,
  ) => Pick<DocumentReference<PresentationVariantIndexDoc>, "get">;
};

async function readDoc(ref: Pick<DocumentReference<PresentationVariantIndexDoc>, "get">): Promise<CoverageDocRead> {
  const snapshot = await ref.get();
  return snapshot.exists ? { exists: true, data: snapshot.data() } : { exists: false };
}

export function revisionCoverageReads(refs: RevisionCoverageRefs): RevisionCoverageReads {
  return {
    readScoped: (lessonSlug, variantKey, revisionOrdinal) => readDoc(refs.scopedRef(lessonSlug, variantKey, revisionOrdinal)),
    readLegacy: (lessonSlug, variantKey) => readDoc(refs.legacyRef(lessonSlug, variantKey)),
  };
}

export function readRevisionCoverageWith(
  refs: RevisionCoverageRefs,
  input: RevisionCoverageInput,
): Promise<RevisionCoverageEvaluation> {
  return readRevisionCoverage(revisionCoverageReads(refs), input);
}
