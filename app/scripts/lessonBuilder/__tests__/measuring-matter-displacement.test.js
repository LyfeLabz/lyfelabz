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
 * appears once (on the first object that sinks), and stores nothing.
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
const CORK_NOTE = "The cork floats, so only part of it is underwater. The water rose 2 mL, but that is not the cork's whole volume. To measure a floating object, you'd have to push it completely under.";

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

  test("sits in Three Measurements between the Block Builder and the density bridge", () => {
    const measure = $("measure");
    const order = [".vol-lab", "#disp-lab", ".bridge-callout.orange"].map((s) => measure.querySelector(s));
    expect(order.every(Boolean)).toBe(true);
    const pos = (el) => [...measure.querySelectorAll("*")].indexOf(el);
    expect(pos(order[0])).toBeLessThan(pos(order[1]));
    expect(pos(order[1])).toBeLessThan(pos(order[2]));
    const labels = [...measure.querySelectorAll(".name-it-label")].map((l) => l.textContent);
    expect(labels).toEqual(["Key idea: Water Displacement", "Key idea: Same Space, Two Units"]);
    expect(measure.textContent).toContain("Object's volume = final water volume minus initial water volume.");
    expect(measure.textContent).toContain("1 mL and 1 cm³ are exactly the same amount of space.");
  });

  test("is accessible: labeled image, pressed object buttons, one polite announcer", () => {
    const svg = $("disp-svg");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toMatch(/water level rises by the volume/);
    const group = doc.querySelector(".disp-objects");
    expect(group.getAttribute("role")).toBe("group");
    expect($(group.getAttribute("aria-labelledby")).textContent).toBe("Choose an object");
    const buttons = [...doc.querySelectorAll(".disp-obj")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Marble", "Metal bolt", "Small rock", "Cork"]);
    for (const b of [...buttons, $("disp-action"), ...opts()]) expect(b.getAttribute("type")).toBe("button");
    expect(buttons.filter((b) => b.getAttribute("aria-pressed") === "true")).toEqual([obj("rock")]);
    const live = [...$("disp-lab").querySelectorAll("[aria-live]")].map((el) => el.id);
    expect(live).toEqual(["disp-announce", "disp-fb"]);
  });

  test("starts at 30 mL with the rock out and the check hidden", () => {
    expect($("disp-initial").textContent).toBe("30 mL");
    expect($("disp-final").textContent).toBe("30 mL");
    expect($("disp-water").getAttribute("y")).toBe("120");
    expect($("disp-math").textContent).toBe("");
    expect($("disp-action").textContent).toBe("Lower it in");
    expect(shift()).toBe("translateY(28px)");
    expect($("disp-check").hidden).toBe(true);
    expect($("disp-scale").querySelectorAll("line")).toHaveLength(51);
    expect($("disp-scale").textContent).toContain("50 mL");
  });

  test("lowering the rock raises the water 9 mL, announces it, and asks the check", async () => {
    click($("disp-action"));
    expect($("disp-final").textContent).toBe("39 mL");
    expect($("disp-water").getAttribute("y")).toBe(String(240 - 39 * 4));
    expect($("disp-water").getAttribute("height")).toBe(String(39 * 4));
    expect(shift()).toBe("translateY(239px)");
    expect($("disp-action").textContent).toBe("Take it out");
    expect($("disp-check").hidden).toBe(false);
    expect($("disp-q").textContent).toBe("The water rose from 30 mL to 39 mL. What is the rock's volume?");
    expect(opts().map((o) => o.textContent)).toEqual(["39 mL", "9 mL", "69 mL"]);
    expect($("disp-math").textContent).toBe("");
    await wait(150);
    expect($("disp-announce").textContent).toBe("The water rose from 30 mL to 39 mL.");
  });

  test("wrong answers explain the slip and lock; the right answer reveals the subtraction", () => {
    click($("disp-action"));
    const [finalReading, right, sum] = opts();
    click(finalReading);
    expect(finalReading.classList.contains("wrong")).toBe(true);
    expect(finalReading.getAttribute("aria-disabled")).toBe("true");
    expect($("disp-fb").className).toBe("tm-fb visible no");
    expect($("disp-fb").textContent).toContain("39 mL is the final water level");
    click(sum);
    expect($("disp-fb").textContent).toContain("Adding the two readings counts the water twice");
    expect($("disp-math").textContent).toBe("");
    click(right);
    expect(right.classList.contains("right")).toBe(true);
    expect(opts().every((o) => o.getAttribute("aria-disabled") === "true")).toBe(true);
    expect($("disp-fb").className).toBe("tm-fb visible ok");
    expect($("disp-fb").textContent).toContain("39 mL minus 30 mL = 9 mL");
    expect($("disp-math").textContent).toBe("Rock's volume = 39 mL minus 30 mL = 9 mL");
  });

  test("the check appears once; later objects show their subtraction after it is passed", async () => {
    click($("disp-action"));
    click(opts()[1]);
    click($("disp-action"));
    await wait(150);
    expect($("disp-announce").textContent).toBe("The rock is out. The water is back at 30 mL.");
    expect($("disp-final").textContent).toBe("30 mL");
    click(obj("bolt"));
    click($("disp-action"));
    expect($("disp-q").textContent).toContain("rock's volume");
    expect($("disp-math").textContent).toBe("Metal bolt's volume = 35 mL minus 30 mL = 5 mL");
    click(obj("marble"));
    click($("disp-action"));
    expect($("disp-math").textContent).toBe("Marble's volume = 32 mL minus 30 mL = 2 mL");
  });

  test("the cork floats at the surface, explains why, and does not trigger the check", async () => {
    click(obj("cork"));
    click($("disp-action"));
    expect($("disp-final").textContent).toBe("32 mL");
    expect(shift()).toBe(`translateY(${240 - 32 * 4 + 7}px)`);
    expect($("disp-math").textContent).toBe(CORK_NOTE);
    expect($("disp-check").hidden).toBe(true);
    await wait(150);
    expect($("disp-announce").textContent).toBe(
      "The cork floats. The water rose from 30 mL to 32 mL, but only part of the cork is underwater."
    );
    click(obj("marble"));
    click($("disp-action"));
    expect($("disp-check").hidden).toBe(false);
    expect($("disp-q").textContent).toBe("The water rose from 30 mL to 32 mL. What is the marble's volume?");
    expect(opts().map((o) => o.textContent)).toEqual(["32 mL", "2 mL", "62 mL"]);
  });

  test("choosing another object while one is lowered takes it out first", () => {
    click($("disp-action"));
    click(obj("bolt"));
    expect(obj("bolt").getAttribute("aria-pressed")).toBe("true");
    expect(obj("rock").getAttribute("aria-pressed")).toBe("false");
    expect($("disp-final").textContent).toBe("30 mL");
    expect($("disp-action").textContent).toBe("Lower it in");
    expect(shift()).toBe("translateY(28px)");
  });

  test("collects and sends nothing", () => {
    expect(script).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|google\.script/);
  });
});
