import {
  GRAVITY_WELLS_MAX_LAUNCH_SPEED,
  GRAVITY_WELLS_MIN_LAUNCH_SPEED,
  gravityWellsLaunchVelocityFromDrag,
  parseGravityWellsLaunchParameters,
  verifyGravityWellsLaunch as verifyWithBudget,
  type GravityWellsLaunchVerification,
  type GravityWellsOrbitMassKey,
} from "./gravity-wells-orbit-verifier";

// Expected outcomes below were observed by running the page's own script
// (see gravity-wells-orbit-parity.test.ts), not derived from this module.

const BUDGET = 4_000_000;
const verifyGravityWellsLaunch = (raw: unknown) => verifyWithBudget(raw, BUDGET);

function launch(massKey: GravityWellsOrbitMassKey, speed: number, degrees: number, observedInvocations = 3600) {
  const a = (degrees * Math.PI) / 180;
  return verifyGravityWellsLaunch({ massKey, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, observedInvocations });
}

// Sol's certification counterexample: the page awards c2 and c4 at 11,710.
const LATE_SUN = { massKey: "sun", vx: 3.18496278819097, vy: 5.516517369362989 } as const;
// A late Black Hole flyby (c4 at step 84,427), found by search and
// confirmed against the page in the parity test.
const LATE_BLACK_HOLE = { massKey: "blackhole", vx: -6.250529833461967, vy: 4.420815000592066 } as const;

function summary(r: GravityWellsLaunchVerification) {
  if (!r.valid) return r.issue;
  return { terminal: r.terminal, missions: r.missions.map((m) => m.outcome) };
}

describe("verifyGravityWellsLaunch outcomes", () => {
  it.each([
    ["earth", 2, 75, "observation-ended", ["earth-orbit"]],
    ["earth", 0.5, 0, "crashed", []],
    ["earth", 3.25, 0, "escaped", []],
    ["earth", 3.25, 15, "crashed", ["earth-orbit"]],
    ["earth", 3.5, 120, "escaped", ["earth-orbit", "flyby"]],
    ["earth", 3.5, 135, "escaped", ["flyby"]],
    ["jupiter", 2.5, 75, "observation-ended", ["jupiter-orbit"]],
    ["jupiter", 3.75, 135, "escaped", ["flyby"]],
    ["sun", 5.5, 0, "escaped", ["sun-escape", "flyby"]],
    ["sun", 4.25, 90, "observation-ended", []],
    ["blackhole", 4.25, 90, "observation-ended", ["black-hole-survival"]],
    ["blackhole", 7.5, 0, "escaped", []],
    ["blackhole", 8.25, 135, "escaped", ["flyby"]],
  ] as const)("%s at speed %s, %s deg -> %s %j", (massKey, speed, deg, terminal, missions) => {
    // Each flight is observed for 3,600 steps.
    expect(summary(launch(massKey, speed, deg))).toEqual({ terminal, missions });
  });

  it("credits Earth orbit only after 240 steps and black hole survival after 120", () => {
    const at240 = verifyGravityWellsLaunch({ massKey: "earth", vx: 2.692990158219725, vy: 1.4318882664969657, observedInvocations: 1000 });
    const at239 = verifyGravityWellsLaunch({ massKey: "earth", vx: 2.61436026714144, vy: 1.5708661284756638, observedInvocations: 1000 });
    expect(at240.valid && at240.terminal === "crashed" && at240.steps).toBe(240);
    expect(at240.valid && at240.missions).toEqual([{ outcome: "earth-orbit", sourceMissionId: "c1", step: 240 }]);
    expect(at239.valid && [at239.terminal, at239.steps, at239.missions.length]).toEqual(["crashed", 239, 0]);

    const bh120 = verifyGravityWellsLaunch({ massKey: "blackhole", vx: 6.711696879329383, vy: 3.87499999999999, observedInvocations: 1000 });
    const bh119 = verifyGravityWellsLaunch({ massKey: "blackhole", vx: 3.3366784523776363, vy: 4.194779720728932, observedInvocations: 1000 });
    expect(bh120.valid && bh120.missions.map((m) => [m.outcome, m.step])).toEqual([["black-hole-survival", 120]]);
    expect(bh119.valid && [bh119.steps, bh119.missions.length]).toEqual([119, 0]);
  });

  it("never credits a mass with another mass's mission", () => {
    // Orbit-length flights around the Sun and the Black Hole earn no orbit
    // mission; only Earth and Jupiter orbits count, each as itself.
    expect(summary(launch("sun", 4.25, 90))).toEqual({ terminal: "observation-ended", missions: [] });
    const bh = launch("blackhole", 4.25, 90);
    expect(bh.valid && bh.missions.map((m) => m.outcome)).toEqual(["black-hole-survival"]);
    const jupiter = launch("jupiter", 2.5, 75);
    expect(jupiter.valid && jupiter.missions.map((m) => m.outcome)).toEqual(["jupiter-orbit"]);
  });

  it("simulates exactly the observed duration, and an ended observation is not a failure", () => {
    const r = launch("earth", 2, 75, 3600);
    expect(r.valid && [r.terminal, r.steps, r.undetermined]).toEqual(["observation-ended", 3600, false]);
    expect(r.valid && r.missions.map((m) => m.outcome)).toEqual(["earth-orbit"]);
    // Watching only 239 steps of the same orbit earns nothing yet.
    const short = launch("earth", 2, 75, 239);
    expect(short.valid && [short.terminal, short.missions.length]).toEqual(["observation-ended", 0]);
  });

  it("is repeatable and does not depend on prior calls", () => {
    const late = verifyGravityWellsLaunch({ ...LATE_SUN, observedInvocations: 20000 });
    expect(verifyGravityWellsLaunch({ ...LATE_SUN, observedInvocations: 20000 })).toEqual(late);
    const first = launch("earth", 3.5, 120);
    for (let i = 0; i < 5; i++) launch("blackhole", 8.25, 135);
    expect(launch("earth", 3.5, 120)).toEqual(first);
    expect(Object.isFrozen(first.valid && first.missions)).toBe(true);
  });
});

