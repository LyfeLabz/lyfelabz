/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

const fs = require("fs");
const path = require("path");

const builder = require("../index.cjs");
const cfg = require("../lessons/earths-layers.cjs");
const paths = require("../paths.cjs");
const scanner = require("../markerScanner.cjs");
const equivalence = require("../equivalence.cjs");

const SOURCE_ABS = paths.resolveSource(cfg.canonicalSource);
const V1_ABS = paths.resolveOutput("v1", cfg.outputs.v1);
const V2_ABS = paths.resolveOutput("v2", cfg.outputs.v2);

describe("Earth's Layers pilot lesson build", () => {
  test("source contains exactly the declared marker registry", () => {
    const src = fs.readFileSync(SOURCE_ABS, "utf8");
    const { regions } = scanner.scan(src);
    const expected = new Set([
      ...cfg.requiredLabels.v1Only,
      ...cfg.requiredLabels.v2Only,
    ]);
    expect(regions.length).toBe(expected.size);
    for (const r of regions) expect(expected.has(r.label)).toBe(true);
  });

  test("in-memory build produces v1 and v2 that pass all checks", () => {
    const res = builder.buildLesson({ slug: "earths-layers", target: "v1", write: false });
    expect(res.bytes.length).toBeGreaterThan(0);
    const res2 = builder.buildLesson({ slug: "earths-layers", target: "v2", write: false });
    expect(res2.bytes.length).toBeGreaterThan(0);
  });

  test("committed v1 artifact matches a freshly built v1", () => {
    const built = builder.buildLesson({ slug: "earths-layers", target: "v1", write: false });
    const disk = fs.readFileSync(V1_ABS, "utf8");
    expect(disk).toBe(built.bytes);
  });

  test("committed v2 artifact matches a freshly built v2", () => {
    const built = builder.buildLesson({ slug: "earths-layers", target: "v2", write: false });
    const disk = fs.readFileSync(V2_ABS, "utf8");
    expect(disk).toBe(built.bytes);
  });

  test("v1 artifact contains every v1-required signature", () => {
    const v1 = fs.readFileSync(V1_ABS, "utf8");
    for (const sig of cfg.v1RequiredSignatures) expect(v1).toEqual(expect.stringContaining(sig));
  });

  test("v2 artifact contains no prohibited legacy signature", () => {
    const v2 = fs.readFileSync(V2_ABS, "utf8");
    for (const sig of cfg.v2ProhibitedSignatures) expect(v2).not.toEqual(expect.stringContaining(sig));
  });

  test("both artifacts contain every shared required signature", () => {
    const v1 = fs.readFileSync(V1_ABS, "utf8");
    const v2 = fs.readFileSync(V2_ABS, "utf8");
    for (const sig of cfg.sharedRequiredSignatures) {
      expect(v1).toEqual(expect.stringContaining(sig));
      expect(v2).toEqual(expect.stringContaining(sig));
    }
  });

  test("both artifacts begin with the correct generated notice", () => {
    const v1 = fs.readFileSync(V1_ABS, "utf8");
    const v2 = fs.readFileSync(V2_ABS, "utf8");
    expect(v1.startsWith("<!DOCTYPE html>\n" + cfg.generatedNotice.v1)).toBe(true);
    expect(v2.startsWith("<!DOCTYPE html>\n" + cfg.generatedNotice.v2)).toBe(true);
  });

  test("pilot contract minimums are satisfied by both artifacts", () => {
    const mins = cfg.pilotContractMinimums;
    const artifacts = {
      v1: fs.readFileSync(V1_ABS, "utf8"),
      v2: fs.readFileSync(V2_ABS, "utf8"),
    };
    for (const [target, bytes] of Object.entries(artifacts)) {
      const c = equivalence.buildContract(bytes, cfg.equivalenceExclusions);
      expect(c.vocabulary.length).toBeGreaterThanOrEqual(mins.vocabularyMin);
      expect(c.connections.cards.length).toBeGreaterThanOrEqual(mins.connectionsMin);
      expect(c.quiz.questions.length).toBe(mins.quizExactCount);
      expect(c.learningGoals.length).toBeGreaterThanOrEqual(mins.learningGoalsMin);
      expect(c.svgAccessibility.length).toBeGreaterThanOrEqual(mins.svgAccessibilityMin);
      expect(c.interactiveIds.length).toBeGreaterThanOrEqual(mins.interactiveIdsMin);
      for (const t of mins.requiredScrollTargets) {
        expect(c.scrollTargets).toContain(t);
      }
      for (const req of mins.requiredScrollDestinations) {
        const found = c.scrollDestinations.find(
          (d) => d.function === req.function && d.target === req.target,
        );
        expect(found).toBeTruthy();
      }
      expect(target).toMatch(/^v[12]$/);
    }
  });

  test("verifyLesson passes with committed artifacts", () => {
    const res = builder.verifyLesson({ slug: "earths-layers" });
    expect(res.ok).toBe(true);
    expect(res.v1.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(res.v2.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
