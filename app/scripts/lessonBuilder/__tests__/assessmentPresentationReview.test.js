/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * F5.3 Slice 6A - owner-review tooling for draft assessment presentations:
 * answer-cue heuristics, identical-to-canonical findings, two-sided
 * required-term equivalence, authoring-notes integrity, the display-position
 * target, the uncertified preview and its retention guard, and the real
 * Earth's Layers draft. Nothing here writes to the repository.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const AP = require("../assessmentPresentation.cjs");
const R = require("../assessmentPresentationRender.cjs");
const REV = require("../assessmentPresentationReview.cjs");
const variantSource = require("../variantSource.cjs");
const { generateVariantArtifact, UNCERTIFIED_PREVIEW_MARKER } = require("../variantBuild.cjs");
const cli = require("../../assessment-presentation-review.cjs");
const paths = require("../paths.cjs");
const F = require("./fixtures/assessmentPresentationFixtures");

const codes = (list) => list.map((f) => f.code);
function cue(stem, texts, correct = "A") {
  return AP.itemCueFindings({ stem, choices: texts.map((text, i) => ({ optionId: "ABC"[i], text })), correctOptionId: correct });
}

describe("answer-cue heuristics (item level)", () => {
  test("LENGTH_CUE is hard when the correct choice is uniquely longest at a ratio of 1.5 or more", () => {
    expect(codes(cue("Pick one.", ["x".repeat(15), "y".repeat(10), "z".repeat(7)]).hard)).toEqual(["LENGTH_CUE"]);
    const below = cue("Pick one.", ["x".repeat(14), "y".repeat(10), "z".repeat(7)]);
    expect(codes(below.hard)).toEqual([]);
    expect(codes(below.warnings)).toEqual(["LENGTH_LONGEST"]); // 1.4
    expect(codes(cue("Pick one.", ["x".repeat(12), "y".repeat(10), "z"]).warnings)).toEqual([]); // 1.2
    // A tie for longest is not "uniquely longest".
    expect(codes(cue("Pick one.", ["x".repeat(20), "y".repeat(20), "z"]).hard)).toEqual([]);
  });

  test("ANSWER_MARKER is hard for marker words and symbols in any displayed choice", () => {
    expect(codes(cue("Pick one.", ["Rocks (correct)", "Water and ice", "Warm, moving air"]).hard)).toEqual(["ANSWER_MARKER"]);
    expect(codes(cue("Pick one.", ["Rocks", "This answer", "Air"]).hard)).toEqual(["ANSWER_MARKER"]);
    expect(codes(cue("Pick one.", ["Rocks ✓", "Water", "Air"]).hard)).toEqual(["ANSWER_MARKER"]);
    expect(codes(cue("Pick one.", ["Rocks", "Water", "Air"]).hard)).toEqual([]);
  });

  test("STEM_ECHO warns when a distinctive stem word appears only in the correct choice (prefix variants match)", () => {
    const echo = cue("Why do the densest materials sink?", ["Denser materials sink lower", "Magnets pull metal", "Heat rises up"]);
    expect(codes(echo.warnings)).toContain("STEM_ECHO");
    expect(echo.warnings.find((f) => f.code === "STEM_ECHO").detail).toMatch(/"densest"/);
    // Shared with a distractor: not a cue.
    expect(codes(cue("Why do the densest materials sink?", ["Denser materials sink lower", "Dense materials sink higher", "Heat rises up"]).warnings)).not.toContain("STEM_ECHO");
    // Stop words and short words never count.
    expect(codes(cue("Which statement is true?", ["The statement is true", "Water", "Air"]).warnings)).not.toContain("STEM_ECHO");
  });

  test("ABSOLUTE_QUALIFIER warns only when distractors use absolutes and the correct choice does not", () => {
    expect(codes(cue("Pick one.", ["Heat from inside", "Only wind", "Gravity"]).warnings)).toContain("ABSOLUTE_QUALIFIER");
    expect(codes(cue("Pick one.", ["Only heat from inside", "Only wind", "Gravity"]).warnings)).not.toContain("ABSOLUTE_QUALIFIER");
  });

  test("ALL_NONE_OF_ABOVE and ARTICLE_AGREEMENT warn", () => {
    expect(codes(cue("Pick one.", ["Rocks", "All of the above", "Air"]).warnings)).toContain("ALL_NONE_OF_ABOVE");
    expect(codes(cue("Molten rock underground is called an", ["Magma pocket", "Igneous"], "B").warnings)).toContain("ARTICLE_AGREEMENT");
    expect(codes(cue("Molten rock underground is called an", ["Ore", "Igneous"], "B").warnings)).not.toContain("ARTICLE_AGREEMENT");
  });
});