describe("verifyGravityWellsLaunch late missions and computation bounds", () => {
  it("credits the late Sun escape and flyby when call 11,711 (after step 11,710) ran", () => {
    const r = verifyGravityWellsLaunch({ ...LATE_SUN, observedInvocations: 11711 });
    expect(r.valid && [r.terminal, r.steps, r.invocations, r.undetermined]).toEqual(["escaped", 11710, 11711, false]);
    expect(r.valid && r.missions).toEqual([
      { outcome: "sun-escape", sourceMissionId: "c2", step: 11710 },
      { outcome: "flyby", sourceMissionId: "c4", step: 11710 },
    ]);
  });

  it("does not credit the late escape when the student reset right after step 11,710", () => {
    // 11,710 calls: the terminal check on step 11,710's position never ran.
    for (const calls of [11710, 11709]) {
      const r = verifyGravityWellsLaunch({ ...LATE_SUN, observedInvocations: calls });
      expect(r.valid && [r.terminal, r.steps, r.invocations, r.missions.length, r.undetermined]).toEqual([
        "observation-ended",
        calls,
        calls,
        0,
        false,
      ]);
    }
  });

  it("adds the late Black Hole flyby and detects the late crash only on the following call", () => {
    const flybyReset = verifyGravityWellsLaunch({ ...LATE_BLACK_HOLE, observedInvocations: 84427 });
    expect(flybyReset.valid && [flybyReset.terminal, flybyReset.missions.map((m) => m.outcome)]).toEqual([
      "observation-ended",
      ["black-hole-survival"],
    ]);
    const crash = { massKey: "blackhole", vx: -6.206626702970348, vy: -4.364272326829319 } as const;
    const crashReset = verifyGravityWellsLaunch({ ...crash, observedInvocations: 10222 });
    const crashSeen = verifyGravityWellsLaunch({ ...crash, observedInvocations: 10223 });
    expect(crashReset.valid && [crashReset.terminal, crashReset.steps]).toEqual(["observation-ended", 10222]);
    expect(crashSeen.valid && [crashSeen.terminal, crashSeen.steps, crashSeen.invocations]).toEqual(["crashed", 10222, 10223]);
  });

  it("treats an overstated duration as harmless: the physics still ends the flight", () => {
    const r = verifyGravityWellsLaunch({ ...LATE_SUN, observedInvocations: 1_000_000 });
    expect(r.valid && [r.terminal, r.steps, r.invocations]).toEqual(["escaped", 11710, 11711]);
  });

  it("credits a late Black Hole flyby at step 84,427", () => {
    const r = verifyGravityWellsLaunch({ ...LATE_BLACK_HOLE, observedInvocations: 100000 });
    expect(r.valid && [r.terminal, r.steps]).toEqual(["escaped", 84427]);
    expect(r.valid && r.missions.map((m) => [m.outcome, m.step])).toEqual([
      ["black-hole-survival", 120],
      ["flyby", 84427],
    ]);
  });

  it("reports budget exhaustion as undetermined, distinct from failure", () => {
    const limited = verifyWithBudget({ ...LATE_SUN, observedInvocations: 20000 }, 11709);
    expect(limited.valid && [limited.terminal, limited.steps, limited.undetermined, limited.missions.length]).toEqual([
      "computation-limit",
      11709,
      true,
      0,
    ]);
    // A budget of exactly the needed steps settles it: the following call
    // only checks, which costs no step.
    const exact = verifyWithBudget({ ...LATE_SUN, observedInvocations: 20000 }, 11710);
    expect(exact.valid && [exact.terminal, exact.undetermined]).toEqual(["escaped", false]);
    // Missions reached inside the budget stay verified.
    const partial = verifyWithBudget({ ...LATE_BLACK_HOLE, observedInvocations: 100000 }, 5000);
    expect(partial.valid && [partial.terminal, partial.missions.map((m) => m.outcome)]).toEqual([
      "computation-limit",
      ["black-hole-survival"],
    ]);
  });

  it("never spends more than the budget, and treats a bad budget as zero", () => {
    const bounded = verifyWithBudget({ massKey: "earth", vx: 0.5, vy: 2.6, observedInvocations: 9_000_000_000 }, 250_000);
    expect(bounded.valid && [bounded.terminal, bounded.steps]).toEqual(["computation-limit", 250_000]);
    for (const bad of [0, -5, NaN, Infinity, 1.5]) {
      const r = verifyWithBudget({ ...LATE_SUN, observedInvocations: 100 }, bad);
      expect(r.valid && [r.terminal, r.steps, r.undetermined]).toEqual(["computation-limit", 0, true]);
    }
  });

  it("returns a frozen copy of the parameters, detached from the caller", () => {
    const input = { ...LATE_SUN, observedInvocations: 11710 } as { massKey: string; vx: number; vy: number; observedInvocations: number };
    const parsed = parseGravityWellsLaunchParameters(input);
    input.vx = 1;
    input.observedInvocations = 5;
    expect(parsed.ok && parsed.value).toEqual({ ...LATE_SUN, observedInvocations: 11710 });
    expect(parsed.ok && Object.isFrozen(parsed.value)).toBe(true);
  });
});

