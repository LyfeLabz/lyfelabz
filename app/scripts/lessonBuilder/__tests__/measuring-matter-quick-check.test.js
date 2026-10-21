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
  "<!-- ===== VOCABULARY EXPLORER (one term at a time; ungraded, nothing stored) ===== -->",
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

  describe("vocabulary explorer", () => {
    const TERMS = ["Matter", "Mass", "Volume", "Density", "Triple Beam Balance", "Graduated Cylinder"];
    const DEFS = {
      matter: ["Anything that has mass and takes up space (volume).", "The most common states of matter are solid, liquid, and gas."],
      mass: ["The amount of matter in an object.", "Mass is measured in grams (g) with a triple beam balance."],
      volume: ["The amount of space an object takes up.", "Volume is measured in cubic centimeters (cm³) with a ruler or in milliliters (mL) with a graduated cylinder."],
      density: ["A measure of how much matter is packed into a space.", "Density is the ratio of mass to volume: D = m ÷ V, in g/cm³ or g/mL."],
      balance: ["The lab tool scientists use to measure mass in grams.", "You slide weights along three beams until the pointer balances."],
      cylinder: ["A tall, marked container used to measure the volume of liquids (and odd-shaped objects) in milliliters (mL).", null],
    };
    const terms = () => [...doc.querySelectorAll("#vocab .vx-term")];
    const term = (key) => doc.querySelector(`#vocab .vx-term[data-term="${key}"]`);
    const pressed = () => terms().filter((t) => t.getAttribute("aria-pressed") === "true").map((t) => t.dataset.term);
    const shown = () => [...doc.querySelectorAll("#vocab .vx-panel")].filter((p) => !p.hidden).map((p) => p.dataset.term);
    const said = () => doc.getElementById("vx-announce").textContent;

    test("renders six accessible selectors, the intro, and exact definitions", () => {
      expect(terms().map((t) => t.querySelector(".gc-term").textContent)).toEqual(TERMS);
      for (const t of terms()) {
        expect(t.tagName).toBe("BUTTON");
        expect(t.getAttribute("type")).toBe("button");
        expect(t.querySelector(".vx-check").getAttribute("aria-hidden")).toBe("true");
        const panel = doc.getElementById(t.getAttribute("aria-controls"));
        expect(panel.dataset.term).toBe(t.dataset.term);
        const [lead, support] = DEFS[t.dataset.term];
        expect(panel.querySelector(".gc-lead").textContent).toBe(lead);
        expect(panel.querySelector(".gc-support")?.textContent ?? null).toBe(support);
      }
      expect(doc.querySelector("#vocab .section-desc").textContent).toBe("Select a word to explore its meaning.");
      expect(doc.querySelector("#vocab .vx-grid").getAttribute("role")).toBe("group");
      const live = [...doc.querySelectorAll("#vocab [aria-live]")];
      expect(live.map((el) => el.id)).toEqual(["vx-announce"]);
      expect(live[0].getAttribute("aria-atomic")).toBe("true");
      expect(doc.querySelector("#vocab .glossary-card")).toBeNull();
    });

    test("has no Compare mode markup", () => {
      expect(doc.querySelectorAll("#vocab .vx-mode, #vocab .vx-modes, #vx-info, #vx-status, #vx-guide, #vocab .vx-reserve")).toHaveLength(0);
      expect(doc.getElementById("vocab").textContent).not.toMatch(/compare/i);
      expect(scriptsOf(html)[0]).not.toMatch(/compar/i);
    });

    test("selects exactly one term, starting on Matter, and swaps the single panel", () => {
      expect(pressed()).toEqual(["matter"]);
      expect(shown()).toEqual(["matter"]);
      for (const key of Object.keys(DEFS)) {
        click(term(key));
        expect(pressed()).toEqual([key]);
        expect(shown()).toEqual([key]);
        for (const t of terms()) expect(["true", "false"]).toContain(t.getAttribute("aria-pressed"));
      }
      click(term("cylinder"));
      expect(pressed()).toEqual(["cylinder"]);
    });

    test("announces each new definition once through the persistent live region", async () => {
      click(term("mass"));
      await wait(150);
      expect(said()).toBe(
        "Mass. The amount of matter in an object. Mass is measured in grams (g) with a triple beam balance.",
      );
      doc.getElementById("vx-announce").textContent = "sentinel";
      click(term("mass"));
      await wait(150);
      expect(said()).toBe("sentinel");
      click(term("cylinder"));
      await wait(150);
      expect(said()).toBe(
        "Graduated Cylinder. A tall, marked container used to measure the volume of liquids (and odd-shaped objects) in milliliters (mL).",
      );
    });

    test("is ungraded: no storage, forms, or assessment hooks", () => {
      const script = scriptsOf(html)[0];
      expect(script).not.toMatch(/localStorage|sessionStorage|fetch\(|XMLHttpRequest|postMessage|submit|score|assessment/i);
      expect(doc.querySelectorAll("#vocab form, #vocab input, #vocab [data-question], #vocab [data-assess]")).toHaveLength(0);
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
