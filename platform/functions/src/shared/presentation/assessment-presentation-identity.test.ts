import * as path from "path";
import { createRequire } from "module";

import {
  canonicalJson,
  checkAssessmentPresentationDoc,
  computeAssessmentPresentationRevisionId,
  displayedOptionIdsByItem,
} from "./assessment-presentation-identity";
import { assertActivateWriteConsistent } from "../types/presentation-variant";
import type { AssessmentPresentationRecord } from "../types/assessment-presentation";

// F5.3 Slice 5 - server-side identity of immutable assessment presentations.
// The build tooling (app/scripts/lessonBuilder/assessmentPresentation.cjs,
// dependency-free) must compute the SAME id; the parity test loads it the way
// the publisher does.

const LESSON = "synthetic-lesson";
const REV = `assessment_${LESSON}__r1`;

function record(overrides: Record<string, unknown> = {}): AssessmentPresentationRecord {
  return {
    schemaVersion: 1,
    kind: "lyfelabz.assessmentPresentation",
    lessonSlug: LESSON,
    assessmentRevisionId: REV,
    traits: { language: "adapted", choiceCount: 3 },
    directions: "Pick the best answer.",
    items: [
      { itemId: "q1", stem: "Q1?", displayedOptions: [{ optionId: "C", text: "c" }, { optionId: "A", text: "a" }, { optionId: "D", text: "d" }], omittedOptions: [{ optionId: "B", rationale: "r" }], feedback: "f" },
      { itemId: "q2", stem: "Q2?", displayedOptions: [{ optionId: "A", text: "a" }, { optionId: "B", text: "b" }, { optionId: "D", text: "d" }], omittedOptions: [{ optionId: "C", rationale: "r" }], feedback: null },
    ],
    showYourThinking: { prompt: "Explain convection.", modelAnswer: "m", requiredTerms: ["convection"] },
    ...overrides,
  };
}

