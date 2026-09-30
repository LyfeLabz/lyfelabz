/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * Conducting Experiments `reading-adapted`: owner-certified content.
 *
 * Content contract: docs/platform/DIFFERENTIATION_CONTENT_PRESERVATION_CONDUCTING_EXPERIMENTS.md.
 *
 * PROPOSED_VARIANT is the block the owner reviewed before it was declared in
 * lessons/conducting-experiments.cjs; the declared block must stay equal to
 * it (plus the certified assessmentPresentationRevisionId). The gates below
 * run on the instruction-only build, as they did during review; the retained,
 * bound artifact is pinned at the end.
 *
 * Pins:
 *   - the variant source passes invariance, the zero-exclusion equivalence
 *     contract, quiz identity and r1 fidelity, and builds deterministically;
 *   - scripts are byte-identical and locked definition text is verbatim;
 *   - the draft assessment presentation passes every review gate with no
 *     warning;
 *   - every measurement the adapted Show Your Thinking model cites is in the
 *     locked canonical supplied evidence (ce-data), attributed to the right
 *     soda;
 *   - the structured Claim / Evidence / Reasoning model renders into the
 *     uncertified preview while ce-data stays byte-identical;
 *   - the retained artifact pr4bd0e1... is the certified ap1acc72... binding
 *     and reproduces byte for byte.
 *
 * Nothing here writes to the repository.
 */

const fs = require("fs");
const path = require("path");

const configMod = require("../config.cjs");
const variantSource = require("../variantSource.cjs");
const AP = require("../assessmentPresentation.cjs");
const review = require("../assessmentPresentationReview.cjs");
const builder = require("../index.cjs");
const paths = require("../paths.cjs");

const SLUG = "conducting-experiments";
const KEY = "reading-adapted";
const R1 = "assessment_conducting-experiments__r1";
const AP1ACC = "ap1acc72282dd0e33764f19ea8a46d23325ebd0721723249758e9a67d6f175712c";
const PR4BD0 = "pr4bd0e1dbe22e7b6db874dd16f4ff7313b19ed1b470acfae3dabbfdc96b350001";
const PRAFF2 = "praff2896f58d621b82569d21f97b56fe43955f82e34867a4ae15c2afc3a681e69";
const DRAFT = path.join(paths.REPO_ROOT, "lesson-sources/variants/conducting-experiments.reading-adapted.assessment.json");

const PROPOSED_VARIANT = {
  source: "lesson-sources/variants/conducting-experiments.reading-adapted.html",
  adaptableSections: ["hook", "hypothesis", "variables", "observations", "inference", "summary"],
  adaptableSelectors: [
    "p", "span", ".hook-card-observation", ".question-pause-text", ".process-body",
    ".bridge-callout", ".wrapup-beat-answer", ".wrapup-beat-body",
  ],
  lockedSelectors: [
    ".edu-note", ".teal-it", ".predict-hint", ".predict-buttons", ".hypo-card", ".sorter-card",
    ".summary-table-wrap", ".wrapup-behavior-chips", ".section-label", ".hook-card-icon",
    ".observe-icon", ".question-pause-icon", ".process-icon", ".process-mini",
  ],
  assessmentRevisionId: R1,
};

function proposedConfig() {
  const cfg = configMod.loadConfig(SLUG);
  return { ...cfg, variants: { [KEY]: PROPOSED_VARIANT } };
}

function textOf(fragment) {
  return fragment.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
}

function between(html, start, end) {
  const a = html.indexOf(start);
  expect(a).toBeGreaterThan(-1);
  const b = html.indexOf(end, a);
  expect(b).toBeGreaterThan(a);
  return html.slice(a, b);
}

function sectionText(html, id) {
  return textOf(between(html, `<section id="${id}"`, "</section>"));
}

const scripts = (html) => html.match(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi) || [];

