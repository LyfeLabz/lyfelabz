import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateCapabilityRequest, validateCapabilityResponse, validateMutationCompatibility } from "./availability-protocol";
import * as legacy from "./a3-protocol";
const synthetic = jest.requireActual("../../../../scripts/teacher-units-release/fixtures/synthetic-option-b.cjs");
const fixture = synthetic.protocolFixture();
const historical = JSON.parse(readFileSync(resolve(__dirname, "../../../../fixtures/teacher-units-a3/v1.json"), "utf8"));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const validators = { compatibility: validateMutationCompatibility, capabilityRequest: validateCapabilityRequest,
  capabilityResponse: validateCapabilityResponse };
const parse = validateCapabilityResponse;
function change(path: string[], value: unknown): any {
  const r = clone(fixture.capabilityResponse); let cursor = r;
  for (const key of path.slice(0, -1)) cursor = cursor[key];
  cursor[path[path.length - 1]] = value; return r;
}
test("server/browser active protocol is standalone and byte-identical", () => {
  expect(readFileSync(resolve(__dirname, "availability-protocol.ts"), "utf8")).toBe(
    readFileSync(resolve(__dirname, "../../../../app/src/teacherUnits/availabilityProtocol.ts"), "utf8"));
});
test.each(Object.keys(validators))("synthetic active %s validates without authority", name => {
  const result = validators[name as keyof typeof validators](fixture[name]);
  expect(result).toMatchObject({ ok: true, scope: "structure-only", operationalVerification: "unverified" });
  expect(result).not.toHaveProperty("authorized"); expect(fixture.provenance).toContain("synthetic");
});
test.each(Object.keys(validators))("historical %s is not an active fallback", name => {
  expect(validators[name as keyof typeof validators](historical.valid[name]).ok).toBe(false);
  const old = { compatibility: legacy.validateMutationCompatibility, capabilityRequest: legacy.validateCapabilityRequest,
    capabilityResponse: legacy.validateCapabilityResponse };
  expect(old[name as keyof typeof old](historical.valid[name]).ok).toBe(true);
  expect(old[name as keyof typeof old](fixture[name]).ok).toBe(false);
});
test.each([
  [["schemaVersion"], 2], [["schemaVersion"], 4], [["backend", "backendBuildId"], "A".repeat(64)],
  [["backend", "enforcementVersion"], "teacher-units-a3-v1"], [["backend", "region"], "us-east1"],
  [["backend", "projectId"], "lyfelabz-prod"], [["teacherUnits", "apiContractVersion"], "teacher-units-v2"],
  [["teacherUnits", "supportedClientContractVersions"], ["teacher-units-v3", "teacher-units-v2"]],
  [["teacherUnits", "acceptedClientContractVersions"], []], [["teacherUnits", "placementFingerprint"], "bad"],
  [["teacherUnits", "supportedOperations"], ["create"]],
  [["teacherUnits", "availability", "backendReleaseId"], "c".repeat(64)],
  [["teacherUnits", "availability", "deploymentEligible"], false],
  [["teacherUnits", "availability", "policyGeneration"], null],
  [["teacherUnits", "availability", "policyGeneration"], Number.MAX_SAFE_INTEGER + 1],
  [["teacherUnits", "availability", "policyGeneration"], -0], [["caller", "role"], "student"],
  [["caller", "schoolId"], ""], [["nonce"], "short"], [["extra"], true],
] as [string[], unknown][])("contradictory/malformed response %# refuses", (path, value) => {
  expect(parse(change(path, value)).ok).toBe(false);
});
test("every nested response field is required, unknown fields refuse recursively", () => {
  for (const path of [[], ["backend"], ["teacherUnits"], ["teacherUnits", "availability"], ["caller"]]) {
    let container = fixture.capabilityResponse;
    for (const key of path) container = container[key];
    for (const key of Object.keys(container)) {
      const r = clone(fixture.capabilityResponse); let c = r;
      for (const part of path) c = c[part]; delete c[key]; expect(parse(r).ok).toBe(false);
    }
    expect(parse(change([...path, "unknown"], true)).ok).toBe(false);
  }
});
test("closed/unprepared and missing/ineligible declarations retain exact identity consistency", () => {
  const r = clone(fixture.capabilityResponse); const a = r.teacherUnits.availability;
  r.teacherUnits.acceptedClientContractVersions = [];
  a.state = "closed"; a.backendReleaseId = null; a.deploymentEligible = false; expect(parse(r).ok).toBe(true);
  a.state = "unverified"; expect(parse(r).ok).toBe(true); // known closed/unprepared instance, ineligible runtime
  a.policyInstanceId = null; a.policyGeneration = null; expect(parse(r).ok).toBe(true);
  a.backendReleaseId = "a".repeat(64); expect(parse(r).ok).toBe(false);
  a.backendReleaseId = null; a.deploymentEligible = true; expect(parse(r).ok).toBe(false);
  a.state = "closed"; a.deploymentEligible = false; expect(parse(r).ok).toBe(false);
});
test("enabled MAX remains a valid declaration; exact contract and six-field envelope", () => {
  expect(parse(change(["teacherUnits", "availability", "policyGeneration"], Number.MAX_SAFE_INTEGER)).ok).toBe(true);
  for (const patch of [{ schemaVersion: 1 }, { schemaVersion: 3 }, { clientContractVersion: "teacher-units-v2" },
    { backendReleaseId: null }, { placementFingerprint: "B".repeat(64) }, { ownerUid: "teacher" }])
    expect(validateMutationCompatibility({ ...fixture.compatibility, ...patch }).ok).toBe(false);
  for (const key of Object.keys(fixture.compatibility)) {
    const v = clone(fixture.compatibility); delete v[key]; expect(validateMutationCompatibility(v).ok).toBe(false);
  }
  for (const v of [null, undefined, [], { ...fixture.capabilityRequest, schemaVersion: 2 },
    { ...fixture.capabilityRequest, clientContractVersion: "teacher-units-v2" }, { ...fixture.capabilityRequest, extra: true }])
    expect(validateCapabilityRequest(v).ok).toBe(false);
});
test("emulator identity requires explicit matching demo target", () => {
  const r = clone(fixture.capabilityResponse); r.backend.environment = "emulator"; r.backend.projectId = "demo-b1b";
  expect(parse(r).ok).toBe(false); expect(parse(r, "demo-b1b").ok).toBe(true);
  expect(parse(r, "demo-other").ok).toBe(false);
  r.backend.projectId = "lyfelabz-prod"; expect(parse(r, "lyfelabz-prod").ok).toBe(false);
});
test("input snapshots are detached, immutable and reject getters, symbols, holes, classes and malformed Unicode", () => {
  const r = clone(fixture.capabilityResponse); const result = parse(r);
  r.backend.backendBuildId = "c".repeat(64);
  if (!result.ok) throw new Error("unexpected fixture failure");
  expect(result.value.backend.backendBuildId).toBe("a".repeat(64)); expect(Object.isFrozen(result.value.backend)).toBe(true);
  const getter = jest.fn(() => "teacher"); const g = clone(fixture.capabilityResponse);
  Object.defineProperty(g.caller, "role", { enumerable: true, get: getter }); expect(parse(g).ok).toBe(false); expect(getter).not.toHaveBeenCalled();
  const hidden = clone(fixture.capabilityResponse); Object.defineProperty(hidden.caller, "secret", { value: true });
  const symbol = clone(fixture.capabilityResponse); symbol.caller[Symbol("secret")] = true;
  for (const v of [hidden, symbol, change(["teacherUnits", "supportedOperations"], Array(8)),
    change(["caller", "uid"], "\ud800"), change(["caller"], new Date()), new Date()]) expect(parse(v).ok).toBe(false);
  const cycle = clone(fixture.capabilityResponse); cycle.extra = cycle; expect(parse(cycle).ok).toBe(false);
});
