import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { parseStrictJSON } from "./a3-canonical";
import { AVAILABILITY_POLICY_PATH, evaluateAvailabilityEligibility, validateAvailabilityPolicy,
  validateAvailabilityTransition } from "./availability-policy";
import type { AvailabilityTransition, AvailabilityTransitionInput } from "./availability-policy";

const fixture = parseStrictJSON(readFileSync(resolve(__dirname,
  "../../../../fixtures/teacher-units-option-b/v1.json"), "utf8")) as any;
const target = fixture.target;
const timeFields = ["createdAt", "updatedAt", "lastEnabledAt", "lastClosedAt"];
function clone<T>(v: T): T {
  if (v instanceof Timestamp) return new Timestamp(v.seconds, v.nanoseconds) as T;
  if (Array.isArray(v)) return v.map((item: unknown) => clone(item)) as T;
  if (v !== null && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([key, item]) => [key, clone(item)])) as T;
  return v;
}
function policy(name = "closed"): any {
  const p = clone(fixture.policies[name]);
  for (const key of timeFields) if (p[key] !== null) p[key] = new Timestamp(p[key].seconds, p[key].nanoseconds);
  return p;
}
function edit(value: any, path: string[], replacement: unknown): any {
  const result = clone(value); let cursor = result;
  for (const key of path.slice(0, -1)) cursor = cursor[key];
  cursor[path[path.length - 1]] = replacement;
  return result;
}
function input(transition: AvailabilityTransition, previous: any, next: any): any {
  return { transition, previous, observedUpdateTime: previous?.updatedAt ?? null,
    expected: { updateTime: previous?.updatedAt ?? null, policyInstanceId: previous?.policyInstanceId ?? null,
      generation: previous?.generation ?? null }, next, recoveryAuthorization: null };
}
function recovery(previous = policy("enabledMax")): any {
  const next = policy("recovered"); const r = input("recoverClosed", previous, next);
  r.recoveryAuthorization = { action: "recoverClosed", decisionRef: next.approvalRef, target: clone(target),
    expected: clone(r.expected), replacementPolicyInstanceId: next.policyInstanceId,
    placementFingerprint: next.placementFingerprint, operator: clone(next.updatedBy), reason: next.reason };
  return r;
}
const parse = (v: unknown) => validateAvailabilityPolicy(v, target);
const transition = (v: unknown) => validateAvailabilityTransition(v, target);
const eligible = (v: unknown, runtime: unknown = fixture.runtime) => evaluateAvailabilityEligibility(v, runtime);
function unpersisted(result: ReturnType<typeof transition>): void {
  expect(result).toMatchObject({ persistence: "not-performed", shutdownConfirmed: false,
    scope: "structure-only", operationalVerification: "unverified" });
}

