/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * F5.3 addendum section 9.1 - the Show Your Thinking semantic locator and the
 * structured paragraph model-answer form.
 *
 * Pins:
 *   - one locator (quiz-prefix id convention, box-scoped, fail closed) for
 *     every real lesson, unprefixed and prefixed class families alike;
 *   - Earth's Layers string-path non-regression: retained records keep their
 *     ids, the rebuild-verified artifact reproduces byte for byte, and both
 *     bound retained artifacts' Show Your Thinking bytes reproduce from their
 *     records;
 *   - Biological Evolution (prefixed, inline) and Conducting Experiments
 *     (prefixed, paragraph model, supplied evidence, a second same-family
 *     textarea) render end to end, in memory, with synthetic wording only;
 *   - kind matching, malformed markup, record validation, escaping,
 *     determinism, identity, and plain-text flattening.
 *
 * Nothing here writes to the repository. No Conducting Experiments or
 * Biological Evolution presentation is authored: the records below are
 * synthetic test inputs that never leave memory.
 */

const fs = require("fs");
const path = require("path");

const AP = require("../assessmentPresentation.cjs");
const R = require("../assessmentPresentationRender.cjs");
const REV = require("../assessmentPresentationReview.cjs");
const variantSource = require("../variantSource.cjs");
const F = require("./fixtures/assessmentPresentationFixtures");

