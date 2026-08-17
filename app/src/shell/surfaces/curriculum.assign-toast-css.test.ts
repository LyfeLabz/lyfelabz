/**
 * @jest-environment node
 *
 * Sprint 25 Phase 3 - B6 certification-found PRESENTATION defect regression.
 *
 * Browser certification proved the Assign lifecycle succeeds and showSuccess()
 * runs, yet the teacher saw no visible toast. Root cause was a served-document
 * CSS seam, not a DOM-state bug:
 *
 *   - showSuccess() (curriculum.ts) toggles the class
 *     `shell-curriculum-success-visible`, but the served document carried NO
 *     rule for that class. The fixed-toast presentation had been attached to
 *     the base `.shell-curriculum-success` class, where a later
 *     token-unification rule re-colored it with the ~8%-opaque inline callout
 *     token and no rule cleared the in-flow application header.
 *
 * The existing jsdom tests assert the DOM class is applied - they passed the
 * whole time the browser showed nothing, because jsdom does not load
 * app/index.html or apply its CSS. THESE tests instead read the exact document
 * Firebase Hosting serves for /app/teacher and pin the CSS that backs the
 * class the JavaScript actually toggles.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const INDEX_HTML = path.join(ROOT, "index.html");
const FIREBASE_JSON = path.join(ROOT, "..", "firebase.json");
const CURRICULUM_TS = path.resolve(__dirname, "curriculum.ts");

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

describe("B6 - /app/teacher served document is the file we assert on", () => {
  test("hosting serves root index.html and rewrites /app/** to /app/index.html", () => {
    const cfg = JSON.parse(fs.readFileSync(FIREBASE_JSON, "utf8"));
    // public "." means the repo root is the web root, so /app/index.html is
    // the on-disk app/index.html we read above.
    expect(cfg.hosting.public).toBe(".");
    const rewrite = cfg.hosting.rewrites.find(
      (r: { source: string }) => r.source === "/app/**",
    );
    expect(rewrite).toBeDefined();
    expect(rewrite.destination).toBe("/app/index.html");
  });
});

describe("B6 - JS toggle and CSS rule name agree (the seam that failed)", () => {
  const jsSource = fs.readFileSync(CURRICULUM_TS, "utf8");

  test("showSuccess() toggles shell-curriculum-success-visible", () => {
    expect(jsSource).toContain(
      'classList.add("shell-curriculum-success-visible")',
    );
    expect(jsSource).toContain(
      'classList.remove("shell-curriculum-success-visible")',
    );
  });

  test("served document defines a rule for the visible-state class", () => {
    // The class the JS adds must be backed by CSS in the served document.
    // A missing rule here is exactly the defect certification hit.
    expect(html).toContain("shell-curriculum-success-visible");
    const body = ruleBody(
      html,
      ".shell-curriculum-success.shell-curriculum-success-visible",
    );
    expect(body).not.toBeNull();
  });
});

describe("B6 - visible-state toast presentation is correct and reachable", () => {
  const body = ruleBody(
    html,
    ".shell-curriculum-success.shell-curriculum-success-visible",
  ) as string;

  test("the toast rule is present", () => {
    expect(body).not.toBeNull();
  });

  test("is a fixed, top-anchored, centered, layered toast", () => {
    expect(body).toMatch(/position:\s*fixed/);
    expect(body).toMatch(/left:\s*50%/);
    expect(body).toMatch(/transform:\s*translateX\(-50%\)/);
    expect(body).toMatch(/z-index:\s*\d+/);
  });

  test("top offset clears the in-flow application header", () => {
    // .shell-header height: max(38.88px wordmark line box, 44px coarse-pointer
    // targets) + 30.6px padding + 1px border ~= 70.5-75.6px. At the app's 16px
    // root a clearing offset must exceed ~4.7rem. Pin the derived 5.5rem.
    const m = body.match(/top:\s*([\d.]+)rem/);
    expect(m).not.toBeNull();
    const topRem = parseFloat((m as RegExpMatchArray)[1]);
    // 75.6px header / 16px root = 4.725rem. Require real clearance.
    expect(topRem).toBeGreaterThanOrEqual(4.8);
  });

  test("background is OPAQUE, not the ~8%-opaque callout token or an rgba tint", () => {
    const bg = body.match(/background:\s*([^;]+);/);
    expect(bg).not.toBeNull();
    const value = (bg as RegExpMatchArray)[1].trim();
    // Must not fall back to the translucent inline-callout token...
    expect(value).not.toContain("--tw-callout-success-bg");
    // ...and must not be a translucent rgba()/hsla() tint.
    expect(value).not.toMatch(/rgba\(|hsla\(/);
    // A solid 6-digit hex is opaque.
    expect(value).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  test("keeps strong readable success ink and does not push scroll via margin", () => {
    expect(body).toMatch(/color:\s*#175a31/);
    // In-flow vertical margin is neutralized so the fixed toast cannot shift
    // surrounding layout.
    expect(body).toMatch(/margin:\s*0\b/);
  });
});

describe("B6 - compound selector outranks the token-unification rule", () => {
  test("token rule for the base class still exists (cascade context)", () => {
    // The later single-class token rule re-colors .shell-curriculum-success;
    // the compound visible-state rule (specificity 0,2,0) must win over it.
    const tokenBody = ruleBody(html, ".shell-curriculum-success");
    expect(tokenBody).not.toBeNull();
  });

  test("visible-state selector carries higher specificity than the token rule", () => {
    // Two classes in the selector => specificity 0,2,0 > the token rule's
    // single class 0,1,0, so the toast wins regardless of source order.
    const selector = ".shell-curriculum-success.shell-curriculum-success-visible";
    const classCount = (selector.match(/\./g) ?? []).length;
    expect(classCount).toBe(2);
    expect(ruleBody(html, selector)).not.toBeNull();
  });
});
