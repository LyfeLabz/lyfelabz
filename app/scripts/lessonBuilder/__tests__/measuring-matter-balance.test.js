/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * Measuring Matter Measurement Lab and triple beam balance contract.
 *
 * Lab 1 is an interactive triple beam balance: students place an object,
 * move three riders (100 g, 10 g, and 0.1 g steps) until the pointer reaches
 * the center mark, then add the rider readings themselves. The object's mass
 * is never shown before the balance is balanced and the student's sum is
 * checked. Labs 2 and 3 are the existing volume simulations, now side by
 * side. Everything is ungraded and stores nothing. Runs the real script in
 * jsdom against the source and both generated outputs.
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
const HEADER = "<!-- ===== TRIPLE BEAM BALANCE (ungraded, nothing stored) ===== -->";

function load(rel) {
  const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const start = html.indexOf('<main id="main"');
  const end = html.indexOf("</main>", start);
  const at = html.indexOf(HEADER);
  expect(at).toBeGreaterThan(-1);
  const script = html.slice(at).match(/<script>([\s\S]*?)<\/script>/)[1];
  const dom = new JSDOM(`<body>${html.slice(start, end)}</main></body>`, { runScripts: "outside-only" });
  dom.window.eval(script);
  return { doc: dom.window.document, win: dom.window, script };
}

function objectTable(script) {
  const out = {};
  for (const m of script.matchAll(/(\w+):\s*\{ name: '([^']+)',\s*icon: '[^']+', tenths: (\d+) \}/g)) {
    out[m[1]] = { name: m[2], tenths: Number(m[3]) };
  }
  return out;
}