const REPO = path.resolve(__dirname, "..", "..", "..", "..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const at = (html, range) => html.slice(range.start, range.end);

// The document with the three rewritable ranges replaced by one marker each:
// equal masks prove every other byte is unchanged.
function mask(html, located) {
  let out = html;
  for (const r of [located.prompt, located.ariaLabel, located.model].sort((a, b) => b.start - a.start)) {
    out = `${out.slice(0, r.start)}\u0000${out.slice(r.end)}`;
  }
  return out;
}

function lessonFiles(dir) {
  return fs.readdirSync(path.join(REPO, dir)).filter((f) => /^lesson_.+\.html$/.test(f)).sort().map((f) => path.join(dir, f));
}
const slugOf = (rel) => path.basename(rel).slice("lesson_".length, -".html".length);

const PREFIXED = ["biological-evolution", "conducting-experiments"];
const PARAGRAPH_MODEL = ["conducting-experiments"];

const SYNTHETIC_INLINE = {
  prompt: 'Synthetic <prompt> & "text" for the locator.',
  modelAnswer: 'Synthetic <model> & "text" for the locator.',
  requiredTerms: [],
};
const SYNTHETIC_PARAGRAPHS = {
  prompt: SYNTHETIC_INLINE.prompt,
  modelAnswer: {
    paragraphs: [
      { lead: "First:", text: "Synthetic <first> paragraph." },
      { lead: null, text: 'Synthetic "second" & last paragraph.' },
    ],
  },
  requiredTerms: [],
};

describe("locator: every real lesson source and v2 page", () => {
  const files = [...lessonFiles("lesson-sources"), ...lessonFiles("app/lessons")];

  test("covers all 49 lesson sources and all 49 v2 lessons", () => {
    expect(lessonFiles("lesson-sources")).toHaveLength(49);
    expect(lessonFiles("app/lessons")).toHaveLength(49);
  });

  test.each(files)("%s has exactly one Show Your Thinking component on its quiz prefix", (rel) => {
    const slug = slugOf(rel);
    const html = read(rel);
    const located = R.locateShowYourThinking(html);
    expect(located).not.toBeNull();
    const literals = html.match(new RegExp(`(?:var|let|const)\\s+${located.prefix}QuizQuestions\\s*=`, "g")) || [];
    expect(literals).toHaveLength(1);
    expect(html).toContain(`id="${located.prefix}-quiz-questions"`);
    expect(located.family).toBe(PREFIXED.includes(slug) ? `${located.prefix}-` : "");
    expect(located.model.kind).toBe(PARAGRAPH_MODEL.includes(slug) ? "paragraphs" : "inline");
    expect(located.text.prompt.length).toBeGreaterThan(0);
    expect(located.text.modelAnswer.length).toBeGreaterThan(0);
    expect(located.text.ariaLabel.length).toBeGreaterThan(0);
  });

  test.each(lessonFiles("app/lessons"))("%s re-reads a synthetic adapted block and keeps every other byte", (rel) => {
    const html = read(rel);
    const before = R.locateShowYourThinking(html);
    const syt = before.model.kind === "paragraphs" ? SYNTHETIC_PARAGRAPHS : SYNTHETIC_INLINE;
    const out = R.renderShowYourThinking(html, syt);
    const after = R.locateShowYourThinking(out);
    expect(mask(out, after)).toBe(mask(html, before));
    const reread = R.readShowYourThinking(out);
    expect(reread.prompt).toBe(syt.prompt);
    expect(reread.ariaLabel).toBe(syt.prompt);
    expect(reread.modelAnswer).toBe(AP.modelAnswerText(syt.modelAnswer));
    expect(reread.modelKind).toBe(before.model.kind);
    const expected = R.showYourThinkingFragments(syt);
    expect(at(out, after.prompt)).toBe(expected.prompt);
    expect(at(out, after.ariaLabel)).toBe(expected.ariaLabel);
    expect(at(out, after.model)).toBe(expected.model);
  });
});

describe("Earth's Layers non-regression (string path)", () => {
  const RECORD_DIR = "platform/functions/src/scripts/assessment-presentations";
  const BOUND = [
    ["pr90f52136d39f36d21bf1602d0af3901adf0eae32a046c522907c5e932f342189", "ap1fed478c9e4ad8335946ff7f7b165df657bafc48e8c5990d922419581fa02c25"],
    ["pr6b7c74fe84fb20a9b05d4b2d6e006c21ed2bc02d58dcfbefc925dbd4c400e948", "ap51583824375c58be36627f047f280510b0cde98e9aba2fbec7ef058ad2fc4903"],
  ];
  const artifact = (pr) => read(`app/lessons/variants/lesson_earths-layers__${pr}.html`);
  const record = (ap) => JSON.parse(read(`${RECORD_DIR}/${ap}.json`));

  test("retained records keep their ids, still validate, and use the string form", () => {
    for (const [, ap] of BOUND) {
      const r = record(ap);
      expect(AP.assessmentPresentationRevisionIdFor(r)).toBe(ap);
      expect(AP.validateAssessmentPresentation(r, AP.loadCanonicalPayload(r.assessmentRevisionId)).ok).toBe(true);
      expect(typeof r.showYourThinking.modelAnswer).toBe("string");
    }
  });

  test("the rebuild-verified artifact reproduces byte for byte", () => {
    const built = variantSource.buildAuthoredVariant({ slug: "earths-layers", variantKey: "reading-adapted" });
    expect(built.presentationRevisionId).toBe(BOUND[1][0]);
    expect(built.bytes).toBe(artifact(BOUND[1][0]));
  });

  test.each(BOUND)("retained %s Show Your Thinking bytes reproduce from %s", (pr, ap) => {
    const canonical = read("app/lessons/lesson_earths-layers.html");
    const rendered = R.renderShowYourThinking(canonical, record(ap).showYourThinking);
    const retained = artifact(pr);
    expect(at(rendered, R.locateShowYourThinking(rendered).box)).toBe(at(retained, R.locateShowYourThinking(retained).box));
  });
});

// A synthetic adapted three-choice record for a real lesson's committed r1
// payload (the fixture builder's generic items; synthetic wording only).
function renderReal(slug, syt) {
  const html = read(`app/lessons/lesson_${slug}.html`);
  const payload = AP.loadCanonicalPayload(`assessment_${slug}__r1`);
  const record = F.adaptedThreeChoice(payload);
  record.lessonSlug = slug;
  record.assessmentRevisionId = `assessment_${slug}__r1`;
  record.showYourThinking = syt;
  const run = () =>
    R.renderAssessmentPresentation(html, {
      record,
      assessmentPresentationRevisionId: AP.assessmentPresentationRevisionIdFor(record),
      canonicalPayload: payload,
    }).html;
  return { html, run };
}

describe("Biological Evolution: prefixed inline markup through the string path", () => {
  const syt = { prompt: "Synthetic prompt about a common ancestor.", modelAnswer: "Synthetic model answer.", requiredTerms: ["common ancestor"] };

  test("renders the adapted block and nothing else in the component", () => {
    const { html, run } = renderReal("biological-evolution", syt);
    const out = run();
    expect(out).toContain('<p class="be-think-prompt">Synthetic prompt about a <strong>common ancestor</strong>.</p>');
    expect(out).toContain('id="be-thinking"');
    expect(out).toContain('aria-label="Synthetic prompt about a common ancestor."');
    expect(out).toContain('<span class="tm-label">One strong way to say it</span>\n        Synthetic model answer.\n      </div>');
    const before = R.locateShowYourThinking(html);
    const after = R.locateShowYourThinking(out);
    expect(at(out, after.box).length - at(html, before.box).length).toBe(
      (at(out, after.prompt) + at(out, after.ariaLabel) + at(out, after.model)).length -
        (at(html, before.prompt) + at(html, before.ariaLabel) + at(html, before.model)).length,
    );
    expect(R.readBindingBlock(out).lessonSlug).toBe("biological-evolution");
  });

  test("a structured model answer is refused: the canonical model is inline", () => {
    const structured = { ...syt, modelAnswer: { paragraphs: [{ lead: "Claim:", text: "Synthetic." }] } };
    expect(renderReal("biological-evolution", structured).run).toThrow("the canonical model answer is inline prose");
  });
});

describe("Conducting Experiments: prefixed paragraph model with supplied evidence", () => {
  const syt = {
    prompt: "Synthetic claim, evidence, and reasoning prompt.",
    modelAnswer: {
      paragraphs: [
        { lead: "Claim:", text: "Synthetic claim sentence." },
        { lead: "Evidence:", text: "Synthetic evidence sentence." },
        { lead: "Reasoning:", text: "Synthetic reasoning sentence." },
        { lead: null, text: "Synthetic closing sentence." },
      ],
    },
    requiredTerms: ["claim", "evidence", "reasoning"],
  };
  const HYPO = '<textarea class="ce-think-input hypo-own-input" id="hypo-own-input"';

  test("the locator picks #ce-thinking, never the Explore hypothesis textarea", () => {
    const html = read("app/lessons/lesson_conducting-experiments.html");
    expect(html).toContain(HYPO);
    const located = R.locateShowYourThinking(html);
    expect(located.prefix).toBe("ce");
    expect(located.ariaLabel.start).toBeGreaterThan(html.indexOf('id="ce-thinking"'));
    expect(located.ariaLabel.start).toBeGreaterThan(html.indexOf(HYPO) + HYPO.length);
    expect(located.text.ariaLabel).toBe("Use the results from the Mentos-and-soda investigation to write a claim, evidence, and reasoning");
  });

  test("renders four paragraphs with Claim / Evidence / Reasoning leads and the unlabeled closing paragraph", () => {
    const out = renderReal("conducting-experiments", syt).run();
    expect(out).toContain(
      '<div class="ce-think-model" id="ce-think-model">\n' +
        '        <span class="tm-label">One strong way to say it</span>\n' +
        "        <p><strong>Claim:</strong> Synthetic claim sentence.</p>\n" +
        "        <p><strong>Evidence:</strong> Synthetic evidence sentence.</p>\n" +
        "        <p><strong>Reasoning:</strong> Synthetic reasoning sentence.</p>\n" +
        "        <p>Synthetic closing sentence.</p>\n" +
        "      </div>",
    );
    expect(out).toContain(
      '<p class="ce-think-prompt">Synthetic <strong>claim</strong>, <strong>evidence</strong>, and <strong>reasoning</strong> prompt.</p>',
    );
    expect(R.readShowYourThinking(out).modelKind).toBe("paragraphs");
  });

  test("supplied evidence, ids, placeholder, tm-label, and the rest of the lesson are unchanged", () => {
    const { html, run } = renderReal("conducting-experiments", syt);
    const out = run();
    const evidence = (h) => h.slice(h.indexOf('<div class="ce-data" id="ce-data">'), h.indexOf('<p class="ce-think-prompt">'));
    expect(evidence(html).length).toBeGreaterThan(1000);
    expect(evidence(out)).toBe(evidence(html));
    expect(out).toContain(`${HYPO} placeholder="If ..., then ..., because ..." aria-label="Write your own if - then - because hypothesis about water and plant growth"></textarea>`);
    expect(out).toContain(
      '<textarea class="ce-think-input" id="ce-thinking" placeholder="Write your claim, then your evidence, then your reasoning..." aria-label="Synthetic claim, evidence, and reasoning prompt."></textarea>',
    );
    const ids = (h) => [...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]).filter((id) => id !== "lyfelabz-assessment-presentation");
    expect(ids(out)).toEqual(ids(html));
    // Inside the component only the three located ranges differ. (The
    // full-document proof for renderShowYourThinking is the corpus test.)
    const boxOnly = (h) => {
      const l = R.locateShowYourThinking(h);
      return mask(h.slice(0, l.box.end), l).slice(l.box.start);
    };
    expect(boxOnly(out)).toBe(boxOnly(html));
  });

  test("a string model answer is refused: it would flatten the paragraph model", () => {
    const flat = { ...syt, modelAnswer: "Synthetic claim, evidence, and reasoning in one run." };
    expect(renderReal("conducting-experiments", flat).run).toThrow("the canonical model answer is <p> paragraphs");
  });

  test("rendering is deterministic", () => {
    const { run } = renderReal("conducting-experiments", syt);
    expect(run()).toBe(run());
  });
});

