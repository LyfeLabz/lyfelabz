/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * Measuring Matter Engage hook-card semantics.
 *
 * Each mystery card has a heading, a native "Select to look closer" button
 * that controls the hidden observation, and a decorative icon kept out of
 * the accessibility tree. Revealing is one-way; the button then hides, so
 * focus moves to the revealed text. Mouse and touch users can still select
 * anywhere on the card. The no-jump layout itself (shared grid cell,
 * subgrid rows) is CSS and is guarded below by its rules.
 */

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "../../../..");
const FILES = [
  "lesson-sources/lesson_measuring-matter.html",
  "lesson_measuring-matter.html",
  "app/lessons/lesson_measuring-matter.html",
];
const HEADER = "<!-- ===== HOOK CARDS (button or card click to reveal) ===== -->";
const TITLES = ["Two Same-Size Balls", "The Invisible Stuff", "The Floating Giant"];

function load(rel) {
  const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const start = html.indexOf('<main id="main"');
  const end = html.indexOf("</main>", start);
  const at = html.indexOf(HEADER);
  expect(at).toBeGreaterThan(-1);
  const script = html.slice(at).match(/<script>([\s\S]*?)<\/script>/)[1];
  const dom = new JSDOM(`<body>${html.slice(start, end)}</main></body>`, { runScripts: "outside-only" });
  dom.window.eval(script);
  return { doc: dom.window.document, html };
}

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent("click", { bubbles: true }));

describe.each(FILES)("Measuring Matter hook cards in %s", (rel) => {
  let doc, html;
  const cards = () => [...doc.querySelectorAll("#hook .hook-card")];

  beforeEach(() => {
    ({ doc, html } = load(rel));
  });

  test("each card has a heading, a decorative icon, and a native button that controls its reveal", () => {
    expect(cards()).toHaveLength(3);
    cards().forEach((card, i) => {
      expect(card.getAttribute("role")).toBeNull();
      expect(card.hasAttribute("tabindex")).toBe(false);
      expect(card.querySelector(".hook-card-icon").getAttribute("aria-hidden")).toBe("true");
      const title = card.querySelector(".hook-card-name");
      expect(title.tagName).toBe("H3");
      expect(title.textContent).toBe(TITLES[i]);
      const btn = card.querySelector(".hook-card-prompt");
      expect(btn.tagName).toBe("BUTTON");
      expect(btn.getAttribute("type")).toBe("button");
      expect(btn.textContent).toBe("Select to look closer");
      expect(btn.getAttribute("aria-expanded")).toBe("false");
      expect(btn.getAttribute("aria-describedby")).toBe(title.id);
      const reveal = doc.getElementById(btn.getAttribute("aria-controls"));
      expect(reveal).toBe(card.querySelector(".hook-card-reveal"));
      expect(reveal.getAttribute("tabindex")).toBe("-1");
      expect(btn.contains(reveal)).toBe(false);
    });
    expect(doc.querySelectorAll('#hook [role="button"]')).toHaveLength(0);
  });

  test("the button reveals its card and moves focus to the revealed text", () => {
    const [first, second] = cards();
    const btn = first.querySelector(".hook-card-prompt");
    btn.focus();
    click(btn);
    expect(first.classList.contains("revealed")).toBe(true);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(doc.activeElement).toBe(first.querySelector(".hook-card-reveal"));
    expect(second.classList.contains("revealed")).toBe(false);
  });

  test("selecting the card body reveals it without moving focus", () => {
    const card = cards()[2];
    const before = doc.activeElement;
    click(card.querySelector(".hook-card-name"));
    expect(card.classList.contains("revealed")).toBe(true);
    expect(card.querySelector(".hook-card-prompt").getAttribute("aria-expanded")).toBe("true");
    expect(doc.activeElement).toBe(before);
  });

  test("revealing is one-way", () => {
    const card = cards()[1];
    const btn = card.querySelector(".hook-card-prompt");
    click(btn);
    click(card);
    click(btn);
    expect(card.classList.contains("revealed")).toBe(true);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  test("keeps the no-jump layout: prompt and reveal share one cell, the reveal hides until opened", () => {
    expect(html).toContain(".hook-card-prompt { grid-area: 3 / 1; justify-self: center; align-self: start; }");
    expect(html).toContain(".hook-card-reveal { grid-area: 3 / 1; visibility: hidden; }");
    expect(html).toContain(".hook-card.revealed .hook-card-prompt { visibility: hidden; }");
    expect(html).toMatch(/\.hook-card \{ grid-row: span 3; grid-template-rows: subgrid; row-gap: 0; \}/);
  });
});
