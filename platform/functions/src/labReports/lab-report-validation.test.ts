import {
  MAX_REPORT_BYTES,
  isBlankLabReport,
  normalizeLabReport,
  serializeLabReport,
} from "./lab-report-validation";

const base = () => ({
  version: 1,
  checkSchema: 2,
  responses: { labTitle: "Ramp test", hypothesis: "If ... then ..." },
  checks: { "hypothesis:prediction": true },
  quantitativeTable: { title: "Trials", cells: [["Trial", "Time (s)"], ["1", "2.4"]] },
  activeSection: "data",
  settings: { large: true },
});

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

describe("normalizeLabReport", () => {
  it("accepts the browser tool's saved report shape", () => {
    expect(normalizeLabReport(base())).toEqual(base());
  });

  it("produces a canonical key order so equal reports serialize identically", () => {
    const a = normalizeLabReport({ ...base(), responses: { b: "2", a: "1" } });
    const b = normalizeLabReport({ ...base(), responses: { a: "1", b: "2" } });
    expect(serializeLabReport(a).json).toBe(serializeLabReport(b).json);
  });

  it.each([
    ["non-object", "nope"],
    ["unknown top-level key", { ...base(), studentId: "x" }],
    ["unsupported check schema", { ...base(), checkSchema: 1 }],
    ["non-string response", { ...base(), responses: { claim: 4 } }],
    ["invalid response key", { ...base(), responses: { "__proto__x": "a" } }],
    ["overlong response", { ...base(), responses: { claim: "a".repeat(20_001) } }],
    ["invalid check key", { ...base(), checks: { "a b": true } }],
    ["non-boolean check", { ...base(), checks: { "a:b": "yes" } }],
    ["ragged table", { ...base(), quantitativeTable: { title: "", cells: [["a", "b"], ["c"]] } }],
    ["too many rows", { ...base(), quantitativeTable: { title: "", cells: Array.from({ length: 11 }, () => ["a", "b"]) } }],
    ["too few columns", { ...base(), quantitativeTable: { title: "", cells: [["a"], ["b"]] } }],
    ["table extra key", { ...base(), quantitativeTable: { title: "", cells: [["a", "b"], ["c", "d"]], x: 1 } }],
    ["invalid section", { ...base(), activeSection: "<script>" }],
    ["non-boolean setting", { ...base(), settings: { large: 1 } }],
  ])("refuses %s", (_label, raw) => {
    expect(codeOf(() => normalizeLabReport(raw))).toBe("labReports.invalidReport");
  });

  it("refuses an unsupported report version with a distinct code", () => {
    expect(codeOf(() => normalizeLabReport({ ...base(), version: 2 }))).toBe("labReports.unsupportedVersion");
  });

  it("never echoes student text in an error message", () => {
    try {
      normalizeLabReport({ ...base(), responses: { claim: 42, hypothesis: "SECRET STUDENT TEXT" } });
    } catch (err) {
      expect(String((err as Error).message)).not.toContain("SECRET");
    }
  });
});

describe("serializeLabReport", () => {
  it("refuses a report over the size limit", () => {
    const responses: Record<string, string> = {};
    for (let i = 0; i < 20; i++) responses[`field${i}`] = "x".repeat(15_000);
    const report = normalizeLabReport({ ...base(), responses });
    expect(codeOf(() => serializeLabReport(report))).toBe("labReports.reportTooLarge");
    expect(MAX_REPORT_BYTES).toBe(256 * 1024);
  });
});

describe("isBlankLabReport", () => {
  it("treats whitespace, checks, settings, and an empty table as blank", () => {
    expect(isBlankLabReport(normalizeLabReport({
      version: 1, checkSchema: 2, responses: { claim: "  \n" }, checks: { "a:b": true },
      quantitativeTable: { title: " ", cells: [["", ""], ["", ""]] }, activeSection: "review", settings: { large: true },
    }))).toBe(true);
  });

  it("treats any response or table content as student work", () => {
    expect(isBlankLabReport(normalizeLabReport({ ...base(), quantitativeTable: null, responses: { claim: "x" } }))).toBe(false);
    expect(isBlankLabReport(normalizeLabReport({ ...base(), responses: {}, quantitativeTable: { title: "", cells: [["", "x"], ["", ""]] } }))).toBe(false);
  });
});
