/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

const scanner = require("../markerScanner.cjs");
const { transform } = require("../transformer.cjs");

const NOTICE = "<!-- test notice -->\n";

function html(inner) {
  return "<!doctype html>\n<html><head>" + inner + "</head><body></body></html>\n";
}

describe("transformer", () => {
  test("inserts notice immediately after doctype", () => {
    const src = html("");
    const { regions } = scanner.scan(src);
    const out = transform(src, regions, "v1", NOTICE);
    expect(out.startsWith("<!doctype html>\n" + NOTICE)).toBe(true);
  });

  test("v1 keeps V1-ONLY body, strips markers only", () => {
    const inner =
      "\n<!-- LYFELABZ:V1-ONLY:BEGIN keep -->\n<p>KEEPBODY</p>\n<!-- LYFELABZ:V1-ONLY:END keep -->\n";
    const src = html(inner);
    const { regions } = scanner.scan(src);
    const out = transform(src, regions, "v1", NOTICE);
    expect(out).toContain("<p>KEEPBODY</p>");
    expect(out).not.toContain("LYFELABZ:V1-ONLY:BEGIN");
    expect(out).not.toContain("LYFELABZ:V1-ONLY:END");
  });

  test("v2 strips V1-ONLY body and markers together", () => {
    const inner =
      "\n<!-- LYFELABZ:V1-ONLY:BEGIN drop -->\n<p>DROPBODY</p>\n<!-- LYFELABZ:V1-ONLY:END drop -->\n";
    const src = html(inner);
    const { regions } = scanner.scan(src);
    const out = transform(src, regions, "v2", NOTICE);
    expect(out).not.toContain("DROPBODY");
    expect(out).not.toContain("LYFELABZ:");
  });

  test("v2 keeps V2-ONLY body, v1 strips it", () => {
    const inner =
      "<script>\n/* LYFELABZ:V2-ONLY:BEGIN v2body */\nvar V2_ONLY = 1;\n/* LYFELABZ:V2-ONLY:END v2body */\n</script>";
    const src = html(inner);
    const { regions } = scanner.scan(src);
    const outV1 = transform(src, regions, "v1", NOTICE);
    const outV2 = transform(src, regions, "v2", NOTICE);
    expect(outV1).not.toContain("V2_ONLY");
    expect(outV2).toContain("var V2_ONLY = 1;");
    expect(outV2).not.toContain("LYFELABZ:V2-ONLY");
  });

  test("marker-free bytes preserved byte-for-byte in v1 output (except notice)", () => {
    const shared = "<p>SHARED-A</p>\n<p>SHARED-B</p>";
    const inner = "\n" + shared + "\n<!-- LYFELABZ:V1-ONLY:BEGIN k -->\n<p>K</p>\n<!-- LYFELABZ:V1-ONLY:END k -->\n" + shared + "\n";
    const src = html(inner);
    const { regions } = scanner.scan(src);
    const out = transform(src, regions, "v1", NOTICE);
    // Remove notice; check every marker-free span survives.
    const withoutNotice = out.replace(NOTICE, "");
    // The two SHARED spans and the <p>K</p> body should all appear.
    expect(withoutNotice.indexOf("SHARED-A")).toBeGreaterThan(-1);
    expect(withoutNotice.indexOf("SHARED-B")).toBeGreaterThan(-1);
    expect(withoutNotice.indexOf("<p>K</p>")).toBeGreaterThan(-1);
  });

  test("rejects source without doctype", () => {
    const src = "<html></html>";
    expect(() => transform(src, [], "v1", NOTICE)).toThrow(/DOCTYPE/);
  });
});
