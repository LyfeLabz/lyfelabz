/**
 * @jest-environment node
 *
 * Teacher Workspace Control Hierarchy (Op 1) - served-CSS contract.
 *
 * Three semantically different control families used to share one pale
 * teal/white rounded vocabulary: Curriculum/Settings section tabs, Grade/Topic
 * filter pills (whose selected state literally reused the sidebar "you are
 * here" teal), and seven independently styled Back controls (one borrowing
 * the sidebar nav-button class). jsdom never applies app/index.html, so these
 * tests read the exact served document and pin the semantic hierarchy:
 *
 *   teal  = navigation / location (section tabs, Back controls)
 *   green = primary action (Assign)
 *   neutral ink = selection state (filters)
 *   gold  = analytics (View Summary)
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const css = html.replace(/\/\*[\s\S]*?\*\//g, "");
const src = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, "src", rel), "utf8");

interface Rule {
  readonly selectors: ReadonlyArray<string>;
  readonly body: string;
}

const rules: ReadonlyArray<Rule> = (css.match(/[^{}]+\{[^{}]*\}/g) ?? []).map(
  (rule) => {
    const open = rule.indexOf("{");
    return {
      selectors: rule.slice(0, open).split(",").map((s) => s.trim()),
      body: rule.slice(open + 1, rule.lastIndexOf("}")),
    };
  },
);

/** Every rule whose selector list contains `selector` exactly. */
const rulesFor = (selector: string): ReadonlyArray<Rule> =>
  rules.filter((r) => r.selectors.includes(selector));

/** Body of the first rule whose selector list contains `selector` exactly. */
const ruleBody = (selector: string): string | null =>
  rulesFor(selector)[0]?.body ?? null;

/** Value of a custom property declared in any :root block. */
const token = (name: string): string | null => {
  const m = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  return m ? m[1]!.trim() : null;
};

describe("semantic tokens alias the existing palette (no new hues)", () => {
  test.each([
    ["--tw-tab-indicator", "var(--tw-nav-edge)"],
    ["--tw-tab-baseline", "var(--tw-workspace-divider)"],
    ["--tw-select-bg", "var(--tw-ink-soft)"],
    ["--tw-select-ink", "#ffffff"],
    ["--tw-control-edge", "rgba(28, 39, 51, 0.30)"],
    ["--tw-focus-outline", "2px solid var(--tw-nav-edge)"],
  ])("%s = %s", (name, value) => {
    expect(token(name)).toBe(value);
  });
});

