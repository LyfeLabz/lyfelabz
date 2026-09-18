/**
 * @jest-environment node
 *
 * Historical Assignment Resolution, post-release UX patch (candidate-panel
 * contrast). Production finding: a teacher who had deselected a class's
 * checkbox (e.g. not intending to run this dialog's Assign/Update action
 * for that class in this session) saw the Set/Change Current candidate
 * panel and the Assignment History panel render as if disabled - nearly
 * every candidate row read as light gray, even though the candidates were
 * fully active, selectable, mutation-capable controls.
 *
 * Root cause: `.shell-assign-row-disabled > *:not(.shell-assign-row-
 * identity) { opacity: 0.5; }` dims every direct child of a deselected
 * row except the class name - and the Set/Change Current panel, its entry
 * toggle buttons, and the Assignment History toggle/panel are ALL direct
 * children of that same row (curriculum.ts appends each of them directly
 * to `row`). That blanket rule is correct for the row's genuinely inert
 * Topic/Date/Time inputs, but it accidentally caught two controls that are
 * NOT tied to whether the class is checked for this dialog's batch action:
 * Set/Change Current mutates the server-authoritative Current pointer
 * directly, and Assignment History is read-only inspection.
 *
 * These tests read the exact document Firebase Hosting serves for
 * /app/teacher and pin the CSS, following the established convention in
 * curriculum.assign-toast-css.test.ts (jsdom does not load app/index.html
 * or apply its CSS, so a DOM-level test cannot observe this).
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const INDEX_HTML = path.join(ROOT, "index.html");
const CURRICULUM_TS = path.resolve(__dirname, "curriculum.ts");

const html = fs.readFileSync(INDEX_HTML, "utf8");
const jsSource = fs.readFileSync(CURRICULUM_TS, "utf8");

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

/** Every rule (in source order) whose selector list contains one of
 *  `selectors` as a whole comma-separated entry. Used to find every place
 *  in the cascade that sets `opacity` for a given selector. */
const rulesTouching = (
  css: string,
  selector: string,
): ReadonlyArray<{ readonly selectorList: string; readonly body: string }> => {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = stripped.match(/[^{}]+\{[^{}]*\}/g) ?? [];
  const matches: Array<{ selectorList: string; body: string }> = [];
  for (const rule of rules) {
    const open = rule.indexOf("{");
    const prelude = rule.slice(0, open);
    const body = rule.slice(open + 1, rule.lastIndexOf("}"));
    const selectorList = prelude.trim();
    const selectors = selectorList.split(",").map((s) => s.trim());
    if (selectors.includes(selector)) {
      matches.push({ selectorList, body });
    }
  }
  return matches;
};

describe("row-disabled opacity leak: JS toggle and CSS selector agree", () => {
  test("setRowEnabled toggles the shell-assign-row-disabled class this fix targets", () => {
    expect(jsSource).toContain(
      'row.classList.toggle("shell-assign-row-disabled", !enabled)',
    );
  });
});

describe("original blanket dimming rule is unchanged (Topic/Date/Time controls still dim)", () => {
  test("the blanket rule still exists and still applies opacity: 0.5", () => {
    const body = ruleBody(
      html,
      ".shell-assign-row-disabled > *:not(.shell-assign-row-identity)",
    );
    expect(body).not.toBeNull();
    expect(body).toMatch(/opacity:\s*0\.5/);
  });
});

