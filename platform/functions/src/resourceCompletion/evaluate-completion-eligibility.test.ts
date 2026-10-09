import * as fs from "fs";
import * as path from "path";

import { isResourceTypeAssignable } from "../shared/activity-identifiers";
import { validateCompletionDefinition } from "./completion-definition";
import { evaluateCompletionEligibility } from "./evaluate-completion-eligibility";
import { parseResourceEvidence } from "./resource-evidence";
import {
  GRAVITY_WELLS_COMPLETION_DEFINITION as GW,
  GRAVITY_WELLS_RESOURCE_ID,
} from "./gravity-wells-completion-definition";
import type { GravityWellsOrbitMassKey } from "./gravity-wells-orbit-verifier";

// Launches observed in the page's own physics (parity test).
const LAUNCH: Record<string, { massKey: GravityWellsOrbitMassKey; deg: number; speed: number }> = {
  earthOrbit: { massKey: "earth", speed: 2, deg: 75 },
  earthCrash: { massKey: "earth", speed: 0.5, deg: 0 },
  earthOrbitThenFlyby: { massKey: "earth", speed: 3.5, deg: 120 },
  jupiterOrbit: { massKey: "jupiter", speed: 2.5, deg: 75 },
  sunEscape: { massKey: "sun", speed: 5.5, deg: 0 }, // also a flyby
  sunOrbitNoCredit: { massKey: "sun", speed: 4.25, deg: 90 },
  blackHoleSurvival: { massKey: "blackhole", speed: 4.25, deg: 90 },
  blackHoleFlyby: { massKey: "blackhole", speed: 8.25, deg: 135 },
};

// Each flight is observed for 3,600 loop calls unless a test says otherwise.
function run(name: keyof typeof LAUNCH, observedInvocations = 3600) {
  const { massKey, speed, deg } = LAUNCH[name];
  const a = (deg * Math.PI) / 180;
  return {
    validatorId: "gravity-wells.orbit",
    validatorVersion: 1,
    parameters: { massKey, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, observedInvocations },
  };
}

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    resourceId: GRAVITY_WELLS_RESOURCE_ID,
    assessmentRevisionId: "assessment_simulation-gravity-wells__r1",
    definitionVersion: 1,
    authored: [
      { evidenceId: "orbit-speed-explanation", kind: "text", text: "Gravity pulls in while sideways speed carries it around." },
    ],
    outcomeRuns: [run("earthOrbit"), run("jupiterOrbit"), run("blackHoleSurvival")],
    attestations: [],
    ...overrides,
  };
}

// Plain mutable copy of the Gravity Wells definition for negative cases.
function gwCopy(): any {
  return JSON.parse(JSON.stringify(GW));
}

function evaluated(def: unknown, ev: unknown) {
  const r = evaluateCompletionEligibility(def, ev);
  if (r.status !== "evaluated") throw new Error(`expected evaluation, got ${r.status}: ${r.issues.join(", ")}`);
  return r;
}

