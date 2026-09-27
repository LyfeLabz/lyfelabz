/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * F5.3 Slice 1 - answer-position quality standard and its shrink-only
 * legacy debt register. The repository-level test at the bottom is the same
 * check `npm run assessments:verify` runs, so `npm test` enforces it too.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const Q = require("../assessmentQuality.cjs");

const L = { A: 0, B: 1, C: 2, D: 3 };
const seq = (s) => s.split("").map((c) => L[c]);
const codes = (findings) => findings.map((f) => f.code).sort();
const evaluate = (s, k = 4) => Q.evaluateDistribution(seq(s), k);

function payloadFromSequence(s, optionCount = 4) {
  const ids = ["A", "B", "C", "D", "E"].slice(0, optionCount);
  return {
    items: s.split("").map((c, i) => ({
      itemId: `q${i + 1}`,
      options: ids.map((optionId) => ({ optionId, text: optionId })),
      correctOptionId: c,
    })),
  };
}

describe("evaluateDistribution", () => {
  test("a balanced, non-patterned quiz meets the target with no findings", () => {
    const r = evaluate("ACBDBADCAB"); // A3 B3 C2 D2, spread 1, no run > 1
    expect(r.counts).toEqual([3, 3, 2, 2]);
    expect(r.spread).toBe(1);
    expect(r.hard).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  test("unavoidable near-balance passes for item counts that do not divide evenly", () => {
    expect(evaluate("ACBDBADCAB").hard).toEqual([]); // n=10, k=4
    const fifteen = evaluate("CDABDBADCCDBCAB"); // body-systems shape, n=15
    expect(fifteen.counts).toEqual([3, 4, 4, 4]);
    expect(fifteen.hard).toEqual([]);
    const threeChoice = evaluate("ABCBCACABC", 3); // n=10, k=3 (F5.3 presentations)
    expect(threeChoice.counts).toEqual([3, 3, 4]);
    expect(threeChoice.hard).toEqual([]);
  });

  test("a position that is never correct is a hard failure", () => {
    const r = evaluate("ACBBCCABBC"); // D0
    expect(codes(r.hard)).toContain("POSITION_NEVER_CORRECT");
    expect(r.hard.find((f) => f.code === "POSITION_NEVER_CORRECT").detail).toContain("position D is never correct");
  });

  test("a quiz shorter than the option count may leave a position unused", () => {
    expect(evaluate("ACB").hard).toEqual([]);
  });

  test("excessive concentration exceeds the ceil(n/k)+1 cap and the spread limit", () => {
    const r = evaluate("BCBCBBADCB"); // B5 > cap 4
    expect(codes(r.hard)).toEqual(["POSITION_OVER_CAP", "SPREAD_TOO_WIDE"]);
    expect(r.hard[0].detail).toContain("B=5 exceeds the cap of 4");
  });

  test("a spread of exactly three fails on its own", () => {
    const r = evaluate("ABACABADBC"); // A4 B3 C2 D1: within the cap, no gap, no run
    expect(r.counts).toEqual([4, 3, 2, 1]);
    expect(codes(r.hard)).toEqual(["SPREAD_TOO_WIDE"]);
  });

  test("three identical correct positions in a row is a hard failure", () => {
    const r = evaluate("ABBBCDACDA"); // balanced-ish counts, run of 3 B
    expect(codes(r.hard)).toEqual(["RUN_TOO_LONG"]);
    expect(r.hard[0].detail).toContain("items 2-4 are all position B (3 in a row)");
    expect(evaluate("ABBCCDDACB").hard).toEqual([]); // runs of 2 are allowed
  });

  test("a spread of exactly two is a warning, not a failure", () => {
    const r = evaluate("ACBCBDCDAC"); // A2 B2 C4 D2
    expect(r.hard).toEqual([]);
    expect(codes(r.warnings)).toEqual(["SPREAD_OF_TWO"]);
  });

  test("an obvious periodic sequence is a warning even when counts are balanced", () => {
    const r = evaluate("BCADBCADBC");
    expect(r.hard).toEqual([]);
    expect(codes(r.warnings)).toEqual(["PERIODIC_PATTERN"]);
    expect(r.warnings[0].detail).toContain("period 4 (BCAD...)");
    expect(codes(evaluate("ABABABABAB").warnings)).toContain("PERIODIC_PATTERN"); // period 2
    const three = evaluate("ABCABCABCA", 3); // period 3 on a three-choice quiz
    expect(three.hard).toEqual([]);
    expect(codes(three.warnings)).toEqual(["PERIODIC_PATTERN"]);
    // Below the 80% threshold (6 of 8 period-2 comparisons) is not flagged as periodic.
    expect(codes(evaluate("ABABABABCD").warnings)).not.toContain("PERIODIC_PATTERN");
  });

  test("Earth's Layers r1 fails on every hard axis", () => {
    const r = evaluate("CBBBBABABB");
    expect(codes(r.hard)).toEqual(["POSITION_NEVER_CORRECT", "POSITION_OVER_CAP", "RUN_TOO_LONG", "SPREAD_TOO_WIDE"]);
  });
});

describe("evaluatePayload", () => {
  test("uses the correct option's displayed position in authored option order", () => {
    const payload = payloadFromSequence("ACBDBADCAB");
    // Reorder item 1's options: its correct option A now displays at position C.
    payload.items[0].options = ["B", "D", "A", "C"].map((optionId) => ({ optionId, text: optionId }));
    expect(Q.evaluatePayload(payload).sequence).toBe("CCBDBADCAB");
  });

  test("a correct option absent from the item fails closed", () => {
    const payload = payloadFromSequence("ACBDBADCAB");
    payload.items[2].correctOptionId = "Z";
    expect(codes(Q.evaluatePayload(payload).hard)).toEqual(["CORRECT_OPTION_MISSING"]);
  });

  test("a mixed option count cannot be certified and fails closed", () => {
    const payload = payloadFromSequence("ACBDBADCAB");
    payload.items[0].options.pop();
    payload.items[0].correctOptionId = "A";
    expect(codes(Q.evaluatePayload(payload).hard)).toEqual(["OPTION_COUNT_NOT_UNIFORM"]);
  });
});

describe("checkAllowlist (shrink-only legacy debt)", () => {
  const legacy = { file: "earths-layers.r1.json", result: Q.evaluatePayload(payloadFromSequence("CBBBBABABB")) };
  const entryFor = (a, overrides = {}) => ({
    payload: a.file,
    correctSequence: a.result.sequence,
    findings: codes([...a.result.hard, ...a.result.warnings]),
    reason: "legacy",
    ...overrides,
  });

  test("an allowlisted legacy violation is reported as debt, not a failure", () => {
    const out = Q.checkAllowlist([legacy], [entryFor(legacy)]);
    expect(out.failures).toEqual([]);
    expect(out.debt).toHaveLength(4);
  });

  test("a new hard violation fails", () => {
    const fresh = { file: "new-lesson.r1.json", result: Q.evaluatePayload(payloadFromSequence("BBBACDACDA")) };
    const out = Q.checkAllowlist([fresh], []);
    expect(out.failures).toEqual([expect.stringContaining("new-lesson.r1.json: RUN_TOO_LONG")]);
  });

  test("a new warning is reported but does not fail", () => {
    const fresh = { file: "new-lesson.r1.json", result: Q.evaluatePayload(payloadFromSequence("BCADBCADBC")) };
    const out = Q.checkAllowlist([fresh], []);
    expect(out.failures).toEqual([]);
    expect(out.newWarnings).toEqual([expect.stringContaining("PERIODIC_PATTERN")]);
  });

  test("allowlist growth outside the frozen baseline is refused", () => {
    const fresh = { file: "new-lesson.r1.json", result: Q.evaluatePayload(payloadFromSequence("BBBACDACDA")) };
    const out = Q.checkAllowlist([fresh], [entryFor(fresh)]);
    expect(out.failures).toEqual([expect.stringContaining("not in the frozen legacy baseline; the allowlist may only shrink")]);
  });

  test("a revision r2 or later can never be allowlisted, even inside a baseline", () => {
    const r2 = { file: "earths-layers.r2.json", result: legacy.result };
    const out = Q.checkAllowlist([r2], [entryFor(r2)], ["earths-layers.r2.json:CBBBBABABB"]);
    expect(out.failures).toEqual([expect.stringContaining("only legacy r1 payloads can be debt")]);
  });

  test("an entry whose payload sequence changed fails (deployed revisions are immutable)", () => {
    const changed = { file: legacy.file, result: Q.evaluatePayload(payloadFromSequence("ACBDBADCAB")) };
    const out = Q.checkAllowlist([changed], [entryFor(legacy)]);
    expect(out.failures).toEqual([expect.stringContaining("does not match the committed payload")]);
  });

  test("a stale entry with no remaining findings must be removed", () => {
    const clean = { file: "cell-types.r1.json", result: Q.evaluatePayload(payloadFromSequence("ACBCBDCDAC")) };
    const entry = entryFor(clean);
    const compliant = { file: clean.file, result: { ...Q.evaluatePayload(payloadFromSequence("ACBDBADCAB")), sequence: clean.result.sequence } };
    const out = Q.checkAllowlist([compliant], [entry]);
    expect(out.failures).toEqual([expect.stringContaining("stale")]);
  });

  test("findings may not be silently widened or narrowed", () => {
    const out = Q.checkAllowlist([legacy], [entryFor(legacy, { findings: ["RUN_TOO_LONG"] })]);
    expect(out.failures).toEqual([expect.stringContaining("differ from current findings")]);
  });

  test("duplicate, orphaned, and reasonless entries fail", () => {
    const dup = Q.checkAllowlist([legacy], [entryFor(legacy), entryFor(legacy)]);
    expect(dup.failures).toEqual([expect.stringContaining("duplicated")]);
    const orphan = Q.checkAllowlist([], [entryFor(legacy)]);
    expect(orphan.failures).toEqual([expect.stringContaining("names no committed payload")]);
    const noReason = Q.checkAllowlist([legacy], [entryFor(legacy, { reason: " " })]);
    expect(noReason.failures).toEqual([expect.stringContaining("non-empty reason")]);
  });

  test("the frozen baseline holds only the 14 legacy r1 payloads recorded on 2026-09-27", () => {
    expect(Q.LEGACY_DEBT_BASELINE).toHaveLength(14);
    expect(Object.isFrozen(Q.LEGACY_DEBT_BASELINE)).toBe(true);
    for (const key of Q.LEGACY_DEBT_BASELINE) expect(key).toMatch(/^[a-z0-9-]+\.r1\.json:[A-D]{10}$/);
  });
});

describe("repository", () => {
  test("committed assessments meet the standard or are recorded legacy debt", () => {
    const result = Q.verifyRepository();
    expect(result.failures).toEqual([]);
    expect(result.audit.length).toBeGreaterThanOrEqual(49);
    expect(result.newWarnings).toEqual([]);
  });

  test("the debt register matches the baseline exactly today (shrink starts here)", () => {
    const entries = Q.readAllowlist();
    expect(entries.map((e) => `${e.payload}:${e.correctSequence}`).sort()).toEqual([...Q.LEGACY_DEBT_BASELINE].sort());
  });

  test("an injected new allowlist entry is rejected by the real verifier", () => {
    const tmp = path.join(os.tmpdir(), `aq-allowlist-${process.pid}.json`);
    const doc = JSON.parse(fs.readFileSync(Q.allowlistPath(), "utf8"));
    doc.entries.push({ payload: "what-is-life.r1.json", correctSequence: "ACBDACDBAB", findings: ["PERIODIC_PATTERN"], reason: "attempted growth" });
    fs.writeFileSync(tmp, JSON.stringify(doc));
    try {
      const result = Q.verifyRepository({ allowlistFile: tmp });
      expect(result.ok).toBe(false);
      expect(result.failures.join("\n")).toContain("what-is-life.r1.json:ACBDACDBAB is not in the frozen legacy baseline");
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