describe("strict B1a policy schema and fixture codec", () => {
  test("fixture version, exact policy fields and explicit timestamp codec", () => {
    expect(fixture.schemaVersion).toBe(1); expect(fixture.description).toContain("Synthetic");
    expect(fixture.timestampCodec).toContain("rejected");
    expect(AVAILABILITY_POLICY_PATH).toBe("platformConfig/teacherUnitsAvailability");
    expect(Object.keys(fixture.policies.closed).sort()).toEqual([
      "schemaVersion", "enforcementVersion", "policyInstanceId", "environment", "projectId", "projectNumber", "region",
      "databaseId", "generation", "mode", "approvedBackendBuildId", "acceptedClientContractVersions", "placementFingerprint",
      "createdAt", "updatedAt", "updatedBy", "transitionId", "reason", "approvalRef", "lastEnabledAt", "lastClosedAt",
    ].sort());
    for (const raw of Object.values(fixture.policies)) expect(parse(raw).ok).toBe(false);
  });
  test.each(Object.keys(fixture.policies))("valid hydrated %s policy", name => {
    expect(parse(policy(name))).toMatchObject({ ok: true, scope: "structure-only", operationalVerification: "unverified" });
  });
  test.each((fixture.invalidPolicies as any[]).map((v: any, i: number) => [i, v] as [number, any]))("invalid fixture %s", (_i, v) => {
    expect(parse(edit(policy(v.base), v.path, v.value)).ok).toBe(false);
  });
  test.each([undefined, null, true, 1, "closed", [], new Date(), Object.create({}) as object])(
    "missing/invalid policy type %#", raw => expect(parse(raw).ok).toBe(false));
  test("all policy and operator fields are required; unknown legacy/override fields refuse", () => {
    const p = policy("enabled");
    for (const key of Object.keys(p)) {
      const missing = clone(p); delete missing[key]; expect(parse(missing).ok).toBe(false);
    }
    for (const key of Object.keys(p.updatedBy)) {
      const missing = clone(p); delete missing.updatedBy[key]; expect(parse(missing).ok).toBe(false);
    }
    expect(parse({ ...p, enabled: true }).ok).toBe(false);
    expect(parse({ ...p, activationEvidenceRef: "legacy-marker" }).ok).toBe(false);
    expect(parse({ ...p, updatedBy: { ...p.updatedBy, authenticated: true } }).ok).toBe(false);
  });
  test.each([0, -0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null])(
    "invalid generation %#", value => expect(parse({ ...policy(), generation: value }).ok).toBe(false));
  test.each([
    ["schemaVersion", "2"], ["enforcementVersion", "teacher-units-a3-v1"], ["mode", "disabled"],
    ["policyInstanceId", "not-a-uuid"], ["transitionId", "00000000-0000-1000-8000-000000000010"],
    ["approvedBackendBuildId", "A".repeat(64)], ["approvedBackendBuildId", "short"],
    ["placementFingerprint", "b".repeat(63)], ["placementFingerprint", false],
    ["acceptedClientContractVersions", ["teacher-units-v2"]],
    ["acceptedClientContractVersions", ["teacher-units-v3", "teacher-units-v3"]],
    ["acceptedClientContractVersions", []], ["approvedBackendBuildId", null], ["approvalRef", null], ["lastEnabledAt", null],
    ["reason", ""], ["reason", "\nreason"], ["reason", " padded "], ["reason", "r".repeat(1001)],
    ["approvalRef", "a".repeat(257)], ["approvalRef", "\uD800"],
  ])("invalid enabled %s case %#", (key, value) => {
    expect(parse({ ...policy("enabled"), [key]: value }).ok).toBe(false);
  });
  test.each([
    ["principalSubject", ""], ["credentialSubject", " "], ["principalSubject", 17], ["principalSubject", "x".repeat(257)],
    ["credentialSubject", "x\u0000y"], ["delegationSubject", ""], ["delegationSubject", false], ["delegationSubject", "\uDFFF"],
  ])("invalid operator %s case %#", (key, value) => {
    const p = policy(); p.updatedBy[key] = value; expect(parse(p).ok).toBe(false);
  });
  test("Unicode limits count code points; valid delegation is explicit metadata only", () => {
    const p = policy(); p.reason = "🌱".repeat(1000); p.updatedBy.delegationSubject = "delegator@example.test";
    expect(parse(p).ok).toBe(true); p.reason += "🌱"; expect(parse(p).ok).toBe(false);
  });
  test.each([
    ["environment", "unknown"], ["environment", "production"], ["projectId", "other-project"],
    ["projectNumber", 293337283840], ["projectNumber", "182791689935"], ["region", "europe-west1"], ["databaseId", "named"],
  ])("invalid environment/target %s", (key, value) => expect(parse({ ...policy(), [key]: value }).ok).toBe(false));
  test("explicit exact target required; cloud pins and explicit demo-only emulator target", () => {
    expect(validateAvailabilityPolicy(policy(), undefined).ok).toBe(false);
    expect(validateAvailabilityPolicy(policy(), { ...target, extra: true }).ok).toBe(false);
    for (const name of ["productionTarget", "emulatorTarget"]) {
      expect(validateAvailabilityPolicy({ ...policy(), ...fixture[name] }, fixture[name]).ok).toBe(true);
      expect(parse({ ...policy(), ...fixture[name] }).ok).toBe(false);
    }
    const wrong = { ...fixture.emulatorTarget, projectId: "lyfelabz-prod" };
    expect(validateAvailabilityPolicy({ ...policy(), ...wrong }, wrong).ok).toBe(false);
  });
  test.each([new Date(), { seconds: 1792886400, nanoseconds: 123456789 }, FieldValue.serverTimestamp(), null])(
    "JSON/unresolved/non-SDK timestamp %#", value => expect(parse({ ...policy(), updatedAt: value }).ok).toBe(false));
  test("chronology retains nanosecond precision and has no wall-clock lease", () => {
    const p = policy("enabled");
    expect(parse({ ...p, createdAt: new Timestamp(p.updatedAt.seconds, p.updatedAt.nanoseconds + 1) }).ok).toBe(false);
    expect(parse({ ...p, lastEnabledAt: new Timestamp(p.updatedAt.seconds, p.updatedAt.nanoseconds - 1) }).ok).toBe(false);
    expect(parse({ ...p, lastClosedAt: p.lastEnabledAt }).ok).toBe(false);
    expect(parse({ ...policy(), lastClosedAt: new Timestamp(0, 0) }).ok).toBe(false);
    expect(parse(policy("enabled")).ok).toBe(true);
  });
  test("getters, hidden/symbol fields, sparse/custom arrays, class timestamps and cycles refuse", () => {
    const base = policy(); const getter = jest.fn(() => "closed");
    const accessor = Object.defineProperty(clone(base), "mode", { enumerable: true, get: getter });
    expect(parse(accessor).ok).toBe(false); expect(getter).not.toHaveBeenCalled();
    expect(parse(Object.defineProperty(clone(base), "hidden", { value: true })).ok).toBe(false);
    expect(parse({ ...base, [Symbol("hidden")]: true }).ok).toBe(false);
    expect(parse({ ...base, acceptedClientContractVersions: new Array(1) as unknown[] }).ok).toBe(false);
    expect(parse({ ...base, acceptedClientContractVersions: Object.assign([], { extra: true }) }).ok).toBe(false);
    class CustomTimestamp extends Timestamp {}
    expect(parse({ ...base, updatedAt: new CustomTimestamp(0, 0) }).ok).toBe(false);
    const cycle: any = {}; cycle.self = cycle;
    expect(parse({ ...base, updatedBy: cycle }).ok).toBe(false);
  });
  test("successful snapshot is detached/frozen, including timestamps, operator and versions", () => {
    const p = policy("enabled"); const result = parse(p);
    if (!result.ok) throw new Error("valid fixture refused");
    p.mode = "closed"; p.updatedBy.principalSubject = "changed"; p.acceptedClientContractVersions.length = 0; p.updatedAt._seconds = 0;
    expect(result.value.mode).toBe("enabled"); expect(result.value.updatedBy.principalSubject).toBe("operator@example.test");
    expect(result.value.acceptedClientContractVersions).toEqual(["teacher-units-v3"]);
    expect(result.value.updatedAt.seconds).toBe(1792886402);
    for (const v of [result.value, result.value.updatedBy, result.value.acceptedClientContractVersions, result.value.updatedAt])
      expect(Object.isFrozen(v)).toBe(true);
  });
  test("stateful Proxy get trap cannot change the validated snapshot", () => {
    const getter = jest.fn(() => "enabled");
    const p = new Proxy(policy(), { get: (v, key) => key === "mode" ? getter() : Reflect.get(v, key) });
    expect(parse(p)).toMatchObject({ ok: true, value: { mode: "closed" } }); expect(getter).not.toHaveBeenCalled();
  });
});

