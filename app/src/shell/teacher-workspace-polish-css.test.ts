/**
 * @jest-environment node
 *
 * Sprint 28.5D - Teacher Workspace UX Polish CSS contract.
 *
 * The post-Sprint-20 teacher surfaces (Assignment Detail, Active Assignments,
 * the class workspace) emit shell-* class names that jsdom never styles
 * because it does not load app/index.html. These tests read the exact served
 * document and pin the CSS that backs the shared management controls (D1), the
 * shell-preserving Assignment Detail treatment (D2B), the class workspace
 * (D3), the Active Assignments dashboard (D4 container), and the Curriculum
 * density change (D5). A missing rule here is exactly the "styled by nobody"
 * gap the 28.5C audit found.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const INDEX_HTML = path.join(ROOT, "index.html");
const html = fs.readFileSync(INDEX_HTML, "utf8");

/** Body of the first rule whose selector list contains `selector` exactly. */
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

const has = (selector: string): boolean => ruleBody(html, selector) !== null;

/** Body of the LAST rule matching `selector` - the one that wins the cascade
 *  when a base rule is overridden later in source order. */
describe("D1 - shared teacher management controls are defined", () => {
  test("shell-btn is a real, intentional button (padding, border, radius, cursor)", () => {
    const body = ruleBody(html, ".shell-btn");
    expect(body).not.toBeNull();
    expect(body).toMatch(/padding:/);
    expect(body).toMatch(/border:/);
    expect(body).toMatch(/border-radius:\s*var\(--tw-radius-control\)/);
    expect(body).toMatch(/cursor:\s*pointer/);
  });

  test("shell-btn has hover and disabled treatments", () => {
    expect(has(".shell-btn:hover")).toBe(true);
    // Disabled state is styled (grouped selector containing :disabled).
    const stripped = html.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped).toMatch(/\.shell-btn:disabled/);
  });

  test("shell-btn primary and danger modifiers exist and reuse tokens", () => {
    const primary = ruleBody(html, ".shell-btn-primary");
    expect(primary).not.toBeNull();
    expect(primary).toMatch(/var\(--tw-primary\)/);
    const danger = ruleBody(html, ".shell-btn-danger");
    expect(danger).not.toBeNull();
    expect(danger).toMatch(/var\(--tw-callout-error/);
  });

  test("shell-btn is in the teal focus-ring allowlist", () => {
    // Grouped focus-visible rule must apply the canonical ring to shell-btn.
    const stripped = html.replace(/\/\*[\s\S]*?\*\//g, "");
    const focusRule = stripped
      .match(/[^{}]*\.shell-btn:focus-visible[^{}]*\{[^{}]*\}/)?.[0];
    expect(focusRule).toBeTruthy();
    expect(focusRule).toMatch(/box-shadow:\s*var\(--tw-focus-ring\)/);
  });

  test("shell-spinner is a restrained animated indicator with reduced-motion respect", () => {
    const body = ruleBody(html, ".shell-spinner");
    expect(body).not.toBeNull();
    expect(body).toMatch(/border-radius:\s*50%/);
    expect(body).toMatch(/animation:\s*shell-spin/);
    // Reduced-motion disables the spin.
    const stripped = html.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped).toMatch(
      /prefers-reduced-motion:\s*reduce[\s\S]*?\.shell-spinner\s*\{\s*animation:\s*none/,
    );
  });
});

describe("D2B - Assignment Detail is styled inside the shell", () => {
  test("the detail surface is neutralized to a page frame (not a card-in-card)", () => {
    const body = ruleBody(html, ".shell-assignment-detail");
    expect(body).not.toBeNull();
    expect(body).toMatch(/background:\s*transparent/);
    expect(body).toMatch(/box-shadow:\s*none/);
  });

  test("the header groups identity/state as a card surface", () => {
    const body = ruleBody(html, ".shell-assignment-detail-header");
    expect(body).not.toBeNull();
    expect(body).toMatch(/border:\s*1px solid var\(--tw-hairline\)/);
    expect(body).toMatch(/box-shadow:\s*var\(--tw-shadow-card\)/);
  });

  test("meta renders as label-over-value groups, not undifferentiated stacked text", () => {
    expect(has(".shell-assignment-detail-meta")).toBe(true);
    const pair = ruleBody(html, ".shell-assignment-detail-meta-pair");
    expect(pair).not.toBeNull();
    expect(pair).toMatch(/flex-direction:\s*column/);
    const label = ruleBody(html, ".shell-assignment-detail-meta-label");
    expect(label).toMatch(/text-transform:\s*uppercase/);
  });

  test("status renders as a pill with per-state variants (not color-only body text)", () => {
    const base = ruleBody(html, ".shell-assignment-detail-status");
    expect(base).not.toBeNull();
    expect(base).toMatch(/border-radius:\s*var\(--tw-radius-pill\)/);
    expect(has(".shell-assignment-detail-status-published")).toBe(true);
    expect(has(".shell-assignment-detail-status-closed")).toBe(true);
    expect(has(".shell-assignment-detail-status-draft")).toBe(true);
  });

  test("lifecycle error lines are real red callouts", () => {
    const stripped = html.replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = stripped.match(
      /\.shell-assignment-detail-close-error[^{}]*\{[^{}]*\}/,
    )?.[0];
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/var\(--tw-callout-error-bg\)/);
  });

  test("Close assignment is NOT given an alarming destructive treatment", () => {
    // Close reuses the calm secondary shell-btn; there is no rule turning the
    // close action into a loud red/danger button (audit: it is a reversible
    // lifecycle control).
    expect(has(".shell-assignment-detail-close-action")).toBe(false);
  });

  test("Publish is the single primary lifecycle action", () => {
    const body = ruleBody(
      html,
      ".shell-btn.shell-assignment-detail-publish-action",
    );
    expect(body).not.toBeNull();
    expect(body).toMatch(/var\(--tw-primary\)/);
  });

  test("detail sections, roster rows, late-recipient rows, and questions are styled", () => {
    expect(has(".shell-assignment-detail-roster")).toBe(true);
    expect(has(".shell-assignment-detail-roster-list")).toBe(true);
    expect(has(".shell-assignment-detail-roster-row")).toBe(true);
    expect(has(".shell-assignment-detail-late-recipients-row")).toBe(true);
    expect(has(".shell-assignment-detail-late-recipients-add")).toBe(true);
    expect(has(".shell-assignment-detail-questions-list")).toBe(true);
    expect(has(".shell-assignment-detail-lms")).toBe(true);
    expect(has(".shell-assignment-summary-grid")).toBe(true);
  });

  test("roster and question lists remove default bullets", () => {
    expect(ruleBody(html, ".shell-assignment-detail-roster-list")).toMatch(
      /list-style:\s*none/,
    );
    expect(ruleBody(html, ".shell-assignment-detail-questions-list")).toMatch(
      /list-style:\s*none/,
    );
  });
});

