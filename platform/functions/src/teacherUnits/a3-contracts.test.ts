import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Timestamp } from "firebase-admin/firestore";
import { A3_ERRORS } from "./a3-errors";
import { approvalSigningBytes, canonicalJSON, contentDigest, evidenceRef, parseStrictJSON, sha256Bytes } from "./a3-canonical";
import * as V from "./a3-validation";
import * as B from "./a3-bindings";
import { validateCapabilityRequest, validateCapabilityResponse, validateMutationCompatibility } from "./a3-protocol";
import type { StructuralResult } from "./a3-protocol";
import type { ExpectedEnvironment } from "./a3-contracts";
const fixture = JSON.parse(readFileSync(resolve(__dirname, "../../../../fixtures/teacher-units-a3/v1.json"), "utf8"));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
function policy(v: any): any {
  const copy = clone(v);
  if (copy.updatedAt && typeof copy.updatedAt.seconds === "number") copy.updatedAt = new Timestamp(copy.updatedAt.seconds, copy.updatedAt.nanoseconds);
  return copy;
}
const expected = fixture.expectedEmulator as ExpectedEnvironment;
const validators: Record<string, (v: unknown) => StructuralResult<unknown>> = {
  closedPolicy: v => V.validatePolicy(policy(v)), enabledPolicy: v => V.validatePolicy(policy(v)),
  compatibility: validateMutationCompatibility, capabilityRequest: validateCapabilityRequest,
  capabilityResponse: validateCapabilityResponse, closedCapabilityResponse: validateCapabilityResponse, unverifiedCapabilityResponse: validateCapabilityResponse,
  cloudEndpoint: V.validateEndpoint, emulatorEndpoint: v => V.validateEndpoint(v, expected), backendRelease: V.validateBackendRelease,
  deploymentApproval: V.validateDeploymentApproval, activationApproval: V.validateActivationApproval,
  activationEvidence: V.validateActivationEvidence, approvalDisposition: V.validateApprovalDisposition,
};
function mustPass(result: StructuralResult<unknown>): void { expect(result).toMatchObject({ ok: true, scope: "structure-only", operationalVerification: "unverified" }); }
function edit(value: any, path: string[], replacement: unknown, remove = false): any {
  const result = clone(value); let current = result;
  for (const key of path.slice(0, -1)) current = current[key];
  if (remove) delete current[path.at(-1)!]; else current[path.at(-1)!] = replacement;
  return result;
}
const valid = fixture.valid;
const enabled = () => policy(valid.enabledPolicy);
const releaseRef = () => `teacherUnitsBackendReleases/${contentDigest(valid.backendRelease.manifest)}`;
function resignShape(record: any): any { record.payload.source.statementObject.sha256 = contentDigest(record.payload.statement); return record; }

