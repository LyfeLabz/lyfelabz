import { PlatformError } from "./errors/platform-error";
import { assessmentDocRef } from "./firestore/typed-ref";

// Canonical owner of every assessment-identifier representation and every
// parse rule used across the platform. Deployment, publish, session-begin,
// and any future callable that needs to name or resolve an assessment
// revision routes through the helpers exported here so no site
// reconstructs the identifier grammar on its own. Concatenating identifier
// fragments outside this module is a contract violation.
//
// Grammar:
//   assessmentId  = "assessment_" lessonSlug
//   revisionId    = assessmentId "__r" revisionOrdinal
//
// `lessonSlug` is the canonical lesson identifier (Data Model §3.6); the
// deployment pipeline uses the same string as the deployment-side
// `activityId`. The revisionOrdinal is a strictly-monotonic positive
// integer stamped by the deployment transaction
// (`assessment-deployment.ts`).

const ASSESSMENT_ID_PREFIX = "assessment_";
const REVISION_ORDINAL_SUFFIX = /__r(\d+)$/;

export function assessmentIdForLessonSlug(lessonSlug: string): string {
  return `${ASSESSMENT_ID_PREFIX}${lessonSlug}`;
}

export function revisionIdForOrdinal(
  assessmentId: string,
  revisionOrdinal: number,
): string {
  return `${assessmentId}__r${revisionOrdinal}`;
}

// Parses the `{assessmentId}__r{ordinal}` suffix. Returns `undefined` if
// the identifier does not match the canonical construction so callers can
// refuse a malformed identifier rather than silently accepting it.
export function parseRevisionOrdinalFromRevisionId(
  revisionId: string,
): number | undefined {
  const match = REVISION_ORDINAL_SUFFIX.exec(revisionId);
  if (!match) return undefined;
  const ordinal = Number(match[1]);
  if (!Number.isFinite(ordinal) || !Number.isInteger(ordinal) || ordinal < 1) {
    return undefined;
  }
  return ordinal;
}

// Derives the parent `assessmentId` embedded in a revision identifier.
// Returns `undefined` if the input does not match the canonical grammar.
export function parseAssessmentIdFromRevisionId(
  revisionId: string,
): string | undefined {
  const match = REVISION_ORDINAL_SUFFIX.exec(revisionId);
  if (!match) return undefined;
  const head = revisionId.slice(0, match.index);
  if (!head.startsWith(ASSESSMENT_ID_PREFIX)) return undefined;
  if (head.length <= ASSESSMENT_ID_PREFIX.length) return undefined;
  return head;
}

// Resolves the current deployed `assessmentRevisionId` for the referenced
// lesson slug. Reads `assessments/{assessmentIdForLessonSlug(lessonSlug)}`
// and returns its `currentRevisionId`. Throws `assessments.notDeployed`
// when the assessment document does not exist or does not carry a
// currentRevisionId, so assignment publish can refuse a lesson whose
// scorable content has never been deployed.
export async function resolveCurrentAssessmentRevisionId(
  lessonSlug: string,
): Promise<string> {
  const assessmentId = assessmentIdForLessonSlug(lessonSlug);
  const snapshot = await assessmentDocRef(assessmentId).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "assessments.notDeployed",
      `No deployed assessment exists for lessonSlug "${lessonSlug}".`,
    );
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError(
      "assessments.notDeployed",
      `Assessment record for lessonSlug "${lessonSlug}" is empty.`,
    );
  }
  const currentRevisionId = (data as { currentRevisionId?: unknown })
    .currentRevisionId;
  if (typeof currentRevisionId !== "string" || currentRevisionId.length === 0) {
    throw new PlatformError(
      "assessments.notDeployed",
      `Assessment record for lessonSlug "${lessonSlug}" has no currentRevisionId.`,
    );
  }
  if (parseRevisionOrdinalFromRevisionId(currentRevisionId) === undefined) {
    throw new PlatformError(
      "assessments.notDeployed",
      `Assessment record for lessonSlug "${lessonSlug}" carries a non-canonical currentRevisionId.`,
    );
  }
  return currentRevisionId;
}