describe("assessment-presentation identity", () => {
  it("matches the build tooling's canonical serialization and id exactly", () => {
    const repoRoot = path.resolve(__dirname, "..", "..", "..", "..", "..");
    const req = createRequire(__filename);
    const tooling = req(path.join(repoRoot, "app", "scripts", "lessonBuilder", "assessmentPresentation.cjs")) as {
      canonicalJson: (v: unknown) => string;
      assessmentPresentationRevisionIdFor: (r: unknown) => string;
    };
    const r = record();
    expect(canonicalJson(r)).toBe(tooling.canonicalJson(r));
    expect(computeAssessmentPresentationRevisionId(r)).toBe(tooling.assessmentPresentationRevisionIdFor(r));
  });

  it("matches the build tooling for a structured paragraph model answer, in any key order", () => {
    const repoRoot = path.resolve(__dirname, "..", "..", "..", "..", "..");
    const req = createRequire(__filename);
    const tooling = req(path.join(repoRoot, "app", "scripts", "lessonBuilder", "assessmentPresentation.cjs")) as {
      canonicalJson: (v: unknown) => string;
      assessmentPresentationRevisionIdFor: (r: unknown) => string;
    };
    const r = record({
      showYourThinking: {
        prompt: "Explain your claim, evidence, and reasoning.",
        modelAnswer: {
          paragraphs: [
            { lead: "Claim:", text: "c" },
            { lead: "Evidence:", text: "e" },
            { lead: null, text: "r" },
          ],
        },
        requiredTerms: ["claim"],
      },
    });
    expect(canonicalJson(r)).toBe(tooling.canonicalJson(r));
    expect(computeAssessmentPresentationRevisionId(r)).toBe(tooling.assessmentPresentationRevisionIdFor(r));
    const reversed = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(reversed);
      if (v !== null && typeof v === "object") {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(v).reverse()) out[k] = reversed((v as Record<string, unknown>)[k]);
        return out;
      }
      return v;
    };
    expect(computeAssessmentPresentationRevisionId(reversed(r))).toBe(computeAssessmentPresentationRevisionId(r));
    expect(canonicalJson(r)).toContain('{"lead":null,"text":"r"}');
  });

  it("is independent of key order (Firestore may return maps in any order)", () => {
    const r = record();
    const reordered = JSON.parse(JSON.stringify(r)) as Record<string, unknown>;
    const shuffled: Record<string, unknown> = {};
    for (const k of Object.keys(reordered).reverse()) shuffled[k] = reordered[k];
    expect(computeAssessmentPresentationRevisionId(shuffled)).toBe(computeAssessmentPresentationRevisionId(r));
  });

  it("accepts an intact record for its lesson and revision", () => {
    const r = record();
    const check = checkAssessmentPresentationDoc(computeAssessmentPresentationRevisionId(r), r, { lessonSlug: LESSON, assessmentRevisionId: REV });
    expect(check.ok).toBe(true);
  });

  it.each([
    ["missing", () => [computeAssessmentPresentationRevisionId(record()), undefined, {}], "missing"],
    ["malformed id", () => ["ap123", record(), {}], "malformedId"],
    ["altered content", () => [computeAssessmentPresentationRevisionId(record()), record({ directions: "altered" }), {}], "contentMismatch"],
    ["another lesson", () => {
      const r = record({ lessonSlug: "other" });
      return [computeAssessmentPresentationRevisionId(r), r, {}];
    }, "lessonMismatch"],
    ["another assessment revision", () => {
      const r = record({ assessmentRevisionId: `assessment_${LESSON}__r2` });
      return [computeAssessmentPresentationRevisionId(r), r, {}];
    }, "assessmentRevisionMismatch"],
    ["duplicate displayed optionIds", () => {
      const r = record();
      const bad = { ...r, items: [{ ...r.items[0], displayedOptions: [{ optionId: "A", text: "a" }, { optionId: "A", text: "b" }] }, r.items[1]] };
      return [computeAssessmentPresentationRevisionId(bad), bad, {}];
    }, "schema"],
  ])("refuses %s", (_label, make, reason) => {
    const [id, data] = make() as [string, unknown];
    const check = checkAssessmentPresentationDoc(id, data, { lessonSlug: LESSON, assessmentRevisionId: REV });
    expect(check).toEqual({ ok: false, reason });
  });

  it("extracts the displayed canonical optionIds per item", () => {
    const map = displayedOptionIdsByItem(record());
    expect([...map.get("q1")!]).toEqual(["C", "A", "D"]);
    expect(map.get("q1")!.has("B")).toBe(false);
  });
});

describe("index binding self-consistency (assertActivateWriteConsistent)", () => {
  const SHA = "a".repeat(64);
  const base = {
    lessonSlug: LESSON,
    variantKey: "reading-adapted",
    currentPresentationRevisionId: `pr${SHA}`,
    currentPath: `app/lessons/variants/lesson_${LESSON}__pr${SHA}.html`,
    contentSha256: SHA,
  };
  const AP = `ap${"b".repeat(64)}`;

  it("accepts an unbound index and a well-formed binding", () => {
    expect(() => assertActivateWriteConsistent(base)).not.toThrow();
    expect(() => assertActivateWriteConsistent({ ...base, assessmentRevisionId: REV, assessmentPresentationRevisionId: AP })).not.toThrow();
  });

  it.each([
    ["half a binding", { assessmentPresentationRevisionId: AP }, "together"],
    ["a malformed presentation id", { assessmentRevisionId: REV, assessmentPresentationRevisionId: "ap1" }, "ap<sha256>"],
    ["another lesson's revision", { assessmentRevisionId: "assessment_other__r1", assessmentPresentationRevisionId: AP }, "must be a revision of"],
  ])("refuses %s", (_label, extra, message) => {
    expect(() => assertActivateWriteConsistent({ ...base, ...extra })).toThrow(message);
  });
});