// Supplied results, read from the canonical ce-data table: soda -> trial heights.
function suppliedRows(html) {
  const data = between(html, '<div class="ce-data" id="ce-data">', '<p class="ce-think-prompt">');
  const rows = [...data.matchAll(/<tr><td class="term">([^<]+)<\/td><td class="num">([^<]+)<\/td>/g)];
  return rows.map((m) => ({ soda: m[1].toLowerCase(), heights: m[2].match(/\d+/g) }));
}

// Every "N, N, and N cm" or "N cm" group in a model answer, attributed to the
// nearest soda named before it in the same sentence (null when none is).
function citedMeasurements(modelText, sodas) {
  const out = [];
  for (const sentence of modelText.split(/(?<=[.!?])\s+/)) {
    for (const m of sentence.matchAll(/((?:\d+,\s*)*\d+(?:,?\s*and\s+\d+)?)\s*cm\b/g)) {
      const before = sentence.slice(0, m.index).toLowerCase();
      const nearest = sodas
        .map((soda) => ({ soda, at: before.lastIndexOf(soda) }))
        .filter((x) => x.at !== -1)
        .sort((a, b) => b.at - a.at)[0];
      out.push({ sentence, numbers: m[1].match(/\d+/g), soda: nearest ? nearest.soda : null });
    }
  }
  return out;
}

let canonicalV2;
let built;
let analysis;
let preview;

beforeAll(() => {
  canonicalV2 = builder.buildLesson({ slug: SLUG, target: "v2", write: false }).bytes;
  built = variantSource.buildAuthoredVariant({ slug: SLUG, variantKey: KEY, cfg: proposedConfig() });
  analysis = review.analyzeDraft(DRAFT);
  preview = variantSource.buildUncertifiedAssessmentPreview({ slug: SLUG, variantKey: KEY, record: analysis.record, cfg: proposedConfig() });
});

describe("proposed variant configuration", () => {
  test("validates, and the declared lesson config is the reviewed block bound to the certified presentation", () => {
    expect(() => configMod.validateConfigShape(proposedConfig(), SLUG)).not.toThrow();
    const declared = configMod.loadConfig(SLUG).variants[KEY];
    const { assessmentPresentationRevisionId: apId, ...rest } = declared;
    expect(rest).toEqual(PROPOSED_VARIANT);
    expect(apId).toBe(AP1ACC);
  });
});