describe("Gravity Wells definition", () => {
  it("is a valid version-1 definition bound to the canonical id and r1 revision", () => {
    const v = validateCompletionDefinition(GW);
    expect(v.ok).toBe(true);
    expect(GW.resourceId).toBe("simulation-gravity-wells");
    expect(GW.assessmentRevisionId).toBe("assessment_simulation-gravity-wells__r1");
    expect(GW.stages.map((s) => [s.stageId, s.required])).toEqual([
      ["orbit-missions", true],
      ["orbit-explanation", true],
    ]);
  });

  it("carries no answer key, question count, unit, teacher, or assignment context", () => {
    const text = JSON.stringify(GW);
    for (const banned of ["answer", "correct", "unit", "teacher", "assignment", "class", "question", "itemCount"]) {
      expect(text.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it("leaves simulations unassignable", () => {
    expect(isResourceTypeAssignable("simulation")).toBe(false);
  });
});

describe("evaluateCompletionEligibility: Gravity Wells", () => {
  it("is eligible when all required work is complete", () => {
    const r = evaluated(GW, evidence());
    expect(r.eligible).toBe(true);
    expect(r.unmetRequiredStageIds).toEqual([]);
    expect(r.verifiedOutcomeIds).toEqual(["earth-orbit", "jupiter-orbit", "black-hole-survival"]);
  });

  it("is ineligible with no work", () => {
    const r = evaluated(GW, evidence({ authored: [], outcomeRuns: [] }));
    expect(r.eligible).toBe(false);
    expect(r.unmetRequiredStageIds).toEqual(["orbit-missions", "orbit-explanation"]);
  });

  it("requires Earth orbit even when every other mission is done", () => {
    const r = evaluated(GW, evidence({ outcomeRuns: [run("sunEscape"), run("jupiterOrbit"), run("blackHoleSurvival")] }));
    expect(r.eligible).toBe(false);
    expect(r.stages[0].missing).toEqual(["outcome:earth-orbit"]);
    expect(r.verifiedOutcomeIds).toEqual(["sun-escape", "jupiter-orbit", "flyby", "black-hole-survival"]);
  });

  it("is ineligible with Earth orbit plus one qualifying mission", () => {
    const r = evaluated(GW, evidence({ outcomeRuns: [run("earthOrbit"), run("jupiterOrbit")] }));
    expect(r.eligible).toBe(false);
    expect(r.stages[0].missing).toEqual(["outcome:sun-escape", "outcome:flyby", "outcome:black-hole-survival"]);
  });

  it("is eligible with Earth orbit plus two qualifying missions from one launch", () => {
    // The Sun escape launch is also a flyby: two missions, as on the page.
    expect(evaluated(GW, evidence({ outcomeRuns: [run("earthOrbit"), run("sunEscape")] })).eligible).toBe(true);
    // One Earth launch that orbits and then flies by earns c1 and c4 only.
    expect(evaluated(GW, evidence({ outcomeRuns: [run("earthOrbitThenFlyby")] })).eligible).toBe(false);
  });

  it("does not count duplicate outcomes twice", () => {
    const r = evaluated(
      GW,
      evidence({ outcomeRuns: [run("earthOrbit"), run("blackHoleFlyby"), run("earthOrbitThenFlyby"), run("blackHoleFlyby")] }),
    );
    expect(r.verifiedOutcomeIds).toEqual(["earth-orbit", "flyby"]);
    expect(r.eligible).toBe(false);
  });

  it("gives no credit for flights that earn nothing", () => {
    const r = evaluated(GW, evidence({ outcomeRuns: [run("earthCrash"), run("sunOrbitNoCredit")] }));
    expect(r.verifiedOutcomeIds).toEqual([]);
  });

  it("requires the explanation, and a blank one is missing", () => {
    for (const text of ["", "   ", "\n\t  ", "​​", " "]) {
      const r = evaluated(GW, evidence({ authored: [{ evidenceId: "orbit-speed-explanation", kind: "text", text }] }));
      expect(r.eligible).toBe(false);
      expect(r.stages[1].missing).toEqual(["evidence:orbit-speed-explanation"]);
    }
    expect(evaluated(GW, evidence({ authored: [] })).unmetRequiredStageIds).toEqual(["orbit-explanation"]);
  });

  it("accepts any visible explanation without a length or quality threshold", () => {
    const r = evaluated(GW, evidence({ authored: [{ evidenceId: "orbit-speed-explanation", kind: "text", text: "?" }] }));
    expect(r.eligible).toBe(true);
  });

  it("is deterministic and leaves its inputs untouched", () => {
    const ev = evidence();
    const before = JSON.stringify(ev);
    const a = evaluateCompletionEligibility(GW, ev);
    const b = evaluateCompletionEligibility(GW, ev);
    expect(a).toEqual(b);
    expect(JSON.stringify(ev)).toBe(before);
    expect(JSON.stringify(a)).not.toMatch(/At"|timestamp/i);
  });
});

describe("evaluateCompletionEligibility: forged and malformed evidence", () => {
  it.each([
    ["client eligibility flag", { eligible: true }, "evidence.serverControlledField:eligible"],
    ["client completion flag", { completed: true }, "evidence.serverControlledField:completed"],
    ["ownership stamp", { studentUid: "u1" }, "evidence.serverControlledField:studentUid"],
    ["assignment stamp", { assignmentId: "a1" }, "evidence.serverControlledField:assignmentId"],
    ["submission state", { submittedAt: "2026-10-08T00:00:00Z" }, "evidence.serverControlledField:submittedAt"],
    ["claimed outcomes", { outcomes: ["earth-orbit"] }, "evidence.unexpectedFields"],
    ["quiz attempt", { attemptId: "x", score: 5 }, "evidence.unexpectedFields"],
    ["unknown schema", { schemaVersion: 2 }, "evidence.unsupportedSchemaVersion"],
  ])("refuses %s", (_label, extra, issue) => {
    const r = evaluateCompletionEligibility(GW, evidence(extra));
    expect(r.eligible).toBe(false);
    expect(r.status).toBe("invalid-evidence");
    expect(r.status !== "evaluated" && r.issues).toContain(issue);
  });

  it.each([
    ["claimed success inside a run", [{ ...run("earthOrbit"), success: true }], "run.malformed:0"],
    [
      "claimed mission inside parameters",
      [{ ...run("earthOrbit"), parameters: { ...run("earthOrbit").parameters, missions: ["c1", "c3", "c5"] } }],
      "run.invalidParameters:0:malformed-parameters",
    ],
    ["unknown validator", [{ ...run("earthOrbit"), validatorId: "gravity-wells.other" }], "run.validatorNotInDefinition:0"],
    ["future validator version", [{ ...run("earthOrbit"), validatorVersion: 2 }], "run.validatorNotInDefinition:0"],
    [
      "out-of-range speed",
      [{ ...run("earthOrbit"), parameters: { massKey: "earth", vx: 50, vy: 0, observedInvocations: 10 } }],
      "run.invalidParameters:0:speed-above-maximum",
    ],
    [
      "NaN velocity",
      [{ ...run("earthOrbit"), parameters: { massKey: "earth", vx: NaN, vy: 1, observedInvocations: 10 } }],
      "run.invalidParameters:0:non-finite-velocity",
    ],
    [
      "phase 2 mass",
      [{ ...run("earthOrbit"), parameters: { massKey: "moon", vx: 1, vy: 1, observedInvocations: 10 } }],
      "run.invalidParameters:0:unknown-mass",
    ],
  ])("refuses %s", (_label, outcomeRuns, issue) => {
    const r = evaluateCompletionEligibility(GW, evidence({ outcomeRuns }));
    expect(r.status).toBe("invalid-evidence");
    expect(r.status !== "evaluated" && r.issues).toContain(issue);
  });

  it("refuses undeclared, duplicate, and oversized authored evidence", () => {
    const text = (t: string) => ({ evidenceId: "orbit-speed-explanation", kind: "text", text: t });
    const cases: Array<[unknown[], string]> = [
      [[{ evidenceId: "mass-prediction", kind: "text", text: "x" }], "authored.undeclared:mass-prediction"],
      [[text("a"), text("b")], "authored.duplicate:orbit-speed-explanation"],
      [[{ evidenceId: "orbit-speed-explanation", kind: "table", text: "x" }], "authored.kindMismatch:orbit-speed-explanation"],
      [[text("x".repeat(20_001))], "authored.invalidText:orbit-speed-explanation"],
      [[{ ...text("x"), score: 4 }], "authored.malformed"],
    ];
    for (const [authored, issue] of cases) {
      const r = evaluateCompletionEligibility(GW, evidence({ authored }));
      expect(r.status !== "evaluated" && r.issues).toContain(issue);
    }
  });

  it("refuses too many runs", () => {
    const r = evaluateCompletionEligibility(GW, evidence({ outcomeRuns: Array.from({ length: 51 }, () => run("earthOrbit")) }));
    expect(r.status !== "evaluated" && r.issues).toEqual(["evidence.tooLarge"]);
  });

  it("refuses an attestation the definition does not authorize", () => {
    const r = evaluateCompletionEligibility(GW, evidence({ attestations: [{ attestationId: "missions-done", affirmed: true }] }));
    expect(r.status !== "evaluated" && r.issues).toEqual(["attestation.notAuthorized:missions-done"]);
  });

  it("refuses non-object evidence", () => {
    for (const bad of [null, undefined, "x", 42, [], new Date()]) {
      expect(evaluateCompletionEligibility(GW, bad)).toMatchObject({ eligible: false, status: "invalid-evidence" });
    }
  });
});

// Sol's counterexample: after step 11,710 the next call (11,711) awards Sun
// escape and flyby. Resetting after 11,710 calls prevents it.
function lateSunRun(observedInvocations: number) {
  return {
    validatorId: "gravity-wells.orbit",
    validatorVersion: 1,
    parameters: { massKey: "sun", vx: 3.18496278819097, vy: 5.516517369362989, observedInvocations },
  };
}

describe("evaluateCompletionEligibility: late missions and computation budget", () => {
  it("credits missions the page awards after 3,600 steps", () => {
    const r = evaluated(GW, evidence({ outcomeRuns: [run("earthOrbit"), lateSunRun(11711)] }));
    expect(r.verifiedOutcomeIds).toEqual(["earth-orbit", "sun-escape", "flyby"]);
    expect(r.eligible).toBe(true);
    expect(r.undeterminedRunIndexes).toEqual([]);
  });

  it("does not credit them when the flight was reset before they happened", () => {
    const r = evaluated(GW, evidence({ outcomeRuns: [run("earthOrbit"), lateSunRun(11710)] }));
    expect(r.verifiedOutcomeIds).toEqual(["earth-orbit"]);
    expect(r.eligible).toBe(false);
    expect(r.undeterminedRunIndexes).toEqual([]);
  });

  it("reports runs the shared budget cannot settle as undetermined, without invalidating the batch", () => {
    // Two long orbit observations use up the 4,000,000-step budget: the
    // second is cut short and the late Sun run gets no computation.
    const r = evaluated(
      GW,
      evidence({ outcomeRuns: [run("earthOrbit", 3_000_000), run("jupiterOrbit", 3_000_000), lateSunRun(11711)] }),
    );
    expect(r.undeterminedRunIndexes).toEqual([1, 2]);
    // Verified within the budget: Earth orbit (run 0) and Jupiter orbit
    // (run 1, at step 240). The Sun escape is undetermined, not refuted.
    expect(r.verifiedOutcomeIds).toEqual(["earth-orbit", "jupiter-orbit"]);
    expect(r.eligible).toBe(false);
  });
});

describe("evaluateCompletionEligibility: mixed batches", () => {
  it("keeps valid unsuccessful experiments without invalidating the batch", () => {
    const r = evaluated(
      GW,
      evidence({
        outcomeRuns: [run("earthCrash"), run("earthOrbit"), run("sunOrbitNoCredit"), run("earthCrash"), run("sunEscape")],
      }),
    );
    expect(r.eligible).toBe(true);
    expect(r.verifiedOutcomeIds).toEqual(["earth-orbit", "sun-escape", "flyby"]);
  });

  it("refuses the whole batch, with indexed issues, when any record is malformed", () => {
    const outcomeRuns = [
      run("earthOrbit"),
      run("sunEscape"),
      { validatorId: "gravity-wells.orbit", validatorVersion: 1 },
      run("jupiterOrbit"),
      { ...run("blackHoleSurvival"), parameters: { ...run("blackHoleSurvival").parameters, observedInvocations: 0 } },
    ];
    const r = evaluateCompletionEligibility(GW, evidence({ outcomeRuns }));
    expect(r).toEqual({
      eligible: false,
      status: "invalid-evidence",
      issues: ["run.malformed:2", "run.invalidParameters:4:invalid-observed-invocations"],
    });
  });

  it("rejects fabricated success claims alongside real successes", () => {
    for (const forged of [
      { ...run("earthOrbit"), outcomes: ["earth-orbit", "sun-escape"] },
      { ...run("earthOrbit"), verified: true },
      { ...run("earthOrbit"), parameters: { ...run("earthOrbit").parameters, terminal: "escaped" } },
      { ...run("earthOrbit"), parameters: { ...run("earthOrbit").parameters, missions: ["c2", "c4"] } },
    ]) {
      const r = evaluateCompletionEligibility(GW, evidence({ outcomeRuns: [run("earthOrbit"), run("sunEscape"), forged] }));
      expect(r.status).toBe("invalid-evidence");
      expect(r.eligible).toBe(false);
    }
  });

  it("cannot forge a verified success: the physics decides, not the claimed duration", () => {
    // A crash observed for 1,000,000 steps still crashed at step 54, and an
    // orbit-length Sun flight earns nothing however long it is watched.
    const r = evaluated(
      GW,
      evidence({ outcomeRuns: [run("earthOrbit"), run("earthCrash", 1_000_000), run("sunOrbitNoCredit", 50_000)] }),
    );
    expect(r.verifiedOutcomeIds).toEqual(["earth-orbit"]);
    expect(r.eligible).toBe(false);
  });
});

describe("parseResourceEvidence: snapshot isolation", () => {
  it("is unaffected by later mutation of the caller's input", () => {
    const input = evidence({ outcomeRuns: [run("earthOrbit"), lateSunRun(11711)] }) as any;
    const parsed = parseResourceEvidence(input, GW);
    if (!parsed.ok) throw new Error(parsed.issues.join(", "));
    const before = JSON.stringify(parsed);

    input.outcomeRuns[1].parameters.observedInvocations = 1;
    input.outcomeRuns[1].parameters.vx = 9;
    input.outcomeRuns[0].parameters.massKey = "jupiter";
    input.outcomeRuns.push(run("blackHoleSurvival"));
    input.authored[0].text = "";

    expect(JSON.stringify(parsed)).toBe(before);
    expect(parsed.evidence.outcomeRuns[1].parameters).not.toBe(input.outcomeRuns[1].parameters);
    expect(Object.isFrozen(parsed.evidence.outcomeRuns[1].parameters)).toBe(true);
    expect(parsed.verifiedRuns.map((v) => v.outcomes)).toEqual([["earth-orbit"], ["sun-escape", "flyby"]]);
    // Re-evaluating the frozen snapshot reproduces the same verified outcomes.
    expect(evaluated(GW, parsed.evidence).verifiedOutcomeIds).toEqual(["earth-orbit", "sun-escape", "flyby"]);
  });
});

describe("evaluateCompletionEligibility: identity binding", () => {
  it.each([
    ["resource", { resourceId: "simulation-eclipse-alignment" }, "binding.resourceId"],
    ["assessment revision", { assessmentRevisionId: "assessment_simulation-gravity-wells__r2" }, "binding.assessmentRevisionId"],
    ["definition version", { definitionVersion: 2 }, "binding.definitionVersion"],
  ])("refuses a mismatched %s", (_label, extra, issue) => {
    const r = evaluateCompletionEligibility(GW, evidence(extra));
    expect(r).toEqual({ eligible: false, status: "binding-mismatch", issues: [issue] });
  });
});

describe("evaluateCompletionEligibility: definition validation fails closed", () => {
  const cases: Array<[string, (d: any) => void, string]> = [
    ["unsupported schema version", (d) => (d.schemaVersion = 2), "definition.unsupportedSchemaVersion"],
    ["unknown top-level field", (d) => (d.answerKey = { q1: "B" }), "definition.unexpectedFields"],
    ["unit context", (d) => (d.unitId = "u1"), "definition.unexpectedFields"],
    ["lesson type", (d) => (d.resourceType = "lesson"), "definition.unsupportedResourceType"],
    ["type mismatch", (d) => (d.resourceType = "investigation"), "definition.resourceTypeMismatch"],
    ["revision of another resource", (d) => (d.assessmentRevisionId = "assessment_gravity__r1"), "definition.assessmentRevisionMismatch"],
    ["non-canonical revision", (d) => (d.assessmentRevisionId = "assessment_simulation-gravity-wells"), "definition.invalidAssessmentRevision"],
    ["zero definition version", (d) => (d.definitionVersion = 0), "definition.invalidDefinitionVersion"],
    ["no required stage", (d) => d.stages.forEach((s: any) => (s.required = false)), "definition.noRequiredStage"],
    ["duplicate stage", (d) => (d.stages[1].stageId = "orbit-missions"), "stage.duplicateId:orbit-missions"],
    ["unsupported requirement kind", (d) => (d.stages[1].requirement = { kind: "expression", code: "true" }), "requirement.unsupportedKind:orbit-explanation"],
    ["unknown evidence reference", (d) => (d.stages[1].requirement.evidenceId = "nope"), "requirement.unknownEvidence:nope"],
    ["unknown outcome reference", (d) => (d.stages[0].requirement.requirements[0].outcomeId = "moon-orbit"), "requirement.unknownOutcome:moon-orbit"],
    ["unsatisfiable atLeast", (d) => (d.stages[0].requirement.requirements[1].count = 5), "requirement.unsatisfiableCount:orbit-missions"],
    ["zero atLeast", (d) => (d.stages[0].requirement.requirements[1].count = 0), "requirement.unsatisfiableCount:orbit-missions"],
    ["empty allOf", (d) => (d.stages[0].requirement = { kind: "allOf", requirements: [] }), "requirement.invalidChildCount:orbit-missions"],
    [
      "duplicate reference",
      (d) => d.stages[0].requirement.requirements[1].requirements.push({ kind: "outcome", outcomeId: "flyby" }),
      "requirement.duplicateReference:outcome:flyby",
    ],
    [
      "cross-stage reference",
      (d) => (d.stages[1].requirement = { kind: "allOf", requirements: [d.stages[1].requirement, { kind: "outcome", outcomeId: "flyby" }] }),
      "requirement.crossStageReference:outcome:flyby",
    ],
    ["unknown validator", (d) => (d.outcomes[0].validatorVersion = 2), "outcome.unknownValidator"],
    ["unknown validator outcome", (d) => (d.outcomes[0].validatorOutcome = "moon-orbit"), "outcome.unknownValidatorOutcome"],
    ["two ids for one validator outcome", (d) => (d.outcomes[1].validatorOutcome = "earth-orbit"), "outcome.duplicateValidatorOutcome"],
    ["unknown evidence kind", (d) => (d.evidence[0].kind = "graph"), "evidence.unsupportedKind"],
    ["blank prompt", (d) => (d.evidence[0].prompt = "  "), "evidence.invalidPrompt"],
    ["writing length threshold field", (d) => (d.evidence[0].minWords = 20), "evidence.malformed"],
    ["orphan evidence", (d) => d.evidence.push({ ...d.evidence[0], evidenceId: "extra" }), "evidence.unreferenced:extra"],
    ["evidence in unknown stage", (d) => (d.evidence[0].stageId = "nowhere"), "evidence.unknownStage:orbit-speed-explanation"],
  ];
  it.each(cases)("refuses %s", (_label, mutate, issue) => {
    const def = gwCopy();
    mutate(def);
    const r = evaluateCompletionEligibility(def, evidence());
    expect(r.eligible).toBe(false);
    expect(r.status).toBe("invalid-definition");
    expect(r.status !== "evaluated" && r.issues).toContain(issue);
  });

  it("refuses requirement trees deeper than the bound", () => {
    const def = gwCopy();
    let r: any = { kind: "evidence", evidenceId: "orbit-speed-explanation" };
    for (let i = 0; i < 4; i++) r = { kind: "allOf", requirements: [r] };
    def.stages[1].requirement = r;
    const result = evaluateCompletionEligibility(def, evidence());
    expect(result.status !== "evaluated" && result.issues).toContain("requirement.tooDeep:orbit-explanation");
  });

  it("refuses non-object definitions", () => {
    for (const bad of [null, "x", [], 1]) {
      expect(evaluateCompletionEligibility(bad, evidence())).toEqual({
        eligible: false,
        status: "invalid-definition",
        issues: ["definition.malformed"],
      });
    }
  });
});

describe("evaluateCompletionEligibility: optional stages and attestations", () => {
  // A hypothetical physical-work resource, to exercise attestation policy
  // and optional enrichment. Not a real LyfeLabz requirement.
  function physicalDefinition(): any {
    return {
      schemaVersion: 1,
      resourceId: "challenge-welcome-to-floatia",
      resourceType: "challenge",
      assessmentRevisionId: "assessment_challenge-welcome-to-floatia__r1",
      definitionVersion: 1,
      stages: [
        {
          stageId: "build-and-test",
          required: true,
          requirement: {
            kind: "allOf",
            requirements: [
              { kind: "attestation", attestationId: "boat-tested" },
              { kind: "evidence", evidenceId: "test-observation" },
            ],
          },
        },
        { stageId: "extension-reflection", required: false, requirement: { kind: "evidence", evidenceId: "reflection" } },
      ],
      evidence: [
        { evidenceId: "test-observation", stageId: "build-and-test", kind: "text", purpose: "observation", prompt: "What happened when you tested your boat?" },
        { evidenceId: "reflection", stageId: "extension-reflection", kind: "text", purpose: "reflection", prompt: "What would you change next time?" },
      ],
      outcomes: [],
      attestations: [
        {
          attestationId: "boat-tested",
          stageId: "build-and-test",
          statement: "I built and tested my boat.",
          reason: "Physical construction happens offline and cannot be verified.",
        },
      ],
    };
  }
  function physicalEvidence(extra: Record<string, unknown> = {}) {
    return {
      schemaVersion: 1,
      resourceId: "challenge-welcome-to-floatia",
      assessmentRevisionId: "assessment_challenge-welcome-to-floatia__r1",
      definitionVersion: 1,
      authored: [{ evidenceId: "test-observation", kind: "text", text: "It floated with 12 pennies." }],
      outcomeRuns: [],
      attestations: [{ attestationId: "boat-tested", affirmed: true }],
      ...extra,
    };
  }

  it("accepts an explicitly authorized attestation with its evidence", () => {
    expect(evaluated(physicalDefinition(), physicalEvidence()).eligible).toBe(true);
  });

  it("does not let the attestation replace required evidence", () => {
    const r = evaluated(physicalDefinition(), physicalEvidence({ authored: [] }));
    expect(r.eligible).toBe(false);
    expect(r.stages[0].missing).toEqual(["evidence:test-observation"]);
  });

  it("requires the attestation when the stage requires it", () => {
    const r = evaluated(physicalDefinition(), physicalEvidence({ attestations: [] }));
    expect(r.stages[0].missing).toEqual(["attestation:boat-tested"]);
  });

  it("refuses an attestation that is not affirmed true", () => {
    const r = evaluateCompletionEligibility(physicalDefinition(), physicalEvidence({ attestations: [{ attestationId: "boat-tested", affirmed: "yes" }] }));
    expect(r.status).toBe("invalid-evidence");
  });

  it("ignores an incomplete optional stage", () => {
    const r = evaluated(physicalDefinition(), physicalEvidence());
    expect(r.stages[1]).toEqual({ stageId: "extension-reflection", required: false, satisfied: false, missing: ["evidence:reflection"] });
    expect(r.eligible).toBe(true);
  });

  it("refuses an attestation offered as an alternative to a verifiable outcome", () => {
    const def = gwCopy();
    def.attestations.push({ attestationId: "missions-done", stageId: "orbit-missions", statement: "I did the missions.", reason: "Convenience." });
    def.stages[0].requirement = { kind: "atLeast", count: 1, requirements: [def.stages[0].requirement, { kind: "attestation", attestationId: "missions-done" }] };
    const r = evaluateCompletionEligibility(def, evidence());
    expect(r.status !== "evaluated" && r.issues).toContain("stage.attestationMixedWithOutcome:orbit-missions");
  });

  it("refuses an attestation authorization without a reason", () => {
    const def = physicalDefinition();
    def.attestations[0].reason = "";
    expect(evaluateCompletionEligibility(def, physicalEvidence()).status).toBe("invalid-definition");
  });
});

describe("module boundaries", () => {
  it("imports only pure modules and uses no clock, randomness, or network", () => {
    const allowed = new Set(["../shared/activity-identifiers", "../shared/assessment-identifiers"]);
    for (const file of fs.readdirSync(__dirname).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      const src = fs.readFileSync(path.join(__dirname, file), "utf8");
      for (const m of src.matchAll(/from "([^"]+)"/g)) {
        expect({ file, from: m[1], allowed: m[1].startsWith("./") || allowed.has(m[1]) }).toMatchObject({ allowed: true });
      }
      const code = src.replace(/\/\/.*$/gm, "");
      expect(code).not.toMatch(/Date\.now|new Date|Math\.random|fetch\(|require\(|process\./);
    }
  });
});
