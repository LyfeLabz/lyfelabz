/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * Measuring Matter buoyancy contract.
 *
 * Guards the buoyancy enhancement: the "Why Does Water Push Up?" section
 * between the Density Challenge and the quiz, the Same Mass. Different
 * Shape. boat investigation (predict, investigate, explain, opened one
 * step at a time), the Lab 4
 * Step 4 evidence check, and the Floatia bridge. The investigation's real
 * script runs in jsdom against the source and both generated outputs, and
 * every number it shows is checked against one physical model: fresh water
 * at 1 g/mL, 40 g of a 2 g/cm³ material, so a floating shape displaces
 * exactly 40 mL and a sinking shape cannot displace 40 mL even when fully
 * underwater. Also guards that the 10-question quiz still matches its
 * published revision and that Show Your Thinking is unchanged in behavior.
 * True on-screen layout is verified in the browser.
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
  "<!-- ===== DENSITY EXPLORER (ungraded, nothing stored) ===== -->",
  "<!-- ===== BOAT SHAPE INVESTIGATION (ungraded, nothing stored) ===== -->",
];
const S = 18; // px per cm in the tank drawing
const TANK_AREA = 12 * 7; // cm², so the level rises 1 cm per 84 mL

function scriptAt(html, header) {
  const at = html.indexOf(header);
  expect(at).toBeGreaterThan(-1);
  return html.slice(at).match(/<script>([\s\S]*?)<\/script>/)[1];
}

