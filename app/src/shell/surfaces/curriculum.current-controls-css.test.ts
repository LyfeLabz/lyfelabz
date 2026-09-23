/**
 * @jest-environment node
 *
 * Served-CSS pin for the Current-selection controls in the Update Assignment
 * dialog. jsdom never applies app/index.html's stylesheet, so DOM tests can
 * only assert the `hidden` property; this pins the CSS that makes `hidden`
 * actually hide these controls in a real browser. Production defect it
 * guards: `.shell-assign-row-current-panel { display: flex }` out-ranked the
 * browser's default `[hidden] { display: none }`, so the collapsed Set
 * Current panel (with its own "Set as current" button) showed next to the
 * "Set as current assignment" opener.
 */
import * as fs from "fs";
import * as path from "path";

const html = fs.readFileSync(path.resolve(__dirname, "../../../index.html"), "utf8");

const ruleBody = (css: string, selector: string): string | null => {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = stripped.match(/[^{}]+\{[^{}]*\}/g) ?? [];
  for (const rule of rules) {
    const open = rule.indexOf("{");
    const selectors = rule.slice(0, open).split(",").map((s) => s.trim());
    if (selectors.includes(selector)) return rule.slice(open + 1, rule.lastIndexOf("}"));
  }
  return null;
};

describe("Update Assignment Current controls: hidden means hidden", () => {
  test("the Set Current panel sets its own display (why an explicit [hidden] rule is required)", () => {
    expect(ruleBody(html, ".shell-assign-row-current-panel")).toMatch(/display:\s*flex/);
  });

  test("a collapsed (hidden) Set Current panel is not displayed", () => {
    expect(ruleBody(html, ".shell-assign-row-current-panel[hidden]")).toMatch(/display:\s*none/);
  });

  test("a hidden 'Set as current assignment' opener is not displayed", () => {
    expect(ruleBody(html, ".shell-assign-row-set-current[hidden]")).toMatch(/display:\s*none/);
  });
});
