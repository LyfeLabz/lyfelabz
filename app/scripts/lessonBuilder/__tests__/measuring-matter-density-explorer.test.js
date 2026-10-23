/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * Measuring Matter Lab 4 Density Explorer contract.
 *
 * Runs the explorer's real script in jsdom against the source and both
 * generated outputs. Guards the science (density = mass / volume, one
 * variable changed at a time, a fixed Original Block), the model (one dot
 * per 5 g, square AREA proportional to volume), the predict / explore /
 * check sequence, mode switching and reset, and accessibility hooks.
 * Lab 4 is formative: ungraded, nothing stored or sent. True on-screen
 * layout is verified in the browser.
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
const HEADER = "<!-- ===== DENSITY EXPLORER (ungraded, nothing stored) ===== -->";
const STEPS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

function scriptOf(html) {
  const at = html.indexOf(HEADER);
  expect(at).toBeGreaterThan(-1);
  return html.slice(at).match(/<script>([\s\S]*?)<\/script>/)[1];
}

function load(rel) {
  const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const start = html.indexOf('<main id="main"');
  const end = html.indexOf("</main>", start);
  const dom = new JSDOM(`<body>${html.slice(start, end)}</main></body>`, { runScripts: "outside-only" });
  dom.window.eval(scriptOf(html));
  return { win: dom.window, doc: dom.window.document, html };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (t) => t.replace(/ /g, " ").replace(/\s+/g, " ").trim();

describe.each(FILES)("Measuring Matter Lab 4 Density Explorer in %s", (rel) => {
  let win, doc, html;
  beforeEach(() => {
    ({ win, doc, html } = load(rel));
  });

  const $ = (id) => doc.getElementById(id);
  const text = (id) => norm($(id).textContent);
  const click = (el) => el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  const slide = (id, value) => {
    const el = $(id);
    el.value = String(value);
    el.dispatchEvent(new win.Event("input"));
  };
  const result = () => [...$("dx-result").children].map((c) => norm(c.textContent));
  const mode = (key) => click(doc.querySelector(`.dx-mode[data-mode="${key}"]`));
  const pred = (key) => doc.querySelector(`.dx-pred[data-choice="${key}"]`);
  const opts = () => [...doc.querySelectorAll(".dx-opt")];
  const fmt = (d) => {
    const r = Math.round(d * 100) / 100;
    return (Math.abs(r - d) < 1e-9 ? "" : "≈ ") + r + " g/cm³";
  };
  const square = (svgId) => {
    const r = $(svgId).querySelector("rect.dx-square");
    return ["x", "y", "width", "height"].map((a) => Number(r.getAttribute(a)));
  };
  const dots = (svgId) =>
    [...$(svgId).querySelectorAll("circle.dx-dot")].map((c) => [Number(c.getAttribute("cx")), Number(c.getAttribute("cy"))]);
  const expectOriginalFixed = () => {
    expect(text("dx-orig-m")).toBe("40 g");
    expect(text("dx-orig-v")).toBe("20 cm³");
    expect(text("dx-orig-d")).toBe("2 g/cm³");
    expect(dots("dx-orig-svg")).toHaveLength(8);
  };
  const expectComparison = (m, v) => {
    const d = m / v;
    const want = d > 2 ? "Your block is more dense than the original."
      : d < 2 ? "Your block is less dense than the original."
      : "Both blocks have the same density.";
    expect(norm($("dx-result").textContent)).toContain(want);
  };

  describe("density section structure", () => {
    test("keeps the heading and bowling ball connection, then the Key Idea, Lab 4, and the tank lab", () => {
      const section = $("density");
      expect(section.querySelector(".section-title").textContent).toBe("Density: The Ratio of Mass to Volume");
      expect(section.querySelector(".section-desc").textContent).toContain("bowling ball and the beach ball");
      const all = [...section.querySelectorAll("*")];
      const at = (el) => all.indexOf(el);
      const key = [...section.querySelectorAll(".name-it")].find(
        (c) => c.querySelector(".name-it-label").textContent === "Key idea: Density"
      );
      // The Key Idea and the two balls share one row, formula first.
      const order = [key, section.querySelector(".observe-row"), $("dx-lab"), $("qp-density"), section.querySelector(".density-lab")];
      for (const el of order) expect(el).not.toBeNull();
      for (let i = 1; i < order.length; i++) expect(at(order[i - 1])).toBeLessThan(at(order[i]));
    });

    test("the Key Idea gives one formula and no longer claims two calculation methods", () => {
      const key = [...$("density").querySelectorAll(".name-it")].find(
        (c) => c.querySelector(".name-it-label").textContent === "Key idea: Density"
      );
      expect(key.querySelector(".dz-formula").textContent).toBe("Density = Mass ÷ Volume");
      expect(key.textContent).toContain("density is in g/cm³");
      expect(key.textContent).toContain("A volume in mL gives g/mL, the same number, because 1 mL = 1 cm³.");
      expect(key.textContent).not.toMatch(/two ways|calculated two/i);
      expect(key.querySelector("svg")).toBeNull();
    });

    test("the static two-block particle illustration is gone, not duplicated", () => {
      expect(doc.querySelectorAll("svg.dens-particles")).toHaveLength(0);
      expect(html).not.toContain("Block A · lower density");
      expect(doc.querySelectorAll("#dx-lab")).toHaveLength(1);
    });

    test("heading, title, intro, and mode labels match the approved copy", () => {
      const lab = $("dx-lab");
      expect(lab.querySelector(".mlab-tag").textContent).toBe("Lab 4 · Density Explorer");
      expect(lab.querySelector("h3.mlab-title").textContent).toBe("What Changes Density?");
      expect(lab.querySelector(".dx-intro").textContent).toBe(
        "Density depends on both mass and volume. Change one measurement while keeping the other the same. Watch what happens to the block and its density."
      );
      expect([...lab.querySelectorAll(".dx-mode")].map((b) => norm(b.textContent))).toEqual([
        "Investigation A: Change Mass", "Investigation B: Change Volume",
      ]);
      expect([...lab.querySelectorAll(".dx-block-name")].map((n) => n.textContent)).toEqual(["Original Block", "Your Block"]);
      expect(norm(lab.querySelector(".dx-key").textContent)).toBe(
        "Each dot represents 5 g. The size of each block shows its volume."
      );
    });

    test("one workspace holds both blocks and the control; badges are gone", () => {
      const work = $("dx-work");
      expect(work.querySelectorAll(".dx-block")).toHaveLength(2);
      expect(work.contains($("dx-mass"))).toBe(true);
      expect(work.contains($("dx-math"))).toBe(true);
      expect($("dx-lab").querySelectorAll(".dx-state, .dx-lock, .dx-explore, .dx-grid")).toHaveLength(0);
      // Each block shows mass, volume, and density once.
      for (const b of work.querySelectorAll(".dx-block")) {
        expect([...b.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["Mass", "Volume", "Density"]);
      }
    });

    test("states the model's limits without implying real materials change freely", () => {
      const about = $("dx-lab").querySelector("details.dx-about");
      expect(about.querySelector("summary").textContent).toBe("About this model");
      expect(about.open).toBe(false);
      const limit = about.querySelector(".dx-limit").textContent;
      expect(limit).toContain("This is a simplified model.");
      expect(limit).toContain("changes one measurement at a time");
      expect(limit).toContain("what it is made of or its conditions");
    });
  });

  describe("baseline", () => {
    test("both blocks start at 40 g, 20 cm³, and 2 g/cm³", () => {
      expectOriginalFixed();
      expect(text("dx-your-m")).toBe("40 g");
      expect(text("dx-your-v")).toBe("20 cm³");
      expect(text("dx-your-d")).toBe("2 g/cm³");
      expect(text("dx-math")).toBe("40 g ÷ 20 cm³ = 2 g/cm³");
      expect(result()).toEqual(["=", "Both blocks have the same density."]);
      expect(square("dx-your-svg")).toEqual(square("dx-orig-svg"));
      expect(dots("dx-your-svg")).toEqual(dots("dx-orig-svg"));
    });

    test("opens in Investigation A with the mass slider active and volume locked", () => {
      expect(doc.querySelector('.dx-mode[data-mode="mass"]').getAttribute("aria-pressed")).toBe("true");
      expect(doc.querySelector('.dx-mode[data-mode="volume"]').getAttribute("aria-pressed")).toBe("false");
      expect(text("dx-mode-title")).toBe("Change Mass, Keep Volume the Same");
      expect(text("dx-instruct")).toBe("Change mass. Volume stays at 20 cm³.");
      expect($("dx-mass").hidden).toBe(false);
      expect($("dx-vol").hidden).toBe(true);
      // The held variable's row is hidden; the one instruction names it.
      expect($("dx-vol-row").hidden).toBe(true);
      expect($("dx-mass-row").hidden).toBe(false);
      expect($("dx-lab").querySelectorAll(".dx-state, .dx-lock")).toHaveLength(0);
    });

    test("slider ranges and increments", () => {
      const attrs = (id) => ["min", "max", "step", "value"].map((a) => $(id).getAttribute(a));
      expect(attrs("dx-mass")).toEqual(["10", "100", "10", "40"]);
      expect(attrs("dx-vol")).toEqual(["10", "100", "10", "20"]);
      expect(doc.querySelector('label[for="dx-mass"]').textContent).toBe("Mass");
      expect(doc.querySelector('label[for="dx-vol"]').textContent).toBe("Volume");
    });
  });

  describe("Investigation A: change mass", () => {
    test.each(STEPS)("mass %i g keeps volume at 20 cm³ and density = mass ÷ volume", (m) => {
      slide("dx-mass", m);
      expect(text("dx-your-m")).toBe(`${m} g`);
      expect(text("dx-your-v")).toBe("20 cm³");
      expect(text("dx-your-d")).toBe(fmt(m / 20));
      expect(text("dx-math")).toBe(`${m} g ÷ 20 cm³ = ${m / 20} g/cm³`);
      expect(text("dx-mass-val")).toBe(`${m} g`);
      expect(text("dx-vol-val")).toBe("20 cm³");
      expectComparison(m, 20);
      expectOriginalFixed();
      // Same space, more or less matter: equal squares, one dot per 5 g.
      expect(square("dx-your-svg")).toEqual(square("dx-orig-svg"));
      expect(dots("dx-your-svg")).toHaveLength(m / 5);
    });

    test("increasing mass increases density, and decreasing it reverses that", () => {
      const d = () => parseFloat(text("dx-your-d"));
      slide("dx-mass", 80);
      expect(d()).toBe(4);
      slide("dx-mass", 100);
      expect(d()).toBe(5);
      slide("dx-mass", 20);
      expect(d()).toBe(1);
      slide("dx-mass", 10);
      expect(d()).toBe(0.5);
    });

    test("the locked volume cannot change while mass is the variable", () => {
      slide("dx-vol", 90);
      expect(text("dx-your-v")).toBe("20 cm³");
      expect($("dx-vol").value).toBe("20");
      expect(text("dx-your-d")).toBe("2 g/cm³");
    });

    test("adding mass adds dots without moving the existing ones", () => {
      slide("dx-mass", 40);
      const before = dots("dx-your-svg");
      slide("dx-mass", 80);
      expect(dots("dx-your-svg").slice(0, before.length)).toEqual(before);
    });
  });

  describe("Investigation B: change volume", () => {
    beforeEach(() => mode("volume"));

    test("switches the locked variable and the copy", () => {
      expect(text("dx-mode-title")).toBe("Change Volume, Keep Mass the Same");
      expect(text("dx-instruct")).toBe("Change volume. Mass stays at 40 g.");
      expect($("dx-vol").hidden).toBe(false);
      expect($("dx-mass").hidden).toBe(true);
      expect($("dx-mass-row").hidden).toBe(true);
      expect($("dx-vol-row").hidden).toBe(false);
    });

    test.each(STEPS)("volume %i cm³ keeps mass at 40 g and density = mass ÷ volume", (v) => {
      slide("dx-vol", v);
      expect(text("dx-your-m")).toBe("40 g");
      expect(text("dx-your-v")).toBe(`${v} cm³`);
      expect(text("dx-your-d")).toBe(fmt(40 / v));
      const exact = Math.abs(Math.round((40 / v) * 100) / 100 - 40 / v) < 1e-9;
      expect(text("dx-math")).toBe(`40 g ÷ ${v} cm³ ${exact ? "=" : "≈"} ${Math.round((40 / v) * 100) / 100} g/cm³`);
      expectComparison(40, v);
      expectOriginalFixed();
      // Same matter: the same 8 dots, spread over a square whose area tracks volume.
      expect(dots("dx-your-svg")).toHaveLength(8);
      const [, , w, h] = square("dx-your-svg");
      const [, , ow] = square("dx-orig-svg");
      expect(w).toBeCloseTo(h, 9);
      expect((w * w) / (ow * ow)).toBeCloseTo(v / 20, 9);
    });

    test("increasing volume decreases density, and decreasing it reverses that", () => {
      slide("dx-vol", 40);
      expect(text("dx-your-d")).toBe("1 g/cm³");
      slide("dx-vol", 80);
      expect(text("dx-your-d")).toBe("0.5 g/cm³");
      slide("dx-vol", 10);
      expect(text("dx-your-d")).toBe("4 g/cm³");
    });

    test("rounded densities say so and keep full precision for the comparison", () => {
      slide("dx-vol", 30);
      expect(text("dx-your-d")).toBe("≈ 1.33 g/cm³");
      expect(text("dx-math")).toBe("40 g ÷ 30 cm³ ≈ 1.33 g/cm³");
      expect(result()).toEqual(["<", "Your block is less dense than the original."]);
      slide("dx-vol", 70);
      expect(text("dx-your-d")).toBe("≈ 0.57 g/cm³");
    });

    test("the locked mass cannot change while volume is the variable", () => {
      slide("dx-mass", 90);
      expect(text("dx-your-m")).toBe("40 g");
      expect($("dx-mass").value).toBe("40");
    });

    test("squares sit on one floor line and stay inside the drawing at both extremes", () => {
      for (const v of [10, 100]) {
        slide("dx-vol", v);
        const [x, y, w, h] = square("dx-your-svg");
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + w).toBeLessThanOrEqual(200);
        expect(y + h).toBeLessThanOrEqual(196);
        expect(y + h).toBeCloseTo(square("dx-orig-svg")[1] + square("dx-orig-svg")[3], 9);
        for (const [cx, cy] of dots("dx-your-svg")) {
          expect(cx).toBeGreaterThan(x);
          expect(cx).toBeLessThan(x + w);
          expect(cy).toBeGreaterThan(y);
          expect(cy).toBeLessThan(y + h);
        }
      }
    });

    test("the same dots spread out: positions scale with the square", () => {
      const base = dots("dx-your-svg");
      slide("dx-vol", 80);
      const big = dots("dx-your-svg");
      expect(big).toHaveLength(base.length);
      const spread = (pts) => Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
      expect(spread(big)).toBeGreaterThan(spread(base));
    });
  });

  describe("comparison always agrees with the calculation", () => {
    test("for every value in both investigations", () => {
      for (const m of STEPS) {
        slide("dx-mass", m);
        expectComparison(m, 20);
      }
      mode("volume");
      for (const v of STEPS) {
        slide("dx-vol", v);
        expectComparison(40, v);
      }
    });

    test("uses a symbol and words, not color alone", () => {
      slide("dx-mass", 60);
      const sign = $("dx-result").querySelector(".dx-result-sign");
      expect(sign.textContent).toBe(">");
      expect(sign.getAttribute("aria-hidden")).toBe("true");
      slide("dx-mass", 20);
      expect($("dx-result").querySelector(".dx-result-sign").textContent).toBe("<");
    });
  });

  describe("mode switching and reset", () => {
    test("switching restores Your Block, the copy, and clears the other mode's answers", () => {
      slide("dx-mass", 90);
      click(pred("same"));
      click(opts()[0]);
      expect($("dx-fb").textContent).not.toBe("");
      mode("volume");
      expect(text("dx-your-m")).toBe("40 g");
      expect(text("dx-your-v")).toBe("20 cm³");
      expect($("dx-mass").value).toBe("40");
      expect(result()).toEqual(["=", "Both blocks have the same density."]);
      expect(text("dx-predict-q")).toBe("If mass stays the same but volume increases, what do you predict will happen to density?");
      expect([...doc.querySelectorAll(".dx-pred")].some((b) => b.getAttribute("aria-pressed") === "true")).toBe(false);
      expect(text("dx-predict-note")).toBe("Make a prediction, then move the slider to test it.");
      expect(text("dx-check-q")).toContain("Its volume doubles while its mass stays the same.");
      expect($("dx-fb").textContent).toBe("");
      expect($("dx-fb").className).toBe("tm-fb");
      expect(opts().some((b) => b.classList.contains("wrong") || b.classList.contains("right"))).toBe(false);
      mode("mass");
      expect(text("dx-check-q")).toContain("Its mass doubles while its volume stays the same.");
      expect(text("dx-your-d")).toBe("2 g/cm³");
    });

    test("pressing the active mode again changes nothing", () => {
      slide("dx-mass", 70);
      mode("mass");
      expect(text("dx-your-m")).toBe("70 g");
    });

    test("Reset Investigation restores the active mode's baseline and keeps the mode", () => {
      mode("volume");
      slide("dx-vol", 60);
      click($("dx-reset"));
      expect($("dx-vol").value).toBe("20");
      expect(text("dx-your-v")).toBe("20 cm³");
      expect(text("dx-your-d")).toBe("2 g/cm³");
      expect(doc.querySelector('.dx-mode[data-mode="volume"]').getAttribute("aria-pressed")).toBe("true");
      expect($("dx-vol").hidden).toBe(false);
      expectOriginalFixed();
    });
  });

  describe("Step 1: predict", () => {
    test("offers the three choices and saves a prediction without revealing the answer", () => {
      expect([...doc.querySelectorAll(".dx-pred")].map((b) => b.textContent)).toEqual([
        "Density increases.", "Density decreases.", "Density stays the same.",
      ]);
      expect(text("dx-predict-q")).toBe("If volume stays the same but mass increases, what do you predict will happen to density?");
      click(pred("down"));
      expect(pred("down").getAttribute("aria-pressed")).toBe("true");
      expect(pred("down").classList.contains("chosen")).toBe(true);
      const note = text("dx-predict-note");
      expect(note).toBe("Prediction saved: density decreases. Now move the mass slider above 40 g to test it.");
      expect(note).not.toMatch(/match|evidence/i);
    });

    test("can be changed until the evidence is in, then checks against it and stays put", () => {
      click(pred("down"));
      click(pred("up"));
      expect(pred("down").getAttribute("aria-pressed")).toBe("false");
      slide("dx-mass", 30);
      expect(text("dx-predict-note")).toContain("Prediction saved");
      slide("dx-mass", 60);
      expect(text("dx-predict-note")).toBe(
        "Your prediction matches the evidence. With the volume locked at 20 cm³, more mass gave a greater density."
      );
      expect(pred("up").getAttribute("aria-disabled")).toBe("true");
      click(pred("same"));
      expect(pred("up").getAttribute("aria-pressed")).toBe("true");
    });

    test("a mismatched prediction is answered with the evidence", () => {
      mode("volume");
      click(pred("same"));
      slide("dx-vol", 50);
      expect(text("dx-predict-note")).toBe(
        "You predicted density stays the same. The evidence shows something different. With the mass locked at 40 g, more volume gave a smaller density."
      );
    });

    test("skipping the prediction never blocks exploring", () => {
      slide("dx-mass", 100);
      expect(text("dx-your-d")).toBe("5 g/cm³");
      expect(text("dx-predict-note")).toBe("Make a prediction, then move the slider to test it.");
      click(pred("up"));
      expect(text("dx-predict-note")).toContain("Your prediction matches the evidence.");
    });

    test("hidden copies of every note reserve its space", () => {
      const sizers = [...$("dx-note-zone").querySelectorAll(".dx-note-sizer")];
      expect(sizers).toHaveLength(7);
      for (const s of sizers) expect(s.getAttribute("aria-hidden")).toBe("true");
    });
  });

  describe("Step 3: check your understanding", () => {
    const CASES = {
      mass: {
        q: "A block has a mass of 40 g and a volume of 20 cm³. Its mass doubles while its volume stays the same. What happens to its density?",
        correct: "It doubles from 2 g/cm³ to 4 g/cm³.",
        at: 1,
      },
      volume: {
        q: "A block has a mass of 40 g and a volume of 20 cm³. Its volume doubles while its mass stays the same. What happens to its density?",
        correct: "It decreases from 2 g/cm³ to 1 g/cm³.",
        at: 2,
      },
    };

    test.each(Object.keys(CASES))("%s: wrong answers explain, retries are unlimited, and the right answer locks", (key) => {
      const c = CASES[key];
      if (key === "volume") mode("volume");
      expect(text("dx-check-q")).toBe(c.q);
      const btns = opts();
      expect(btns).toHaveLength(3);
      expect(norm(btns[c.at].textContent)).toBe(c.correct);
      // Nothing is shown before the student answers.
      expect($("dx-fb").textContent).toBe("");
      expect($("dx-fb").classList.contains("visible")).toBe(false);
      const wrong = [0, 1, 2].filter((i) => i !== c.at);
      for (let round = 0; round < 3; round++) {
        for (const i of wrong) {
          click(btns[i]);
          expect(btns[i].classList.contains("wrong")).toBe(true);
          expect(btns.filter((b) => b.classList.contains("wrong"))).toHaveLength(1);
          expect($("dx-fb").className).toBe("tm-fb visible no");
          expect($("dx-fb").textContent).toMatch(/^Not quite\. .*Try \d+ g ÷ \d+ cm³\.$/);
        }
      }
      click(btns[c.at]);
      expect(btns[c.at].classList.contains("right")).toBe(true);
      expect(btns.some((b) => b.classList.contains("wrong"))).toBe(false);
      expect($("dx-fb").className).toBe("tm-fb visible ok");
      expect($("dx-fb").textContent).toMatch(/^Correct! /);
      for (const b of btns) expect(b.getAttribute("aria-disabled")).toBe("true");
      click(btns[wrong[0]]);
      expect($("dx-fb").textContent).toMatch(/^Correct! /);
    });

    test("correct feedback carries the right calculation", () => {
      click(opts()[1]);
      expect($("dx-fb").textContent).toContain("80 g ÷ 20 cm³ = 4 g/cm³");
      mode("volume");
      click(opts()[2]);
      expect($("dx-fb").textContent).toContain("40 g ÷ 40 cm³ = 1 g/cm³");
    });

    test("choices have comparable lengths and the answer moves between modes", () => {
      for (const key of ["mass", "volume"]) {
        mode(key);
        const lens = opts().map((b) => b.textContent.length);
        expect(Math.max(...lens) - Math.min(...lens)).toBeLessThanOrEqual(10);
      }
      expect(CASES.mass.at).not.toBe(CASES.volume.at);
    });

    test("feedback space is reserved by hidden copies of this mode's messages", () => {
      const sizers = () => [...$("dx-fb-zone").querySelectorAll(".tm-fb-sizer")];
      expect(sizers()).toHaveLength(3);
      for (const s of sizers()) expect(s.getAttribute("aria-hidden")).toBe("true");
      mode("volume");
      expect(sizers()).toHaveLength(3);
      expect(sizers().map((s) => s.textContent).join(" ")).toContain("40 g ÷ 40 cm³");
    });
  });

  describe("accessibility", () => {
    test("controls are labeled buttons and grouped", () => {
      const modes = doc.querySelector(".dx-modes");
      expect(modes.getAttribute("role")).toBe("group");
      expect(modes.getAttribute("aria-label")).toBe("Choose an investigation");
      for (const b of $("dx-lab").querySelectorAll("button")) expect(b.getAttribute("type")).toBe("button");
      for (const g of $("dx-lab").querySelectorAll('[role="group"][aria-labelledby]')) {
        expect(doc.getElementById(g.getAttribute("aria-labelledby")).textContent.trim().length).toBeGreaterThan(0);
      }
    });

    test("sliders report their value and the resulting density in words", () => {
      slide("dx-mass", 80);
      expect($("dx-mass").getAttribute("aria-valuetext")).toBe("80 grams. Density 4 grams per cubic centimeter.");
      mode("volume");
      slide("dx-vol", 30);
      expect($("dx-vol").getAttribute("aria-valuetext")).toBe("30 cubic centimeters. Density about 1.33 grams per cubic centimeter.");
    });

    test("block drawings are labeled images with text equivalents", () => {
      expect($("dx-orig-svg").getAttribute("role")).toBe("img");
      expect($("dx-orig-svg").getAttribute("aria-label")).toBe(
        "Original Block model: 8 dots of matter (40 g) in a square that stands for 20 cubic centimeters."
      );
      slide("dx-mass", 60);
      expect($("dx-your-svg").getAttribute("aria-label")).toBe(
        "Your Block model: 12 dots of matter (60 g) in a square that stands for 20 cubic centimeters. It is the same size as the Original Block and has more dots."
      );
      mode("volume");
      slide("dx-vol", 50);
      expect($("dx-your-svg").getAttribute("aria-label")).toBe(
        "Your Block model: 8 dots of matter (40 g) in a square that stands for 50 cubic centimeters. It is larger than the Original Block and has the same number of dots."
      );
    });

    test("announces comparison changes, not every slider step", async () => {
      const live = $("dx-announce");
      expect(live.getAttribute("aria-live")).toBe("polite");
      slide("dx-mass", 50);
      await wait(150);
      expect(live.textContent).toBe("Your block is more dense than the original.");
      live.textContent = "sentinel";
      slide("dx-mass", 60);
      slide("dx-mass", 70);
      await wait(150);
      expect(live.textContent).toBe("sentinel");
      slide("dx-mass", 40);
      await wait(150);
      expect(live.textContent).toBe("Both blocks have the same density.");
    });

    test("announces mode switches and resets", async () => {
      mode("volume");
      await wait(150);
      expect($("dx-announce").textContent).toBe(
        "Investigation B: Change Volume. The mass is locked at 40 g. Your Block starts at 20 cubic centimeters."
      );
      click($("dx-reset"));
      await wait(150);
      expect($("dx-announce").textContent).toBe(
        "Your Block is back to 40 g and 20 cubic centimeters. Both blocks have the same density."
      );
    });

    test("prediction and check feedback are live regions; answers keep focus", () => {
      expect($("dx-predict-note").getAttribute("aria-live")).toBe("polite");
      expect($("dx-fb").getAttribute("aria-live")).toBe("polite");
      const b = opts()[0];
      b.focus();
      click(b);
      expect(doc.activeElement).toBe(b);
      expect(b.disabled).toBe(false);
    });
  });

  test("is formative: no storage, network, or grading hooks", () => {
    const script = scriptOf(html);
    expect(script).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|google\.script|postMessage|score|assessment/i);
    expect($("dx-lab").querySelectorAll("form, [data-question], [data-assess]")).toHaveLength(0);
    expect($("dx-lab").textContent.match(/not graded/gi)).toHaveLength(1);
  });

  test("student-facing Lab 4 text has no em dashes", () => {
    expect($("dx-lab").textContent).not.toContain("—");
    expect(scriptOf(html)).not.toContain("—");
  });
});