function load(rel) {
  const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const start = html.indexOf('<main id="main"');
  const end = html.indexOf("</main>", start);
  const dom = new JSDOM(`<body>${html.slice(start, end)}</main></body>`, { runScripts: "outside-only" });
  for (const header of SCRIPT_HEADERS) dom.window.eval(scriptAt(html, header));
  return { win: dom.window, doc: dom.window.document, html };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (t) => t.replace(/ /g, " ").replace(/\s+/g, " ").trim();

describe.each(FILES)("Measuring Matter buoyancy in %s", (rel) => {
  let win, doc, html;
  beforeEach(() => {
    ({ win, doc, html } = load(rel));
  });

  const $ = (id) => doc.getElementById(id);
  const text = (el) => norm((typeof el === "string" ? $(el) : el).textContent);
  const click = (el) => el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  const shapeBtn = (key) => doc.querySelector(`.by-shape[data-shape="${key}"]`);
  const pred = (key) => doc.querySelector(`.by-pred[data-choice="${key}"]`);
  const opts = () => [...doc.querySelectorAll(".by-opt")];
  const num = (id) => Number(text(id).replace(/^≈\s*/, "").match(/^[\d.]+/)[0]);
  const readouts = () => ({
    mass: num("by-mass"),
    overall: num("by-vol"),
    displaced: num("by-disp"),
    weight: num("by-weight-val"),
    buoyant: num("by-up-val"),
    verdict: text("by-verdict"),
  });
  const geom = () => {
    const g = $("by-g");
    const lines = [...g.querySelectorAll("line")];
    const level = Number(lines.find((l) => !l.classList.contains("by-start")).getAttribute("y1"));
    const startY = Number(g.querySelector("line.by-start").getAttribute("y1"));
    const under = g.querySelector("rect.by-under");
    const obj = g.querySelector(".by-object");
    let top, bottom;
    if (obj.tagName === "rect") {
      top = Number(obj.getAttribute("y"));
      bottom = top + Number(obj.getAttribute("height"));
    } else {
      const ys = obj.getAttribute("d").match(/-?[\d.]+/g).map(Number);
      // "M x top V bottom H x2 V top"
      top = ys[1];
      bottom = ys[2];
    }
    return { level, startY, top, bottom, underTop: Number(under.getAttribute("y")) };
  };

  describe("placement and explanation", () => {
    test("sits between the Density Challenge and the quiz, after Lab 4 and the challenge", () => {
      const ids = [...doc.querySelectorAll("main > section")].map((s) => s.id);
      const at = ids.indexOf("buoyancy");
      expect(ids.slice(at - 1, at + 2)).toEqual(["density", "buoyancy", "quiz"]);
      expect($("density").contains($("dz-challenge"))).toBe(true);
      expect($("buoyancy").contains($("by-lab"))).toBe(true);
    });

    test("teaches buoyancy, displacement and the floating rule in one short key idea", () => {
      const sec = $("buoyancy");
      expect(text(sec.querySelector(".section-title"))).toBe("Why Does Water Push Up?");
      expect(text(sec.querySelector(".section-label"))).toBe("Explain · Meet Buoyancy");
      const key = sec.querySelector(".name-it");
      expect(text(key.querySelector(".name-it-label"))).toBe("Key idea: Buoyancy");
      expect(text(key)).toContain(
        "When an object goes into water, it pushes water aside. This is called water displacement. The water pushes back up. That upward push is the buoyant force."
      );
      expect(text(sec.querySelector(".by-rule"))).toBe("An object floats when the upward buoyant force balances its weight.");
      // One explanation block before the lab: no extra paragraphs or side cards.
      expect(sec.querySelectorAll(".section-desc, .observe-card, .by-link")).toHaveLength(0);
    });

    test("says sinking objects are pushed up too, and gives the 1 mL to 1 g link", () => {
      expect(text($("buoyancy").querySelector(".by-note"))).toBe(
        "Every 1 mL of water pushed aside can hold up 1 g. Sinking objects get this push too, just not enough of it."
      );
      // Grade 6 scope: no formal Archimedes equation and no required force math.
      expect(text("buoyancy")).not.toMatch(/Archimedes|newton|F\s*=|ρ/i);
    });

    test("does not reveal the Floating Giant model answer before the quiz", () => {
      const all = text("buoyancy");
      expect(all).not.toMatch(/steel|pebble|ship/i);
      for (const phrase of ["Steel itself is denser than water", "A pebble is solid rock", "One strong way to say it"]) {
        expect(all).not.toContain(phrase);
      }
      expect($("mm-think-model").classList.contains("show")).toBe(false);
      expect($("quiz").contains($("mm-think-model"))).toBe(true);
    });
  });

  describe("Same Mass. Different Shape.", () => {
    test("asks a short prediction and starts on the compact solid", () => {
      expect(text($("by-lab").querySelector(".mlab-title"))).toBe("Same Mass. Different Shape.");
      expect(text("by-predict-q")).toBe("Same 40 g. Same material. Which shape floats?");
      expect([...doc.querySelectorAll(".by-pred")].map(text)).toEqual(["The compact solid", "Both act the same", "The hollow boat"]);
      expect([...doc.querySelectorAll(".by-shape")].map(text)).toEqual(["Solid", "Boat"]);
      expect(shapeBtn("compact").getAttribute("aria-pressed")).toBe("true");
      expect(shapeBtn("hull").getAttribute("aria-pressed")).toBe("false");
    });

    test("opens one step at a time: tank after a prediction, check after the boat", () => {
      expect($("by-work").hidden).toBe(true);
      expect($("by-check").hidden).toBe(true);
      expect($("by-reveal").hidden).toBe(true);
      click(pred("compact"));
      expect($("by-work").hidden).toBe(false);
      expect($("by-check").hidden).toBe(true);
      click(shapeBtn("hull"));
      expect($("by-check").hidden).toBe(false);
      expect($("by-reveal").hidden).toBe(false);
      click(shapeBtn("compact"));
      expect($("by-check").hidden).toBe(false); // stays open once the comparison is made
      expect(html).toContain(".by-lab [hidden] { display: none; }");
    });

    test("both shapes have the same mass, and the material's density never changes", () => {
      const a = readouts();
      click(shapeBtn("hull"));
      const b = readouts();
      expect(a.mass).toBe(40);
      expect(b.mass).toBe(40);
      expect(a.weight).toBe(40);
      expect(b.weight).toBe(40);
      expect(text("by-reveal")).toBe(
        "The material is still 2 g/cm³. The boat's average density is lower because its volume includes air."
      );
      // Explanations never claim it; only the wrong check choice names the misconception.
      const lab = $("by-lab").cloneNode(true);
      lab.querySelectorAll(".by-opt").forEach((b) => b.remove());
      expect(text(lab)).not.toMatch(/material (becomes|became|gets|got) less dense/i);
    });

    test("the compact solid cannot displace enough water, even fully underwater", () => {
      const r = readouts();
      expect(r.overall).toBe(20); // 40 g ÷ 2 g/cm³, all material
      expect(r.displaced).toBe(r.overall); // fully underwater: the most it can push aside
      expect(r.buoyant).toBe(r.displaced * 1); // fresh water: 1 mL holds up 1 g
      expect(r.buoyant).toBeLessThan(r.mass);
      expect(r.verdict).toBe("✗ Result: Sinks");
      expect(text("by-explain")).toBe("Only 20 mL pushed aside. Water still pushes up, but 20 g of push can't hold up 40 g. It sinks.");
      expect($("by-up-bar").style.width).toBe("50%");
    });

    test("the hollow hull floats when the displaced water exactly balances its weight", () => {
      click(shapeBtn("hull"));
      const r = readouts();
      expect(r.overall).toBe(120); // 8 × 5 × 3 cm: 20 cm³ material + 100 cm³ air
      expect(r.displaced).toBe(40); // equilibrium: mass ÷ water density
      expect(r.displaced).toBeLessThan(r.overall); // partly above the surface
      expect(r.buoyant).toBe(r.mass);
      expect(r.verdict).toBe("✓ Result: Floats");
      expect(text("by-explain")).toBe("40 mL pushed aside. 40 g of push balances 40 g. It floats.");
      expect($("by-up-bar").style.width).toBe("100%");
    });

    test("shows only three plain readouts at once", () => {
      expect([...doc.querySelectorAll(".by-val dt")].map(text)).toEqual(["Mass", "Volume", "Water pushed aside"]);
      expect(doc.querySelectorAll(".by-val small")).toHaveLength(0);
    });

    test("the drawing is to scale and follows the numbers", () => {
      // Compact: rests on the floor, fully below the raised water level.
      let g = geom();
      expect(g.startY).toBe(184 - 5 * S);
      expect(g.startY - g.level).toBeCloseTo((20 / TANK_AREA) * S, 1);
      expect(g.bottom).toBeCloseTo(184, 5);
      expect(g.bottom - g.top).toBeCloseTo(Math.cbrt(20) * S, 1);
      expect(g.top).toBeGreaterThan(g.level);
      // Hull: the level rises twice as far, and exactly 1 cm of hull is underwater.
      click(shapeBtn("hull"));
      g = geom();
      expect(g.startY - g.level).toBeCloseTo((40 / TANK_AREA) * S, 1);
      expect(g.bottom - g.level).toBeCloseTo(1 * S, 1);
      expect(g.bottom - g.top).toBeCloseTo(3 * S, 1);
      expect(g.top).toBeLessThan(g.level);
      expect(g.underTop).toBeCloseTo(g.level, 1); // the outline marks only the underwater part
      expect($("by-svg").getAttribute("aria-label")).toBe(
        "Side view of the tank. The hollow hull floats with 1 cm of its 3 cm height underwater. It pushed aside 40 mL of water, so the water level rose about 0.48 cm."
      );
      click(shapeBtn("compact"));
      expect($("by-svg").getAttribute("aria-label")).toBe(
        "Side view of the tank. The compact solid rests on the bottom, fully underwater. It pushed aside 20 mL of water, so the water level rose about 0.24 cm."
      );
    });

    test("the model notes hold the assumptions, the average densities, and a flooded hull", () => {
      const about = text($("by-lab").querySelector(".dx-about"));
      expect(about).toContain("Fresh water: each 1 mL pushed aside can hold up 1 g. 1 mL is the same space as 1 cm³.");
      expect(about).toContain("Reshaping never changes the material's density.");
      expect(about).toContain("8 cm long, 5 cm wide, and 3 cm tall: 20 cm³ of material around 100 cm³ of air, 120 cm³ in all.");
      expect(about).toContain("solid 40 g ÷ 20 cm³ = 2 g/cm³; boat 40 g ÷ 120 cm³ ≈ 0.33 g/cm³, less than water's 1 g/mL.");
      expect(about).toContain("A boat that fills with water acts like its 20 cm³ of material and sinks.");
      expect($("by-lab").querySelector(".dx-about").hasAttribute("open")).toBe(false);
    });

    test("prediction: saved at once, answered by the evidence once both shapes are seen", () => {
      expect(text("by-predict-note")).toBe("Make a prediction to open the investigation.");
      click(pred("compact"));
      expect(pred("compact").getAttribute("aria-pressed")).toBe("true");
      expect(text("by-predict-note")).toBe("Prediction saved: the compact solid. Now try both shapes below.");
      click(pred("same"));
      expect(pred("compact").getAttribute("aria-pressed")).toBe("false");
      expect(text("by-predict-note")).toContain("Prediction saved: both act the same.");
      click(shapeBtn("hull"));
      expect(text("by-predict-note")).toBe("The evidence shows something different. The solid sank and the boat floated.");
      for (const b of doc.querySelectorAll(".by-pred")) expect(b.getAttribute("aria-disabled")).toBe("true");
      click(pred("hull"));
      expect(pred("same").getAttribute("aria-pressed")).toBe("true");
    });

    test("prediction: a matching prediction says so, and comparisons can be repeated", () => {
      click(pred("hull"));
      click(shapeBtn("hull"));
      expect(text("by-predict-note")).toBe("Your prediction matched. The solid sank and the boat floated.");
      for (let i = 0; i < 3; i++) {
        click(shapeBtn("compact"));
        expect(readouts().verdict).toBe("✗ Result: Sinks");
        click(shapeBtn("hull"));
        expect(readouts().verdict).toBe("✓ Result: Floats");
      }
    });

    test("explain check: short choices, feedback for each, retries, locks on the right one", () => {
      expect(text("by-check-q")).toBe("Why does the boat float?");
      expect(opts().map(text)).toEqual([
        "Its material became less dense",
        "It pushes aside enough water to balance its weight",
        "It lost some mass",
      ]);
      click(pred("same"));
      click(shapeBtn("hull"));
      click(opts()[0]);
      expect(opts()[0].classList.contains("wrong")).toBe(true);
      expect(text("by-fb")).toContain("The material is 2 g/cm³ in both shapes.");
      click(opts()[2]);
      expect(opts()[0].classList.contains("wrong")).toBe(false);
      expect(text("by-fb")).toContain("Both shapes are the same 40 g.");
      click(opts()[1]);
      expect(opts()[1].classList.contains("right")).toBe(true);
      const fb = text("by-fb");
      for (const idea of ["120 cm³", "push aside 40 mL of water", "40 g weight", "only 20 mL"]) expect(fb).toContain(idea);
      for (const b of opts()) expect(b.getAttribute("aria-disabled")).toBe("true");
      click(opts()[0]);
      expect(text("by-fb")).toBe(fb);
    });

    test("has one check only: the sinking-object check is folded into the key idea and result", () => {
      expect(doc.querySelectorAll("#by-lab .check-card")).toHaveLength(2); // predict + explain
      expect($("by-sink")).toBeNull();
    });

    test("reset returns to the compact solid, clears the prediction and check, and closes the steps", () => {
      click(pred("hull"));
      click(shapeBtn("hull"));
      click(opts()[1]);
      click($("by-reset"));
      expect(shapeBtn("compact").getAttribute("aria-pressed")).toBe("true");
      expect(readouts().verdict).toBe("✗ Result: Sinks");
      expect([...doc.querySelectorAll(".by-pred")].some((b) => b.getAttribute("aria-pressed") === "true")).toBe(false);
      expect(text("by-predict-note")).toBe("Make a prediction to open the investigation.");
      expect(opts().some((b) => b.classList.contains("right") || b.hasAttribute("aria-disabled"))).toBe(false);
      expect(text("by-fb")).toBe("");
      expect($("by-work").hidden).toBe(true);
      expect($("by-check").hidden).toBe(true);
    });

    test("announces each switch politely", async () => {
      click(pred("hull"));
      click(shapeBtn("hull"));
      await wait(150);
      expect(text("by-announce")).toBe("Boat: floats. 40 mL pushed aside. 40 g of push balances 40 g. It floats.");
      expect($("by-announce").getAttribute("aria-live")).toBe("polite");
    });

    test("is keyboard and screen-reader ready, with no dragging", () => {
      const lab = $("by-lab");
      for (const b of lab.querySelectorAll("button")) expect(b.getAttribute("type")).toBe("button");
      expect(lab.querySelectorAll("input, [draggable], [tabindex]")).toHaveLength(0);
      for (const g of lab.querySelectorAll('[role="group"]')) {
        const named = g.getAttribute("aria-label") || text(doc.getElementById(g.getAttribute("aria-labelledby")));
        expect(named.length).toBeGreaterThan(0);
      }
      expect($("by-svg").getAttribute("role")).toBe("img");
      expect(lab.querySelector(".by-forces").getAttribute("aria-hidden")).toBe("true"); // bars repeat by-explain
      expect(lab.querySelectorAll(".by-shape[aria-pressed]")).toHaveLength(2);
      for (const id of ["by-predict-note", "by-fb", "by-announce"]) expect($(id).getAttribute("aria-live")).toBe("polite");
      expect(text("by-verdict")).toMatch(/Result: (Floats|Sinks)/); // never color alone
      // Feedback and notes reserve their largest size, so answering never shifts the lab.
      expect($("by-fb-zone").querySelectorAll(".tm-fb-sizer")).toHaveLength(3);
      expect($("by-note-zone").querySelectorAll(".dx-note-sizer")).toHaveLength(7);
    });

    test("says not graded once and stores or sends nothing", () => {
      const script = scriptAt(html, SCRIPT_HEADERS[1]);
      expect(script).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|google\.script|postMessage|score|assessment|lessonQuiz/i);
      expect($("by-lab").textContent.match(/not graded/gi)).toHaveLength(1);
      expect($("buoyancy").querySelectorAll("form, textarea, [data-question], [data-assess]")).toHaveLength(0);
    });

    test("bridges to Floatia without giving away a design", () => {
      expect(text($("by-lab").querySelector(".by-bridge"))).toBe("Engineers use this idea when they design boats.");
      // Student-facing text only; the Educator Mode note names Floatia for teachers.
      const sec = $("buoyancy").cloneNode(true);
      sec.querySelectorAll(".edu-note").forEach((n) => n.remove());
      const all = text(sec);
      expect(all).not.toMatch(/Floatia|penn(y|ies)|foil|best (shape|design|hull)|optimal|to win|biggest|most cargo|maximum load|budget|purchase/i);
    });

    test("student-facing buoyancy text has no em dashes", () => {
      expect($("buoyancy").textContent).not.toContain("\u2014");
      expect(scriptAt(html, SCRIPT_HEADERS[1])).not.toContain("\u2014");
    });
  });

  describe("responsive styles", () => {
    test("stacks the tank and readouts by the lab's own width and keeps touch targets", () => {
      expect(html).toContain("@container dx-lab (max-width: 46rem) { .by-grid { grid-template-columns: minmax(0, 1fr); } }");
      expect(html).toMatch(/\.dx-mode \{[^}]*min-height: 48px;/);
      expect(html).toMatch(/\.dx-reset \{[^}]*min-height: 44px;/);
      expect(html).toMatch(/\.check-opt \{[^}]*min-height: 48px;/);
      expect($("by-lab").classList.contains("dx-lab")).toBe(true); // shares the Lab 4 card shell and large-text rules
      expect(html).not.toMatch(/\.by-[a-z-]+[^{]*\{[^}]*overflow(-x)?:\s*(auto|scroll)/);
    });

    test("lays out eight vocabulary words in at most four columns that give way to enlarged text", () => {
      expect(html).toContain(".vx-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, max(12rem, calc((100% - 2.25rem) / 4))), 1fr));");
      expect(html).toContain("@media (max-width: 720px) { .vx-grid { grid-template-columns: repeat(auto-fit, minmax(min(100%, max(9rem, calc((100% - 0.75rem) / 2))), 1fr)); } }");
    });
  });

  describe("Lab 4 Step 4: Explain With Evidence", () => {
    const why = () => [...doc.querySelectorAll(".dx-why-opt")];
    const mode = (key) => click(doc.querySelector(`.dx-mode[data-mode="${key}"]`));
    const slide = (id, value) => {
      $(id).value = String(value);
      $(id).dispatchEvent(new win.Event("input"));
    };

    test("follows Step 3 inside Lab 4 and asks the approved question", () => {
      expect($("dx-lab").contains($("dx-why"))).toBe(true);
      expect($("dx-check").nextElementSibling).toBe($("dx-why"));
      expect(text($("dx-why").querySelector(".check-eyebrow"))).toBe("Step 4 · Explain With Evidence");
      expect(text("dx-why-q")).toBe(
        "When the volume stayed the same and the mass increased, what happened to density? Use evidence from the two blocks."
      );
      mode("volume");
      expect(text("dx-why-q")).toBe(
        "When the mass stayed the same and the volume increased, what happened to density? Use evidence from the two blocks."
      );
    });

    test("Investigation A: asks for evidence first, then gives feedback and locks on the right claim", () => {
      click(why()[0]);
      expect(text("dx-why-fb")).toBe("Collect your evidence first. Move the mass slider above 40 g, then compare the two blocks.");
      expect(why()[0].classList.contains("right")).toBe(false);
      slide("dx-mass", 80);
      click(why()[1]);
      expect(why()[1].classList.contains("wrong")).toBe(true);
      expect(text("dx-why-fb")).toContain("They stayed the same size, because the volume was locked at 20 cm³.");
      click(why()[0]);
      expect(why()[0].classList.contains("right")).toBe(true);
      expect(text("dx-why-fb")).toContain("packed more mass (more dots) into that same space");
      for (const b of why()) expect(b.getAttribute("aria-disabled")).toBe("true");
    });

    test("Investigation B: the right claim is the decrease, with dot evidence", () => {
      mode("volume");
      slide("dx-vol", 40);
      click(why()[0]);
      expect(text("dx-why-fb")).toContain("A bigger block is not always a denser block.");
      click(why()[2]);
      expect(why()[2].classList.contains("right")).toBe(true);
      expect(text("dx-why-fb")).toContain("spread that mass over a larger volume");
    });

    test("does not disturb the investigation, and resets with each switch", () => {
      slide("dx-mass", 80);
      click(why()[0]);
      expect(text("dx-your-d")).toBe("4 g/cm³");
      expect($("dx-mass").value).toBe("80");
      mode("volume");
      expect(why().some((b) => b.classList.contains("right") || b.hasAttribute("aria-disabled"))).toBe(false);
      expect(text("dx-why-fb")).toBe("");
      click(why()[2]);
      expect(text("dx-why-fb")).toMatch(/^Collect your evidence first\./); // evidence does not carry over
      expect($("dx-why-fb-zone").querySelectorAll(".tm-fb-sizer")).toHaveLength(4);
    });
  });

  describe("assessment and Show Your Thinking are preserved", () => {
    test("the 10 quiz items match the canonical revision r2 exactly", () => {
      const payload = JSON.parse(fs.readFileSync(path.join(ROOT, "platform/functions/src/scripts/assessments/measuring-matter.r2.json"), "utf8"));
      expect(payload.revisionOrdinal).toBe(2);
      const src = html.match(/var mmQuizQuestions = (\[[\s\S]*?\n\]);/)[1];
      const quiz = new Function(`return ${src};`)();
      expect(quiz).toHaveLength(10);
      expect(payload.items).toHaveLength(10);
      quiz.forEach((q, i) => {
        const item = payload.items[i];
        expect(q.q).toBe(item.stem);
        expect(q.options).toEqual(item.options.map((o) => o.text));
        expect("ABCD"[q.correct]).toBe(item.correctOptionId);
        expect(q.explanation).toBe(item.explanation);
      });
    });

    test("r2 changes only Q6's explanation, Q7, and Q8's stem and explanation; r1 is unchanged", () => {
      const load = (r) => JSON.parse(fs.readFileSync(path.join(ROOT, `platform/functions/src/scripts/assessments/measuring-matter.r${r}.json`), "utf8")).items;
      const r1 = load(1), r2 = load(2);
      r1.forEach((item, i) => {
        if (i === 6) return;
        if (i === 7) {
          // Only option C changed: the old one contradicted the new stem.
          expect(r2[i].options.filter((o) => o.optionId !== "C")).toEqual(item.options.filter((o) => o.optionId !== "C"));
          expect(item.options[2].text).toBe("It has to be hollow somewhere inside");
          expect(r2[i].options[2]).toEqual({ optionId: "C", text: "Its mass must be smaller than the mass of every sinking object" });
        } else {
          expect(r2[i].options).toEqual(item.options);
        }
        expect(r2[i].correctOptionId).toBe(item.correctOptionId);
        if (i !== 7) expect(r2[i].stem).toBe(item.stem);
        if (i !== 5 && i !== 7) expect(r2[i].explanation).toBe(item.explanation);
      });
      expect(r1[6].stem).toBe("What does density actually measure?");
      expect(r1[7].stem).toBe("A solid object is dropped into water and floats. What must be true about it?");
      expect(r2[6].stem).toBe("A boat is built from material that is denser than water, yet the boat floats. Why?");
      expect(r2[6].correctOptionId).toBe("A");
      expect(r2[6].options.map((o) => o.text)).toEqual([
        "Its hollow shape lets it displace enough water to support its weight",
        "Its hollow shape makes the material itself less dense than water",
        "The water takes away some of the boat's mass while it floats",
        "The air inside the boat stops gravity from pulling it down",
      ]);
      expect(r2[5].explanation).toMatch(/The scale shows only a small increase, because the air around the balloon also pushes up on it\.$/);
      expect(r2[7].stem).toBe("An object with no hollow spaces is placed in water and floats on its own. What must be true about it?");
      expect(r2[7].explanation).toContain("so it can displace its own mass of water before it is fully underwater");
      const letters = r2.map((it) => it.correctOptionId).join("");
      for (const l of "ABCD") expect(letters.split(l).length - 1).toBeGreaterThanOrEqual(2);
    });

    test("one constructed response; its gate needs any text, not the word buoyancy", () => {
      expect(doc.querySelectorAll("textarea")).toHaveLength(1);
      const at = html.indexOf("<!-- ===== QUIZ ===== -->");
      const quizScript = html.slice(at).match(/<script>([\s\S]*?)<\/script>/)[1];
      expect(quizScript).toContain("if (mmThinkGate && !mmThinkGate.value.trim()) return;");
      const submit = quizScript.slice(quizScript.indexOf("function mmSubmitQuiz"), quizScript.indexOf("mmQuizState.submitted = true;"));
      expect(submit).not.toMatch(/buoyan/i);
    });

    test("the model answer now names the buoyant force and the pebble's limit", () => {
      const model = text("mm-think-model");
      expect(model).toContain("This upward push is called the buoyant force, or buoyancy.");
      expect(model).toContain("Even fully underwater, it can push aside only its own small volume of water.");
      expect(model).toContain("That is the most upward push it can get, and it is still smaller than its weight, so it sinks.");
    });
  });
});