describe("verifyGravityWellsLaunch input validation", () => {
  it.each([
    [null, "malformed-parameters"],
    [[], "malformed-parameters"],
    ["earth", "malformed-parameters"],
    [{ massKey: "earth", vx: 1 }, "malformed-parameters"],
    [{ massKey: "earth", vx: 1, vy: 1, observedInvocations: 10, success: true }, "malformed-parameters"],
    [{ massKey: "earth", vx: 1, vy: 1, observedInvocations: 10, missions: ["earth-orbit"] }, "malformed-parameters"],
    [{ massKey: "earth", vx: 1, vy: 1, observedInvocations: 10, terminal: "escaped" }, "malformed-parameters"],
    [{ massKey: "earth", vx: 1, vy: 1 }, "malformed-parameters"],
    [{ massKey: "earth", vx: 1, vy: 1, observedInvocations: 0 }, "invalid-observed-invocations"],
    [{ massKey: "earth", vx: 1, vy: 1, observedInvocations: -100 }, "invalid-observed-invocations"],
    [{ massKey: "earth", vx: 1, vy: 1, observedInvocations: 1.5 }, "invalid-observed-invocations"],
    [{ massKey: "earth", vx: 1, vy: 1, observedInvocations: NaN }, "invalid-observed-invocations"],
    [{ massKey: "earth", vx: 1, vy: 1, observedInvocations: Infinity }, "invalid-observed-invocations"],
    [{ massKey: "earth", vx: 1, vy: 1, observedInvocations: "11710" }, "invalid-observed-invocations"],
    [{ massKey: "earth", vx: 1, vy: 1, observedInvocations: 2 ** 53 }, "invalid-observed-invocations"],
    [{ massKey: "moon", vx: 1, vy: 1, observedInvocations: 10 }, "unknown-mass"],
    [{ massKey: "Earth", vx: 1, vy: 1, observedInvocations: 10 }, "unknown-mass"],
    [{ massKey: "toString", vx: 1, vy: 1, observedInvocations: 10 }, "unknown-mass"],
    [{ massKey: "earth", vx: "1", vy: 1, observedInvocations: 10 }, "malformed-parameters"],
    [{ massKey: "earth", vx: NaN, vy: 1, observedInvocations: 10 }, "non-finite-velocity"],
    [{ massKey: "earth", vx: Infinity, vy: 0, observedInvocations: 10 }, "non-finite-velocity"],
    [{ massKey: "earth", vx: 0, vy: -Infinity, observedInvocations: 10 }, "non-finite-velocity"],
    [{ massKey: "earth", vx: 0, vy: 0, observedInvocations: 10 }, "speed-below-minimum"],
    [{ massKey: "earth", vx: 0.2, vy: 0, observedInvocations: 10 }, "speed-below-minimum"],
    [{ massKey: "earth", vx: 10.001, vy: 0, observedInvocations: 10 }, "speed-above-maximum"],
    [{ massKey: "earth", vx: 8, vy: 8, observedInvocations: 10 }, "speed-above-maximum"],
    [{ massKey: "earth", vx: 1e308, vy: 1e308, observedInvocations: 10 }, "speed-above-maximum"],
  ])("refuses %j (%s)", (input, issue) => {
    expect(verifyGravityWellsLaunch(input)).toEqual({ valid: false, issue });
  });

  it("accepts the exact speed bounds the page can produce", () => {
    expect(verifyGravityWellsLaunch({ massKey: "earth", vx: GRAVITY_WELLS_MAX_LAUNCH_SPEED, vy: 0, observedInvocations: 10 }).valid).toBe(true);
    expect(verifyGravityWellsLaunch({ massKey: "earth", vx: 0, vy: GRAVITY_WELLS_MIN_LAUNCH_SPEED, observedInvocations: 10 }).valid).toBe(true);
    const capped = gravityWellsLaunchVelocityFromDrag(-3000, 4000);
    expect(capped && verifyGravityWellsLaunch({ massKey: "sun", ...capped, observedInvocations: 10 }).valid).toBe(true);
    const shortest = gravityWellsLaunchVelocityFromDrag(3, 4);
    expect(shortest && verifyGravityWellsLaunch({ massKey: "sun", ...shortest, observedInvocations: 10 }).valid).toBe(true);
  });

  it("treats drags the page ignores as no launch", () => {
    expect(gravityWellsLaunchVelocityFromDrag(2.9, 4)).toBeNull();
    expect(gravityWellsLaunchVelocityFromDrag(NaN, 100)).toBeNull();
    expect(gravityWellsLaunchVelocityFromDrag(Infinity, 0)).toBeNull();
  });
});
