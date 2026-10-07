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

  test("the Assignment Overview groups identity, action, and summary as one card surface", () => {
    const body = ruleBody(html, ".shell-assignment-detail-overview");
    expect(body).not.toBeNull();
    expect(body).toMatch(/border:\s*1px solid var\(--tw-hairline\)/);
    expect(body).toMatch(/box-shadow:\s*var\(--tw-shadow-card\)/);
    // The header row inside it is not a second card: identity and the
    // lifecycle action share a wrapping row.
    const header = ruleBody(html, ".shell-assignment-detail-header");
    expect(header).not.toBeNull();
    expect(header).not.toMatch(/box-shadow:/);
    expect(header).not.toMatch(/border:/);
    expect(header).toMatch(/display:\s*flex/);
    expect(header).toMatch(/flex-wrap:\s*wrap/);
    expect(ruleBody(html, ".shell-assignment-detail-identity")).toMatch(
      /min-width:\s*0/,
    );
    // An open draft editor takes the full width rather than the action slot.
    expect(ruleBody(html, ".shell-assignment-detail-lifecycle-editing")).toMatch(
      /flex-basis:\s*100%/,
    );
  });

  test("inside the overview the summary sheds its own card chrome and visible heading", () => {
    const inner = ruleBody(
      html,
      ".shell-assignment-detail-overview .shell-assignment-summary",
    );
    expect(inner).not.toBeNull();
    expect(inner).toMatch(/box-shadow:\s*none/);
    expect(inner).toMatch(/border-top:\s*1px solid var\(--tw-hairline\)/);
    // The heading is visually hidden, not removed (screen readers keep it).
    const headline = ruleBody(
      html,
      ".shell-assignment-detail-overview .shell-assignment-summary-headline",
    );
    expect(headline).toMatch(/position:\s*absolute/);
    expect(headline).toMatch(/clip:\s*rect\(0, 0, 0, 0\)/);
    // An empty meta row (ordinary published assignment) takes no space.
    expect(ruleBody(html, ".shell-assignment-detail-meta:empty")).toMatch(
      /display:\s*none/,
    );
  });

  test("metric tiles wrap by available width and attempt units stay subordinate and neutral", () => {
    const grid = ruleBody(html, ".shell-assignment-summary-grid");
    expect(grid).toMatch(/grid-template-columns:\s*repeat\(auto-fill, minmax\(8rem, 1fr\)\)/);
    const unit = ruleBody(html, ".shell-assignment-summary-metric-unit");
    expect(unit).not.toBeNull();
    expect(unit).toMatch(/color:\s*var\(--tw-ink-muted\)/);
    expect(unit).not.toMatch(/amber|red|green|callout/);
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

  test("roster rows are compact Student | Score | Attempts grid rows, never cards", () => {
    const row = ruleBody(html, ".shell-assignment-detail-roster-row");
    expect(row).not.toBeNull();
    expect(row).toMatch(/display:\s*grid/);
    // Three columns: a flexible name column plus fixed score/attempt columns
    // so values align across rows.
    expect(row).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+\S+\s+\S+;/);
    // A divider row, not a card: no per-student background, shadow, or radius.
    expect(row).not.toMatch(/background|box-shadow|border-radius/);
    // Long names wrap instead of overflowing.
    expect(ruleBody(html, ".shell-assignment-detail-roster-name")).toMatch(
      /overflow-wrap:\s*anywhere/,
    );
    // The summary wrapper steps out of layout so its two cells join the grid.
    expect(ruleBody(html, ".shell-assignment-detail-roster-summary")).toMatch(
      /display:\s*contents/,
    );
    const score = ruleBody(html, ".shell-assignment-detail-roster-percentage");
    expect(score).toMatch(/grid-column:\s*2/);
    expect(score).toMatch(/white-space:\s*nowrap/);
    expect(score).toMatch(/font-weight:\s*700/);
    const attempts = ruleBody(html, ".shell-assignment-detail-roster-attempts");
    expect(attempts).toMatch(/grid-column:\s*3/);
    expect(attempts).toMatch(/color:\s*var\(--tw-ink-muted\)/);
    // No CSS reordering: DOM order is visual order.
    const rosterCss = html.slice(
      html.indexOf(".shell-assignment-detail-roster-header {"),
      html.indexOf(".shell-assignment-detail-late-recipients-status"),
    );
    expect(rosterCss).not.toMatch(/\border:\s*-?\d/);
  });

  test("the shared roster Sort control is styled with a visible focus ring and touch target", () => {
    expect(has(".shell-roster-sort")).toBe(true);
    expect(has(".shell-roster-sort-label")).toBe(true);
    const select = ruleBody(html, ".shell-roster-sort-select");
    expect(select).toMatch(/border-radius:\s*var\(--tw-radius-control\)/);
    expect(ruleBody(html, ".shell-roster-sort-select:focus-visible")).toMatch(
      /box-shadow:\s*var\(--tw-focus-ring\)/,
    );
    expect(html).toMatch(
      /@media \(pointer: coarse\) \{\s*\.shell-roster-sort-select \{ min-height: 44px; \}/,
    );
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

// Assignment Detail Roster information hierarchy: Roster + Sort header row,
// status-tinted NON-EMPTY groups (pale green / amber / rose), compact zero
// groups, and narrow-screen reflow. Contracts, not exact decoration.
describe("Assignment Detail roster information hierarchy", () => {
  const alpha = (value: string | undefined): number => {
    const m = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/.exec(value ?? "");
    return m ? Number(m[1]) : NaN;
  };
  const rgb = (value: string | undefined): [number, number, number] => {
    const m = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value ?? "");
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [NaN, NaN, NaN];
  };
  // The aliases are declared once, scoped to the roster section.
  const token = (name: string): string | undefined =>
    new RegExp(`${name}:\\s*([^;]+);`).exec(html)?.[1]?.trim();

  test("Roster heading and Sort share a wrapping, Detail-scoped header row", () => {
    const header = ruleBody(html, ".shell-assignment-detail-roster-header");
    expect(header).toMatch(/display:\s*flex/);
    expect(header).toMatch(/flex-wrap:\s*wrap/);
    expect(header).toMatch(/justify-content:\s*space-between/);
    // Scoped override: the shared .shell-roster-sort base rule is unchanged.
    expect(has(".shell-assignment-detail-roster-header .shell-roster-sort")).toBe(true);
    expect(ruleBody(html, ".shell-roster-sort")).toMatch(/margin:\s*0\.25rem 0 0\.5rem 0/);
  });

  test.each([
    ["Completed", "submitted", "completed", "green"],
    ["In Progress", "in-progress", "progress", "amber"],
    ["Not Started", "not-started", "notstarted", "rose"],
  ] as const)("non-empty %s group (%s) gets a pale status tint via scoped aliases", (_l, key, alias, hue) => {
    const body = ruleBody(
      html,
      `.shell-assignment-detail-roster-${key}.shell-assignment-detail-roster-group-tinted`,
    );
    expect(body).toMatch(new RegExp(`background:\\s*var\\(--tw-roster-${alias}-bg\\)`));
    expect(body).toMatch(new RegExp(`border-color:\\s*var\\(--tw-roster-${alias}-edge\\)`));
    // Text stays normal ink: the tint never changes the text color.
    expect(body).not.toMatch(/(^|[^-])color:/);
    const bg = token(`--tw-roster-${alias}-bg`);
    const edge = token(`--tw-roster-${alias}-edge`);
    // Genuinely pale: a very low-alpha wash and a soft edge.
    expect(alpha(bg)).toBeGreaterThan(0);
    expect(alpha(bg)).toBeLessThanOrEqual(0.08);
    expect(alpha(edge)).toBeLessThanOrEqual(0.3);
    const [r, g, b] = rgb(bg);
    if (hue === "green") expect(g).toBeGreaterThan(r);
    if (hue === "amber") expect(r > b && g > b).toBe(true);
    if (hue === "rose") expect(r).toBeGreaterThan(g);
  });

  test("Not Started is the calmest tint so it never reads as an error", () => {
    expect(alpha(token("--tw-roster-notstarted-bg"))).toBeLessThan(
      alpha(token("--tw-roster-progress-bg")),
    );
    // Distinct from the red error callout family.
    expect(token("--tw-roster-notstarted-bg")).not.toBe("var(--tw-callout-error-bg)");
  });

  test("only a non-empty group is tinted: the base group carries no fill", () => {
    const base = ruleBody(html, ".shell-assignment-detail-roster-group");
    expect(base).not.toMatch(/background/);
    expect(base).toMatch(/border:\s*1px solid transparent/);
    // Containers, not pills: control radius, never the pill radius.
    expect(base).toMatch(/border-radius:\s*var\(--tw-radius-control\)/);
    expect(has(".shell-assignment-detail-roster-empty")).toBe(false);
  });

  test("group heading shows a text status label and a distinct count", () => {
    expect(ruleBody(html, ".shell-assignment-detail-roster-group-label")).toMatch(
      /text-transform:\s*uppercase/,
    );
    const count = ruleBody(html, ".shell-assignment-detail-roster-group-count");
    expect(count).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(count).not.toMatch(/border-radius|background/);
  });

  test("narrow screens (480px) reflow rows: name first, values beneath, no horizontal table", () => {
    const narrow = /@media \(max-width: 480px\) \{[\s\S]*?Roster rows reflow[\s\S]*?\n {2}\}/.exec(html)?.[0] ?? "";
    expect(narrow).toMatch(
      /\.shell-assignment-detail-roster-row \{\s*grid-template-columns:\s*auto minmax\(0, 1fr\);/,
    );
    expect(narrow).toMatch(/\.shell-assignment-detail-roster-name,[\s\S]*?grid-column:\s*1 \/ -1/);
    expect(narrow).toMatch(/\.shell-assignment-detail-roster-grade-retry \{ grid-column: 1 \/ -1; \}/);
    expect(html).not.toMatch(/\.shell-assignment-detail-roster[^{]*\{[^}]*overflow-x:\s*(auto|scroll)/);
  });
});

// Assignment Detail "Students to add": a rare actionable repair section that
// is visually subordinate to the Summary and Roster, with no zero-state,
// read-error, loading, or lifecycle-note styling left behind.
describe("Assignment Detail Students to add section", () => {
  test("is a plain bordered block, not another dashboard card", () => {
    const body = ruleBody(html, ".shell-assignment-detail-late-recipients");
    expect(body).toMatch(/border:\s*1px solid var\(--tw-hairline\)/);
    expect(body).toMatch(/border-radius:\s*var\(--tw-radius-control\)/);
    expect(body).not.toMatch(/box-shadow/);
    // It no longer shares the major section-card rule.
    const card = ruleBody(html, ".shell-assignment-detail-roster");
    expect(card).toMatch(/box-shadow:\s*var\(--tw-shadow-card\)/);
    expect(html).not.toMatch(
      /\.shell-assignment-detail-roster,\s*\.shell-assignment-detail-late-recipients,/,
    );
  });

  test("heading is a label plus a plain count, like the Roster group headings", () => {
    expect(ruleBody(html, ".shell-assignment-detail-late-recipients-heading-label")).toMatch(
      /text-transform:\s*uppercase/,
    );
    const count = ruleBody(html, ".shell-assignment-detail-late-recipients-heading-count");
    expect(count).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(count).not.toMatch(/border-radius|background/);
  });

  test("rows are compact dividers and the Add action stays a neutral content control", () => {
    const row = ruleBody(html, ".shell-assignment-detail-late-recipients-row");
    expect(row).toMatch(/border-bottom:\s*1px solid var\(--tw-hairline-soft\)/);
    expect(row).not.toMatch(/background|border-radius/);
    const add = ruleBody(html, ".shell-assignment-detail-late-recipients-add");
    expect(add).toMatch(/border-radius:\s*var\(--tw-radius-control\)/);
    expect(add).not.toMatch(/--tw-primary|--tw-gold/);
  });

  test("the post-add confirmation takes no space until it has text", () => {
    expect(ruleBody(html, ".shell-assignment-detail-late-recipients-confirmation:empty")).toMatch(
      /margin:\s*0;/,
    );
    expect(ruleBody(html, ".shell-assignment-detail-late-recipients-status")).not.toMatch(
      /min-height/,
    );
  });

  test("dead zero-state, read-error, loading, and lifecycle-note styling is removed", () => {
    for (const sel of [
      ".shell-assignment-detail-late-recipients-empty",
      ".shell-assignment-detail-late-recipients-info-note",
      ".shell-assignment-detail-late-recipients-loading",
      ".shell-assignment-detail-late-recipients-error",
    ]) {
      expect(has(sel)).toBe(false);
    }
    // The explicit Add failure keeps its error callout.
    expect(ruleBody(html, ".shell-assignment-detail-late-recipients-action-error")).toMatch(
      /background:\s*var\(--tw-callout-error-bg\)/,
    );
  });
});