describe("variant source passes every F5.2 gate against canonical r1", () => {
  test("invariance, equivalence, quiz identity and fidelity, determinism", () => {
    // buildAuthoredVariant throws on any gate failure.
    expect(built.presentationRevisionId).toBe(PRAFF2);
    expect(built.assessmentRevisions).toEqual(["conducting-experiments.r1.json"]);
    expect(built.assessmentRevisionBasis).toBe("declared");
    expect(built.recordedAssessmentRevisionId).toBe(R1);
    expect(built.review.adaptableRuns).toBe(39);
    const again = variantSource.buildAuthoredVariant({ slug: SLUG, variantKey: KEY, cfg: proposedConfig() });
    expect(again.bytes).toBe(built.bytes);
  });

  test("every script block is byte-identical to the canonical v2 lesson", () => {
    // The canonical build alone inserts the inert revision declaration; variant
    // bytes never carry it (Slice 9B, S9-D7). Every other block must match.
    const canon = scripts(canonicalV2).filter((b) => !b.includes('id="lyfelabz-assessment-revision"'));
    expect(scripts(canonicalV2).length - canon.length).toBe(1);
    expect(canon.length).toBeGreaterThan(10);
    expect(scripts(built.bytes)).toEqual(canon);
  });

  test("adapted prose is shorter per sentence than the canonical prose", () => {
    const { canonicalProse: c, variantProse: v } = built.review;
    expect(v.averageSentenceWords).toBeLessThan(c.averageSentenceWords);
    expect(v.sentencesOver20Words).toBeLessThan(c.sentencesOver20Words);
  });

  test("locked definition text and canonical examples stay verbatim", () => {
    const variant = textOf(built.bytes);
    for (const exact of [
      // KEY IDEA definition sentences (canonical vocabulary definitions).
      "A hypothesis is an educated guess that explains an observation based on your prior knowledge. A good hypothesis is testable and explains the cause-and-effect relationship between variables.",
      "An inference is an interpretation you make based on your observations .",
      "A prediction is what you think will happen before testing. Observations and measurements are what actually happened. Evidence is the observations and measurements you use to support a claim. An inference explains what observations mean. A conclusion is the answer the evidence supports once the results are in.",
      // Variable definitions in the process cards.
      "The factor in the experiment that you manipulate or change .",
      "The factor in the experiment that responds to the change .",
      "The other factors kept constant to ensure any change measured was due to the independent variable.",
      // Observation definitions and canonical example quotes.
      "Quantitative observations involve precise measurements and numerical quantities.",
      "Qualitative observations involve using sensory information to describe something's qualities.",
      '"The eruption reached 2.3 meters."',
      '"The foam was white and smelled sweet."',
      '"Plants given more sunlight will grow taller.',
      '"Plants are happier in the sun.',
      "Scientific inquiry always starts with a question.",
      "How do scientists turn a curious question into an answer they can trust?",
    ]) {
      expect(variant).toContain(exact);
    }
  });

  test("the reviewed idioms are gone from the adaptable sections", () => {
    const adapted = ["hook", "hypothesis", "variables", "observations", "inference", "summary"].map((id) => sectionText(built.bytes, id)).join(" ");
    for (const idiom of [/two flavors/i, /geyser/i, /brain filled/i, /lock everything else/i, /pop into your head/i, /why bother/i]) {
      expect(adapted).not.toMatch(idiom);
    }
  });

  test("required Grade 6 vocabulary is still used in the adapted sections", () => {
    const adapted = ["hook", "hypothesis", "variables", "observations", "inference", "summary"].map((id) => sectionText(built.bytes, id)).join(" ").toLowerCase();
    for (const term of [
      "hypothesis", "testable", "cause-and-effect", "independent variable", "dependent variable", "control variables",
      "fair test", "quantitative", "qualitative", "inference", "prediction", "evidence", "conclusion",
    ]) {
      expect(adapted).toContain(term);
    }
  });
});

describe("draft assessment presentation (uncertified)", () => {
  test("passes every review gate with no warning", () => {
    expect(analysis.hardFailures).toEqual([]);
    expect(analysis.warnings).toEqual([]);
    expect(analysis.record.assessmentRevisionId).toBe(R1);
    expect(analysis.record.traits).toEqual({ language: "adapted", choiceCount: 3 });
    expect(analysis.distribution.targetMet).toBe(true);
  });

  test("each item shows 3 canonical options including the correct one; the fourth is omitted with a rationale", () => {
    const payload = AP.loadCanonicalPayload(R1);
    expect(analysis.record.items.map((it) => it.itemId)).toEqual(payload.items.map((it) => it.itemId));
    for (const it of analysis.record.items) {
      const canon = payload.items.find((c) => c.itemId === it.itemId);
      const shown = it.displayedOptions.map((o) => o.optionId);
      expect(shown).toHaveLength(3);
      expect(shown).toContain(canon.correctOptionId);
      expect(it.omittedOptions).toHaveLength(1);
      expect([...shown, it.omittedOptions[0].optionId].sort()).toEqual(canon.options.map((o) => o.optionId).sort());
    }
  });

  test("the diagnostic distractors survive: IV/DV swaps in q2 and q6, observation/inference reversal in q5", () => {
    const shown = (q) => analysis.record.items.find((it) => it.itemId === q).displayedOptions.map((o) => o.optionId);
    expect(shown("q2")).toEqual(expect.arrayContaining(["C", "A"]));
    expect(shown("q6")).toEqual(expect.arrayContaining(["A", "B"]));
    expect(shown("q5")).toEqual(expect.arrayContaining(["B", "A"]));
    // q1 keeps the two nature-of-a-hypothesis lures (wild guess, proven fact).
    expect(shown("q1")).toEqual(["A", "B", "C"]);
    // q10's canonical near-duplicate independent-variable lures are reduced to one.
    expect(shown("q10")).toEqual(expect.arrayContaining(["A"]));
    expect(shown("q10")).not.toContain("D");
  });

  test("the correct choice is uniquely longest on at most one item", () => {
    expect(analysis.cues.longestCount).toBeLessThanOrEqual(1);
    expect(analysis.cues.canonicalLongestCount).toBe(8);
  });

  test("Show Your Thinking keeps claim, evidence, reasoning and the four-paragraph structure", () => {
    const syt = analysis.record.showYourThinking;
    expect(syt.requiredTerms).toEqual(["claim", "evidence", "reasoning"]);
    expect(analysis.requiredTerms.ok).toBe(true);
    expect(syt.modelAnswer.paragraphs.map((p) => p.lead)).toEqual(["Claim:", "Evidence:", "Reasoning:", null]);
  });
});

