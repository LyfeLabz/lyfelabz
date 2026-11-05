/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * Physical Properties modernization contract.
 *
 * Phase 3 sequence: a short phenomenon hook, the three-group property
 * vocabulary, seven property investigations, the Cargo Ship buoyancy
 * challenge, the Mystery Cube evidence challenge, then the quiz. The density
 * review, Brain Check, harbor wrap-up, and property match are removed. This
 * suite runs the lesson's real scripts in jsdom against the source and both
 * generated outputs, and pins the assessment surface: Phase 4 assessment r2
 * (ten teacher-approved three-choice items) is the canonical revision, r1 is
 * preserved for frozen r1 assignments through its own rendition, and the quiz
 * block is pinned to the reviewed r2 bytes.
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
  "<!-- ===== HOOK CARDS (button or card click to reveal) ===== -->",
  "<!-- ===== PREDICT BEFORE REVEAL ===== -->",
  "<!-- ===== QUICK CHECKS (single-answer, retry until correct; ungraded) =====",
  "<!-- ===== SHIP-LOADING INVESTIGATION (ungraded, nothing stored) =====",
  "<!-- ===== SCRATCH TEST (hardness; ungraded, nothing stored) =====",
  "<!-- ===== CIRCUIT TEST (electrical conductivity; ungraded, nothing stored) =====",
  "<!-- ===== HEAT TEST (thermal conductivity; ungraded, nothing stored) =====",
  "<!-- ===== MAGNET TEST (magnetism; ungraded, nothing stored) =====",
  "<!-- ===== MELTING TEST (melting point; ungraded, nothing stored) =====",
  "<!-- ===== PRESS TEST (malleability; ungraded, nothing stored) =====",
  "<!-- ===== WIRE TEST (ductility; ungraded, nothing stored) =====",
  "<!-- ===== MYSTERY CUBE INVESTIGATION (ungraded, nothing stored) =====",
];

