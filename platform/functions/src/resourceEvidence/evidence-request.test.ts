import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  GRAVITY_WELLS_COMPLETION_DEFINITION,
  GRAVITY_WELLS_RESOURCE_ID,
  RESOURCE_EVIDENCE_LIMITS,
  parseResourceEvidence,
} from "../resourceCompletion";
import { PlatformError } from "../shared/errors/platform-error";
import {
  EVIDENCE_REQUEST_LIMITS,
  canonicalJson,
  parseGetEvidenceRequest,
  parseRecordOutcomeRunRequest,
  parseSaveWorkingEvidenceRequest,
  parseSubmitEvidenceRequest,
  payloadHash,
} from "./evidence-request";
import {
  NO_PUBLISHED_COMPLETION_DEFINITIONS,
  PRODUCTION_RESOURCE_EVIDENCE_DEPS,
  UNAVAILABLE_FROZEN_COMPLETION_BINDING,
} from "./evidence-assignment-context";
import {
  RUN_VERIFICATION_LIMITS,
  appendKeepsInvariant,
  nextRunAllowance,
  resolveRunVerificationPolicy,
} from "./run-observation-policy";

// Hermetic RA-3A tests: request parsing, hashing, the per-run observation
// allocation, and the deployment boundary. Persistence, authorization,
// concurrency, and immutability run against the Firestore emulator in
// resource-evidence.emulator.test.ts.

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof PlatformError ? err.code : "non-platform-error";
  }
  return undefined;
}

const OP = "op-00000001";
const FLIGHT = "flight-0001";

describe("evidence request parsing", () => {
  it("accepts exact shapes", () => {
    expect(parseGetEvidenceRequest({ assignmentId: "a1" })).toEqual({ assignmentId: "a1" });
    expect(
      parseSaveWorkingEvidenceRequest({
        assignmentId: "a1",
        operationId: OP,
        expectedWorkingRevision: 0,
        working: { authored: [], attestations: [] },
      }).expectedWorkingRevision,
    ).toBe(0);
    expect(
      parseRecordOutcomeRunRequest({ assignmentId: "a1", operationId: OP, flightId: FLIGHT, parameters: {} }).flightId,
    ).toBe(FLIGHT);
    expect(
      parseSubmitEvidenceRequest({ assignmentId: "a1", operationId: OP, expectedWorkingRevision: 2, expectedRunsRevision: 3 })
        .expectedRunsRevision,
    ).toBe(3);
  });

  it.each([
    "studentId",
    "uid",
    "teacherId",
    "classId",
    "schoolId",
    "districtId",
    "resourceId",
    "resourceType",
    "assessmentRevisionId",
    "definitionVersion",
    "validatorId",
    "validatorVersion",
    "outcomes",
    "missions",
    "success",
    "eligible",
    "eligibleAt",
    "submittedAt",
    "status",
  ])("refuses a forged server-owned field %s on every request", (field) => {
    const base = { assignmentId: "a1", operationId: OP };
    expect(codeOf(() => parseGetEvidenceRequest({ assignmentId: "a1", [field]: "x" }))).toBe(
      "resourceEvidence.invalidRequest",
    );
    expect(
      codeOf(() =>
        parseSaveWorkingEvidenceRequest({
          ...base,
          expectedWorkingRevision: 0,
          working: { authored: [], attestations: [] },
          [field]: "x",
        }),
      ),
    ).toBe("resourceEvidence.invalidRequest");
    expect(
      codeOf(() => parseRecordOutcomeRunRequest({ ...base, flightId: FLIGHT, parameters: {}, [field]: true })),
    ).toBe("resourceEvidence.invalidRequest");
    expect(
      codeOf(() =>
        parseSubmitEvidenceRequest({ ...base, expectedWorkingRevision: 0, expectedRunsRevision: 0, [field]: true }),
      ),
    ).toBe("resourceEvidence.invalidRequest");
  });

  it("refuses forged fields inside working evidence", () => {
    expect(
      codeOf(() =>
        parseSaveWorkingEvidenceRequest({
          assignmentId: "a1",
          operationId: OP,
          expectedWorkingRevision: 0,
          working: { authored: [], attestations: [], outcomeRuns: [] },
        }),
      ),
    ).toBe("resourceEvidence.invalidRequest");
  });

  it.each([
    null,
    "a1",
    [],
    { assignmentId: "" },
    { assignmentId: "has/slash" },
    { assignmentId: "a".repeat(65) },
    { assignmentId: 7 },
  ])("refuses malformed get request %j", (data) => {
    expect(codeOf(() => parseGetEvidenceRequest(data))).toBe("resourceEvidence.invalidRequest");
  });

  it.each([
    { operationId: "short" },
    { operationId: "has space in it" },
    { operationId: 12345678 },
    { flightId: "x" },
    { flightId: "f".repeat(65) },
  ])("refuses malformed ids %j", (override) => {
    expect(
      codeOf(() =>
        parseRecordOutcomeRunRequest({ assignmentId: "a1", operationId: OP, flightId: FLIGHT, parameters: {}, ...override }),
      ),
    ).toBe("resourceEvidence.invalidRequest");
  });

  it.each([-1, 1.5, "1", Number.MAX_SAFE_INTEGER, NaN])("refuses revision %p", (rev) => {
    expect(
      codeOf(() =>
        parseSubmitEvidenceRequest({ assignmentId: "a1", operationId: OP, expectedWorkingRevision: rev, expectedRunsRevision: 0 }),
      ),
    ).toBe("resourceEvidence.invalidRequest");
  });

  it("refuses excessive payloads before parsing their structure", () => {
    const big = "x".repeat(EVIDENCE_REQUEST_LIMITS.maxSaveRequestBytes);
    expect(
      codeOf(() =>
        parseSaveWorkingEvidenceRequest({
          assignmentId: "a1",
          operationId: OP,
          expectedWorkingRevision: 0,
          working: { authored: [{ evidenceId: "e", kind: "text", text: big }], attestations: [] },
        }),
      ),
    ).toBe("resourceEvidence.invalidRequest");
    expect(
      codeOf(() =>
        parseRecordOutcomeRunRequest({
          assignmentId: "a1",
          operationId: OP,
          flightId: FLIGHT,
          parameters: { padding: "p".repeat(EVIDENCE_REQUEST_LIMITS.maxRecordRunRequestBytes) },
        }),
      ),
    ).toBe("resourceEvidence.invalidRequest");
  });
});

