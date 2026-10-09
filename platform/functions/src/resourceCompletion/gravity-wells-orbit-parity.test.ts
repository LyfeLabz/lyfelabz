import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";

import {
  GRAVITY_WELLS_MAX_LAUNCH_SPEED,
  GRAVITY_WELLS_MIN_LAUNCH_SPEED,
  GRAVITY_WELLS_ORBIT_MASSES,
  gravityWellsLaunchVelocityFromDrag,
  verifyGravityWellsLaunch,
  type GravityWellsOrbitMassKey,
} from "./gravity-wells-orbit-verifier";

// Parity against the independent source: the public page's own inline
// script, executed unmodified in a Node `vm` context with a minimal DOM
// stub. Rendering, speed-meter, and toast functions are replaced with
// no-ops after load; physics, reset, drag, and mission functions run as
// shipped. Each animation frame is pumped by hand.

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const PAGE = path.join(REPO_ROOT, "simulation_gravity-wells.html");

function pageScript(): string {
  const html = fs.readFileSync(PAGE, "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const physics = scripts.filter((s) => s.includes("function runOrbitLoop"));
  if (physics.length !== 1) throw new Error("Expected exactly one inline script with runOrbitLoop");
  return physics[0];
}

function stubElement(): Record<string, unknown> {
  return {
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 440 }),
  };
}

interface BrowserRun {
  terminal: "crashed" | "escaped" | "observation-ended";
  steps: number;
  // runOrbitLoop calls that actually executed.
  calls: number;
  // For observation-ended: Reset cancelled the scheduled callback.
  resetCancelledPending: boolean;
  minDistance: number;
  missions: Array<{ id: string; step: number }>;
  final: { x: number; y: number; vx: number; vy: number };
}

