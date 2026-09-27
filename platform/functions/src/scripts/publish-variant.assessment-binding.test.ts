import { refuseUnpropagatedAssessmentBinding } from "./publish-variant";

// F5.3 Slice 3: a manifest entry bound to an assessment presentation cannot be
// published until a later slice writes the assessment-presentation record and
// propagates the binding. Publishing it now would repoint the index to the
// instructional artifact while silently dropping the certified assessment
// presentation. The retained-revision loader returns this refusal before any
// Hosting deploy or index write.

describe("refuseUnpropagatedAssessmentBinding", () => {
  const AP_ID = `ap${"a".repeat(64)}`;

  it("allows a pre-F5.3 entry with no binding (the historical prff01d9 shape)", () => {
    expect(refuseUnpropagatedAssessmentBinding({})).toBeNull();
  });

  it("refuses a bound entry and names the binding", () => {
    const refusal = refuseUnpropagatedAssessmentBinding({
      assessmentRevisionId: "assessment_earths-layers__r1",
      assessmentPresentationRevisionId: AP_ID,
    });
    expect(refusal).toContain("refusing to publish");
    expect(refusal).toContain(AP_ID);
    expect(refusal).toContain("F5.3 Slice 5");
  });

  it("refuses a half-bound entry too (fail closed)", () => {
    expect(refuseUnpropagatedAssessmentBinding({ assessmentPresentationRevisionId: AP_ID })).not.toBeNull();
    expect(refuseUnpropagatedAssessmentBinding({ assessmentRevisionId: "assessment_x__r1" })).not.toBeNull();
  });
});