describe("model-answer kind matching", () => {
  const paragraphLesson = () => F.lessonHtml({ modelHtml: F.CANONICAL_PARAGRAPH_MODEL });
  const render = (record, html) =>
    R.renderAssessmentPresentation(html, {
      record,
      assessmentPresentationRevisionId: AP.assessmentPresentationRevisionIdFor(record),
      canonicalPayload: F.canonicalPayload(),
    }).html;
  const withSyt = (syt) => {
    const r = F.adaptedThreeChoice();
    r.showYourThinking = syt;
    return r;
  };

  test("string to inline and paragraphs to paragraphs render", () => {
    expect(() => render(withSyt(F.ADAPTED_SYT), F.lessonHtml())).not.toThrow();
    const out = render(withSyt(F.ADAPTED_SYT_PARAGRAPHS), paragraphLesson());
    expect(out).toContain("<p><strong>Claim:</strong> Heat makes the mantle move by convection.</p>\n        <p><strong>Evidence:</strong>");
    expect(out).toContain("<p>This moves the plates.</p>\n      </div>");
  });

  test("mismatches fail in both directions", () => {
    expect(() => render(withSyt(F.ADAPTED_SYT_PARAGRAPHS), F.lessonHtml())).toThrow("is { paragraphs }, but the canonical model answer is inline prose");
    expect(() => render(withSyt(F.ADAPTED_SYT), paragraphLesson())).toThrow("is a string, but the canonical model answer is <p> paragraphs");
  });

  test("modelAnswerKindEquivalence fails closed without a canonical model kind", () => {
    expect(AP.modelAnswerKindEquivalence(F.ADAPTED_SYT, { modelKind: "inline" }).ok).toBe(true);
    expect(AP.modelAnswerKindEquivalence(F.ADAPTED_SYT, null).ok).toBe(false);
    expect(AP.modelAnswerKindEquivalence(F.ADAPTED_SYT, { prompt: "x", modelAnswer: "y" }).ok).toBe(false);
    expect(AP.modelAnswerKindEquivalence(null, null).ok).toBe(true);
  });

  test("the review analysis reports a kind mismatch as a hard failure", () => {
    const canonicalLesson = { directions: F.CANONICAL_DIRECTIONS, showYourThinking: R.readShowYourThinking(paragraphLesson()) };
    const analysis = REV.analyze({ record: withSyt(F.ADAPTED_SYT), canonicalPayload: F.canonicalPayload(), canonicalLesson });
    expect(analysis.hardFailures.join("\n")).toContain("the canonical model answer is <p> paragraphs");
  });
});