describe("closed-by-default supplied-input eligibility", () => {
  test.each([undefined, null])("missing policy %# denies", p => expect(eligible(p)).toMatchObject({ eligible: false, reason: "policyMissing" }));
  test("valid enabled MAX remains enabled; no provider or human authority is claimed", () => {
    expect(eligible(policy("enabledMax"))).toEqual({ eligible: true, reason: "matchedSuppliedInputs",
      scope: "supplied-inputs-only", operationalVerification: "unverified" });
  });
  test("invalid policy, closed state and prepared build without enable deny", () => {
    expect(eligible({ ...policy(), extra: true }).eligible).toBe(false);
    expect(eligible(policy()).eligible).toBe(false); expect(eligible(policy("prepared")).eligible).toBe(false);
    expect(parse({ ...policy(), acceptedClientContractVersions: ["teacher-units-v3"] }).ok).toBe(false);
  });
  test.each([
    ["identityCurrent", false], ["deploymentMode", "closed-only"], ["sourceDirty", true],
    ["backendBuildId", "c".repeat(64)], ["placementFingerprint", "c".repeat(64)],
    ["clientContractVersion", "teacher-units-v2"], ["backendBuildId", undefined],
  ])("runtime %s mismatch %# denies", (key, value) => {
    expect(eligible(policy("enabled"), { ...fixture.runtime, [key]: value }).eligible).toBe(false);
  });
  test("missing/wrong target/extra override runtime fields cannot authorize", () => {
    expect(evaluateAvailabilityEligibility(policy("enabled"), undefined).eligible).toBe(false);
    expect(eligible(policy("enabled"), { ...fixture.runtime, identity: fixture.productionTarget }).eligible).toBe(false);
    expect(eligible(policy("enabled"), { ...fixture.runtime, allow: true }).eligible).toBe(false);
  });
});

