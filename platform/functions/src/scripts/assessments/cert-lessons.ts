import {
  assessmentIdForLessonSlug,
  parseAssessmentIdFromRevisionId,
  parseRevisionOrdinalFromRevisionId,
  revisionIdForOrdinal,
} from "../../shared/assessment-identifiers";

// Sprint 25 Phase 4 - Certification assessment prerequisite.
//
// Canonical, single source of truth for the bounded set of lessons the
// Sprint 25 browser certification environment must be able to ASSIGN and
// PUBLISH. `assignmentsPublish` refuses a draft -> published transition
// unless the referenced lesson already has a deployed assessment (see
// `resolveCurrentAssessmentRevisionId` in
// `shared/assessment-identifiers.ts`; ASSESSMENT_SCORING_CONTRACT.md §12.1).
// The identity/org seed (`seed-emulator.js`) alone leaves the `assessments`
// collection empty, so publication of these cert lessons fails before
// commit. This module names exactly which lessons need a legitimate
// deployed assessment and derives their canonical identifiers so the
// certification seed and the seed verifier agree byte-for-byte.
//
// The set is intentionally bounded. It is NOT the whole LyfeLabz
// curriculum; it is only the lessons the Sprint 25 certification checklist
// exercises on the assign/publish path (the three lessons the operator has
// used through B6). Adding a lesson here means: also add its canonical
// deployment payload (`<slug>.r1.json`) beside this file, so the seed can
// deploy it through the real `deployAssessmentRevision` pipeline.

// Every cert assessment is deployed at revision ordinal 1. The certification
// environment never republishes; a single deployed revision per lesson is
// the entire prerequisite the publish path depends on.
export const CERT_ASSESSMENT_REVISION_ORDINAL = 1 as const;

// A cert lesson: the lesson slug the Assign UI sends (the bare slug, e.g.
// `cell-types`, which is also the deployment-side `activityId`) paired with
// the canonical deployment payload committed beside this file.
export type CertLesson = {
  readonly slug: string;
  readonly payloadFile: string;
};

// The canonical cert lesson set. Order is deterministic (seed and verify
// iterate it in the same order). Kept in sync with the committed payload
// files in this directory.
export const CERT_LESSONS: readonly CertLesson[] = Object.freeze([
  { slug: "what-is-life", payloadFile: "what-is-life.r1.json" },
  { slug: "cell-types", payloadFile: "cell-types.r1.json" },
  { slug: "biological-evolution", payloadFile: "biological-evolution.r1.json" },
]);

export const CERT_LESSON_SLUGS: readonly string[] = Object.freeze(
  CERT_LESSONS.map((lesson) => lesson.slug),
);

// The canonical identifiers a legitimately deployed cert assessment carries.
// Derived exclusively through the shared identifier grammar so no site
// reconstructs the id format on its own.
export type CertAssessmentIdentifiers = {
  readonly assessmentId: string;
  readonly revisionId: string;
  readonly revisionOrdinal: number;
};

export function certAssessmentIdentifiers(
  slug: string,
): CertAssessmentIdentifiers {
  const assessmentId = assessmentIdForLessonSlug(slug);
  return {
    assessmentId,
    revisionId: revisionIdForOrdinal(assessmentId, CERT_ASSESSMENT_REVISION_ORDINAL),
    revisionOrdinal: CERT_ASSESSMENT_REVISION_ORDINAL,
  };
}

// The observed Firestore state for one cert lesson's assessment, as fetched
// by the seed verifier. `data` is the raw document data (or undefined when
// the document is absent). Kept as a plain shape so the verifier is a pure
// function testable without firebase-admin.
export type CertAssessmentObservation = {
  readonly slug: string;
  readonly assessmentExists: boolean;
  readonly assessmentData: Record<string, unknown> | undefined;
  readonly revisionExists: boolean;
  readonly revisionData: Record<string, unknown> | undefined;
  readonly answerKeyExists: boolean;
};

export type CertAssessmentVerdict = {
  readonly slug: string;
  readonly assessmentId: string;
  readonly revisionId: string;
  readonly ok: boolean;
  readonly problems: readonly string[];
};