function createBrowserSim() {
  let pending: (() => void) | null = null;
  const sandbox: Record<string, unknown> = {
    document: {
      getElementById: () => stubElement(),
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener() {},
      body: stubElement(),
    },
    window: { location: { search: "" }, scrollTo() {}, scrollY: 0, devicePixelRatio: 1 },
    sessionStorage: { getItem: () => null },
    requestAnimationFrame: (f: () => void) => {
      pending = f;
      return 1;
    },
    cancelAnimationFrame: () => {
      pending = null;
    },
    setTimeout: () => 0,
    clearTimeout() {},
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(pageScript(), ctx);
  vm.runInContext(
    "drawOrbitFrame=function(){};updateSpeedMeter=function(){};toast=function(){};showPhase3Checkpoint=function(){};orbitCanvas=document.getElementById('orbitCanvas');",
    ctx,
  );
  const run = <T>(code: string): T => vm.runInContext(code, ctx) as T;
  run("var __calls=0;var __pageRunOrbitLoop=runOrbitLoop;runOrbitLoop=function(){__calls++;return __pageRunOrbitLoop();};");
  const calls = () => run<number>("__calls");
  const state = () =>
    run<{ outcome: string; frames: number; x: number; y: number; vx: number; vy: number; minD: number; done: string[] }>(
      "({outcome:currentOutcome,frames:orbitFrameCount,x:probe.x,y:probe.y,vx:probe.vx,vy:probe.vy,minD:minDistSoFar,done:[...challengesDone]})",
    );

  return {
    run,
    // Fresh page-state launch: select the mass (which resets), set the
    // vector as endDrag does, and press Launch. `runOrbitLoop` calls are
    // counted by a wrapper around the page's own function, so the count
    // includes launchProbe's direct call and every scheduled callback. The
    // harness lets exactly `observedInvocations` calls run. If the flight is
    // still scheduled after that, it presses Reset (the page's resetOrbit),
    // which must cancel the pending callback so it never runs.
    launch(massKey: GravityWellsOrbitMassKey, vx: number, vy: number, observedInvocations: number): BrowserRun {
      sandbox.__launch = { massKey, vx, vy };
      run("__calls=0;challengesDone=new Set();selectOrbitMass(__launch.massKey);probe.vx=__launch.vx;probe.vy=__launch.vy;vectorSet=true;");
      const missions: Array<{ id: string; step: number }> = [];
      const seen = new Set<string>();
      const record = () => {
        for (const id of state().done) {
          if (!seen.has(id)) {
            seen.add(id);
            missions.push({ id, step: state().frames });
          }
        }
      };
      run("launchProbe();");
      record();
      while (pending && calls() < observedInvocations) {
        const f = pending;
        pending = null;
        f();
        record();
      }
      const end = state();
      const ended = end.outcome === "crashed" || end.outcome === "escaped";
      let resetCancelledPending = false;
      if (pending) {
        if (ended) throw new Error("page scheduled a callback after a terminal outcome");
        run("resetOrbit();");
        resetCancelledPending = pending === null;
      } else if (!ended) {
        throw new Error("page stopped without a terminal outcome");
      }
      return {
        terminal: ended ? (end.outcome as "crashed" | "escaped") : "observation-ended",
        steps: end.frames,
        calls: calls(),
        resetCancelledPending,
        minDistance: end.minD,
        missions,
        final: { x: end.x, y: end.y, vx: end.vx, vy: end.vy },
      };
    },
    drag(massKey: GravityWellsOrbitMassKey, dragVx: number, dragVy: number) {
      sandbox.__drag = { massKey, dragVx, dragVy };
      run(
        "selectOrbitMass(__drag.massKey);" +
          "startDrag({clientX:probe.x+__drag.dragVx,clientY:probe.y+__drag.dragVy});" +
          "moveDrag({clientX:probe.x+__drag.dragVx,clientY:probe.y+__drag.dragVy});" +
          "endDrag({clientX:probe.x+__drag.dragVx,clientY:probe.y+__drag.dragVy});",
      );
      // The page's own drag vector (pointer minus probe, in its arithmetic).
      return run<{ vectorSet: boolean; vx: number; vy: number; dragVx: number; dragVy: number }>(
        "({vectorSet:vectorSet,vx:probe.vx,vy:probe.vy,dragVx:dragVx,dragVy:dragVy})",
      );
    },
  };
}

const sim = createBrowserSim();
const MASS_KEYS = Object.keys(GRAVITY_WELLS_ORBIT_MASSES) as GravityWellsOrbitMassKey[];
const SOURCE_ID: Record<string, string> = {
  "earth-orbit": "c1",
  "sun-escape": "c2",
  "jupiter-orbit": "c3",
  flyby: "c4",
  "black-hole-survival": "c5",
};

const BUDGET = 4_000_000;

function expectParity(
  massKey: GravityWellsOrbitMassKey,
  vx: number,
  vy: number,
  observedInvocations = 3600,
): BrowserRun {
  const browser = sim.launch(massKey, vx, vy, observedInvocations);
  const verified = verifyGravityWellsLaunch({ massKey, vx, vy, observedInvocations }, BUDGET);
  if (!verified.valid) throw new Error(`verifier refused ${massKey} ${vx} ${vy}: ${verified.issue}`);
  const label = `${massKey} vx=${vx} vy=${vy}`;
  expect(verified.undetermined).toBe(false);
  expect({ label, terminal: verified.terminal, steps: verified.steps, calls: verified.invocations }).toEqual({
    label,
    terminal: browser.terminal,
    steps: browser.steps,
    calls: browser.calls,
  });
  if (browser.terminal === "observation-ended") expect(browser.resetCancelledPending).toBe(true);
  expect(verified.missions.map((m) => ({ id: SOURCE_ID[m.outcome], step: m.step }))).toEqual(browser.missions);
  // Bit-identical integration, not approximate agreement.
  expect(Object.is(verified.minDistance, browser.minDistance)).toBe(true);
  expect(Object.is(verified.final.x, browser.final.x)).toBe(true);
  expect(Object.is(verified.final.y, browser.final.y)).toBe(true);
  expect(Object.is(verified.final.vx, browser.final.vx)).toBe(true);
  expect(Object.is(verified.final.vy, browser.final.vy)).toBe(true);
  return browser;
}

// Deterministic LCG so the random sample is repeatable.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("gravity-wells.orbit@1 parity with simulation_gravity-wells.html", () => {
  it("uses the page's physics constants", () => {
    const page = sim.run<Record<string, { mass: number; crashR: number; startDist: number }>>("ORBIT_MASSES");
    for (const key of MASS_KEYS) {
      expect({
        mass: page[key].mass,
        crashR: page[key].crashR,
        startDist: page[key].startDist,
      }).toEqual(GRAVITY_WELLS_ORBIT_MASSES[key]);
    }
    expect(Object.keys(page).sort()).toEqual([...MASS_KEYS].sort());
    expect(sim.run("[G, ESCAPE_R, MAX_SPEED, MAX_DRAG, ORBIT_CX, ORBIT_CY]")).toEqual([1, 300, 10, 220, 320, 220]);
    expect(GRAVITY_WELLS_MAX_LAUNCH_SPEED).toBe(10);
  });

  it.each(MASS_KEYS)("matches the page on a speed x angle grid for %s", (massKey) => {
    const outcomes = new Set<string>();
    for (let i = 0; i <= 20; i++) {
      const speed = GRAVITY_WELLS_MIN_LAUNCH_SPEED + (i / 20) * (10 - GRAVITY_WELLS_MIN_LAUNCH_SPEED);
      for (let a = 0; a < 48; a++) {
        const angle = (a / 48) * 2 * Math.PI;
        const b = expectParity(massKey, Math.cos(angle) * speed, Math.sin(angle) * speed);
        outcomes.add(`${b.terminal}:${b.missions.map((m) => m.id).join("+")}`);
      }
    }
    // The grid must exercise more than one behavior per mass.
    expect(outcomes.size).toBeGreaterThan(2);
  }, 180000);

  it("matches the page on a seeded random sample across all masses", () => {
    const rand = lcg(20261008);
    for (let i = 0; i < 600; i++) {
      const massKey = MASS_KEYS[Math.floor(rand() * MASS_KEYS.length)];
      const speed = GRAVITY_WELLS_MIN_LAUNCH_SPEED + rand() * (10 - GRAVITY_WELLS_MIN_LAUNCH_SPEED);
      const angle = rand() * 2 * Math.PI;
      expectParity(massKey, Math.cos(angle) * speed, Math.sin(angle) * speed);
    }
  }, 180000);

  it("matches the page at near-boundary launches", () => {
    // Earth crash after exactly 240 steps (orbit credited) and 239 (not).
    expect(expectParity("earth", 2.692990158219725, 1.4318882664969657).missions).toEqual([{ id: "c1", step: 240 }]);
    expect(expectParity("earth", 2.61436026714144, 1.5708661284756638).missions).toEqual([]);
    // Black hole crash after exactly 120 steps (survival credited) and 119.
    expect(expectParity("blackhole", 6.711696879329383, 3.87499999999999).missions).toEqual([{ id: "c5", step: 120 }]);
    expect(expectParity("blackhole", 3.3366784523776363, 4.194779720728932).missions).toEqual([]);
    // Speed extremes.
    expectParity("earth", 10, 0);
    expectParity("earth", 0, -GRAVITY_WELLS_MIN_LAUNCH_SPEED);
  });

  // Each pair: reset immediately after integration step N (N calls; the
  // scheduled call N + 1 is cancelled) versus letting call N + 1 run (it
  // performs only the terminal checks).
  it.each([
    ["sun escape and flyby", "sun", 3.18496278819097, 5.516517369362989, 11710, "escaped", [], [["c2", 11710], ["c4", 11710]]],
    ["black hole flyby", "blackhole", -6.250529833461967, 4.420815000592066, 84427, "escaped", [["c5", 120]], [["c5", 120], ["c4", 84427]]],
    ["black hole late crash", "blackhole", -6.206626702970348, -4.364272326829319, 10222, "crashed", [["c5", 120]], [["c5", 120]]],
  ] as const)("%s: reset after step N earns no terminal mission; call N + 1 does", (_l, massKey, vx, vy, n, terminal, before, after) => {
    const reset = expectParity(massKey, vx, vy, n);
    expect(reset).toMatchObject({ terminal: "observation-ended", steps: n, calls: n, resetCancelledPending: true });
    expect(reset.missions.map((m) => [m.id, m.step])).toEqual(before);

    const natural = expectParity(massKey, vx, vy, n + 1);
    expect(natural).toMatchObject({ terminal, steps: n, calls: n + 1, resetCancelledPending: false });
    expect(natural.missions.map((m) => [m.id, m.step])).toEqual(after);

    // Allowing more calls than the flight lasts changes nothing.
    expect(expectParity(massKey, vx, vy, n + 500)).toMatchObject({ terminal, steps: n, calls: n + 1 });
  }, 120000);

  it("matches the page at step-based mission boundaries", () => {
    // Earth orbit: after call 239 (239 steps) nothing; call 240 credits c1.
    const earth = [Math.cos((75 * Math.PI) / 180) * 2, Math.sin((75 * Math.PI) / 180) * 2] as const;
    expect(expectParity("earth", earth[0], earth[1], 239).missions).toEqual([]);
    expect(expectParity("earth", earth[0], earth[1], 240).missions).toEqual([{ id: "c1", step: 240 }]);
    // Black Hole survival: call 119 nothing; call 120 credits c5.
    const bh = [Math.cos(Math.PI / 2) * 4.25, Math.sin(Math.PI / 2) * 4.25] as const;
    expect(expectParity("blackhole", bh[0], bh[1], 119).missions).toEqual([]);
    expect(expectParity("blackhole", bh[0], bh[1], 120).missions).toEqual([{ id: "c5", step: 120 }]);
    // A crash detected on call 241 after 240 steps keeps the orbit credit.
    const crash = expectParity("earth", 2.692990158219725, 1.4318882664969657, 241);
    expect([crash.terminal, crash.steps, crash.calls]).toEqual(["crashed", 240, 241]);
  });

  it("stops at the budget exactly where the page would be after the same steps", () => {
    const sun = { massKey: "sun", vx: 3.18496278819097, vy: 5.516517369362989 } as const;
    for (const budget of [5000, 11709, 11710]) {
      const verified = verifyGravityWellsLaunch({ ...sun, observedInvocations: 20000 }, budget);
      if (!verified.valid) throw new Error(verified.issue);
      const afterBudgetSteps = sim.launch(sun.massKey, sun.vx, sun.vy, budget);
      const nextCall = sim.launch(sun.massKey, sun.vx, sun.vy, budget + 1);
      if (nextCall.terminal === "escaped") {
        // The call after the budget's last step only checks; it is observed
        // (20,000 calls allowed) and the page awards there too.
        expect([verified.terminal, verified.steps, verified.invocations]).toEqual(["escaped", nextCall.steps, nextCall.calls]);
        expect(verified.missions.map((m) => SOURCE_ID[m.outcome])).toEqual(nextCall.missions.map((m) => m.id));
      } else {
        expect([verified.terminal, verified.undetermined, verified.steps]).toEqual(["computation-limit", true, budget]);
        expect(verified.missions.map((m) => SOURCE_ID[m.outcome])).toEqual(afterBudgetSteps.missions.map((m) => m.id));
        expect(Object.is(verified.final.x, afterBudgetSteps.final.x) && Object.is(verified.final.vy, afterBudgetSteps.final.vy)).toBe(true);
      }
    }
  });

  it("matches the page bit for bit over about 30,000 observed calls on a seeded sample", () => {
    const rand = lcg(11710);
    for (let i = 0; i < 120; i++) {
      const massKey = MASS_KEYS[i % MASS_KEYS.length];
      const speed = GRAVITY_WELLS_MIN_LAUNCH_SPEED + rand() * (10 - GRAVITY_WELLS_MIN_LAUNCH_SPEED);
      const angle = rand() * 2 * Math.PI;
      // Odd counts too, so resets land at arbitrary steps.
      expectParity(massKey, Math.cos(angle) * speed, Math.sin(angle) * speed, 30000 - Math.floor(rand() * 7));
    }
  }, 180000);

  it("converts a drag vector to a launch velocity exactly as endDrag does", () => {
    const rand = lcg(7);
    const drags: Array<[number, number]> = [
      [0, 0],
      [3, 4], // length 5: accepted
      [2.9, 4], // shorter than 5: ignored
      [220, 0],
      [0, -500], // beyond MAX_DRAG: capped at max speed
      [-155.5, 87.25],
    ];
    for (let i = 0; i < 200; i++) drags.push([(rand() - 0.5) * 700, (rand() - 0.5) * 700]);
    for (const [dx, dy] of drags) {
      const page = sim.drag("earth", dx, dy);
      const mine = gravityWellsLaunchVelocityFromDrag(page.dragVx, page.dragVy);
      if (!page.vectorSet) {
        expect(mine).toBeNull();
      } else {
        expect(mine).not.toBeNull();
        expect(Object.is(mine!.vx, page.vx) && Object.is(mine!.vy, page.vy)).toBe(true);
        // Every launch the page can produce passes the verifier's bounds.
        expect(verifyGravityWellsLaunch({ massKey: "earth", vx: page.vx, vy: page.vy, observedInvocations: 1 }, 1).valid).toBe(true);
      }
    }
  });
});