describe("pure transitions and compare-and-set", () => {
  test.each((fixture.validTransitions as any[]).map((v: any, i: number) => [i, v] as [number, any]))("valid fixture transition %s", (_i, v) => {
    const request = input(v.transition, v.previous === null ? null : policy(v.previous), policy(v.next)); const original = clone(request);
    const result = transition(request);
    expect(result).toMatchObject({ ok: true, value: { transition: v.transition, kind: v.kind } });
    unpersisted(result); expect(request).toEqual(original);
  });
  test.each(["updateTime", "policyInstanceId", "generation"])("stale CAS %s refuses", key => {
    const r = input("close", policy("enabled"), policy("closedAfterEnable"));
    r.expected[key] = key === "updateTime" ? new Timestamp(0, 0) : key === "generation" ? 2 : policy("recovered").policyInstanceId;
    const result = transition(r);
    expect(result).toMatchObject({ ok: false, observedPolicyMode: "enabled", issue: { reason: "stale compare-and-set preconditions" } });
    unpersisted(result); expect(result).not.toHaveProperty("value");
  });
  test.each(["transition", "previous", "observedUpdateTime", "expected", "next", "recoveryAuthorization"])(
    "missing transition input %s refuses", key => {
      const r = input("close", policy("enabled"), policy("closedAfterEnable")); delete r[key]; expect(transition(r).ok).toBe(false);
    });
  test("unknown fields, absent/invalid policy and mismatched snapshot metadata refuse ordinary close", () => {
    const r = input("close", policy("enabled"), policy("closedAfterEnable"));
    expect(transition({ ...r, execute: true }).ok).toBe(false);
    expect(transition({ ...r, expected: { ...r.expected, force: true } }).ok).toBe(false);
    expect(transition(input("close", null, policy())).ok).toBe(false);
    const invalid = input("close", { ...policy("enabled"), schemaVersion: 1 }, policy("closedAfterEnable"));
    invalid.expected.policyInstanceId = null; invalid.expected.generation = null;
    expect(transition(invalid)).toMatchObject({ ok: false, observedPolicyMode: "invalid" });
    r.observedUpdateTime = new Timestamp(1792886402, 123456790); expect(transition(r).ok).toBe(false);
    r.expected.updateTime = r.observedUpdateTime; expect(transition(r).ok).toBe(true);
    r.observedUpdateTime = null; r.expected.updateTime = null; expect(transition(r).ok).toBe(false);
    const init = input("initialize", null, policy()); init.observedUpdateTime = new Timestamp(0, 0);
    expect(transition(init).ok).toBe(false);
  });
  test.each(["policyInstanceId", "projectId", "projectNumber", "environment", "region", "databaseId", "createdAt"])(
    "ordinary close cannot change immutable %s", key => {
      const r = input("close", policy("enabled"), policy("closedAfterEnable"));
      r.next[key] = key === "policyInstanceId" ? policy("recovered").policyInstanceId : key === "createdAt" ? new Timestamp(0, 0) : "wrong";
      expect(transition(r).ok).toBe(false);
    });
  test.each([
    ["generation", 3], ["generation", 5], ["transitionId", policy("enabled").transitionId],
    ["updatedAt", policy("enabled").updatedAt], ["placementFingerprint", "c".repeat(64)],
    ["approvedBackendBuildId", "c".repeat(64)], ["lastEnabledAt", null],
  ])("ordinary close rejects invalid %s case %#", (key, value) => {
    const r = input("close", policy("enabled"), policy("closedAfterEnable")); r.next[key] = value;
    expect(transition(r).ok).toBe(false);
  });
  test("close may clear build; only closed preparation may change build/placement", () => {
    expect(transition(input("close", policy("enabled"), { ...policy("closedAfterEnable"), approvedBackendBuildId: null })).ok).toBe(true);
    expect(transition(input("prepare", policy("enabled"), policy("closedAfterEnable"))).ok).toBe(false);
    expect(transition(input("prepare", policy(), { ...policy("prepared"), placementFingerprint: "c".repeat(64) })).ok).toBe(true);
  });
  test("enable needs closed prepared state, unchanged selected build/placement and lastClosedAt", () => {
    expect(transition(input("enable", policy(), policy("enabled"))).ok).toBe(false);
    expect(transition(input("enable", policy("enabled"), policy("enabled"))).ok).toBe(false);
    for (const key of ["approvedBackendBuildId", "placementFingerprint", "lastClosedAt"]) {
      const next = policy("enabled"); next[key] = key === "lastClosedAt" ? new Timestamp(1792886401, 0) : "c".repeat(64);
      expect(transition(input("enable", policy("prepared"), next)).ok).toBe(false);
    }
  });
  test("no-op leaves all content unchanged and returns a detached proposal", () => {
    for (const action of ["prepare", "close"] as const) {
      const p = policy("prepared");
      for (const change of [{ generation: 3 }, { reason: "different" }, { updatedBy: { ...p.updatedBy, principalSubject: "other" } }])
        expect(transition(input(action, p, { ...p, ...change })).ok).toBe(false);
      const result = transition(input(action, p, clone(p)));
      expect(result).toMatchObject({ ok: true, observedPolicyMode: "closed", value: { kind: "noop" } });
      unpersisted(result); if (result.ok) expect(result.value.nextPolicy).not.toBe(p);
    }
  });
  test("initialization cannot overwrite or introduce an enabled/preselected instance", () => {
    expect(transition(input("initialize", policy(), policy())).ok).toBe(false);
    for (const next of [policy("prepared"), policy("enabled"), { ...policy(), generation: 2 },
      { ...policy(), lastClosedAt: new Timestamp(1792886401, 0) }]) expect(transition(input("initialize", null, next)).ok).toBe(false);
  });
  test("exhausted ordinary close truthfully stays enabled, even with unsafe proposed next generation", () => {
    const previous = policy("enabledMax"); const original = clone(previous);
    const result = transition(input("close", previous, { ...policy("closedAfterEnable"), generation: Number.MAX_SAFE_INTEGER + 1 }));
    expect(result).toMatchObject({ ok: false, observedPolicyMode: "enabled", recoveryRequired: true,
      issue: { reason: "still enabled; recovery required" } });
    unpersisted(result); expect(result).not.toHaveProperty("value");
    expect(previous).toEqual(original); expect(eligible(previous).eligible).toBe(true);
  });
  test("closed MAX permits close no-op but blocks prepare/enable, even unchanged prepare", () => {
    const p = policy("closedMax");
    expect(transition(input("close", p, clone(p)))).toMatchObject({ ok: true, value: { kind: "noop" } });
    for (const action of ["prepare", "enable"] as const)
      expect(transition(input(action, p, clone(p)))).toMatchObject({ ok: false, observedPolicyMode: "closed", recoveryRequired: true });
  });
});