describe("canonical JSON and operation hashing", () => {
  it("is independent of key order and sensitive to content", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    expect(payloadHash({ a: 1, b: 2 })).toBe(payloadHash({ b: 2, a: 1 }));
    expect(payloadHash({ a: 1 })).not.toBe(payloadHash({ a: 2 }));
  });

  it("refuses values plain JSON cannot represent", () => {
    expect(codeOf(() => canonicalJson({ a: NaN }))).toBe("resourceEvidence.invalidRequest");
    expect(codeOf(() => canonicalJson({ a: Infinity }))).toBe("resourceEvidence.invalidRequest");
    expect(codeOf(() => canonicalJson({ a: undefined }))).toBe("resourceEvidence.invalidRequest");
    expect(codeOf(() => canonicalJson(new Date()))).toBe("resourceEvidence.invalidRequest");
  });
});

describe("run verification allocation", () => {
  const L = RUN_VERIFICATION_LIMITS;
  const policy = resolveRunVerificationPolicy("gravity-wells.orbit", 1);
  if (!policy) throw new Error("Gravity Wells policy missing");
  const MIN_SPEED = 5 / 22; // the page ignores drags under 5 px of 220
  const at = (massKey: string, speed: number, degrees: number, observedInvocations: number) => {
    const a = (degrees * Math.PI) / 180;
    return { massKey, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, observedInvocations };
  };
  // RA-2 parity case: flyby detected on call 84,428 (after step 84,427).
  const LATE_BLACK_HOLE = { massKey: "blackhole", vx: -6.250529833461967, vy: 4.420815000592066 };
  // Late flybys found by the launch-grid sweep (calls 130,712 and 147,455).
  const GRID_SPEED = MIN_SPEED + ((10 - MIN_SPEED) * 18) / 24;

  it("keeps the guaranteed floors and the pool inside the certified RA-2 budget", () => {
    expect(L.totalUnits).toBe(RESOURCE_EVIDENCE_LIMITS.maxComputationUnits);
    expect(L.runSlots).toBe(RESOURCE_EVIDENCE_LIMITS.maxOutcomeRuns);
    expect(L.guaranteedUnitsPerRun * L.runSlots).toBeLessThanOrEqual(L.totalUnits);
    // No single run may take more than a quarter of the budget, and the
    // ceiling covers every known late outcome.
    expect(L.maxUnitsPerRun).toBeLessThanOrEqual(L.totalUnits / 4);
    expect(L.maxUnitsPerRun).toBeGreaterThan(147_455);
    expect(L.guaranteedUnitsPerRun).toBeGreaterThan(11_711);
  });

  it("never lets one extreme run take the whole budget", () => {
    expect(nextRunAllowance(0, 0)).toBe(L.maxUnitsPerRun);
    // After three maximum runs the pool shrinks, then every later run still
    // keeps the guaranteed floor.
    expect(nextRunAllowance(3_000_000, 3)).toBe(80_000);
    expect(nextRunAllowance(3_080_000, 4)).toBe(L.guaranteedUnitsPerRun);
    expect(nextRunAllowance(3_960_000, 49)).toBe(40_000);
  });

  it("holds the budget invariant for any sequence of runs", () => {
    // Deterministic pseudo-random sequences of run costs, each at most its
    // allowance (a crash spends less, an ended observation spends it all).
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let trial = 0; trial < 200; trial++) {
      let storedCost = 0;
      for (let n = 0; n < L.runSlots; n++) {
        const allowance = nextRunAllowance(storedCost, n);
        expect(allowance).toBeGreaterThanOrEqual(L.guaranteedUnitsPerRun);
        expect(allowance).toBeLessThanOrEqual(L.maxUnitsPerRun);
        const cost = rand() < 0.5 ? allowance : Math.floor(rand() * allowance);
        expect(appendKeepsInvariant(storedCost, n, cost)).toBe(true);
        storedCost += cost;
        expect(storedCost).toBeLessThanOrEqual(L.totalUnits - L.guaranteedUnitsPerRun * (L.runSlots - n - 1));
      }
      expect(storedCost).toBeLessThanOrEqual(L.totalUnits);
      expect(appendKeepsInvariant(storedCost, L.runSlots, 0)).toBe(false);
    }
  });

  it("credits the Black Hole flyby exactly at its terminal boundary", () => {
    const allowance = nextRunAllowance(0, 0);
    const reset = policy.verify({ ...LATE_BLACK_HOLE, observedInvocations: 84_427 }, allowance);
    const seen = policy.verify({ ...LATE_BLACK_HOLE, observedInvocations: 84_428 }, allowance);
    // Reset before the terminal call: the escape was never observed. That is
    // the student's observation ending, not an undetermined verification.
    expect(reset).toMatchObject({ ok: true, truncated: false, undetermined: false, outcomes: ["black-hole-survival"] });
    expect(seen).toMatchObject({ ok: true, truncated: false, undetermined: false, outcomes: ["black-hole-survival", "flyby"] });
    expect(seen.ok && seen.cost).toBe(84_427);
  });

  it("credits late outcomes beyond the previous 80,000-call cap", () => {
    const allowance = nextRunAllowance(0, 0);
    const late = policy.verify({ ...LATE_BLACK_HOLE, observedInvocations: 100_000 }, allowance);
    expect(late).toMatchObject({ ok: true, truncated: false, undetermined: false });
    expect(late.ok && late.outcomes).toContain("flyby");
    for (const degrees of [216, 324]) {
      const r = policy.verify(at("blackhole", GRID_SPEED, degrees, 200_000), allowance);
      expect(r.ok && r.outcomes).toContain("flyby");
      expect(r.ok && r.undetermined).toBe(false);
    }
  });

  it("marks a run undetermined when its window ends mid-flight, and never credits what follows", () => {
    const r = policy.verify({ ...LATE_BLACK_HOLE, observedInvocations: 100_000 }, L.guaranteedUnitsPerRun);
    expect(r).toMatchObject({ ok: true, truncated: true, undetermined: true, cost: L.guaranteedUnitsPerRun });
    expect(r.ok && r.outcomes).toEqual(["black-hole-survival"]);
    expect(r.ok && r.verified).toMatchObject({ observedInvocations: L.guaranteedUnitsPerRun });
    expect(r.ok && r.reported).toMatchObject({ observedInvocations: 100_000 });
  });

  it("keeps an overstated observation determined when the flight ends inside the window", () => {
    // A crash after a few steps, declared as a million calls: the window
    // shows what these parameters really do.
    const r = policy.verify(at("earth", 0.5, 0, 1_000_000), L.guaranteedUnitsPerRun);
    expect(r).toMatchObject({ ok: true, truncated: true, undetermined: false, outcomes: [] });
    expect(r.ok && r.cost).toBeLessThan(L.guaranteedUnitsPerRun);
  });

  it("refuses malformed or claimed-success parameters through the RA-2 parser", () => {
    expect(policy.parse({ massKey: "earth", vx: 0.5, vy: 1.9, observedInvocations: 10, success: true })).toEqual({
      ok: false,
      issue: "malformed-parameters",
    });
    expect(policy.verify({ massKey: "pluto", vx: 0.5, vy: 1.9, observedInvocations: 10 }, 100)).toEqual({
      ok: false,
      issue: "unknown-mass",
    });
    expect(policy.verify(at("earth", 2, 75, 10), 0)).toEqual({ ok: false, issue: "verification-capacity-exhausted" });
  });

  it("is a closed table", () => {
    expect(resolveRunVerificationPolicy("gravity-wells.orbit", 2)).toBeUndefined();
    expect(resolveRunVerificationPolicy("eclipse.alignment", 1)).toBeUndefined();
  });

  it("keeps a full record of extreme runs inside the RA-2 budget, so the evaluator never stops early", () => {
    // 50 orbits each declared at 4,000,001 calls. Uncapped, the first would
    // exhaust the shared budget and the other 49 would be undetermined.
    let storedCost = 0;
    const runs = Array.from({ length: L.runSlots }, (_, i) => {
      const v = policy.verify(at("earth", 2, 70 + i * 0.2, 4_000_001), nextRunAllowance(storedCost, i));
      if (!v.ok) throw new Error(v.issue);
      expect(v.undetermined).toBe(true);
      storedCost += v.cost;
      return { validatorId: "gravity-wells.orbit", validatorVersion: 1, parameters: v.verified };
    });
    expect(storedCost).toBe(L.totalUnits);
    const parsed = parseResourceEvidence(
      {
        schemaVersion: 1,
        resourceId: GRAVITY_WELLS_RESOURCE_ID,
        assessmentRevisionId: GRAVITY_WELLS_COMPLETION_DEFINITION.assessmentRevisionId,
        definitionVersion: 1,
        authored: [],
        outcomeRuns: runs,
        attestations: [],
      },
      GRAVITY_WELLS_COMPLETION_DEFINITION,
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.verifiedRuns.some((r) => r.undetermined)).toBe(false);
  }, 60_000);
});

