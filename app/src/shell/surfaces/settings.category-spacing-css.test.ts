/**
 * @jest-environment node
 *
 * Sprint 26 Phase 5 - Settings spacing repair regression.
 *
 * Root cause: the served document's base `button` rule applies
 * `margin-top: 1rem`. The Connected Services category is the only Settings
 * category rendered as a <button> (`.shell-settings-category-button` in
 * settings.ts), while every other category is plain paragraphs. The category
 * button reset the base `padding` but NOT the base `margin-top`, so it
 * inherited an extra 1rem above it and broke the vertical rhythm between
 * Settings categories.
 *
 * jsdom does not load app/index.html or apply its CSS, so the existing
 * settings jsdom tests cannot see this seam. This test reads the exact
 * document Firebase Hosting serves for /app/teacher and pins the served CSS
 * that backs the class settings.ts actually renders - the same posture as the
 * Sprint 25 B6 assign-toast CSS regression test.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const INDEX_HTML = path.join(ROOT, "index.html");
const SETTINGS_TS = path.resolve(__dirname, "settings.ts");

const html = fs.readFileSync(INDEX_HTML, "utf8");

/** Extract the declaration body of the first rule whose selector list
 *  contains `selector` exactly (as a whole comma-separated entry). */
const ruleBody = (css: string, selector: string): string | null => {
  // Strip CSS comments so a rule's leading /* ... */ does not bleed into the
  // selector prelude captured between the previous } and this {.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = stripped.match(/[^{}]+\{[^{}]*\}/g) ?? [];
  for (const rule of rules) {
    const open = rule.indexOf("{");
    const prelude = rule.slice(0, open);
    const body = rule.slice(open + 1, rule.lastIndexOf("}"));
    const selectors = prelude.split(",").map((s) => s.trim());
    if (selectors.includes(selector)) return body;
  }
  return null;
};

describe("Sprint 26 Phase 5 - JS renders the category as a button", () => {
  const jsSource = fs.readFileSync(SETTINGS_TS, "utf8");

  test("Connected Services renders with shell-settings-category-button", () => {
    // The class the CSS resets must be the class the JS actually renders.
    expect(jsSource).toContain('"shell-settings-category-button"');
  });
});

describe("Sprint 26 Phase 5 - base button margin is the defect source", () => {
  test("served base `button` rule still carries margin-top: 1rem", () => {
    // Cascade context: the base rule is intentionally unchanged so every
    // other button (Connect / Reconnect / Disconnect, grade control, etc.)
    // keeps its existing spacing. The category button must locally cancel it.
    const body = ruleBody(html, "button");
    expect(body).not.toBeNull();
    expect(body as string).toMatch(/margin-top:\s*1rem/);
  });
});

describe("Sprint 26 Phase 5 - category button resets the inherited margin", () => {
  const body = ruleBody(html, ".shell-settings-category-button");

  test("the category button rule is present", () => {
    expect(body).not.toBeNull();
  });

  test("resets the base top margin to zero", () => {
    // margin-top: 0 (or a margin shorthand resolving top to 0) neutralizes the
    // inherited 1rem so Connected Services shares the categories' rhythm.
    const decls = body as string;
    expect(decls).toMatch(/margin-top:\s*0(?:px|rem|em)?\b|margin:\s*0\b/);
  });
});