describe("explicit closed-instance repair, never a persistence claim", () => {
  test("exact repair proposal leaves enabled input eligible and reports no successful shutdown", () => {
    const r = recovery(); const original = clone(r); const result = transition(r);
    expect(result).toMatchObject({ ok: true, observedPolicyMode: "enabled", value: { transition: "recoverClosed", kind: "change",
      nextPolicy: { mode: "closed", generation: 1, approvedBackendBuildId: null, acceptedClientContractVersions: [], lastEnabledAt: null } } });
    unpersisted(result); expect(r).toEqual(original); expect(eligible(r.previous).eligible).toBe(true);
    expect(result).not.toHaveProperty("committed"); expect(result).not.toHaveProperty("auditEventId");
  });
  test("missing authorization, boolean override and authorized=true fallback refuse", () => {
    for (const auth of [null, true, false, {}, { ...recovery().recoveryAuthorization, authorized: true }]) {
      const result = transition({ ...recovery(), recoveryAuthorization: auth }); expect(result.ok).toBe(false); unpersisted(result);
    }
  });
  test.each(["action", "decisionRef", "target", "expected", "replacementPolicyInstanceId", "placementFingerprint", "operator", "reason"])(
    "missing recovery decision %s refuses", key => {
      const r = recovery(); delete r.recoveryAuthorization[key]; expect(transition(r).ok).toBe(false);
    });
  test.each([
    ["decisionRef", "wrong"], ["target", fixture.productionTarget], ["expected", { updateTime: null, policyInstanceId: null, generation: null }],
    ["replacementPolicyInstanceId", policy().policyInstanceId], ["placementFingerprint", "c".repeat(64)],
    ["operator", { principalSubject: "other", credentialSubject: "other", delegationSubject: null }], ["reason", "other"],
  ])("mismatched recovery decision %s refuses", (key, value) => {
    const r = recovery(); r.recoveryAuthorization[key] = value; expect(transition(r).ok).toBe(false);
  });
  test("repair cannot reuse old instance, transition, activation approval or timestamp", () => {
    for (const mutate of [
      (r: any) => { r.next.policyInstanceId = r.previous.policyInstanceId; r.recoveryAuthorization.replacementPolicyInstanceId = r.next.policyInstanceId; },
      (r: any) => { r.next.transitionId = r.previous.transitionId; },
      (r: any) => { r.next.approvalRef = r.previous.approvalRef; r.recoveryAuthorization.decisionRef = r.next.approvalRef; },
      (r: any) => { for (const key of ["createdAt", "updatedAt", "lastClosedAt"]) r.next[key] = r.previous.updatedAt; },
    ]) { const r = recovery(); mutate(r); expect(transition(r).ok).toBe(false); }
  });
  test("recovery never enables, retains build or resets an ordinary transition; missing doc uses initialize", () => {
    for (const change of [{ mode: "enabled", approvedBackendBuildId: "a".repeat(64), acceptedClientContractVersions: ["teacher-units-v3"] },
      { approvedBackendBuildId: "a".repeat(64) }, { generation: 2 }, { lastEnabledAt: policy("enabled").lastEnabledAt }])
      expect(transition({ ...recovery(), next: { ...policy("recovered"), ...change } }).ok).toBe(false);
    const r = recovery(); r.transition = "close"; expect(transition(r).ok).toBe(false);
    expect(transition(recovery(null)).ok).toBe(false);
  });
  test("legacy/malformed prior record requires exact updateTime and explicit repair", () => {
    const r = recovery({ ...policy("enabled"), schemaVersion: 1, legacy: true });
    r.expected.policyInstanceId = null; r.expected.generation = null; r.recoveryAuthorization.expected = clone(r.expected);
    expect(transition(r)).toMatchObject({ ok: true, observedPolicyMode: "invalid" });
    r.expected.updateTime = new Timestamp(0, 0); expect(transition(r).ok).toBe(false);
  });
  test("old-instance CAS cannot target the proposed recovered instance", () => {
    const old = policy("enabledMax"); const result = transition(recovery(old));
    if (!result.ok) throw new Error("recovery proposal refused");
    const next = result.value.nextPolicy; const stale = input("close", next, clone(next));
    stale.expected = { updateTime: next.updatedAt, policyInstanceId: old.policyInstanceId, generation: old.generation };
    expect(transition(stale).ok).toBe(false); expect(eligible(next).eligible).toBe(false); unpersisted(result);
  });
  test("typed transition data is still structure-only, not authenticated approval or a live CAS", () => {
    const r = recovery() as AvailabilityTransitionInput; const result = validateAvailabilityTransition(r, target);
    unpersisted(result); expect(result.operationalVerification).toBe("unverified");
  });
});
