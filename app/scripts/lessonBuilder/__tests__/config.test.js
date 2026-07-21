/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

const scanner = require("../markerScanner.cjs");
const { validateConfigShape, validateScanAgainstConfig } = require("../config.cjs");

function baseConfig(overrides = {}) {
  return {
    slug: "test",
    canonicalSource: "lesson-sources/lesson_test.html",
    outputs: { v1: "lesson_test.html", v2: "app/lessons/lesson_test.html" },
    generatedNotice: { v1: "<!-- v1 -->\n", v2: "<!-- v2 -->\n" },
    requiredLabels: { v1Only: ["a"], v2Only: [] },
    expectedContexts: { a: "html" },
    v2ProhibitedSignatures: [],
    v1RequiredSignatures: [],
    sharedRequiredSignatures: [],
    ...overrides,
  };
}

const HEAD = "<!doctype html>\n<html><head>";
const TAIL = "</head><body></body></html>\n";
function html(inner) { return HEAD + inner + TAIL; }

describe("config validation", () => {
  test("valid config passes shape check", () => {
    expect(() => validateConfigShape(baseConfig(), "test")).not.toThrow();
  });

  test("mismatched slug fails", () => {
    expect(() => validateConfigShape(baseConfig({ slug: "other" }), "test")).toThrow();
  });

  test("expectedContexts must reference declared labels", () => {
    expect(() =>
      validateConfigShape(baseConfig({ expectedContexts: { a: "html", extra: "html" } }), "test"),
    ).toThrow(/not in requiredLabels/);
  });

  test("rejects unknown label found in source", () => {
    const cfg = baseConfig();
    const src = html("\n<!-- LYFELABZ:V1-ONLY:BEGIN unknown -->\n<!-- LYFELABZ:V1-ONLY:END unknown -->\n");
    const scan = scanner.scan(src);
    expect(() => validateScanAgainstConfig(cfg, scan)).toThrow(/undeclared marker label/);
  });

  test("rejects missing required label", () => {
    const cfg = baseConfig();
    const scan = { regions: [] };
    expect(() => validateScanAgainstConfig(cfg, scan)).toThrow(/required V1-ONLY label "a" missing/);
  });

  test("rejects wrong-context label", () => {
    const cfg = baseConfig();
    const src = html("<script>\n/* LYFELABZ:V1-ONLY:BEGIN a */\n/* LYFELABZ:V1-ONLY:END a */\n</script>");
    const scan = scanner.scan(src);
    expect(() => validateScanAgainstConfig(cfg, scan)).toThrow(/context but registry expects/);
  });

  test("rejects mismatched target vs registry", () => {
    const cfg = baseConfig();
    const src = html("\n<!-- LYFELABZ:V2-ONLY:BEGIN a -->\n<!-- LYFELABZ:V2-ONLY:END a -->\n");
    const scan = scanner.scan(src);
    expect(() => validateScanAgainstConfig(cfg, scan)).toThrow(/declared as V1-ONLY/);
  });
});