describe("malformed or ambiguous markup fails closed", () => {
  const base = F.lessonHtml();
  const insideBox = (h, snippet) => h.replace('<div class="think-eyebrow">', `${snippet}\n      <div class="think-eyebrow">`);
  const cases = [
    ["two components", base.replace('<section id="quiz"', '<div class="think-box" id="other-think"></div>\n<section id="quiz"'), "2 Show Your Thinking components"],
    ["a component without the <prefix>-think id", base.replace('id="fx-think"', 'id="fx-thought"'), 'must be a <div id="<prefix>-think">'],
    ["a class family that does not match the prefix", base.replace('class="think-box"', 'class="zz-think-box"'), "does not match its prefix"],
    ["a prefix that does not match the quiz literal", base.split('id="fx-think').join('id="zz-think'), 'prefix "zz" does not match the quiz literal prefix "fx"'],
    ["no quiz literal", F.lessonHtml({ literal: "" }), "needs exactly one <prefix>QuizQuestions literal"],
    ["a missing prompt", base.replace('<p class="think-prompt">', '<p class="think-lead">'), "0 think-prompt anchor(s) inside #fx-think"],
    ["a duplicated prompt", insideBox(base, '<p class="think-prompt">Second.</p>'), "2 think-prompt anchor(s) inside #fx-think"],
    [
      "a prompt only outside the component",
      base.replace('<p class="think-prompt">', '<p class="think-lead">').replace('<section id="quiz"', '<p class="think-prompt">Outside.</p>\n<section id="quiz"'),
      "0 think-prompt anchor(s) inside #fx-think",
    ],
    ["a duplicated textarea id", base.replace('<section id="quiz"', '<textarea id="fx-thinking"></textarea>\n<section id="quiz"'), 'id "fx-thinking" must appear exactly once'],
    ["a second textarea in the component", insideBox(base, '<textarea class="think-input" id="fx-other" aria-label="Other"></textarea>'), "contains 2 textarea(s)"],
    ["a textarea from another class family", base.replace('<textarea class="think-input"', '<textarea class="be-think-input"'), "must carry class think-input"],
    ["a textarea without an aria-label", base.replace(' aria-label="Explain how heat from the core drives convection"', ""), "exactly one non-empty double-quoted aria-label"],
    ["a model without its tm-label", base.replace('<span class="tm-label">One strong way to say it</span>', ""), 'must begin with its <span class="tm-label">'],
    ["a nested block in the model", F.lessonHtml({ modelHtml: "<div>Nested block.</div>" }), "unsupported model-answer structure"],
    ["paragraphs mixed with loose text", F.lessonHtml({ modelHtml: "<p>One.</p> Loose text." }), "unsupported model-answer structure"],
    ["a block inside a model paragraph", F.lessonHtml({ modelHtml: "<p>One <span>two</span>.</p><p>Three.</p>" }), "unsupported model-answer structure"],
    ["a comment in the model", F.lessonHtml({ modelHtml: "<!-- note -->Text." }), "unsupported model-answer structure"],
    ["an empty model", F.lessonHtml({ modelHtml: "" }), "unsupported model-answer structure"],
  ];

  test.each(cases)("refuses %s (reader and renderer)", (_label, html, message) => {
    expect(() => R.readShowYourThinking(html)).toThrow(message);
    expect(() => R.renderShowYourThinking(html, F.ADAPTED_SYT)).toThrow(message);
  });

  test("a model outside the component is refused", () => {
    const model = /<div class="think-model" id="fx-think-model">[\s\S]*?<\/div>\n/.exec(base)[0];
    const html = base.replace(model, "").replace('<section id="quiz"', `${model}<section id="quiz"`);
    expect(() => R.readShowYourThinking(html)).toThrow("#fx-think-model must be inside #fx-think");
  });

  test("a lesson with no component reads as null and refuses an adapted block", () => {
    const html = F.lessonHtml({ thinkBox: false });
    expect(R.locateShowYourThinking(html)).toBeNull();
    expect(R.readShowYourThinking(html)).toBeNull();
    expect(() => R.renderShowYourThinking(html, F.ADAPTED_SYT)).toThrow("lesson has 0 think-prompt anchor(s)");
  });
});