describe("internal section navigation tabs (Curriculum + Settings)", () => {
  test("Curriculum and Settings tabs share one rule for bar, tab, hover, selected and focus", () => {
    for (const [a, b] of [
      [".shell-curriculum-tabs", ".shell-settings-tabs"],
      [".shell-curriculum-tab", ".shell-settings-tab"],
      ['.shell-curriculum-tab:hover:not([aria-selected="true"])', '.shell-settings-tab:hover:not([aria-selected="true"])'],
      ['.shell-curriculum-tab[aria-selected="true"]', '.shell-settings-tab[aria-selected="true"]'],
      [".shell-curriculum-tab:focus-visible", ".shell-settings-tab:focus-visible"],
    ] as const) {
      // The defining (first) rule for each Curriculum selector also names its
      // Settings twin, so the two surfaces cannot drift apart.
      expect(rulesFor(a)[0]?.selectors).toContain(b);
      expect(rulesFor(b)[0]).toBe(rulesFor(a)[0]);
    }
  });

  test("the selected tab is a 3px navigation-teal underline, never primary green", () => {
    const tab = ruleBody(".shell-curriculum-tab")!;
    expect(tab).toMatch(/border-bottom:\s*3px solid transparent/);
    expect(tab).toMatch(/background:\s*transparent/);
    const selected = ruleBody('.shell-curriculum-tab[aria-selected="true"]')!;
    expect(selected).toMatch(/border-bottom-color:\s*var\(--tw-tab-indicator\)/);
    expect(selected).toMatch(/color:\s*var\(--tw-ink\)/);
    for (const r of [
      ...rulesFor(".shell-curriculum-tab"),
      ...rulesFor('.shell-curriculum-tab[aria-selected="true"]'),
    ]) {
      expect(r.body).not.toMatch(/#1f6b3d|--tw-primary/i);
    }
  });

  test("the bar has a visible baseline and is a single scrolling line, not a wrapping row", () => {
    const bar = ruleBody(".shell-curriculum-tabs")!;
    expect(bar).toMatch(/box-shadow:\s*inset 0 -1px 0 var\(--tw-tab-baseline\)/);
    expect(bar).toMatch(/flex-wrap:\s*nowrap/);
    expect(bar).toMatch(/overflow-x:\s*auto/);
    const tab = ruleBody(".shell-curriculum-tab")!;
    expect(tab).toMatch(/white-space:\s*nowrap/);
    expect(tab).toMatch(/flex:\s*0 0 auto/);
    expect(tab).toMatch(/margin:\s*0/);
    expect(tab).not.toMatch(/radius:\s*var\(--tw-radius-pill\)/);
  });

  test("inactive tabs are muted ink with a neutral hover preview", () => {
    expect(ruleBody(".shell-curriculum-tab")).toMatch(/color:\s*var\(--tw-ink-muted\)/);
    const hover = ruleBody('.shell-curriculum-tab:hover:not([aria-selected="true"])')!;
    expect(hover).toMatch(/color:\s*var\(--tw-ink\)/);
    expect(hover).toMatch(/border-bottom-color:\s*var\(--tw-control-edge\)/);
  });
});

describe("Grade / Topic filter pills are neutral selection controls", () => {
  test("unselected: pill, surface fill, visible neutral edge, inherited button margin removed", () => {
    const pill = ruleBody(".shell-filter-pill")!;
    expect(pill).toMatch(/border-radius:\s*var\(--tw-radius-pill\)/);
    expect(pill).toMatch(/background:\s*var\(--tw-surface\)/);
    expect(pill).toMatch(/border:\s*1px solid var\(--tw-control-edge\)/);
    expect(pill).toMatch(/color:\s*var\(--tw-ink-soft\)/);
    expect(pill).toMatch(/(^|;)\s*margin:\s*0;/);
  });

  test("selected: solid neutral fill with white text", () => {
    const active = ruleBody(".shell-filter-pill-active")!;
    expect(active).toMatch(/background:\s*var\(--tw-select-bg\)/);
    expect(active).toMatch(/border-color:\s*var\(--tw-select-bg\)/);
    expect(active).toMatch(/color:\s*var\(--tw-select-ink\)/);
    expect(active).toMatch(/font-weight:\s*600/);
  });

  test("no filter rule uses the navigation teal or the nav wash", () => {
    const filterRules = rules.filter((r) =>
      r.selectors.some((s) => s.startsWith(".shell-filter-pill")),
    );
    expect(filterRules.length).toBeGreaterThan(0);
    for (const r of filterRules) {
      expect(r.body).not.toMatch(/--tw-nav-edge|--tw-nav-wash|--tw-tab-indicator/);
    }
  });

  test("hover is neutral and only applies to unselected pills", () => {
    const hover = ruleBody(".shell-filter-pill:hover:not(.shell-filter-pill-active)")!;
    expect(hover).toMatch(/border-color:\s*var\(--tw-ink-soft\)/);
    expect(hover).toMatch(/background:\s*var\(--tw-surface-alt\)/);
  });
});

describe("one shared Teacher Workspace Back control", () => {
  test(".shell-back is a compact outlined navigation-teal pill", () => {
    const back = ruleBody(".shell-back")!;
    expect(back).toMatch(/border:\s*1px solid var\(--tw-nav-edge\)/);
    expect(back).toMatch(/color:\s*var\(--tw-nav-edge\)/);
    expect(back).toMatch(/border-radius:\s*var\(--tw-radius-pill\)/);
    expect(back).toMatch(/background:\s*transparent/);
    expect(back).toMatch(/font-weight:\s*600/);
    expect(back).toMatch(/(^|;)\s*margin:\s*0 0 0\.75rem 0;/);
    expect(ruleBody(".shell-back:hover")).toMatch(/background:\s*var\(--tw-nav-wash\)/);
  });

  test("the leading arrow is presentation only (empty alt text)", () => {
    expect(ruleBody(".shell-back::before")).toMatch(/content:\s*"\\2190"\s*\/\s*"";/);
  });

  test("touch contexts reach the 44px target", () => {
    expect(html).toMatch(
      /@media \(pointer: coarse\) \{\s*\.shell-back \{ min-height: 44px; \}/,
    );
  });

  test("the per-surface Back hook classes no longer carry their own visual rules", () => {
    for (const hook of [
      ".shell-integrations-back",
      ".shell-ss-back-btn",
      ".shell-classes-back-to-settings",
      ".shell-class-workspace-back",
      ".shell-student-detail-back",
      ".shell-lesson-summary-back",
      ".shell-assignment-detail-back",
    ]) {
      const styled = rules.filter((r) =>
        r.selectors.some((s) => s === hook || s.startsWith(`${hook}:`)),
      );
      expect({ hook, count: styled.length }).toEqual({ hook, count: 0 });
    }
  });

  test.each([
    ["settings/integrations/integrations.ts", 'back.className = "shell-back shell-integrations-back";'],
    ["shell/surfaces/settings.ts", 'backBtn.className = "shell-back shell-ss-back-btn";'],
    ["shell/surfaces/classes.ts", 'back.className = "shell-back shell-classes-back-to-settings";'],
    ["shell/surfaces/classes.ts", 'back.className = "shell-back shell-class-workspace-back";'],
    ["shell/surfaces/classes.ts", 'backBtn.className = "shell-back shell-student-detail-back";'],
    ["shell/surfaces/lessonSummary.ts", 'back.className = "shell-back shell-lesson-summary-back";'],
    ["assignments/detail/detail.ts", 'back.className = "shell-back shell-assignment-detail-back";'],
  ])("%s renders the shared Back class: %s", (file, line) => {
    expect(src(file)).toContain(line);
  });

  test("Integrations Back no longer borrows the sidebar nav-button class or a literal arrow", () => {
    const integrations = src("settings/integrations/integrations.ts");
    expect(integrations).not.toMatch(/shell-nav-button/);
    expect(integrations).not.toMatch(/"← Back/);
    expect(src("shell/surfaces/settings.ts")).not.toMatch(/"← Back/);
  });

  test("sequential Previous/Next and the public-lessons exit link stay separate families", () => {
    const classes = src("shell/surfaces/classes.ts");
    expect(classes).toContain('prevBtn.className = "shell-student-detail-nav-prev";');
    expect(classes).toContain('nextBtn.className = "shell-student-detail-nav-next";');
    expect(src("shell/surfaces/curriculum.ts")).toContain(
      'returnLink.className = "shell-return-link";',
    );
    expect(ruleBody(".shell-return-link")).not.toMatch(/--tw-nav-edge/);
  });
});

describe("solid navigation-teal focus outline on the changed families", () => {
  test.each([
    ".shell-curriculum-tab:focus-visible",
    ".shell-settings-tab:focus-visible",
    ".shell-filter-pill:focus-visible",
    ".shell-back:focus-visible",
  ])("%s uses --tw-focus-outline", (selector) => {
    expect(ruleBody(selector)).toMatch(/outline:\s*var\(--tw-focus-outline\)/);
  });

  test("no later rule suppresses that outline with the low-opacity ring", () => {
    for (const selector of [
      ".shell-curriculum-tab:focus-visible",
      ".shell-settings-tab:focus-visible",
      ".shell-filter-pill:focus-visible",
      ".shell-back:focus-visible",
    ]) {
      for (const r of rulesFor(selector)) {
        expect(r.body).not.toMatch(/outline:\s*none/);
        expect(r.body).not.toMatch(/--tw-focus-ring/);
      }
    }
  });
});

describe("content-action semantics are unchanged", () => {
  test("Assign stays primary green and View Summary stays gold", () => {
    const assignRules = rulesFor(".shell-lesson-assign").map((r) => r.body).join("\n");
    expect(assignRules).toMatch(/background:\s*#1f6b3d/);
    expect(ruleBody(".shell-btn-primary")).toMatch(/background:\s*var\(--tw-primary\)/);
    const summaryRules = rulesFor(".shell-lesson-view-summary").map((r) => r.body).join("\n");
    expect(summaryRules).toMatch(/--tw-gold/);
  });
});
