import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateCapabilityRequest, validateCapabilityResponse, validateMutationCompatibility } from "./a3Protocol";
const fixture = JSON.parse(readFileSync(resolve(__dirname, "../../../fixtures/teacher-units-a3/v1.json"), "utf8"));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const validators = {
  compatibility: validateMutationCompatibility,
  capabilityRequest: validateCapabilityRequest,
  capabilityResponse: validateCapabilityResponse,
  closedCapabilityResponse: validateCapabilityResponse,
  unverifiedCapabilityResponse: validateCapabilityResponse,
};
test("server and future client protocol remain byte-identical standalone definitions", () => {
  expect(readFileSync(resolve(__dirname, "a3Protocol.ts"), "utf8")).toBe(readFileSync(resolve(__dirname, "../../../platform/functions/src/teacherUnits/a3-protocol.ts"), "utf8"));
});
test.each(Object.keys(validators))("shared valid protocol fixture %s", name => {
  expect(validators[name as keyof typeof validators](fixture.valid[name])).toMatchObject({ ok: true, scope: "structure-only", operationalVerification: "unverified" });
});
test.each<[number, any]>(fixture.invalid.filter((c: any) => c.target in validators).map((c: any, i: number) => [i, c]))("shared invalid protocol fixture %s", (_i, c) => {
  const v = clone(fixture.valid[c.target]); let record = v;
  for (const key of c.path.slice(0, -1)) record = record[key];
  record[c.path.at(-1)] = c.value;
  expect(validators[c.target as keyof typeof validators](v).ok).toBe(false);
});
test("strict nested parsing rejects extra and missing metadata without fallback", () => {
  const v = clone(fixture.valid.capabilityResponse);
  v.teacherUnits.availability.extra = true; expect(validateCapabilityResponse(v).ok).toBe(false);
  delete v.teacherUnits.availability.extra; delete v.caller.schoolId; expect(validateCapabilityResponse(v).ok).toBe(false);
  expect(validateMutationCompatibility(undefined).ok).toBe(false);
  expect(validateCapabilityRequest({ ...fixture.valid.capabilityRequest, schemaVersion: 1 }).ok).toBe(false);
  expect(validateMutationCompatibility({ ...fixture.valid.compatibility, policyInstanceId: fixture.valid.compatibility.policyInstanceId.toUpperCase() }).ok).toBe(false);
});
test("an enabled capability declaration is still unverified operationally", () => {
  const r = validateCapabilityResponse(fixture.valid.capabilityResponse);
  expect(r.operationalVerification).toBe("unverified");
  if (r.ok) {
    // @ts-expect-error A parsed protocol declaration cannot grant authorization.
    expect(r.authorized).toBeUndefined();
  }
});
test("emulator declarations require explicit expected identity", () => {
  const v = clone(fixture.valid.unverifiedCapabilityResponse);
  v.backend.environment = "emulator"; v.backend.projectId = "demo-a3-test";
  expect(validateCapabilityResponse(v).ok).toBe(false);
  expect(validateCapabilityResponse(v, "demo-a3-test").ok).toBe(true);
  expect(validateCapabilityResponse(v, "different-test-project").ok).toBe(false);
});
test("Unicode, sparse arrays and nested accessor input are rejected", () => {
  expect(validateCapabilityRequest({ ...fixture.valid.capabilityRequest, nonce: "\ud800" }).ok).toBe(false);
  const v = clone(fixture.valid.capabilityResponse); v.teacherUnits.supportedOperations = Array(8);
  expect(validateCapabilityResponse(v).ok).toBe(false);
  const getter = jest.fn(() => "teacher");
  Object.defineProperty(v.caller, "role", { enumerable: true, get: getter });
  expect(validateCapabilityResponse(v).ok).toBe(false); expect(getter).not.toHaveBeenCalled();
});
