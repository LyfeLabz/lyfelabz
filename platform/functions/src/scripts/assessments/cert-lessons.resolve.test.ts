// Proves the exact prerequisite assignmentsPublish depends on:
// resolveCurrentAssessmentRevisionId (assignments-publish.ts line ~221)
// resolves the current deployed revision for a cert lesson once the seed has
// deployed it, and still throws assessments.notDeployed for a genuinely
// undeployed lesson (the production negative contract, unchanged).
//
// assignments-publish.test.ts already proves that publish succeeds when this
// resolver returns a revision id; this suite closes the loop by proving the
// resolver returns the canonical cert revision id against the seeded shape.

const mockAssessmentGet = jest.fn();
const mockAssessmentDocRef = jest.fn(() => ({ get: mockAssessmentGet }));

jest.mock("../../shared/firestore/typed-ref", () => ({
  assessmentDocRef: mockAssessmentDocRef,
}));

import { PlatformError } from "../../shared/errors/platform-error";
import { resolveCurrentAssessmentRevisionId } from "../../shared/assessment-identifiers";
import { CERT_LESSONS, certAssessmentIdentifiers } from "./cert-lessons";

function seededSnapshot(slug: string) {
  const { assessmentId, revisionId } = certAssessmentIdentifiers(slug);
  return {
    exists: true,
    data: () => ({ assessmentId, activityId: slug, currentRevisionId: revisionId }),
  };
}

beforeEach(() => {
  mockAssessmentGet.mockReset();
  mockAssessmentDocRef.mockClear();
});

describe("resolveCurrentAssessmentRevisionId against the cert seed", () => {
  for (const lesson of CERT_LESSONS) {
    it(`${lesson.slug}: returns the canonical cert revision id`, async () => {
      const { assessmentId, revisionId } = certAssessmentIdentifiers(lesson.slug);
      mockAssessmentGet.mockResolvedValue(seededSnapshot(lesson.slug));

      const resolved = await resolveCurrentAssessmentRevisionId(lesson.slug);

      expect(resolved).toBe(revisionId);
      expect(mockAssessmentDocRef).toHaveBeenCalledWith(assessmentId);
    });
  }

  it("still throws assessments.notDeployed for a genuinely undeployed lesson", async () => {
    mockAssessmentGet.mockResolvedValue({ exists: false, data: () => undefined });

    await expect(
      resolveCurrentAssessmentRevisionId("some-undeployed-lesson"),
    ).rejects.toMatchObject({ code: "assessments.notDeployed" });
  });

  it("throws assessments.notDeployed when the assessment carries no currentRevisionId", async () => {
    mockAssessmentGet.mockResolvedValue({
      exists: true,
      data: () => ({ assessmentId: "assessment_cell-types", activityId: "cell-types" }),
    });

    const error = await resolveCurrentAssessmentRevisionId("cell-types").catch((e) => e);
    expect(error).toBeInstanceOf(PlatformError);
    expect((error as PlatformError).code).toBe("assessments.notDeployed");
  });
});
