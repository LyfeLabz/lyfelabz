/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * Measuring Matter density-to-quiz sequence contract.
 *
 * Guards the streamlined ending: the big idea, Lab 4, and the Density
 * Challenge (prediction gate plus tank) lead straight into the unchanged
 * 10-question quiz, whose one Show Your Thinking question is the lesson's
 * essential question (Solve the Floating Giant Mystery). The worked example
 * and practice, the standalone wrap-up, the Brain Check, the Learning Goals
 * table, and the transition panels are retired. Runs the lesson's real
 * scripts in jsdom against the source and both generated outputs. Lab 4 has
 * its own suite (measuring-matter-density-explorer.test.js).
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
  "<!-- ===== PREDICT BEFORE REVEAL ===== -->",
  "<!-- ===== DENSITY LAB ===== -->",
];

function load(rel) {
  const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const start = html.indexOf('<main id="main"');
  const end = html.indexOf("</main>", start);
  const dom = new JSDOM(`<body>${html.slice(start, end)}</main></body>`, { runScripts: "outside-only" });
  for (const header of SCRIPT_HEADERS) {
    const at = html.indexOf(header);
    expect(at).toBeGreaterThan(-1);
    dom.window.eval(html.slice(at).match(/<script>([\s\S]*?)<\/script>/)[1]);
  }
  return { win: dom.window, doc: dom.window.document, html };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (t) => t.replace(/ /g, " ").replace(/\s+/g, " ").trim();

describe.each(FILES)("Measuring Matter density sequence in %s", (rel) => {
  let win, doc, html;
  beforeEach(() => {
    ({ win, doc, html } = load(rel));
  });
  const $ = (id) => doc.getElementById(id);
  const text = (el) => norm(el.textContent);
  const click = (el) => el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  const set = (id, v) => {
    $(id).value = String(v);
    $(id).dispatchEvent(new win.Event("input"));
  };

  describe("sequence", () => {
    test("the Density Challenge leads into buoyancy, then straight into the quiz", () => {
      const ids = [...doc.querySelectorAll("main > section")].map((s) => s.id);
      const at = ids.indexOf("density");
      expect(ids.slice(at, at + 3)).toEqual(["density", "buoyancy", "quiz"]);
      const sections = [...$("density").querySelectorAll(".dx-lab, .dz-challenge")];
      expect(sections.map((el) => el.id)).toEqual(["dx-lab", "dz-challenge"]);
    });

    test("section headings name the remaining components", () => {
      expect(text($("density").querySelector("h2"))).toBe("Density: The Ratio of Mass to Volume");
      expect(text($("dx-lab").querySelector("h3"))).toBe("What Changes Density?");
      expect(text($("dz-challenge").querySelector(".mlab-tag"))).toBe("Density Challenge");
      expect(text($("dz-challenge").querySelector("h3"))).toBe("Float or Sink?");
      expect($("quiz")).not.toBeNull();
    });

    test("redundant sections are retired with their scripts and styles", () => {
      const main = text(doc.querySelector("#main"));
      for (const id of ["recall", "practice", "synthesis"]) expect($(id)).toBeNull();
      for (const gone of ["Brain Check", "Your Learning Goals", "Sliders are easy", "Back to the Floating Giant", "Watch, Then Try", "Worked Example", "Your Turn"]) {
        expect(main).not.toContain(gone);
      }
      expect(doc.querySelectorAll(".summary-table, .wrapup-beat, .qr-card, .worked-example, .we-pair, .mystery, .wbc, [id^='pp-']")).toHaveLength(0);
      expect(html).not.toContain("PRACTICE PROBLEM STEPPER");
      expect(html).not.toMatch(/\.(we-pair|worked-example|we-step|we-opt-btn|wbc|mystery-a|wrapup-behavior-chips)\b/);
      expect(html).not.toMatch(/getElementById\('pp-/);
      expect(doc.querySelectorAll("#density .bridge-callout")).toHaveLength(0);
    });

    test("the goals and the essential question stay at the top of the lesson", () => {
      const goals = [...doc.querySelectorAll("#goals .goal-text")].map(text);
      expect(goals).toHaveLength(2);
      expect(goals[1]).toBe("Calculate density using mass and volume, and explain how density, water displacement, and buoyancy affect whether objects float or sink.");
      expect(html.indexOf("How can a giant steel ship float while a tiny pebble sinks?")).toBeLessThan(html.indexOf('id="goals"'));
    });

    test("nav links still resolve", () => {
      const nav = html.slice(html.indexOf('<ul class="nav-links"'), html.indexOf("</ul>", html.indexOf('<ul class="nav-links"')));
      const targets = [...nav.matchAll(/href="#([\w-]+)"/g)].map((m) => m[1]);
      expect(targets).toEqual(["vocab", "matter", "quiz", "continue", "connections"]);
      for (const id of targets) expect(html).toContain(`id="${id}"`);
    });
  });

  describe("the big idea", () => {
    test("one Key Idea with a prominent formula and both unit forms", () => {
      const key = $("density").querySelector(".dz-key");
      expect(text(key.querySelector(".name-it-label"))).toBe("Key idea: Density");
      expect(text(key.querySelector(".dz-formula"))).toBe("Density = Mass ÷ Volume");
      const body = text(key);
      expect(body).toContain("ratio of mass to volume");
      expect(body).toContain("g/cm³");
      expect(body).toContain("g/mL");
      expect(body).toContain("1 mL = 1 cm³");
      expect($("density").querySelectorAll(".name-it")).toHaveLength(1);
    });

    test("bowling ball and beach ball sit beside it", () => {
      const cards = [...$("density").querySelectorAll(".dz-idea .observe-card")].map(text);
      expect(cards).toEqual([
        "🎳 Bowling ball: lots of mass packed into its volume → high density.",
        "🏖️ Beach ball: very little mass spread across about the same volume → low density.",
      ]);
    });
  });

  describe("Density Challenge", () => {
    test("the prediction still gates the tank, inside one card", async () => {
      const card = $("dz-challenge");
      const pause = $("qp-density");
      const gated = card.querySelector('.predict-gated[data-gate="qp-density"]');
      expect(card.contains(pause)).toBe(true);
      expect(gated.classList.contains("density-lab")).toBe(true);
      expect(text(card.querySelector(".dz-challenge-sub"))).toContain("Water has a density of 1 g/mL.");
      expect(gated.classList.contains("visible")).toBe(false);
      click(pause.querySelectorAll(".predict-btn")[1]);
      await wait(300);
      expect(gated.classList.contains("visible")).toBe(true);
    });

    test("floats below 1 g/mL, sinks above, and explains once after both", async () => {
      const verdict = $("dl-verdict");
      const synth = $("dl-synthesis");
      expect(text($("dl-d-out"))).toBe("0.5 g/mL");
      expect(verdict.textContent).toContain("Floats");
      set("dl-mass", 200);
      set("dl-vol", 100);
      expect(text($("dl-d-out"))).toBe("2 g/mL");
      expect(verdict.textContent).toContain("Sinks");
      await wait(150);
      expect(text(synth)).toContain("An object floats when its density is less than water's 1 g/mL");
      set("dl-mass", 100);
      expect(verdict.textContent).toContain("exactly 1 g/mL");
    });
  });

  describe("Show Your Thinking: Solve the Floating Giant Mystery", () => {
    test("exactly one constructed-response question, with the approved wording", () => {
      expect(doc.querySelectorAll(".think-box")).toHaveLength(1);
      expect(doc.querySelectorAll("textarea")).toHaveLength(1);
      const box = $("mm-think");
      expect($("quiz").contains(box)).toBe(true);
      expect(text(box.querySelector(".think-eyebrow"))).toBe("🧠 Show Your Thinking");
      expect(text($("mm-think-title"))).toBe("Solve the Floating Giant Mystery");
      expect(text($("mm-think-prompt"))).toBe(
        "How can a giant steel ship float while a tiny pebble sinks? Explain your thinking using the words mass, volume, and density. Consider how the ship's shape and the water it displaces help it float."
      );
      expect(text($("mm-think-prompt"))).not.toMatch(/buoyan|Archimedes/i);
      expect($("mm-thinking").getAttribute("aria-label")).toBe("Explain how a giant steel ship can float while a tiny pebble sinks, using mass, volume, and density");
    });

    test("the model answer is scientifically complete", () => {
      const model = text($("mm-think-model"));
      expect(model).toContain("Steel itself is denser than water");
      expect(model).toContain("hollow and wide, so it surrounds a lot of space, much of it filled with air");
      expect(model).toContain("Divide the ship's total mass by its whole volume, including that space, and its average density is less than water's");
      expect(model).toContain("displaces, water, and the water pushes back up on the hull");
      expect(model).toContain("buoyant force");
      expect(model).toContain("until that upward push balances its weight");
      expect(model).toContain("A pebble is solid rock, which is denser than water");
      expect(model).toContain("smaller than its weight, so it sinks");
      expect(model).not.toMatch(/floats because it (contains|has|is full of) air/i);
      expect(model).not.toMatch(/steel is less dense/i);
    });

    test("the existing submission path still gates on and locks the response", () => {
      const at = html.indexOf("<!-- ===== QUIZ ===== -->");
      const quizScript = html.slice(at).match(/<script>([\s\S]*?)<\/script>/)[1];
      expect(quizScript).toContain("var mmThinkGate = document.getElementById('mm-thinking');");
      expect(quizScript).toContain("if (mmThinkGate && !mmThinkGate.value.trim()) return;");
      expect(quizScript).toContain("document.getElementById('mm-think-model').classList.add('show');");
      expect(quizScript).toContain("document.getElementById('mm-think-model').classList.remove('show');");
    });
  });

  describe("quiz results and mode toggle", () => {
    test("the scoreboard no longer repeats the mystery; the essential question stays at the start", () => {
      expect(html).not.toContain("mystery-loop");
      expect(html).not.toContain("The Mystery You Came In With");
      expect(doc.querySelector("#mm-score-num")).not.toBeNull();
      expect(doc.querySelector("#mm-score-msg")).not.toBeNull();
      expect(doc.querySelector("#mm-submit-status")).not.toBeNull();
      expect(html.split("How can a giant steel ship float while a tiny pebble sinks?").length - 1).toBeGreaterThanOrEqual(2);
    });

    test("v1 keeps both mode buttons and lets the toggle wrap instead of overflowing", () => {
      if (!html.includes('class="quiz-mode-toggle"')) return; // v2 has no legacy toggle
      expect([...doc.querySelectorAll(".quiz-mode-toggle .mode-btn")].map(text)).toEqual(["Practice Mode", "Classroom Mode"]);
      expect(doc.getElementById("btn-practice").classList.contains("active")).toBe(true);
      expect(doc.getElementById("btn-classroom").getAttribute("onclick")).toBe("mmSetQuizMode('classroom')");
      const rule = html.match(/\.quiz-mode-toggle \{[^}]*\}/)[0];
      expect(rule).toContain("max-width: 100%;");
      expect(rule).toContain("flex-wrap: wrap;");
      expect(html).toContain(".quiz-mode-toggle .mode-btn { flex: 1 1 auto; }");
    });
  });

  describe("large headings at enlarged text", () => {
    test("long heading words may wrap instead of widening the page (verified in the browser)", () => {
      expect(html).toContain("  .hero h1, .section-title, .mlab-heading { overflow-wrap: break-word; }");
      // The fix wraps text; it does not hide or scroll the headings.
      expect(html).not.toMatch(/\.(section-title|mlab-heading)[^{]*\{[^}]*overflow(-x)?:\s*(hidden|auto|scroll)/);
    });
  });

  describe("graded quiz boundary", () => {
    test("the quiz still has its ten questions and constructed response", () => {
      const at = html.indexOf("<!-- ===== QUIZ ===== -->");
      const quizScript = html.slice(at).match(/<script>([\s\S]*?)<\/script>/)[1];
      expect(quizScript.match(/^\s+q: "/gm)).toHaveLength(10);
      expect(quizScript.match(/^\s+correct: \d,/gm)).toHaveLength(10);
      expect(doc.querySelectorAll("#quiz .think-prompt")).toHaveLength(1);
      expect(doc.querySelectorAll("#quiz .check-card, #quiz .dx-lab")).toHaveLength(0);
    });
  });

  test("student-facing sequence text has no em dashes", () => {
    expect($("density").textContent).not.toContain("—");
    expect($("mm-think").textContent).not.toContain("—");
  });
});
