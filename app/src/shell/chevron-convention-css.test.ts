/**
 * @jest-environment node
 *
 * LyfeLabz chevron convention (docs/platform/UI_CHEVRON_CONVENTION.md) -
 * served-CSS contract. jsdom never applies app/index.html, so this reads the
 * served document and pins the shared `.ll-chevron` primitive: one CSS-drawn
 * stroke chevron in currentColor, down when collapsed, up when
 * `aria-expanded="true"`, right for `.ll-chevron--nav`. The Student Support
 * and Student Services disclosures that adopt it carry no glyph of their own.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const css = fs.readFileSync(path.join(ROOT, "index.html"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, "src", rel), "utf8");

const rules = (css.match(/[^{}]+\{[^{}]*\}/g) ?? []).map((rule) => {
  const open = rule.indexOf("{");
  return {
    selectors: rule.slice(0, open).split(",").map((s) => s.trim()),
    body: rule.slice(open + 1, rule.lastIndexOf("}")),
  };
});
const bodyOf = (selector: string): string =>
  rules
    .filter((r) => r.selectors.includes(selector))
    .map((r) => r.body)
    .join(";");

describe("LyfeLabz chevron convention (.ll-chevron)", () => {
  it("draws one stroke chevron in the text color, pointing down when collapsed", () => {
    const base = bodyOf(".ll-chevron::after");
    expect(base).toMatch(/content:\s*""/);
    expect(base).toMatch(/border-right:\s*2px solid currentColor/);
    expect(base).toMatch(/border-bottom:\s*2px solid currentColor/);
    expect(base).toMatch(/transform:\s*rotate\(45deg\)/);
  });

  it("points up when expanded and right for navigation", () => {
    expect(bodyOf('.ll-chevron[aria-expanded="true"]::after')).toMatch(/transform:\s*rotate\(-135deg\)/);
    expect(bodyOf(".ll-chevron--nav::after")).toMatch(/transform:\s*rotate\(-45deg\)/);
  });

  it("respects reduced motion", () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.ll-chevron::after\s*\{\s*transition:\s*none/);
  });

  it.each([
    ".shell-ss-disclosure-toggle",
    ".shell-student-detail-thinking-toggle",
    ".shell-student-detail-review-toggle",
    ".shell-student-detail-repeat-toggle",
  ])("%s carries no glyph or rotation of its own", (selector) => {
    const own = [bodyOf(`${selector}::after`), bodyOf(`${selector}[aria-expanded="true"]::after`)].join(";");
    expect(own).not.toMatch(/content:/);
    expect(own).not.toMatch(/transform:/);
  });

  it("is applied to the Student Support and Student Services disclosures", () => {
    expect(src("shell/surfaces/settings.ts")).toContain('"shell-ss-disclosure-toggle ll-chevron"');
    expect(src("shell/surfaces/classSupportAccess.ts")).toContain("shell-ss-disclosure-toggle--sub ll-chevron");
    expect(src("shell/surfaces/classes.ts")).toContain('"shell-student-detail-thinking-toggle ll-chevron"');
    expect(src("shell/surfaces/studentDetailQuestionReview.ts")).toContain("shell-student-detail-review-toggle ll-chevron");
    expect(src("shell/surfaces/studentDetailRepeatedMisses.ts")).toContain('"shell-student-detail-repeat-toggle ll-chevron"');
  });

  it("disclosure hosts keep a visible focus ring", () => {
    for (const selector of [
      ".shell-ss-disclosure-toggle:focus-visible",
      ".shell-student-detail-thinking-toggle:focus-visible",
      ".shell-student-detail-repeat-toggle:focus-visible",
    ]) {
      expect(bodyOf(selector)).toMatch(/box-shadow:\s*var\(--tw-focus-ring/);
    }
  });
});
