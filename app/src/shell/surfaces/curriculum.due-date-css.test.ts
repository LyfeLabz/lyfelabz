/**
 * @jest-environment node
 *
 * Served-CSS pin for the Assign dialog's shared Due date field. jsdom never
 * applies app/index.html's stylesheet, so DOM tests cannot see this. Production
 * defect it guards: the shared-settings rule `.shell-assign-field input` sizes
 * every field to the compact 5.5rem Points width, so the native
 * `<input type="date">` Due date had too little room for a full MM/DD/YYYY
 * value beside the browser's calendar-picker icon, and "10/01/2026" rendered
 * as "10/01/202".
 */
import * as fs from "fs";
import * as path from "path";

const html = fs.readFileSync(path.resolve(__dirname, "../../../index.html"), "utf8");
const css = html.replace(/\/\*[\s\S]*?\*\//g, "");

type Rule = { readonly selectors: readonly string[]; readonly body: string; readonly index: number };

const rules: readonly Rule[] = (css.match(/[^{}]+\{[^{}]*\}/g) ?? []).map((rule, index) => {
  const open = rule.indexOf("{");
  return {
    selectors: rule.slice(0, open).split(",").map((s) => s.trim()),
    body: rule.slice(open + 1, rule.lastIndexOf("}")),
    index,
  };
});

const rulesFor = (selector: string): readonly Rule[] =>
  rules.filter((r) => r.selectors.includes(selector));

describe("Assign dialog shared Due date: the full year is visible", () => {
  test("the compact shared-field width is still 5.5rem (why a date-specific rule is required)", () => {
    const base = rulesFor(".shell-assign-field input");
    expect(base.some((r) => /width:\s*5\.5rem/.test(r.body))).toBe(true);
  });

  test("a native date field in shared settings gets the full posting-date width", () => {
    const date = rulesFor('.shell-assign-field input[type="date"]');
    expect(date).toHaveLength(1);
    expect(date[0].body).toMatch(/width:\s*10rem/);
    expect(date[0].body).toMatch(/box-sizing:\s*border-box/);
    // Matches the per-class posting date, which already shows a full date.
    const rowDate = rulesFor(".shell-assign-row-schedule .shell-assign-row-date");
    expect(rowDate.some((r) => /width:\s*10rem/.test(r.body))).toBe(true);
  });

  test("no later shared-field rule narrows the date field back", () => {
    const date = rulesFor('.shell-assign-field input[type="date"]')[0];
    const lastBaseWidth = rulesFor(".shell-assign-field input")
      .filter((r) => /(^|[;\s])width:/.test(r.body))
      .map((r) => r.index);
    expect(lastBaseWidth.length).toBeGreaterThan(0);
    // The date rule has higher specificity, and also follows every base
    // width declaration in source order.
    expect(Math.max(...lastBaseWidth)).toBeLessThan(date.index);
  });
});