describe("supplied evidence stays canonical, and the adapted model cites only it", () => {
  const SODAS = ["diet cola", "regular cola", "flat cola"];

  test("every number in the adapted model is a supplied trial height", () => {
    const rows = suppliedRows(canonicalV2);
    expect(rows.map((r) => r.soda)).toEqual(SODAS);
    const supplied = new Set(rows.flatMap((r) => r.heights));
    const model = AP.modelAnswerText(analysis.record.showYourThinking.modelAnswer);
    const numbers = model.match(/\d+(?:\.\d+)?/g) || [];
    expect(numbers.length).toBeGreaterThan(0);
    for (const n of numbers) expect(supplied.has(n)).toBe(true);
  });

  test.each([
    ["adapted", () => AP.modelAnswerText(analysis.record.showYourThinking.modelAnswer)],
    ["canonical", () => analysis.canonicalLesson.showYourThinking.modelAnswer],
  ])("each cited measurement group is the named soda's supplied trials (%s model)", (_label, modelOf) => {
    const rows = suppliedRows(canonicalV2);
    const cited = citedMeasurements(modelOf(), SODAS);
    expect(cited.length).toBeGreaterThanOrEqual(3);
    for (const c of cited) {
      expect(c.soda).not.toBeNull();
      const row = rows.find((r) => r.soda === c.soda);
      for (const n of c.numbers) expect(row.heights).toContain(n);
    }
    // Every soda's results are cited.
    expect(new Set(cited.map((c) => c.soda))).toEqual(new Set(SODAS));
  });

  test("the preview carries the canonical ce-data block byte for byte", () => {
    const block = (html) => between(html, '<div class="ce-data" id="ce-data">', '<p class="ce-think-prompt">');
    expect(block(preview.html)).toBe(block(canonicalV2));
    expect(block(built.bytes)).toBe(block(canonicalV2));
  });
});

describe("uncertified preview", () => {
  test("renders the structured model as four paragraphs with bold leads", () => {
    const model = between(preview.html, '<div class="ce-think-model" id="ce-think-model">', "</div>");
    const paras = model.match(/<p>[\s\S]*?<\/p>/g);
    expect(paras).toHaveLength(4);
    expect(paras[0]).toMatch(/^<p><strong>Claim:<\/strong> /);
    expect(paras[1]).toMatch(/^<p><strong>Evidence:<\/strong> /);
    expect(paras[2]).toMatch(/^<p><strong>Reasoning:<\/strong> /);
    expect(paras[3]).not.toContain("<strong>");
    // The labels render exactly as the canonical model's labels do.
    const canonicalModel = between(canonicalV2, '<div class="ce-think-model" id="ce-think-model">', "</div>");
    for (const lead of ["Claim:", "Evidence:", "Reasoning:"]) {
      expect(canonicalModel).toContain(`<p><strong>${lead}</strong> `);
      expect(model).toContain(`<p><strong>${lead}</strong> `);
    }
    expect(model).toContain('<span class="tm-label">One strong way to say it</span>');
  });

  test("renders the adapted prompt with each required term emphasized once", () => {
    const prompt = between(preview.html, '<p class="ce-think-prompt">', "</p>");
    for (const term of ["Claim", "Evidence", "Reasoning"]) expect(prompt).toContain(`<strong>${term}</strong>`);
    expect(textOf(prompt)).toContain("Use only the supplied results above.");
  });

  test("is marked uncertified, bound to the draft, deterministic, and shows three choices per question", () => {
    expect(preview.html).toContain("UNCERTIFIED PREVIEW");
    expect(preview.assessmentPresentationRevisionId).toBe(analysis.assessmentPresentationRevisionId);
    const again = variantSource.buildUncertifiedAssessmentPreview({ slug: SLUG, variantKey: KEY, record: analysis.record, cfg: proposedConfig() });
    expect(again.html).toBe(preview.html);
    expect(preview.binding.items).toHaveLength(10);
    for (const it of preview.binding.items) expect(it.optionIds).toHaveLength(3);
  });
});

