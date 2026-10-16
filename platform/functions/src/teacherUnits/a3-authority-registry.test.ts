// A3-6 S1 artifact-pinned registry (decision record D2 to D4). Test keys are generated
// here only; this file is excluded from the compiled lib by tsconfig.build.json.
import { generateKeyPairSync } from "node:crypto";
import {
  AUTHORITY_ACTIONS, PRODUCTION_AUTHORITY_REGISTRY, createAuthorityRegistry, decodeRawPublicKey, ed25519KeyId,
  findAuthorityEntry, isAuthorityRegistry,
} from "./a3-authority-registry";
import { addEd25519Points, decodeEd25519Point, encodeEd25519Point } from "./a3-ed25519";

function testKey(): { raw: Buffer; b64: string; keyId: string } {
  const { publicKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12);
  return { raw, b64: raw.toString("base64"), keyId: ed25519KeyId(raw) };
}
const STAGING = { environment: "staging", projectId: "lyfelabz-staging", projectNumber: "293337283840" };
function entry(overrides: Record<string, unknown> = {}): Record<string, any> {
  const key = testKey();
  return { schemaVersion: 1, ...STAGING, keyId: key.keyId, publicKeyBase64: key.b64, action: "deploy-backend",
    authorityId: "test-authority", approverSubject: "test-human", approvalSystemId: "test-system", ...overrides };
}
const sorted = (...entries: Record<string, any>[]) => [...entries].sort((a, b) => (a.keyId < b.keyId ? -1 : 1));
const refused = (entries: unknown) => expect(createAuthorityRegistry(entries).ok).toBe(false);

describe("production registry", () => {
  it("is empty and frozen, so no key confers authority", () => {
    expect(PRODUCTION_AUTHORITY_REGISTRY.entries).toHaveLength(0);
    expect(Object.isFrozen(PRODUCTION_AUTHORITY_REGISTRY)).toBe(true);
    expect(Object.isFrozen(PRODUCTION_AUTHORITY_REGISTRY.entries)).toBe(true);
    expect(findAuthorityEntry(PRODUCTION_AUTHORITY_REGISTRY, testKey().keyId)).toBeUndefined();
  });
});

describe("keyId (D3)", () => {
  it("is the lowercase hex SHA-256 of the raw 32-byte public key", () => {
    const key = testKey();
    expect(key.keyId).toMatch(/^[a-f0-9]{64}$/);
    expect(ed25519KeyId(decodeRawPublicKey(key.b64))).toBe(key.keyId);
    expect(() => ed25519KeyId(Buffer.alloc(31))).toThrow();
  });
  it("accepts only canonical padded base64 of exactly 32 bytes", () => {
    const key = testKey();
    expect(() => decodeRawPublicKey(key.b64.slice(0, -1))).toThrow();
    expect(() => decodeRawPublicKey(Buffer.alloc(33).toString("base64"))).toThrow();
    expect(() => decodeRawPublicKey(key.b64.replace(/=$/, "A"))).toThrow();
  });
});

describe("registry construction", () => {
  it("accepts one entry per action and returns frozen copies isolated from the input", () => {
    const entries = sorted(...AUTHORITY_ACTIONS.map(action => entry({ action })));
    const result = createAuthorityRegistry(entries);
    expect(result).toMatchObject({ ok: true, scope: "structure-only", operationalVerification: "unverified" });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.entries).toHaveLength(4);
    expect(result.value.entries.every(e => Object.isFrozen(e))).toBe(true);
    entries[0].authorityId = "changed";
    expect(result.value.entries[0].authorityId).toBe("test-authority");
    expect(findAuthorityEntry(result.value, entries[1].keyId)?.keyId).toBe(entries[1].keyId);
  });

  it("refuses a keyId that is not the digest of the public key", () => {
    refused([entry({ keyId: testKey().keyId })]);
  });

  it("refuses noncanonical or wrong-length public keys", () => {
    const e = entry();
    refused([{ ...e, publicKeyBase64: e.publicKeyBase64.slice(0, -1) }]);
    refused([{ ...e, publicKeyBase64: Buffer.alloc(33).toString("base64") }]);
  });

  it("refuses one key serving two actions or two environments (4b)", () => {
    const e = entry();
    refused([e, { ...e, action: "activate-teacher-units" }]);
    refused([e, { ...e, environment: "production", projectId: "lyfelabz-prod", projectNumber: "182791689935" }]);
  });

  it("requires strictly ascending keyId order", () => {
    const [a, b] = sorted(entry(), entry());
    expect(createAuthorityRegistry([a, b]).ok).toBe(true);
    refused([b, a]);
  });

  it("refuses unknown, missing or accessor fields and unknown actions", () => {
    refused([{ ...entry(), extra: true }]);
    const missing = entry(); delete missing.approvalSystemId; refused([missing]);
    refused([entry({ action: "deploy" })]);
    refused([entry({ schemaVersion: 2 })]);
    const accessor = entry();
    const value = accessor.authorityId;
    Object.defineProperty(accessor, "authorityId", { get: () => value, enumerable: true });
    refused([accessor]);
    refused({});
  });

  it("pins production and staging identities and allows only demo- emulator projects", () => {
    expect(createAuthorityRegistry([entry({ environment: "production", projectId: "lyfelabz-prod", projectNumber: "182791689935" })]).ok).toBe(true);
    refused([entry({ environment: "production", projectId: "lyfelabz-staging", projectNumber: "293337283840" })]);
    refused([entry({ projectNumber: "182791689935" })]);
    expect(createAuthorityRegistry([entry({ environment: "emulator", projectId: "demo-a3-test", projectNumber: "0" })]).ok).toBe(true);
    refused([entry({ environment: "emulator", projectId: "lyfelabz-prod", projectNumber: "0" })]);
    refused([entry({ environment: "emulator", projectId: "demo-a3-test", projectNumber: "1" })]);
  });

  it("refuses automated approver subjects (partial D4 guard)", () => {
    for (const approverSubject of [
      "deployer@lyfelabz-prod.iam.gserviceaccount.com", "182791689935-compute@developer.gserviceaccount.com",
      "serviceAccount:deployer@example.com", "group:release@example.com", "domain:example.com",
      "principal://iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/p/subject/s",
      "principalSet://iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/p/*",
    ]) refused([entry({ approverSubject })]);
    expect(createAuthorityRegistry([entry({ approverSubject: "owner@example.com" })]).ok).toBe(true);
  });
});

