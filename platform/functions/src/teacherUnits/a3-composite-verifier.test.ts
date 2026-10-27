/* eslint-disable @typescript-eslint/no-explicit-any */
// A3-6 S3 composite release-authority verifier. Hermetic: synthetic Ed25519 test keys
// are generated in this process only; this file is excluded from the compiled lib.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { Timestamp } from "firebase-admin/firestore";

import { PRODUCTION_AUTHORITY_REGISTRY } from "./a3-authority-registry";
import * as CompositeModule from "./a3-composite-verifier";
import { createCompositeReleaseAuthorityVerifier, verifyReleaseAuthorityChain } from "./a3-composite-verifier";
import type { CompositeVerifierDependencies } from "./a3-composite-verifier";
import type { ExpectedEnvironment } from "./a3-contracts";
import { ED25519_GROUP_ORDER } from "./a3-ed25519";
import { PRODUCTION_TEACHER_UNITS_ENFORCEMENT, RUNTIME_PLACEMENT_FINGERPRINT } from "./a3-enforcement";
import { RELEASE_AUTHORITY_UNVERIFIED_REASONS } from "./a3-release-authority";
import type { ReleaseAuthorityInput, ReleaseAuthorityVerdict } from "./a3-release-authority";
import { PRODUCTION_REVOCATION_LIST, createRevocationList } from "./a3-revocation-list";
import type { RevocationList } from "./a3-revocation-list";
import type { RuntimeIdentity } from "./a3-runtime-identity";
import { A3_FIXTURE, buildSignedEnabledChain, chainSigningKeys, emulatorExpectation, stubIdentity, testAuthorityRegistry,
  testSigningKey } from "./a3-test-support.test";
import type { ChainSigningKeys, SignedChainOptions, SignedEnabledChain } from "./a3-test-support.test";

const STAGING: ExpectedEnvironment = { environment: "staging", projectId: "lyfelabz-staging", projectNumber: "293337283840" };
const PRODUCTION: ExpectedEnvironment = { environment: "production", projectId: "lyfelabz-prod", projectNumber: "182791689935" };
const EMULATOR = emulatorExpectation("demo-a3-test");
const PLACEMENT = "b".repeat(64);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const omit = (record: object, key: string): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...record };
  delete copy[key];
  return copy;
};

function list(expected: ExpectedEnvironment, refs: string[] = []): RevocationList {
  const entries = [...refs].sort().map(revokedEvidenceRef => ({ schemaVersion: 1, environment: expected.environment,
    projectId: expected.projectId, projectNumber: expected.projectNumber, revokedEvidenceRef }));
  const result = createRevocationList(entries, { environment: expected.environment, projectId: expected.projectId,
    projectNumber: expected.projectNumber });
  if (!result.ok) throw new Error(result.issue.reason);
  return result.value;
}

type Setup = { chain: SignedEnabledChain; identity: RuntimeIdentity; deps: CompositeVerifierDependencies; keys: ChainSigningKeys };
function setup(expected: ExpectedEnvironment = STAGING, options: SignedChainOptions = {},
  chainKeys?: ChainSigningKeys, registryKeys?: ChainSigningKeys): Setup {
  const keys = registryKeys ?? chainSigningKeys();
  const chain = buildSignedEnabledChain(expected, PLACEMENT, chainKeys ?? keys, options);
  return { chain, keys, identity: stubIdentity(expected),
    deps: { registry: testAuthorityRegistry(expected, keys), revocationList: list(expected) } };
}

type Reader = ((ref: string) => Promise<unknown>) & { calls: string[] };
function reader(chain: SignedEnabledChain, override?: (ref: string) => unknown): Reader {
  const calls: string[] = [];
  const read = ((ref: string): Promise<unknown> => {
    calls.push(ref);
    return Promise.resolve(override ? override(ref) : chain.documents[ref] ?? null);
  }) as Reader;
  read.calls = calls;
  return read;
}

function input(s: Setup, edits: Partial<Record<keyof ReleaseAuthorityInput, unknown>> = {}, read?: Reader): ReleaseAuthorityInput {
  const c = s.chain;
  return {
    identity: s.identity, endpointName: "teacherUnitsList", policy: c.policy,
    releaseRef: c.releaseRef, release: c.documents[c.releaseRef],
    deploymentApprovalRef: c.deploymentApprovalRef, deploymentApproval: c.documents[c.deploymentApprovalRef],
    activationEvidenceRef: c.activationEvidenceRef, activationEvidence: c.documents[c.activationEvidenceRef],
    activationApprovalRef: c.activationApprovalRef, activationApproval: c.documents[c.activationApprovalRef],
    readEvidence: read ?? reader(c), ...edits,
  } as ReleaseAuthorityInput;
}

