/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * Physical Properties modernization contract.
 *
 * The lesson shares Measuring Matter's student experience: the Vocabulary
 * Explorer (a documented exception to the glossary-card pattern), accessible
 * hook cards, gated predictions, the Quick Check shell, and lab cards. This
 * suite runs the lesson's real scripts in jsdom against the source and both
 * generated outputs, and pins the assessment surface: the quiz items still
 * match the published r1 revision and no new revision is configured.
 */

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "../../../..");
const FILES = [
  "lesson-sources/lesson_physical-properties.html",
  "lesson_physical-properties.html",
  "app/lessons/lesson_physical-properties.html",
];
const SCRIPT_HEADERS = [
  "<!-- ===== VOCABULARY EXPLORER (one term at a time; ungraded, nothing stored) ===== -->",
  "<!-- ===== HOOK CARDS (button or card click to reveal) ===== -->",
  "<!-- ===== PREDICT BEFORE REVEAL ===== -->",
  "<!-- ===== QUICK CHECKS (single-answer, retry until correct; ungraded) =====",
  "<!-- ===== DENSITY REVIEW (predict, compare, drop in water; ungraded) =====",
  "<!-- ===== SHIP-LOADING INVESTIGATION (ungraded, nothing stored) =====",
  "<!-- ===== MYSTERY CUBE INVESTIGATION (ungraded, nothing stored) =====",
  "<!-- ===== ENGINEER'S PROPERTY MATCH (student-paced; no timers) ===== -->",
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
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent("click", { bubbles: true }));
const text = (el) => el.textContent.replace(/\s+/g, " ").trim();

