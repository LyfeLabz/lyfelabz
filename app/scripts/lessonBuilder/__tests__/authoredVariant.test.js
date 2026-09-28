/**
 * @jest-environment node
 *
 * Authored presentation-variant tooling (variantSource.cjs,
 * variantInvariance.cjs). Every generation test runs against an isolated
 * temp repository root; the real Earth's Layers checks at the end run in
 * memory only and write nothing. No real adapted lesson content is
 * authored here: fixtures are synthetic, and the Earth's Layers checks
 * use the canonical source itself (plus single in-memory probe edits).
 */
/* eslint-disable */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const variantSource = require("../variantSource.cjs");
const fidelity = require("../assessmentFidelity.cjs");
const manifestMod = require("../variantManifest.cjs");
const configMod = require("../config.cjs");
const paths = require("../paths.cjs");

const SLUG = "fixture-lesson";
const KEY = "reading-adapted";
const VARIANT_REL = `lesson-sources/variants/${SLUG}.${KEY}.html`;
const PUBLISHED_AT = "2026-01-01T00:00:00.000Z";

// Synthetic canonical source (test-only; not real lesson content).
const CANONICAL = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>LyfeLabz | Fixture Lesson</title>
<link rel="canonical" href="https://lyfelabz.com/lesson_fixture-lesson.html">
<link rel="icon" href="favicon.ico">
<style>.lead{font-weight:600}.vocab{color:gold}</style>
</head>
<body>
<nav><a href="index.html">Home</a> <a href="#quiz">Quiz</a></nav>
<!-- LYFELABZ:V1-ONLY:BEGIN legacy-form -->
<div class="legacy">LEGACY_ONLY classroom form</div>
<!-- LYFELABZ:V1-ONLY:END legacy-form -->
<section id="goals"><h2 class="section-title">What You'll Be Able to Do</h2><ul class="goals"><li>Explain the fixture model.</li></ul></section>
<section id="explore">
  <div class="container">
    <span class="section-label">Explore</span>
    <h2 class="section-title">Inside the Fixture</h2>
    <p class="section-desc">The fixture has three parts, and each part has a job that the other parts depend on in order to keep the whole system working.</p>
    <div class="content-card">
      <h3 id="term-core">The Core Part</h3>
      <p>The core part is dense. It sits in the middle because dense material sinks, which is the <span class="vocab">density rule</span> at work.</p>
      <p class="lead">Read the diagram before you answer.</p>
      <img src="images/fixture.png" alt="Diagram of the three fixture parts">
      <svg role="img" aria-label="Fixture layers"><circle r="4"></circle></svg>
      <div class="callout"><div class="callout-body"><strong>Why it matters:</strong> Dense parts sink and light parts rise, so layers form over time.</div></div>
      <p>See <a id="ref-other" href="lesson_other.html">the other lesson</a> for more.</p>
    </div>
    <div class="bridge-callout"><strong>Remember:</strong> Density sets the order of the parts.</div>
    <div class="bridge-callout"><strong>The chain:</strong> <div class="chips"><span class="chip">Heat</span><span class="chip">Motion</span></div> Surface change follows from both.</div>
    <div class="qr-card"><div class="qr-q" id="qr1Q">Which part is most dense?</div><button id="qr1Check">Check Answer</button></div>
    <div class="edu-note"><ul class="edu-note-text"><li>Teacher-only design note.</li></ul></div>
  </div>
