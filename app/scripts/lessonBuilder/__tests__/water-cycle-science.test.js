/** @jest-environment node */
/* eslint-disable */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { JSDOM, VirtualConsole } = require("jsdom");
const builder = require("../index.cjs");
const fidelity = require("../assessmentFidelity.cjs");
const quality = require("../assessmentQuality.cjs");
const root = path.resolve(__dirname, "../../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const source = read("lesson-sources/lesson_water-cycle.html");
const payload = (n) => JSON.parse(read(`platform/functions/src/scripts/assessments/water-cycle.r${n}.json`));
const forbidden = /never (?:created or destroyed|used up|runs out)|no new water is being made|inside (?:of )?plant cells|too heavy for gravity to hold up|Sun pushes water up|two opposing forces|gravity takes over|approximately closed|atmospheric escape|extraterrestrial/i;

describe("Water Cycle scientific revision integrity", () => {
  test("canonical and both generated targets pass equivalence, with two faithful renditions", () => {
    const result = builder.verifyLesson({ slug: "water-cycle" });
    expect(result.ok).toBe(true);
    expect(result.renditions).toHaveLength(2);
    for (const target of ["v1", "v2"]) {
      const built = builder.buildLesson({ slug: "water-cycle", target, write: false });
      expect(fs.readFileSync(built.outputPath, "utf8")).toBe(built.bytes);
    }
  });
  test("historical r1 bytes remain immutable", () => {
    const bytes = read("platform/functions/src/scripts/assessments/water-cycle.r1.json");
    expect(crypto.createHash("sha256").update(bytes).digest("hex"))
      .toBe("26d587b3f8906b24a652c7c9e870da901bdeed4d8ec83dc0ce77019ef7d79618");
  });
  test("canonical quiz matches r2; both revision renditions match their own payload", () => {
    expect(fidelity.checkFidelity("water-cycle", payload(2), fidelity.extractCanonicalQuiz(source, "water-cycle"))).toEqual([]);
    for (const n of [1, 2]) {
      const html = read(`app/lessons/assessment-revisions/lesson_water-cycle__r${n}.html`);
      expect(fidelity.checkFidelity("water-cycle", payload(n), fidelity.extractCanonicalQuiz(html, "water-cycle"))).toEqual([]);
    }
  });
  test("both generated mapping copies route r1 and r2 to their respective renditions", () => {
    const a = read("app/lessons/assessment-revisions/revision-paths.json");
    expect(a).toBe(read("app/src/assignments/studentList/assessment-revision-paths.json"));
    expect(JSON.parse(a)).toEqual(builder.buildPathTable());
    for (const n of [1, 2]) expect(a).toContain(`"assessment_water-cycle__r${n}": "/app/lessons/assessment-revisions/lesson_water-cycle__r${n}.html"`);
  });
  test("r2 meets answer-position targets without altering sound answer concepts", () => {
    const result = quality.evaluatePayload(payload(2));
    expect(result.hard).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.spread).toBeLessThanOrEqual(1);
    for (const index of [0, 5, 6]) {
      const oldItem = payload(1).items[index], newItem = payload(2).items[index];
      expect(newItem.stem).toBe(oldItem.stem);
      expect(newItem.options.find((o) => o.optionId === newItem.correctOptionId).text)
        .toBe(oldItem.options.find((o) => o.optionId === oldItem.correctOptionId).text);
    }
  });
  test("source and catalog preserve Grade 7 and the approved closed-system model", () => {
    expect(source).toContain("7.MS-ESS2-4");
    expect(source).not.toMatch(forbidden);
    const manifest = JSON.parse(read("app/src/curriculum/curriculum.manifest.json"));
    const units = manifest.topicGroups.flatMap((g) => g.units);
    const unit = units.find((u) => u.slug === "water-cycle");
    expect(unit.grade).toBe("7");
    expect(unit.description).toContain("closed system for water");
  });
});

