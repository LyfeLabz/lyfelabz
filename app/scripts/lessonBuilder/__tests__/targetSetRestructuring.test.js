/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * Canonical byte lock (T-D5, differentiation F5.2 Slice 2).
 *
 * The P4-3 target-set restructuring of paths.cjs/index.cjs must not
 * change a single byte of any configured lesson's committed v1/v2
 * artifacts. verifyLesson() rebuilds every configured lesson in memory
 * through the restructured pipeline and compares it to the committed
 * artifact; this test runs that check across every configured lesson,
 * not just the Earth's Layers pilot already covered elsewhere.
 */

const builder = require("../index.cjs");
const paths = require("../paths.cjs");

describe("target-set restructuring preserves canonical byte-identical output (T-D5)", () => {
  test("paths.CANONICAL_TARGET_IDS is exactly [v1, v2] today", () => {
    expect(paths.CANONICAL_TARGET_IDS).toEqual(["v1", "v2"]);
  });

  test("the target-set registry declares v1, v2, and the reserved variant target", () => {
    expect(Object.keys(paths.TARGETS).sort()).toEqual(["v1", "v2", "variant"]);
  });

  const slugs = builder.listConfiguredSlugs();
  test("at least one lesson is configured (sanity)", () => {
    expect(slugs.length).toBeGreaterThan(0);
  });

  test.each(slugs)("verifyLesson(%s) is byte-identical to the committed artifacts", (slug) => {
    const res = builder.verifyLesson({ slug });
    expect(res.ok).toBe(true);
    expect(res.v1.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(res.v2.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("variant target path boundary", () => {
  test("a v2 lesson output may not resolve inside app/lessons/variants/ (reserved for differentiated artifacts)", () => {
    expect(() => paths.resolveOutput("v2", "app/lessons/variants/lesson_sneaky.html")).toThrow(
      /reserved for differentiated presentation artifacts/,
    );
  });

  test("the variant target resolves correctly inside its reserved root", () => {
    const abs = paths.resolveOutput("variant", "app/lessons/variants/lesson_x__pr" + "a".repeat(64) + ".html");
    expect(abs.startsWith(paths.VARIANT_OUTPUT_ROOT)).toBe(true);
  });

  test("an unknown target is refused", () => {
    expect(() => paths.resolveOutput("v3", "somewhere.html")).toThrow(/unknown build target/);
  });
});