</section>
<section id="quiz"><h2 class="section-title">Check Your Understanding</h2><div id="fx-quiz"></div></section>
<script>
var fxQuizQuestions = [
  { q: "Where do dense parts go?", options: ["They sink", "They rise"], correct: 0, explanation: "Dense material sinks." },
  { q: "What forms over time?", options: ["Nothing", "Layers"], correct: 1, explanation: "Sorting by density forms layers." }
];
/* LYFELABZ:V2-ONLY:BEGIN platform-hook */
window.fxPlatform = true;
/* LYFELABZ:V2-ONLY:END platform-hook */
</script>
</body>
</html>
`;

function baseConfig(overrides = {}) {
  return {
    slug: SLUG,
    canonicalSource: `lesson-sources/lesson_${SLUG}.html`,
    outputs: { v1: `lesson_${SLUG}.html`, v2: `app/lessons/lesson_${SLUG}.html` },
    generatedNotice: {
      v1: "<!--\nGENERATED FILE. DO NOT EDIT DIRECTLY.\nCanonical source: lesson-sources/lesson_fixture-lesson.html\nBuild target: v1\n-->\n",
      v2: "<!--\nGENERATED FILE. DO NOT EDIT DIRECTLY.\nCanonical source: lesson-sources/lesson_fixture-lesson.html\nBuild target: v2\n-->\n",
    },
    requiredLabels: { v1Only: ["legacy-form"], v2Only: ["platform-hook"] },
    expectedContexts: { "legacy-form": "html", "platform-hook": "js" },
    v2ProhibitedSignatures: ["LEGACY_ONLY"],
    v1RequiredSignatures: ["LEGACY_ONLY"],
    sharedRequiredSignatures: ["var fxQuizQuestions"],
    equivalenceExclusions: {},
    variants: {
      [KEY]: {
        source: VARIANT_REL,
        adaptableSections: ["explore"],
        adaptableSelectors: ["p", ".callout-body", ".bridge-callout"],
        lockedSelectors: [".qr-card", ".edu-note", ".chips"],
      },
    },
    ...overrides,
  };
}

function payloads(html = CANONICAL) {
  const quiz = fidelity.extractCanonicalQuiz(html, SLUG);
  return [{ name: `${SLUG}.r1.json`, payload: fidelity.buildPayload(SLUG, quiz, "test", 1) }];
}

function build(variantSource_, opts = {}) {
  return variantSource.buildVariantArtifact({
    cfg: opts.cfg || baseConfig(),
    variantKey: KEY,
    canonicalSourceBytes: opts.canonical || CANONICAL,
    variantSourceBytes: variantSource_,
    assessmentPayloads: opts.payloads || payloads(),
  });
}

function edit(src, needle, replacement) {
  const at = src.indexOf(needle);
  if (at === -1 || src.indexOf(needle, at + needle.length) !== -1) throw new Error(`needle not unique: ${needle}`);
  return src.slice(0, at) + replacement + src.slice(at + needle.length);
}

function expectReject(variant, fragment, opts) {
  expect(() => build(variant, opts)).toThrow(fragment);
}

// A legitimate reading adaptation of the fixture prose: shorter
// sentences, a split paragraph, reused inline forms. Same science.
const ADAPTED = edit(
  edit(
    CANONICAL,
    '<p class="section-desc">The fixture has three parts, and each part has a job that the other parts depend on in order to keep the whole system working.</p>',
    '<p class="section-desc">The fixture has three parts.</p>\n    <p class="section-desc">Each part has a job. The parts depend on each other.</p>',
  ),
  "<p>The core part is dense. It sits in the middle because dense material sinks, which is the <span class=\"vocab\">density rule</span> at work.</p>",
  "<p>The core part is <strong>dense</strong>.</p>\n      <p>Dense material sinks. So the core sits in the middle. This is the <span class=\"vocab\">density rule</span>.</p>",
);

describe("authored variant - build and gate (positive)", () => {
  test("an unadapted copy passes, is deterministic, and is content-addressed", () => {
    const a = build(CANONICAL);
    const b = build(CANONICAL);
    expect(a.bytes).toBe(b.bytes);
    expect(a.presentationRevisionId).toBe(`pr${a.sha256}`);
    expect(a.path).toBe(`app/lessons/variants/lesson_${SLUG}__${a.presentationRevisionId}.html`);
    expect(a.assessmentRevisions).toEqual([`${SLUG}.r1.json`]);
  });

  test("the artifact is a v2 build with a neutral notice that discloses nothing", () => {
    const { bytes } = build(ADAPTED);
    expect(bytes.startsWith("<!DOCTYPE html>\n<!--\nGENERATED FILE. DO NOT EDIT DIRECTLY.\nAlternate presentation of lesson_fixture-lesson.\n-->\n")).toBe(true);
    expect(bytes).not.toMatch(/reading-adapted|reading adapted|accommodat|simplified/i);
    expect(bytes).not.toContain(VARIANT_REL);
    expect(bytes).not.toContain(`${SLUG}.${KEY}`);
    expect(bytes).not.toContain("LEGACY_ONLY");
    expect(bytes).toContain("window.fxPlatform = true;");
    expect(bytes).not.toContain("LYFELABZ:");
  });

  test("relative references are relocated; anchors and absolute references are kept", () => {
    const r = build(ADAPTED);
    expect(r.bytes).toContain('href="/app/lessons/index.html"');
    expect(r.bytes).toContain('href="/app/lessons/favicon.ico"');
    expect(r.bytes).toContain('src="/app/lessons/images/fixture.png"');
    expect(r.bytes).toContain('href="/app/lessons/lesson_other.html"');
    expect(r.bytes).toContain('href="#quiz"');
    expect(r.bytes).toContain('href="https://lyfelabz.com/lesson_fixture-lesson.html"');
    expect(r.relocatedReferences.map((x) => x.from)).toEqual([
      "favicon.ico", "index.html", "images/fixture.png", "lesson_other.html",
    ]);
  });

  test("adapted prose passes and changes only prose statistics", () => {
    const r = build(ADAPTED);
    expect(r.review.variantProse.averageSentenceWords).toBeLessThan(r.review.canonicalProse.averageSentenceWords);
    expect(r.review.variantProse.sentences).toBeGreaterThan(r.review.canonicalProse.sentences);
  });

  test("scripts and styles in the artifact are byte-identical to the canonical v2 build", () => {
    const r = build(ADAPTED);
    const scripts = (s) => s.match(/<script\b[\s\S]*?<\/script>/g);
    const styles = (s) => s.match(/<style\b[\s\S]*?<\/style>/g);
    const canonV2 = build(CANONICAL).bytes;
    expect(scripts(r.bytes)).toEqual(scripts(canonV2));
    expect(styles(r.bytes)).toEqual(styles(canonV2));
  });
});

describe("authored variant - invariance violations are rejected", () => {
  test("locked heading text inside an adaptable section", () => {
    expectReject(edit(CANONICAL, "The Core Part</h3>", "The Middle Part</h3>"), /locked markup differs/);
  });
  test("locked text in a locked container (Brain Check)", () => {
    expectReject(edit(CANONICAL, "Which part is most dense?", "Which part is heaviest?"), /locked markup differs/);
  });
  test("teacher-only Educator Mode note", () => {
    expectReject(edit(CANONICAL, "Teacher-only design note.", "Changed note."), /locked markup differs/);
  });
  test("markup outside adaptable sections (learning goals)", () => {
    expectReject(edit(CANONICAL, "Explain the fixture model.", "Describe the fixture model."), /outside adaptable sections/);
  });
  test("head metadata (title)", () => {
    expectReject(edit(CANONICAL, "<title>LyfeLabz | Fixture Lesson</title>", "<title>Fixture</title>"), /outside adaptable sections/);
  });
  test("quiz wording in a script block", () => {
    expectReject(edit(CANONICAL, "Where do dense parts go?", "Where does dense stuff go?"), /script blocks are not byte-identical/);
  });
  test("style block", () => {
    expectReject(edit(CANONICAL, ".lead{font-weight:600}", ".lead{font-weight:700}"), /style blocks are not byte-identical/);
  });
  test("a removed image", () => {
    expectReject(edit(CANONICAL, '<img src="images/fixture.png" alt="Diagram of the three fixture parts">', ""), /locked markup differs/);
  });
  test("changed image alt text", () => {
    expectReject(edit(CANONICAL, 'alt="Diagram of the three fixture parts"', 'alt="Diagram"'), /locked markup differs/);
  });
  test("a changed SVG diagram", () => {
    expectReject(edit(CANONICAL, '<circle r="4">', '<circle r="5">'), /locked markup differs/);
  });
  test("a new block element in an adaptable section", () => {
    expectReject(edit(CANONICAL, '<p class="lead">', '<div class="tip">Tip</div><p class="lead">'), /locked markup differs/);
  });
  test("a removed prose run between locked elements", () => {
    expectReject(
      edit(CANONICAL, '<p class="section-desc">The fixture has three parts, and each part has a job that the other parts depend on in order to keep the whole system working.</p>', ""),
      /locked markup differs/,
    );
  });
  test("an emptied prose run", () => {
    expectReject(
      edit(CANONICAL, "The fixture has three parts, and each part has a job that the other parts depend on in order to keep the whole system working.", " "),
      /adaptable prose run is empty/,
    );
  });
  test("new styling inside prose", () => {
    expectReject(edit(CANONICAL, "The core part is dense.", 'The core part is <span class="big">dense</span>.'), /not allowed in adaptable prose/);
  });
  test("a new container style", () => {
    expectReject(edit(CANONICAL, '<p class="lead">Read', '<p class="new-style">Read'), /not a form used by the canonical lesson/);
  });
  test("a comment inside prose", () => {
    expectReject(edit(CANONICAL, "The core part is dense.", "The core part is dense.<!-- note -->"), /may not contain comments/);
  });
  test("a duplicated element id", () => {
    expectReject(
      edit(CANONICAL, "for more.</p>", 'for more. Also <a id="ref-other" href="lesson_other.html">here</a>.</p>'),
      /element id "ref-other"/,
    );
  });
  test("disclosure of the adaptation in prose", () => {
    expectReject(edit(CANONICAL, "Read the diagram before you answer.", "This simplified lesson has a diagram."), /disclosure term/);
  });
  test("disclosure of the variantKey", () => {
    expectReject(edit(CANONICAL, "Read the diagram before you answer.", "reading-adapted diagram."), /disclosure term/);
  });
  test("an adaptable section missing from the variant", () => {
    expectReject(edit(CANONICAL, '<section id="explore">', '<section id="explore-2">'), /adaptable section "explore" not found/);
  });
  test("a legacy classroom signature leaking into the variant v2 output", () => {
    expectReject(
      edit(CANONICAL, "<!-- LYFELABZ:V1-ONLY:BEGIN legacy-form -->\n", "").replace("<!-- LYFELABZ:V1-ONLY:END legacy-form -->\n", ""),
      /required V1-ONLY label "legacy-form" missing/,
    );
  });
  test("a script that would need URL relocation", () => {
    const c = edit(CANONICAL, "window.fxPlatform = true;", "window.fxPlatform = 'lesson_x.html';");
    expect(() => build(c, { canonical: c })).toThrow(/relative URL literal/);
  });
});

describe("authored variant - locked descendants inside adaptable containers", () => {
  test("a sibling adaptable container without locked descendants stays adaptable", () => {
    expect(() => build(edit(CANONICAL, "Density sets the order of the parts.", "Density sets the order. Dense parts go deepest."))).not.toThrow();
  });
  test("a locked descendant cannot be changed", () => {
    expectReject(edit(CANONICAL, '<span class="chip">Heat</span>', '<span class="chip">Warmth</span>'), /locked markup differs/);
  });
  test("locked descendants cannot be reordered or removed", () => {
    expectReject(
      edit(CANONICAL, '<span class="chip">Heat</span><span class="chip">Motion</span>', '<span class="chip">Motion</span><span class="chip">Heat</span>'),
      /locked markup differs/,
    );
    expectReject(edit(CANONICAL, '<span class="chip">Motion</span>', ""), /locked markup differs/);
  });
  test("the container holding a locked descendant is itself not adaptable", () => {
    expectReject(edit(CANONICAL, "Surface change follows from both.", "The surface changes."), /locked markup differs/);
  });
  test("without the locked declaration the same edit would be adaptable prose (the rule is what protects it)", () => {
    const cfg = baseConfig();
    cfg.variants[KEY] = { ...cfg.variants[KEY], lockedSelectors: [".qr-card", ".edu-note"] };
    expect(() => build(edit(CANONICAL, '<span class="chip">Heat</span>', '<span class="chip">Warmth</span>'), { cfg })).not.toThrow();
  });
});

describe("authored variant - assessment protections", () => {
  test("refuses when no committed payload is faithful to the canonical quiz", () => {
    const bad = payloads();
    bad[0].payload.items[0].stem = "Altered stem";
    expectReject(CANONICAL, /no committed assessment payload is faithful/, { payloads: bad });
    expectReject(CANONICAL, /no committed assessment payload is faithful/, { payloads: [] });
  });
  test("binds every faithful payload revision", () => {
    const p = payloads();
    const r2 = { name: `${SLUG}.r2.json`, payload: { ...p[0].payload, revisionOrdinal: 2 } };
    expect(build(ADAPTED, { payloads: [...p, r2] }).assessmentRevisions).toEqual([`${SLUG}.r1.json`, `${SLUG}.r2.json`]);
  });
});

describe("authored variant - config validation", () => {
  const withVariant = (v) => baseConfig({ variants: { [KEY]: { ...baseConfig().variants[KEY], ...v } } });
  test("accepts the fixture config", () => {
    expect(() => configMod.validateConfigShape(baseConfig(), SLUG)).not.toThrow();
  });
  test.each([
    ["an unknown variantKey", baseConfig({ variants: { "large-print": baseConfig().variants[KEY] } }), /V1 variantKey vocabulary/],
    ["a non-canonical source path", withVariant({ source: "lesson-sources/lesson_fixture-lesson__ra.html" }), /source must be/],
    ["empty adaptable sections", withVariant({ adaptableSections: [] }), /non-empty array/],
    ["an invalid selector", withVariant({ adaptableSelectors: ["div > p"] }), /invalid entry/],
    ["an unknown field", withVariant({ allowQuizEdits: true }), /unknown field/],
  ])("rejects %s", (_name, cfg, re) => {
    expect(() => configMod.validateConfigShape(cfg, SLUG)).toThrow(re);
  });
});

describe("authored variant - generation and drift detection (temp repository)", () => {
  let repoRoot;
  const write = (rel, text) => {
    const abs = path.join(repoRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, "utf8");
  };
  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lyfelabz-authored-variant-"));
    write(`lesson-sources/lesson_${SLUG}.html`, CANONICAL);
    write(VARIANT_REL, ADAPTED);
    write(`platform/functions/src/scripts/assessments/${SLUG}.r1.json`, JSON.stringify(payloads()[0].payload));
  });
  afterEach(() => fs.rmSync(repoRoot, { recursive: true, force: true }));

  const cfg = baseConfig();

  test("generation retains the gated bytes through generateVariantArtifact", () => {
    const r = variantSource.generateAuthoredVariant({ slug: SLUG, variantKey: KEY, publishedAt: PUBLISHED_AT, repoRoot, cfg });
    expect(r.fileWritten).toBe(true);
    expect(r.appended).toBe(true);
    expect(fs.readFileSync(path.join(repoRoot, r.path), "utf8")).toBe(r.bytes);
    const entries = manifestMod.readManifest(repoRoot);
    expect(entries).toEqual([
      { lessonSlug: SLUG, variantKey: KEY, presentationRevisionId: r.presentationRevisionId, path: r.path, sha256: r.sha256, publishedAt: PUBLISHED_AT },
    ]);
    expect(manifestMod.verifyRetention({ repoRoot }).ok).toBe(true);
    const again = variantSource.generateAuthoredVariant({ slug: SLUG, variantKey: KEY, publishedAt: "2027-01-01T00:00:00.000Z", repoRoot, cfg });
    expect(again.fileWritten).toBe(false);
    expect(again.appended).toBe(false);
    expect(manifestMod.readManifest(repoRoot)).toHaveLength(1);
  });

  test("two clean repositories generate byte-identical artifacts and revision ids", () => {
    const r1 = variantSource.generateAuthoredVariant({ slug: SLUG, variantKey: KEY, publishedAt: PUBLISHED_AT, repoRoot, cfg });
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "lyfelabz-authored-variant-"));
    try {
      for (const rel of [`lesson-sources/lesson_${SLUG}.html`, VARIANT_REL, `platform/functions/src/scripts/assessments/${SLUG}.r1.json`]) {
        fs.mkdirSync(path.dirname(path.join(other, rel)), { recursive: true });
        fs.copyFileSync(path.join(repoRoot, rel), path.join(other, rel));
      }
      const r2 = variantSource.generateAuthoredVariant({ slug: SLUG, variantKey: KEY, publishedAt: PUBLISHED_AT, repoRoot: other, cfg });
      expect(r2.presentationRevisionId).toBe(r1.presentationRevisionId);
      expect(fs.readFileSync(path.join(other, r2.path))).toEqual(fs.readFileSync(path.join(repoRoot, r1.path)));
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  test("drift check passes only when the current build is retained", () => {
    const before = variantSource.checkAuthoredVariants({ repoRoot, configs: [cfg] });
    expect(before.ok).toBe(false);
    expect(before.failures[0]).toMatch(/not a retained manifest revision/);
    variantSource.generateAuthoredVariant({ slug: SLUG, variantKey: KEY, publishedAt: PUBLISHED_AT, repoRoot, cfg });
    expect(variantSource.checkAuthoredVariants({ repoRoot, configs: [cfg] })).toMatchObject({ ok: true, failures: [] });
  });

  test("drift: a variant-source edit that was never generated is caught", () => {
    variantSource.generateAuthoredVariant({ slug: SLUG, variantKey: KEY, publishedAt: PUBLISHED_AT, repoRoot, cfg });
    write(VARIANT_REL, edit(ADAPTED, "The fixture has three parts.", "The fixture has 3 parts."));
    const res = variantSource.checkAuthoredVariants({ repoRoot, configs: [cfg] });
    expect(res.ok).toBe(false);
    expect(res.failures[0]).toMatch(/not a retained manifest revision/);
  });

  test("drift: a canonical change to locked content fails the retained variant", () => {
    variantSource.generateAuthoredVariant({ slug: SLUG, variantKey: KEY, publishedAt: PUBLISHED_AT, repoRoot, cfg });
    write(`lesson-sources/lesson_${SLUG}.html`, edit(CANONICAL, "The Core Part</h3>", "The Center Part</h3>"));
    const res = variantSource.checkAuthoredVariants({ repoRoot, configs: [cfg] });
    expect(res.ok).toBe(false);
    expect(res.failures[0]).toMatch(/locked markup differs/);
  });

  test("drift: a declared variant whose source is missing fails", () => {
    fs.rmSync(path.join(repoRoot, VARIANT_REL));
    const res = variantSource.checkAuthoredVariants({ repoRoot, configs: [cfg] });
    expect(res.failures[0]).toMatch(/missing file/);
  });

  test("lessons without declared variants are skipped", () => {
    const { variants, ...plain } = cfg;
    expect(variantSource.checkAuthoredVariants({ repoRoot, configs: [plain] })).toEqual({ ok: true, checked: [], failures: [] });
  });
});

describe("authored variant - Earth's Layers canonical (in memory, no writes)", () => {
  const elBase = require("../lessons/earths-layers.cjs");
  const elCfg = {
    ...elBase,
    variants: {
      [KEY]: {
        source: `lesson-sources/variants/earths-layers.${KEY}.html`,
        adaptableSections: ["engage", "explore", "layers", "crust", "mantle-zone", "core", "explain"],
        adaptableSelectors: ["p", ".callout-body", ".bridge-callout"],
        lockedSelectors: [".edu-note", ".qr-card", ".crust-grid", ".wrapup-chips"],
      },
    },
  };
  const elSource = fs.readFileSync(path.join(paths.REPO_ROOT, elBase.canonicalSource), "utf8");
  const elPayloads = variantSource.loadAssessmentPayloads("earths-layers");
  const elBuild = (src) =>
    variantSource.buildVariantArtifact({
      cfg: elCfg, variantKey: KEY, canonicalSourceBytes: elSource, variantSourceBytes: src, assessmentPayloads: elPayloads,
    });

  test("the unadapted canonical source passes every gate and binds r1", () => {
    const r = elBuild(elSource);
    expect(r.assessmentRevisions).toEqual(["earths-layers.r1.json"]);
    expect(r.relocatedReferences.length).toBeGreaterThan(0);
  });

  test("a glossary term that matches a disclosure pattern stays usable; real disclosure does not", () => {
    const para = "<p>The crust is not one solid shell.";
    expect(() => elBuild(edit(elSource, para, "<p>Differentiation made the layers. The crust is not one solid shell."))).not.toThrow();
    expect(() => elBuild(edit(elSource, para, "<p>This simplified page explains it. The crust is not one solid shell."))).toThrow(/disclosure term/);
  });

  test("its relocated artifact satisfies the curated Hosting dependency validator; the unrelocated v2 would not", () => {
    const hosting = require("../../../../scripts/app-hosting/build.cjs");
    // listApprovedCopies: the manifest-declared inventory without requiring
    // the gitignored app/dist/bundle.js to have been built first, so this
    // test does not depend on another suite running `npm run build`.
    const destinations = hosting.listApprovedCopies(paths.REPO_ROOT).map((e) => e.destination);
    expect(destinations).toContain("app/dist/bundle.js");
    const r = elBuild(elSource);
    const canonicalV2 = fs.readFileSync(path.join(paths.REPO_ROOT, elBase.outputs.v2), "utf8");
    const probe = (bytes) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyfelabz-variant-hosting-"));
      try {
        for (const d of destinations) {
          fs.mkdirSync(path.dirname(path.join(dir, d)), { recursive: true });
          fs.writeFileSync(path.join(dir, d), "");
        }
        fs.mkdirSync(path.join(dir, "app/lessons/variants"), { recursive: true });
        fs.writeFileSync(path.join(dir, r.path), bytes);
        return hosting.validateHtmlDependencies(dir);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    };
    expect(probe(r.bytes).referencesValid).toBe(true);
    expect(() => probe(canonicalV2)).toThrow(/missing same-origin HTML dependencies/);
  });

  test("a prose-only probe edit passes; a quiz, vocabulary, or Brain Check edit is rejected", () => {
    const para = "<p>The crust is not one solid shell.";
    expect(() => elBuild(edit(elSource, para, "<p>The crust is not one piece."))).not.toThrow();
    expect(() => elBuild(elSource.replace("elQuizQuestions", "elQuizQuestionz"))).toThrow();
    // Brain Check (#recall) is not an adaptable section in this probe config.
    expect(() => elBuild(edit(elSource, "While Earth was molten, why did iron and nickel end up at the center?", "Why is iron at the center?"))).toThrow(/outside adaptable sections/);
    // An Educator Mode note inside an adaptable section is locked.
    expect(() => elBuild(edit(elSource, "Compare two crust types to reapply the density rule.", "Compare crusts."))).toThrow(/locked markup differs/);
    // The five wrap-up chain chips (R27) are locked even though they sit
    // inside an adaptable .bridge-callout; the other callouts stay adaptable.
    expect(() => elBuild(edit(elSource, '<span class="wuc wuc-2">Mantle flow moves the plates</span>', '<span class="wuc wuc-2">The mantle moves plates</span>'))).toThrow(/locked markup differs/);
    expect(() => elBuild(edit(elSource, "It still applies here.", "It works here too."))).not.toThrow();
    const def = "How much mass is packed into a given space.";
    expect(() => elBuild(edit(elSource, def, "How much mass fits in a space."))).toThrow(/outside adaptable sections/);
  });
});
