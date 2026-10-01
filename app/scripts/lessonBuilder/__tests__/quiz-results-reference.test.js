/**
 * @jest-environment jsdom
 */
/* eslint-disable */
"use strict";

/*
 * Quiz Results Polish - reference implementation contract.
 *
 * The rollout template for two confirmed quiz-results defects, proven first
 * on one ordinary lesson (photosynthesis) before any mechanical rollout:
 *
 * 1. Post-submit landing. The sticky quiz-progress tray was pinned at a fixed
 *    `top: 64px` (52px on phones via #mobile-canonical) and the results board
 *    used fixed scroll offsets (v2: 120px/104px; v1: none), while the real
 *    sticky nav wraps to about 74px (Chromebook) and 118-122px (tablet,
 *    phone). The tray hid behind the nav and the score landed under it. The
 *    fix publishes the MEASURED nav and tray heights (--quiz-nav-h,
 *    --quiz-progress-h) from #quiz-chrome-offsets-js and derives the tray
 *    `top` and the `.score-board` scroll-margin-top from them, in a
 *    #quiz-chrome-offsets style block placed after the untouched
 *    #mobile-canonical block.
 *
 * 2. Refused submission. The lesson renders the locally calculated score
 *    before finalize settles. When finalize resolves `ok:false`, resolves
 *    null / an invalid result, or rejects, the board now reads
 *    "Score not recorded" with the reason directly beneath it. Success is
 *    unchanged. Scoring, the finalize payload, and fail-closed runtime
 *    behavior are not touched.
 *
 * jsdom has no layout engine: the true viewport landing at 1280/820/375px is
 * certified in a real browser. These tests pin the wiring and run the
 * lesson's REAL built quiz script against its REAL built markup with a
 * stubbed window.lyfelabz.lessonQuiz adapter.
 *
 * The ordinary-lesson rollout applied the same transformation to 45 more
 * lessons, and the special-case completion added Water Cycle (revision
 * workflow), Earth's Layers and Conducting Experiments (differentiation
 * variant workflow), so the list below is the full contract (49 lessons,
 * every configured lesson). Each is also marked `offset: "measured"` in
 * w2-results-contract.test.js.
 *
 * Conducting Experiments was the measured-landing pilot and keeps its own
 * certified geometry (`--ce-nav-h` / `--ce-progress-h`, in its main style
 * block and an unnamed script), so it is declared `geometry: "ce"`. Only the
 * mechanism differs; the required behavior is asserted identically.
 *
 * The special-case lessons are also delivered through committed artifacts
 * that are not a v1/v2 build: the Water Cycle and Earth's Layers assessment
 * revision renditions, and the retained reading-adapted variant revisions
 * that carry this behavior. SPECIAL_CASE_ARTIFACTS runs the same result
 * contract against those exact committed bytes.
 */

const fs = require("fs");
const path = require("path");
const builder = require("../index.cjs");

const REPO_ROOT = path.resolve(__dirname, "../../../..");

