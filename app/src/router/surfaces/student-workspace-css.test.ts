/**
 * @jest-environment node
 *
 * Sprint 28.6G - Student My Science, served-CSS regression pins.
 *
 * The student surface (makeActiveStudentSurface) renders firebase-free DOM
 * that jsdom tests exercise, but jsdom never loads app/index.html or applies
 * its CSS, so the jsdom surface tests cannot see the presentation contracts
 * this phase established. This test reads the exact document Firebase Hosting
 * serves for /app/** and pins the served CSS that backs the minimal header,
 * the primary launch action, the quiet-completed treatment, and the error
 * callout - the same posture as the earlier Sprint 25/26/28.5B served-CSS
 * regressions.
 *
 * These are contract pins, not pixel/color assertions: they assert that the
 * student-only testids/classes are covered by the intended rules, so a future
 * edit cannot silently drop the styling.
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

describe("28.6G - primary student launch action is styled", () => {
  const body = ruleBody(html, `${SCOPE} [data-testid=assignments-launch]`);

  test("Open assignment carries the filled-primary treatment and a real touch target", () => {
    expect(body).not.toBeNull();
    expect(body as string).toMatch(/background:\s*var\(--tw-primary\)/);
    expect(body as string).toMatch(/min-height:\s*44px/);
  });
});

describe("28.6G - completed work is quieter but stays interactive", () => {
  test("a completed card recedes to the alt surface (not disabled)", () => {
    const body = ruleBody(
      html,
      `${SCOPE} [data-testid=my-science-card][data-complete=true]`,
    );
    expect(body).not.toBeNull();
    expect(body as string).toMatch(/background:\s*var\(--tw-surface-alt\)/);
  });

  test("a completed card's Open assignment drops to a quiet outline treatment (still operable)", () => {
    const body = ruleBody(
      html,
      `${SCOPE} [data-testid=my-science-card][data-complete=true] [data-testid=assignments-launch]`,
    );
    expect(body).not.toBeNull();
    expect(body as string).toMatch(/background:\s*transparent/);
    expect(body as string).toMatch(/border-color:\s*var\(--tw-nav-edge\)/);
  });
});

describe("28.6G - the minimal header truncates a long name so Log out stays visible", () => {
  const body = ruleBody(html, `${SCOPE} .student-name`);

  test("student-name is single-line, capped, and ellipsized", () => {
    expect(body).not.toBeNull();
    expect(body as string).toMatch(/text-overflow:\s*ellipsis/);
    expect(body as string).toMatch(/white-space:\s*nowrap/);
    expect(body as string).toMatch(/max-width:/);
  });
});

describe("28.6G - the student error surface gets the callout styling", () => {
  test("assignments-error is in the callout rule's selector list", () => {
    const body = ruleBody(html, `${SCOPE} [data-testid=assignments-error]`);
    expect(body).not.toBeNull();
    expect(body as string).toMatch(/var\(--tw-callout-error-bg\)/);
  });
});

describe("28.6H - My Science is a wide workspace, not a narrow auth card (Findings 13/15)", () => {
  test("the root hosting the student header uses a wide, left-aligned layout", () => {
    const body = ruleBody(html, `${SCOPE} #app-root:has(.student-header)`);
    expect(body).not.toBeNull();
    // Materially wider than the 32rem auth card, and left-aligned.
    expect(body as string).toMatch(/max-width:\s*68rem/);
    expect(body as string).toMatch(/text-align:\s*left/);
  });

  test("the assignment list is a multi-column grid, not a single tall column", () => {
    const body = ruleBody(html, `${SCOPE} [data-testid=my-science-list]`);
    expect(body).not.toBeNull();
    expect(body as string).toMatch(/display:\s*grid/);
    expect(body as string).toMatch(/grid-template-columns:\s*repeat\(3,/);
  });
});

describe("28.6H - student cards are compact (Finding 16)", () => {
  test("the card uses tightened padding and a small inter-line gap", () => {
    const body = ruleBody(html, `${SCOPE} [data-testid=my-science-card]`);
    expect(body).not.toBeNull();
    expect(body as string).toMatch(/padding:\s*0\.7rem/);
    expect(body as string).toMatch(/gap:\s*0\.35rem/);
  });
});
