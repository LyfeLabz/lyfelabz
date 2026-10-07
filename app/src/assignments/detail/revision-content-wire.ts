import type { Firestore } from "firebase/firestore";
import { doc, getDoc } from "firebase/firestore";

import {
  parseAssessmentRevisionContent,
  type AssessmentRevisionContentReader,
} from "./question-summary";

// Question results analytics: read seam for the immutable
// `assessmentRevisions/{revisionId}` document (item stems and option text,
// never correct-answer material; ASSESSMENT_IMPLEMENTATION_CONTRACT.md
// section 11 lists "teacher preview (read-only, without answer key)" as a
// reader). Firestore Rules already allow `get` for any active user; no
// rule, index, or callable change is involved. The revision id always
// comes from the attempts being summarized, never from client choice.
const REVISION_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

export function createFirestoreAssessmentRevisionContentReader(
  db: Firestore,
): AssessmentRevisionContentReader {
  return async (revisionId) => {
    if (!REVISION_ID_PATTERN.test(revisionId)) return null;
    try {
      const snap = await getDoc(doc(db, "assessmentRevisions", revisionId));
      if (!snap.exists()) return null;
      return parseAssessmentRevisionContent(revisionId, snap.data());
    } catch {
      return null;
    }
  };
}
