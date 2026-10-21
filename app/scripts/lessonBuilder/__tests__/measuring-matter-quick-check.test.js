/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * Measuring Matter vocabulary cards and Quick Check contract.
 *
 * Guards the visual redesign pilot: the canonical glossary-card markup
 * (one open at a time, chevron, aria-expanded), and the shared Quick Check
 * shell around every formative multiple-choice moment outside the final quiz.
 * Runs the lesson's real scripts in jsdom against the source and both
 * generated outputs, so gates, retries, and feedback keep their behavior.
 * Formative checks stay ungraded and collect nothing.
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
const SCRIPT_HEADERS = [
  "<!-- ===== GLOSSARY CARDS (click to expand only, one open at a time) ===== -->",
  "<!-- ===== PREDICT BEFORE REVEAL ===== -->",
  "<!-- ===== TOOL MATCH GAME ===== -->",
  "<!-- ===== PRACTICE PROBLEM STEPPER ===== -->",
  "<!-- ===== QUICK RECALL CHECKPOINTS ===== -->",
];

function scriptsOf(html) {
  return SCRIPT_HEADERS.map((header) => {
    const at = html.indexOf(header);
    expect(at).toBeGreaterThan(-1);
    return html.slice(at).match(/<script>([\s\S]*?)<\/script>/)[1];
  });
}

function load(rel) {
  const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const start = html.indexOf('<main id="main"');
  const end = html.indexOf("</main>", start);
  const dom = new JSDOM(`<body>${html.slice(start, end)}</main></body>`, {
    runScripts: "outside-only",
  });
  for (const script of scriptsOf(html)) dom.window.eval(script);
  return { win: dom.window, doc: dom.window.document, html };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent("click", { bubbles: true }));

