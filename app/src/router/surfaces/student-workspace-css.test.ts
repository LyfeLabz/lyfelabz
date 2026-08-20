/**
 * @jest-environment node
 *
 * Sprint 28.5B - Student Workspace polish, served-CSS regression pins.
 *
 * The student surface (makeActiveStudentSurface) renders firebase-free DOM
 * that jsdom tests exercise, but jsdom never loads app/index.html or applies
 * its CSS, so the jsdom surface tests cannot see the presentation contracts
 * this phase established. This test reads the exact document Firebase Hosting
 * serves for /app/** and pins the served CSS that backs B1 (primary action),
 * B2 (selected tab), and B5 (error callout) - the same posture as the Sprint
 * 25/26 assign-toast and category-spacing CSS regression tests.
 *
 * These are contract pins, not pixel/color assertions: they assert that the
 * student-only testids are covered by the intended rules, so a future edit
 * cannot silently drop the styling (the exact class of regression B5 fixes).
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const INDEX_HTML = path.join(ROOT, "index.html");
const html = fs.readFileSync(INDEX_HTML, "utf8");

/** Extract the declaration body of the first rule whose selector list
 *  contains `selector` exactly (as a whole comma-separated entry). */
const ruleBody = (css: string, selector: string): string | null => {
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

const SCOPE = "body:not(:has(#app-root > .shell-header))";

describe("Sprint 28.5B B1 - primary student action is styled", () => {
  const body = ruleBody(html, `${SCOPE} [data-testid=assignments-launch]`);

  test("Open assignment / Improve My Score share a filled-primary rule", () => {
    expect(body).not.toBeNull();
    // Same primary token the certified sign-in / retry buttons already use.
    expect(body as string).toMatch(/background:\s*var\(--tw-primary\)/);
    // A reasonable touch target is preserved.
    expect(body as string).toMatch(/min-height:\s*44px/);
    // The improve action is in the same selector list.
    const selectorList = (html.replace(/\/\*[\s\S]*?\*\//g, "").match(
      /[^{}]+\{[^{}]*\}/g,
    ) ?? []).find((r) =>
      r.includes(`${SCOPE} [data-testid=assignments-launch]`) &&
      r.includes("background: var(--tw-primary)"),
    );
    expect(selectorList).toContain(`${SCOPE} [data-testid=results-improve]`);
  });
});

describe("Sprint 28.5B B2 - selected tab has a non-color cue", () => {
  const body = ruleBody(
    html,
    `${SCOPE} [data-testid=student-nav] [role=tab][aria-selected=true]`,
  );

  test("the selected tab carries a solid accent underline bar (not color alone)", () => {
    expect(body).not.toBeNull();
    expect(body as string).toMatch(
      /border-bottom-color:\s*var\(--tw-nav-edge\)/,
    );
  });
});

describe("Sprint 28.5B B5 - student error surfaces get the callout styling", () => {
  // The renderers overwrite data-testid=error-banner with assignments-error /
  // results-error for their retry tests; the callout rule must cover both so
  // the error reads as an error again.
  test("assignments-error is in the callout rule's selector list", () => {
    const body = ruleBody(html, `${SCOPE} [data-testid=assignments-error]`);
    expect(body).not.toBeNull();
    expect(body as string).toMatch(/var\(--tw-callout-error-bg\)/);
  });

  test("results-error is in the callout rule's selector list", () => {
    const body = ruleBody(html, `${SCOPE} [data-testid=results-error]`);
    expect(body).not.toBeNull();
    expect(body as string).toMatch(/var\(--tw-callout-error-bg\)/);
  });
});