describe.each(FILES)("Measuring Matter Measurement Lab in %s", (rel) => {
  let doc, win, script;
  const $ = (id) => doc.getElementById(id);
  const click = (el) => el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  const set = (k, v) => {
    const el = $("tbb-" + k);
    el.value = String(v);
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
  };
  const choose = (key) => click(doc.querySelector(`.tbb-obj[data-obj="${key}"]`));
  const place = () => click($("tbb-place"));
  const check = (answer) => {
    $("tbb-input").value = answer;
    click($("tbb-check"));
    return { cls: $("tbb-fb").className, text: $("tbb-fb").textContent };
  };
  const pointerY = () => parseFloat($("tbb-pointer").style.transform.match(/translateY\((-?[\d.]+)px\)/)[1]);

  beforeEach(() => {
    ({ doc, win, script } = load(rel));
  });

  test("one lab section with three labeled activities, the volume labs side by side", () => {
    const lab = doc.querySelector("#measure .mlab");
    expect(lab.querySelector(".section-label").textContent).toBe("Explore · Interactive Lab");
    expect(lab.querySelector("h3").textContent).toBe("The Measurement Lab: Choose Your Tool");
    expect(lab.querySelector(".mlab-intro").textContent).toBe(
      "Scientists use different tools to measure different properties of matter. In this lab, you'll practice measuring mass and volume using three different methods."
    );
    const cards = [$("tbb-lab"), lab.querySelector(".vol-lab"), $("disp-lab")];
    expect(cards.map((c) => c.querySelector(".mlab-tag").textContent)).toEqual(["Lab 1", "Lab 2", "Lab 3"]);
    expect(cards.map((c) => c.querySelector("h4.mlab-title").textContent)).toEqual([
      "Measure Mass", "Measure Volume with a Ruler", "Measure Volume with Water Displacement",
    ]);
    expect([...lab.querySelector(".mlab-pair").children]).toEqual(cards.slice(1));
    expect(cards[1].querySelector(".vol-lab-sub").textContent).toContain("Volume = length × width × height");
    expect(cards[2].querySelector(".disp-lab-sub").textContent).toContain(
      "Object's volume = final water volume minus initial water volume."
    );
    expect(doc.querySelector("#measure").textContent).not.toMatch(/The ruler trick|What about a rock\?/);
  });

  test("riders use the real beam increments and are labeled, keyboard-operable controls", () => {
    const spec = { h: ["0", "500", "100"], t: ["0", "100", "10"], o: ["0", "10", "0.1"] };
    for (const [k, [min, max, step]] of Object.entries(spec)) {
      const r = $("tbb-" + k);
      expect(r.type).toBe("range");
      expect([r.min, r.max, r.step]).toEqual([min, max, step]);
      expect(doc.querySelector(`label[for="tbb-${k}"]`)).not.toBeNull();
      expect(r.getAttribute("aria-valuetext")).toBe(k === "o" ? "0.0 grams" : "0 grams");
    }
    for (const b of $("tbb-lab").querySelectorAll("button")) expect(b.getAttribute("type")).toBe("button");
    for (const b of $("tbb-lab").querySelectorAll(".tbb-nudge")) expect(b.getAttribute("aria-label")).toMatch(/^Move the .+ rider (back|forward) one step$/);
    expect(doc.querySelector('label[for="tbb-input"]').textContent).toBe("Your measurement (grams)");
    expect($("tbb-status").getAttribute("aria-live")).toBe("polite");
    expect($("tbb-fb").getAttribute("aria-live")).toBe("polite");
    expect($("tbb-svg").getAttribute("role")).toBe("img");
  });

  test("objects are within the 610 g capacity, exact to 0.1 g, and cover each difficulty", () => {
    const objects = objectTable(script);
    expect(Object.keys(objects)).toEqual(["rock", "apple", "baseball", "pencil", "mug"]);
    const t = Object.values(objects).map((o) => o.tenths);
    for (const v of t) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(6100);
    }
    expect(t.some((v) => v % 1000 === 0)).toBe(true);                 // one beam, whole number
    expect(t.some((v) => v % 10 === 0 && v % 1000 !== 0 && v > 1000)).toBe(true); // several beams
    expect(t.some((v) => v % 10 !== 0)).toBe(true);                   // decimal
    expect(t.some((v) => v < 100)).toBe(true);                        // ones beam only
    for (const b of doc.querySelectorAll(".tbb-obj")) expect(b.textContent).not.toMatch(/\d/);
  });

  test("the pointer rises when the object outweighs the riders, falls when it does not, and centers only when equal", () => {
    expect(pointerY()).toBe(0);
    expect($("tbb-status").textContent).toMatch(/^The pan is empty/);
    place(); // rock
    expect(pointerY()).toBeLessThan(0);
    expect($("tbb-status").textContent).toMatch(/above the center mark/);
    set("h", 500);
    expect(pointerY()).toBeGreaterThan(0);
    expect($("tbb-status").textContent).toMatch(/below the center mark/);
    set("h", 300);
    expect(pointerY()).toBe(0);
    expect($("tbb-status").textContent).toBe("The pointer is at the center mark. The balance is balanced. Add the three rider readings.");
    expect($("tbb-status").textContent).not.toMatch(/\d/);
  });

  test("the pointer response grows with the difference", () => {
    choose("apple");
    place();
    set("h", 100);
    set("t", 80);
    const near = Math.abs(pointerY());
    set("t", 60);
    const far = Math.abs(pointerY());
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
  });

  test("the ones beam resolves 0.1 g", () => {
    choose("pencil");
    place();
    set("o", 6.3);
    expect($("tbb-status").textContent).toMatch(/above/);
    expect($("tbb-o-val").textContent).toBe("6.3 g");
    set("o", 6.4);
    expect(pointerY()).toBe(0);
    set("o", 6.5);
    expect($("tbb-status").textContent).toMatch(/below/);
  });

  test("feedback separates not balanced, balanced with a wrong sum, and correct", () => {
    choose("baseball");
    expect(check("145.3")).toEqual({ cls: "tbb-fb no", text: "Place an object on the pan first, then balance it." });
    place();
    expect(check("")).toEqual({ cls: "tbb-fb no", text: "Type the mass you read from the beams, in grams." });
    const unbalanced = check("145.3");
    expect(unbalanced.text).toMatch(/^Not balanced yet\./);
    expect(unbalanced.text).not.toMatch(/145/);
    set("h", 100); set("t", 40); set("o", 5.3);
    const wrongSum = check("140.53");
    expect(wrongSum.cls).toBe("tbb-fb no");
    expect(wrongSum.text).toMatch(/^The balance is balanced, so your riders are set correctly\. Check your addition/);
    expect(wrongSum.text).not.toMatch(/145/);
    expect(check("145.3")).toEqual({ cls: "tbb-fb ok", text: "Correct! The riders add up to 145.3 g, so the baseball has a mass of 145.3 g." });
    expect(check("145.30").cls).toBe("tbb-fb ok");
  });

  test("moving a rider clears an earlier result so no stale success remains", () => {
    place();
    set("h", 300);
    expect(check("300").cls).toBe("tbb-fb ok");
    set("t", 10);
    expect($("tbb-fb").textContent).toBe("");
  });

  test("switching objects resets the pan, riders, answer, and feedback", () => {
    place();
    set("h", 300);
    check("300");
    choose("mug");
    expect(doc.querySelector('.tbb-obj[aria-pressed="true"]').dataset.obj).toBe("mug");
    expect(["h", "t", "o"].map((k) => $("tbb-" + k).value)).toEqual(["0", "0", "0"]);
    expect($("tbb-input").value).toBe("");
    expect($("tbb-fb").textContent).toBe("");
    expect($("tbb-place").textContent).toBe("Place on pan");
    expect($("tbb-object").innerHTML).toBe("");
  });

  test("reset returns the riders to zero and clears the attempt", () => {
    choose("mug");
    place();
    set("h", 300); set("t", 50); set("o", 2.8);
    expect(check("352.8").cls).toBe("tbb-fb ok");
    click($("tbb-reset"));
    expect(["h", "t", "o"].map((k) => $("tbb-" + k + "-val").textContent)).toEqual(["0 g", "0 g", "0.0 g"]);
    expect($("tbb-input").value).toBe("");
    expect($("tbb-fb").textContent).toBe("");
    expect($("tbb-place").textContent).toBe("Remove from pan");
  });

  test("step buttons move one notch and stay within each beam", () => {
    const nudge = (k, dir) => click(doc.querySelector(`.tbb-nudge[data-rider="${k}"][data-dir="${dir}"]`));
    nudge("t", -1);
    expect($("tbb-t").value).toBe("0");
    nudge("t", 1); nudge("t", 1);
    expect($("tbb-t-val").textContent).toBe("20 g");
    nudge("o", 1);
    expect($("tbb-o-val").textContent).toBe("0.1 g");
    set("o", 10);
    nudge("o", 1);
    expect($("tbb-o-val").textContent).toBe("10.0 g");
    set("h", 500);
    nudge("h", 1);
    expect($("tbb-h-val").textContent).toBe("500 g");
  });

  test("collects and sends nothing", () => {
    expect(script).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|google\.script/);
  });
});