function load(rel, { motion = false } = {}) {
  const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const start = html.indexOf('<main id="main"');
  const end = html.indexOf("</main>", start);
  const dom = new JSDOM(`<body>${html.slice(start, end)}</main></body>`, { runScripts: "outside-only" });
  // Motion runs exercise the animated (non-reduced-motion) path.
  if (motion) dom.window.matchMedia = () => ({ matches: false });
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

  test("follows the approved Phase 3 sequence, and the sticky navigation points at real sections", () => {
    const ids = [...doc.querySelectorAll("main section")].map((s) => s.id);
    expect(ids).toEqual(["goals", "hook", "vocab", "properties", "buoyancy", "mystery", "quiz", "continue", "connections"]);
    const nav = new JSDOM(html.match(/<nav>[\s\S]*?<\/nav>/)[0]).window.document;
    const hrefs = [...nav.querySelectorAll("#navLinks a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["#vocab", "#properties", "#quiz", "#continue", "#connections"]);
    for (const h of hrefs) expect(doc.getElementById(h.slice(1))).not.toBeNull();
    // Every in-page link resolves to an element that still exists.
    for (const a of doc.querySelectorAll('main a[href^="#"]')) expect(doc.getElementById(a.getAttribute("href").slice(1))).not.toBeNull();
    // Section titles in order: hook, vocabulary, investigations, two challenges, quiz.
    expect(["hook", "vocab", "properties", "buoyancy", "mystery", "quiz"].map((id) => text(doc.querySelector(`#${id} h2.section-title`)))).toEqual([
      "Why That Material?", "Words You'll Meet", "Test the Properties", "Cargo Ship Challenge", "Mystery Cube Challenge", "Check Your Understanding",
    ]);
  });

  test("the opening is one short phenomenon with no density instruction and no required response", () => {
    expect(text(doc.querySelector(".hero-sub"))).toBe("Copper wires. Metal pans. Steel ships. Every material is chosen because of what it can do.");
    expect(text(doc.querySelector(".dq-text"))).toBe("How can we test physical properties to identify a material and choose the right one for a job?");
    const hook = doc.getElementById("hook");
    const studentText = [...hook.children[0].children].filter((el) => !el.classList.contains("edu-note")).map(text).join(" ");
    expect(studentText).not.toMatch(/densit|volume|g\/cm/i);
    // Whole hook, including the three revealed lines and button labels.
    expect(studentText.split(/\s+/).length).toBeLessThan(140);
    expect(hook.querySelectorAll("input, textarea, .predict-gated, img")).toHaveLength(0);
  });

  test("learning goals: three concise goals with no unsupported Grade 6 code", () => {
    const goals = [...doc.querySelectorAll("#goals .goal-card")];
    expect(goals.map((g) => text(g.querySelector(".goal-text")))).toEqual([
      "Investigate and compare how materials behave when scratched, heated, squeezed, pulled, or tested with electricity and magnets.",
      "Use evidence from physical property tests to identify materials and choose the right material for a job.",
      "Explain how buoyancy allows a cargo ship to float and how adding cargo affects it.",
    ]);
    expect(doc.querySelectorAll("#goals .goal-std")).toHaveLength(0);
    // Standards appear only beneath the hero and on goal chips: no standalone banners, no invented codes.
    expect([...html.matchAll(/\b\d\.MS-[A-Z]+\d-\d+(\(MA\))?/g)].map((m) => m[0]).every((c) => c === "6.MS-PS1-7(MA)" || c === "6.MS-PS1-8(MA)")).toBe(true);
    expect(doc.querySelector("main .ls-focus")).not.toBeNull();
  });

  test("hook cards use native buttons and move focus to the revealed text", () => {
    const cards = [...doc.querySelectorAll("#hook .hook-card")];
    expect(cards.map((c) => c.querySelector("h3.hook-card-name").textContent)).toEqual(["The Wire", "The Pan", "The Ship"]);
    expect(doc.querySelectorAll("#hook [onclick]")).toHaveLength(0);
    const btn = cards[0].querySelector("button.hook-card-prompt");
    click(btn);
    expect(cards[0].classList.contains("revealed")).toBe(true);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(doc.activeElement).toBe(cards[0].querySelector(".hook-card-reveal"));
    expect(cards[1].classList.contains("revealed")).toBe(false);
  });

  test("redundant density and volume instruction is removed", () => {
    for (const id of ["density", "dz-lab", "dz-tank", "dz-drop", "recall", "qr1", "qr2", "synthesis", "match-lab", "matchOpts", "vocab-explorer", "vx-announce"]) expect(doc.getElementById(id)).toBeNull();
    const lesson = html.slice(html.indexOf('<main id="main"'), html.indexOf('<section id="quiz"'));
    expect(lesson).not.toMatch(/What Is Density\?|Back to the Harbor|Brain Check|g\/cm³|length × width × height|Engineer's Property Match/);
    expect(html).not.toContain("DENSITY REVIEW");
    expect(html).not.toContain("VOCABULARY EXPLORER");
    expect(html).not.toContain(".dz-");
    expect(html).not.toContain(".wrapup-");
    expect(html).not.toContain(".match-scenario");
    // Shared rules that used to sit in removed blocks still style what remains.
    expect(html).toMatch(/\.ship-btn, \.pt-go \{\n  min-height: 48px;[\s\S]*?background: linear-gradient\(135deg, var\(--gold\), #ffd97a\);/);
    expect(html).toMatch(/\n\.tm-label \{\n  font-size: 0\.72rem;/);
  });

  describe("ship-loading investigation", () => {
    test("Cargo Ship follows the seven investigations with one concise displacement explanation", () => {
      const section = doc.getElementById("ship-lab").closest("section");
      expect(section.id).toBe("buoyancy");
      expect(doc.getElementById("dw-lab").compareDocumentPosition(doc.getElementById("ship-lab")) & 4).toBeTruthy();
      expect(text(section.querySelector(".section-label"))).toBe("Challenge · Buoyancy");
      expect(text(section.querySelector(".section-desc"))).toBe("Water pushes up on anything placed in it. That upward push is called buoyancy. A steel ship can float because its hollow shape allows it to displace enough water to support its weight.");
      // Never claims the ship displaces water weighing more than ship and cargo.
      expect(text(section)).not.toMatch(/weighs more than the ship/i);
      expect(html).toContain("#buoyancy + #mystery { padding-top: 1.6rem; }");
    });

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

  describe("property vocabulary (three groups)", () => {
    const groups = () => [...doc.querySelectorAll("#vocab .pg-group")];

    test("eight properties sit in three labeled behavior groups with the approved wording", () => {
      expect(groups().map((g) => text(g.querySelector("h3.pg-head")))).toEqual([
        "Force & Shape",
        "Heat",
        "Electricity & Magnetism",
      ]);
      groups().forEach((g) => expect(doc.getElementById(g.getAttribute("aria-labelledby"))).toBe(g.querySelector("h3")));
      const cards = (g) => [...g.querySelectorAll(".prop-card")].map((c) => [text(c.querySelector("h4.prop-card-name")), text(c.querySelector(".prop-card-def")), text(c.querySelector(".prop-card-ex"))]);
      expect(groups().map(cards)).toEqual([
        [
          ["Flexibility", "Bends without breaking.", "Example: Garden hose"],
          ["Malleability", "Can be flattened without breaking.", "Example: Aluminum foil"],
          ["Ductility", "Can be drawn into a wire.", "Example: Copper wire"],
          ["Hardness", "Resists scratching.", "Example: Diamond drill tip"],
        ],
        [
          ["Thermal Conductivity", "How easily heat moves through a material.", "Example: Metal pan"],
          ["Melting Point", "The temperature at which a solid becomes a liquid.", "Example: Ice melts at 0°C"],
        ],
        [
          ["Electrical Conductivity", "How easily electric current flows through a material.", "Example: Copper wire"],
          ["Magnetism", "Whether a material is attracted to a magnet.", "Example: Iron or steel"],
        ],
      ]);
      expect(doc.querySelectorAll("#vocab .prop-card").length).toBe(8);
      expect(doc.querySelectorAll("main .prop-card").length).toBe(8);
      expect(text(doc.querySelector("#vocab .section-desc"))).toBe("A physical property is something you can observe or measure without changing what a material is.");
      expect(doc.querySelectorAll("#vocab .vx-term, #vocab .vx-panel")).toHaveLength(0);
    });

    test("cards are plain: no emojis, no bolding in definitions; the look-alikes box is replaced by a Remember line", () => {
      const wrap = doc.querySelector("#vocab .pg-wrap");
      expect(wrap.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(wrap.querySelectorAll(".prop-card-icon, .prop-card-def strong").length).toBe(0);
      expect(doc.querySelector(".lookalike")).toBeNull();
      expect(html).not.toMatch(/Watch out for look-alikes/i);
      const remember = groups()[0].querySelector(".pg-remember");
      expect(text(remember)).toBe("Remember: Flexibility = bend · Ductility = wire · Malleability = flatten");
      expect(groups()[0].querySelector(".pg-cards").compareDocumentPosition(remember) & 4).toBeTruthy();
    });

    test("order: vocabulary groups, then the investigations, Cargo Ship, and the Mystery Cube", () => {
      expect(doc.querySelector("#properties .name-it, #properties .pg-wrap")).toBeNull();
      const order = [doc.querySelector("#vocab .pg-wrap"), ...["hs-lab", "ec-lab", "th-lab", "ship-lab", "id-lab"].map((id) => doc.getElementById(id))];
      for (let i = 0; i < order.length - 1; i++) expect(order[i].compareDocumentPosition(order[i + 1]) & 4).toBeTruthy();
    });

    test("responsive layout CSS", () => {
      expect(html).toContain(".pg-wrap { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);");
      expect(html).toContain(".pg-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 1fr; gap: 0.6rem; }");
      expect(html).toContain("@media (max-width: 760px) { .pg-wrap { grid-template-columns: minmax(0, 1fr); } }");
      expect(html).toMatch(/@media \(max-width: 480px\) \{\n  \.pg-cards \{ grid-template-columns: minmax\(0, 1fr\);/);
    });
  });

  describe("property test bench", () => {
    const pick = (sel) => click(doc.querySelector(sel));
    const shown = (sel) => [...doc.querySelectorAll(sel)].filter((g) => g.style.display !== "none").map((g) => g.getAttribute("data-tool") || g.getAttribute("data-mat"));

    test("the three investigations sit in Properties, after the vocabulary groups and before the Mystery Cube", () => {
      const ids = ["hs-lab", "ec-lab", "th-lab", "id-lab"].map((id) => doc.getElementById(id));
      ids.slice(0, 3).forEach((el) => expect(el.closest("section").id).toBe("properties"));
      for (let i = 0; i < 3; i++) expect(ids[i].compareDocumentPosition(ids[i + 1]) & 4).toBeTruthy();
      expect(doc.querySelector("#vocab .pg-wrap").compareDocumentPosition(ids[0]) & 4).toBeTruthy();
      expect(["hs-lab", "ec-lab", "th-lab"].map((id) => text(doc.querySelector(`#${id} .mlab-title`)))).toEqual(["Can You Scratch It?", "Will the Bulb Light Up?", "Which Material Transfers Heat Fastest?"]);
      expect(text(doc.querySelector("#hs-lab .pt-instr"))).toBe("Choose a material and a tool. Test whether the tool leaves a scratch.");
      expect(text(doc.querySelector("#ec-lab .pt-instr"))).toBe("Choose a material to complete the circuit.");
      expect(text(doc.querySelector("#th-lab .pt-instr"))).toBe("Heat one end of a material. Watch what happens at the other end.");
    });

    test("scratch test: tool drawing matches the tool, with tool-specific colors", () => {
      expect(shown("#hs-tool .hs-tl")).toEqual(["fingernail"]);
      pick('.hs-tool-btn[data-tool="coin"]');
      expect(shown("#hs-tool .hs-tl")).toEqual(["coin"]);
      const coin = doc.querySelector('.hs-tl[data-tool="coin"]');
      expect(coin.querySelector("circle").getAttribute("fill")).toBe("url(#hs-g-copper)");
      expect(html).toMatch(/id="hs-g-copper"[\s\S]*?#c8692f/);
      pick('.hs-tool-btn[data-tool="nail"]');
      const nail = doc.querySelector('.hs-tl[data-tool="nail"]');
      expect(shown("#hs-tool .hs-tl")).toEqual(["nail"]);
      expect(nail.querySelector("rect").getAttribute("fill")).toBe("url(#hs-g-steel)");
      expect(nail.querySelector("path").getAttribute("d")).toMatch(/^M0 0 /);
      expect(doc.querySelector('.hs-tool-btn[data-tool="nail"]').getAttribute("aria-pressed")).toBe("true");
      pick('.hs-mat-btn[data-mat="glass"]');
      expect(shown("#hs-svg .hs-mat")).toEqual(["glass"]);
      expect(text(doc.querySelector('.hs-mat[data-mat="glass"] text'))).toBe("GLASS");
    });

    test("scratch outcomes follow the documented classroom comparison", () => {
      const expected = {
        wax: { fingernail: true, coin: true, nail: true },
        plastic: { fingernail: false, coin: false, nail: true },
        aluminum: { fingernail: false, coin: false, nail: true },
        glass: { fingernail: false, coin: false, nail: false },
      };
      const scratch = doc.getElementById("hs-scratch");
      for (const [mat, tools] of Object.entries(expected)) {
        for (const [tool, made] of Object.entries(tools)) {
          pick(`.hs-mat-btn[data-mat="${mat}"]`);
          pick(`.hs-tool-btn[data-tool="${tool}"]`);
          expect(scratch.getAttribute("visibility")).toBe("hidden");
          click(doc.getElementById("hs-test"));
          const fb = text(doc.getElementById("hs-fb"));
          if (made) {
            expect(fb).toMatch(/^A scratch appeared! The tool is harder than the material\./);
            expect(scratch.getAttribute("visibility")).toBe("visible");
            expect(scratch.style.strokeDashoffset).toBe("0");
          } else {
            expect(fb).toMatch(/^No scratch! This material resisted the tool\./);
            expect(scratch.getAttribute("visibility")).toBe("hidden");
          }
        }
      }
      pick('.hs-mat-btn[data-mat="wax"]');
      click(doc.getElementById("hs-test"));
      expect(scratch.getAttribute("visibility")).toBe("visible");
      pick('.hs-tool-btn[data-tool="coin"]');
      expect(scratch.getAttribute("visibility")).toBe("hidden");
      expect(doc.getElementById("hs-fb").textContent).toBe("");
      expect(doc.getElementById("hs-svg").getAttribute("aria-label")).toBe("A copper coin resting on a sample of wax.");
    });

    test("circuit: conductors light the bulb, insulators leave it dark, and the material fills the gap", () => {
      const test_ = doc.getElementById("ec-test");
      expect(test_.getAttribute("aria-disabled")).toBe("true");
      click(test_);
      expect(text(doc.getElementById("ec-fb"))).toBe("Choose a material first.");
      const halo = doc.getElementById("ec-halo");
      for (const [mat, lit] of [["copper", true], ["aluminum", true], ["plastic", false], ["rubber", false], ["wood", false]]) {
        pick(`.ec-mat-btn[data-mat="${mat}"]`);
        expect(halo.getAttribute("opacity")).toBe("0");
        expect(doc.getElementById("ec-sample").getAttribute("visibility")).toBe("hidden");
        click(test_);
        expect(doc.getElementById("ec-sample").getAttribute("visibility")).toBe("visible");
        expect(doc.getElementById("ec-slot").getAttribute("visibility")).toBe("hidden");
        expect(halo.getAttribute("opacity")).toBe(lit ? "1" : "0");
        expect(doc.getElementById("ec-lab").classList.contains("is-lit")).toBe(lit);
        expect(text(doc.getElementById("ec-fb"))).toMatch(lit ? /^The bulb lights up! .* is a conductor/ : /^The bulb stays dark\. .* is an insulator in this circuit/);
      }
      expect(text(doc.getElementById("ec-sample-text"))).toBe("Dry wood");
      expect(doc.getElementById("ec-svg").getAttribute("aria-label")).toBe("Dry wood fills the gap, but no current flows and the bulb stays dark.");
      expect(text(doc.querySelector("#ec-lab .pt-note"))).toMatch(/high voltage/);
    });

    test("heat: compact time and far-end status, no feedback panel, 60 s limit", async () => {
      const heat = doc.getElementById("th-heat");
      const time = () => text(doc.getElementById("th-time"));
      const far = () => text(doc.getElementById("th-far"));
      expect(doc.getElementById("th-state")).toBeNull();
      expect(doc.querySelector("#th-lab .pt-fb")).toBeNull();
      expect([time(), far()]).toEqual(["0 s", "Cool"]);
      click(heat);
      expect([time(), far()]).toEqual(["5 s", "Warming"]);
      expect(doc.getElementById("th-far").className).toBe("th-far is-warm");
      const h1 = Number(doc.getElementById("th-liquid").getAttribute("height"));
      click(heat);
      expect([time(), far()]).toEqual(["10 s", "Hot"]);
      expect(Number(doc.getElementById("th-liquid").getAttribute("height"))).toBeGreaterThan(h1);
      await wait(150);
      expect(doc.getElementById("th-announce").textContent).toBe("10 seconds. Far end: Hot.");
      pick('.th-mat-btn[data-mat="wood"]');
      for (let i = 0; i < 13; i++) click(heat);
      expect([time(), far()]).toEqual(["60 s (limit)", "Cool"]);
      expect(heat.getAttribute("aria-disabled")).toBe("true");
      await wait(150);
      expect(doc.getElementById("th-announce").textContent).toBe("60 seconds. Far end: Cool. Heating limit reached.");
      expect(text(doc.getElementById("th-reset"))).toBe("Cool Down");
      expect(text(doc.getElementById("th-reset-all"))).toBe("Reset All");
      expect(text(doc.querySelector("#th-lab .th-results-head .pt-label"))).toBe("Experiment Results");
    });

    test("heat results: one row per material, provisional runs marked, records kept and never duplicated", () => {
      const heat = doc.getElementById("th-heat");
      const rows = () => [...doc.querySelectorAll("#th-results li")].map((li) => text(li));
      const row = (m) => doc.querySelector(`#th-results li[data-mat="${m}"]`);
      const disc = () => text(doc.getElementById("th-discover"));
      expect(rows()).toEqual(["Copper Not tested", "Steel Not tested", "Glass Not tested", "Wood Not tested"]);
      expect(disc()).toBe("Test a metal and a nonmetal to compare heat transfer.");
      click(heat);
      expect(text(row("copper"))).toBe("Copper Testing Warming at 5 s");
      expect(row("copper").className).toBe("is-testing");
      click(heat);
      expect(text(row("copper"))).toBe("Copper Hot at 10 s");
      expect(row("copper").className).toBe("is-done");
      expect(disc()).toBe("Test a metal and a nonmetal to compare heat transfer.");
      pick('.th-mat-btn[data-mat="glass"]');
      click(heat);
      expect(text(row("glass"))).toBe("Glass Testing Still cool at 5 s");
      expect(disc()).toBe("Heat the glass or wood for at least 10 s to compare.");
      click(heat);
      expect(disc()).toBe("Discovery: Metals generally transfer heat faster than glass or wood.");
      for (let i = 0; i < 3; i++) click(heat);
      click(doc.getElementById("th-reset"));
      expect(text(doc.getElementById("th-time"))).toBe("0 s");
      expect(text(doc.getElementById("th-far"))).toBe("Cool");
      expect(doc.getElementById("th-s1").getAttribute("stop-opacity")).toBe("0");
      expect(text(row("glass"))).toBe("Glass Still cool at 25 s");
      expect(text(row("copper"))).toBe("Copper Hot at 10 s");
      click(heat);
      expect(text(row("glass"))).toBe("Glass Testing Still cool at 5 s");
      pick('.th-mat-btn[data-mat="steel"]');
      expect(text(row("glass"))).toBe("Glass Still cool at 25 s");
      for (let i = 0; i < 12; i++) click(heat);
      expect(text(row("steel"))).toBe("Steel Hot at 50 s");
      pick('.th-mat-btn[data-mat="copper"]');
      for (let i = 0; i < 4; i++) click(heat);
      expect(text(row("copper"))).toBe("Copper Hot at 10 s");
      expect(doc.querySelectorAll("#th-results li").length).toBe(4);
      expect(rows().filter((t) => t.startsWith("Copper")).length).toBe(1);
      click(doc.getElementById("th-reset-all"));
      expect(rows()).toEqual(["Copper Not tested", "Steel Not tested", "Glass Not tested", "Wood Not tested"]);
      expect(text(doc.getElementById("th-time"))).toBe("0 s");
      expect(doc.querySelector('.th-mat-btn[data-mat="copper"]').getAttribute("aria-pressed")).toBe("true");
      expect(disc()).toBe("Test a metal and a nonmetal to compare heat transfer.");
    });

    test("heat discovery needs a hot metal and a nonmetal heated at least as long", () => {
      const heat = doc.getElementById("th-heat");
      const disc = () => text(doc.getElementById("th-discover"));
      pick('.th-mat-btn[data-mat="wood"]');
      click(heat);
      pick('.th-mat-btn[data-mat="steel"]');
      click(heat);
      expect(disc()).toBe("Keep heating the metal until its far end is hot.");
      for (let i = 0; i < 9; i++) click(heat);
      expect(text(doc.querySelector('#th-results li[data-mat="steel"]'))).toBe("Steel Hot at 50 s");
      expect(disc()).toBe("Heat the glass or wood for at least 50 s to compare.");
      pick('.th-mat-btn[data-mat="wood"]');
      for (let i = 0; i < 10; i++) click(heat);
      expect(disc()).toBe("Discovery: Metals generally transfer heat faster than glass or wood.");
    });

    test("heat model order: copper beats steel, steel beats glass and wood at every time", () => {
      const levelAt = (mat, n) => {
        pick(`.th-mat-btn[data-mat="${mat}"]`);
        for (let i = 0; i < n; i++) click(doc.getElementById("th-heat"));
        return Number(doc.getElementById("th-liquid").getAttribute("height"));
      };
      for (const n of [1, 4, 12]) {
        const [c, s, g, w] = ["copper", "steel", "glass", "wood"].map((m) => levelAt(m, n));
        expect(c).toBeGreaterThanOrEqual(s);
        expect(s).toBeGreaterThanOrEqual(g);
        expect(g).toBeGreaterThanOrEqual(w);
      }
      expect(text(doc.querySelector("#th-lab figcaption"))).toMatch(/same size, starts at room temperature, and gets the same heat\. This is a model, not a measurement\./);
    });

    test("keyboard and screen readers: native buttons, pressed states, live feedback", () => {
      for (const sel of ["#hs-lab", "#ec-lab", "#th-lab"]) {
        const btns = doc.querySelectorAll(`${sel} button`);
        expect(btns.length).toBeGreaterThan(3);
        btns.forEach((b) => expect(b.getAttribute("type")).toBe("button"));
        expect(doc.querySelector(`${sel} svg`).getAttribute("role")).toBe("img");
        expect(doc.querySelector(`${sel} svg`).getAttribute("aria-label")).not.toBe("");
      }
      for (const id of ["hs-fb", "ec-fb", "th-announce"]) expect(doc.getElementById(id).getAttribute("aria-live")).toBe("polite");
      doc.querySelectorAll(".pt-chip").forEach((b) => expect(["true", "false"]).toContain(b.getAttribute("aria-pressed")));
      doc.querySelectorAll(".pt-chip .pt-swatch").forEach((s) => expect(s.getAttribute("aria-hidden")).toBe("true"));
    });

    test("layout stability: feedback is never empty and changing areas reserve their space", () => {
      const fb = () => text(doc.getElementById("ec-fb"));
      expect(fb()).toBe("Pick a material, then press Test Circuit.");
      pick('.ec-mat-btn[data-mat="rubber"]');
      expect(fb()).toBe("Rubber is ready. Press Test Circuit.");
      click(doc.getElementById("ec-test"));
      pick('.ec-mat-btn[data-mat="copper"]');
      expect(fb()).toBe("Copper is ready. Press Test Circuit.");
      expect(html).toContain(".ec-lab .pt-fb { min-height: calc(3em + 1.2rem + 2px); }");
      expect(html).toContain(".th-discover { margin: 0.4rem 0 0; min-height: 2.9em;");
      expect(html).toContain("grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.3rem; }");
      expect(html).toContain("@media (min-width: 900px) { .ec-controls .pt-chips { grid-template-columns: repeat(5, minmax(0, 1fr)); } }");
      expect(html).toContain(".ec-figure { max-width: clamp(300px, calc((100vh - 480px) * 1.579), 500px); margin: 0 auto; }");
      const bench = html.slice(html.indexOf("<!-- ===== SCRATCH TEST"), html.indexOf("<!-- ===== MYSTERY CUBE INVESTIGATION"));
      expect(bench.length).toBeGreaterThan(1000);
      expect(bench).not.toMatch(/scrollIntoView|scrollTo|\.focus\(/);
      expect(html).not.toContain("overflow-anchor");
      expect(doc.getElementById("ec-svg").getAttribute("viewBox")).toBe("0 -18 360 228");
      expect(doc.getElementById("th-svg").getAttribute("viewBox")).toBe("0 0 360 150");
    });

    test("responsive and reduced-motion CSS", () => {
      expect(html).toContain("@media (max-width: 760px) { .pt-layout { grid-template-columns: minmax(0, 1fr); } }");
      expect(html).toContain("@media (max-width: 480px) { .hs-lab .pt-chips.hs-tools { grid-template-columns: minmax(0, 1fr); } }");
      expect(html).toContain(".pt-chip.check-opt { min-height: 44px;");
      expect(html).toContain("@media (prefers-reduced-motion: reduce) { .hs-tool.hs-moving, #hs-scratch.hs-moving, .ec-glow, .ec-wire, .th-liquid { transition: none; } }");
    });
  });

  describe("magnet, melting, and press investigations", () => {
    const pick = (lab, k) => click(doc.querySelector(`#${lab} .pt-chip[data-mat="${k}"]`));
    const fb = (id) => text(doc.getElementById(id));
    const disc = (id) => doc.getElementById(id);

    test("placement: seven investigations in order before the Mystery Cube, with approved titles and directions", () => {
      const order = ["hs-lab", "ec-lab", "th-lab", "mg-lab", "mp-lab", "ml-lab", "dw-lab", "id-lab"].map((id) => doc.getElementById(id));
      expect(order.map((el) => el.closest("section").id)).toEqual([...Array(7).fill("properties"), "mystery"]);
      expect([...doc.querySelectorAll("#properties .mlab-card")].map((c) => c.id)).toEqual(["hs-lab", "ec-lab", "th-lab", "mg-lab", "mp-lab", "ml-lab", "dw-lab"]);
      for (let i = 0; i < order.length - 1; i++) expect(order[i].compareDocumentPosition(order[i + 1]) & 4).toBeTruthy();
      expect(["mg-lab", "mp-lab", "ml-lab", "dw-lab"].map((id) => text(doc.querySelector(`#${id} .mlab-title`)))).toEqual(["Will It Stick?", "When Will It Melt?", "Flatten or Break?", "Can You Make a Wire?"]);
      expect(text(doc.querySelector("#dw-lab .pt-instr"))).toBe("Choose a material. Pull it through the machine to see if it forms a wire.");
      expect(text(doc.querySelector("#mg-lab .pt-instr"))).toBe("Choose a material. Move the magnet close and see what happens.");
      expect(text(doc.querySelector("#mp-lab .pt-instr"))).toBe("Choose a substance. Increase the temperature until it melts.");
      expect(text(doc.querySelector("#ml-lab .pt-instr"))).toBe("Choose a material. Apply force and watch what happens.");
      // No prediction gate and no typing in the new investigations.
      for (const id of ["mg-lab", "mp-lab", "ml-lab", "dw-lab"]) {
        expect(doc.querySelectorAll(`#${id} input, #${id} textarea, #${id} .predict-gated, #${id} .vx-panel`)).toHaveLength(0);
      }
    });

    test("magnet: all five materials in the mixed order, correct attraction, labels in text", () => {
      const EXPECT = { iron: true, copper: false, plastic: false, steel: true, aluminum: false };
      expect([...doc.querySelectorAll("#mg-lab .mg-mat-btn")].map((b) => text(b))).toEqual(["Iron", "Copper", "Plastic", "Steel", "Aluminum"]);
      const NAMES = { iron: "Iron", steel: "Steel", aluminum: "Aluminum", copper: "Copper", plastic: "Plastic" };
      expect([...doc.querySelectorAll("#mg-lab .mg-mat-btn")].map((b) => b.dataset.mat)).toEqual(Object.keys(EXPECT));
      for (const [k, sticks] of Object.entries(EXPECT)) {
        pick("mg-lab", k);
        expect(doc.getElementById("mg-label").textContent).toBe(NAMES[k]);
        expect(fb("mg-fb")).toBe(`${NAMES[k]} is ready. Press Test Magnet.`);
        click(doc.getElementById("mg-test"));
        expect(fb("mg-fb")).toBe(`${NAMES[k]} ${sticks ? "is" : "is not"} attracted to the magnet.`);
        expect(doc.getElementById("mg-magnet").style.transform).toBe("translateX(50px)");
        expect(doc.getElementById("mg-sample").style.transform).toBe(sticks ? "translateX(-60px)" : "translateX(0px)");
        expect(doc.getElementById("mg-fb").className).toContain(sticks ? "yes" : "no");
      }
      expect(doc.querySelector("#mg-lab .pt-note").textContent).toMatch(/stainless steels are only weakly attracted/);
    });

    test("magnet: changing material and Reset restore the ready state", () => {
      click(doc.getElementById("mg-test"));
      pick("mg-lab", "copper");
      expect(doc.getElementById("mg-magnet").style.transform).toBe("translateX(0px)");
      expect(doc.getElementById("mg-sample").style.transform).toBe("translateX(0px)");
      expect(doc.querySelector('.mg-mat-btn[data-mat="copper"]').getAttribute("aria-pressed")).toBe("true");
      pick("mg-lab", "iron");
      click(doc.getElementById("mg-test"));
      click(doc.getElementById("mg-reset"));
      expect(doc.getElementById("mg-sample").style.transform).toBe("translateX(0px)");
      expect(fb("mg-fb")).toBe("Iron is ready. Press Test Magnet.");
    });

    test("magnet discovery needs an attracted metal and a metal that is not attracted", () => {
      const d = disc("mg-discover");
      expect(d.textContent).not.toMatch(/Discovery/);
      expect(d.classList.contains("pt-wait")).toBe(true);
      click(doc.getElementById("mg-test")); // iron
      pick("mg-lab", "plastic");
      click(doc.getElementById("mg-test")); // plastic is not a metal
      expect(d.textContent).not.toMatch(/Discovery/);
      pick("mg-lab", "aluminum");
      click(doc.getElementById("mg-test"));
      expect(text(d)).toBe("Discovery: Not all metals are magnetic.");
      click(doc.getElementById("mg-reset"));
      expect(text(d)).toBe("Discovery: Not all metals are magnetic.");
    });

    test("melting: five substances, model thresholds, solid then melting then liquid", () => {
      const MODEL = {
        ice: ["Ice", -10, 0, 5, "Ice begins melting at 0°C."],
        oil: ["Coconut oil", 10, 25, 5, "Coconut oil begins melting at about 25°C."],
        wax: ["Paraffin wax", 20, 55, 5, "Paraffin wax begins melting at about 55°C."],
        bismuth: ["Bismuth", 20, 271, 100, "Bismuth begins melting at about 271°C."],
        gold: ["Gold", 20, 1064, 100, "Gold begins melting at about 1,064°C."],
      };
      expect([...doc.querySelectorAll("#mp-lab .mp-mat-btn")].map((b) => b.dataset.mat)).toEqual(Object.keys(MODEL));
      const heat = doc.getElementById("mp-heat");
      const fmt = (t) => `${String(t).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}°C`;
      for (const [k, [name, start, melt, step, msg]] of Object.entries(MODEL)) {
        pick("mp-lab", k);
        expect(doc.querySelector(`.mp-step[data-step="${step}"]`).getAttribute("aria-pressed")).toBe("true");
        expect(fb("mp-fb")).toBe(`${name} is solid at ${fmt(start)}. Press Increase Temperature.`);
        expect(doc.getElementById("mp-puddle").style.display).toBe("none");
        let t = start;
        while (t + step < melt) {
          click(heat);
          t += step;
          expect(text(doc.getElementById("mp-temp"))).toBe(fmt(t));
          expect(text(doc.getElementById("mp-state"))).toBe("Solid");
          expect(doc.getElementById("mp-puddle").style.display).toBe("none");
        }
        click(heat);
        t += step;
        expect(text(doc.getElementById("mp-temp"))).toBe(fmt(t));
        expect(t).toBeGreaterThanOrEqual(melt);
        expect(text(doc.getElementById("mp-state"))).toBe("Melting");
        expect(fb("mp-fb")).toBe(msg);
        click(heat);
        expect(text(doc.getElementById("mp-state"))).toBe("Liquid");
        expect(doc.getElementById("mp-solid").style.display).toBe("none");
        expect(heat.getAttribute("aria-disabled")).toBe("true");
      }
      expect(doc.getElementById("mp-puddle").getAttribute("fill")).toBe("url(#mp-g-gold-l)");
      expect(text(doc.querySelector("#mp-lab .pt-note"))).toMatch(/^Melting changes a substance's state, not what the substance is\./);
    });

    test("melting: a large step that crosses the melting point reports the melting point, not the start or end temperature", () => {
      const heat = doc.getElementById("mp-heat");
      pick("mp-lab", "gold");
      for (let i = 0; i < 10; i++) click(heat);
      expect(text(doc.getElementById("mp-temp"))).toBe("1,020°C");
      expect(text(doc.getElementById("mp-state"))).toBe("Solid");
      click(heat);
      expect(text(doc.getElementById("mp-temp"))).toBe("1,120°C");
      expect(fb("mp-fb")).toBe("Gold begins melting at about 1,064°C.");
      expect(text(doc.querySelector('#mp-results li[data-mat="gold"]'))).toBe("Gold about 1,064°C");
      // Students can switch increments; +100°C on ice still reports 0°C.
      pick("mp-lab", "ice");
      expect(doc.querySelector('.mp-step[data-step="5"]').getAttribute("aria-pressed")).toBe("true");
      click(doc.querySelector('.mp-step[data-step="100"]'));
      expect(doc.querySelector('.mp-step[data-step="100"]').getAttribute("aria-pressed")).toBe("true");
      click(heat);
      expect(text(doc.getElementById("mp-temp"))).toBe("90°C");
      expect(fb("mp-fb")).toBe("Ice begins melting at 0°C.");
      click(doc.querySelector('.mp-step[data-step="5"]'));
      pick("mp-lab", "bismuth");
      click(doc.querySelector('.mp-step[data-step="5"]'));
      click(heat);
      expect(text(doc.getElementById("mp-temp"))).toBe("25°C");
    });

    test("melting: metal discovery appears after one metal melts; the comparison needs two substances", () => {
      const d = disc("mp-discover");
      const heat = doc.getElementById("mp-heat");
      pick("mp-lab", "bismuth");
      click(heat); click(heat);
      expect(d.textContent).not.toMatch(/Discovery/);
      click(heat);
      expect(text(d)).toBe("Discovery: Even metals can melt.");
      pick("mp-lab", "ice");
      click(heat); click(heat);
      expect(text(d)).toBe("Discovery: Different substances melt at different temperatures. Even metals can melt.");
    });

    test("melting: Reset and switching substances return to the starting solid; results are kept", () => {
      const heat = doc.getElementById("mp-heat");
      click(heat); click(heat); click(heat);
      expect(text(doc.getElementById("mp-state"))).toBe("Liquid");
      click(doc.getElementById("mp-reset"));
      expect(text(doc.getElementById("mp-temp"))).toBe("-10°C");
      expect(text(doc.getElementById("mp-state"))).toBe("Solid");
      expect(heat.getAttribute("aria-disabled")).toBeNull();
      expect(text(doc.querySelector('#mp-results li[data-mat="ice"]'))).toBe("Ice 0°C");
      pick("mp-lab", "wax");
      expect(text(doc.getElementById("mp-temp"))).toBe("20°C");
      expect(doc.querySelector('.mp-mat-btn[data-mat="wax"]').getAttribute("aria-pressed")).toBe("true");
    });

    test("melting discovery needs two substances to reach their melting points", () => {
      const d = disc("mp-discover");
      const heat = doc.getElementById("mp-heat");
      expect(d.textContent).not.toMatch(/Discovery/);
      click(heat); click(heat);
      expect(d.textContent).not.toMatch(/Discovery/);
      pick("mp-lab", "oil");
      click(heat); click(heat);
      expect(d.textContent).not.toMatch(/Discovery/);
      click(heat);
      expect(text(d)).toBe("Discovery: Different substances melt at different temperatures.");
    });

    test("press: aluminum and copper flatten, glass and chalk break", () => {
      const EXPECT = { aluminum: true, copper: true, glass: false, chalk: false };
      const NAMES = { aluminum: "Aluminum", copper: "Copper", glass: "Glass", chalk: "Chalk" };
      expect([...doc.querySelectorAll("#ml-lab .ml-mat-btn")].map((b) => b.dataset.mat)).toEqual(Object.keys(EXPECT));
      const lab = doc.getElementById("ml-lab");
      for (const [k, flat] of Object.entries(EXPECT)) {
        pick("ml-lab", k);
        expect(doc.getElementById("ml-label").textContent).toBe(NAMES[k]);
        click(doc.getElementById("ml-test"));
        expect(fb("ml-fb")).toBe(flat ? `${NAMES[k]} flattens without breaking. It is malleable.` : `${NAMES[k]} breaks instead of flattening. It is brittle.`);
        expect(lab.classList.contains("is-flat")).toBe(flat);
        expect(lab.classList.contains("is-broken")).toBe(!flat);
        expect(doc.getElementById("ml-solid").style.display).toBe(flat ? "" : "none");
        expect(doc.getElementById("ml-pieces").getAttribute("visibility")).toBe(flat ? "hidden" : "visible");
        if (flat) expect(doc.getElementById("ml-solid").style.transform).toBe("scale(1.9, 0.35)");
        else doc.querySelectorAll(".ml-piece").forEach((p) => expect(p.style.transform).toMatch(/^translate\(/));
      }
    });

    test("press: Reset restores the sample and press; discovery needs one malleable and one brittle material", () => {
      const d = disc("ml-discover");
      click(doc.getElementById("ml-test")); // aluminum
      pick("ml-lab", "copper");
      click(doc.getElementById("ml-test"));
      expect(d.textContent).not.toMatch(/Discovery/);
      click(doc.getElementById("ml-reset"));
      expect(doc.getElementById("ml-ram").style.transform).toBe("");
      expect(doc.getElementById("ml-solid").style.transform).toBe("");
      expect(doc.getElementById("ml-lab").classList.contains("is-flat")).toBe(false);
      expect(fb("ml-fb")).toBe("Copper is ready. Press Apply Force.");
      pick("ml-lab", "chalk");
      click(doc.getElementById("ml-test"));
      expect(text(d)).toBe("Discovery: Materials respond differently when force is applied.");
      click(doc.getElementById("ml-reset"));
      doc.querySelectorAll(".ml-piece").forEach((p) => expect(p.style.transform).toBe(""));
    });

    test("accessibility: native buttons, pressed states, live text feedback, described drawings", () => {
      for (const id of ["mg-lab", "mp-lab", "ml-lab", "dw-lab"]) {
        doc.querySelectorAll(`#${id} button`).forEach((b) => expect(b.getAttribute("type")).toBe("button"));
        doc.querySelectorAll(`#${id} .pt-chip`).forEach((b) => expect(["true", "false"]).toContain(b.getAttribute("aria-pressed")));
        expect(doc.querySelectorAll(`#${id} .pt-chip[aria-pressed="true"]`)).toHaveLength(1);
        const svg = doc.querySelector(`#${id} svg`);
        expect(svg.getAttribute("role")).toBe("img");
        expect(svg.getAttribute("aria-label").length).toBeGreaterThan(20);
        expect(doc.querySelector(`#${id} .pt-chips`).getAttribute("role")).toBe("group");
      }
      for (const id of ["mg-fb", "mp-fb", "ml-fb", "dw-fb"]) expect(doc.getElementById(id).getAttribute("aria-live")).toBe("polite");
      doc.querySelectorAll(".mp-step").forEach((b) => expect(["true", "false"]).toContain(b.getAttribute("aria-pressed")));
      expect(doc.querySelector(".mp-steps").getAttribute("role")).toBe("group");
      click(doc.getElementById("mg-test"));
      expect(doc.getElementById("mg-svg").getAttribute("aria-label")).toMatch(/stuck to it/);
    });

    test("layout stability, responsive, and reduced-motion CSS", () => {
      for (const id of ["mg-fb", "mp-fb", "ml-fb"]) expect(fb(id).length).toBeGreaterThan(5);
      for (const id of ["mg-discover", "mp-discover", "ml-discover"]) expect(text(disc(id)).length).toBeGreaterThan(5);
      expect(html).toContain(".pt-fb.pt-fb-fixed { margin-top: 0.55rem; min-height: calc(3em + 1.2rem + 2px); }");
      expect(html).toContain(".pt-fb.pt-fb-fixed:empty { display: block; }");
      expect(html).toContain(".pt-discover { margin: 0.4rem 0 0; min-height: 2.9em;");
      expect(html).toContain("@media (min-width: 761px) and (max-width: 1100px) { .mg-lab .pt-layout, .mp-lab .pt-layout, .ml-lab .pt-layout, .dw-lab .pt-layout {");
      expect(html).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n  \.mg-magnet\.pt-moving, \.mg-sample\.pt-moving, \.ml-ram, \.ml-solid, \.ml-piece, \.dw-grip, \.dw-tip, \.dw-rod, #dw-wire, \.dw-shard,/);
      const bench = html.slice(html.indexOf("<!-- ===== MAGNET TEST"), html.indexOf("<!-- ===== MYSTERY CUBE INVESTIGATION"));
      expect(bench).toMatch(/prefers-reduced-motion/);
      expect(bench).not.toMatch(/scrollIntoView|scrollTo|\.focus\(/);
    });

    test("press (animated): sample stays intact until contact, then responds", async () => {
      for (const [k, flat] of [["aluminum", true], ["copper", true], ["glass", false], ["chalk", false]]) {
        const m = load(rel, { motion: true });
        const d = m.doc;
        click(d.querySelector(`.ml-mat-btn[data-mat="${k}"]`));
        const pieces = [...d.querySelectorAll(".ml-piece")];
        // Intact = one solid shape shown, fragments hidden (no seams can show).
        const seamless = () => d.getElementById("ml-solid").style.display === "" && d.getElementById("ml-pieces").getAttribute("visibility") === "hidden";
        expect(seamless()).toBe(true);
        click(d.getElementById("ml-test"));
        // Phase 1: the press is moving to the contact point; nothing has happened to the sample.
        expect(d.getElementById("ml-ram").style.transform).toBe("translateY(48px)");
        expect(d.getElementById("ml-solid").style.transform).toBe("");
        pieces.forEach((p) => expect(p.style.transform).toBe(""));
        expect(seamless()).toBe(true);
        const lab = d.getElementById("ml-lab");
        expect(lab.classList.contains("is-flat") || lab.classList.contains("is-broken")).toBe(false);
        await wait(900);
        // Phase 2: contact reached; the sample responds and the press finishes.
        expect(lab.classList.contains(flat ? "is-flat" : "is-broken")).toBe(true);
        if (flat) expect(d.getElementById("ml-solid").style.transform).toBe("scale(1.9, 0.35)");
        else expect(seamless()).toBe(false);
        await wait(750);
        expect(text(d.getElementById("ml-fb"))).toMatch(flat ? /malleable/ : /brittle/);
        click(d.getElementById("ml-reset"));
        expect(d.getElementById("ml-ram").style.transform).toBe("");
        expect(seamless()).toBe(true);
        m.win.close();
      }
    }, 15000);

    test("press (animated): Reset during the descent cancels the pending response", async () => {
      const m = load(rel, { motion: true });
      click(m.doc.querySelector('.ml-mat-btn[data-mat="glass"]'));
      click(m.doc.getElementById("ml-test"));
      click(m.doc.getElementById("ml-reset"));
      await wait(900);
      const lab = m.doc.getElementById("ml-lab");
      expect(lab.classList.contains("is-broken")).toBe(false);
      expect(text(m.doc.getElementById("ml-fb"))).toBe("Glass is ready. Press Apply Force.");
      m.win.close();
    });

    test("initial markup, before any script runs: intact samples, short starter tip, puller apart", () => {
      const raw = new JSDOM(html.slice(html.indexOf('<main id="main"'), html.indexOf("</main>") + 7)).window.document;
      // Press: one solid, filled sample; fragments hidden.
      expect(raw.getElementById("ml-pieces").getAttribute("visibility")).toBe("hidden");
      expect(raw.getElementById("ml-solid-rect").getAttribute("fill")).toBe("url(#ml-g-aluminum)");
      // Wire: one rod outline, a starter tip at most 4 units past the die exit (x=184), no wire, puller parked away.
      expect(raw.querySelectorAll("#dw-rod > *")).toHaveLength(1);
      const tipR = raw.getElementById("dw-tip-rect");
      expect(Number(tipR.getAttribute("x")) + Number(tipR.getAttribute("width")) - 184).toBeLessThanOrEqual(4);
      expect(raw.getElementById("dw-wire").getAttribute("width")).toBe("0");
      expect(raw.getElementById("dw-grip").getAttribute("transform")).toBe("translate(100 0)");
      expect(raw.getElementById("dw-crack").getAttribute("visibility")).toBe("hidden");
      expect(raw.getElementById("dw-shards").getAttribute("visibility")).toBe("hidden");
    });

    test("press: glass and chalk show no cracks when ready, after Reset, and after material changes", () => {
      const intact = () => doc.getElementById("ml-solid").style.display === "" && doc.getElementById("ml-pieces").getAttribute("visibility") === "hidden" && doc.getElementById("ml-solid").style.transform === "";
      for (const k of ["glass", "chalk"]) {
        pick("ml-lab", k);
        expect(fb("ml-fb")).toBe(`${k[0].toUpperCase() + k.slice(1)} is ready. Press Apply Force.`);
        expect(intact()).toBe(true);
        click(doc.getElementById("ml-test"));
        expect(intact()).toBe(false);
        click(doc.getElementById("ml-reset"));
        expect(intact()).toBe(true);
        doc.querySelectorAll(".ml-piece").forEach((p) => expect(p.style.transform).toBe(""));
        click(doc.getElementById("ml-test"));
        pick("ml-lab", "aluminum");
        expect(intact()).toBe(true);
      }
    });

    test("wire: Reset restores the rod, starter tip, and parked puller after a break", () => {
      pick("dw-lab", "glass");
      click(doc.getElementById("dw-test"));
      expect(doc.getElementById("dw-crack").getAttribute("visibility")).toBe("visible");
      click(doc.getElementById("dw-reset"));
      expect(doc.getElementById("dw-crack").getAttribute("visibility")).toBe("hidden");
      expect(doc.getElementById("dw-shards").getAttribute("visibility")).toBe("hidden");
      expect(doc.getElementById("dw-tip").style.transform).toBe("");
      expect(doc.getElementById("dw-grip").style.transform).toBe("translateX(100px)");
      expect(doc.getElementById("dw-wire").getAttribute("width")).toBe("0");
    });

    test("wire (reduced motion): transitions off, correct final states", () => {
      expect(doc.getElementById("dw-grip").style.transition).toBe("none");
      pick("dw-lab", "chalk");
      click(doc.getElementById("dw-test"));
      expect(doc.getElementById("dw-grip").style.transition).toBe("none");
      expect(doc.getElementById("dw-crack").getAttribute("visibility")).toBe("visible");
      pick("dw-lab", "gold");
      click(doc.getElementById("dw-test"));
      expect(doc.getElementById("dw-wire").getAttribute("width")).toBe("94");
    });

    test("press (reduced motion): final states are correct with no transitions", () => {
      expect(doc.getElementById("ml-ram").style.transition).toBe("none");
      pick("ml-lab", "glass");
      click(doc.getElementById("ml-test"));
      expect(doc.getElementById("ml-ram").style.transform).toBe("translateY(70px)");
      expect(doc.getElementById("ml-ram").style.transition).toBe("none");
      expect(text(doc.getElementById("ml-fb"))).toBe("Glass breaks instead of flattening. It is brittle.");
    });

    describe("wire drawing (ductility)", () => {
      const FB = {
        copper: "Copper can be drawn into a wire. It is ductile.",
        glass: "Glass breaks instead of forming a wire under these conditions.",
        aluminum: "Aluminum can be drawn into a wire. It is ductile.",
        chalk: "Chalk breaks when the machine tries to draw it into a wire.",
        gold: "Gold can be drawn into a very thin wire. It is highly ductile.",
      };
      const DUCTILE = { copper: true, glass: false, aluminum: true, chalk: false, gold: true };

      test("five materials in the mixed order; ductile ones form wire, brittle ones break", () => {
        expect([...doc.querySelectorAll("#dw-lab .dw-mat-btn")].map((b) => b.dataset.mat)).toEqual(Object.keys(FB));
        const lab = doc.getElementById("dw-lab");
        for (const k of Object.keys(FB)) {
          pick("dw-lab", k);
          expect(fb("dw-fb")).toMatch(/is ready\. Press Draw Wire\.$/);
          expect(doc.getElementById("dw-wire").getAttribute("width")).toBe("0");
          click(doc.getElementById("dw-test"));
          expect(fb("dw-fb")).toBe(FB[k]);
          expect(lab.classList.contains("is-drawn")).toBe(DUCTILE[k]);
          expect(lab.classList.contains("is-broken")).toBe(!DUCTILE[k]);
          expect(Number(doc.getElementById("dw-wire").getAttribute("width")) > 0).toBe(DUCTILE[k]);
          expect(doc.getElementById("dw-crack").getAttribute("visibility")).toBe(DUCTILE[k] ? "hidden" : "visible");
          expect(doc.getElementById("dw-tip").style.transform).toBe("translateX(106px)");
        }
        expect(doc.getElementById("dw-wire").getAttribute("height")).toBe("2");
        pick("dw-lab", "copper");
        expect(doc.getElementById("dw-wire").getAttribute("height")).toBe("4");
        expect(text(doc.querySelector("#dw-lab .pt-note"))).toMatch(/Hot, softened glass can be pulled into thin fibers/);
        expect(text(doc.querySelector("#dw-lab .pt-note"))).toMatch(/Bend = flexible · Flatten = malleable · Pull into a wire = ductile/);
      });

      test("Reset and material changes restore the rod, die, and puller", () => {
        click(doc.getElementById("dw-test"));
        click(doc.getElementById("dw-reset"));
        expect(doc.getElementById("dw-wire").getAttribute("width")).toBe("0");
        expect(doc.getElementById("dw-wire").style.width).toBe("0px");
        expect(doc.getElementById("dw-rod").style.transform).toBe("");
        expect(doc.getElementById("dw-tip").style.transform).toBe("");
        expect(doc.getElementById("dw-grip").style.transform).toBe("translateX(100px)");
        pick("dw-lab", "chalk");
        click(doc.getElementById("dw-test"));
        pick("dw-lab", "gold");
        expect(doc.getElementById("dw-crack").getAttribute("visibility")).toBe("hidden");
        expect(doc.getElementById("dw-shards").getAttribute("visibility")).toBe("hidden");
        expect(doc.querySelector('.dw-mat-btn[data-mat="gold"]').getAttribute("aria-pressed")).toBe("true");
      });

      test("discovery needs one ductile and one brittle result", () => {
        const d = disc("dw-discover");
        click(doc.getElementById("dw-test")); // copper
        pick("dw-lab", "gold");
        click(doc.getElementById("dw-test"));
        expect(d.textContent).not.toMatch(/Discovery/);
        pick("dw-lab", "glass");
        click(doc.getElementById("dw-test"));
        expect(text(d)).toBe("Discovery: Ductile materials can be drawn into wires without breaking.");
      });

      test("animated: the sample is untouched until the puller grips it", async () => {
        for (const k of ["copper", "glass"]) {
          const m = load(rel, { motion: true });
          const d = m.doc;
          click(d.querySelector(`.dw-mat-btn[data-mat="${k}"]`));
          click(d.getElementById("dw-test"));
          expect(d.getElementById("dw-grip").style.transform).toBe("translateX(-6px)");
          expect(d.getElementById("dw-wire").getAttribute("width")).toBe("0");
          expect(d.getElementById("dw-rod").style.transform).toBe("");
          expect(d.getElementById("dw-tip").style.transform).toBe("");
          expect(d.getElementById("dw-crack").getAttribute("visibility")).toBe("hidden");
          await wait(950);
          expect(d.getElementById("dw-tip").style.transform).toBe("translateX(106px)");
          expect(d.getElementById("dw-crack").getAttribute("visibility")).toBe(k === "glass" ? "visible" : "hidden");
          await wait(1250);
          expect(text(d.getElementById("dw-fb"))).toBe(FB[k]);
          m.win.close();
        }
      }, 15000);
    });

    test("the vocabulary groups are not duplicated inside the investigations", () => {
      for (const id of ["mg-lab", "mp-lab", "ml-lab", "dw-lab"]) expect(doc.querySelectorAll(`#${id} .prop-card, #${id} .name-it`)).toHaveLength(0);
    });
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

    test("Mystery Cube is its own challenge after Cargo Ship and right before the quiz", () => {
      const section = doc.getElementById("id-lab").closest("section");
      expect(section.id).toBe("mystery");
      const ids = [...doc.querySelectorAll("main section")].map((s) => s.id);
      expect(ids.slice(ids.indexOf("mystery") - 1, ids.indexOf("mystery") + 2)).toEqual(["buoyancy", "mystery", "quiz"]);
      expect(text(section.querySelector(".id-intro"))).toBe("A small cube came from the supply closet with its label missing. The chart says it is iron, aluminum, hard plastic, or pine wood. Run physical tests to find out which.");
      expect([...doc.querySelectorAll("#mystery .id-test")].map((b) => b.dataset.test)).toEqual(["magnet", "circuit", "water"]);
    });

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

describe("Physical Properties assessment r2", () => {
  const PAYLOADS = path.join(ROOT, "platform/functions/src/scripts/assessments");
  const r1 = require(path.join(PAYLOADS, "physical-properties.r1.json"));
  const r2 = require(path.join(PAYLOADS, "physical-properties.r2.json"));
  const RENDITIONS = path.join(ROOT, "app/lessons/assessment-revisions");
  // Teacher-approved answer key and Webb's DOK level for each r2 item.
  const KEY = ["B", "A", "B", "A", "C", "A", "B", "C", "C", "B"];
  const DOK = [1, 1, 2, 2, 2, 2, 2, 1, 2, 2];
  const quizLiteral = (html) => {
    const at = html.indexOf("<!-- ===== QUIZ ===== -->");
    return html.slice(at, html.indexOf("</script>", at));
  };
  const declaration = (html) => JSON.parse(html.match(/<script type="application\/json" id="lyfelabz-assessment-revision">([\s\S]*?)<\/script>/)[1]);

  test("r2 has exactly 10 three-choice items with the approved key, one correct answer each, and explanations", () => {
    expect(r2).toMatchObject({ activityId: "physical-properties", revisionOrdinal: 2, schemaVersion: 1, itemOrderingRule: "authoredOrder" });
    expect(r2.items).toHaveLength(10);
    r2.items.forEach((item, i) => {
      expect(item.itemId).toBe(`q${i + 1}`);
      expect(item.itemType).toBe("singleChoice");
      expect(item.points).toBe(1);
      expect(item.options.map((o) => o.optionId)).toEqual(["A", "B", "C"]);
      expect(new Set(item.options.map((o) => o.text)).size).toBe(3);
      expect(item.correctOptionId).toBe(KEY[i]);
      expect(item.explanation.length).toBeGreaterThan(20);
    });
    // Correct positions are spread evenly (A3 B4 C3) with no run of three.
    expect(KEY.filter((k) => k === "A")).toHaveLength(3);
    expect(KEY.filter((k) => k === "B")).toHaveLength(4);
    expect(KEY.filter((k) => k === "C")).toHaveLength(3);
  });

  test("r2 keeps the approved science: displacement equals total floating mass, gold melts highest, copper is the mystery cube", () => {
    const at = (n) => r2.items[n - 1];
    const correct = (n) => at(n).options.find((o) => o.optionId === at(n).correctOptionId).text;
    expect(correct(10)).toBe("800 g");
    expect(at(10).stem).toContain("combined mass of 800 g");
    expect(correct(7)).toBe("Gold");
    expect(correct(9)).toBe("Copper");
    expect(correct(2)).toBe("Malleability");
    expect(correct(8)).toBe("Ductility");
    // No density calculation or volume-measurement practice returns.
    const all = JSON.stringify(r2).toLowerCase();
    for (const banned of ["density", "volume", "graduated cylinder", "cm³", "g/cm"]) expect(all).not.toContain(banned);
    expect(JSON.stringify(r2)).not.toContain("\u2014");
  });

  test("the source records 3 DOK 1 and 7 DOK 2 items in authored order", () => {
    const src = fs.readFileSync(path.join(ROOT, "lesson-sources/lesson_physical-properties.html"), "utf8");
    const levels = [...quizLiteral(src).matchAll(/\/\/ Q(\d+) - .*\(DOK (\d)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(levels).toEqual(DOK.map((d, i) => [i + 1, d]));
    expect(DOK.filter((d) => d === 1)).toHaveLength(3);
    expect(DOK.filter((d) => d === 2)).toHaveLength(7);
  });

  test.each(FILES)("%s displays r2: items, options, keys, and explanations match the payload", (rel) => {
    const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const win = { };
    new Function("window", quizLiteral(html).replace(/^[\s\S]*?(var ppQuizQuestions = \[[\s\S]*?\n\];)[\s\S]*$/, "$1\nwindow.q = ppQuizQuestions;"))(win);
    expect(win.q.map((q) => ({ q: q.q, options: q.options, correct: q.correct, explanation: q.explanation }))).toEqual(
      r2.items.map((it) => ({ q: it.stem, options: it.options.map((o) => o.text), correct: it.options.findIndex((o) => o.optionId === it.correctOptionId), explanation: it.explanation })),
    );
  });

  test("the lesson config and both canonical outputs declare r2 as the canonical revision", () => {
    const config = require(path.join(ROOT, "app/scripts/lessonBuilder/lessons/physical-properties.cjs"));
    expect(config.canonicalAssessmentRevisionId).toBe("assessment_physical-properties__r2");
    for (const rel of ["lesson_physical-properties.html", "app/lessons/lesson_physical-properties.html"]) {
      expect(declaration(fs.readFileSync(path.join(ROOT, rel), "utf8"))).toEqual({ schemaVersion: 1, lessonSlug: "physical-properties", assessmentRevisionId: "assessment_physical-properties__r2" });
    }
    expect(fs.readdirSync(PAYLOADS).filter((f) => f.startsWith("physical-properties."))).toEqual(["physical-properties.r1.json", "physical-properties.r2.json"]);
  });

  test("r1 is preserved byte-for-byte and its rendition still displays the four-choice r1 quiz", () => {
    // The committed r1 payload is immutable; frozen r1 assignments keep routing here.
    const sha = require("crypto").createHash("sha256").update(fs.readFileSync(path.join(PAYLOADS, "physical-properties.r1.json"))).digest("hex");
    expect(sha).toBe("ba874cb718b3b8f480ce67a814f85a37238549bf02eafcb64448a58f88fc9edd");
    expect(r1.revisionOrdinal).toBe(1);
    expect(r1.items).toHaveLength(10);
    const html = fs.readFileSync(path.join(RENDITIONS, "lesson_physical-properties__r1.html"), "utf8");
    expect(declaration(html).assessmentRevisionId).toBe("assessment_physical-properties__r1");
    const quiz = quizLiteral(html);
    for (const item of r1.items) {
      expect(item.options).toHaveLength(4);
      expect(quiz).toContain(JSON.stringify(item.stem).slice(1, -1));
      for (const option of item.options) expect(quiz).toContain(option.text);
    }
    const r2html = fs.readFileSync(path.join(RENDITIONS, "lesson_physical-properties__r2.html"), "utf8");
    expect(declaration(r2html).assessmentRevisionId).toBe("assessment_physical-properties__r2");
  });

  test("the revision path table routes each frozen revision to its own rendition", () => {
    for (const rel of ["app/lessons/assessment-revisions/revision-paths.json", "app/src/assignments/studentList/assessment-revision-paths.json"]) {
      expect(JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")).lessons["physical-properties"]).toEqual({
        "assessment_physical-properties__r1": "/app/lessons/assessment-revisions/lesson_physical-properties__r1.html",
        "assessment_physical-properties__r2": "/app/lessons/assessment-revisions/lesson_physical-properties__r2.html",
      });
    }
  });

  test.each(FILES)("%s results close with the modernized big idea, not the harbor mystery", (rel) => {
    const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const board = html.slice(html.indexOf('id="pp-score"'), html.indexOf("</section>", html.indexOf('id="pp-score"')));
    const box = board.match(/<div class="mystery-loop">([\s\S]*?)<\/div>/)[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    expect(box).toBe("🔍 The Big Idea Different materials have different physical properties. Scientists and engineers test those properties to identify materials and choose the best ones for a job.");
    for (const stale of ["Mystery You Came In With", "steel ship", "steel coin", "harbor"]) expect(board).not.toContain(stale);
    expect(board).toContain('onclick="ppResetQuiz()">Try Again</button>');
  });

  // Runs the real quiz script: three buttons per item, autosave with indexes,
  // local scoring against the r2 key, and Try Again rebuilding a fresh attempt.
  test.each(["lesson_physical-properties.html", "app/lessons/lesson_physical-properties.html"])("%s quiz renders, autosaves, scores, and resets with three choices", (rel) => {
    const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const start = html.indexOf('<main id="main"');
    const dom = new JSDOM(`<body>${html.slice(start, html.indexOf("</main>", start))}</main></body>`, { runScripts: "outside-only", url: "https://app.lyfelabz.test/lesson" });
    const { window: w } = dom;
    w.Element.prototype.scrollIntoView = () => {};
    const saves = [];
    const finals = [];
    w.lyfelabz = { lessonQuiz: { hasAssignmentContext: () => true, autosave: (s) => saves.push([...s]), finalize: (s, o) => { finals.push([[...s], o]); return Promise.resolve({ ok: true }); } } };
    w.eval(quizLiteral(html).replace(/^[\s\S]*?<script>/, ""));
    const d = w.document;
    const cards = d.querySelectorAll("#pp-quiz-questions .quiz-card");
    expect(cards).toHaveLength(10);
    for (const card of cards) {
      expect([...card.querySelectorAll(".quiz-option .option-letter")].map((l) => l.textContent)).toEqual(["A", "B", "C"]);
    }
    // Answer every item correctly except Q10 (choose 300 g).
    const picks = KEY.map((k) => "ABC".indexOf(k));
    picks[9] = 0;
    // Inline onclick attributes do not run under outside-only jsdom; call the page's own handler.
    picks.forEach((oi, qi) => w.ppSelectAnswer(qi, oi));
    expect(saves).toHaveLength(10);
    expect(saves[9]).toEqual(picks);
    d.getElementById("pp-thinking").value = "Physical properties identify materials.";
    w.ppRefreshSubmitState && w.ppRefreshSubmitState();
    w.ppSubmitQuiz();
    expect(d.getElementById("pp-score-num").textContent).toBe("9/10");
    expect(d.getElementById("pp-score").classList.contains("show")).toBe(true);
    expect(d.getElementById("pp-feedback-9").className).toContain("incorrect-fb");
    expect(d.getElementById("pp-q-9-1").classList.contains("revealed-correct")).toBe(true);
    expect(finals).toHaveLength(1);
    expect(finals[0][0]).toEqual(picks);
    // Try Again clears the attempt and rebuilds three-choice items.
    w.ppResetQuiz();
    expect(d.getElementById("pp-score").classList.contains("show")).toBe(false);
    expect(d.querySelectorAll("#pp-quiz-questions .quiz-option.selected")).toHaveLength(0);
    expect(d.querySelectorAll("#pp-quiz-questions .quiz-option")).toHaveLength(30);
    expect(d.getElementById("pp-thinking").disabled).toBe(false);
  });

  // r2 is a teacher-approved revision of the quiz section and quiz script;
  // these pins move only with a deliberate, reviewed assessment change.
  const QUIZ_PINS = {
    "lesson-sources/lesson_physical-properties.html": ["0826507882bc16ea", "c58ea8faa332d9c4"],
    "lesson_physical-properties.html": ["5cc6b8872b311adb", "1fd0bc4933bea9a1"],
    "app/lessons/lesson_physical-properties.html": ["143572cf6364d503", "933b70fc9f16a2a4"],
  };
  test.each(FILES)("%s quiz section and quiz script match the r2 pins", (rel) => {
    const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const h = (x) => require("crypto").createHash("sha256").update(x).digest("hex").slice(0, 16);
    const a = html.indexOf('<section id="quiz"');
    expect([h(html.slice(a, html.indexOf("</section>", a))), h(quizLiteral(html))]).toEqual(QUIZ_PINS[rel]);
  });

  test.each(FILES)("%s keeps the identifiers saved progress and launches depend on", (rel) => {
    const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
    // Only the quiz persists state (autosave/finalize keyed by the activity, not by section ids).
    const persisted = html.match(/localStorage|sessionStorage\.setItem|indexedDB/g) || [];
    expect(persisted).toEqual([]);
    for (const id of ["goals", "vocab", "hook", "properties", "buoyancy", "quiz", "continue", "connections", "pp-quiz-questions", "pp-submit-btn", "pp-score", "pp-thinking"]) {
      expect(html).toContain(`id="${id}"`);
    }
  });
});