describe("answer cues inside the one validator", () => {
  function withCorrectText(record, payload, itemIndex, text) {
    const r = JSON.parse(JSON.stringify(record));
    const correct = payload.items[itemIndex].correctOptionId;
    r.items[itemIndex].displayedOptions.find((o) => o.optionId === correct).text = text;
    return r;
  }

  test("an adapted presentation with a hard cue fails validation", () => {
    const payload = F.canonicalPayload();
    const record = withCorrectText(F.adaptedThreeChoice(payload), payload, 0, "A much longer correct choice text here");
    const v = AP.validateAssessmentPresentation(record, payload);
    expect(v.ok).toBe(false);
    expect(v.failures.join("\n")).toMatch(/q1 answer cue: LENGTH_CUE/);
  });

  test("a canonical-language presentation reports cues as warnings (its wording is the canonical revision's)", () => {
    const payload = JSON.parse(JSON.stringify(F.canonicalPayload()));
    const c = payload.items[0];
    c.options.find((o) => o.optionId === c.correctOptionId).text = "A canonical correct option that is far longer than the others";
    const record = F.canonicalThreeChoice(payload);
    const v = AP.validateAssessmentPresentation(record, payload);
    expect(v.ok).toBe(true);
    expect(v.warnings.join("\n")).toMatch(/q1 answer cue: LENGTH_CUE/);
    const adapted = F.adaptedThreeChoice(payload);
    adapted.items[0].displayedOptions.find((o) => o.optionId === c.correctOptionId).text = c.options.find((o) => o.optionId === c.correctOptionId).text;
    expect(AP.validateAssessmentPresentation(adapted, payload).ok).toBe(false);
  });

  test("LONGEST_ANSWER_BIAS warns when the correct choice is uniquely longest on more than ceil(n/k) items", () => {
    const payload = F.canonicalPayload();
    let record = F.adaptedThreeChoice(payload);
    for (let i = 0; i < 5; i += 1) record = withCorrectText(record, payload, i, `Simple X for ${i + 1}!!`);
    const f = AP.answerCueFindings(record, payload);
    expect(f.longestCount).toBe(5);
    expect(codes(f.assessment)).toEqual(["LONGEST_ANSWER_BIAS"]);
    expect(AP.validateAssessmentPresentation(record, payload).warnings.join("\n")).toMatch(/LONGEST_ANSWER_BIAS/);
  });

  test("the existing adapted fixture carries no cue", () => {
    const payload = F.canonicalPayload();
    const v = AP.validateAssessmentPresentation(F.adaptedThreeChoice(payload), payload);
    expect(v.ok).toBe(true);
    expect(v.warnings.filter((w) => /answer cue/.test(w))).toEqual([]);
  });
});

describe("identical-to-canonical text", () => {
  test("lists exact, normalized, and canonical-fallback strings under adapted language only", () => {
    const payload = F.canonicalPayload();
    const record = F.adaptedThreeChoice(payload);
    record.items[0].stem = payload.items[0].stem;
    record.items[1].stem = payload.items[1].stem.toUpperCase();
    record.items[2].feedback = null;
    const found = AP.identicalTextFindings(record, payload, { directions: F.CANONICAL_DIRECTIONS, showYourThinking: null });
    expect(found).toEqual(
      expect.arrayContaining([
        { field: "q1.stem", kind: "identical", text: payload.items[0].stem },
        expect.objectContaining({ field: "q2.stem", kind: "identicalAfterNormalization" }),
        { field: "q3.feedback", kind: "canonicalUsed", text: payload.items[2].explanation },
      ]),
    );
    expect(AP.identicalTextFindings(F.canonicalThreeChoice(payload), payload, {})).toEqual([]);
  });
});