// Photosynthesis (the certified reference) first, then the 45 ordinary
// lessons, then the three special cases.
const QUIZ_RESULTS_REFERENCE_LESSONS = [
  { slug: "photosynthesis", prefix: "el" },
  { slug: "plate-tectonics", prefix: "el" },
  { slug: "earthquakes", prefix: "el" },
  { slug: "what-is-life", prefix: "wl" },
  { slug: "cell-types", prefix: "ct" },
  { slug: "organelles", prefix: "og" },
  { slug: "body-systems", prefix: "bs" },
  { slug: "biological-evolution", prefix: "be" },
  { slug: "layers-of-time", prefix: "lt" },
  { slug: "continental-drift", prefix: "cd" },
  { slug: "gravity", prefix: "grav" },
  { slug: "sun-earth-moon", prefix: "sem" },
  { slug: "phases-of-the-moon", prefix: "pm" },
  { slug: "eclipses", prefix: "ec" },
  { slug: "earths-place-in-the-universe", prefix: "epu" },
  { slug: "measuring-matter", prefix: "mm" },
  { slug: "physical-properties", prefix: "pp" },
  { slug: "pure-substances-and-mixtures", prefix: "psm" },
  { slug: "chemical-reactions", prefix: "cr" },
  { slug: "nature-of-waves", prefix: "nw" },
  { slug: "wave-behavior", prefix: "wb" },
  { slug: "digital-signals", prefix: "ds" },
  { slug: "engineering-design", prefix: "ed" },
  { slug: "choosing-materials", prefix: "cm" },
  { slug: "designing-to-scale", prefix: "cm" },
  { slug: "types-of-volcanoes", prefix: "vc" },
  { slug: "hotspot-volcanoes", prefix: "el" },
  { slug: "weathering-and-erosion", prefix: "el" },
  { slug: "renewable-and-nonrenewable-resources", prefix: "el" },
  { slug: "parts-of-an-ecosystem", prefix: "el" },
  { slug: "energy-flow", prefix: "el" },
  { slug: "carbon-cycle", prefix: "el" },
  { slug: "ecosystem-stability", prefix: "el" },
  { slug: "reproductive-success", prefix: "rs" },
  { slug: "human-impacts", prefix: "el" },
  { slug: "forms-of-energy", prefix: "fe" },
  { slug: "energy-transfer", prefix: "et" },
  { slug: "heat-transfer", prefix: "ht" },
  { slug: "introduction-to-electricity", prefix: "el" },
  { slug: "design-tradeoffs", prefix: "el" },
  { slug: "structural-systems", prefix: "el" },
  { slug: "transportation-systems", prefix: "el" },
  { slug: "communication-systems", prefix: "el" },
  { slug: "engineering-systems", prefix: "el" },
  { slug: "technology-and-society", prefix: "el" },
  { slug: "innovation-and-sustainability", prefix: "el" },
  { slug: "water-cycle", prefix: "el" },
  { slug: "earths-layers", prefix: "el" },
  { slug: "conducting-experiments", prefix: "ce", geometry: "ce" },
];

// The rollout never edits #mobile-canonical, so every lesson's copy must stay
// byte-identical to this lesson's copy of the repository-wide canonical block.
const CANONICAL_BLOCK_SOURCE_SLUG = "earths-layers";

// Committed delivery artifacts outside the v1/v2 builds. The three variant
// revisions are the retained reading-adapted presentations generated for this
// behavior (Earth's Layers r2 and r1, Conducting Experiments r1); the older
// retained variant revisions stay byte-frozen and are deliberately not listed.
const SPECIAL_CASE_ARTIFACTS = [
  { file: "app/lessons/assessment-revisions/lesson_water-cycle__r1.html", prefix: "el", geometry: "quiz" },
  { file: "app/lessons/assessment-revisions/lesson_water-cycle__r2.html", prefix: "el", geometry: "quiz" },
  { file: "app/lessons/assessment-revisions/lesson_earths-layers__r1.html", prefix: "el", geometry: "quiz" },
  { file: "app/lessons/assessment-revisions/lesson_earths-layers__r2.html", prefix: "el", geometry: "quiz" },
  {
    file: "app/lessons/variants/lesson_earths-layers__pr8996a455b762c209c8a74c20954521cd93313df920923292aa334161560f6e11.html",
    prefix: "el",
    geometry: "quiz",
  },
  {
    file: "app/lessons/variants/lesson_earths-layers__pr7718b6fb29e40df7a338ea6896071229f232b884e9301f01c223181051071667.html",
    prefix: "el",
    geometry: "quiz",
  },
  {
    file: "app/lessons/variants/lesson_conducting-experiments__pr7715ff14a5d647f518fffe2f8af8de8cfd843a2739a3a32172a14d5363465e5e.html",
    prefix: "ce",
    geometry: "ce",
  },
];

// The measured-geometry mechanism: the lesson-neutral --quiz-* block and named
// script, or the Conducting Experiments pilot's --ce-* rule and script.
function geometryVars(geometry) {
  return geometry === "ce" ? "ce" : "quiz";
}

function measuredLandingRule(geometry) {
  const v = geometryVars(geometry);
  return `scroll-margin-top: calc(var(--${v}-nav-h, 64px) + var(--${v}-progress-h, 56px) + 1rem);`;
}

// The CSS that carries the measured dock and landing: the #quiz-chrome-offsets
// block, or (pilot) the lesson CSS that follows #mobile-canonical.
function geometryCss(html, geometry) {
  if (geometry !== "ce") return blockById(html, "style", "quiz-chrome-offsets");
  const at = html.indexOf(".quiz-progress-sticky {\n  position: sticky;\n  top: var(--ce-nav-h, 64px);");
  return at < 0 ? null : html.slice(at, html.indexOf("</style>", at));
}

