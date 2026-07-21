/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

const scanner = require("../markerScanner.cjs");

const HEAD = "<!doctype html>\n<html><head>";
const TAIL = "</head><body></body></html>\n";

function html(inner) {
  return HEAD + inner + TAIL;
}

describe("markerScanner", () => {
  test("collects a valid HTML region and pairs BEGIN/END", () => {
    const src = html(
      '\n<!-- LYFELABZ:V1-ONLY:BEGIN a -->\n<div>x</div>\n<!-- LYFELABZ:V1-ONLY:END a -->\n',
    );
    const { regions } = scanner.scan(src);
    expect(regions).toHaveLength(1);
    expect(regions[0].label).toBe("a");
    expect(regions[0].target).toBe("V1-ONLY");
    expect(regions[0].context).toBe("html");
  });

  test("collects a valid JS region inside <script>", () => {
    const src = html(
      "<script>\n/* LYFELABZ:V1-ONLY:BEGIN j */\nvar x = 1;\n/* LYFELABZ:V1-ONLY:END j */\n</script>",
    );
    const { regions } = scanner.scan(src);
    expect(regions).toHaveLength(1);
    expect(regions[0].context).toBe("js");
    expect(regions[0].label).toBe("j");
  });

  test("collects a valid CSS region inside <style>", () => {
    const src = html(
      "<style>\n/* LYFELABZ:V2-ONLY:BEGIN c */\n.x { color: red; }\n/* LYFELABZ:V2-ONLY:END c */\n</style>",
    );
    const { regions } = scanner.scan(src);
    expect(regions).toHaveLength(1);
    expect(regions[0].context).toBe("css");
    expect(regions[0].target).toBe("V2-ONLY");
  });

  test("rejects unbalanced BEGIN", () => {
    const src = html("\n<!-- LYFELABZ:V1-ONLY:BEGIN a -->\n<p></p>\n");
    expect(() => scanner.scan(src)).toThrow(/unbalanced marker/);
  });

  test("rejects END with no matching BEGIN", () => {
    const src = html("\n<!-- LYFELABZ:V1-ONLY:END orphan -->\n");
    expect(() => scanner.scan(src)).toThrow(/no matching BEGIN/);
  });

  test("rejects mismatched labels", () => {
    const src = html(
      '\n<!-- LYFELABZ:V1-ONLY:BEGIN a -->\n<p></p>\n<!-- LYFELABZ:V1-ONLY:END b -->\n',
    );
    expect(() => scanner.scan(src)).toThrow(/mismatched labels/);
  });

  test("rejects mismatched targets", () => {
    const src = html(
      '\n<!-- LYFELABZ:V1-ONLY:BEGIN a -->\n<p></p>\n<!-- LYFELABZ:V2-ONLY:END a -->\n',
    );
    expect(() => scanner.scan(src)).toThrow(/mismatched targets/);
  });

  test("rejects nested regions", () => {
    const src = html(
      '\n<!-- LYFELABZ:V1-ONLY:BEGIN outer -->\n<!-- LYFELABZ:V1-ONLY:BEGIN inner -->\n<!-- LYFELABZ:V1-ONLY:END inner -->\n<!-- LYFELABZ:V1-ONLY:END outer -->\n',
    );
    expect(() => scanner.scan(src)).toThrow(/nested LYFELABZ region/);
  });

  test("rejects duplicate labels", () => {
    const src = html(
      '\n<!-- LYFELABZ:V1-ONLY:BEGIN a -->\n<!-- LYFELABZ:V1-ONLY:END a -->\n<!-- LYFELABZ:V1-ONLY:BEGIN a -->\n<!-- LYFELABZ:V1-ONLY:END a -->\n',
    );
    expect(() => scanner.scan(src)).toThrow(/duplicate marker label/);
  });

  test("rejects HTML-syntax marker inside <script>", () => {
    const src = html("<script>\n<!-- LYFELABZ:V1-ONLY:BEGIN j -->\n</script>");
    expect(() => scanner.scan(src)).toThrow(/HTML-style comment not allowed|stray marker-like text/);
  });

  test("rejects JS-syntax marker at HTML top level", () => {
    const src = html("\n/* LYFELABZ:V1-ONLY:BEGIN h */\n");
    expect(() => scanner.scan(src)).toThrow(/stray marker-like text/);
  });

  test("rejects marker text hidden inside a JS string literal", () => {
    const src = html(
      "<script>\nvar x = 'LYFELABZ:V1-ONLY:BEGIN sneaky';\n</script>",
    );
    expect(() => scanner.scan(src)).toThrow(/stray marker-like text/);
  });

  test("rejects marker text hidden inside a template literal", () => {
    const src = html(
      "<script>\nvar x = `hi LYFELABZ:V1-ONLY:BEGIN sneak`;\n</script>",
    );
    expect(() => scanner.scan(src)).toThrow(/stray marker-like text/);
  });

  test("rejects marker text inside a non-standalone JS comment", () => {
    const src = html(
      "<script>\nvar x = 1; /* LYFELABZ:V1-ONLY:BEGIN inline */ var y = 2;\n</script>",
    );
    expect(() => scanner.scan(src)).toThrow(/non-standalone|stray/);
  });

  test("rejects marker text inside CSS string", () => {
    const src = html(
      "<style>\n.x { content: 'LYFELABZ:V1-ONLY:BEGIN c'; }\n</style>",
    );
    expect(() => scanner.scan(src)).toThrow(/stray marker-like text/);
  });

  test("rejects cross-context BEGIN in HTML and END in JS", () => {
    // BEGIN as HTML marker outside <script>, END as JS marker inside <script>.
    // These carry different `context` values so pairing throws either
    // cross-context or unbalanced. Either error is acceptable fail-closed
    // behavior; we assert one of them.
    const src = html(
      "\n<!-- LYFELABZ:V1-ONLY:BEGIN x -->\n<script>\n/* LYFELABZ:V1-ONLY:END x */\n</script>",
    );
    expect(() => scanner.scan(src)).toThrow(/cross-context|unbalanced/);
  });
});