describe("required-term equivalence (both prompts)", () => {
  const adapted = { prompt: "Tell how convection works.", modelAnswer: "convection moves plates", requiredTerms: ["convection"] };
  test("fails when the term is missing from either prompt", () => {
    expect(AP.requiredTermEquivalence(adapted, { prompt: "Explain convection.", modelAnswer: "" }).ok).toBe(true);
    expect(AP.requiredTermEquivalence(adapted, { prompt: "Explain the mantle.", modelAnswer: "" }).failures).toEqual([
      'required term "convection" is not in the canonical Show Your Thinking prompt',
    ]);
    expect(AP.requiredTermEquivalence({ ...adapted, prompt: "Tell how it works." }, { prompt: "Explain convection." }).failures).toEqual([
      'required term "convection" is not in the adapted Show Your Thinking prompt',
    ]);
    expect(AP.requiredTermEquivalence(adapted, null).ok).toBe(false);
  });

  test("the renderer refuses a presentation whose required term is absent from the lesson's canonical prompt", () => {
    const record = F.adaptedThreeChoice();
    const html = F.lessonHtml().replace("drives <strong>convection</strong> in the mantle", "drives the mantle");
    expect(() =>
      R.renderAssessmentPresentation(html, {
        record,
        assessmentPresentationRevisionId: AP.assessmentPresentationRevisionIdFor(record),
        canonicalPayload: F.canonicalPayload(),
      }),
    ).toThrow('required term "convection" is not in the canonical Show Your Thinking prompt');
  });

  test("readShowYourThinking and readQuizDirections return plain canonical text", () => {
    const syt = R.readShowYourThinking(F.lessonHtml());
    expect(syt.prompt).toBe("Explain how heat from the core drives convection in the mantle.");
    expect(syt.modelAnswer).toBe(F.CANONICAL_MODEL);
    expect(R.readShowYourThinking(F.lessonHtml({ thinkBox: false }))).toBeNull();
    expect(R.readQuizDirections(F.lessonHtml())).toBe(F.CANONICAL_DIRECTIONS);
  });
});

describe("authoring notes and review readiness", () => {
  const payload = F.canonicalPayload();
  const canonicalLesson = { directions: F.CANONICAL_DIRECTIONS, showYourThinking: R.readShowYourThinking(F.lessonHtml()) };
  function notesFor(record) {
    return {
      schemaVersion: 1,
      kind: REV.NOTES_KIND,
      lessonSlug: record.lessonSlug,
      assessmentRevisionId: record.assessmentRevisionId,
      items: record.items.map((it, i) => {
        const correct = payload.items[i].correctOptionId;
        const dm = {};
        for (const o of it.displayedOptions) if (o.optionId !== correct) dm[o.optionId] = `misconception ${o.optionId}`;
        return { itemId: it.itemId, correctMeaning: "same meaning", distractorMisconceptions: dm };
      }),
      showYourThinking: { evidenceComparison: "same evidence", causalChain: [{ step: "Convection", terms: ["convection"] }] },
      unchanged: {},
    };
  }
  const run = (record, notes) => REV.analyze({ record, canonicalPayload: payload, canonicalLesson, notes });

  test("a complete fixture draft with notes is ready; without notes it is not", () => {
    const record = F.adaptedThreeChoice(payload);
    expect(run(record, notesFor(record)).ok).toBe(true);
    const bare = run(record, null);
    expect(bare.ok).toBe(false);
    expect(bare.hardFailures.join("\n")).toMatch(/no authoring notes file/);
  });

  test("notes must name exactly the displayed distractors", () => {
    const record = F.adaptedThreeChoice(payload);
    const notes = notesFor(record);
    const omitted = record.items[0].omittedOptions[0].optionId;
    notes.items[0].distractorMisconceptions[omitted] = "not displayed";
    expect(run(record, notes).hardFailures.join("\n")).toMatch(/q1.distractorMisconceptions must name exactly the displayed distractors/);
  });

  test("an unchanged-text reason for a string that is not identical is stale", () => {
    const record = F.adaptedThreeChoice(payload);
    const notes = notesFor(record);
    notes.unchanged = { "q1.stem": "kept" };
    expect(run(record, notes).hardFailures.join("\n")).toMatch(/unchanged.q1.stem is stale/);
    record.items[0].stem = payload.items[0].stem;
    const ok = run(record, notes);
    expect(ok.ok).toBe(true);
    expect(ok.identical.find((f) => f.field === "q1.stem").reason).toBe("kept");
  });

  test("the display-position target (spread <= 1, no run, no cycle) is required", () => {
    const record = F.adaptedThreeChoice(payload);
    // Move q10's correct choice from position C to A: counts A4 B3 C3 still pass; move q3 too -> A5 spread 2 warning.
    for (const i of [2, 9]) {
      const it = record.items[i];
      const correct = payload.items[i].correctOptionId;
      const c = it.displayedOptions.find((o) => o.optionId === correct);
      it.displayedOptions = [c, ...it.displayedOptions.filter((o) => o !== c)];
    }
    const a = run(record, notesFor(record));
    expect(a.distribution.targetMet).toBe(false);
    expect(a.ok).toBe(false);
  });

  test("an em dash in any authored string fails", () => {
    const record = F.adaptedThreeChoice(payload);
    record.items[0].feedback = "Simple \u2014 feedback.";
    expect(run(record, notesFor(record)).hardFailures.join("\n")).toMatch(/record.items\[0\].feedback contains an em dash/);
  });

  test("the packet names the exact id, the correct option, the omitted option, and says it is uncertified", () => {
    const record = F.adaptedThreeChoice(payload);
    const packet = REV.renderPacket(run(record, notesFor(record)));
    expect(packet).toContain(AP.assessmentPresentationRevisionIdFor(record));
    expect(packet).toContain("UNCERTIFIED DRAFT");
    expect(packet).toContain("**CORRECT**");
    expect(packet).toContain("omitted distractor");
    expect(packet).toContain("must never be placed in Hosting output");
  });
});