describe("Set/Change Current and Assignment History are exempted from the leak", () => {
  const EXEMPT_SELECTORS = [
    ".shell-assign-row-disabled > .shell-assign-row-set-current",
    ".shell-assign-row-disabled > .shell-assign-row-change-current",
    ".shell-assign-row-disabled > .shell-assign-row-current-panel",
    ".shell-assign-row-disabled > .shell-assign-row-history-toggle",
    ".shell-assign-row-disabled > .shell-assign-row-history-panel",
  ];

  test.each(EXEMPT_SELECTORS)(
    "%s is restored to opacity: 1 in the same declaration group",
    (selector) => {
      const body = ruleBody(html, selector);
      expect(body).not.toBeNull();
      expect(body).toMatch(/opacity:\s*1\b/);
    },
  );

  test("the override rule is a single declaration group covering all five controls", () => {
    // All five selectors share one rule body (a comma-separated selector
    // list) - not five separately drifting rules - so the override cannot
    // silently miss one of the controls in a future edit.
    const bodies = EXEMPT_SELECTORS.map((s) => ruleBody(html, s));
    const first = bodies[0];
    expect(first).not.toBeNull();
    for (const body of bodies) {
      expect(body).toBe(first);
    }
  });

  test("override selectors have equal specificity to the blanket rule and appear later in source order (reliable win, not luck)", () => {
    // .shell-assign-row-disabled > *:not(.shell-assign-row-identity) is two
    // classes (0,2,0): the row class plus the class named inside :not().
    // .shell-assign-row-disabled > .shell-assign-row-current-panel is also
    // two classes (0,2,0) - equal specificity, so source order decides.
    const blanketIndex = html.indexOf(
      ".shell-assign-row-disabled > *:not(.shell-assign-row-identity)",
    );
    const overrideIndex = html.indexOf(
      ".shell-assign-row-disabled > .shell-assign-row-set-current",
    );
    expect(blanketIndex).toBeGreaterThan(-1);
    expect(overrideIndex).toBeGreaterThan(-1);
    expect(overrideIndex).toBeGreaterThan(blanketIndex);
  });

  test("no OTHER row-disabled rule reintroduces a lower opacity for these five controls", () => {
    // Guards against a future edit adding a second, conflicting rule for
    // one of these selectors that would silently re-break the fix.
    for (const selector of EXEMPT_SELECTORS) {
      const matches = rulesTouching(html, selector);
      expect(matches.length).toBe(1);
    }
  });
});