describe("structured model-answer validation", () => {
  const validate = (modelAnswer) => {
    const r = F.adaptedThreeChoice();
    r.showYourThinking = { ...F.ADAPTED_SYT, modelAnswer };
    return AP.validateAssessmentPresentation(r, F.canonicalPayload());
  };
  const para = (lead, text) => ({ lead, text });

  test("the string form and a well-formed paragraph form validate", () => {
    expect(validate(F.ADAPTED_SYT.modelAnswer).ok).toBe(true);
    expect(validate(F.ADAPTED_SYT_PARAGRAPHS.modelAnswer).ok).toBe(true);
    expect(validate({ paragraphs: [para("Claim:", "One.")] }).ok).toBe(true);
    expect(validate({ paragraphs: [para(null, "One."), para(null, "Two.")] }).ok).toBe(true);
  });

  test.each([
    ["an empty string", "", "showYourThinking.modelAnswer must be a non-empty string"],
    ["a number", 7, "must be a non-empty string or an object { paragraphs }"],
    ["null", null, "must be a non-empty string or an object { paragraphs }"],
    ["an array", [para("Claim:", "One.")], "must be a non-empty string or an object { paragraphs }"],
    ["an HTML-string escape hatch", { html: "<p>One.</p>" }, 'showYourThinking.modelAnswer unknown field "html"'],
    ["an unknown sibling field", { paragraphs: [para("Claim:", "One.")], style: "cer" }, 'unknown field "style"'],
    ["missing paragraphs", {}, "paragraphs must be a non-empty array"],
    ["empty paragraphs", { paragraphs: [] }, "paragraphs must be a non-empty array"],
    ["a non-object paragraph", { paragraphs: ["One.", "Two."] }, "paragraphs[0] must be an object { lead, text }"],
    ["an unknown paragraph field", { paragraphs: [{ lead: "Claim:", text: "One.", html: "<b>x</b>" }] }, 'paragraphs[0] unknown field "html"'],
    ["a missing lead", { paragraphs: [{ text: "One." }, para(null, "Two.")] }, "paragraphs[0].lead must be null or a non-empty string"],
    ["an empty lead", { paragraphs: [para("", "One.")] }, "paragraphs[0].lead must be null or a non-empty string"],
    ["a padded lead", { paragraphs: [para("Claim: ", "One.")] }, "paragraphs[0].lead must be null or a non-empty string without surrounding whitespace"],
    ["an empty text", { paragraphs: [para("Claim:", "")] }, "paragraphs[0].text must be a non-empty string"],
    ["a padded text", { paragraphs: [para("Claim:", " One.")] }, "paragraphs[0].text must be a non-empty string without surrounding whitespace"],
    ["a non-string text", { paragraphs: [para("Claim:", 3)] }, "paragraphs[0].text must be a non-empty string"],
    ["a single unlabeled paragraph", { paragraphs: [para(null, "One.")] }, "single unlabeled paragraph; use the string form"],
  ])("rejects %s", (_label, modelAnswer, message) => {
    const result = validate(modelAnswer);
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain(message);
  });
});

