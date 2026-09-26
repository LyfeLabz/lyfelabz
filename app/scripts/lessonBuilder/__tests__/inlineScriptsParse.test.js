/**
 * @jest-environment node
 *
 * Every inline JavaScript block in every configured lesson's committed v1
 * and v2 artifact must parse. The builder copies script bytes verbatim and
 * the assessment-fidelity extractor skips a script body that does not
 * parse, so without this check a canonical prose edit inside a script
 * string (for example an unescaped apostrophe in a single-quoted string)
 * would ship a lesson whose interactive code silently fails to run.
 */
/* eslint-disable */
"use strict";

const fs = require("fs");
const acorn = require("acorn");

const configMod = require("../config.cjs");
const paths = require("../paths.cjs");

const JS_TYPES = /^(?:|text\/javascript|application\/javascript|module)$/i;

function inlineScriptErrors(html) {
  const errors = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  let index = 0;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const body = m[2];
    const type = (/\btype\s*=\s*["']([^"']*)["']/i.exec(attrs) || [, ""])[1];
    if (/\bsrc\s*=/i.test(attrs) || !JS_TYPES.test(type) || body.trim().length === 0) continue;
    try {
      acorn.parse(body, { ecmaVersion: "latest", sourceType: type === "module" ? "module" : "script" });
    } catch (err) {
      errors.push(`inline script ${index}: ${err.message}`);
    }
    index += 1;
  }
  return errors;
}

describe("configured lessons - inline scripts parse", () => {
  test("detects an unescaped apostrophe inside a single-quoted string", () => {
    expect(inlineScriptErrors("<script>var d = { body: 'the top of Earth's plates' };</script>")).toHaveLength(1);
    expect(inlineScriptErrors("<script>var d = { body: 'the top of Earth’s plates' };</script>")).toHaveLength(0);
  });

  for (const slug of configMod.listConfiguredSlugs()) {
    const cfg = configMod.loadConfig(slug);
    for (const target of paths.CANONICAL_TARGET_IDS) {
      test(`${slug} ${target}`, () => {
        const html = fs.readFileSync(paths.resolveOutput(target, cfg.outputs[target]), "utf8");
        expect(inlineScriptErrors(html)).toEqual([]);
      });
    }
  }
});