const run = (s: Setup, edits: Partial<Record<keyof ReleaseAuthorityInput, unknown>> = {}, read?: Reader): Promise<ReleaseAuthorityVerdict> =>
  createCompositeReleaseAuthorityVerifier(s.deps).verify(input(s, edits, read));
const reason = async (s: Setup, edits: Partial<Record<keyof ReleaseAuthorityInput, unknown>> = {}, read?: Reader): Promise<string> => {
  const verdict = await run(s, edits, read);
  return verdict.verdict === "verified" ? "verified" : verdict.reason;
};

function expectedVerdict(c: SignedEnabledChain): ReleaseAuthorityVerdict {
  return { verdict: "verified", releaseId: c.releaseId, deploymentApprovalRef: c.deploymentApprovalRef,
    activationEvidenceRef: c.activationEvidenceRef, activationApprovalRef: c.activationApprovalRef,
    certificationEvidenceRef: c.certificationEvidenceRef, hostingCandidateFingerprint: c.hostingCandidateFingerprint,
    policyInstanceId: c.compatibility.policyInstanceId, enabledGeneration: c.compatibility.policyGeneration };
}

describe("verified chains", () => {
  it.each([["staging", STAGING], ["production", PRODUCTION], ["emulator", EMULATOR]] as const)(
    "a fully signed %s chain verifies with exactly the independent field values", async (_, expected) => {
      const s = setup(expected);
      const read = reader(s.chain);
      const verdict = await run(s, {}, read);
      expect(verdict).toEqual(expectedVerdict(s.chain));
      expect(Object.keys(verdict).sort()).toEqual(Object.keys(expectedVerdict(s.chain)).sort());
      expect(Object.isFrozen(verdict)).toBe(true);
      expect(read.calls).toEqual([s.chain.certificationEvidenceRef]);
    });
  it("the pure core agrees with the adapter and needs no callback", () => {
    const s = setup();
    const rest = omit(input(s), "readEvidence");
    expect(verifyReleaseAuthorityChain({ ...rest, certification: s.chain.certification }, s.deps)).toEqual(expectedVerdict(s.chain));
    expect(verifyReleaseAuthorityChain({ ...rest, certification: null }, s.deps)).toEqual({ verdict: "unverified", reason: "certificationUnverified" });
    expect(verifyReleaseAuthorityChain({ ...rest }, s.deps)).toEqual({ verdict: "unverified", reason: "inputMismatch" });
  });
  it("the hosting fingerprint and generation in the verdict come from the signed approval", async () => {
    const s = setup(STAGING, { hostingCandidateFingerprint: "e".repeat(64), generation: 9 });
    const verdict = await run(s);
    expect(verdict).toMatchObject({ verdict: "verified", hostingCandidateFingerprint: "e".repeat(64), enabledGeneration: 9 });
  });
  it("the empty production registry refuses even a perfect production chain", async () => {
    const s = setup(PRODUCTION);
    expect(await reason({ ...s, deps: { registry: PRODUCTION_AUTHORITY_REGISTRY, revocationList: PRODUCTION_REVOCATION_LIST } }))
      .toBe("authorityUnrecognized");
  });
  it("every reason the verifier returns is an approved Decision 4 reason", () => {
    for (const r of ["inputMismatch", "dispositionUnresolved", "revoked", "authorityUnrecognized", "signatureUnverified",
      "certificationUnverified", "error"]) expect(RELEASE_AUTHORITY_UNVERIFIED_REASONS).toContain(r);
  });
});