describe.each(FILES)("Physical Properties lesson in %s", (rel) => {
  let win, doc, html;
  beforeEach(() => {
    ({ win, doc, html } = load(rel));
  });

  test("keeps the standard section order and sticky navigation", () => {
    const ids = [...doc.querySelectorAll("main section")].map((s) => s.id);
    expect(ids).toEqual(["goals", "vocab", "hook", "density", "buoyancy", "properties", "recall", "synthesis", "quiz", "continue", "connections"]);
    const nav = new JSDOM(html.match(/<nav>[\s\S]*?<\/nav>/)[0]).window.document;
    expect([...nav.querySelectorAll("#navLinks a")].map((a) => a.getAttribute("href"))).toEqual(["#vocab", "#density", "#quiz", "#continue", "#connections"]);
  });

  describe("vocabulary explorer", () => {
    const TERMS = ["Physical Property", "Density", "Volume", "Water Displacement", "Buoyancy", "Hardness", "Conductivity", "Magnetism"];
    const terms = () => [...doc.querySelectorAll("#vocab .vx-term")];
    const shown = () => [...doc.querySelectorAll("#vocab .vx-panel")].filter((p) => !p.hidden).map((p) => p.dataset.term);

    test("matches Measuring Matter's explorer: intro, eight buttons, one panel each", () => {
      expect(text(doc.querySelector("#vocab .section-desc"))).toBe("Select a word to explore its meaning.");
      expect(doc.querySelectorAll("#vocab .glossary-card")).toHaveLength(0);
      expect(terms().map((t) => t.querySelector(".gc-term").textContent)).toEqual(TERMS);
      for (const t of terms()) {
        expect(t.tagName).toBe("BUTTON");
        expect(t.getAttribute("type")).toBe("button");
        const panel = doc.getElementById(t.getAttribute("aria-controls"));
        expect(panel.dataset.term).toBe(t.dataset.term);
        expect(panel.querySelector(".vx-panel-term").textContent).toBe(t.querySelector(".gc-term").textContent);
        expect(text(panel.querySelector(".gc-lead")).length).toBeGreaterThan(10);
      }
      expect(shown()).toEqual(["property"]);
    });

    test("one definition at a time, announced politely", async () => {
      click(doc.querySelector('.vx-term[data-term="magnetism"]'));
      expect(shown()).toEqual(["magnetism"]);
      expect(terms().filter((t) => t.getAttribute("aria-pressed") === "true").map((t) => t.dataset.term)).toEqual(["magnetism"]);
      await wait(150);
      expect(doc.getElementById("vx-announce").textContent).toBe("Magnetism. Whether a material is attracted to a magnet. Iron and steel are attracted to magnets. Aluminum, copper, plastic, and wood are not.");
    });
  });

  test("hook cards use native buttons and move focus to the revealed text", () => {
    const cards = [...doc.querySelectorAll("#hook .hook-card")];
    expect(cards.map((c) => c.querySelector("h3.hook-card-name").textContent)).toEqual(["The Steel Giant", "The Tiny Coin", "The Floating Ice"]);
    expect(doc.querySelectorAll("#hook [onclick]")).toHaveLength(0);
    const btn = cards[0].querySelector("button.hook-card-prompt");
    click(btn);
    expect(cards[0].classList.contains("revealed")).toBe(true);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(doc.activeElement).toBe(cards[0].querySelector(".hook-card-reveal"));
    expect(cards[1].classList.contains("revealed")).toBe(false);
  });

  describe("density review", () => {
    const blocks = () => [...doc.querySelectorAll("#dz-lab .dz-block")];
    const tops = () => [...doc.querySelectorAll("#dz-tank .dz-tb")].map((g) => Number(g.style.transform.match(/,\s*([\d.]+)px/)[1]));

    test("three same-size particle blocks; measurements stay hidden until a prediction", () => {
      expect(blocks().map((b) => b.querySelectorAll("circle").length)).toEqual([4, 8, 16]);
      expect(blocks().map((b) => b.querySelector("rect").getAttribute("width"))).toEqual(["112", "112", "112"]);
      expect([...doc.querySelectorAll("#dz-lab .dz-data")].every((d) => d.hidden)).toBe(true);
      expect(doc.getElementById("dz-experiment").hidden).toBe(true);
      expect(doc.querySelectorAll("#dz-lab input")).toHaveLength(0);
    });

    test("any prediction reveals mass, volume, and density with same volume and mass following particle count", () => {
      click(blocks()[0]);
      expect(blocks()[0].getAttribute("aria-pressed")).toBe("true");
      expect(blocks()[2].classList.contains("right")).toBe(true);
      expect(doc.getElementById("dz-fb").textContent).toBe("Block C is the most dense: it packs the most matter into the same space.");
      const rows = [...doc.querySelectorAll("#dz-lab .dz-data")].map((d) => [...d.querySelectorAll("dd")].map((x) => x.textContent));
      expect(rows).toEqual([["4 g", "10 cm³", "0.4 g/cm³"], ["8 g", "10 cm³", "0.8 g/cm³"], ["16 g", "10 cm³", "1.6 g/cm³"]]);
      expect(doc.getElementById("dz-experiment").hidden).toBe(false);
      click(blocks()[1]);
      expect(blocks()[1].classList.contains("chosen")).toBe(false);
    });

    test("in water, floaters sit as deep as their density and the denser-than-water block sinks; reset restores", () => {
      click(blocks()[2]);
      expect(doc.getElementById("dz-fb").textContent).toMatch(/^Your prediction matches/);
      expect(tops()).toEqual([2, 2, 2]);
      click(doc.getElementById("dz-drop"));
      // surface 70, block 60 tall: underwater depth = 60 x density for floaters; Block C rests on the floor (174).
      expect(tops()).toEqual([34, 58, 114]);
      expect(doc.getElementById("dz-discover").textContent).toContain("Block C is denser than water, so it sinks");
      click(doc.getElementById("dz-drop"));
      expect(tops()).toEqual([2, 2, 2]);
      click(doc.getElementById("dz-drop"));
      click(doc.getElementById("dz-reset"));
      expect(tops()).toEqual([2, 2, 2]);
      expect(blocks().every((b) => b.getAttribute("aria-pressed") === "false" && !b.hasAttribute("aria-disabled"))).toBe(true);
      expect(doc.getElementById("dz-experiment").hidden).toBe(true);
      expect(doc.activeElement).toBe(blocks()[0]);
    });
  });

  describe("ship-loading investigation", () => {
    const val = (id) => doc.getElementById(id).textContent;
    const panel = () => [val("ship-total"), val("ship-vol"), val("ship-state")];
    const y = () => Number(doc.getElementById("ship-g").style.transform.match(/translate\([\d.]+px,\s*([\d.]+)px\)/)[1]);
    const add = () => click(doc.getElementById("ship-add"));
    const remove = () => click(doc.getElementById("ship-remove"));
    const crates = () => [...doc.querySelectorAll("#ship-crates .ship-crate")].filter((c) => c.style.visibility === "visible").length;
    const sub = () => Number(doc.getElementById("ship-sub").getAttribute("height"));

    test("the ship is never gated; the challenge and optional prediction sit beside it", () => {
      const lab = doc.getElementById("ship-lab");
      expect(lab.querySelector(".predict-gated")).toBeNull();
      expect(doc.getElementById("ship-svg").closest("[hidden]")).toBeNull();
      const stage = lab.querySelector(".ship-stage");
      expect(stage.compareDocumentPosition(lab.querySelector(".ship-goal")) & 4).toBeTruthy();
      expect(stage.contains(doc.getElementById("ship-add")) && stage.contains(doc.getElementById("ship-reset"))).toBe(true);
      expect(text(lab.querySelector(".ship-goal"))).toBe("Cargo Challenge How much cargo can you load before the ship sinks?");
      expect([...doc.querySelectorAll("#qp-ship .ship-pred")].map((b) => b.textContent)).toEqual(["The ship rises", "The ship sinks lower", "Nothing changes"]);
      add();
      expect(val("ship-total")).toBe("250 g");
      expect(doc.getElementById("ship-predict-note").textContent).toBe("");
      click(doc.querySelectorAll("#qp-ship .ship-pred")[0]);
      expect(text(doc.getElementById("ship-predict-note"))).toBe("Check your prediction: More cargo makes the ship sink lower.");
    });

    test("the prediction can change before testing and is checked once after the first cargo change", () => {
      const preds = doc.querySelectorAll("#qp-ship .ship-pred");
      click(preds[0]); click(preds[1]);
      expect([...preds].map((p) => p.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
      add();
      expect(text(doc.getElementById("ship-predict-note"))).toBe("You predicted it. More cargo makes the ship sink lower.");
      click(preds[2]);
      expect(preds[1].getAttribute("aria-pressed")).toBe("true");
    });

    test("starts empty: 200 g, 200 mL, floating; no crates; old labels and outline are gone", () => {
      expect(panel()).toEqual(["200 g", "200 mL", "Floating"]);
      expect(val("ship-cargo")).toBe("200 g ship + 0 g cargo");
      expect(y()).toBe(70);
      expect(sub()).toBe(20);
      expect(crates()).toBe(0);
      expect(doc.getElementById("ship-remove").getAttribute("aria-disabled")).toBe("true");
      expect(doc.getElementById("ship-takeaway").hidden).toBe(true);
      expect(doc.getElementById("ship-svg").textContent).not.toMatch(/mL/);
      expect(doc.querySelector("#ship-svg [stroke-dasharray]")).toBeNull();
      expect(doc.querySelectorAll("#ship-crates .ship-crate text")[0].textContent).toBe("50 g");
    });

    test("each crate adds 50 g, one visible crate, lowers the ship, and displaces mL equal to grams up to 600", () => {
      for (let total = 250; total <= 600; total += 50) {
        add();
        expect(val("ship-total")).toBe(`${total} g`);
        expect(val("ship-vol")).toBe(`${total} mL`);
        // waterline fixed at 110; hull 60 tall; draft = 60 x total / 600
        expect(y()).toBeCloseTo(110 + total / 10 - 60, 6);
        expect(sub()).toBeCloseTo(total / 10, 6);
        expect(crates()).toBe((total - 200) / 50);
      }
      expect(val("ship-state")).toBe("At capacity");
      expect(val("ship-cargo")).toBe("200 g ship + 400 g cargo");
      expect(doc.getElementById("ship-takeaway").hidden).toBe(false);
    });

    test("removing cargo removes a crate and reverses the effect exactly", () => {
      add(); add(); add();
      remove();
      expect(crates()).toBe(2);
      expect(panel()).toEqual(["300 g", "300 mL", "Floating"]);
      remove(); remove();
      expect(panel()).toEqual(["200 g", "200 mL", "Floating"]);
      expect(y()).toBe(70);
    });

    test("650 g overloads: never reports 650 mL, floods, sinks inside the scene, and needs Reset", async () => {
      for (let i = 0; i < 9; i++) add();
      expect(crates()).toBe(9);
      expect(panel()).toEqual(["650 g", "Not enough (600 mL max)", "Overloaded!"]);
      expect(doc.getElementById("ship-lab").classList.contains("is-sunk")).toBe(true);
      expect(doc.getElementById("ship-flood").getAttribute("opacity")).toBe("1");
      expect(y()).toBe(174);
      expect(y() + 60).toBeLessThanOrEqual(238);
      expect(y() - 44).toBeGreaterThan(110);
      expect(val("ship-discover")).toContain("cannot push aside enough water");
      expect(doc.getElementById("ship-takeaway").hidden).toBe(false);
      expect(doc.getElementById("ship-reset").classList.contains("ship-reset-urgent")).toBe(true);
      expect(doc.getElementById("ship-add").getAttribute("aria-disabled")).toBe("true");
      expect(doc.getElementById("ship-remove").getAttribute("aria-disabled")).toBe("true");
      add(); remove();
      expect(val("ship-total")).toBe("650 g");
      click(doc.getElementById("ship-reset"));
      expect(panel()).toEqual(["200 g", "200 mL", "Floating"]);
      expect(doc.getElementById("ship-takeaway").hidden).toBe(true);
      expect(doc.getElementById("ship-flood").getAttribute("opacity")).toBe("0");
      expect(crates()).toBe(0);
      expect(doc.getElementById("ship-reset").classList.contains("ship-reset-urgent")).toBe(false);
      await wait(150);
      expect(doc.getElementById("ship-announce").textContent).toBe("Reset. The empty ship has a mass of 200 g and pushes aside 200 mL of water.");
    });

    test("accessibility: native buttons, labeled controls, live announcements, described drawing", async () => {
      for (const id of ["ship-add", "ship-remove", "ship-reset"]) expect(doc.getElementById(id).tagName).toBe("BUTTON");
      expect(doc.getElementById("ship-add").getAttribute("aria-label")).toBe("Add 50 g of cargo");
      expect(doc.getElementById("ship-svg").getAttribute("role")).toBe("img");
      add();
      expect(doc.getElementById("ship-svg").getAttribute("aria-label")).toBe("Cargo ship with 1 crate, floating lower as cargo is added, with 250 mL of water pushed aside.");
      await wait(150);
      expect(doc.getElementById("ship-announce").textContent).toBe("Ship mass 250 g. More cargo, lower ship, more water pushed aside: 250 mL.");
    });

    test("reduced motion and responsive layout rules are in place", () => {
      expect(html).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.ship-g, #ship-sub \{ transition: none; \} \}/);
      expect(html).toContain(".ship-layout { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);");
      expect(html).toContain("@media (max-width: 760px) { .ship-layout { grid-template-columns: minmax(0, 1fr); } }");
    });

    test("the challenge check uses choices, and 400 g of cargo is the answer", () => {
      const opts = doc.querySelectorAll("#ship-challenge .check-opt");
      expect([...opts].map((o) => o.textContent)).toEqual(["300 g", "400 g", "600 g"]);
      expect(text(doc.getElementById("ship-challenge-q"))).toBe("The empty ship has a mass of 200 g. What is the maximum cargo mass it can carry without sinking?");
      expect(doc.getElementById("ship-challenge").getAttribute("data-correct")).toBe("1");
      expect(opts[0].getAttribute("data-fb")).toContain("total mass is 500 g");
      expect(opts[1].getAttribute("data-fb")).toContain("200 g ship + 400 g of cargo = 600 g total");
      expect(opts[2].getAttribute("data-fb")).toContain("maximum total mass of ship and cargo together");
      click(opts[0]);
      expect(opts[0].classList.contains("wrong")).toBe(true);
      click(opts[2]);
      expect(opts[2].classList.contains("wrong")).toBe(true);
      click(opts[1]);
      expect(opts[1].classList.contains("right")).toBe(true);
    });

    test("refinements: PREDICT heading, no feedback sizers, open explanation below the check, takeaway reveal", async () => {
      expect(text(doc.getElementById("qp-ship-q"))).toBe("Predict: What happens when you add cargo?");
      const ch = doc.getElementById("ship-challenge");
      expect(ch.querySelector(".tm-fb-sizer")).toBeNull();
      const about = doc.getElementById("ship-about");
      expect(about.tagName).toBe("DIV");
      expect(doc.querySelector("#ship-lab details")).toBeNull();
      expect(ch.compareDocumentPosition(about) & 4).toBeTruthy();
      expect(text(about.querySelector("h3"))).toBe("Why does it float?");
      expect(text(about.querySelector(".ship-about-lead"))).toBe("A ship floats because of buoyancy, the upward force of water.");
      expect([...about.querySelectorAll("li")].map(text)).toEqual([
        "Displacement: A ship pushes water out of the way as it sinks lower.",
        "Balance: A floating ship displaces water that weighs the same as the ship.",
        "Sinking: If the ship becomes too heavy to displace enough water, it sinks.",
      ]);
      expect([...about.querySelectorAll("strong")].map(text)).toEqual(["buoyancy", "Displacement:", "Balance:", "Sinking:"]);
      expect(text(about.querySelector(".ship-about-note"))).toBe("The ship's wide, hollow hull helps it displace enough water to float.");
      const tk = doc.getElementById("ship-takeaway");
      click(doc.getElementById("ship-reset"));
      expect(tk.hidden).toBe(true);
      for (let i = 0; i < 7; i++) add();
      expect(tk.hidden).toBe(true);
      add();
      expect(tk.hidden).toBe(false);
      await wait(150);
      expect(doc.getElementById("ship-announce").textContent).toContain("Takeaway: A floating ship pushes aside water that weighs the same as the ship.");
      remove();
      expect(tk.hidden).toBe(false);
      click(doc.getElementById("ship-reset"));
      expect(tk.hidden).toBe(true);
      expect(html).toContain("#buoyancy { padding-bottom: 1.6rem; }");
    });

    test("no Next Up transition cards remain", () => {
      expect(html).not.toMatch(/Next up/i);
      expect(html).not.toContain("mlab-next");
    });
  });


  test("the volume-calculation sequence is gone", () => {
    for (const id of ["volume", "vol-lab", "vol-out", "qp-rock", "disp-lab", "disp-drop", "disp-q"]) expect(doc.getElementById(id)).toBeNull();
    expect(html).not.toContain("VOLUME CALCULATOR");
    expect(html).not.toContain("WATER DISPLACEMENT LAB");
  });

  describe("mystery cube investigation", () => {
    const test_ = (k) => doc.querySelector(`.id-test[data-test="${k}"]`);
    const guess = (k) => doc.querySelector(`.id-guess[data-material="${k}"]`);
    const status = (k) => doc.querySelector(`#id-table tr[data-material="${k}"] .id-status`).textContent;
    const fb = () => doc.getElementById("id-pick-fb");

    async function predict(i = 1) {
      click(doc.querySelectorAll("#qp-id .predict-btn")[i]);
      await wait(300);
    }

    test("the prediction gates the tests", async () => {
      const gated = doc.querySelector('.predict-gated[data-gate="qp-id"]');
      expect(gated.contains(doc.getElementById("id-work"))).toBe(true);
      expect(gated.classList.contains("visible")).toBe(false);
      await predict();
      expect(gated.classList.contains("visible")).toBe(true);
    });

    test("each test fills the mystery row and rules out mismatches in text", async () => {
      await predict();
      click(test_("magnet"));
      expect(doc.getElementById("id-res-magnet").textContent).toBe("No");
      expect(status("iron")).toBe("Ruled out");
      expect(["aluminum", "plastic", "wood"].map(status)).toEqual(["Possible", "Possible", "Possible"]);
      expect(test_("magnet").getAttribute("aria-disabled")).toBe("true");
      await wait(150);
      expect(doc.getElementById("id-announce").textContent).toBe("The magnet test: the cube is not attracted to the magnet. Iron is ruled out. Still possible: aluminum, hard plastic, and pine wood.");
      click(test_("water"));
      expect(doc.getElementById("id-res-water").textContent).toBe("Sinks");
      expect(status("wood")).toBe("Ruled out");
      click(test_("circuit"));
      expect(doc.getElementById("id-res-circuit").textContent).toBe("Yes");
      expect(status("plastic")).toBe("Ruled out");
      expect(status("aluminum")).toBe("Possible");
    });

    test("identifying requires sufficient evidence; ruled-out picks explain why", async () => {
      await predict();
      click(guess("aluminum"));
      expect(fb().classList.contains("hint")).toBe(true);
      expect(guess("aluminum").classList.contains("right")).toBe(false);
      click(test_("magnet"));
      click(guess("iron"));
      expect(guess("iron").classList.contains("wrong")).toBe(true);
      expect(fb().textContent).toContain("Your magnet test already ruled out iron");
      click(guess("aluminum"));
      expect(fb().textContent).toContain("Run another test to rule out hard plastic and pine wood");
      expect(doc.getElementById("id-explain").hidden).toBe(true);
      click(test_("circuit"));
      click(guess("aluminum"));
      expect(guess("aluminum").classList.contains("right")).toBe(true);
      expect(doc.getElementById("id-explain").hidden).toBe(false);
    });

    test("the explain step checks the prediction, and reset clears the investigation", async () => {
      await predict(0);
      click(test_("magnet"));
      click(test_("circuit"));
      click(guess("aluminum"));
      const opts = doc.querySelectorAll("#id-explain .check-opt");
      click(opts[0]);
      expect(opts[0].classList.contains("wrong")).toBe(true);
      click(opts[1]);
      expect(opts[1].classList.contains("right")).toBe(true);
      expect(text(doc.getElementById("id-predict-note"))).toBe("Check your prediction: one test was not enough. No single test separates aluminum from all three other materials, so it took two: the magnet test and the circuit test.");

      click(doc.getElementById("id-reset"));
      expect(["iron", "aluminum", "plastic", "wood"].map(status)).toEqual(["Possible", "Possible", "Possible", "Possible"]);
      expect(["magnet", "circuit", "water"].map((k) => doc.getElementById(`id-res-${k}`).textContent)).toEqual(["?", "?", "?"]);
      expect(test_("magnet").hasAttribute("aria-disabled")).toBe(false);
      expect(guess("aluminum").classList.contains("right")).toBe(false);
      expect(doc.getElementById("id-explain").hidden).toBe(true);
      expect(opts[1].classList.contains("right")).toBe(false);
      expect(doc.getElementById("id-predict-note").textContent).toBe("");
      expect(doc.querySelector("#qp-id .predict-btn.chosen")).not.toBeNull();
    });
  });

  test("the property match advances only on Next, with text progress", async () => {
    const count = () => doc.getElementById("match-count").textContent;
    const next = doc.getElementById("match-next");
    const pick = (label) => click([...doc.querySelectorAll("#matchOpts .match-btn")].find((b) => b.textContent === label));
    expect(count()).toBe("Problem 1 of 5");
    expect(next.hidden).toBe(true);
    pick("Malleability");
    expect(doc.getElementById("matchFb").className).toBe("tm-fb visible no");
    pick("Ductility");
    await wait(3000);
    expect(count()).toBe("Problem 1 of 5");
    expect(next.hidden).toBe(false);
    for (const [answer, n] of [["Thermal conductivity", 2], ["Hardness", 3], ["Malleability", 4], ["Melting point", 5]]) {
      click(next);
      expect(count()).toBe(`Problem ${n} of 5`);
      expect(doc.activeElement).toBe(doc.getElementById("match-text"));
      pick(answer);
    }
    expect(doc.getElementById("matchSuccess").classList.contains("visible")).toBe(true);
    expect(next.textContent).toBe("Start over");
    click(next);
    expect(count()).toBe("Problem 1 of 5");
    expect(doc.getElementById("matchSuccess").classList.contains("visible")).toBe(false);
  }, 10000);

  test("Quick Recall gives answer-specific feedback with no separate Check step", () => {
    const qr1 = doc.querySelectorAll("#qr1 .check-opt");
    click(qr1[0]);
    expect(qr1[0].classList.contains("wrong")).toBe(true);
    click(qr1[1]);
    expect(qr1[1].classList.contains("right")).toBe(true);
    expect(doc.querySelectorAll("#recall input[type=radio], #recall .qr-check")).toHaveLength(0);
    const qr2 = doc.querySelectorAll("#qr2 .check-opt");
    click(qr2[2]);
    expect(text(doc.querySelector("#qr2 .tm-fb:not(.tm-fb-sizer)"))).toMatch(/^Correct! Steel is attracted to magnets/);
  });

  test("Connections hold only lessons; the extension lives in More Learning", () => {
    expect([...doc.querySelectorAll("#connections .cont-card")].map((c) => [c.className, c.getAttribute("href")])).toEqual([
      ["cont-card lesson", "lesson_measuring-matter.html"],
      ["cont-card lesson", "lesson_pure-substances-and-mixtures.html"],
    ]);
    expect([...doc.querySelectorAll("#continue a.cont-card")].map((c) => c.getAttribute("href"))).toEqual(["extension_hidden-world-of-matter.html"]);
  });

  test("decorative SVGs are hidden; informative SVGs are labeled images", () => {
    for (const svg of doc.querySelectorAll("main svg")) {
      if (svg.getAttribute("aria-hidden") === "true") continue;
      expect(svg.getAttribute("role")).toBe("img");
      expect((svg.getAttribute("aria-label") || "").length).toBeGreaterThan(10);
    }
  });

  test("contains no em dashes and no inline click handlers outside the quiz", () => {
    expect(html).not.toContain("\u2014");
    const beforeQuiz = html.slice(html.indexOf('<main id="main"'), html.indexOf('<section id="quiz"'));
    expect(beforeQuiz).not.toMatch(/\sonclick=/);
  });
});

describe("Physical Properties assessment integrity", () => {
  const r1 = require(path.join(ROOT, "platform/functions/src/scripts/assessments/physical-properties.r1.json"));

  test.each(FILES)("%s quiz items, options, and keys match the published r1 revision", (rel) => {
    const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const at = html.indexOf("<!-- ===== QUIZ ===== -->");
    const quiz = html.slice(at, html.indexOf("</script>", at));
    for (const item of r1.items) {
      expect(quiz).toContain(JSON.stringify(item.stem).slice(1, -1));
      for (const option of item.options) expect(quiz).toContain(option.text);
    }
  });

  test("the lesson config pins no new assessment revision", () => {
    const config = require(path.join(ROOT, "app/scripts/lessonBuilder/lessons/physical-properties.cjs"));
    expect(config.canonicalAssessmentRevisionId).toBeUndefined();
    const assessments = fs.readdirSync(path.join(ROOT, "platform/functions/src/scripts/assessments")).filter((f) => f.startsWith("physical-properties."));
    expect(assessments).toEqual(["physical-properties.r1.json"]);
  });
});