describe("D3 - class workspace is styled", () => {
  test("Snapshot/Roster switcher is a segmented control with a non-color-only active state", () => {
    expect(ruleBody(html, ".shell-class-nav-list")).toMatch(/list-style:\s*none/);
    const active = ruleBody(html, ".shell-class-nav-active");
    expect(active).not.toBeNull();
    // Active carries an underline (a shape cue), not color alone.
    expect(active).toMatch(/border-bottom-color:/);
  });

  test("the class identity line separates grade and status", () => {
    const ctx = ruleBody(html, ".shell-snapshot-context");
    expect(ctx).not.toBeNull();
    expect(ctx).toMatch(/display:\s*flex/);
    expect(ctx).toMatch(/gap:/);
  });

  test("class cards are left-aligned like every other card", () => {
    const card = ruleBody(html, ".shell-class-card");
    expect(card).not.toBeNull();
    expect(card).toMatch(/text-align:\s*left/);
  });
});

describe("D4 - Active Assignments dashboard is styled", () => {
  test("dashboard cards have the shared card grammar", () => {
    const card = ruleBody(html, ".shell-active-assignment-card");
    expect(card).not.toBeNull();
    expect(card).toMatch(/border:\s*1px solid var\(--tw-hairline\)/);
    expect(card).toMatch(/box-shadow:\s*var\(--tw-shadow-card\)/);
  });
  test("the accordion toggle reads as expandable without color alone", () => {
    const stripped = html.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped).toMatch(
      /\.shell-active-assignments-toggle-btn::before\s*\{[^{}]*content:/,
    );
  });
});

describe("Curriculum density (Sprint 28.6H, Finding 6)", () => {
  test("the grid uses an explicit 4-column layout, not auto-fill", () => {
    // 28.6H replaced the auto-fill minmax() track (which produced 5 across at
    // 1280) with explicit column counts (4 desktop, reflowing to 3 / 2 / 1),
    // so card readability wins over maximum density.
    const grid = ruleBody(html, ".shell-curriculum-grid");
    expect(grid).not.toBeNull();
    expect(grid).toMatch(/grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
    expect(grid).not.toMatch(/auto-fill/);
    // Reflow rules exist for narrower widths.
    const stripped = html.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped).toMatch(/repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    expect(stripped).toMatch(/repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  });
});