describe.each(FILES)("Measuring Matter vocabulary and Quick Check in %s", (rel) => {
  let doc, html;
  beforeEach(() => {
    ({ doc, html } = load(rel));
  });

  describe("vocabulary cards", () => {
    test("use the canonical glossary-card markup with the standard intro", () => {
      const cards = [...doc.querySelectorAll("#vocab .glossary-card")];
      expect(cards.map((c) => c.querySelector(".gc-term").textContent)).toEqual([
        "Matter", "Mass", "Volume", "Density", "Triple Beam Balance", "Graduated Cylinder",
      ]);
      for (const card of cards) {
        expect(card.tagName).toBe("BUTTON");
        expect(card.getAttribute("type")).toBe("button");
        expect(card.getAttribute("aria-expanded")).toBe("false");
        const head = card.querySelector(":scope > .gc-head");
        expect(head.querySelector("span.gc-term")).not.toBeNull();
        const chev = head.querySelector("span.gc-chev");
        expect(chev.getAttribute("aria-hidden")).toBe("true");
        expect(chev.textContent).toBe("▾");
        expect(card.querySelector(":scope > .gc-def").textContent.trim().length).toBeGreaterThan(0);
      }
      expect(doc.querySelector("#vocab .section-desc").textContent).toBe(
        "Choose a card to see what each word means.",
      );
      expect(doc.querySelector("#vocab .gc-hint")).toBeNull();
    });

    test("open one card at a time and keep chevron and aria-expanded in sync", () => {
      const cards = [...doc.querySelectorAll("#vocab .glossary-card")];
      const state = () => cards.map((c) => [
        c.classList.contains("open"), c.getAttribute("aria-expanded"), c.querySelector(".gc-chev").textContent,
      ]);
      click(cards[1]);
      click(cards[3]);
      expect(state().filter(([open]) => open)).toHaveLength(1);
      expect(state()[3]).toEqual([true, "true", "▴"]);
      expect(state()[1]).toEqual([false, "false", "▾"]);
      click(cards[3]);
      expect(state().every(([open, exp, chev]) => !open && exp === "false" && chev === "▾")).toBe(true);
    });
  });

  describe("Quick Check shell", () => {
    test("wraps every formative check outside the quiz with an eyebrow", () => {
      const eyebrows = [...doc.querySelectorAll(".check-card > .check-eyebrow")].map((e) => e.textContent);
      expect(eyebrows).toEqual([
        "Predict", "Quick Check · Not graded", "Predict", "Quick Recall · 1 of 2", "Quick Recall · 2 of 2",
      ]);
      expect(doc.querySelectorAll("#quiz .check-card, #quiz .check-opt")).toHaveLength(0);
    });

    test("labels every option group by its question and styles every option", () => {
      const groups = [...doc.querySelectorAll('.check-card [role="group"], .worked-example [role="group"]')];
      expect(groups).toHaveLength(9);
      for (const g of groups) {
        const label = doc.getElementById(g.getAttribute("aria-labelledby"));
        expect(label).not.toBeNull();
        expect(label.textContent.trim().length).toBeGreaterThan(0);
        expect(g.querySelectorAll(".check-opt").length).toBe(3);
      }
      for (const btn of doc.querySelectorAll("button.check-opt")) expect(btn.getAttribute("type")).toBe("button");
    });

    test("state icons are hidden from the accessible name", () => {
      expect(html).toContain("content: '\\2713' / '';");
      expect(html).toContain("content: '\\2717' / '';");
    });

    test("formative scripts collect and send nothing", () => {
      for (const script of scriptsOf(html)) {
        expect(script).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|google\.script/);
      }
    });
  });

  describe("prediction gates", () => {
    test.each(["qp-air", "qp-density"])("%s locks one prediction and then reveals its content", async (id) => {
      const pause = doc.getElementById(id);
      const gated = doc.querySelector(`.predict-gated[data-gate="${id}"]`);
      const btns = [...pause.querySelectorAll(".predict-btn")];
      expect(gated.classList.contains("visible")).toBe(false);
      click(btns[2]);
      click(btns[0]);
      expect(btns.map((b) => b.classList.contains("chosen"))).toEqual([false, false, true]);
      expect(btns[2].getAttribute("aria-pressed")).toBe("true");
      expect(pause.classList.contains("locked")).toBe(true);
      await wait(300);
      expect(gated.classList.contains("visible")).toBe(true);
    });
  });

  describe("Pick the Right Tool", () => {
    test("a wrong pick stays focusable, is marked, and allows a retry", () => {
      const q = doc.querySelectorAll(".tm-question")[0];
      const btns = [...q.querySelectorAll(".tm-btn")];
      btns[0].focus();
      click(btns[0]);
      expect(btns[0].classList.contains("wrong")).toBe(true);
      expect(btns[0].getAttribute("aria-disabled")).toBe("true");
      expect(btns[0].disabled).toBe(false);
      expect(doc.activeElement).toBe(btns[0]);
      expect(q.querySelector(".tm-fb").className).toBe("tm-fb visible no");
      click(btns[1]);
      expect(btns[1].classList.contains("right")).toBe(true);
      expect(q.querySelector(".tm-fb").className).toBe("tm-fb visible ok");
      expect(btns.every((b) => b.getAttribute("aria-disabled") === "true")).toBe(true);
      click(btns[2]);
      expect(btns[2].classList.contains("wrong")).toBe(false);
    });

    test("solving all three shows the completion message", async () => {
      const done = doc.getElementById("tm-done");
      for (const q of doc.querySelectorAll(".tm-question")) {
        expect(done.classList.contains("visible")).toBe(false);
        click(q.querySelectorAll(".tm-btn")[Number(q.dataset.correct)]);
      }
      expect(done.classList.contains("visible")).toBe(true);
      await wait(150);
      expect(done.textContent).toMatch(/^🏆 Three for three!/);
    });
  });

  describe("density practice problem", () => {
    test("step 2 stays hidden until step 1 is answered correctly", async () => {
      const step2 = doc.getElementById("pp-step2-wrap");
      const s1 = [...doc.querySelectorAll("#pp-step1 .we-opt-btn")];
      click(s1[0]);
      expect(s1[0].getAttribute("aria-disabled")).toBe("true");
      expect(doc.getElementById("pp-fb1").className).toBe("we-fb visible no");
      await wait(400);
      expect(step2.classList.contains("visible")).toBe(false);
      click(s1[1]);
      await wait(400);
      expect(step2.classList.contains("visible")).toBe(true);
      const s2 = [...doc.querySelectorAll("#pp-step2 .we-opt-btn")];
      click(s2[2]);
      await wait(400);
      expect(doc.getElementById("pp-success").classList.contains("visible")).toBe(true);
    });
  });

  describe("Quick Recall", () => {
    test("a wrong answer offers Try Again, which resets, and a right answer locks", () => {
      const radios = [...doc.querySelectorAll("#qr1Opts input")];
      const fb = doc.getElementById("qr1Feedback");
      const retry = doc.getElementById("qr1Retry");
      radios[1].checked = true;
      click(doc.getElementById("qr1Check"));
      expect(radios[1].closest("label").classList.contains("wrong")).toBe(true);
      expect(fb.className).toBe("qr-feedback visible no");
      expect(retry.style.display).toBe("inline-flex");
      click(retry);
      expect(radios.every((r) => !r.checked && !r.disabled)).toBe(true);
      expect(radios[1].closest("label").className).toBe("check-opt");
      radios[0].checked = true;
      click(doc.getElementById("qr1Check"));
      expect(radios[0].closest("label").classList.contains("correct")).toBe(true);
      expect(fb.className).toBe("qr-feedback visible ok");
      expect(radios.every((r) => r.disabled)).toBe(true);
    });
  });
});
