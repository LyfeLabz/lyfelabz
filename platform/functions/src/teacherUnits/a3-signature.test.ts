// A3-6 S1 approval signature verification (decision record D2 to D4). Test keys and
// signatures are generated here only; this file is excluded from the compiled lib.
import { generateKeyPairSync, sign, verify } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { approvalSigningBytes, canonicalJSON, contentDigest } from "./a3-canonical";
import type { ExpectedEnvironment } from "./a3-contracts";
import * as RegistryModule from "./a3-authority-registry";
import { PRODUCTION_AUTHORITY_REGISTRY, createAuthorityRegistry, ed25519KeyId } from "./a3-authority-registry";
import type { AuthorityAction, AuthorityRegistry } from "./a3-authority-registry";
import { ED25519_GROUP_ORDER } from "./a3-ed25519";
import { verifyApprovalSignature } from "./a3-signature";

const fixture = JSON.parse(readFileSync(resolve(__dirname, "../../../../fixtures/teacher-units-a3/v1.json"), "utf8"));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const STAGING: ExpectedEnvironment = { environment: "staging", projectId: "lyfelabz-staging", projectNumber: "293337283840" };

type TestKey = { privateKey: KeyObject; b64: string; keyId: string };
function testKey(): TestKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12);
  return { privateKey, b64: raw.toString("base64"), keyId: ed25519KeyId(raw) };
}
function registry(...entries: Array<{ key: TestKey; action: AuthorityAction; overrides?: Record<string, unknown>;
  identity?: ExpectedEnvironment }>): AuthorityRegistry {
  const records = entries.map(({ key, action, overrides, identity }) => ({
    schemaVersion: 1, ...(identity ?? STAGING), keyId: key.keyId, publicKeyBase64: key.b64, action,
    authorityId: "test-authority", approverSubject: "test-human", approvalSystemId: "test-system", ...overrides,
  })).sort((a, b) => (a.keyId < b.keyId ? -1 : 1));
  const result = createAuthorityRegistry(records);
  if (!result.ok) throw new Error(result.issue.reason);
  return result.value;
}
/** Signs the statement (optionally edited first) with the given key, recomputing the statement digest. */
function signed(name: string, key: TestKey, edit: (statement: any) => void = () => undefined): any {
  const doc = clone(fixture.valid[name]);
  edit(doc.payload.statement);
  doc.payload.source.statementObject.sha256 = contentDigest(doc.payload.statement);
  doc.payload.source.signerKeyId = key.keyId;
  doc.payload.source.signatureBase64 = sign(null, approvalSigningBytes(doc.payload.statement), key.privateKey).toString("base64");
  return doc;
}
const CASES: Array<[string, AuthorityAction]> = [
  ["deploymentApproval", "deploy-backend"],
  ["activationApproval", "activate-teacher-units"],
  ["approvalDisposition", "dispose-approval"],
];