describe("remediation: weak public keys (P1)", () => {
  const withKey = (raw: Buffer) => entry({ keyId: ed25519KeyId(raw), publicKeyBase64: raw.toString("base64") });
  // The eight canonical encodings of the small-order (torsion) points.
  const TORSION = ["0100000000000000000000000000000000000000000000000000000000000000",
    "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
    "0000000000000000000000000000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000000000000000000000000080",
    "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
    "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85",
    "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
    "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa"].map(h => Buffer.from(h, "hex"));

  it("refuses all eight small-order keys that would let a fixed signature verify any statement", () => {
    for (const raw of TORSION) refused([withKey(raw)]);
  });

  it("refuses every mixed-order key (honest key plus a non-identity torsion point)", () => {
    const honest = decodeEd25519Point(testKey().raw);
    if (!honest) throw new Error("decode");
    for (const raw of TORSION.slice(1)) {
      const torsion = decodeEd25519Point(raw);
      if (!torsion) throw new Error("decode");
      refused([withKey(encodeEd25519Point(addEd25519Points(honest, torsion)))]);
    }
  });
});

describe("remediation: single input read and branding (P3)", () => {
  it("stores exactly the snapshot it validated, so a stateful Proxy cannot store an unvalidated value", () => {
    for (const later of ["not-an-action", "activate-teacher-units"]) {
      const target = entry({ action: "deploy-backend" });
      let reads = 0;
      const proxy = new Proxy(target, { get(t, k, r) {
        if (k === "action") { reads++; return reads > 1 ? later : t.action; }
        return Reflect.get(t, k, r);
      } });
      const result = createAuthorityRegistry([proxy]);
      if (later === "not-an-action") expect(result.ok && (result.value.entries[0].action as string) === later).toBe(false);
      if (result.ok) {
        const stored = result.value.entries[0];
        expect(Object.isFrozen(stored)).toBe(true);
        // The stored entry is a private copy: later reads of the input cannot change it.
        const seen = stored.action;
        void proxy.action;
        expect(stored.action).toBe(seen);
        expect(createAuthorityRegistry([{ ...stored }]).ok).toBe(true);
      }
    }
  });

  it("refuses unreadable input", () => {
    const cyclic: any[] = []; cyclic.push(cyclic);
    refused(cyclic);
    refused([entry({ schemaVersion: 1n })]);
  });

  it("recognizes only registries it produced", () => {
    const valid = entry();
    const result = createAuthorityRegistry([valid]);
    if (!result.ok) throw new Error("unreachable");
    expect(isAuthorityRegistry(result.value)).toBe(true);
    expect(isAuthorityRegistry(PRODUCTION_AUTHORITY_REGISTRY)).toBe(true);
    const handBuilt = Object.freeze({ entries: Object.freeze([Object.freeze({ ...valid })]) });
    expect(isAuthorityRegistry(handBuilt)).toBe(false);
    expect(findAuthorityEntry(handBuilt, valid.keyId)).toBeUndefined();
    expect(findAuthorityEntry({ ...result.value }, valid.keyId)).toBeUndefined();
    expect(findAuthorityEntry(result.value, valid.keyId)?.keyId).toBe(valid.keyId);
  });
});