describe("signatures and authority (S1 reasons preserved)", () => {
  const names = ["deploy", "certify", "activate"] as const;
  it.each(names)("a %s signature by a key outside the registry is authorityUnrecognized", async name => {
    const keys = chainSigningKeys();
    expect(await reason(setup(STAGING, {}, { ...keys, [name]: testSigningKey() }, keys))).toBe("authorityUnrecognized");
  });
  it.each(names)("a forged %s signature (registered keyId, other private key) is signatureUnverified", async name => {
    const keys = chainSigningKeys();
    const forger = { ...keys[name], privateKey: testSigningKey().privateKey };
    expect(await reason(setup(STAGING, {}, { ...keys, [name]: forger }, keys))).toBe("signatureUnverified");
  });
  it.each([["deploy", "certify"], ["deploy", "activate"], ["certify", "deploy"], ["certify", "activate"],
    ["activate", "deploy"], ["activate", "certify"]] as const)("a %s statement signed with the %s action key is authorityUnrecognized",
    async (name, other) => {
      const keys = chainSigningKeys();
      expect(await reason(setup(STAGING, {}, { ...keys, [name]: keys[other] }, keys))).toBe("authorityUnrecognized");
    });
  it.each(names)("a %s signature with one flipped bit is signatureUnverified", async name => {
    const s = setup(STAGING, { tamper: { [name]: (d: any) => {
      const bytes = Buffer.from(d.payload.source.signatureBase64, "base64"); bytes[5] ^= 1;
      d.payload.source.signatureBase64 = bytes.toString("base64");
    } } });
    expect(await reason(s)).toBe("signatureUnverified");
  });
  it.each(names)("a malleated %s signature (S + L) is signatureUnverified", async name => {
    const s = setup(STAGING, { tamper: { [name]: (d: any) => {
      const sig = Buffer.from(d.payload.source.signatureBase64, "base64");
      let scalar = 0n;
      for (let i = 31; i >= 0; i -= 1) scalar = (scalar << 8n) + BigInt(sig[32 + i]);
      scalar += ED25519_GROUP_ORDER;
      for (let i = 0; i < 32; i += 1) { sig[32 + i] = Number(scalar & 0xffn); scalar >>= 8n; }
      d.payload.source.signatureBase64 = sig.toString("base64");
    } } });
    expect(await reason(s)).toBe("signatureUnverified");
  });
  it.each(["authorityId", "approverSubject", "approvalSystemId"])("a registry %s that differs from the statement is authorityUnrecognized",
    async field => {
      for (const name of names) {
        const s = setup();
        const deps = { ...s.deps, registry: testAuthorityRegistry(STAGING, s.keys, { [name]: { [field]: "someone-else" } }) };
        expect(await reason({ ...s, deps })).toBe("authorityUnrecognized");
      }
    });
  it("a statement whose authority differs from the registry entry is authorityUnrecognized", async () => {
    const s = setup(STAGING, { edit: { activate: st => { st.authority = { ...st.authority, approverSubject: "impostor" }; } } });
    expect(await reason(s)).toBe("authorityUnrecognized");
  });
});

describe("cross-project and cross-environment replay", () => {
  it("a staging chain presented to a production runtime is inputMismatch", async () => {
    const s = setup(STAGING);
    expect(await reason({ ...s, identity: stubIdentity(PRODUCTION) })).toBe("inputMismatch");
  });
  it("an emulator chain for another demo project is inputMismatch", async () => {
    const s = setup(EMULATOR);
    expect(await reason({ ...s, identity: stubIdentity(emulatorExpectation("demo-other")) })).toBe("inputMismatch");
  });
  it("a production chain signed by keys registered only for staging is authorityUnrecognized", async () => {
    const keys = chainSigningKeys();
    const s = setup(PRODUCTION, {}, keys, keys);
    expect(await reason({ ...s, deps: { ...s.deps, registry: testAuthorityRegistry(STAGING, keys) } })).toBe("authorityUnrecognized");
  });
  it("a coherent emulator chain for a non-demo project is inputMismatch before any revocation or signature check", async () => {
    // S1 and S2 refuse non-demo emulator registries and lists, so the chain is signed
    // with keys registered for the demo project; only the S3 identity check stops it first.
    const nonDemo = emulatorExpectation("lyfelabz-local");
    const demo = setup(EMULATOR);
    const chain = buildSignedEnabledChain(nonDemo, PLACEMENT, demo.keys);
    expect(await reason({ ...demo, chain, identity: stubIdentity(nonDemo) })).toBe("inputMismatch");
  });
  it.each([
    ["an unpinned cloud identity", { ...PRODUCTION, projectId: "lyfelabz-staging" }],
    ["a non-demo emulator identity", { ...EMULATOR, projectId: "lyfelabz-prod" }],
    ["an emulator identity without a local profile", { environment: "emulator", projectId: "demo-a3-test", projectNumber: "0" }],
  ])("%s is inputMismatch", async (_, expected) => {
    const s = setup(STAGING);
    expect(await reason({ ...s, identity: { ...stubIdentity(STAGING), ...expected } as RuntimeIdentity })).toBe("inputMismatch");
  });
});