describe("escaping: no presentation text becomes markup", () => {
  test("structured lead and text, prompt, and aria-label are escaped", () => {
    const r = F.adaptedThreeChoice();
    r.showYourThinking = {
      prompt: 'Explain convection "now" </p><script>alert(1)</script>',
      modelAnswer: {
        paragraphs: [
          { lead: '<img src=x onerror="alert(1)">', text: "</p><script>alert('x')</script> & more" },
          { lead: null, text: '"><svg onload=alert(2)>' },
        ],
      },
      requiredTerms: ["convection"],
    };
    const html = R.renderAssessmentPresentation(F.lessonHtml({ modelHtml: F.CANONICAL_PARAGRAPH_MODEL }), {
      record: r,
      assessmentPresentationRevisionId: AP.assessmentPresentationRevisionIdFor(r),
      canonicalPayload: F.canonicalPayload(),
    }).html;
    expect(html).not.toMatch(/<script>alert|<img src=x|<svg onload/);
    expect(html).toContain("<p><strong>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</strong> &lt;/p&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; more</p>");
    expect(html).toContain("<p>&quot;&gt;&lt;svg onload=alert(2)&gt;</p>");
    expect(html).toContain('aria-label="Explain convection &quot;now&quot; &lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    const reread = R.readShowYourThinking(html);
    expect(reread.modelAnswer).toBe(AP.modelAnswerText(r.showYourThinking.modelAnswer));
    expect(reread.prompt).toBe(r.showYourThinking.prompt);
  });
});

describe("determinism and identity", () => {
  function deepReverse(value) {
    if (Array.isArray(value)) return value.map(deepReverse);
    if (value && typeof value === "object") {
      const out = {};
      for (const k of Object.keys(value).reverse()) out[k] = deepReverse(value[k]);
      return out;
    }
    return value;
  }

  test("a structured record's id is independent of key order and changes with content", () => {
    const r = F.adaptedThreeChoice();
    r.showYourThinking = F.ADAPTED_SYT_PARAGRAPHS;
    const id = AP.assessmentPresentationRevisionIdFor(r);
    expect(AP.assessmentPresentationRevisionIdFor(deepReverse(r))).toBe(id);
    expect(AP.canonicalJson(deepReverse(r))).toBe(AP.canonicalJson(r));
    expect(AP.canonicalJson(r)).toContain('{"lead":null,"text":"This moves the plates."}');
    const reordered = JSON.parse(JSON.stringify(r));
    reordered.showYourThinking.modelAnswer.paragraphs.reverse();
    expect(AP.assessmentPresentationRevisionIdFor(reordered)).not.toBe(id);
  });

  test("structured rendering is deterministic", () => {
    const r = F.adaptedThreeChoice();
    r.showYourThinking = F.ADAPTED_SYT_PARAGRAPHS;
    const run = () =>
      R.renderAssessmentPresentation(F.lessonHtml({ modelHtml: F.CANONICAL_PARAGRAPH_MODEL }), {
        record: r,
        assessmentPresentationRevisionId: AP.assessmentPresentationRevisionIdFor(r),
        canonicalPayload: F.canonicalPayload(),
      }).html;
    expect(run()).toBe(run());
  });
});

describe("plain-text consumers flatten structured models", () => {
  const paragraphLesson = F.lessonHtml({ modelHtml: F.CANONICAL_PARAGRAPH_MODEL });
  const canonicalSyt = R.readShowYourThinking(paragraphLesson);

  test("modelAnswerText reads paragraphs as rendered and never coerces objects", () => {
    expect(AP.modelAnswerText(F.ADAPTED_SYT.modelAnswer)).toBe(F.ADAPTED_SYT.modelAnswer);
    expect(AP.modelAnswerText(F.ADAPTED_SYT_PARAGRAPHS.modelAnswer)).toBe(
      "Claim: Heat makes the mantle move by convection. Evidence: Hot rock goes up and cool rock goes down. This moves the plates.",
    );
    for (const odd of [undefined, null, 5, [], {}, { paragraphs: "x" }, { paragraphs: [null, 3, {}] }]) {
      expect(AP.modelAnswerText(odd)).toBe("");
    }
    expect(canonicalSyt.modelAnswer).toBe("Claim: Heat drives convection. Evidence: Hot rock rises and cool rock sinks. That loop moves the plates.");
  });

  test("identical-text findings compare the flattened structured model", () => {
    const r = F.adaptedThreeChoice();
    r.showYourThinking = {
      ...F.ADAPTED_SYT_PARAGRAPHS,
      modelAnswer: {
        paragraphs: [
          { lead: "Claim:", text: "Heat drives convection." },
          { lead: "Evidence:", text: "Hot rock rises and cool rock sinks." },
          { lead: null, text: "That loop moves the plates." },
        ],
      },
    };
    const found = AP.identicalTextFindings(r, F.canonicalPayload(), { directions: null, showYourThinking: canonicalSyt });
    expect(found.find((f) => f.field === "showYourThinking.modelAnswer")).toMatchObject({ kind: "identical" });
  });

  test("required-term equivalence reads the structured model's text", () => {
    const eq = AP.requiredTermEquivalence(F.ADAPTED_SYT_PARAGRAPHS, canonicalSyt);
    expect(eq.ok).toBe(true);
    expect(eq.terms[0]).toMatchObject({ term: "convection", adaptedModelAnswer: true, canonicalModelAnswer: true });
  });

  test("the review causal chain and packet show flattened text", () => {
    const payload = F.canonicalPayload();
    const r = F.adaptedThreeChoice(payload);
    r.showYourThinking = F.ADAPTED_SYT_PARAGRAPHS;
    const notes = {
      schemaVersion: 1,
      kind: REV.NOTES_KIND,
      lessonSlug: r.lessonSlug,
      assessmentRevisionId: r.assessmentRevisionId,
      items: r.items.map((it, i) => {
        const dm = {};
        for (const o of it.displayedOptions) if (o.optionId !== payload.items[i].correctOptionId) dm[o.optionId] = `misconception ${o.optionId}`;
        return { itemId: it.itemId, correctMeaning: "same meaning", distractorMisconceptions: dm };
      }),
      showYourThinking: { evidenceComparison: "same evidence", causalChain: [{ step: "Plates", terms: ["plates"] }] },
      unchanged: {},
    };
    const analysis = REV.analyze({ record: r, canonicalPayload: payload, canonicalLesson: { directions: F.CANONICAL_DIRECTIONS, showYourThinking: canonicalSyt }, notes });
    expect(analysis.ok).toBe(true);
    expect(analysis.chain[0].adaptedModelAnswer).toEqual(["plates"]);
    const packet = REV.renderPacket(analysis);
    expect(packet).toContain(`- Adapted model answer: ${AP.modelAnswerText(F.ADAPTED_SYT_PARAGRAPHS.modelAnswer)}`);
    expect(packet).not.toContain("[object Object]");
  });
});
