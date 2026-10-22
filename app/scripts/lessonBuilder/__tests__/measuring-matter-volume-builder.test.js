/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * Measuring Matter Volume Block Builder accuracy contract.
 *
 * Regression for the Length slider using max="8" while Width and Height used
 * max="6", which put equal values (2, 2, 2) at different handle positions.
 * Runs the builder's real script in jsdom against both generated outputs and
 * checks slider mappings, the volume readout, and the rendered geometry.
 * True on-screen handle alignment is verified in the browser.
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
const IDS = ["vol-l", "vol-w", "vol-h"];

function load(rel) {
  const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const start = html.indexOf('<div class="vol-lab"');
  const end = html.indexOf('<div class="bridge-callout orange mlab-next">', start);
  expect(end).toBeGreaterThan(start);
  const markup = html.slice(start, end);
  const scriptStart = html.indexOf("<!-- ===== VOLUME BLOCK BUILDER ===== -->");
  const script = html
    .slice(scriptStart)
    .match(/<script>([\s\S]*?)<\/script>/)[1];
  const dom = new JSDOM(`<body>${markup}</body>`, { runScripts: "outside-only" });
  dom.window.eval(script);
  return dom.window;
}

function set(win, id, value) {
  const el = win.document.getElementById(id);
  el.value = String(value);
  el.dispatchEvent(new win.Event("input"));
}

function pts(poly) {
  return poly
    .getAttribute("points")
    .split(" ")
    .map((p) => p.split(",").map(Number));
}

function geometry(win) {
  const [top, side, front] = win.document.querySelectorAll("#vol-block polygon");
  const f = pts(front);
  const s = pts(side);
  return {
    fw: f[1][0] - f[0][0],
    fh: f[0][1] - f[3][1],
    dx: s[1][0] - s[0][0],
    dy: s[0][1] - s[1][1],
    all: [...pts(top), ...s, ...f],
  };
}

function math(win) {
  return win.document.getElementById("vol-math").textContent;
}

describe.each(FILES)("Volume Block Builder in %s", (rel) => {
  let win;
  beforeEach(() => {
    win = load(rel);
  });

  test("block SVG is a labeled image with no live announcements", () => {
    const svg = win.document.getElementById("vol-svg");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toMatch(/volume/);
    expect(svg.closest("[aria-live]")).toBeNull();
    expect(win.document.querySelector(".vol-lab [aria-live]")).toBeNull();
  });

  test("all sliders share one range and step", () => {
    for (const id of IDS) {
      const el = win.document.getElementById(id);
      expect([el.min, el.max, el.step]).toEqual(["1", "6", "1"]);
    }
  });

  test("initial state is 2 x 2 x 2 = 8 cm³ and draws a cube", () => {
    for (const id of IDS) expect(win.document.getElementById(id).value).toBe("2");
    expect(math(win)).toBe("V = 2 × 2 × 2 = 8 cm³");
    const g = geometry(win);
    expect(g.fw).toBe(g.fh);
  });

  test.each([1, 4, 6])("equal dimensions of %i cm draw a cube", (n) => {
    IDS.forEach((id) => set(win, id, n));
    const g = geometry(win);
    expect(g.fw).toBe(g.fh);
    expect(math(win)).toBe(`V = ${n} × ${n} × ${n} = ${n * n * n} cm³`);
  });

  test("unequal dimensions draw a proportional prism", () => {
    set(win, "vol-l", 6);
    set(win, "vol-w", 3);
    set(win, "vol-h", 2);
    const g = geometry(win);
    expect(g.fw / g.fh).toBe(3);
    expect(math(win)).toBe("V = 6 × 3 × 2 = 36 cm³");
  });

  test.each([
    ["vol-l", "fw", "vol-l-val"],
    ["vol-w", "dx", "vol-w-val"],
    ["vol-h", "fh", "vol-h-val"],
  ])("changing %s updates geometry, label, and volume", (id, dim, label) => {
    const before = geometry(win)[dim];
    set(win, id, 5);
    expect(geometry(win)[dim]).toBe((before / 2) * 5);
    expect(win.document.getElementById(label).textContent).toBe("5 cm");
    expect(math(win)).toBe("V = " + IDS.map((i) => (i === id ? 5 : 2)).join(" × ") + ` = ${5 * 4} cm³`);
  });

  test("largest block stays inside the viewBox", () => {
    IDS.forEach((id) => set(win, id, 6));
    const [, , w, h] = win.document
      .getElementById("vol-svg")
      .getAttribute("viewBox")
      .split(" ")
      .map(Number);
    for (const [x, y] of geometry(win).all) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(w);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(h);
    }
  });
});