// The script that publishes the measured heights.
function geometryScript(html, geometry) {
  if (geometry !== "ce") return scriptBody(html, "quiz-chrome-offsets-js");
  const at = html.indexOf("root.style.setProperty('--ce-nav-h', nav.offsetHeight + 'px');");
  expect(at).toBeGreaterThan(-1);
  const open = html.lastIndexOf("<script>", at) + "<script>".length;
  return html.slice(open, html.indexOf("</script>", at));
}

const NOT_RECORDED = "Score not recorded";

function build(slug, target) {
  return builder.buildLesson({ slug, target, write: false }).bytes;
}

function blockById(html, tag, id) {
  const open = html.indexOf(`<${tag} id="${id}">`);
  if (open < 0) return null;
  const close = html.indexOf(`</${tag}>`, open);
  return html.slice(open, close + tag.length + 3);
}

function scriptBody(html, id) {
  const block = blockById(html, "script", id);
  expect(block).not.toBeNull();
  return block.slice(block.indexOf(">") + 1, block.lastIndexOf("</script>"));
}

function bodyMarkup(html) {
  const open = html.indexOf("<body>");
  const close = html.lastIndexOf("</body>");
  return html.slice(open + "<body>".length, close);
}

// The complete inline <script> element that defines <prefix>SubmitQuiz. Some
// lessons declare their questions before the quiz state, and some use const,
// so the whole real script is executed rather than a slice of it.
function quizScript(html, prefix) {
  const at = html.indexOf(`function ${prefix}SubmitQuiz(`);
  expect(at).toBeGreaterThan(-1);
  const open = html.lastIndexOf("<script>", at) + "<script>".length;
  return html.slice(open, html.indexOf("</script>", at));
}

function cssVar(name) {
  return document.documentElement.style.getPropertyValue(name);
}

test("the contract covers every configured lesson exactly once", () => {
  const { listConfiguredSlugs } = require("../config.cjs");
  const covered = QUIZ_RESULTS_REFERENCE_LESSONS.map((l) => l.slug);
  expect(new Set(covered).size).toBe(covered.length);
  expect([...covered].sort()).toEqual([...listConfiguredSlugs()].sort());
});

describe.each(QUIZ_RESULTS_REFERENCE_LESSONS)("quiz results reference: $slug", ({ slug, prefix, geometry = "quiz" }) => {
  describe.each(["v1", "v2"])("A. measured post-submit geometry (%s)", (target) => {
    geometryContract(() => build(slug, target), prefix, geometry, target);
  });

  describe("B-D. submission result presentation (v2, assignment context)", () => {
    resultContract(() => build(slug, "v2"), prefix);
  });
});

describe.each(SPECIAL_CASE_ARTIFACTS)("quiz results special-case artifact: $file", ({ file, prefix, geometry }) => {
  const read = () => fs.readFileSync(path.join(REPO_ROOT, file), "utf8");

  describe("A. measured post-submit geometry", () => {
    geometryContract(read, prefix, geometry, "v2");
  });

  describe("B-D. submission result presentation (assignment context)", () => {
    resultContract(read, prefix);
  });
});

