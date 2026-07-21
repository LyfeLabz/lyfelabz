/**
 * @jest-environment node
 *
 * Mutation tests. These prove the instructional-equivalence contract
 * really compares each field the audit called out. Each test starts
 * from the certified v1/v2 artifacts, applies a single targeted edit
 * to the v2 copy in memory, and asserts assertEquivalent throws with
 * a diff that names the mutated normalized field or array index.
 */
/* eslint-disable */
"use strict";

const fs = require("fs");

const paths = require("../paths.cjs");
const cfg = require("../lessons/earths-layers.cjs");
const equivalence = require("../equivalence.cjs");

const V1 = fs.readFileSync(paths.resolveOutput("v1", cfg.outputs.v1), "utf8");
const V2 = fs.readFileSync(paths.resolveOutput("v2", cfg.outputs.v2), "utf8");

function expectMismatch(mutated, pathFragment) {
  try {
    equivalence.assertEquivalent(V1, mutated, cfg.equivalenceExclusions);
  } catch (err) {
    expect(err.message).toContain("instructional contract mismatch");
    expect(err.message).toContain(pathFragment);
    return;
  }
  throw new Error(`expected assertEquivalent to throw for mutation targeting ${pathFragment}`);
}

function replaceOnce(src, needle, replacement) {
  const idx = src.indexOf(needle);
  if (idx === -1) throw new Error(`fixture needle not found: ${needle.slice(0, 60)}`);
  const idx2 = src.indexOf(needle, idx + needle.length);
  if (idx2 !== -1) throw new Error(`fixture needle not unique: ${needle.slice(0, 60)}`);
  return src.slice(0, idx) + replacement + src.slice(idx + needle.length);
}

describe("instructional-equivalence contract mutation tests", () => {
  test("baseline v1 vs v2 is equivalent", () => {
    const r = equivalence.assertEquivalent(V1, V2, cfg.equivalenceExclusions);
    expect(r.ok).toBe(true);
  });

  test("mutating one vocabulary term fails", () => {
    const mutated = replaceOnce(
      V2,
      '<span class="gc-term">Density</span>',
      '<span class="gc-term">Densityyy</span>',
    );
    expectMismatch(mutated, "vocabulary");
  });

  test("mutating one vocabulary definition fails", () => {
    const mutated = replaceOnce(
      V2,
      "How much mass is packed into a given space.",
      "How much MASS is packed into a given space.",
    );
    expectMismatch(mutated, "vocabulary");
  });

  test("reordering vocabulary fails", () => {
    // Swap card 0 (Density) and card 1 (Differentiation) heuristically
    // by relabeling terms in place at fixed positions. This changes the
    // order of the normalized array.
    const step1 = replaceOnce(
      V2,
      '<span class="gc-term">Density</span>',
      '<span class="gc-term">__TMP_A__</span>',
    );
    const step2 = replaceOnce(
      step1,
      'style="color: var(--gold);">Differentiation</span>',
      'style="color: var(--gold);">Density</span>',
    );
    const step3 = replaceOnce(
      step2,
      '<span class="gc-term">__TMP_A__</span>',
      '<span class="gc-term">Differentiation</span>',
    );
    expectMismatch(step3, "vocabulary");
  });

  test("mutating one Connections href fails", () => {
    const mutated = replaceOnce(
      V2,
      'href="lesson_plate-tectonics.html"',
      'href="lesson_plate-tectonics-XYZ.html"',
    );
    expectMismatch(mutated, "connections");
  });

  test("mutating one Connections label fails", () => {
    const mutated = replaceOnce(
      V2,
      ">Plate Tectonics</div>",
      ">Plate TectonicZ</div>",
    );
    expectMismatch(mutated, "connections");
  });

  test("reordering Connections fails", () => {
    const step1 = replaceOnce(
      V2,
      'aria-label="Plate Tectonics lesson"',
      'aria-label="__TMP_L__"',
    );
    const step2 = replaceOnce(
      step1,
      'aria-label="Earthquakes lesson"',
      'aria-label="Plate Tectonics lesson"',
    );
    const step3 = replaceOnce(
      step2,
      'aria-label="__TMP_L__"',
      'aria-label="Earthquakes lesson"',
    );
    expectMismatch(step3, "connections");
  });

  test("mutating the shared quiz-score-board scroll target fails", () => {
    const mutated = replaceOnce(
      V2,
      "var sb = document.getElementById('el-score');",
      "var sb = document.getElementById('el-score-2');",
    );
    expectMismatch(mutated, "scroll");
  });

  test("mutating the perfect-score Continue destination fails", () => {
    const mutated = replaceOnce(
      V2,
      "var more = document.getElementById('continue');",
      "var more = document.getElementById('continue-2');",
    );
    expectMismatch(mutated, "scroll");
  });
});
