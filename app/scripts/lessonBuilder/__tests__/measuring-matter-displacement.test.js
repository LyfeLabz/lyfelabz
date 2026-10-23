/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * Measuring Matter Water Displacement Lab contract.
 *
 * Teaches the volume of irregular solids (final water volume minus initial
 * water volume) before the quiz and the Density at Home extension rely on
 * it. Runs the lab's real script in jsdom against the source and both
 * generated outputs. The built-in Quick Check is ungraded, allows retries,
 * and stores nothing. Its question and four choices are written from the
 * object that is actually underwater, and it waits whenever nothing is.
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
const HEADER = "<!-- ===== WATER DISPLACEMENT LAB (ungraded, nothing stored) ===== -->";

function load(rel) {
  const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const start = html.indexOf('<main id="main"');
  const end = html.indexOf("</main>", start);
  const at = html.indexOf(HEADER);
  expect(at).toBeGreaterThan(-1);
  const script = html.slice(at).match(/<script>([\s\S]*?)<\/script>/)[1];
  const dom = new JSDOM(`<body>${html.slice(start, end)}</main></body>`, { runScripts: "outside-only" });
  dom.window.eval(script);
  return { doc: dom.window.document, script };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent("click", { bubbles: true }));

describe.each(FILES)("Measuring Matter Water Displacement Lab in %s", (rel) => {
  let doc, script;
  const $ = (id) => doc.getElementById(id);
  const obj = (key) => doc.querySelector(`.disp-obj[data-obj="${key}"]`);
  const opts = () => [...doc.querySelectorAll("#disp-check .disp-opt")];
  const shift = () => $("disp-object").style.transform;

  beforeEach(() => {
    ({ doc, script } = load(rel));
  });

  const WAIT = "Choose an object and drop it into the water to answer a question about its volume.";
  // Every object sinks: name in the question, water rise, and the correct choice's position.
  const SINKERS = { marble: ["marble", 2, 3], bolt: ["metal bolt", 5, 0], rock: ["small rock", 9, 1], washer: ["metal washer", 4, 2] };
  const shown = (id) => !$(id).hidden;
  const state = () => ({
    wait: shown("disp-wait") ? $("disp-wait").textContent : null,
    q: shown("disp-q") ? $("disp-q").textContent : null,
    opts: shown("disp-options") ? opts().map((o) => o.textContent) : null,
    fb: $("disp-fb").textContent,
  });
  const drop = (key) => { if (key) click(obj(key)); click($("disp-action")); };

  test("sits in Lab 3 between the Block Builder and one full-width Next Up transition", () => {
    const measure = $("measure");
    const order = [".vol-lab", "#disp-lab", "#disp-check", ".disp-units", ".mlab-next"].map((s) => measure.querySelector(s));
    expect(order.every(Boolean)).toBe(true);
    const pos = (el) => [...measure.querySelectorAll("*")].indexOf(el);
    for (let i = 1; i < order.length; i++) expect(pos(order[i - 1])).toBeLessThan(pos(order[i]));
    expect($("disp-lab").contains($("disp-check"))).toBe(true);
    expect($("disp-lab").contains(measure.querySelector(".disp-units"))).toBe(true);
    // The transition follows the whole lab, outside the two-column pair.
    expect(measure.querySelector(".mlab").contains(measure.querySelector(".mlab-next"))).toBe(false);
    expect(measure.querySelectorAll(".bridge-callout")).toHaveLength(1);
    const labels = [...measure.querySelectorAll(".name-it-label")].map((l) => l.textContent);
    expect(labels).toEqual(["Remember · Volume Units"]);
    // The displacement explanation introduces Lab 3 itself.
    expect($("disp-lab").querySelector(".disp-lab-sub").textContent).toContain(
      "When an object is fully submerged, it displaces a volume of water equal to its own volume."
    );
    expect(measure.textContent).toContain("Object's volume = final water volume minus initial water volume.");
  });

  test("the unit reminder is compact and general, and the old standalone panels are gone", () => {
    const units = $("measure").querySelector(".disp-units");
    expect([...units.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
      "1 mL = 1 cm³",
      "Both measure the same amount of space. Use cm³ to report the volume of a solid.",
    ]);
    expect(units.textContent).not.toMatch(/9 mL|g\/mL|density/);
    expect(units.textContent).not.toMatch(/rock|marble|bolt|cork|water's density/i);
    const next = $("measure").querySelector(".mlab-next");
    expect(next.querySelector(".mlab-next-label").textContent).toBe("Next up · Density");
    expect(next.querySelector("p").textContent).toBe(
      "You've measured mass and volume. Now put them together. Scientists calculate density by dividing an object's mass by its volume. Let's see how density helps explain why some objects float and others sink."
    );
    expect($("measure").textContent).not.toMatch(/two of the three measurements|floating-ship mystery|exactly the same amount of space/);
  });

  test("is accessible: labeled image, pressed object buttons, one polite announcer", () => {
    const svg = $("disp-svg");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toMatch(/water level rises by the volume/);
    const group = doc.querySelector(".disp-objects");
    expect(group.getAttribute("role")).toBe("group");
    expect($(group.getAttribute("aria-labelledby")).textContent).toBe("Choose an object");
    const buttons = [...doc.querySelectorAll(".disp-obj")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Marble", "Metal bolt", "Small rock", "Metal washer"]);
    for (const b of [...buttons, $("disp-action"), ...opts()]) expect(b.getAttribute("type")).toBe("button");
    expect(buttons.filter((b) => b.getAttribute("aria-pressed") === "true")).toEqual([obj("rock")]);
    const live = [...$("disp-lab").querySelectorAll("[aria-live]")].map((el) => el.id);
    expect(live).toEqual(["disp-announce", "disp-fb"]);
    expect($("disp-options").getAttribute("aria-labelledby")).toBe("disp-q");
  });

  test("starts at 30 mL with the rock out and the check waiting", () => {
    expect($("disp-initial").textContent).toBe("30 mL");
    expect($("disp-final").textContent).toBe("30 mL");
    expect($("disp-water").getAttribute("y")).toBe("120");
    expect($("disp-math").textContent).toBe("");
    expect($("disp-action").textContent).toBe("Lower it in");
    expect(shift()).toBe("translateY(28px)");
    expect($("disp-check").hidden).toBe(false);
    expect(state()).toEqual({ wait: WAIT, q: null, opts: null, fb: "" });
    expect(opts()).toHaveLength(4);
    expect(opts().every((o) => o.textContent === "")).toBe(true);
    expect($("disp-scale").querySelectorAll("line")).toHaveLength(51);
    expect($("disp-scale").textContent).toContain("50 mL");
  });

  test("lowering the rock raises the water 9 mL, announces it, and asks about the rock", async () => {
    drop();
    expect($("disp-final").textContent).toBe("39 mL");
    expect($("disp-water").getAttribute("y")).toBe(String(240 - 39 * 4));
    expect($("disp-water").getAttribute("height")).toBe(String(39 * 4));
    expect(shift()).toBe("translateY(239px)");
    expect($("disp-action").textContent).toBe("Take it out");
    expect(state()).toEqual({
      wait: null,
      q: "The water rose from 30 mL to 39 mL. What is the small rock's volume?",
      opts: ["39 cm³", "9 cm³", "69 cm³", "19 cm³"],
      fb: "",
    });
    expect($("disp-math").textContent).toBe("");
    await wait(150);
    expect($("disp-announce").textContent).toBe(
      "The water rose from 30 mL to 39 mL. A question about the small rock's volume is ready."
    );
  });

  test.each(Object.entries(SINKERS))("%s: question, four choices, and feedback all come from its own measurement", (key, [name, rise, slot]) => {
    drop(key === "rock" ? null : key);
    const final = 30 + rise;
    expect($("disp-final").textContent).toBe(`${final} mL`);
    expect($("disp-q").textContent).toBe(`The water rose from 30 mL to ${final} mL. What is the ${name}'s volume?`);
    const values = opts().map((o) => o.textContent);
    expect(values).toHaveLength(4);
    expect(new Set(values).size).toBe(4);
    for (const v of values) {
      expect(v).toMatch(/^\d+ cm³$/);
      expect(parseInt(v, 10)).toBeGreaterThan(0);
    }
    // Misconceptions: the final reading, the two readings added, a tens-place slip.
    expect(values.slice().sort()).toEqual([`${rise} cm³`, `${final} cm³`, `${30 + final} cm³`, `${rise + 10} cm³`].sort());
    expect(values.indexOf(`${rise} cm³`)).toBe(slot);
    // No choice looks answered before the student picks one.
    for (const o of opts()) {
      expect(o.className).toBe("disp-opt check-opt");
      expect(o.hasAttribute("aria-disabled")).toBe(false);
      expect(o.hasAttribute("data-ok")).toBe(false);
      expect(o.hasAttribute("data-fb")).toBe(false);
    }
    // Every wrong choice explains without naming the answer, and allows retry.
    for (const [i, o] of opts().entries()) {
      if (i === slot) continue;
      click(o);
      expect(o.classList.contains("wrong")).toBe(true);
      expect($("disp-fb").className).toBe("tm-fb visible no");
      expect($("disp-fb").textContent).toMatch(/^Not quite\. .*Subtract the initial water volume from the final water volume, then try again\.$/);
      expect($("disp-fb").textContent).not.toContain(`= ${rise} mL`);
      expect($("disp-fb").textContent).not.toContain(`${rise} cm³`);
      expect($("disp-math").textContent).toBe("");
    }
    click(opts()[slot]);
    expect(opts()[slot].classList.contains("right")).toBe(true);
    expect(opts().every((o) => o.getAttribute("aria-disabled") === "true")).toBe(true);
    expect($("disp-fb").className).toBe("tm-fb visible ok");
    expect($("disp-fb").textContent).toBe(
      `Correct! ${final} mL − 30 mL = ${rise} mL. Since 1 mL = 1 cm³, the ${name}'s volume is ${rise} cm³.`
    );
    const label = name[0].toUpperCase() + name.slice(1);
    expect($("disp-math").textContent).toBe(`${label}'s volume = ${final} mL minus 30 mL = ${rise} cm³`);
  });

  test("specific misconception feedback for the final reading and the sum", () => {
    drop();
    const [finalReading, , sum, slip] = opts();
    click(finalReading);
    expect($("disp-fb").textContent).toBe(
      "Not quite. 39 mL is the final water level, not how much it rose. Subtract the initial water volume from the final water volume, then try again."
    );
    click(sum);
    expect($("disp-fb").textContent).toContain("Adding the two readings counts the water twice.");
    click(slip);
    expect($("disp-fb").textContent).toContain("Check the tens place in your subtraction.");
  });

  test("taking the object out returns the water and resets the check to waiting", async () => {
    drop();
    click(opts()[1]);
    click($("disp-action"));
    expect($("disp-final").textContent).toBe("30 mL");
    expect($("disp-math").textContent).toBe("");
    expect(state()).toEqual({ wait: WAIT, q: null, opts: null, fb: "" });
    expect(opts().some((o) => o.classList.contains("right") || o.classList.contains("wrong") || o.hasAttribute("aria-disabled"))).toBe(false);
    // Dropping the same object in again asks fresh, with nothing pre-answered.
    click($("disp-action"));
    expect($("disp-fb").textContent).toBe("");
    expect($("disp-math").textContent).toBe("");
    expect(opts().every((o) => !o.hasAttribute("aria-disabled"))).toBe(true);
    await wait(150);
    expect($("disp-announce").textContent).toMatch(/^The water rose from 30 mL to 39 mL\./);
  });

  test("choosing another object takes the current one out and waits until the new one is measured", () => {
    drop();
    click(opts()[0]);
    click(obj("bolt"));
    expect(obj("bolt").getAttribute("aria-pressed")).toBe("true");
    expect(obj("rock").getAttribute("aria-pressed")).toBe("false");
    expect($("disp-final").textContent).toBe("30 mL");
    expect($("disp-action").textContent).toBe("Lower it in");
    expect(shift()).toBe("translateY(28px)");
    expect(state()).toEqual({ wait: WAIT, q: null, opts: null, fb: "" });
    // Clicking where the rock's correct choice was does nothing while waiting.
    click(opts()[1]);
    expect($("disp-fb").textContent).toBe("");
    expect(opts()[1].classList.contains("right")).toBe(false);
    click($("disp-action"));
    expect($("disp-q").textContent).toContain("metal bolt's volume");
    // The rock's correct position (B, 9 mL) is now a wrong answer for the bolt.
    click(opts()[1]);
    expect($("disp-fb").className).toBe("tm-fb visible no");
    click(opts()[0]);
    expect($("disp-fb").textContent).toBe("Correct! 35 mL − 30 mL = 5 mL. Since 1 mL = 1 cm³, the metal bolt's volume is 5 cm³.");
  });

  test("rapid object changes never leave a mismatched question, reading, or announcement", async () => {
    for (const key of ["marble", "bolt", "rock", "washer", "marble", "bolt"]) {
      click(obj(key));
      click($("disp-action"));
    }
    click(obj("rock"));
    click(obj("marble"));
    expect(state()).toEqual({ wait: WAIT, q: null, opts: null, fb: "" });
    expect($("disp-final").textContent).toBe("30 mL");
    click($("disp-action"));
    expect($("disp-final").textContent).toBe("32 mL");
    expect($("disp-q").textContent).toBe("The water rose from 30 mL to 32 mL. What is the marble's volume?");
    expect(opts().map((o) => o.textContent)).toEqual(["32 cm³", "62 cm³", "12 cm³", "2 cm³"]);
    await wait(150);
    expect($("disp-announce").textContent).toContain("marble");
    // A pending announcement is dropped when the student switches objects.
    click(obj("bolt"));
    click($("disp-action"));
    click(obj("rock"));
    await wait(150);
    expect($("disp-announce").textContent).toBe("");
  });

  test("the metal washer sinks fully under and reads 30 mL to 34 mL", async () => {
    drop("washer");
    expect($("disp-initial").textContent).toBe("30 mL");
    expect($("disp-final").textContent).toBe("34 mL");
    expect(shift()).toBe("translateY(239px)");
    expect($("disp-q").textContent).toBe("The water rose from 30 mL to 34 mL. What is the metal washer's volume?");
    expect(opts().map((o) => o.textContent)).toEqual(["34 cm³", "64 cm³", "4 cm³", "14 cm³"]);
    await wait(150);
    expect($("disp-announce").textContent).toBe(
      "The water rose from 30 mL to 34 mL. A question about the metal washer's volume is ready."
    );
    click(opts()[2]);
    expect($("disp-fb").textContent).toBe("Correct! 34 mL − 30 mL = 4 mL. Since 1 mL = 1 cm³, the metal washer's volume is 4 cm³.");
    expect($("disp-math").textContent).toBe("Metal washer's volume = 34 mL minus 30 mL = 4 cm³");
  });

  test("no object has a floating or partial-displacement exception", () => {
    expect(script).not.toMatch(/cork|float|sinks/i);
  });

  test("no scoring, persistence, or grading", () => {
    expect(script).not.toMatch(/score|grade|submit|assessment/i);
  });

  test("collects and sends nothing", () => {
    expect(script).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|google\.script/);
  });
});