describe.each(["v1", "v2"])("Water Cycle teaching and interactions (%s)", (target) => {
  let win, doc, calls, timers, errors, educatorSession = false;
  beforeEach(() => {
    calls = { autosave: [], finalize: [] }; timers = []; errors = [];
    const vc = new VirtualConsole();
    vc.on("jsdomError", (e) => errors.push(e.message));
    const dom = new JSDOM(builder.buildLesson({ slug: "water-cycle", target, write: false }).bytes, {
      url: "https://water-cycle.test/", runScripts: "dangerously", virtualConsole: vc,
      beforeParse(w) {
        if (educatorSession) w.sessionStorage.setItem("lyfelabz-ls", "on");
        w.requestAnimationFrame = () => 0;
        w.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, beginPath() {}, arc() {}, fill() {} });
        w.HTMLElement.prototype.scrollIntoView = jest.fn();
        w.scrollTo = jest.fn();
        w.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
        w.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].fn = () => {}; };
        w.lyfelabz = { lessonQuiz: {
          hasAssignmentContext: () => true,
          autosave: (selection) => calls.autosave.push(selection.slice()),
          finalize: (selection, options) => {
            calls.finalize.push({ selection: selection.slice(), options });
            return Promise.resolve({ ok: true });
          },
        } };
      },
    });
    win = dom.window; doc = win.document;
  });
  afterEach(() => { win.close(); expect(errors).toEqual([]); });
  const runTimers = (ms) => timers.filter((t) => t.ms === ms).forEach((t) => t.fn());
  function write(text) {
    doc.getElementById("el-thinking").value = text;
    doc.getElementById("el-thinking").dispatchEvent(new win.Event("input"));
  }
  function answer(wrongIndex = -1) {
    win.elQuizQuestions.forEach((q, i) => doc.getElementById(`el-q-${i}-${i === wrongIndex ? (q.correct + 1) % 4 : q.correct}`).click());
  }
  test("corrected explanations and concise word model cover the required system features", () => {
    expect(doc.documentElement.outerHTML).not.toMatch(forbidden);
    const text = doc.body.textContent;
    for (const phrase of ["Earth is a closed system for water", "does not mean one closed-loop pathway", "does not require boiling or direct sunlight", "Not all clouds produce precipitation", "saturated pores and fractures", "Some infiltrated water stays in soil", "tiny openings in the leaves", "Snow and ice can store water"]) expect(text).toContain(phrase);
    const prompt = doc.querySelector(".think-prompt").textContent;
    for (const phrase of ["3–4 sentences", "closed system", "state change", "stay stored", "alternative pathway", "solar energy", "gravity"]) expect(prompt).toContain(phrase);
    const model = doc.getElementById("el-think-model").textContent;
    for (const phrase of ["closed system", "stored in a lake", "liquid into invisible vapor", "solar energy", "gravity", "Alternatively"]) expect(model).toContain(phrase);
  });
  test("all vocabulary jumps reach a unique matching explanation and highlight it", () => {
    const jumps = [...doc.querySelectorAll(".gc-jump")];
    expect(jumps).toHaveLength(7);
    for (const jump of jumps) {
      const id = jump.getAttribute("onclick").match(/jumpToTerm\('([^']+)'\)/)[1];
      const destinations = doc.querySelectorAll(`[id="${id}"]`);
      expect(destinations).toHaveLength(1);
      const term = jump.closest(".glossary-card").querySelector(".gc-term").textContent;
      expect(destinations[0].querySelector(".name-it-label").textContent).toContain(term);
      jump.click(); runTimers(500);
      expect(destinations[0].classList.contains("pulsing")).toBe(true);
    }
    expect(win.scrollTo).toHaveBeenCalledTimes(7);
    expect(doc.getElementById("term-transpiration").textContent).toContain("inside leaves");
    expect(doc.getElementById("term-groundwater").textContent).toContain("saturated pores and fractures");
  });
  test("process selection works in a nonsequential order", () => {
    const expected = { 1: "Evaporation & Transpiration", 2: "Condensation", 3: "Precipitation", 4: "Movement & Storage" };
    for (const n of [4, 2, 1, 3]) {
      doc.querySelectorAll(".layer-row")[n - 1].click();
      expect(doc.getElementById("ld-title").textContent).toBe(expected[n]);
      expect(doc.getElementById("ld-label").textContent).toContain("Process group");
    }
  });
  test("prediction locks a choice and reveals corrected energy/force feedback", () => {
    const choices = doc.querySelectorAll(".predict-btn");
    choices[0].click(); choices[1].click(); runTimers(250);
    expect(doc.querySelectorAll(".predict-btn.chosen")).toHaveLength(1);
    const feedback = doc.querySelector(".predict-gated");
    expect(feedback.classList.contains("visible")).toBe(true);
    expect(feedback.textContent).toContain("Sun is an energy source, and gravity is a force");
  });
  test.each([[1, 1], [2, 0], [3, 2]])("recall %i gives feedback, retries, and locks a correct answer", (n, key) => {
    const prefix = `qr${n}`;
    doc.getElementById(prefix + "Check").click();
    expect(doc.getElementById(prefix + "Feedback").textContent).toBe("Pick an answer first.");
    doc.querySelector(`input[name="${prefix}"][value="${(key + 1) % 3}"]`).click();
    doc.getElementById(prefix + "Check").click();
    expect(doc.getElementById(prefix + "Retry").style.display).toBe("inline-flex");
    expect(doc.getElementById(prefix + "Feedback").textContent).not.toMatch(forbidden);
    doc.getElementById(prefix + "Retry").click();
    expect(doc.querySelector(`input[name="${prefix}"]:checked`)).toBeNull();
    doc.querySelector(`input[name="${prefix}"][value="${key}"]`).click();
    doc.getElementById(prefix + "Check").click();
    expect(doc.getElementById(prefix + "Feedback").textContent).toMatch(/^Correct!/);
    expect([...doc.querySelectorAll(`input[name="${prefix}"]`)].every((x) => x.disabled)).toBe(true);
  });
  test("quiz gates incomplete answers and empty writing, then scores and submits writing separately", async () => {
    write("An initial model."); win.elSubmitQuiz(); expect(calls.finalize).toHaveLength(0);
    answer(4); write("   "); win.elSubmitQuiz(); expect(calls.finalize).toHaveLength(0);
    expect(doc.getElementById("el-submit-btn").disabled).toBe(true);
    write("  A lake can store water or lose it by evaporation.  ");
    doc.getElementById("el-submit-btn").click(); await Promise.resolve();
    expect(doc.getElementById("el-score-num").textContent).toBe("9/10");
    expect(doc.getElementById("el-think-model").classList.contains("show")).toBe(true);
    expect(doc.getElementById("el-thinking").disabled).toBe(true);
    expect(calls.finalize).toHaveLength(1);
    expect(calls.finalize[0].options.writtenResponse).toBe("A lake can store water or lose it by evaporation.");
    expect(calls.finalize[0].selection).toHaveLength(10);
    expect(calls.autosave).toHaveLength(10);
    expect(doc.getElementById("el-feedback-4").textContent).toContain("Gravity pulls them downward");
    expect(doc.getElementById("el-feedback-4").classList.contains("incorrect-fb")).toBe(true);
    win.elSubmitQuiz(); expect(calls.finalize).toHaveLength(1);
  });
  test("perfect score stays qualified; reset clears selections, writing, model and pending continuation", () => {
    answer(); write("My water model."); win.elSubmitQuiz();
    expect(doc.getElementById("el-score-num").textContent).toBe("10/10");
    expect(doc.getElementById("el-score-msg").textContent).toContain("Compare your model");
    win.elResetQuiz(); runTimers(1900);
    expect(win.elQuizState.selected.every((x) => x === null)).toBe(true);
    expect(doc.getElementById("el-thinking").value).toBe("");
    expect(doc.getElementById("el-thinking").disabled).toBe(false);
    expect(doc.getElementById("el-think-model").classList.contains("show")).toBe(false);
    expect(doc.getElementById("el-score").classList.contains("show")).toBe(false);
    expect(doc.getElementById("el-submit-btn").disabled).toBe(true);
    expect(win.elQuizState.continueTimer).toBeNull();
  });
  test("Educator Mode stays off without the homepage session state; the lesson offers no local switch", () => {
    expect(doc.body.classList.contains("ls-active")).toBe(false);
    doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "i", ctrlKey: true, altKey: true }));
    doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "i", ctrlKey: true, metaKey: true }));
    expect(doc.body.classList.contains("ls-active")).toBe(false);
    expect(win.sessionStorage.getItem("lyfelabz-ls")).toBeNull();
  });
  describe("with Educator Mode turned on from the homepage", () => {
    beforeAll(() => { educatorSession = true; });
    afterAll(() => { educatorSession = false; });
    test("guidance is revealed and the lesson offers no local switch", () => {
      expect(doc.body.classList.contains("ls-active")).toBe(true);
      doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "i", ctrlKey: true, altKey: true }));
      expect(doc.body.classList.contains("ls-active")).toBe(true);
      expect(win.sessionStorage.getItem("lyfelabz-ls")).toBe("on");
    });
  });
  test("Educator Mode guidance is present for the homepage-controlled state", () => {
    const notes = [...doc.querySelectorAll(".edu-note")].map((x) => x.textContent).join(" ");
    expect(doc.querySelectorAll(".edu-note")).toHaveLength(13);
    for (const phrase of ["not giant underground caverns", "not evidence of developing a model", "One route alone", "ungraded word model"]) expect(notes).toContain(phrase);
  });
  test("SVG arrows resolve to forward-oriented markers; branches and storage have accessible explanations", () => {
    const ids = [...doc.querySelectorAll("[id]")].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    const svgs = [...doc.querySelectorAll(".figure-box svg, .layer-figure svg")];
    expect(svgs).toHaveLength(2);
    for (const svg of svgs) {
      for (const id of svg.getAttribute("aria-labelledby").split(" ")) expect(doc.getElementById(id)).not.toBeNull();
      for (const marker of svg.querySelectorAll("marker")) {
        expect(marker.getAttribute("orient")).toBe("auto");
        expect(marker.getAttribute("refX")).toBe("8");
        expect(marker.getAttribute("refY")).toBe("4");
        expect(marker.querySelector("path").getAttribute("d")).toBe("M0,0 L8,4 L0,8 Z");
      }
      for (const arrow of svg.querySelectorAll("[marker-end]")) {
        const id = arrow.getAttribute("marker-end").match(/#([^)]*)/)[1];
        expect(svg.querySelector(`marker[id="${id}"]`)).not.toBeNull();
        expect(arrow.querySelector("title").textContent.length).toBeGreaterThan(10);
      }
    }
    for (const process of ["evaporation", "condensation", "precipitation", "snowfall", "melting-runoff", "runoff", "infiltration", "root-uptake", "transpiration", "deeper-water", "groundwater-flow"]) expect(svgs[0].querySelector(`[data-process="${process}"]`)).not.toBeNull();
    expect(svgs[0].textContent).toContain("Snow / ice");
    expect(svgs[0].querySelector(".wc-reservoir-labels").textContent).toContain("Soil water");
    expect([...svgs[0].querySelectorAll(".wc-process-labels text")].map((el) => el.textContent)).toEqual([
      "Evaporation", "Condensation", "Precipitation", "Transpiration", "Runoff", "Infiltration",
    ]);
    const description = doc.getElementById("wc-overview-desc").textContent;
    for (const detail of ["invisible atmospheric vapor", "saturated pores and fractures", "not an underground lake", "remain stored", "not measurements", "leaf openings"]) expect(description).toContain(detail);
    expect(svgs[0].querySelector('[data-process="runoff"] title').textContent).toContain("across the land surface");
    expect(doc.querySelector(".figure-caption").textContent).toBe("Water can follow many different pathways as it moves through Earth's closed water system.");
    // Geometry, overlaps and actual narrow-screen readability still require human browser review.
  });
});
