/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * Sprint 28 W2 (Phase 3) hardened-results contract, expanded by Phase 5A.
 *
 * Deterministic enforcement of the O2 (results scroll offset, focus, and
 * accessible announcement) and O3 (assignment-context "Back to My Assignments"
 * return control) migration standard for every v2 assessment lesson. It is
 * data-driven over W2_V2_LESSONS, so the Phase 5A curriculum migration is
 * guarded by the same contract as the four original Category A lessons.
 *
 * Each lesson declares its local prefix (the score board id is
 * `<prefix>-score`; the assignment-context var is `<prefix>Assigned`; the
 * return-control var is `<prefix>ReturnCtl`). Everything else the contract
 * asserts (the `.score-board` / `.return-assignments` classes, the
 * `back-to-assignments` id, the `sb` receiver, and the standalone copy) is
 * prefix-independent.
 *
 * The build itself (builder.buildLesson) runs the marker scanner, config
 * validation, signature checks, and the instructional-equivalence contract;
 * a slug that fails any of those throws here before a single assertion runs.
 *
 * Physical behavior (true viewport landing below the sticky chrome, real
 * smooth-scroll and reduced-motion behavior, live screen-reader announcement,
 * and the actual /app/ navigation) is deliberately NOT faked here; it belongs
 * to Phase 7 browser certification.
 */

const builder = require("../index.cjs");

// Every v2 assignment-aware lesson and its local prefix. Category A (the four
// Sprint 18/Phase 3 lessons) plus the Phase 5A Category B migration and the
// Phase 5A.1 nature-of-waves unblock. nature-of-waves was the sole Phase 5A
// deferral (its quiz diagrams embedded HTML comments inside a <script>
// template literal); Phase 5A.1 removed only those safe authoring-only
// comments from the canonical source, so it now satisfies the identical
// contract as every other lesson.
const W2_V2_LESSONS = [
  { slug: "earths-layers", prefix: "el" },
  { slug: "plate-tectonics", prefix: "el" },
  { slug: "water-cycle", prefix: "el" },
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
  { slug: "conducting-experiments", prefix: "ce" },
  { slug: "engineering-design", prefix: "ed" },
  { slug: "choosing-materials", prefix: "cm" },
  { slug: "designing-to-scale", prefix: "cm" },
  { slug: "types-of-volcanoes", prefix: "vc" },
  { slug: "hotspot-volcanoes", prefix: "el" },
  { slug: "weathering-and-erosion", prefix: "el" },
  { slug: "renewable-and-nonrenewable-resources", prefix: "el" },
  { slug: "parts-of-an-ecosystem", prefix: "el" },
  { slug: "photosynthesis", prefix: "el" },
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
];

// The standalone (non-assignment) v2 completion copy. Used as an ordering
// landmark: the O3 reveal must sit in the assignment branch, which precedes
// this standalone-path message in <prefix>SubmitQuiz.
const STANDALONE_MSG = "Exploration mode. Your work is not saved.";

function build(slug, target) {
  return builder.buildLesson({ slug, target, write: false }).bytes;
}

describe.each(W2_V2_LESSONS)("W2 hardened-results contract: $slug", ({ slug, prefix }) => {
  let v1;
  let v2;

  beforeAll(() => {
    // Building both targets implicitly asserts marker validity, declared
    // labels/contexts, required/prohibited signatures, and the
    // instructional-equivalence contract for this slug.
    v1 = build(slug, "v1");
    v2 = build(slug, "v2");
  });

  test("build produces non-empty v1 and v2 (equivalence + signatures pass)", () => {
    expect(v1.length).toBeGreaterThan(0);
    expect(v2.length).toBeGreaterThan(0);
  });

  test("no build-time markers leak into either generated artifact", () => {
    expect(v1.includes("LYFELABZ:")).toBe(false);
    expect(v2.includes("LYFELABZ:")).toBe(false);
  });

  // ---- O2: results region focus + accessible-announcement semantics ----

  test("O2: v2 results region carries tabindex, role=status, aria-live=polite", () => {
    expect(v2).toContain(
      `<div class="score-board" id="${prefix}-score" tabindex="-1" role="status" aria-live="polite">`,
    );
  });

  test("O2: v2 results region can receive programmatic focus without an outline", () => {
    expect(v2).toContain(".score-board:focus { outline: none; }");
  });

  test("O2: v2 carries a breakpoint-aware scroll offset tied to the sticky chrome", () => {
    expect(v2).toContain(".score-board { scroll-margin-top: 120px; }");
    expect(v2).toContain(
      "@media (max-width: 600px) { .score-board { scroll-margin-top: 104px; } }",
    );
  });

  test("O2: submit moves focus to the results with preventScroll, after the scroll", () => {
    expect(v2).toContain("sb.focus({ preventScroll: true })");
    const scrollAt = v2.indexOf(
      "sb.scrollIntoView({ behavior: 'smooth', block: 'start' });",
    );
    const focusAt = v2.indexOf("sb.focus({ preventScroll: true })");
    expect(scrollAt).toBeGreaterThan(-1);
    expect(focusAt).toBeGreaterThan(scrollAt);
  });

  // ---- O3: assignment-context "Back to My Assignments" return control ----

  test("O3: v2 exposes the return control pointing at /app/ with the approved label", () => {
    expect(v2).toContain(
      '<a class="return-assignments" id="back-to-assignments" href="/app/">Back to My Assignments</a>',
    );
  });

  test("O3: the return control is hidden by default (revealed only on assignment submit)", () => {
    expect(v2).toContain(".return-assignments { display: none; }");
    // Static markup must not pre-apply the reveal class.
    expect(v2).not.toContain('class="return-assignments show"');
  });

  test("O3: the reveal is gated inside the assignment-context branch of the submit fn", () => {
    const assignedAt = v2.indexOf(`if (${prefix}Assigned) {`);
    const revealAt = v2.indexOf(`${prefix}ReturnCtl.classList.add('show')`);
    const standaloneAt = v2.indexOf(STANDALONE_MSG);
    expect(assignedAt).toBeGreaterThan(-1);
    expect(revealAt).toBeGreaterThan(assignedAt);
    // The standalone (non-assignment) completion message comes after the
    // assignment branch, so the single reveal must precede it.
    expect(standaloneAt).toBeGreaterThan(revealAt);
    // Exactly one reveal, so no non-assignment path can surface the control.
    expect(v2.split(`${prefix}ReturnCtl.classList.add('show')`).length - 1).toBe(1);
  });

  // ---- v1 preservation / non-assignment negative ----

  test("v1 never acquires the O3 return control", () => {
    expect(v1).not.toContain("back-to-assignments");
    expect(v1).not.toContain("return-assignments");
    expect(v1).not.toContain("Back to My Assignments");
  });

  test("v1 never acquires the O2 focus / offset / announcement additions", () => {
    expect(v1).not.toContain("scroll-margin-top: 120px");
    expect(v1).not.toContain("sb.focus({ preventScroll: true })");
    expect(v1).not.toContain(`id="${prefix}-score" tabindex="-1"`);
    // The v1 results region remains the plain, untouched score board.
    expect(v1).toContain(`<div class="score-board" id="${prefix}-score">`);
  });
});