describe("structural bindings (inputMismatch)", () => {
  const s = setup();
  const c = s.chain;
  const docs = c.documents;
  const edited = (ref: string, edit: (d: any) => void): unknown => { const d = clone(docs[ref]); edit(d); return d; };
  const cases: Array<[string, Partial<Record<keyof ReleaseAuthorityInput, unknown>>]> = [
    ["a closed policy", { policy: { ...c.policy, mode: "closed", activationEvidenceRef: null } }],
    ["a policy for another generation", { policy: { ...c.policy, generation: c.policy.generation + 1 } }],
    ["a policy with another placement", { policy: { ...c.policy, placementFingerprint: "a".repeat(64) } }],
    ["a policy naming another release", { policy: { ...c.policy, backendReleaseEligibility: { releaseId: "a".repeat(64) } } }],
    ["a policy naming other activation evidence", { policy: { ...c.policy, activationEvidenceRef: c.deploymentApprovalRef } }],
    ["a policy timestamp subclass", { policy: { ...c.policy, updatedAt: new (class extends Timestamp {})(1767323046, 0) } }],
    ["a policy JSON timestamp", { policy: { ...c.policy, updatedAt: { seconds: 1767323046, nanoseconds: 0 } } }],
    ["a release ref that is not the policy's", { releaseRef: `teacherUnitsBackendReleases/${"a".repeat(64)}` }],
    ["an altered release body", { release: edited(c.releaseRef, d => { d.manifest.sourceSha = "0".repeat(40); }) }],
    ["a deployment approval ref that is not the release's", { deploymentApprovalRef: c.activationApprovalRef }],
    ["a deployment approval for another candidate", { deploymentApproval: edited(c.deploymentApprovalRef, d => {
      d.payload.statement.candidate.sourceSha = "0".repeat(40); }) }],
    ["an activation approval at the deployment approval position", { deploymentApproval: docs[c.activationApprovalRef] }],
    ["an activation evidence ref that is not the policy's", { activationEvidenceRef: c.activationApprovalRef }],
    ["altered activation evidence", { activationEvidence: edited(c.activationEvidenceRef, d => { d.payload.hostingCandidateFingerprint = "e".repeat(64); }) }],
    ["a certification at the activation evidence position", { activationEvidence: docs[c.certificationEvidenceRef] }],
    ["an activation approval ref that is not the evidence's", { activationApprovalRef: c.certificationEvidenceRef }],
    ["a certification at the activation approval position", { activationApproval: docs[c.certificationEvidenceRef] }],
    ["an altered activation approval", { activationApproval: edited(c.activationApprovalRef, d => { d.payload.statement.enabledGeneration = 4; }) }],
    ["a malformed release ref", { releaseRef: "teacherUnitsBackendReleases/../x" }],
    ["a malformed evidence ref", { activationEvidenceRef: 42 }],
    ["a malformed revocation query (non-canonical evidence ref)", { deploymentApprovalRef: `teacherUnitsReleaseEvidence/${"A".repeat(64)}` }],
    ["a missing policy", { policy: undefined }],
    ["a non-function readEvidence", { readEvidence: "read" }],
  ];
  it.each(cases)("%s is inputMismatch", async (_, edits) => {
    const read = reader(c);
    expect(await reason(s, edits, read)).toBe("inputMismatch");
    expect(read.calls).toEqual([]);
  });
  it("an activation approval naming another certification is inputMismatch", async () => {
    const other = setup(STAGING, { edit: { certify: st => { st.issuedAt = "2026-01-03T03:04:05.500000000Z"; } } }, s.keys, s.keys);
    expect(other.chain.certificationEvidenceRef).not.toBe(c.certificationEvidenceRef);
    expect(await reason(s, { activationApproval: other.chain.documents[other.chain.activationApprovalRef] })).toBe("inputMismatch");
  });
  it("an input with an extra or missing field is inputMismatch", async () => {
    expect(await reason(s, { extra: 1 } as any)).toBe("inputMismatch");
    const missing = omit(input(s), "endpointName");
    expect(await createCompositeReleaseAuthorityVerifier(s.deps).verify(missing as any)).toEqual({ verdict: "unverified", reason: "inputMismatch" });
  });
});