describe("candidate and history text colors were not touched by this patch (not the actual defect)", () => {
  test("Set/Change candidate label color is unchanged - dark, readable, not touched", () => {
    const body = ruleBody(html, ".shell-assign-disambig-option");
    expect(body).not.toBeNull();
    expect(body).toMatch(/color:\s*#333\b/);
  });

  test("panel instructional heading color is unchanged - already an established secondary-but-readable tone elsewhere in this dialog", () => {
    const body = ruleBody(html, ".shell-assign-row-disambig-heading");
    expect(body).not.toBeNull();
    expect(body).toMatch(/color:\s*#555\b/);
  });

  test("recipient metadata color is unchanged - remains distinct secondary metadata styling", () => {
    const body = ruleBody(
      html,
      ".shell-assign-disambig-option .shell-assign-disambig-meta",
    );
    expect(body).not.toBeNull();
    expect(body).toMatch(/color:\s*#777\b/);
  });

  test("Current marker stays green and untouched", () => {
    const body = ruleBody(html, ".shell-assign-disambig-current-marker");
    expect(body).not.toBeNull();
    expect(body).toMatch(/color:\s*#1f6b3d\b/);
  });

  test("Assignment History item color is unchanged - same readable tone as Set/Change candidates", () => {
    const body = ruleBody(html, ".shell-assign-row-history-item");
    expect(body).not.toBeNull();
    expect(body).toMatch(/color:\s*#333\b/);
  });

  test("Assignment History Current marker stays green and untouched", () => {
    const body = ruleBody(html, ".shell-assign-row-history-current");
    expect(body).not.toBeNull();
    expect(body).toMatch(/color:\s*#1f6b3d\b/);
  });

  test("Set Current / Confirm button green treatment is unchanged - no button redesign", () => {
    // `.shell-assign-row-set-current` appears in two grouped rules (shared
    // sizing/padding, and the color-bearing green-outline treatment) - use
    // `rulesTouching` to find every rule naming it and confirm one of them
    // still carries the untouched green color.
    const matches = rulesTouching(html, ".shell-assign-row-set-current");
    expect(matches.length).toBeGreaterThan(0);
    expect(
      matches.some((m) => /color:\s*#1f6b3d\b/.test(m.body)),
    ).toBe(true);
  });
});

// Historical Assignment Resolution, post-release UX patch (CURRENT marker
// proximity + Current-row outline). The marker is the LAST child of the
// flex-row `.shell-assign-disambig-option` (verified structurally in
// curriculum.lifecycle.test.ts) - DOM order alone already puts it right
// after recipient metadata, separated only by the row's ordinary
// `gap: 0.4rem`. An earlier revision additionally applied
// `margin-left: auto`, which pushed the marker away to the row's far right
// edge; further human production feedback found that stranded too far
// from the metadata it labels, so `margin-left: auto` was removed in this
// patch - natural flex-gap proximity is sufficient and needs no extra
// mechanism.
describe("CURRENT marker sits at natural proximity to recipient metadata (no far-edge push)", () => {
  test("the marker rule no longer applies margin-left: auto or any other push-to-edge mechanism", () => {
    const body = ruleBody(html, ".shell-assign-disambig-current-marker") as string;
    expect(body).not.toBeNull();
    expect(body).not.toMatch(/margin-left/);
    expect(body).not.toMatch(/position:\s*absolute/);
    expect(body).not.toMatch(/left:\s*\d/);
  });

  test("the marker's own color/size/casing treatment is otherwise unchanged", () => {
    const body = ruleBody(html, ".shell-assign-disambig-current-marker") as string;
    expect(body).toMatch(/color:\s*#1f6b3d\b/);
    expect(body).toMatch(/text-transform:\s*uppercase\b/);
    expect(body).toMatch(/font-weight:\s*600\b/);
  });

  test("DOM order (pinned separately in curriculum.lifecycle.test.ts) plus the row's own gap is the only proximity mechanism", () => {
    const body = ruleBody(html, ".shell-assign-disambig-option") as string;
    expect(body).toMatch(/gap:\s*0\.4rem\b/);
  });
});

// Historical Assignment Resolution, post-release UX patch (Current-row
// outline). A subtle rectangular green outline identifies which candidate
// row is the valid Current occurrence, in addition to the textual CURRENT
// marker - a state indicator, not a button or a claim that the row (or its
// independently-disabled radio) is selectable. Keyed off the marker's own
// existing DOM presence via `:has()` (already an established pattern in
// this document), so it never duplicates the server-authoritative Current
// determination in a second place.
describe("Current-row outline identifies the Current candidate without implying interactivity", () => {
  test("the outline rule targets rows containing the CURRENT marker via :has(), not a new JS-only class", () => {
    const body = ruleBody(
      html,
      ".shell-assign-disambig-option:has(.shell-assign-disambig-current-marker)",
    );
    expect(body).not.toBeNull();
    expect(body).toMatch(/border:\s*1px solid #1f6b3d\b/);
  });

  test("the outline reuses the existing green border token already used by this component family, not a new color", () => {
    // `.shell-assign-row-set-current` / `.shell-assign-row-current-confirm`
    // already use `border: 1px solid #1f6b3d` for the analogous "current
    // green outline" treatment elsewhere in this same dialog.
    const matches = rulesTouching(html, ".shell-assign-row-set-current");
    expect(
      matches.some((m) => /border:\s*1px solid #1f6b3d\b/.test(m.body)),
    ).toBe(true);
    const outlineBody = ruleBody(
      html,
      ".shell-assign-disambig-option:has(.shell-assign-disambig-current-marker)",
    ) as string;
    expect(outlineBody).toMatch(/#1f6b3d\b/);
  });

  test("no background fill was added - the row keeps its base (transparent/hover-only) background", () => {
    const body = ruleBody(
      html,
      ".shell-assign-disambig-option:has(.shell-assign-disambig-current-marker)",
    ) as string;
    expect(body).not.toMatch(/background/);
  });

  test("the base row rule (shared by every candidate, Current or not) keeps its existing border-radius and padding untouched", () => {
    const body = ruleBody(html, ".shell-assign-disambig-option") as string;
    expect(body).toMatch(/border-radius:\s*4px\b/);
    expect(body).toMatch(/padding:\s*0\.3rem 0\.35rem\b/);
  });
});