describe("verified signatures", () => {
  test.each(CASES)("%s verifies against a matching per-action entry", (name, action) => {
    const key = testKey();
    const result = verifyApprovalSignature(signed(name, key), registry({ key, action }), STAGING);
    expect(result).toEqual({ verdict: "verified", keyId: key.keyId, action, authorityId: "test-authority" });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("does not bind audit-only authority fields", () => {
    const key = testKey();
    const doc = signed("deploymentApproval", key, s => { s.authority.workflowRunId = "another-run"; s.authority.decisionId = "another-decision"; });
    expect(verifyApprovalSignature(doc, registry({ key, action: "deploy-backend" }), STAGING).verdict).toBe("verified");
  });
});

describe("authority", () => {
  it("the empty production registry recognizes no signer", () => {
    const key = testKey();
    expect(verifyApprovalSignature(signed("deploymentApproval", key), PRODUCTION_AUTHORITY_REGISTRY, STAGING))
      .toEqual({ verdict: "unverified", reason: "authorityUnrecognized" });
  });

  it("refuses unknown and non-digest key identifiers", () => {
    const key = testKey();
    const reg = registry({ key, action: "deploy-backend" });
    const unknown = signed("deploymentApproval", testKey());
    expect(verifyApprovalSignature(unknown, reg, STAGING)).toEqual({ verdict: "unverified", reason: "authorityUnrecognized" });
    const fixtureKeyId = clone(fixture.valid.deploymentApproval);
    expect(verifyApprovalSignature(fixtureKeyId, reg, STAGING)).toEqual({ verdict: "unverified", reason: "authorityUnrecognized" });
  });

  test.each(CASES)("a key registered for another action cannot sign %s (4b)", (name, action) => {
    const key = testKey();
    const other = CASES.map(c => c[1]).find(a => a !== action) as AuthorityAction;
    expect(verifyApprovalSignature(signed(name, key), registry({ key, action: other }), STAGING))
      .toEqual({ verdict: "unverified", reason: "authorityUnrecognized" });
  });

  it("a certify-release key cannot sign any approval kind", () => {
    const key = testKey();
    for (const [name] of CASES)
      expect(verifyApprovalSignature(signed(name, key), registry({ key, action: "certify-release" }), STAGING).verdict).toBe("unverified");
  });

  test.each(["authorityId", "approverSubject", "approvalSystemId"])("refuses a statement whose %s differs from the entry", field => {
    const key = testKey();
    const doc = signed("deploymentApproval", key, s => { s.authority[field] = "someone-else"; });
    expect(verifyApprovalSignature(doc, registry({ key, action: "deploy-backend" }), STAGING))
      .toEqual({ verdict: "unverified", reason: "authorityUnrecognized" });
  });

  it("refuses a key registered for another environment", () => {
    const key = testKey();
    const reg = registry({ key, action: "deploy-backend",
      overrides: { environment: "production", projectId: "lyfelabz-prod", projectNumber: "182791689935" } });
    expect(verifyApprovalSignature(signed("deploymentApproval", key), reg, STAGING))
      .toEqual({ verdict: "unverified", reason: "authorityUnrecognized" });
  });
});

describe("signatures", () => {
  it("refuses a statement altered after signing, even with a recomputed digest", () => {
    const key = testKey();
    const doc = signed("deploymentApproval", key);
    doc.payload.statement.issuedAt = "2030-01-01T00:00:00.000000000Z";
    doc.payload.source.statementObject.sha256 = contentDigest(doc.payload.statement);
    expect(verifyApprovalSignature(doc, registry({ key, action: "deploy-backend" }), STAGING))
      .toEqual({ verdict: "unverified", reason: "signatureUnverified" });
  });

  it("refuses a signature over the statement without the domain prefix", () => {
    const key = testKey();
    const doc = signed("deploymentApproval", key);
    doc.payload.source.signatureBase64 = sign(null, Buffer.from(canonicalJSON(doc.payload.statement), "utf8"), key.privateKey).toString("base64");
    expect(verifyApprovalSignature(doc, registry({ key, action: "deploy-backend" }), STAGING))
      .toEqual({ verdict: "unverified", reason: "signatureUnverified" });
  });

  it("refuses the synthetic zero signature and a signature from another key claiming the keyId", () => {
    const key = testKey();
    const reg = registry({ key, action: "deploy-backend" });
    const zero = signed("deploymentApproval", key);
    zero.payload.source.signatureBase64 = Buffer.alloc(64).toString("base64");
    expect(verifyApprovalSignature(zero, reg, STAGING)).toEqual({ verdict: "unverified", reason: "signatureUnverified" });
    const impostor = signed("deploymentApproval", testKey());
    impostor.payload.source.signerKeyId = key.keyId;
    expect(verifyApprovalSignature(impostor, reg, STAGING)).toEqual({ verdict: "unverified", reason: "signatureUnverified" });
  });

  it("refuses a signature reused across approval kinds", () => {
    const key = testKey();
    const reg = registry({ key, action: "activate-teacher-units" });
    const deployment = signed("deploymentApproval", key);
    const activation = signed("activationApproval", key);
    activation.payload.source.signatureBase64 = deployment.payload.source.signatureBase64;
    expect(verifyApprovalSignature(activation, reg, STAGING)).toEqual({ verdict: "unverified", reason: "signatureUnverified" });
  });

  it("refuses a malleated signature whose scalar S is not below the group order L", () => {
    const key = testKey();
    const reg = registry({ key, action: "deploy-backend" });
    const doc = signed("deploymentApproval", key);
    const original = Buffer.from(doc.payload.source.signatureBase64, "base64");
    const s = BigInt(`0x${Buffer.from(original.subarray(32)).reverse().toString("hex")}`);
    // S + L is the same scalar mod L, so a verifier that reduced S would accept it.
    const malleated = Buffer.concat([original.subarray(0, 32), Buffer.from((s + ED25519_GROUP_ORDER).toString(16).padStart(64, "0"), "hex").reverse()]);
    expect(malleated.equals(original)).toBe(false);
    expect(verify(null, approvalSigningBytes(doc.payload.statement), RegistryModule.ed25519PublicKeyObject(
      RegistryModule.decodeRawPublicKey(key.b64)), malleated)).toBe(false);
    doc.payload.source.signatureBase64 = malleated.toString("base64");
    expect(verifyApprovalSignature(doc, reg, STAGING)).toEqual({ verdict: "unverified", reason: "signatureUnverified" });
  });
});

describe("input", () => {
  it("refuses an expected identity other than the statement's", () => {
    const key = testKey();
    const emulator = fixture.expectedEmulator as ExpectedEnvironment;
    expect(verifyApprovalSignature(signed("deploymentApproval", key), registry({ key, action: "deploy-backend" }), emulator))
      .toEqual({ verdict: "unverified", reason: "inputMismatch" });
  });

  it("refuses structurally invalid, unknown-kind, digest-mismatched and non-plain input", () => {
    const key = testKey();
    const reg = registry({ key, action: "deploy-backend" });
    const mismatch = signed("deploymentApproval", key);
    mismatch.payload.source.statementObject.sha256 = "0".repeat(64);
    const activationEvidence = clone(fixture.valid.activationEvidence);
    const accessor = signed("deploymentApproval", key);
    const payload = accessor.payload;
    Object.defineProperty(accessor, "payload", { get: () => payload, enumerable: true });
    for (const input of [mismatch, activationEvidence, accessor, null, "x", [], { schemaVersion: 1 }])
      expect(verifyApprovalSignature(input, reg, STAGING)).toEqual({ verdict: "unverified", reason: "inputMismatch" });
  });
});

describe("environments", () => {
  const PRODUCTION: ExpectedEnvironment = { environment: "production", projectId: "lyfelabz-prod", projectNumber: "182791689935" };
  const EMULATOR: ExpectedEnvironment = { environment: "emulator", projectId: "demo-a3-test", projectNumber: "0" };
  const rebind = (identity: ExpectedEnvironment) => (s: any) => {
    s.environment = identity.environment; s.projectId = identity.projectId; s.projectNumber = identity.projectNumber;
  };

  test.each([["production", PRODUCTION], ["emulator", EMULATOR]] as const)("verifies a %s statement against a %s entry only", (_name, identity) => {
    const key = testKey();
    const doc = signed("activationApproval", key, rebind(identity));
    const expectedIdentity = identity.environment === "emulator" ? fixture.expectedEmulator as ExpectedEnvironment : identity;
    expect(verifyApprovalSignature(doc, registry({ key, action: "activate-teacher-units", identity }), expectedIdentity).verdict).toBe("verified");
    expect(verifyApprovalSignature(doc, registry({ key, action: "activate-teacher-units" }), expectedIdentity))
      .toEqual({ verdict: "unverified", reason: "authorityUnrecognized" });
  });
});

describe("remediation (P1, P3)", () => {
  it("a hand-built registry is never trusted, even with a small-order key and the universal forgery", () => {
    const identity = Buffer.alloc(32); identity[0] = 1;
    const keyId = ed25519KeyId(identity);
    const handBuilt = { entries: [{ schemaVersion: 1, ...STAGING, keyId, publicKeyBase64: identity.toString("base64"),
      action: "deploy-backend", authorityId: "test-authority", approverSubject: "test-human", approvalSystemId: "test-system" }] };
    const doc = clone(fixture.valid.deploymentApproval);
    doc.payload.source.signerKeyId = keyId;
    doc.payload.source.signatureBase64 = Buffer.concat([identity, Buffer.alloc(32)]).toString("base64");
    expect(verifyApprovalSignature(doc, handBuilt, STAGING)).toEqual({ verdict: "unverified", reason: "authorityUnrecognized" });
    expect(createAuthorityRegistry(handBuilt.entries).ok).toBe(false);
  });
});

describe("single input snapshot (recertification P3-1)", () => {
  const PRODUCTION: ExpectedEnvironment = { environment: "production", projectId: "lyfelabz-prod", projectNumber: "182791689935" };

  it("a changing input cannot present a staging-signed statement as valid for production", () => {
    const key = testKey();
    const reg = registry({ key, action: "deploy-backend" });
    const staging = signed("deploymentApproval", key);
    const production = { ...staging.payload.statement, ...PRODUCTION };
    // Digest of the production statement, signature of the staging one.
    const source = { ...staging.payload.source,
      statementObject: { ...staging.payload.source.statementObject, sha256: contentDigest(production) } };
    const outcomes = new Set<string>();
    // Every switch point: the first `switchAt` reads of `statement` see production, later reads see staging.
    for (let switchAt = 0; switchAt <= 24; switchAt++) {
      let reads = 0;
      const payload = new Proxy({ ...staging.payload, statement: production, source }, {
        get(target, property, receiver) {
          if (property === "statement") return reads++ < switchAt ? production : staging.payload.statement;
          return Reflect.get(target, property, receiver);
        },
      });
      const result = verifyApprovalSignature({ schemaVersion: 1, payload }, reg, PRODUCTION);
      expect([switchAt, result.verdict]).toEqual([switchAt, "unverified"]);
      outcomes.add(result.verdict === "unverified" ? result.reason : result.verdict);
    }
    // Never switching is the coherent production statement: no production signer exists.
    expect(outcomes.has("authorityUnrecognized")).toBe(true);
    // The genuine staging approval still verifies only for staging.
    expect(verifyApprovalSignature(staging, reg, STAGING).verdict).toBe("verified");
  });
});

describe("identity binding (recertification P3-2)", () => {
  const EMULATOR = fixture.expectedEmulator as ExpectedEnvironment;
  const emulatorIdentity: ExpectedEnvironment = { environment: "emulator", projectId: EMULATOR.projectId, projectNumber: "0" };
  afterEach(() => jest.restoreAllMocks());

  it("an emulator entry for another demo- project cannot sign (projectId)", () => {
    const key = testKey();
    const doc = signed("activationApproval", key, s => Object.assign(s, emulatorIdentity));
    const other = registry({ key, action: "activate-teacher-units", identity: { ...emulatorIdentity, projectId: "demo-other-project" } });
    expect(verifyApprovalSignature(doc, other, EMULATOR)).toEqual({ verdict: "unverified", reason: "authorityUnrecognized" });
    const same = registry({ key, action: "activate-teacher-units", identity: emulatorIdentity });
    expect(verifyApprovalSignature(doc, same, EMULATOR).verdict).toBe("verified");
  });

  it("pinned identities make an entry differing only in environment or projectNumber unconstructible", () => {
    const key = testKey();
    for (const identity of [
      { environment: "emulator", projectId: "lyfelabz-staging", projectNumber: "293337283840" },
      { environment: "production", projectId: "lyfelabz-staging", projectNumber: "293337283840" },
      { environment: "staging", projectId: "lyfelabz-staging", projectNumber: "182791689935" },
      { environment: "staging", projectId: "demo-a3-test", projectNumber: "0" },
      { environment: "emulator", projectId: "demo-a3-test", projectNumber: "293337283840" },
    ]) expect(createAuthorityRegistry([{ schemaVersion: 1, ...identity, keyId: key.keyId, publicKeyBase64: key.b64,
      action: "deploy-backend", authorityId: "test-authority", approverSubject: "test-human", approvalSystemId: "test-system" }]).ok).toBe(false);
  });

  // Defense in depth: the verifier's own comparisons must refuse an entry that differs
  // in exactly one identity field, even though registry validation cannot produce one.
  test.each([
    ["staging", "environment", "production"], ["staging", "projectId", "lyfelabz-prod"], ["staging", "projectNumber", "182791689935"],
    ["emulator", "environment", "staging"], ["emulator", "projectId", "demo-other-project"], ["emulator", "projectNumber", "1"],
  ] as const)("%s entry differing only in %s is refused by the verifier", (environment, field, value) => {
    const key = testKey();
    const identity = environment === "emulator" ? emulatorIdentity : STAGING;
    const expected = environment === "emulator" ? EMULATOR : STAGING;
    const doc = signed("activationApproval", key, s => Object.assign(s, identity));
    const reg = registry({ key, action: "activate-teacher-units", identity });
    const real = RegistryModule.findAuthorityEntry(reg, key.keyId);
    if (!real) throw new Error("unreachable");
    const lookup = jest.spyOn(RegistryModule, "findAuthorityEntry").mockReturnValue(real);
    expect(verifyApprovalSignature(doc, reg, expected).verdict).toBe("verified");
    lookup.mockReturnValue(Object.freeze({ ...real, [field]: value }));
    expect(verifyApprovalSignature(doc, reg, expected)).toEqual({ verdict: "unverified", reason: "authorityUnrecognized" });
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});

describe("release certification signatures (S2, D7)", () => {
  const PRODUCTION: ExpectedEnvironment = { environment: "production", projectId: "lyfelabz-prod", projectNumber: "182791689935" };
  const unrecognized = { verdict: "unverified", reason: "authorityUnrecognized" };

  it("verifies against a matching certify-release entry", () => {
    const key = testKey();
    const result = verifyApprovalSignature(signed("releaseCertification", key), registry({ key, action: "certify-release" }), STAGING);
    expect(result).toEqual({ verdict: "verified", keyId: key.keyId, action: "certify-release", authorityId: "test-authority" });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test.each(["deploy-backend", "activate-teacher-units", "dispose-approval"] as AuthorityAction[])("a %s key cannot sign a certification (4b)", action => {
    const key = testKey();
    expect(verifyApprovalSignature(signed("releaseCertification", key), registry({ key, action }), STAGING)).toEqual(unrecognized);
  });

  it("the empty production registry recognizes no certifier", () => {
    const key = testKey();
    const doc = signed("releaseCertification", key, s => { Object.assign(s, PRODUCTION); });
    expect(verifyApprovalSignature(doc, PRODUCTION_AUTHORITY_REGISTRY, PRODUCTION)).toEqual(unrecognized);
  });

  test.each(["authorityId", "approverSubject", "approvalSystemId"])("refuses a certification whose %s differs from the entry", field => {
    const key = testKey();
    const doc = signed("releaseCertification", key, s => { s.authority[field] = "someone-else"; });
    expect(verifyApprovalSignature(doc, registry({ key, action: "certify-release" }), STAGING)).toEqual(unrecognized);
  });

  it("refuses cross-environment replay and cross-project confusion", () => {
    const key = testKey();
    const staging = signed("releaseCertification", key);
    expect(verifyApprovalSignature(staging, registry({ key, action: "certify-release" }), PRODUCTION))
      .toEqual({ verdict: "unverified", reason: "inputMismatch" });
    expect(verifyApprovalSignature(staging, registry({ key, action: "certify-release", identity: PRODUCTION }), STAGING)).toEqual(unrecognized);
    const production = signed("releaseCertification", key, s => { Object.assign(s, PRODUCTION); });
    expect(verifyApprovalSignature(production, registry({ key, action: "certify-release", identity: PRODUCTION }), PRODUCTION).verdict).toBe("verified");
    // Relabelling a staging-signed statement as production breaks the signature.
    const relabelled = clone(staging); Object.assign(relabelled.payload.statement, PRODUCTION);
    relabelled.payload.source.statementObject.sha256 = contentDigest(relabelled.payload.statement);
    expect(verifyApprovalSignature(relabelled, registry({ key, action: "certify-release", identity: PRODUCTION }), PRODUCTION))
      .toEqual({ verdict: "unverified", reason: "signatureUnverified" });
    const emulator = fixture.expectedEmulator as ExpectedEnvironment;
    const other = signed("releaseCertification", key, s => { s.environment = "emulator"; s.projectId = emulator.projectId; s.projectNumber = "0"; });
    expect(verifyApprovalSignature(other, registry({ key, action: "certify-release",
      identity: { environment: "emulator", projectId: "demo-a3-other", projectNumber: "0" } }), emulator)).toEqual(unrecognized);
  });

  it("refuses a forged certification: altered release, zero signature, reused approval signature", () => {
    const key = testKey();
    const reg = registry({ key, action: "certify-release" });
    const altered = signed("releaseCertification", key);
    altered.payload.statement.backendReleaseId = "f".repeat(64);
    altered.payload.source.statementObject.sha256 = contentDigest(altered.payload.statement);
    expect(verifyApprovalSignature(altered, reg, STAGING)).toEqual({ verdict: "unverified", reason: "signatureUnverified" });
    const zero = clone(fixture.valid.releaseCertification); zero.payload.source.signerKeyId = key.keyId;
    expect(verifyApprovalSignature(zero, reg, STAGING)).toEqual({ verdict: "unverified", reason: "signatureUnverified" });
    const reused = signed("releaseCertification", key);
    reused.payload.source.signatureBase64 = signed("activationApproval", key).payload.source.signatureBase64;
    expect(verifyApprovalSignature(reused, reg, STAGING)).toEqual({ verdict: "unverified", reason: "signatureUnverified" });
  });

  it("refuses a malleated certification signature (S + L)", () => {
    const key = testKey();
    const doc = signed("releaseCertification", key);
    const original = Buffer.from(doc.payload.source.signatureBase64, "base64");
    const s = BigInt(`0x${Buffer.from(original.subarray(32)).reverse().toString("hex")}`);
    const malleated = Buffer.concat([original.subarray(0, 32), Buffer.from((s + ED25519_GROUP_ORDER).toString(16).padStart(64, "0"), "hex").reverse()]);
    doc.payload.source.signatureBase64 = malleated.toString("base64");
    expect(verifyApprovalSignature(doc, registry({ key, action: "certify-release" }), STAGING))
      .toEqual({ verdict: "unverified", reason: "signatureUnverified" });
  });

  it("refuses malformed, mislabelled and accessor-based certification input", () => {
    const key = testKey();
    const reg = registry({ key, action: "certify-release" });
    const mislabelled = signed("releaseCertification", key); mislabelled.payload.kind = "teacher-units-activation-approval";
    const wrongAction = signed("releaseCertification", key, st => { st.action = "activate-teacher-units"; });
    const extra = signed("releaseCertification", key, st => { st.enabledGeneration = 3; });
    const digestMismatch = signed("releaseCertification", key); digestMismatch.payload.source.statementObject.sha256 = "0".repeat(64);
    const accessor = signed("releaseCertification", key); const statement = accessor.payload.statement;
    Object.defineProperty(accessor.payload, "statement", { get: () => statement, enumerable: true });
    for (const input of [mislabelled, wrongAction, extra, digestMismatch, accessor])
      expect(verifyApprovalSignature(input, reg, STAGING)).toEqual({ verdict: "unverified", reason: "inputMismatch" });
  });

  it("a validly signed certification whose report is its own statement object is refused (F3)", () => {
    const key = testKey();
    const doc = signed("releaseCertification", key, st => {
      st.certificationReport = { ...fixture.valid.releaseCertification.payload.source.statementObject, sha256: "9".repeat(64) };
    });
    expect(verifyApprovalSignature(doc, registry({ key, action: "certify-release" }), STAGING))
      .toEqual({ verdict: "unverified", reason: "inputMismatch" });
  });

  it("the S1 approval kinds and their actions are unchanged", () => {
    for (const [name, action] of CASES) {
      const key = testKey();
      expect(verifyApprovalSignature(signed(name, key), registry({ key, action }), STAGING).verdict).toBe("verified");
      expect(verifyApprovalSignature(signed(name, key), registry({ key, action: "certify-release" }), STAGING)).toEqual(unrecognized);
    }
  });
});

describe("not wired (S1)", () => {
  it("no non-test source module outside S1 and S2 imports the registry, signature, curve or revocation modules", () => {
    const root = resolve(__dirname, "..");
    const S1 = new Set(["teacherUnits/a3-signature.ts", "teacherUnits/a3-authority-registry.ts", "teacherUnits/a3-ed25519.ts",
      "teacherUnits/a3-revocation-list.ts",
      // A3-6 S3 (owner decision O5): the unwired composite verifier; its own not-wired and
      // production-reachability tests live in a3-composite-verifier.test.ts.
      "teacherUnits/a3-composite-verifier.ts"]);
    const files: string[] = [];
    const walk = (dir: string): void => { for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path); else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) files.push(path);
    } };
    walk(root);
    expect(files.length).toBeGreaterThan(50);
    for (const file of files) {
      if (S1.has(relative(root, file))) continue;
      expect([relative(root, file), /a3-signature|a3-authority-registry|a3-ed25519|a3-revocation-list/.test(readFileSync(file, "utf8"))])
        .toEqual([relative(root, file), false]);
    }
  });
});