describe("revocation (pinned deny list)", () => {
  const targets = ["deploymentApprovalRef", "activationEvidenceRef", "activationApprovalRef", "certificationEvidenceRef"] as const;
  it.each(targets)("a revoked %s is revoked", async target => {
    const s = setup();
    expect(await reason({ ...s, deps: { ...s.deps, revocationList: list(STAGING, [s.chain[target]]) } })).toBe("revoked");
  });
  it("revoking an unrelated reference does not affect the chain", async () => {
    const s = setup();
    expect(await reason({ ...s, deps: { ...s.deps, revocationList: list(STAGING, [`teacherUnitsReleaseEvidence/${"1".repeat(64)}`]) } }))
      .toBe("verified");
  });
  it("revocation precedes signature checks", async () => {
    const keys = chainSigningKeys();
    const s = setup(STAGING, {}, { ...keys, deploy: testSigningKey() }, keys);
    expect(await reason({ ...s, deps: { ...s.deps, revocationList: list(STAGING, [s.chain.activationApprovalRef]) } })).toBe("revoked");
  });
  it("a list bound to another environment is dispositionUnresolved", async () => {
    const s = setup();
    expect(await reason({ ...s, deps: { ...s.deps, revocationList: PRODUCTION_REVOCATION_LIST } })).toBe("dispositionUnresolved");
    expect(await reason({ ...s, deps: { ...s.deps, revocationList: list(PRODUCTION, [s.chain.deploymentApprovalRef]) } }))
      .toBe("dispositionUnresolved");
  });
  it("an emulator list for another demo project is dispositionUnresolved", async () => {
    const s = setup(EMULATOR);
    expect(await reason({ ...s, deps: { ...s.deps, revocationList: list(emulatorExpectation("demo-other")) } })).toBe("dispositionUnresolved");
  });
});

describe("certification", () => {
  it.each([["null", null], ["undefined", undefined]])("a missing certification (%s) is certificationUnverified", async (_, value) => {
    const s = setup();
    expect(await reason(s, {}, reader(s.chain, () => value))).toBe("certificationUnverified");
  });
  it("a malformed or non-plain certification is certificationUnverified", async () => {
    const s = setup();
    for (const bad of [42, "x", [], new Map(), { schemaVersion: 1 },
      Object.defineProperty({}, "payload", { get: () => s.chain.certification.payload, enumerable: true })]) {
      expect(await reason(s, {}, reader(s.chain, () => bad))).toBe("certificationUnverified");
    }
  });
  it("another document at the certification reference is certificationUnverified", async () => {
    const s = setup();
    expect(await reason(s, {}, reader(s.chain, () => s.chain.documents[s.chain.activationApprovalRef]))).toBe("certificationUnverified");
    const other = setup(STAGING, { hostingCandidateFingerprint: "e".repeat(64) }, s.keys, s.keys);
    expect(await reason(s, {}, reader(s.chain, () => other.chain.certification))).toBe("certificationUnverified");
  });
  it.each([
    ["another release", (st: any) => { st.backendReleaseId = "a".repeat(64); }],
    ["another Hosting candidate", (st: any) => { st.hostingCandidateFingerprint = "e".repeat(64); }],
    ["another placement", (st: any) => { st.placementFingerprint = "a".repeat(64); }],
    ["another environment", (st: any) => { Object.assign(st, PRODUCTION); }],
  ])("a correctly signed certification for %s is certificationUnverified", async (_, edit) => {
    expect(await reason(setup(STAGING, { edit: { certify: edit } }))).toBe("certificationUnverified");
  });
  it("a certification whose report is its own statement object is certificationUnverified", async () => {
    const own = A3_FIXTURE.valid.releaseCertification.payload.source.statementObject;
    const s = setup(STAGING, { edit: { certify: st => {
      st.certificationReport = { bucket: own.bucket, object: own.object, generation: own.generation, sha256: "9".repeat(64) };
    } } });
    expect(await reason(s)).toBe("certificationUnverified");
  });
});