describe("approved A3 pure contracts", () => {
  test.each(Object.keys(valid))("valid fixture %s is structure only", name => mustPass(validators[name](valid[name])));
  test.each<[number, any]>(fixture.invalid.map((v: any, i: number) => [i, v]))("invalid fixture %s is refused", (_i, v) => {
    expect(validators[v.target](edit(valid[v.target], v.path, v.value, v.operation === "delete")).ok).toBe(false);
  });
  test("unknown and missing fields at every nested record boundary", () => {
    for (const [name, value] of Object.entries(valid)) {
      const paths: string[][] = [];
      const visit = (v: any, path: string[]): void => {
        if (!v || typeof v !== "object") return;
        if (!Array.isArray(v)) paths.push(path);
        for (const key of Object.keys(v)) visit(v[key], [...path, key]);
      };
      visit(value, []);
      for (const path of paths) {
        // Timestamp JSON is a fixture codec, not the policy's actual SDK object.
        if (path[0] === "updatedAt") continue;
        let record: any = value; for (const key of path) record = record[key];
        const extra = path.length ? edit(value, path, { ...record, unknownA3Field: true }) : { ...(value as object), unknownA3Field: true };
        expect(validators[name](extra).ok).toBe(false);
        for (const key of Object.keys(record)) expect(validators[name](edit(value, [...path, key], null, true)).ok).toBe(false);
      }
    }
  });
  test.each([0, -1, -0, 1.5, NaN, Infinity, "1", Number.MAX_SAFE_INTEGER + 1])("invalid generation %s", v => expect(V.validateGeneration(v).ok).toBe(false));
  test("last safe generation and successor boundary", () => {
    mustPass(V.validateGeneration(Number.MAX_SAFE_INTEGER));
    expect(B.validateNextGeneration(Number.MAX_SAFE_INTEGER - 1)).toMatchObject({ ok: true, value: Number.MAX_SAFE_INTEGER });
    expect(B.validateNextGeneration(Number.MAX_SAFE_INTEGER).ok).toBe(false);
    expect(B.validateNextGeneration("1").ok).toBe(false);
  });
  test("canonical identity and explicit emulator profile", () => {
    expect(V.validateEnvironment({ environment: "production", projectId: "lyfelabz-staging", projectNumber: "293337283840" }).ok).toBe(false);
    expect(V.validateEnvironment({ environment: "staging", projectId: "lyfelabz-staging", projectNumber: 293337283840 }).ok).toBe(false);
    expect(V.validateEndpoint(valid.emulatorEndpoint).ok).toBe(false);
    expect(V.validateEndpoint(valid.cloudEndpoint, expected).ok).toBe(false);
    expect(V.validateEndpoint(valid.cloudEndpoint, { environment: "production", projectId: "lyfelabz-prod", projectNumber: "182791689935" }).ok).toBe(false);
    expect(V.validateEndpoint({ ...valid.emulatorEndpoint, environment: "staging" }, expected).ok).toBe(false);
  });
  test("immutable references cannot include aliases, URLs or nested paths", () => {
    for (const ref of ["teacherUnitsReleaseEvidence/latest", `teacherUnitsReleaseEvidence/${"A".repeat(64)}`, `https://example.test/${"a".repeat(64)}`, `teacherUnitsReleaseEvidence/${"a".repeat(64)}/child`])
      expect(B.validateEvidenceReference(ref, valid.activationEvidence).ok).toBe(false);
  });
  test("approved error definitions remain separate from existing error mappings", () => {
    expect(Object.keys(A3_ERRORS)).toHaveLength(12);
    expect(A3_ERRORS["teacherUnits.responseUnavailable"]).toBe("unavailable");
    expect(A3_ERRORS["teacherUnits.invalidCompatibility"]).toBe("invalid-argument");
  });
});

