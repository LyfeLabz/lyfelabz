/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

const identity = require("../variantIdentity.cjs");

describe("variant lessonSlug charset (M3)", () => {
  test("valid lowercase slug accepted", () => {
    expect(() => identity.assertValidLessonSlugForVariant("earthslayers")).not.toThrow();
  });

  test("valid hyphenated slug accepted", () => {
    expect(() => identity.assertValidLessonSlugForVariant("earths-layers")).not.toThrow();
  });

  test("underscore rejected", () => {
    expect(() => identity.assertValidLessonSlugForVariant("earths_layers")).toThrow(/lessonSlug/);
  });

  test("uppercase rejected (lowercase-only per M3)", () => {
    expect(() => identity.assertValidLessonSlugForVariant("Earths-Layers")).toThrow(/lessonSlug/);
  });

  test("unsafe/path-like input rejected", () => {
    expect(() => identity.assertValidLessonSlugForVariant("../../etc/passwd")).toThrow();
    expect(() => identity.assertValidLessonSlugForVariant("a/b")).toThrow();
    expect(() => identity.assertValidLessonSlugForVariant("a\\b")).toThrow();
  });

  test("empty string rejected", () => {
    expect(() => identity.assertValidLessonSlugForVariant("")).toThrow();
  });

  test("non-string rejected", () => {
    expect(() => identity.assertValidLessonSlugForVariant(null)).toThrow();
    expect(() => identity.assertValidLessonSlugForVariant(undefined)).toThrow();
    expect(() => identity.assertValidLessonSlugForVariant(42)).toThrow();
  });

  test("isValidLessonSlugForVariant mirrors the assertion without throwing", () => {
    expect(identity.isValidLessonSlugForVariant("earths-layers")).toBe(true);
    expect(identity.isValidLessonSlugForVariant("earths_layers")).toBe(false);
  });
});

describe("presentationRevisionId derivation (M2)", () => {
  test("full digest format: pr + 64 lowercase hex chars", () => {
    const id = identity.computePresentationRevisionId("<html>hello</html>");
    expect(id).toMatch(/^pr[0-9a-f]{64}$/);
    expect(id.length).toBe(66);
  });

  test("identical bytes produce identical IDs (T-D1)", () => {
    const bytes = "<html>same content</html>";
    const a = identity.computePresentationRevisionId(bytes);
    const b = identity.computePresentationRevisionId(bytes);
    expect(a).toBe(b);
  });

  test("different bytes produce different IDs (T-D2)", () => {
    const a = identity.computePresentationRevisionId("<html>version A</html>");
    const b = identity.computePresentationRevisionId("<html>version B</html>");
    expect(a).not.toBe(b);
  });

  test("identity is derived from bytes, not from a metadata object or source text (T-D3)", () => {
    // Passing something other than the exact served bytes must not silently
    // succeed with some coerced/normalized value - it must be rejected.
    expect(() => identity.computePresentationRevisionId({ lessonSlug: "x", variantKey: "reading-adapted" })).toThrow();
    expect(() => identity.computePresentationRevisionId(123)).toThrow();
    expect(() => identity.computePresentationRevisionId(undefined)).toThrow();
  });

  test("hashes a Buffer identically to the equivalent utf8 string", () => {
    const s = "<html>buffer parity</html>";
    const fromString = identity.computePresentationRevisionId(s);
    const fromBuffer = identity.computePresentationRevisionId(Buffer.from(s, "utf8"));
    expect(fromString).toBe(fromBuffer);
  });

  test("assertValidPresentationRevisionId accepts only the exact format", () => {
    const good = identity.computePresentationRevisionId("x");
    expect(() => identity.assertValidPresentationRevisionId(good)).not.toThrow();
    expect(() => identity.assertValidPresentationRevisionId("pr" + "a".repeat(63))).toThrow();
    expect(() => identity.assertValidPresentationRevisionId("PR" + "a".repeat(64))).toThrow();
    expect(() => identity.assertValidPresentationRevisionId(good.slice(0, 40))).toThrow();
  });
});

describe("opaque student-visible artifact path (M4, T-Q2)", () => {
  test("path formula contains only lessonSlug and the opaque revision id", () => {
    const id = identity.computePresentationRevisionId("<html>content</html>");
    const p = identity.variantRelativeOutputPath("earths-layers", id);
    expect(p).toBe(`app/lessons/variants/lesson_earths-layers__${id}.html`);
    expect(p).toMatch(/^app\/lessons\/variants\/lesson_[a-z0-9-]+__pr[0-9a-f]{64}\.html$/);
  });

  test("path never contains a variantKey or accommodation-category token", () => {
    const id = identity.computePresentationRevisionId("<html>content</html>");
    const p = identity.variantRelativeOutputPath("earths-layers", id);
    for (const forbidden of ["reading-adapted", "reading-", "variantKey", "accommodation", "iep", "504"]) {
      expect(p.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  test("path never contains a student identifier field name", () => {
    const id = identity.computePresentationRevisionId("<html>content</html>");
    const p = identity.variantRelativeOutputPath("earths-layers", id);
    expect(p).not.toMatch(/uid|studentid|classid|assignmentid/i);
  });

  test("rejects an invalid lessonSlug even with a valid revision id", () => {
    const id = identity.computePresentationRevisionId("x");
    expect(() => identity.variantRelativeOutputPath("Bad_Slug", id)).toThrow();
  });

  test("rejects a malformed revision id even with a valid lessonSlug", () => {
    expect(() => identity.variantRelativeOutputPath("earths-layers", "not-a-revision-id")).toThrow();
  });
});