// Pure invariant checker for a single cert lesson's deployed-assessment
// state. Mirrors the exact prerequisites `assignmentsPublish` depends on
// via `resolveCurrentAssessmentRevisionId`, plus the deployment invariants
// that prove the current revision is a real, correctly-paired revision of
// the right lesson - so certification startup can refuse to proceed with an
// empty or malformed assessment fixture (the B6 environment defect).
//
// It intentionally does NOT relax any production check. The publish path
// requires: the assessment document exists, carries a non-empty
// `currentRevisionId`, and that id is canonical. This verifier requires all
// of that AND that the referenced revision document actually exists and
// belongs to the correct assessment/lesson at the expected ordinal.
export function evaluateCertAssessment(
  observation: CertAssessmentObservation,
): CertAssessmentVerdict {
  const { assessmentId, revisionId, revisionOrdinal } = certAssessmentIdentifiers(
    observation.slug,
  );
  const problems: string[] = [];

  if (!observation.assessmentExists || observation.assessmentData === undefined) {
    problems.push(
      `assessments/${assessmentId} does not exist (assessment never deployed).`,
    );
    // Without the assessment document nothing else can be checked.
    return { slug: observation.slug, assessmentId, revisionId, ok: false, problems };
  }

  const data = observation.assessmentData;

  const activityId = data.activityId;
  if (activityId !== observation.slug) {
    problems.push(
      `assessments/${assessmentId}.activityId is "${String(activityId)}", expected "${observation.slug}".`,
    );
  }

  const currentRevisionId = data.currentRevisionId;
  if (typeof currentRevisionId !== "string" || currentRevisionId.length === 0) {
    problems.push(
      `assessments/${assessmentId}.currentRevisionId is missing or empty.`,
    );
    return { slug: observation.slug, assessmentId, revisionId, ok: false, problems };
  }

  if (parseRevisionOrdinalFromRevisionId(currentRevisionId) === undefined) {
    problems.push(
      `assessments/${assessmentId}.currentRevisionId "${currentRevisionId}" is not a canonical revision id.`,
    );
  }

  if (currentRevisionId !== revisionId) {
    problems.push(
      `assessments/${assessmentId}.currentRevisionId "${currentRevisionId}" does not match the expected cert revision "${revisionId}".`,
    );
  }

  // Dangling pointer: the assessment names a current revision, but the
  // revision document is absent.
  if (!observation.revisionExists || observation.revisionData === undefined) {
    problems.push(
      `assessmentRevisions/${currentRevisionId} does not exist (dangling currentRevisionId).`,
    );
    return {
      slug: observation.slug,
      assessmentId,
      revisionId,
      ok: problems.length === 0,
      problems,
    };
  }

  const revision = observation.revisionData;
  if (revision.assessmentId !== assessmentId) {
    problems.push(
      `assessmentRevisions/${currentRevisionId}.assessmentId is "${String(revision.assessmentId)}", expected "${assessmentId}".`,
    );
  }
  if (revision.activityId !== observation.slug) {
    problems.push(
      `assessmentRevisions/${currentRevisionId}.activityId is "${String(revision.activityId)}", expected "${observation.slug}".`,
    );
  }
  if (revision.revisionOrdinal !== revisionOrdinal) {
    problems.push(
      `assessmentRevisions/${currentRevisionId}.revisionOrdinal is ${String(revision.revisionOrdinal)}, expected ${String(revisionOrdinal)}.`,
    );
  }
  const parsedParent = parseAssessmentIdFromRevisionId(currentRevisionId);
  if (parsedParent !== assessmentId) {
    problems.push(
      `currentRevisionId "${currentRevisionId}" does not encode parent assessment "${assessmentId}".`,
    );
  }

  // The answer key is written by the same atomic deployment transaction; a
  // legitimately deployed revision always has one. Its absence signals a
  // partial or hand-mocked fixture.
  if (!observation.answerKeyExists) {
    problems.push(
      `assessmentAnswerKeys/${currentRevisionId} does not exist (assessment not fully deployed).`,
    );
  }

  return {
    slug: observation.slug,
    assessmentId,
    revisionId,
    ok: problems.length === 0,
    problems,
  };
}