describe("snapshots, accessors and proxies", () => {
  it("an accessor anywhere in the input is inputMismatch and never runs", async () => {
    const s = setup();
    let ran = 0;
    const approval = clone(s.chain.documents[s.chain.activationApprovalRef]);
    Object.defineProperty(approval.payload, "kind", { get: () => { ran += 1; return "teacher-units-activation-approval"; }, enumerable: true });
    expect(await reason(s, { activationApproval: approval })).toBe("inputMismatch");
    const base = input(s);
    const tricky = { ...base };
    Object.defineProperty(tricky, "policy", { get: () => { ran += 1; return s.chain.policy; }, enumerable: true });
    expect(await createCompositeReleaseAuthorityVerifier(s.deps).verify(tricky)).toEqual({ verdict: "unverified", reason: "inputMismatch" });
    expect(ran).toBe(0);
  });
  it("a stateful Proxy statement cannot put an unsigned value in a verified verdict", async () => {
    const s = setup();
    const approval = clone(s.chain.documents[s.chain.activationApprovalRef]);
    let reads = 0;
    approval.payload.statement = new Proxy(approval.payload.statement, {
      get(target, key, receiver) {
        if (key === "hostingCandidateFingerprint") { reads += 1; if (reads > 1) return "e".repeat(64); }
        return Reflect.get(target, key, receiver);
      },
    });
    const verdict = await run(s, { activationApproval: approval });
    if (verdict.verdict === "verified") expect(verdict.hostingCandidateFingerprint).toBe(s.chain.hostingCandidateFingerprint);
    expect(verdict.verdict === "verified" && verdict.hostingCandidateFingerprint === "e".repeat(64)).toBe(false);
  });
  it("a Proxy input whose descriptor changes between reads is read once", async () => {
    const s = setup();
    const base = input(s);
    const staging = setup(STAGING, { generation: 7 }, s.keys, s.keys);
    let flips = 0;
    const proxy = new Proxy(base, {
      getOwnPropertyDescriptor(target, key) {
        const d = Reflect.getOwnPropertyDescriptor(target, key);
        if (key === "activationApproval" && d) { flips += 1; if (flips > 1) return { ...d, value: staging.chain.documents[staging.chain.activationApprovalRef] }; }
        return d;
      },
    });
    expect(await createCompositeReleaseAuthorityVerifier(s.deps).verify(proxy)).toEqual(expectedVerdict(s.chain));
  });
  it("mutating the caller's documents during readEvidence cannot change the verdict", async () => {
    const s = setup();
    const docs = { ...s.chain.documents };
    for (const ref of Object.keys(docs)) docs[ref] = clone(docs[ref]);
    const policy = { ...s.chain.policy };
    const read = reader(s.chain, ref => {
      docs[s.chain.activationApprovalRef].payload.statement.hostingCandidateFingerprint = "e".repeat(64);
      docs[s.chain.activationApprovalRef].payload.statement.enabledGeneration = 99;
      policy.generation = 99;
      return s.chain.documents[ref];
    });
    const verdict = await run(s, { policy, activationApproval: docs[s.chain.activationApprovalRef],
      activationEvidence: docs[s.chain.activationEvidenceRef] }, read);
    expect(verdict).toEqual(expectedVerdict(s.chain));
  });
});

// Certification F1: a genuine SDK Timestamp with caller-defined own accessors or data
// properties shadowing the prototype getters was read through those accessors.
describe("policy timestamp (certification F1)", () => {
  const SECONDS = 1767323046;
  const fresh = (): Timestamp => new Timestamp(SECONDS, 0);
  const both = async (s: Setup, updatedAt: unknown): Promise<[string, string]> => {
    const policy = { ...s.chain.policy, updatedAt };
    const adapter = await reason(s, { policy });
    const rest = omit(input(s, { policy }), "readEvidence");
    const core = verifyReleaseAuthorityChain({ ...rest, certification: s.chain.certification }, s.deps);
    return [adapter, core.verdict === "verified" ? "verified" : core.reason];
  };
  it("a legitimate SDK Timestamp is accepted by the core and the adapter", async () => {
    const s = setup();
    expect(await both(s, fresh())).toEqual(["verified", "verified"]);
    // updatedAt is not bound to any signed statement; any legitimate value verifies.
    expect(await both(s, new Timestamp(SECONDS + 7, 999999999))).toEqual(["verified", "verified"]);
  });
  it.each(["seconds", "nanoseconds"])("an own %s getter is refused without running (the demonstrated bypass)", async field => {
    for (const enumerable of [true, false]) {
      const s = setup();
      let ran = 0;
      const ts = fresh();
      const valid = (ts as any)[field];
      Object.defineProperty(ts, field, { get: () => { ran += 1; return valid; }, enumerable, configurable: true });
      expect(await both(s, ts)).toEqual(["inputMismatch", "inputMismatch"]);
      expect(ran).toBe(0);
    }
  });
  it.each(["seconds", "nanoseconds"])("an own %s data property shadowing the prototype getter is refused", async field => {
    const s = setup();
    const ts = fresh();
    Object.defineProperty(ts, field, { value: (ts as any)[field], enumerable: true, writable: true, configurable: true });
    expect(await both(s, ts)).toEqual(["inputMismatch", "inputMismatch"]);
  });
  it("accessor or non-enumerable SDK fields and extra own fields are refused without running", async () => {
    const s = setup();
    let ran = 0;
    const accessor = fresh();
    Object.defineProperty(accessor, "_seconds", { get: () => { ran += 1; return SECONDS; }, enumerable: true, configurable: true });
    const hidden = fresh();
    Object.defineProperty(hidden, "_nanoseconds", { value: 0, enumerable: false });
    const extra = Object.assign(fresh(), { extra: 1 });
    const symbol = Object.assign(fresh(), { [Symbol("s")]: 1 });
    for (const ts of [accessor, hidden, extra, symbol]) expect(await both(s, ts)).toEqual(["inputMismatch", "inputMismatch"]);
    expect(ran).toBe(0);
  });
  it("a hostile subclass, an altered prototype or a forged prototype object cannot bypass validation", async () => {
    const s = setup();
    let ran = 0;
    class Hostile extends Timestamp {}
    Object.defineProperty(Hostile.prototype, "seconds", { get: () => { ran += 1; return SECONDS; } });
    const altered = fresh();
    Object.setPrototypeOf(altered, Object.create(Timestamp.prototype, { seconds: { get: () => { ran += 1; return SECONDS; } } }));
    const forged = Object.create(Timestamp.prototype, { _seconds: { get: () => { ran += 1; return SECONDS; }, enumerable: true },
      _nanoseconds: { value: 0, enumerable: true } });
    const plain = { _seconds: SECONDS, _nanoseconds: 0 };
    for (const ts of [new Hostile(SECONDS, 0), altered, forged, plain, null, SECONDS]) {
      expect(await both(s, ts)).toEqual(["inputMismatch", "inputMismatch"]);
    }
    expect(ran).toBe(0);
  });
  it("out-of-range SDK field values are refused by the rebuilt Timestamp", async () => {
    const s = setup();
    for (const [sec, ns] of [[1.5, 0], [SECONDS, -1], [SECONDS, 1e9], [253402300800, 0], ["1", 0]] as const) {
      const ts = fresh();
      (ts as any)._seconds = sec; (ts as any)._nanoseconds = ns;
      expect(await both(s, ts)).toEqual(["inputMismatch", "inputMismatch"]);
    }
  });
});