describe("deployment boundary", () => {
  it("is not exported from the deployed functions entry point", () => {
    const entry = readFileSync(join(__dirname, "..", "index.ts"), "utf8");
    expect(entry).not.toMatch(/resourceEvidence|resourceCompletion/);
  });

  it("production deps fail closed for every assignment and binding", async () => {
    await expect(
      UNAVAILABLE_FROZEN_COMPLETION_BINDING.frozenDefinitionVersion("any", {} as never),
    ).resolves.toBeNull();
    await expect(
      NO_PUBLISHED_COMPLETION_DEFINITIONS.publishedDefinition(
        GRAVITY_WELLS_RESOURCE_ID,
        GRAVITY_WELLS_COMPLETION_DEFINITION.assessmentRevisionId,
        1,
      ),
    ).resolves.toBeNull();
    expect(PRODUCTION_RESOURCE_EVIDENCE_DEPS.bindingSource).toBe(UNAVAILABLE_FROZEN_COMPLETION_BINDING);
    expect(PRODUCTION_RESOURCE_EVIDENCE_DEPS.definitionStore).toBe(NO_PUBLISHED_COMPLETION_DEFINITIONS);
  });

  it("no Firestore Rules block opens the evidence collection", () => {
    const rules = readFileSync(join(__dirname, "..", "..", "..", "firebase", "firestore.rules"), "utf8");
    expect(rules).not.toMatch(/resourceEvidence/);
    // The terminal default-deny is what covers it.
    expect(rules).toMatch(/match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  });
});