describe("canonical bytes and content addresses", () => {
  test.each<[number, any]>(fixture.vectors.map((v: any, i: number) => [i, v]))("approved hash vector %s", (_i, v) => {
    expect(canonicalJSON(v.value)).toBe(v.canonical); expect(contentDigest(v.value)).toBe(v.digest);
  });
  test("payload/manifest, never wrapper, determines document identity", () => {
    mustPass(B.validateReleaseReference(releaseRef(), valid.backendRelease));
    expect(B.validateReleaseReference(`teacherUnitsBackendReleases/${contentDigest(valid.backendRelease)}`, valid.backendRelease).ok).toBe(false);
    for (const name of ["deploymentApproval", "activationApproval", "activationEvidence", "approvalDisposition"]) {
      const doc = valid[name]; mustPass(B.validateEvidenceReference(evidenceRef(doc.payload), doc));
      expect(B.validateEvidenceReference(evidenceRef(doc), doc).ok).toBe(false);
    }
  });
  test("object insertion order is irrelevant; array order and Unicode are exact", () => {
    expect(canonicalJSON({ z: 1, a: { y: 2, x: 3 } })).toBe(canonicalJSON({ a: { x: 3, y: 2 }, z: 1 }));
    expect(canonicalJSON({ "10": "ten", "2": "two", a: 1 })).toBe('{"2":"two","10":"ten","a":1}');
    expect(contentDigest(["a", "b"])).not.toBe(contentDigest(["b", "a"]));
    expect(contentDigest("é")).not.toBe(contentDigest("e\u0301"));
    expect(canonicalJSON("😀\n")).toBe('"😀\\n"');
  });
  test.each([undefined, NaN, Infinity, -0, 1.5, BigInt(1), Symbol("a"), () => 1, new Date(), new Timestamp(1, 0), new (class extends Array {})(), "\ud800", "\udc00", [undefined], Array(1)])("unsafe canonical value %s", v => expect(() => canonicalJSON(v)).toThrow());
  test("accessors, hidden fields, symbols, custom toJSON and cycles are rejected without invocation", () => {
    const getter = jest.fn(() => "bad");
    for (const value of [Object.defineProperty({}, "a", { get: getter, enumerable: true }), Object.defineProperty({}, "a", { value: 1 }), { [Symbol("a")]: 1 }, { toJSON: getter }, Object.defineProperty([], "0", { get: getter })])
      expect(() => canonicalJSON(value)).toThrow();
    const cycle: any = {}; cycle.self = cycle; expect(() => canonicalJSON(cycle)).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  test("strict JSON ingestion catches escaped and nested duplicate keys", () => {
    for (const input of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"a":{"b":1,"b":2}}', '[1,]', '{"a":}', '{', 'true false', '"\\ud800"', '{"x":9007199254740992}'])
      expect(() => parseStrictJSON(input)).toThrow();
    expect(parseStrictJSON('{"__proto__":{"x":1},"a":[true,null]}')).toEqual(JSON.parse('{"__proto__":{"x":1},"a":[true,null]}'));
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
  test("signature source digest and domain-separated signing bytes", () => {
    const statement = valid.deploymentApproval.payload.statement;
    expect(Buffer.from(approvalSigningBytes(statement)).toString("utf8")).toBe(`lyfelabz.teacher-units-approval-v1\n${canonicalJSON(statement)}`);
    expect(sha256Bytes(canonicalJSON(statement))).toBe(valid.deploymentApproval.payload.source.statementObject.sha256);
    const wrong = edit(valid.deploymentApproval, ["payload", "source", "statementObject", "sha256"], "0".repeat(64));
    expect(V.validateDeploymentApproval(wrong).ok).toBe(false);
  });
});

describe("supplied-record security bindings", () => {
  test("coherent supplied records remain unverified, including fake signatures", () => {
    mustPass(B.validateDeploymentBinding(valid.backendRelease, valid.deploymentApproval));
    const result = B.validateActivationBinding(enabled(), valid.backendRelease, valid.activationEvidence, valid.activationApproval, "c".repeat(64));
    mustPass(result);
    if (result.ok) {
      expect(result.operationalVerification).toBe("unverified");
      // @ts-expect-error Structural results expose no authorization decision.
      expect(result.authorized).toBeUndefined();
    }
    const approval = V.validateDeploymentApproval(valid.deploymentApproval);
    mustPass(approval); expect(valid.deploymentApproval.payload.source.signerKeyId).toBe("untrusted-test-key");
    expect((approval as unknown as Record<string, unknown>).deploymentEligible).toBeUndefined();
  });
  test("closed policy and all pending envelope changes refuse a mutation binding", () => {
    expect(B.validateMutationBinding(policy(valid.closedPolicy), valid.compatibility).ok).toBe(false);
    mustPass(B.validateMutationBinding(enabled(), valid.compatibility));
    for (const [key, value] of [["policyGeneration", 4], ["policyInstanceId", "123e4567-e89b-42d3-b456-426614174000"], ["backendReleaseId", "0".repeat(64)], ["placementFingerprint", "0".repeat(64)]])
      expect(B.validateMutationBinding(enabled(), { ...valid.compatibility, [key as string]: value }).ok).toBe(false);
    expect(B.validateMutationBinding(enabled(), null).ok).toBe(false);
  });
  test("release candidate change and binding differences refuse independently", () => {
    const a = resignShape(edit(valid.deploymentApproval, ["payload", "statement", "candidate", "sourceTree"], "0".repeat(40)));
    const release = edit(valid.backendRelease, ["manifest", "deploymentApprovalEvidenceRef"], evidenceRef(a.payload));
    expect(B.validateDeploymentBinding(release, a).ok).toBe(false);
    for (const key of ["generation", "policyInstanceId", "placementFingerprint"]) {
      const changed = { ...enabled(), [key]: key === "generation" ? 4 : key === "policyInstanceId" ? "123e4567-e89b-42d3-b456-426614174000" : "0".repeat(64) };
      expect(B.validateActivationBinding(changed, valid.backendRelease, valid.activationEvidence, valid.activationApproval, "c".repeat(64)).ok).toBe(false);
    }
    expect(B.validateActivationBinding(enabled(), valid.backendRelease, valid.activationEvidence, valid.activationApproval, "0".repeat(64)).ok).toBe(false);
    expect(B.validateActivationBinding(policy(valid.closedPolicy), valid.backendRelease, valid.activationEvidence, valid.activationApproval, "c".repeat(64)).ok).toBe(false);
  });
  test("cross-environment confusion refuses even when each record is individually valid", () => {
    const a = clone(valid.activationApproval);
    Object.assign(a.payload.statement, { environment: "production", projectId: "lyfelabz-prod", projectNumber: "182791689935" }); resignShape(a);
    mustPass(V.validateActivationApproval(a));
    const e = edit(valid.activationEvidence, ["payload", "authorizationEvidenceRef"], evidenceRef(a.payload));
    const pol = { ...enabled(), activationEvidenceRef: evidenceRef(e.payload) };
    expect(B.validateActivationBinding(pol, valid.backendRelease, e, a, "c".repeat(64)).ok).toBe(false);
  });
  test("activation authorization must match the certification reference", () => {
    const a = resignShape(edit(valid.activationApproval, ["payload", "statement", "certificationEvidenceRef"], `teacherUnitsReleaseEvidence/${"0".repeat(64)}`));
    const e = edit(valid.activationEvidence, ["payload", "authorizationEvidenceRef"], evidenceRef(a.payload));
    expect(B.validateActivationBinding({ ...enabled(), activationEvidenceRef: evidenceRef(e.payload) }, valid.backendRelease, e, a, "c".repeat(64)).ok).toBe(false);
  });
  test("initial policy, no-op, exact increments, preparation and shutdown", () => {
    const closed = policy(valid.closedPolicy); mustPass(B.validateInitialPolicy(closed));
    mustPass(B.validatePolicyTransition(closed, closed));
    expect(B.validatePolicyTransition(closed, { ...closed, generation: 2 }).ok).toBe(false);
    const prep = { ...closed, generation: 2, backendReleaseEligibility: enabled().backendReleaseEligibility };
    mustPass(B.validatePolicyTransition(closed, prep)); mustPass(B.validatePolicyTransition(prep, enabled()));
    expect(B.validatePolicyTransition(closed, enabled()).ok).toBe(false);
    const shutdown = { ...enabled(), mode: "closed", generation: 4, activationEvidenceRef: null };
    mustPass(B.validatePolicyTransition(enabled(), shutdown));
    mustPass(B.validatePolicyTransition(enabled(), { ...shutdown, backendReleaseEligibility: null }));
    expect(B.validatePolicyTransition(enabled(), { ...shutdown, placementFingerprint: "0".repeat(64) }).ok).toBe(false);
    expect(B.validatePolicyTransition(closed, { ...prep, policyInstanceId: "123e4567-e89b-42d3-b456-426614174000" }).ok).toBe(false);
    expect(B.validatePolicyTransition({ ...closed, generation: Number.MAX_SAFE_INTEGER }, { ...prep, generation: 1 }).ok).toBe(false);
    expect(B.validateInitialPolicy(enabled()).ok).toBe(false);
  });
  test("placement content uses existing ordered array hashing", () => {
    const ids = ["test-resource-a", "test-resource-b"]; mustPass(B.validatePlacementContent(ids, contentDigest(ids)));
    expect(B.validatePlacementContent([...ids].reverse(), contentDigest(ids)).ok).toBe(false);
    expect(B.validatePlacementContent(["x", "x"], contentDigest(["x", "x"])).ok).toBe(false);
  });
  test("immutable duplicates and approval dispositions", () => {
    const ref = evidenceRef(valid.deploymentApproval.payload);
    mustPass(B.validateImmutableDuplicate(ref, valid.deploymentApproval, clone(valid.deploymentApproval)));
    expect(B.validateImmutableDuplicate(ref, valid.deploymentApproval, edit(valid.deploymentApproval, ["schemaVersion"], 2)).ok).toBe(false);
    mustPass(B.validateImmutableDuplicate(releaseRef(), valid.backendRelease, clone(valid.backendRelease)));
    mustPass(B.validateDispositionBinding(valid.approvalDisposition, valid.deploymentApproval, null));
    expect(B.validateDispositionBinding(valid.approvalDisposition, valid.activationApproval, null).ok).toBe(false);
    const replacement = resignShape(edit(valid.deploymentApproval, ["payload", "statement", "authority", "decisionId"], "fixed-replacement-002"));
    const disposition = clone(valid.approvalDisposition);
    disposition.payload.statement.action = "supersede";
    disposition.payload.statement.replacementApprovalRef = evidenceRef(replacement.payload); resignShape(disposition);
    mustPass(B.validateDispositionBinding(disposition, valid.deploymentApproval, replacement));
    disposition.payload.statement.replacementApprovalRef = evidenceRef(valid.activationApproval.payload); resignShape(disposition);
    expect(B.validateDispositionBinding(disposition, valid.deploymentApproval, valid.activationApproval).ok).toBe(false);
  });
});

describe("supported endpoint profile variants and malformed declarations", () => {
  test("connector, direct VPC and on-deploy profiles are represented without reinterpretation", () => {
    const cloud = clone(valid.cloudEndpoint);
    cloud.execution.network = { kind: "connector", connectorResource: "projects/lyfelabz-staging/locations/us-central1/connectors/test-connector", egress: "private-ranges-only" };
    mustPass(V.validateEndpoint(cloud));
    cloud.execution.network = { kind: "direct-vpc", networkResource: "projects/lyfelabz-staging/global/networks/test-net", subnetworkResource: "projects/lyfelabz-staging/regions/us-central1/subnetworks/test-subnet", networkTags: ["a", "b"], egress: "all-traffic" };
    cloud.build.runtimeUpdatePolicy = { kind: "on-deploy", runtimeVersion: "test-runtime-version", baseImageUri: null };
    mustPass(V.validateEndpoint(cloud));
    cloud.execution.network.networkTags.reverse(); expect(V.validateEndpoint(cloud).ok).toBe(false);
    cloud.execution.network.networkTags.reverse(); cloud.build.runtimeUpdatePolicy.baseImageUri = "unexpected-auto-image";
    expect(V.validateEndpoint(cloud).ok).toBe(false);
  });
  test("conditional IAM is structural, requires v3, and never supplies effective access", () => {
    const cloud = clone(valid.cloudEndpoint);
    cloud.invocation.serviceAllowPolicy.version = 3;
    cloud.invocation.serviceAllowPolicy.bindings[0].condition = { expression: "request.time < timestamp('2027-01-01T00:00:00Z')", title: "test-only", description: "not evaluated" };
    mustPass(V.validateEndpoint(cloud));
    cloud.invocation.serviceAllowPolicy.version = 1; expect(V.validateEndpoint(cloud).ok).toBe(false);
  });
  test("malformed nested objects and duplicate identities fail", () => {
    for (const path of [["execution"], ["invocation", "serviceAllowPolicy"], ["build", "source"], ["execution", "network"]])
      expect(V.validateEndpoint(edit(valid.cloudEndpoint, path, [])).ok).toBe(false);
    const cloud = clone(valid.cloudEndpoint);
    cloud.execution.secretEnvironmentBindings[0].name = "TEST_MODE"; expect(V.validateEndpoint(cloud).ok).toBe(false);
    const release = clone(valid.backendRelease); release.manifest.endpoints.reverse(); expect(V.validateBackendRelease(release).ok).toBe(false);
    const duplicate = clone(valid.backendRelease); duplicate.manifest.endpoints[1] = clone(duplicate.manifest.endpoints[0]);
    expect(V.validateBackendRelease(duplicate).ok).toBe(false);
    expect(V.validateEndpoint(edit(valid.cloudEndpoint, ["serviceResource"], "projects/293337283840/locations/us-central1/services/test")).ok).toBe(false);
  });
  test("signature pad bits and algorithm are strict while authenticity is unverified", () => {
    const sourcePath = ["payload", "source"];
    expect(V.validateDeploymentApproval(edit(valid.deploymentApproval, [...sourcePath, "signatureBase64"], `${"A".repeat(85)}B==`)).ok).toBe(false);
    expect(V.validateDeploymentApproval(edit(valid.deploymentApproval, [...sourcePath, "signatureAlgorithm"], "rsa")).ok).toBe(false);
    mustPass(V.validateDeploymentApproval(valid.deploymentApproval));
  });
  test("emulator release uses matching loopback profile and no fake Rules resource", () => {
    const release = clone(valid.backendRelease);
    Object.assign(release.manifest, { environment: "emulator", projectId: "demo-a3-test", projectNumber: "0" });
    release.manifest.endpoints = V.ENDPOINTS.map(name => ({ ...clone(valid.emulatorEndpoint), endpointName: name, entryPoint: name }));
    release.manifest.rules.rulesetResource = null; mustPass(V.validateBackendRelease(release, expected));
    expect(V.validateBackendRelease(release).ok).toBe(false);
    release.manifest.rules.rulesetResource = "projects/demo-a3-test/rulesets/fake"; expect(V.validateBackendRelease(release, expected).ok).toBe(false);
  });
  test("standalone statements have exact schemas independently of wrapper digests", () => {
    mustPass(V.validateDeploymentApprovalStatement(valid.deploymentApproval.payload.statement));
    mustPass(V.validateActivationApprovalStatement(valid.activationApproval.payload.statement));
    mustPass(V.validateApprovalDispositionStatement(valid.approvalDisposition.payload.statement));
    expect(V.validateActivationApprovalStatement({ ...valid.activationApproval.payload.statement, activationEvidenceRef: "future-child" }).ok).toBe(false);
  });
});

 test("embedded Firebase identity rejects duplicate keys and preserves directory strings", () => {
  const cloud = clone(valid.cloudEndpoint);
  cloud.execution.environmentVariables[0].value = '{"projectId":"lyfelabz-prod","projectId":"lyfelabz-staging"}';
  expect(V.validateEndpoint(cloud).ok).toBe(false);
  cloud.execution.environmentVariables[0].value = '{"projectId":"lyfelabz-staging"}';
  cloud.execution.workingDirectory = "/"; mustPass(V.validateEndpoint(cloud));
 });

describe("P2 exact textual-number regressions", () => {
  test.each([
    "1.0000000000000001", "9007199254740990.5", "1e-400", "-1e-400",
    "9007199254740992", "-9007199254740992", "0.1", "1.5", "1e-1",
    "-0", "-0.0", "-0e999", "1e400", "1e999999999999999999999999",
    "1e-999999999999999999999999",
  ])("refuses lossy or prohibited token %s before hashing", source => {
    expect(() => contentDigest(parseStrictJSON(source))).toThrow();
    expect(() => parseStrictJSON(`{"nested":[${source}]}`)).toThrow();
  });
  test.each<[string, number]>([
    ["0", 0], ["1", 1], ["-1", -1], ["9007199254740991", Number.MAX_SAFE_INTEGER],
    ["-9007199254740991", -Number.MAX_SAFE_INTEGER], ["1.0", 1], ["100.000", 100],
    ["1e3", 1000], ["10e-1", 1], ["-10.00e-1", -1], ["0e999999999999999999999", 0],
    ["90071992547409910e-1", Number.MAX_SAFE_INTEGER],
  ])("preserves exact safe integer %s", (source, value) => {
    expect(parseStrictJSON(source)).toBe(value);
    expect(contentDigest(parseStrictJSON(source))).toBe(contentDigest(value));
  });
  test("fractional generation cannot become a valid compatibility envelope", () => {
    const source = JSON.stringify(valid.compatibility).replace('"policyGeneration":3', '"policyGeneration":3.0000000000000001');
    expect(source).toContain("3.0000000000000001");
    expect(() => validateMutationCompatibility(parseStrictJSON(source))).toThrow();
  });
  test("numeric-looking and escaped strings are not numeric tokens", () => {
    const source = String.raw`{"1e-400":["1.0000000000000001","9007199254740990.5","\u0031e-400","quote: \"1e400\"","slash: \\"]}`;
    expect(parseStrictJSON(source)).toEqual(JSON.parse(source));
    expect(parseStrictJSON('{"numbers":[-1,0,1e3],"nested":{"value":10e-1}}')).toEqual({ numbers: [-1, 0, 1000], nested: { value: 1 } });
  });
  test.each(['{"a":1,"\\u0061":2}', '{"x":{"a":1,"a":2}}', "01", "+1", "1.", "1e", "[1,]", '{"a":}', "true false"])("retains duplicate and malformed JSON refusal %s", source => {
    expect(() => parseStrictJSON(source)).toThrow();
  });
});

describe("approved CPU/memory structural responsibility boundary", () => {
  test.each([1, 80, 1000, 1500, 6000, 9000, Number.MAX_SAFE_INTEGER])("positive safe CPU millicores %s remain structure-only", value => {
    mustPass(V.validateEndpoint(edit(valid.cloudEndpoint, ["execution", "cpuMilli"], value)));
  });
  test.each([0, -0, -1, 0.5, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, "1000", null])("invalid CPU representation %s refuses", value => {
    expect(V.validateEndpoint(edit(valid.cloudEndpoint, ["execution", "cpuMilli"], value)).ok).toBe(false);
  });
  test.each(["1", "268435456", "9007199254740993", "34359738369", "9".repeat(1000)])("positive exact memory bytes %s remain structure-only", value => {
    const endpoint = edit(valid.cloudEndpoint, ["execution", "memoryBytes"], value);
    const result = V.validateEndpoint(endpoint);
    mustPass(result);
    if (result.ok && result.value.kind === "google-cloud") expect(result.value.execution.memoryBytes).toBe(value);
    expect(parseStrictJSON(canonicalJSON(endpoint))).toEqual(endpoint);
  });
  test.each(["0", "-0", "-1", "01", "1.0", "1.5", "1e3", "+1", " 1", "1 ", "", "NaN", "Infinity", 1, NaN, Infinity, null])("invalid memory representation %s refuses", value => {
    expect(V.validateEndpoint(edit(valid.cloudEndpoint, ["execution", "memoryBytes"], value)).ok).toBe(false);
  });
  test("approved fixture stays valid and structural success exposes no eligibility decision", () => {
    expect(valid.cloudEndpoint.execution.memoryBytes).toBe("268435456");
    const result = V.validateEndpoint(valid.cloudEndpoint);
    mustPass(result);
    expect(result).not.toHaveProperty("deploymentEligible");
    expect(result).not.toHaveProperty("authorized");
  });
});

describe("P2 documented provider integer bounds", () => {
  const fields: Array<{ name: string; path: string[]; minimum: number | string; maximum: number | string }> = [
    { name: "concurrency", path: ["execution", "concurrency"], minimum: 1, maximum: 1000 },
    { name: "timeout nanoseconds", path: ["execution", "timeoutNanoseconds"], minimum: "1", maximum: "3600000000000" },
    { name: "minimum instances", path: ["execution", "minimumInstances"], minimum: 0, maximum: 2147483647 },
    { name: "maximum instances", path: ["execution", "maximumInstances"], minimum: 1, maximum: 2147483647 },
    { name: "Storage generation", path: ["build", "source", "generation"], minimum: "1", maximum: "9223372036854775807" },
    { name: "secret default mode", path: ["execution", "secretVolumeBindings", "0", "defaultMode"], minimum: 0, maximum: 511 },
    { name: "secret item mode", path: ["execution", "secretVolumeBindings", "0", "items", "0", "mode"], minimum: 1, maximum: 511 },
  ];
  function endpoint(path: string[], value: unknown): any {
    const e = edit(valid.cloudEndpoint, path, value);
    // Count tests establish int32 representation, not project quota eligibility.
    if (path[1] === "minimumInstances") e.execution.maximumInstances = null;
    return e;
  }
  test.each(fields)("$name minimum/maximum and all invalid boundaries", ({ path, minimum, maximum }) => {
    mustPass(V.validateEndpoint(endpoint(path, minimum)));
    mustPass(V.validateEndpoint(endpoint(path, maximum)));
    const decimalString = typeof minimum === "string";
    const below = decimalString ? (BigInt(minimum) - 1n).toString() : minimum - 1;
    const above = typeof maximum === "string" ? (BigInt(maximum) + 1n).toString() : maximum + 1;
    const malformed = decimalString
      ? [below, above, "1.5", "01", "1e3", "-1", "9".repeat(1000), 1, Number.MAX_SAFE_INTEGER + 1]
      : [below, above, 1.5, NaN, Infinity, -0, Number.MAX_SAFE_INTEGER + 1, "01", "9".repeat(1000)];
    for (const value of malformed) expect(V.validateEndpoint(endpoint(path, value)).ok).toBe(false);
  });
  test("signed-long bound applies to every immutable ContentObject reference", () => {
    const cases: Array<[any, string[], (v: unknown) => StructuralResult<unknown>]> = [
      [valid.cloudEndpoint, ["invocation", "accessReviewReceipt", "generation"], V.validateEndpoint],
      [valid.deploymentApproval, ["payload", "source", "statementObject", "generation"], V.validateDeploymentApproval],
      [valid.deploymentApproval, ["payload", "statement", "candidate", "deploymentPlan", "generation"], V.validateDeploymentApproval],
    ];
    for (const [record, path, validateRecord] of cases) {
      const maximum = edit(record, path, "9223372036854775807");
      if (path.includes("statement")) resignShape(maximum);
      mustPass(validateRecord(maximum));
      const overflow = edit(record, path, "9223372036854775808");
      if (path.includes("statement")) resignShape(overflow);
      expect(validateRecord(overflow).ok).toBe(false);
    }
  });
  test("original provider reproductions refuse and nullable fields retain semantics", () => {
    for (const [path, value] of [
      [["execution", "concurrency"], 1001],
      [["execution", "timeoutNanoseconds"], "3600000000001"],
      [["build", "source", "generation"], "18446744073709551616"],
    ] as Array<[string[], unknown]>) expect(V.validateEndpoint(endpoint(path, value)).ok).toBe(false);
    mustPass(V.validateEndpoint(endpoint(["execution", "maximumInstances"], null)));
    mustPass(V.validateEndpoint(endpoint(["execution", "secretVolumeBindings", "0", "items", "0", "mode"], null)));
    mustPass(V.validateGeneration(Number.MAX_SAFE_INTEGER));
  });
});