// Certification F2: the data-property guard is what stops an endpointName accessor
// from being captured as undefined while the chain still verifies.
describe("input accessor guard (certification F2)", () => {
  it("an endpointName accessor is refused by the adapter and the core without running", async () => {
    const s = setup();
    let ran = 0;
    const adapterInput = { ...input(s) } as Record<string, unknown>;
    Object.defineProperty(adapterInput, "endpointName", { get: () => { ran += 1; return "teacherUnitsList"; }, enumerable: true, configurable: true });
    const adapter = await createCompositeReleaseAuthorityVerifier(s.deps).verify(adapterInput as unknown as ReleaseAuthorityInput);
    expect(adapter).toEqual({ verdict: "unverified", reason: "inputMismatch" });
    const coreInput = { ...omit(input(s), "readEvidence"), certification: s.chain.certification };
    Object.defineProperty(coreInput, "endpointName", { get: () => { ran += 1; return "teacherUnitsList"; }, enumerable: true, configurable: true });
    expect(verifyReleaseAuthorityChain(coreInput, s.deps)).toEqual({ verdict: "unverified", reason: "inputMismatch" });
    expect(ran).toBe(0);
  });
});

describe("readEvidence and caching", () => {
  it("is called exactly once, with the certification reference, after the structure passes", async () => {
    const s = setup();
    const read = reader(s.chain);
    await run(s, {}, read);
    expect(read.calls).toEqual([s.chain.certificationEvidenceRef]);
  });
  it("propagates a thrown or rejected readEvidence error unchanged", async () => {
    const s = setup();
    const error = Object.assign(new Error("aborted"), { code: 10 });
    const verifier = createCompositeReleaseAuthorityVerifier(s.deps);
    await expect(verifier.verify(input(s, { readEvidence: () => { throw error; } }))).rejects.toBe(error);
    await expect(verifier.verify(input(s, { readEvidence: () => Promise.reject(error) }))).rejects.toBe(error);
  });
  it("caches nothing between invocations", async () => {
    const s = setup();
    const verifier = createCompositeReleaseAuthorityVerifier(s.deps);
    const first = reader(s.chain);
    expect(await verifier.verify(input(s, {}, first))).toEqual(expectedVerdict(s.chain));
    expect(await verifier.verify(input(s, {}, reader(s.chain, () => null)))).toEqual({ verdict: "unverified", reason: "certificationUnverified" });
    const third = reader(s.chain);
    expect(await verifier.verify(input(s, {}, third))).toEqual(expectedVerdict(s.chain));
    expect([first.calls.length, third.calls.length]).toEqual([1, 1]);
  });
});

