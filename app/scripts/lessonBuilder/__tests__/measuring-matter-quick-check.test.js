/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * Measuring Matter vocabulary cards and Quick Check contract.
 *
 * Guards the visual redesign pilot: the Vocabulary Explorer (one definition
 * at a time, pressed-state word buttons; a documented exception to the
 * glossary-card pattern, with its intro text pinned below), and the shared Quick Check
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
  "<!-- ===== WATER DISPLACEMENT LAB (ungraded, nothing stored) ===== -->",
  "<!-- ===== DENSITY EXPLORER (ungraded, nothing stored) ===== -->",
  "<!-- ===== DENSITY LAB ===== -->",
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
    const TERMS = ["Matter", "Mass", "Volume", "Density", "Triple Beam Balance", "Graduated Cylinder", "Buoyancy", "Water Displacement"];
    const DEFS = {
      matter: ["Anything that has mass and takes up space (volume).", "The most common states of matter are solid, liquid, and gas."],
      mass: ["The amount of matter in an object.", "Mass is measured in grams (g) with a triple beam balance."],
      volume: ["The amount of space an object takes up.", "Volume is found in cubic centimeters (cm³) by multiplying length × width × height, or measured in milliliters (mL) with a graduated cylinder."],
      density: ["A measure of how much matter is packed into a space.", "Density is the ratio of mass to volume: D = m ÷ V, in g/cm³ or g/mL."],
      balance: ["The lab tool scientists use to measure mass in grams.", "You slide the riders along the three beams until the pointer lines up with zero."],
      cylinder: ["A tall, marked container used to measure the volume of liquids (and odd-shaped objects) in milliliters (mL).", null],
      buoyancy: ["The upward force a fluid exerts on an object placed in it.", "This upward push is also called the buoyant force. An object floats when the buoyant force balances its weight."],
      displacement: ["The movement of water out of the way when an object enters or moves through it.", "The water pushed aside takes up the same volume as the part of the object that is underwater. It helps you measure volume, and it causes the buoyant force."],
    };
    const terms = () => [...doc.querySelectorAll("#vocab .vx-term")];
    const term = (key) => doc.querySelector(`#vocab .vx-term[data-term="${key}"]`);
    const pressed = () => terms().filter((t) => t.getAttribute("aria-pressed") === "true").map((t) => t.dataset.term);
    const shown = () => [...doc.querySelectorAll("#vocab .vx-panel")].filter((p) => !p.hidden).map((p) => p.dataset.term);
    const said = () => doc.getElementById("vx-announce").textContent;

    test("renders eight accessible selectors, the intro, and exact definitions", () => {
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
    test("each formative activity says it is not graded exactly once", () => {
      const activities = [
        doc.querySelector(".tool-match"), doc.getElementById("disp-check"), doc.getElementById("dx-check"),
      ];
      for (const el of activities) expect(el.textContent.match(/not graded/gi)).toHaveLength(1);
    });

    test("wraps every formative check outside the quiz with an eyebrow", () => {
      const eyebrows = [...doc.querySelectorAll(".check-card > .check-eyebrow")].map((e) => e.textContent);
      expect(eyebrows).toEqual([
        "Predict", "Quick Check · Not graded", "Quick Check · Not graded",
        "Step 1 · Predict", "Step 3 · Check Your Understanding · Not graded", "Step 4 · Explain With Evidence",
        "Predict",
        "Step 1 · Predict", "Step 3 · Explain · Not graded", "Step 4 · Check: Buoyancy Is a Force",
      ]);
      expect(doc.querySelectorAll("#quiz .check-card, #quiz .check-opt")).toHaveLength(0);
    });

    test("labels every option group by its question and styles every option", () => {
      const groups = [...doc.querySelectorAll('.check-card [role="group"], .worked-example [role="group"]')];
      expect(groups).toHaveLength(12);
      for (const g of groups) {
        const label = doc.getElementById(g.getAttribute("aria-labelledby"));
        expect(label).not.toBeNull();
        // The water displacement check writes its question and four choices
        // from the measured object at run time (covered by its own suite).
        const dynamic = g.id === "disp-options";
        if (!dynamic) expect(label.textContent.trim().length).toBeGreaterThan(0);
        expect(g.querySelectorAll(".check-opt").length).toBe(dynamic ? 4 : 3);
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

    test.each([
      ["qp-air", "Prediction saved. The explanation is now below."],
      ["qp-density", "Prediction saved. The Density Lab is now open below."],
    ])("%s announces the unlocked content without moving focus", async (id, msg) => {
      const pause = doc.getElementById(id);
      const sr = pause.querySelector(".predict-sr");
      expect(sr.getAttribute("aria-live")).toBe("polite");
      expect(sr.textContent).toBe("");
      const btn = pause.querySelector(".predict-btn");
      btn.focus();
      click(btn);
      await wait(300);
      expect(sr.textContent).toBe(msg);
      expect(doc.activeElement).toBe(btn);
    });

    test("the air Key Idea opens by checking the prediction", () => {
      const first = doc.querySelector('.predict-gated[data-gate="qp-air"] p');
      expect(first.textContent).toBe("Check your prediction: air is matter, just like a rock.");
    });
  });

  describe("Density Lab", () => {
    const set = (id, value) => {
      const el = doc.getElementById(id);
      el.value = String(value);
      el.dispatchEvent(new el.ownerDocument.defaultView.Event("input"));
    };

    test("tells students to make the object sink, then float again", () => {
      expect(doc.querySelector(".density-lab-sub").textContent).toContain(
        "Try this: Make your object sink. Then change only one slider to make it float again."
      );
    });

    test("announces the synthesis once, after both a sink and a float", async () => {
      const synth = doc.getElementById("dl-synthesis");
      expect(synth.getAttribute("role")).toBe("status");
      expect(synth.classList.contains("visible")).toBe(false);
      set("dl-mass", 150);
      expect(synth.classList.contains("visible")).toBe(true);
      expect(synth.textContent.trim()).toBe("");
      await wait(150);
      expect(synth.querySelector("strong").textContent).toBe("Check your prediction.");
      const filled = synth.innerHTML;
      set("dl-mass", 20);
      set("dl-mass", 180);
      expect(synth.innerHTML).toBe(filled);
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

    test("shows three labeled question cards side by side with the new directions", () => {
      const tm = doc.querySelector(".tool-match");
      expect(tm.querySelector(".tool-match-title").textContent).toBe("Pick the Right Tool");
      expect(tm.querySelector(".tool-match-sub").textContent).toBe(
        "Choose the best tool for each situation. Get immediate feedback and try again if needed."
      );
      const cards = [...tm.querySelectorAll(".tm-grid > .tm-question")];
      expect(cards).toHaveLength(3);
      expect(cards.map((c) => c.querySelector(".tm-label").textContent)).toEqual(["Question 1", "Question 2", "Question 3"]);
      expect(cards.map((c) => c.getAttribute("data-correct"))).toEqual(["1", "2", "0"]);
      for (const c of cards) {
        expect(c.querySelectorAll(".tm-btn")).toHaveLength(3);
        expect(c.querySelector(".tm-fb").getAttribute("aria-live")).toBe("polite");
      }
      expect(html).toMatch(/\.tm-grid \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 15rem\), 1fr\)\)/);
    });

    test("each question card keeps its own state and feedback", () => {
      const [q1, q2, q3] = [...doc.querySelectorAll(".tm-question")];
      const b1 = [...q1.querySelectorAll(".tm-btn")];
      click(b1[0]);
      expect(q1.querySelector(".tm-fb").className).toBe("tm-fb visible no");
      for (const q of [q2, q3]) {
        expect(q.querySelector(".tm-fb").className).toBe("tm-fb");
        expect(q.querySelector(".tm-fb").textContent).toBe("");
        expect([...q.querySelectorAll(".tm-btn")].some((b) => b.classList.contains("wrong") || b.hasAttribute("aria-disabled"))).toBe(false);
      }
      click(q2.querySelectorAll(".tm-btn")[2]);
      expect(q2.querySelector(".tm-fb").className).toBe("tm-fb visible ok");
      expect(q1.querySelector(".tm-fb").className).toBe("tm-fb visible no");
      click(b1[2]);
      click(b1[1]);
      expect(b1[1].classList.contains("right")).toBe(true);
      expect(q3.querySelector(".tm-fb").textContent).toBe("");
    });

    test("aligns zones with subgrid and reserves feedback space with hidden copies of each card's own messages", () => {
      for (const q of doc.querySelectorAll(".tm-question")) {
        const zone = q.querySelector(".tm-fb-zone");
        const [live, ...sizers] = [...zone.children];
        expect(live.getAttribute("aria-live")).toBe("polite");
        expect(live.classList.contains("tm-fb-sizer")).toBe(false);
        expect(sizers.map((z) => z.textContent)).toEqual([...q.querySelectorAll(".tm-btn")].map((b) => b.getAttribute("data-fb")));
        for (const z of sizers) {
          expect(z.getAttribute("aria-hidden")).toBe("true");
          expect(z.classList.contains("tm-fb-sizer")).toBe(true);
        }
      }
      expect(html).toContain(".tm-question { grid-template-rows: subgrid; row-gap: 0; }");
      expect(html).toContain(".tm-question .tm-options { grid-template-rows: subgrid; }");
      expect(html).toContain(".tm-fb-zone > * { grid-area: 1 / 1; margin-top: 0; }");
      expect(html).toContain(".tm-fb-zone .tm-fb.tm-fb-sizer { display: block; visibility: hidden; }");
      expect(html).toContain("@media (max-width: 480px) { .tm-fb-zone .tm-fb.tm-fb-sizer { display: none; } }");
    });

    test("every option gives its own feedback", () => {
      const FEEDBACK = [
        [
          "Not quite. A ruler measures length, not mass. Mass is the amount of matter, so you need a balance. Try again.",
          "Correct! A triple beam balance measures mass in grams (g).",
          "Not quite. A graduated cylinder measures the volume of a liquid, not mass. Try again.",
        ],
        [
          "Not quite. A balance measures mass, not volume. Juice is a liquid, so measure the space it takes up. Try again.",
          "Not quite. Juice has no length, width, or height to measure. It takes the shape of its container. Try again.",
          "Correct! A graduated cylinder measures liquid volume in milliliters (mL).",
        ],
        [
          "Correct! Measure length, width, and height with a ruler, then multiply to get cm³.",
          "Not quite. A balance tells you the block's mass, not how much space it takes up. Try again.",
          "Not quite. One side gives you a length, not a volume. Measure length, width, and height, then multiply. Try again.",
        ],
      ];
      [...doc.querySelectorAll(".tm-question")].forEach((q, qi) => {
        const correct = Number(q.getAttribute("data-correct"));
        const fb = q.querySelector(".tm-fb");
        const btns = [...q.querySelectorAll(".tm-btn")];
        const order = [...btns.keys()].filter((i) => i !== correct).concat(correct);
        for (const i of order) {
          click(btns[i]);
          expect(fb.textContent).toBe(FEEDBACK[qi][i]);
          expect(fb.className).toBe(i === correct ? "tm-fb visible ok" : "tm-fb visible no");
        }
      });
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

  describe("Quick Recall", () => {
    // Retired in the density streamlining pass: Lab 4, the Density
    // Challenge, the practice problem, and the quiz cover the same ideas.
    test("the two-question Brain Check and its script are gone", () => {
      expect(doc.getElementById("recall")).toBeNull();
      expect(doc.querySelectorAll(".qr-card, #qrCard1, #qrCard2")).toHaveLength(0);
      expect(html).not.toContain("QUICK RECALL CHECKPOINTS");
      expect(doc.querySelector("#main").textContent).not.toContain("Brain Check");
    });
  });

  describe("science corrections", () => {
    test("Density at Home uses a graduated cylinder with displacement steps and an in-class fallback", () => {
      const desc = doc.querySelector("#continue .cont-card.ext .cont-desc");
      expect(desc.textContent).not.toMatch(/measuring cup/i);
      const steps = [...desc.querySelectorAll("ol > li")].map((li) => li.textContent);
      expect(steps).toHaveLength(6);
      expect(steps[1]).toContain("graduated cylinder");
      expect(steps[1]).toContain("initial volume");
      expect(steps[2]).toContain("completely underwater");
      expect(steps[3]).toContain("final water volume");
      expect(steps[4]).toContain("final volume minus initial volume");
      expect(steps[4]).toContain("milliliters (mL)");
      expect(desc.textContent).toContain("No graduated cylinder at home? Do this investigation in class.");
    });
  });

  describe("narrative precision", () => {
    const text = (sel) => doc.querySelector(sel).textContent.replace(/\s+/g, " ").trim();

    test("speaks of mass, not weight or heaviness, and notes the difference once", () => {
      const lesson = doc.querySelector("#hook").textContent + doc.querySelector("#matter").textContent;
      expect(lesson).not.toMatch(/heavier|have weight|weighs/i);
      expect(doc.querySelector("#main").textContent).not.toMatch(/almost no mass|measured two ways/);
      expect(text('.predict-gated[data-gate="qp-air"]')).toContain(
        "Mass is not the same as weight. Weight is the pull of gravity on an object's mass."
      );
      expect(text("#hook .section-desc")).toBe(
        "Before you use those new words, think like a scientist about these three everyday objects. Select each card and think about the question."
      );
    });

    test("the ship explanation names overall density and keeps steel denser than water", () => {
      // The standalone wrap-up is retired; the Show Your Thinking model
      // answer now carries the full explanation (see the sequence suite).
      const model = text("#mm-think-model");
      expect(model).toContain("Steel itself is denser than water");
      expect(model).toContain("average density is less than water's");
      expect(model).not.toMatch(/steel is less dense|steel (itself )?floats/i);
      expect(text("#dl-synthesis")).toBe(
        "Check your prediction. Floating isn't decided by mass or size alone. It's decided by density. An object floats when its density is less than water's 1 g/mL and sinks when its density is greater."
      );
      expect(doc.getElementById("synthesis")).toBeNull();
    });
  });

  describe("particle model of density", () => {
    test("the dot model lives in Lab 4, not in a static Key Idea picture", () => {
      // Lab 4's own suite (measuring-matter-density-explorer.test.js) covers the model.
      const card = [...doc.querySelectorAll(".name-it")].find(
        (c) => c.querySelector(".name-it-label").textContent === "Key idea: Density"
      );
      expect(card.querySelector("svg")).toBeNull();
      expect(doc.querySelectorAll("svg.dens-particles")).toHaveLength(0);
      expect(card.closest(".dz-idea").nextElementSibling).toBe(doc.getElementById("dx-lab"));
      expect(doc.querySelectorAll("#dx-lab .dx-dot").length).toBeGreaterThan(0);
    });
  });

  describe("polish", () => {
    test("documents the Vocabulary Explorer as an intentional exception", () => {
      expect(html).toContain("KEY VOCABULARY - Vocabulary Explorer. Intentional, documented exception");
      expect(html).not.toContain("glossary cards - click to expand only");
    });

    test("uses a rock, not a magnet, for density", () => {
      expect(doc.querySelector(".process-card.step3 .process-icon").textContent).toBe("🪨");
      expect(doc.querySelector("#main").textContent).not.toContain("🧲");
    });

    test("More Learning previews the extension's concepts and Connections names the relationship", () => {
      const intro = doc.querySelector("#continue .continue-intro");
      expect(intro.textContent).toBe(
        "A ruler can find the volume of a block, but what about a rock? Use water displacement to measure irregular objects, then calculate their density at home or in class."
      );
      expect([...intro.querySelectorAll("strong")].map((s) => s.textContent)).toEqual([
        "water displacement", "irregular objects", "density",
      ]);
      expect(doc.querySelector("#connections .connections-intro").textContent).toBe(
        "Mass, volume, and density describe any piece of matter. This lesson shows where those measurements lead."
      );
    });

    test("Learning Science badges describe what this lesson actually does", () => {
      const badges = [...doc.querySelectorAll(".ls-focus .ls-badge")];
      const labels = badges.map((b) => b.textContent);
      expect(labels).toContain("🔤 Vocabulary Preview");
      expect(labels).not.toContain("🏷️ Label After Learning");
      const tip = (label) => badges.find((b) => b.textContent === label).getAttribute("data-tip");
      expect(tip("🔍 Phenomenon First")).toMatch(/^After a brief vocabulary preview, the lesson opens with three real puzzles/);
      expect(tip("🔤 Vocabulary Preview")).toBe(
        "Six key terms are previewed one at a time before the lesson begins, then revisited in context as students use them. A brief preview lowers the load of new words when they reappear in explanations and tasks. (Beck, McKeown, & Kucan, 2013)"
      );
    });
  });

  describe("Show Your Thinking and Tool Match wording", () => {
    test("Tool Match Q3 offers a one-side ruler distractor and asks about tool and method", () => {
      const q3 = doc.querySelectorAll(".tm-question")[2];
      expect(q3.querySelector(".tm-q-text").textContent).toBe(
        "3. You need the volume of a rectangular block (a solid with straight sides). Which tool and method do you use?"
      );
      expect([...q3.querySelectorAll(".tm-btn")].map((b) => b.textContent)).toEqual([
        "Ruler - measure length, width, and height", "Triple beam balance", "Ruler - measure only the longest side",
      ]);
    });

    test("Show Your Thinking poses the Floating Giant Mystery and models overall density", () => {
      const box = doc.getElementById("mm-think");
      expect(box.querySelector(".think-prompt").textContent).toBe(
        "How can a giant steel ship float while a tiny pebble sinks? Explain your thinking using the words mass, volume, and density. Consider how the ship's shape and the water it displaces help it float."
      );
      expect(doc.getElementById("mm-thinking").getAttribute("placeholder")).toBe("Write your explanation here...");
      const model = doc.getElementById("mm-think-model").textContent.replace(/\s+/g, " ");
      expect(model).toContain("its average density is less than water's");
      expect(model).not.toContain("mostly air");
      expect(box.textContent).not.toMatch(/one sentence/i);
    });
  });

  describe("measurement cards", () => {
    test("use the concise approved wording with tool, formula, and unit lines", () => {
      const cards = [...doc.querySelectorAll(".process-card")];
      expect(cards.map((c) => c.querySelector(".process-body").textContent)).toEqual([
        "Mass is the amount of matter in an object. It is measured using a triple beam balance or digital scale.",
        "Volume is the amount of space an object takes up. Use a ruler to calculate the volume of a regular-shaped object, or a graduated cylinder to measure the volume of a liquid or an irregularly shaped object using water displacement.",
        "Density describes how much mass is packed into a certain volume. It is the ratio of mass to volume and is calculated by dividing an object's mass by its volume.",
      ]);
      expect(cards.map((c) => [...c.querySelectorAll(".process-mini .pm-line")].map((l) => l.textContent))).toEqual([
        ["Tools: Triple Beam Balance or Digital Scale", "Unit: grams (g)"],
        ["Tools: Ruler or Graduated Cylinder", "Units: cm³ or mL"],
        ["Formula: Mass ÷ Volume", "Units: g/cm³ or g/mL"],
      ]);
      expect(html).toContain(".pm-line { display: block; }");
      expect(html).toContain(".pm-keep { white-space: nowrap; }");
    });
  });

  describe("states of matter cards", () => {
    test("groups the six examples into Solid, Liquid, and Gas cards", () => {
      const block = doc.querySelector("#matter .states-block");
      expect(block.querySelector("h3").textContent).toBe("Matter Is All Around You");
      expect(block.querySelector(".states-intro").textContent).toBe(
        "Matter exists in three common states. Look at these everyday examples."
      );
      const cards = [...block.querySelectorAll(".state-grid > li.state-card")];
      expect(cards.map((c) => c.querySelector("h4").textContent)).toEqual(["Solid", "Liquid", "Gas"]);
      expect(cards.map((c) => [...c.querySelectorAll(".state-examples li")].map((li) => li.textContent))).toEqual([
        ["🪨Rock", "🧊Ice cube"], ["💧Water", "🥤Juice"], ["🎈Air in a balloon", "H2OWater vapor"],
      ]);
      for (const icon of block.querySelectorAll(".state-icon:not(.state-formula)")) expect(icon.getAttribute("aria-hidden")).toBe("true");
      const formula = block.querySelector(".state-gas .state-formula");
      expect(formula.innerHTML).toBe("H<sub>2</sub>O");
      expect(formula.hasAttribute("aria-hidden")).toBe(false);
      expect(block.querySelectorAll("button, [role=button], [tabindex]")).toHaveLength(0);
      expect(doc.querySelector("#matter").textContent).not.toMatch(/steam/i);
      expect(doc.querySelectorAll(".example-chip, .example-grid")).toHaveLength(0);
    });

    test("cards stack on narrow screens without fixed heights", () => {
      expect(html).toMatch(/\.state-grid \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
      expect(html).toContain("@media (max-width: 720px) { .state-grid { grid-template-columns: minmax(0, 1fr); } }");
      expect(html).not.toMatch(/\.state-(card|grid|examples)[^{]*\{[^}]*(?<![-\w])(max-|min-)?height:/);
    });
  });

  describe("reflow at enlarged text", () => {
    // jsdom has no layout, so guard the CSS that prevents the verified
    // overflow: plain 1fr tracks cannot shrink below their longest word.
    test("multi-column grids use shrinkable tracks", () => {
      expect(html).toMatch(/\.process-grid \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 16rem\), 1fr\)\)/);
      expect(html).toContain("@media (max-width: 960px) {\n  .process-grid { grid-template-columns: minmax(0, 1fr); }");
      expect(html).toMatch(/\.vol-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
      expect(html).toMatch(/\.vol-slider-row input\[type=range\] \{[^}]*min-width: 0/);
      expect(html).toMatch(/\.dl-sliders \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
      expect(html).toMatch(/\.dl-panels \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
      expect(html).toMatch(/\.dl-slider-row input\[type=range\] \{[^}]*min-width: 0/);
    });

    test("measurement tool labels can wrap", () => {
      for (const mini of doc.querySelectorAll(".process-mini")) {
        expect(mini.textContent).not.toContain(" ");
      }
    });
  });
});
