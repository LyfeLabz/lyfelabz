import {
  CERT_ASSESSMENT_REVISION_ORDINAL,
  CERT_LESSONS,
  CERT_LESSON_SLUGS,
  certAssessmentIdentifiers,
  evaluateCertAssessment,
  type CertAssessmentObservation,
} from "./cert-lessons";

import whatIsLife from "./what-is-life.r1.json";
import cellTypes from "./cell-types.r1.json";
import biologicalEvolution from "./biological-evolution.r1.json";

// Sprint 25 Phase 4 - Certification assessment prerequisite.
//
// These tests prove the certification seed's canonical source of truth is
// self-consistent, that every committed cert payload is a legitimate
// deployment input (structurally per ASSESSMENT_SCORING_CONTRACT.md §4/§5),
// and that the seed verifier's invariant checker rejects every way the
// deployed-assessment prerequisite can be missing or malformed (the B6
// environment defect). Deployment through the certified pipeline is covered
// in cert-lessons.deploy.test.ts; resolution through the publish path is
// covered in cert-lessons.resolve.test.ts.

const PAYLOADS: Record<string, unknown> = {
  "what-is-life": whatIsLife,
  "cell-types": cellTypes,
  "biological-evolution": biologicalEvolution,
};

describe("cert lesson set", () => {
  it("names exactly the bounded cert lessons and keeps slugs in sync", () => {
    expect(CERT_LESSON_SLUGS).toEqual([
      "what-is-life",
      "cell-types",
      "biological-evolution",
    ]);
    expect(CERT_LESSONS.map((l) => l.slug)).toEqual(CERT_LESSON_SLUGS);
  });

  it("derives canonical identifiers through the shared grammar", () => {
    expect(certAssessmentIdentifiers("cell-types")).toEqual({
      assessmentId: "assessment_cell-types",
      revisionId: "assessment_cell-types__r1",
      revisionOrdinal: 1,
    });
    expect(CERT_ASSESSMENT_REVISION_ORDINAL).toBe(1);
  });

  it("has a committed payload for every cert lesson", () => {
    for (const lesson of CERT_LESSONS) {
      expect(PAYLOADS[lesson.slug]).toBeDefined();
      expect(lesson.payloadFile).toBe(`${lesson.slug}.r1.json`);
    }
  });
});

describe("committed cert payloads are legitimate deployment inputs", () => {
  for (const lesson of CERT_LESSONS) {
    const payload = PAYLOADS[lesson.slug] as Record<string, unknown>;

    describe(lesson.slug, () => {
      it("matches the deployment envelope contract", () => {
        expect(payload.activityId).toBe(lesson.slug);
        expect(payload.revisionOrdinal).toBe(CERT_ASSESSMENT_REVISION_ORDINAL);
        expect(payload.itemOrderingRule).toBe("authoredOrder");
        expect(payload.schemaVersion).toBe(1);
        expect(typeof payload.publishedBy).toBe("string");
        expect((payload.publishedBy as string).length).toBeGreaterThan(0);
      });

      it("carries a non-empty, well-formed singleChoice item set", () => {
        const items = payload.items as Array<Record<string, unknown>>;
        expect(Array.isArray(items)).toBe(true);
        expect(items.length).toBeGreaterThan(0);

        const seenItemIds = new Set<string>();
        for (const item of items) {
          expect(typeof item.itemId).toBe("string");
          expect(seenItemIds.has(item.itemId as string)).toBe(false);
          seenItemIds.add(item.itemId as string);

          expect(item.itemType).toBe("singleChoice");
          expect(typeof item.stem).toBe("string");
          expect((item.stem as string).length).toBeGreaterThan(0);
          expect(item.points).toBe(1);
          expect(typeof item.explanation).toBe("string");
          expect((item.explanation as string).length).toBeGreaterThan(0);

          const options = item.options as Array<Record<string, unknown>>;
          expect(options.length).toBeGreaterThanOrEqual(2);
          const seenOptionIds = new Set<string>();
          for (const opt of options) {
            expect(typeof opt.optionId).toBe("string");
            expect(seenOptionIds.has(opt.optionId as string)).toBe(false);
            seenOptionIds.add(opt.optionId as string);
            expect(typeof opt.text).toBe("string");
            expect((opt.text as string).length).toBeGreaterThan(0);
          }
          // correctOptionId must be one of the item's own options (§5.3).
          expect(seenOptionIds.has(item.correctOptionId as string)).toBe(true);
        }
      });
    });
  }
});

// A fully valid observation for one cert lesson, matching what a real
// deployed assessment produces. Individual tests mutate one field to prove
// the corresponding invariant is enforced.
function goodObservation(
  slug = "cell-types",
  overrides: Partial<CertAssessmentObservation> = {},
): CertAssessmentObservation {
  const { assessmentId, revisionId } = certAssessmentIdentifiers(slug);
  return {
    slug,
    assessmentExists: true,
    assessmentData: { assessmentId, activityId: slug, currentRevisionId: revisionId },
    revisionExists: true,
    revisionData: { assessmentId, activityId: slug, revisionOrdinal: 1 },
    answerKeyExists: true,
    ...overrides,
  };
}

describe("evaluateCertAssessment", () => {
  it("accepts a legitimately deployed cert assessment", () => {
    const verdict = evaluateCertAssessment(goodObservation());
    expect(verdict.ok).toBe(true);
    expect(verdict.problems).toEqual([]);
    expect(verdict.assessmentId).toBe("assessment_cell-types");
    expect(verdict.revisionId).toBe("assessment_cell-types__r1");
  });

  it("rejects a missing assessment document (never deployed)", () => {
    const verdict = evaluateCertAssessment(
      goodObservation("cell-types", { assessmentExists: false, assessmentData: undefined }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toMatch(/does not exist/);
  });

  it("rejects a missing / empty currentRevisionId", () => {
    const verdict = evaluateCertAssessment(
      goodObservation("cell-types", {
        assessmentData: { assessmentId: "assessment_cell-types", activityId: "cell-types" },
      }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toMatch(/currentRevisionId is missing or empty/);
  });

  it("rejects a dangling currentRevisionId (revision document absent)", () => {
    const verdict = evaluateCertAssessment(
      goodObservation("cell-types", { revisionExists: false, revisionData: undefined }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toMatch(/dangling currentRevisionId/);
  });

  it("rejects a non-canonical currentRevisionId", () => {
    const verdict = evaluateCertAssessment(
      goodObservation("cell-types", {
        assessmentData: {
          assessmentId: "assessment_cell-types",
          activityId: "cell-types",
          currentRevisionId: "not-a-canonical-id",
        },
      }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toMatch(/not a canonical revision id|does not match/);
  });

  it("rejects a revision that belongs to the wrong lesson/assessment", () => {
    const verdict = evaluateCertAssessment(
      goodObservation("cell-types", {
        revisionData: {
          assessmentId: "assessment_what-is-life",
          activityId: "what-is-life",
          revisionOrdinal: 1,
        },
      }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toMatch(/assessmentId is "assessment_what-is-life"/);
  });

  it("rejects an assessment missing its paired answer key", () => {
    const verdict = evaluateCertAssessment(
      goodObservation("cell-types", { answerKeyExists: false }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toMatch(/assessmentAnswerKeys/);
  });
});