function geometryContract(getHtml, P, geometry, target) {
  const vars = geometryVars(geometry);
  const navVar = `--${vars}-nav-h`;
  const progressVar = `--${vars}-progress-h`;
  let html;
  beforeAll(() => {
    html = getHtml();
  });
  afterEach(() => {
    delete window.ResizeObserver;
    document.documentElement.removeAttribute("style");
    document.body.innerHTML = "";
  });

  test("no fixed nav-height assumption remains for the tray or the landing", () => {
    expect(html).not.toMatch(/\.quiz-progress-sticky \{\s*position: sticky;\s*top: 64px;/);
    expect(html).not.toContain("scroll-margin-top: 120px");
    expect(html).not.toContain("scroll-margin-top: 104px");
  });

  test("the tray docks under the MEASURED nav, with padding on every side", () => {
    const css = geometryCss(html, geometry);
    expect(css).not.toBeNull();
    // The no-JS fallback keeps the lesson's own former fixed top (60px or 64px).
    expect(css).toMatch(new RegExp(`\\.quiz-progress-sticky \\{\\n  position: sticky;\\n  top: var\\(${navVar}, (?:60|64)px\\);`));
    expect(css).toContain("padding: 0.6rem 1.1rem;");
    if (geometry === "quiz") {
      // Phone keeps the canonical 52px only as the no-JS fallback.
      expect(css).toMatch(/@media \(max-width: 600px\) \{\s*\.quiz-progress-sticky \{ top: var\(--quiz-nav-h, 52px\); \}/);
    }
  });

  test("the results board lands below the measured nav + tray with breathing room", () => {
    const css = geometryCss(html, geometry);
    expect(css).toContain(measuredLandingRule(geometry));
    // The landing still uses the existing offset-aware scrollIntoView.
    expect(html).toContain("sb.scrollIntoView({ behavior: 'smooth', block: 'start' });");
  });

  test("the geometry block follows an UNCHANGED #mobile-canonical, so it wins the cascade", () => {
    const canonical = blockById(html, "style", "mobile-canonical");
    const reference = blockById(build(CANONICAL_BLOCK_SOURCE_SLUG, target), "style", "mobile-canonical");
    expect(canonical).not.toBeNull();
    expect(canonical).toBe(reference);
    // The canonical menu-open rule still lifts the tray out of flow.
    expect(canonical).toContain("body:has(nav.menu-open) .quiz-progress-sticky { position: static; }");
    const geometryAt =
      geometry === "quiz"
        ? html.indexOf('<style id="quiz-chrome-offsets">')
        : html.indexOf(`top: var(${navVar}, 64px);`);
    expect(geometryAt).toBeGreaterThan(html.indexOf('<style id="mobile-canonical">'));
  });

  test("the submission status sits directly under the score message", () => {
    const board = html.slice(html.indexOf(`id="${P}-score"`));
    const msg = board.indexOf(`<p id="${P}-score-msg"></p>`);
    const status = board.indexOf(`<div id="${P}-submit-status"></div>`);
    expect(msg).toBeGreaterThan(-1);
    expect(status).toBeGreaterThan(msg);
    // Nothing but whitespace or a comment separates the message and status.
    const between = board.slice(msg + `<p id="${P}-score-msg"></p>`.length, status);
    expect(between.replace(/<!--[\s\S]*?-->/g, "").trim()).toBe("");
    // Lessons with a Mystery box keep it below the status.
    const mystery = board.indexOf('<div class="mystery-loop">');
    if (mystery > -1 && mystery < board.indexOf("</button>")) expect(mystery).toBeGreaterThan(status);
    expect(html.split(`id="${P}-submit-status"`).length - 1).toBe(1);
  });

  // Desktop (Chromebook), tablet, and phone nav heights measured in a real
  // browser for this lesson family. The script must follow each wrap.
  test.each([
    ["desktop", 74],
    ["tablet", 122],
    ["phone", 118],
  ])("the script publishes the measured %s nav (%ipx) and follows a wrap", (_label, navHeight) => {
    document.body.innerHTML = '<nav></nav><div class="quiz-progress-sticky"></div>';
    const nav = document.querySelector("nav");
    const tray = document.querySelector(".quiz-progress-sticky");
    const heights = new Map([[nav, 64], [tray, 46]]);
    for (const el of [nav, tray]) {
      Object.defineProperty(el, "offsetHeight", { configurable: true, get: () => heights.get(el) });
    }
    let onResize = null;
    const observed = [];
    window.ResizeObserver = class {
      constructor(cb) { onResize = cb; }
      observe(el) { observed.push(el); }
    };
    new Function(geometryScript(html, geometry))();
    expect(cssVar(navVar)).toBe("64px");
    expect(cssVar(progressVar)).toBe("46px");
    expect(observed).toEqual([nav, tray]);

    heights.set(nav, navHeight);
    heights.set(tray, 49);
    onResize([]);
    expect(cssVar(navVar)).toBe(`${navHeight}px`);
    expect(cssVar(progressVar)).toBe("49px");
  });

  test("the script falls back to window resize without ResizeObserver", () => {
    document.body.innerHTML = '<nav></nav><div class="quiz-progress-sticky"></div>';
    const nav = document.querySelector("nav");
    let h = 74;
    Object.defineProperty(nav, "offsetHeight", { configurable: true, get: () => h });
    new Function(geometryScript(html, geometry))();
    expect(cssVar(navVar)).toBe("74px");
    h = 122;
    window.dispatchEvent(new Event("resize"));
    expect(cssVar(navVar)).toBe("122px");
  });

  test("the script is inert when the sticky chrome is absent", () => {
    document.body.innerHTML = "<main></main>";
    expect(() => new Function(geometryScript(html, geometry))()).not.toThrow();
    expect(cssVar(navVar)).toBe("");
  });
}

function resultContract(getHtml, P) {
  let html;
  let scrolled;
  let finalizeCalls;

  beforeAll(() => {
    html = getHtml();
  });

  function mount(finalizeImpl) {
    scrolled = [];
    finalizeCalls = [];
    Element.prototype.scrollIntoView = function () {
      scrolled.push(this.id || this.className);
    };
    document.body.innerHTML = bodyMarkup(html);
    window.lyfelabz = {
      lessonQuiz: {
        hasAssignmentContext: () => true,
        autosave: async () => null,
        finalize: (selected, options) => {
          finalizeCalls.push({ selected: [...selected], options });
          return finalizeImpl();
        },
      },
    };
    new Function(
      quizScript(html, P) +
        `\nwindow.__q={select:${P}SelectAnswer,submit:${P}SubmitQuiz,reset:${P}ResetQuiz,state:${P}QuizState,questions:${P}QuizQuestions};`,
    )();
  }

  // The lesson's own More Learning target for the perfect-score jump
  // (`continue` in most lessons, `go-further-anchor` in a few).
  function moreTarget() {
    const m = new RegExp(`${P}QuizState\\.continueTimer = setTimeout\\([\\s\\S]*?getElementById\\('([^']+)'\\)`).exec(html);
    expect(m).not.toBeNull();
    expect(["continue", "go-further-anchor"]).toContain(m[1]);
    expect(document.getElementById(m[1])).not.toBeNull();
    return m[1];
  }

  // Answers `correctCount` questions correctly (the first N), the rest wrong.
  function answerAndSubmit(correctCount) {
    const q = window.__q;
    q.questions.forEach((item, qi) => {
      q.select(qi, qi < correctCount ? item.correct : (item.correct + 1) % item.options.length);
    });
    document.getElementById(`${P}-thinking`).value = "Plants build glucose from carbon dioxide and water using light.";
    q.submit();
    return q.questions.length;
  }

  async function settle() {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  }

  const el = (id) => document.getElementById(id);

  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    delete window.lyfelabz;
    delete window.__q;
    document.body.innerHTML = "";
  });

  function expectFinalizePayload(total) {
    // D. The scored payload is exactly the index selections plus the written
    // response, sent once: no retry, no alteration.
    expect(finalizeCalls).toHaveLength(1);
    expect(finalizeCalls[0].selected).toHaveLength(total);
    expect(finalizeCalls[0].selected).toEqual(window.__q.state.selected);
    expect(finalizeCalls[0].options).toEqual({
      writtenResponse: "Plants build glucose from carbon dioxide and water using light.",
    });
  }

  test("B. successful finalize keeps the normal score, message, and confirmation", async () => {
    mount(async () => ({ ok: true, result: { attemptId: "a1" } }));
    const total = answerAndSubmit(7);
    // Local scoring is unchanged while the submission is in flight.
    expect(el(`${P}-score-num`).textContent).toBe(`7/${total}`);
    expect(el(`${P}-submit-status`).textContent).toContain("Submitting...");
    const localMessage = el(`${P}-score-msg`).textContent;
    expect(localMessage.length).toBeGreaterThan(0);
    await settle();
    expect(el(`${P}-score-num`).textContent).toBe(`7/${total}`);
    expect(el(`${P}-score-msg`).textContent).toBe(localMessage);
    expect(el(`${P}-submit-status`).textContent).toContain("Submitted to your teacher");
    expect(el(`${P}-score`).classList.contains("show")).toBe(true);
    expect(el(`${P}-score`).classList.contains("score-not-recorded")).toBe(false);
    expect(el("back-to-assignments").classList.contains("show")).toBe(true);
    expect(el(`${P}-think-model`).classList.contains("show")).toBe(true);
    expect(el(`${P}-thinking`).disabled).toBe(true);
    expect(scrolled).toEqual([`${P}-score`]);
    expectFinalizePayload(total);
  });

  test("B. a perfect successful submission still moves on to More Learning", async () => {
    mount(async () => ({ ok: true, result: { attemptId: "a1" } }));
    const total = answerAndSubmit(Infinity);
    await settle();
    expect(el(`${P}-score-num`).textContent).toBe(`${total}/${total}`);
    jest.advanceTimersByTime(1900);
    expect(scrolled).toEqual([`${P}-score`, moreTarget()]);
    expect(window.__q.state.continueTimer).toBeNull();
  });

  const FAILURES = [
    ["finalize resolves ok:false", () => Promise.resolve({ ok: false, message: "This assignment needs to be opened again, so your answers were not submitted.", recoverable: false }), "This assignment needs to be opened again"],
    ["finalize resolves null", () => Promise.resolve(null), "Submission did not complete"],
    ["finalize resolves an invalid result", () => Promise.resolve({}), "Submission did not complete"],
    ["finalize rejects", () => Promise.reject(new Error("network")), "Submission did not complete"],
  ];

  test.each(FAILURES)("C. %s: 'Score not recorded' leads, with the reason beneath it", async (_label, impl, reason) => {
    mount(impl);
    const total = answerAndSubmit(3);
    await settle();
    const board = el(`${P}-score`);
    const status = el(`${P}-submit-status`);
    // The prominent result says nothing was recorded (text, not color).
    expect(board.classList.contains("score-not-recorded")).toBe(true);
    expect(el(`${P}-score-num`).textContent).toBe(NOT_RECORDED);
    // The locally calculated score is not presented as a result, and no
    // zero is claimed.
    expect(board.textContent).not.toContain(`3/${total}`);
    expect(board.textContent).not.toMatch(/\b0\/\d+/);
    expect(el(`${P}-score-msg`).textContent).toContain("Your teacher did not receive this attempt.");
    // The explanatory reason is kept and sits directly under the headline
    // area, inside the results region.
    expect(status.textContent).toContain("Could not submit:");
    expect(status.textContent).toContain(reason);
    expect(board.contains(status)).toBe(true);
    expect(status.previousElementSibling.id).toBe(`${P}-score-msg`);
    // No successful-attempt UI.
    expect(board.textContent).not.toContain("Submitted to your teacher");
    expect(status.querySelector(".score-submitted")).toBeNull();
    // Per-question feedback and Show Your Thinking are untouched.
    expect(document.querySelectorAll(".option-feedback.correct-fb, .option-feedback.incorrect-fb")).toHaveLength(total);
    expect(el(`${P}-think-model`).classList.contains("show")).toBe(true);
    expect(el(`${P}-thinking`).disabled).toBe(true);
    // The recovery route back to My Assignments stays available.
    expect(el("back-to-assignments").classList.contains("show")).toBe(true);
    expectFinalizePayload(total);
    jest.advanceTimersByTime(5000);
    expect(finalizeCalls).toHaveLength(1);
  });

  test("C. a refused perfect submission cancels the pending jump to More", async () => {
    mount(() => Promise.resolve({ ok: false, message: "Refused.", recoverable: false }));
    answerAndSubmit(Infinity);
    await settle();
    jest.advanceTimersByTime(5000);
    expect(el(`${P}-score-num`).textContent).toBe(NOT_RECORDED);
    expect(scrolled).toEqual([`${P}-score`]);
  });

  test("C. a refusal that arrives after the jump to More brings the result back", async () => {
    let reject;
    mount(() => new Promise((_resolve, rej) => { reject = rej; }));
    answerAndSubmit(Infinity);
    jest.advanceTimersByTime(1900);
    const more = moreTarget();
    expect(scrolled).toEqual([`${P}-score`, more]);
    reject(new Error("late"));
    await settle();
    expect(el(`${P}-score-num`).textContent).toBe(NOT_RECORDED);
    expect(scrolled).toEqual([`${P}-score`, more, `${P}-score`]);
  });

  test("C. Try Again clears the not-recorded state", async () => {
    mount(() => Promise.resolve(null));
    answerAndSubmit(3);
    await settle();
    window.__q.reset();
    expect(el(`${P}-score`).classList.contains("score-not-recorded")).toBe(false);
    expect(el(`${P}-score`).classList.contains("show")).toBe(false);
    expect(el(`${P}-submit-status`).innerHTML).toBe("");
  });
}
