/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * Conducting Experiments curriculum-validity contract.
 *
 * Root cause being guarded: Show Your Thinking told students "You tested the
 * Mentos mystery ... and you measured how high each eruption reached", and
 * the model answer cited "the diet-soda foam reached the highest measured
 * height", but students never tested, measured, or received any soda data.
 * The Hypothesis Builder also revealed the eventual conclusion ("diet soda
 * usually erupts biggest") before any evidence appeared.
 *
 * The fix supplies a labeled dataset inside Show Your Thinking and asks for a
 * claim, evidence, and reasoning from it. These tests pin:
 *   - no false-performance wording in either generated output;
 *   - the supplied-data contract (setup, labeling, three trials per soda);
 *   - the model answer cites only measurements that appear in the dataset;
 *   - Show Your Thinking stays required but never reaches scoring or the
 *     graded selections; it reaches finalize only as the ungraded
 *     `writtenResponse` option (the repository written-response contract).
 */

const { JSDOM, VirtualConsole } = require("jsdom");
const builder = require("../index.cjs");

const SLUG = "conducting-experiments";

function build(target) {
  return builder.buildLesson({ slug: SLUG, target, write: false }).bytes;
}

function textOf(fragment) {
  return fragment.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
}

function between(html, startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  expect(a).toBeGreaterThan(-1);
  const b = html.indexOf(endMarker, a);
  expect(b).toBeGreaterThan(a);
  return html.slice(a, b);
}

// Phrases that claim students performed, measured, or collected something
// they did not, or that hand them the conclusion before the evidence.
const FORBIDDEN = [
  /you tested/i,
  /you measured/i,
  /your fair test/i,
  /experiment is running/i,
  /observations from your/i,
  /fun fact: scientists found diet soda/i,
  /diet soda holds more dissolved gas/i,
  /mentos experiment at home/i,
];

describe.each(["v1", "v2"])("Conducting Experiments supplied evidence (%s)", (target) => {
  let html;
  let think;

  beforeAll(() => {
    html = build(target);
    think = between(html, '<div class="ce-think-box" id="ce-think">', '<!-- ── Instructional Design note');
  });

  test("no false-performance or conclusion-first wording anywhere in the page", () => {
    for (const re of FORBIDDEN) expect(html).not.toMatch(re);
  });

  test("dataset is labeled as supplied and sits before the response box", () => {
    const data = think.indexOf('id="ce-data"');
    const input = think.indexOf('id="ce-thinking"');
    expect(data).toBeGreaterThan(-1);
    expect(input).toBeGreaterThan(data);
    const t = textOf(think.slice(data, input));
    expect(t).toContain("You did not collect these results.");
    for (const label of [
      "Changed (independent variable):",
      "Measured (dependent variable):",
      "Kept the same (controls):",
      "Trials:",
    ]) {
      expect(t).toContain(label);
    }
  });

  test("dataset has three trials for each of three sodas", () => {
    const tbody = between(think, "<tbody>", "</tbody>");
    const rows = tbody.match(/<tr>[\s\S]*?<\/tr>/g);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatch(/<td class="num">\d+, \d+, \d+ cm<\/td>/);
    }
  });

  test("model answer cites only measurements present in the dataset", () => {
    const tbody = between(think, "<tbody>", "</tbody>");
    const supplied = new Set((tbody.match(/<td class="num">[^<]*/g) || []).join(" ").match(/\d+/g));
    const model = textOf(think.slice(think.indexOf('id="ce-think-model"')));
    const cited = model.match(/\b\d+\b/g) || [];
    expect(cited.length).toBeGreaterThan(0);
    for (const n of cited) expect(supplied.has(n)).toBe(true);
    expect(model).toMatch(/Claim:[\s\S]*Evidence:[\s\S]*Reasoning:/);
  });

  test("prompt asks for claim, evidence, reasoning from the supplied results", () => {
    const prompt = textOf(between(think, '<p class="ce-think-prompt">', "</p>"));
    expect(prompt).toContain("Use only the supplied results above.");
    expect(prompt).toMatch(/Claim:[\s\S]*Evidence:[\s\S]*Reasoning:/);
  });
});

describe("Conducting Experiments Show Your Thinking is required but ungraded (v2)", () => {
  const open = [];
  afterEach(() => { while (open.length) open.pop().close(); });

  function mount() {
    const calls = { autosave: [], finalize: [] };
    const vc = new VirtualConsole(); // swallow jsdom "not implemented" noise
    const dom = new JSDOM(build("v2"), {
      runScripts: "dangerously",
      virtualConsole: vc,
      beforeParse(win) {
        win.HTMLCanvasElement.prototype.getContext = () => ({
          clearRect() {}, beginPath() {}, arc() {}, fill() {},
        });
        win.HTMLElement.prototype.scrollIntoView = () => {};
        win.lyfelabz = {
          lessonQuiz: {
            hasAssignmentContext: () => true,
            autosave: (sel) => calls.autosave.push(sel.slice()),
            finalize: (sel, ...rest) => {
              calls.finalize.push({ sel: sel.slice(), rest });
              return Promise.resolve({ ok: true });
            },
          },
        };
      },
    });
    // No rAF without pretendToBeVisual, so the starfield loop never starts.
    open.push(dom.window);
    return { win: dom.window, doc: dom.window.document, calls };
  }

  function answerAll(win, doc, wrongIndex) {
    win.ceQuizQuestions.forEach((q, qi) => {
      const pick = qi === wrongIndex ? (q.correct + 1) % q.options.length : q.correct;
      doc.getElementById(`ce-q-${qi}-${pick}`).click();
    });
  }

  function typeThinking(win, doc, text) {
    const el = doc.getElementById("ce-thinking");
    el.value = text;
    el.dispatchEvent(new win.Event("input"));
  }

  test("submit stays disabled until a written response exists", () => {
    const { win, doc } = mount();
    answerAll(win, doc, 0);
    expect(doc.getElementById("ce-submit-btn").disabled).toBe(true);
    typeThinking(win, doc, "Diet cola erupted highest in all three trials.");
    expect(doc.getElementById("ce-submit-btn").disabled).toBe(false);
  });

  test.each([
    "x",
    "Claim: diet cola. Evidence: 250, 230, 260 cm vs 90, 110, 80 cm. Reasoning: only the soda changed.",
  ])("score and graded selections ignore the response; finalize carries it as writtenResponse (%#)", (thinking) => {
    const { win, doc, calls } = mount();
    answerAll(win, doc, 3);
    typeThinking(win, doc, `  ${thinking}\n`);
    doc.getElementById("ce-submit-btn").click();

    expect(doc.getElementById("ce-score-num").textContent).toBe("9/10");
    expect(calls.finalize).toHaveLength(1);
    expect(calls.finalize[0].rest).toEqual([{ writtenResponse: thinking }]);
    expect(calls.finalize[0].sel).toHaveLength(10);
    expect(calls.finalize[0].sel.every((v) => Number.isInteger(v))).toBe(true);
    for (const sel of calls.autosave) expect(sel.every((v) => v === null || Number.isInteger(v))).toBe(true);
    expect(doc.getElementById("ce-think-model").classList.contains("show")).toBe(true);
  });
});