describe("dependencies", () => {
  it("refuses unbranded, missing or extra dependencies and has no defaults", () => {
    const s = setup();
    const copyRegistry = { entries: [...s.deps.registry.entries] };
    const copyList = { identity: s.deps.revocationList.identity, entries: [] };
    for (const bad of [undefined, {}, { registry: s.deps.registry }, { revocationList: s.deps.revocationList },
      { registry: copyRegistry, revocationList: s.deps.revocationList }, { registry: s.deps.registry, revocationList: copyList },
      { ...s.deps, extra: 1 }]) {
      expect(() => createCompositeReleaseAuthorityVerifier(bad as any)).toThrow();
      const rest = omit(input(s), "readEvidence");
      expect(verifyReleaseAuthorityChain({ ...rest, certification: s.chain.certification }, bad as any))
        .toEqual({ verdict: "unverified", reason: "error" });
    }
  });
  it("exports only the core and the factory: no verifier instance", () => {
    expect(Object.keys(CompositeModule).sort()).toEqual(["createCompositeReleaseAuthorityVerifier", "verifyReleaseAuthorityChain"]);
  });
});

// ---------- Not wired (S3) ----------

const SRC = resolve(__dirname, "..");
function sources(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => { for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path); else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) files.push(path);
  } };
  walk(SRC);
  return files;
}
/** Relative-import graph reachable from `entry` over non-test sources. */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [resolve(SRC, entry)];
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/(?:from|import|import\(|require\()\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const base = resolve(file, "..", match[1]);
      for (const candidate of [`${base}.ts`, join(base, "index.ts")]) if (existsSync(candidate)) { queue.push(candidate); break; }
    }
  }
  return new Set([...seen].map(file => relative(SRC, file)));
}
const S1_S2_S3 = ["teacherUnits/a3-composite-verifier.ts", "teacherUnits/a3-signature.ts", "teacherUnits/a3-authority-registry.ts",
  "teacherUnits/a3-ed25519.ts", "teacherUnits/a3-revocation-list.ts"];

describe("not wired (S3)", () => {
  it("no non-test source module imports the composite verifier", () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(50);
    for (const file of files) {
      const name = relative(SRC, file);
      if (name === "teacherUnits/a3-composite-verifier.ts") continue;
      expect([name, /a3-composite-verifier/.test(readFileSync(file, "utf8"))]).toEqual([name, false]);
    }
  });
  it("production entrypoints cannot reach S1, S2 or S3 modules", () => {
    const graph = reachable("index.ts");
    expect(graph.has("teacherUnits/a3-enforcement.ts")).toBe(true);
    expect(graph.has("teacherUnits/a3-release-authority.ts")).toBe(false);
    expect(graph.has("teacherUnits/availability-policy.ts")).toBe(true);
    expect(graph.has("teacherUnits/availability-runtime-build.ts")).toBe(true);
    expect(graph.size).toBeGreaterThan(50);
    for (const module of S1_S2_S3) expect([module, graph.has(module)]).toEqual([module, false]);
  });
  it("the graph walker does see S1 and S2 through S3 (so the check above is meaningful)", () => {
    const graph = reachable("teacherUnits/a3-composite-verifier.ts");
    for (const module of S1_S2_S3) expect([module, graph.has(module)]).toEqual([module, true]);
  });
  it("production uses Option B without verifier fallback and the client gate stays closed", () => {
    expect(PRODUCTION_TEACHER_UNITS_ENFORCEMENT).not.toHaveProperty("verifier");
    expect(PRODUCTION_TEACHER_UNITS_ENFORCEMENT).not.toHaveProperty("provenance");
    expect(typeof PRODUCTION_TEACHER_UNITS_ENFORCEMENT.inspectBuild).toBe("function");
    expect(RUNTIME_PLACEMENT_FINGERPRINT).toMatch(/^[a-f0-9]{64}$/);
    const gate = readFileSync(resolve(SRC, "../../../app/src/teacherUnits/releaseAvailability.ts"), "utf8");
    expect(gate).toMatch(/export function teacherUnitsAvailable\(\): boolean \{ return false; \}/);
    expect(PRODUCTION_AUTHORITY_REGISTRY.entries).toEqual([]);
    expect(PRODUCTION_REVOCATION_LIST.entries).toEqual([]);
  });
  it("the build excludes test files, so no test key, signer or test verifier can reach lib", () => {
    const config = JSON.parse(readFileSync(resolve(SRC, "../tsconfig.build.json"), "utf8"));
    expect(config.exclude).toContain("**/*.test.ts");
    const listed = execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", resolve(SRC, "../tsconfig.build.json"),
      "--listFilesOnly"], { encoding: "utf8" }).split("\n").filter(line => line.includes("/src/"));
    expect(listed.length).toBeGreaterThan(50);
    expect(listed.filter(line => line.endsWith(".test.ts"))).toEqual([]);
    for (const file of sources()) {
      const text = readFileSync(file, "utf8");
      expect([relative(SRC, file), /generateKeyPair|testVerifier|testSigningKey|buildSignedEnabledChain/.test(text)])
        .toEqual([relative(SRC, file), false]);
    }
  });
});