describe("certified and retained", () => {
  const { sha256Hex } = require("../hash.cjs");
  const manifestMod = require("../variantManifest.cjs");
  const RETAINED = `app/lessons/variants/lesson_${SLUG}__${PR4BD0}.html`;

  test("the draft is exactly the retained, owner-certified record", () => {
    expect(analysis.assessmentPresentationRevisionId).toBe(AP1ACC);
    const retained = fs.readFileSync(path.join(paths.REPO_ROOT, `platform/functions/src/scripts/assessment-presentations/${AP1ACC}.json`), "utf8");
    expect(retained).toBe(analysis.canonicalBytes);
    const checked = AP.checkCertifiedPresentation(AP1ACC, { lessonSlug: SLUG, assessmentRevisionId: R1 });
    expect(checked.failures).toEqual([]);
    expect(AP.loadReview(AP1ACC)).toMatchObject({ reviewer: { role: "owner" }, determination: "approved" });
  });

  test("the declared variant builds to the retained pr4bd0e1... artifact, byte for byte", () => {
    const bound = variantSource.buildAuthoredVariant({ slug: SLUG, variantKey: KEY });
    expect(bound.presentationRevisionId).toBe(PR4BD0);
    expect(bound.assessmentBinding).toEqual({ assessmentRevisionId: R1, assessmentPresentationRevisionId: AP1ACC });
    const bytes = fs.readFileSync(path.join(paths.REPO_ROOT, RETAINED), "utf8");
    expect(bound.bytes).toBe(bytes);
    expect(`pr${sha256Hex(bytes)}`).toBe(PR4BD0);
    // The retained bytes are the approved preview without its review marking.
    expect(preview.projectedPresentationRevisionId).toBe(PR4BD0);
    expect(bytes).not.toContain("UNCERTIFIED");
  });

  test("the manifest records the binding, and variants:verify sees it as retained", () => {
    const entry = manifestMod.readManifest().find((e) => e.lessonSlug === SLUG);
    expect(entry).toMatchObject({ variantKey: KEY, presentationRevisionId: PR4BD0, path: RETAINED, assessmentRevisionId: R1, assessmentPresentationRevisionId: AP1ACC });
    const res = variantSource.checkAuthoredVariants();
    expect(res.failures).toEqual([]);
    expect(res.checked).toContainEqual({ label: `${SLUG}/${KEY}`, presentationRevisionId: PR4BD0, retained: true });
  });

  test("the delivered artifact carries the canonical ce-data block and three choices per item", () => {
    const bytes = fs.readFileSync(path.join(paths.REPO_ROOT, RETAINED), "utf8");
    const block = (html) => between(html, '<div class="ce-data" id="ce-data">', '<p class="ce-think-prompt">');
    expect(block(bytes)).toBe(block(canonicalV2));
    const binding = JSON.parse(between(bytes, '<script type="application/json" id="lyfelabz-assessment-presentation">', "</script>").split(">").slice(1).join(">"));
    expect(binding.assessmentPresentationRevisionId).toBe(AP1ACC);
    for (const it of binding.items) expect(it.optionIds).toHaveLength(3);
  });
});