describe("uncertified preview cannot enter retention", () => {
  test("generateVariantArtifact refuses bytes carrying the preview marker", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-preview-"));
    try {
      expect(() =>
        generateVariantArtifact({
          lessonSlug: "earths-layers",
          variantKey: "reading-adapted",
          bytes: `<html><head><!-- ${UNCERTIFIED_PREVIEW_MARKER} x --></head></html>`,
          publishedAt: "2026-09-28T00:00:00.000Z",
          repoRoot: root,
        }),
      ).toThrow("uncertified assessment-presentation preview");
      expect(fs.readdirSync(root)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("the CLI only writes to the gitignored scratch directory or outside the repository", () => {
    expect(cli.resolveOutDir(null)).toBe(cli.DEFAULT_OUT_DIR);
    expect(() => cli.resolveOutDir("app/lessons/variants")).toThrow("gitignored scratch");
    expect(() => cli.resolveOutDir("platform/functions/src/scripts/assessment-presentations")).toThrow("gitignored scratch");
    expect(() => cli.resolveOutDir("lesson-sources/variants/reviews")).toThrow("gitignored scratch");
    expect(cli.resolveOutDir(os.tmpdir())).toBe(os.tmpdir());
    expect(path.relative(paths.REPO_ROOT, cli.DEFAULT_OUT_DIR)).toBe(path.join("app", "dist", "assessment-preview"));
  });
});

// Since the Earth's Layers r2 authoring pass the draft at the fixed path is
// the r2 presentation, owner-certified as ap515838... (ruling R2-D2) and
// retained. The certified r1 presentation ap1fed... lives on as its retained
// record (byte-equal to the earlier r1 draft) and review record; the earlier
// r1 authoring notes are working material recoverable from Git (addendum
// 21.12).
describe("the Earth's Layers draft (real content, read only)", () => {
  const DRAFT = path.join(paths.REPO_ROOT, "lesson-sources", "variants", "earths-layers.reading-adapted.assessment.json");
  const AP1FED = "ap1fed478c9e4ad8335946ff7f7b165df657bafc48e8c5990d922419581fa02c25";
  const R1 = "assessment_earths-layers__r1";
  const R2 = "assessment_earths-layers__r2";
  const a = REV.analyzeDraft(DRAFT);
  const payload = a.canonicalPayload;
  const ap1fed = JSON.parse(fs.readFileSync(path.join(paths.REPO_ROOT, "platform", "functions", "src", "scripts", "assessment-presentations", `${AP1FED}.json`), "utf8"));

  test("passes every automated check with notes", () => {
    expect(a.hardFailures).toEqual([]);
    expect(a.warnings).toEqual([]);
    expect(a.ok).toBe(true);
    expect(a.record.assessmentRevisionId).toBe(R2);
    expect(a.record.traits).toEqual({ language: "adapted", choiceCount: 3 });
  });

  test("is exactly the owner-certified, retained ap515838...", () => {
    expect(a.assessmentPresentationRevisionId).toBe("ap51583824375c58be36627f047f280510b0cde98e9aba2fbec7ef058ad2fc4903");
    const retained = fs.readFileSync(path.join(AP.retainedRecordDir(), `${a.assessmentPresentationRevisionId}.json`), "utf8");
    expect(retained).toBe(a.canonicalBytes);
    const review = AP.loadReview(a.assessmentPresentationRevisionId);
    expect(review).toMatchObject({ determination: "approved", reviewer: { role: "owner", reviewerId: "lyfelabz-owner" } });
    expect(AP.validateReview(review, a.record, a.assessmentPresentationRevisionId)).toMatchObject({ ok: true, approved: true });
  });

  test("is a new presentation, distinct from the certified r1 ap1fed..., which stays retained and unchanged", () => {
    expect(a.assessmentPresentationRevisionId).not.toBe(AP1FED);
    expect(AP.assessmentPresentationRevisionIdFor(ap1fed)).toBe(AP1FED);
    expect(ap1fed.assessmentRevisionId).toBe(R1);
  });

  test("the r2 presentation cannot map onto r1, and the r1 presentation cannot map onto r2", () => {
    const r1Payload = AP.loadCanonicalPayload(R1);
    const r2Payload = AP.loadCanonicalPayload(R2);
    expect(AP.validateAssessmentPresentation(a.record, r1Payload).failures.length).toBeGreaterThan(0);
    expect(AP.validateAssessmentPresentation(ap1fed, r2Payload).failures.length).toBeGreaterThan(0);
    expect(AP.validateAssessmentPresentation(ap1fed, r1Payload).failures).toEqual([]);
  });

  test("keeps the canonical correct option and omits exactly one distractor on every item", () => {
    for (const [i, item] of a.record.items.entries()) {
      const c = payload.items[i];
      expect(item.itemId).toBe(c.itemId);
      expect(item.displayedOptions).toHaveLength(3);
      expect(item.displayedOptions.map((o) => o.optionId)).toContain(c.correctOptionId);
      expect(item.omittedOptions).toHaveLength(1);
      expect(item.omittedOptions[0].optionId).not.toBe(c.correctOptionId);
    }
  });

  test("meets the 3/3/4 display-position target with no run of 3 and no cycle", () => {
    expect([...a.distribution.counts].sort()).toEqual([3, 3, 4]);
    expect(a.distribution.hard).toEqual([]);
    expect(a.distribution.warnings).toEqual([]);
  });

  test("the required term is in both the canonical and the adapted prompt", () => {
    expect(a.requiredTerms.terms).toEqual([
      { term: "convection", canonicalPrompt: true, adaptedPrompt: true, canonicalModelAnswer: true, adaptedModelAnswer: true },
    ]);
  });

  test("the certified r2 presentation previews deterministically without leaking review content, and its unmarked bytes are exactly retained pr8996...", () => {
    const p1 = variantSource.buildUncertifiedAssessmentPreview({ slug: "earths-layers", variantKey: "reading-adapted", record: a.record });
    const p2 = variantSource.buildUncertifiedAssessmentPreview({ slug: "earths-layers", variantKey: "reading-adapted", record: a.record });
    expect(p1.html).toBe(p2.html);
    expect(p1.assessmentPresentationRevisionId).toBe(a.assessmentPresentationRevisionId);
    expect(p1.projectedPresentationRevisionId).toBe("pr8996a455b762c209c8a74c20954521cd93313df920923292aa334161560f6e11");
    expect(p1.html).toContain(UNCERTIFIED_PREVIEW_MARKER);
    expect(R.readBindingBlock(p1.html)).toMatchObject({ lessonSlug: "earths-layers", assessmentRevisionId: R2, assessmentPresentationRevisionId: a.assessmentPresentationRevisionId });
    expect(R.readBindingBlock(p1.html).items.map((it) => it.optionIds.length)).toEqual(new Array(10).fill(3));
    for (const it of a.record.items) expect(p1.html).not.toContain(R.escapeHtml(it.omittedOptions[0].rationale));
    expect(p1.html).not.toMatch(/reading-adapted|REVIEW-ONLY|distractorMisconceptions/);
  });

  test("the retained r1 presentation cannot be re-rendered from the authored variant source, which now carries the r2 quiz", () => {
    // pr90f... stays retained and immutable; its bytes are hash-pinned and the
    // r1 binding is proven from the r1 variant source (assessmentRenditions.test.js).
    expect(() => variantSource.buildUncertifiedAssessmentPreview({ slug: "earths-layers", variantKey: "reading-adapted", record: ap1fed })).toThrow(
      /script blocks are not byte-identical to the canonical lesson|variant quiz is not exactly assessment_earths-layers__r1/,
    );
  });

});
