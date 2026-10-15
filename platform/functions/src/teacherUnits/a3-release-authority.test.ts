import { RELEASE_AUTHORITY_UNVERIFIED_REASONS, UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER,
  parseReleaseAuthorityVerdict } from "./a3-release-authority";
import type { ReleaseAuthorityInput } from "./a3-release-authority";

const ref = (c: string) => `teacherUnitsReleaseEvidence/${c.repeat(64)}`;
const verified = {
  verdict: "verified", releaseId: "a".repeat(64), deploymentApprovalRef: ref("b"), activationEvidenceRef: ref("c"),
  activationApprovalRef: ref("d"), certificationEvidenceRef: ref("e"), hostingCandidateFingerprint: "f".repeat(64),
  policyInstanceId: "123e4567-e89b-42d3-a456-426614174000", enabledGeneration: 3,
};
const ERROR = { verdict: "unverified", reason: "error" };

test("the production verifier is frozen and always unverified", async () => {
  expect(Object.isFrozen(UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER)).toBe(true);
  const verdict = await UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER.verify({} as ReleaseAuthorityInput);
  expect(verdict).toEqual({ verdict: "unverified", reason: "verifierUnconfigured" });
  expect(Object.isFrozen(verdict)).toBe(true);
});

test("parses exact verified and unverified verdicts", () => {
  expect(parseReleaseAuthorityVerdict({ ...verified })).toEqual(verified);
  for (const reason of RELEASE_AUTHORITY_UNVERIFIED_REASONS) {
    expect(parseReleaseAuthorityVerdict({ verdict: "unverified", reason })).toEqual({ verdict: "unverified", reason });
  }
});

class VerdictInstance { verdict = "verified"; }
test.each([
  ["null", null],
  ["string", "verified"],
  ["true", true],
  ["class instance", new VerdictInstance()],
  ["extra field", { ...verified, approved: true }],
  ["missing field", { ...verified, hostingCandidateFingerprint: undefined }],
  ["noncanonical digest", { ...verified, releaseId: "A".repeat(64) }],
  ["generation zero", { ...verified, enabledGeneration: 0 }],
  ["unknown verdict", { ...verified, verdict: "approved" }],
  ["unknown reason", { verdict: "unverified", reason: "trustMe" }],
  ["accessor", Object.defineProperty({ ...verified }, "releaseId", { get: () => "a".repeat(64), enumerable: true })],
])("treats a %s verdict as unverified", (_label, value) => {
  expect(parseReleaseAuthorityVerdict(value)).toEqual(ERROR);
});

test("returns a frozen snapshot that later input mutation cannot change", () => {
  const input: Record<string, unknown> = { ...verified };
  const parsed = parseReleaseAuthorityVerdict(input);
  expect(parsed).not.toBe(input);
  expect(Object.isFrozen(parsed)).toBe(true);
  input.releaseId = "0".repeat(64);
  input.verdict = "unverified";
  delete input.enabledGeneration;
  expect(parsed).toEqual(verified);
  const unverified: Record<string, unknown> = { verdict: "unverified", reason: "revoked" };
  const parsedUnverified = parseReleaseAuthorityVerdict(unverified);
  unverified.verdict = "verified";
  expect(parsedUnverified).toEqual({ verdict: "unverified", reason: "revoked" });
  expect(Object.isFrozen(parsedUnverified)).toBe(true);
});

test("a stateful Proxy cannot present different values after parsing", () => {
  let reads = 0;
  const proxy = new Proxy({ ...verified }, {
    get: (target, key) => (key === "enabledGeneration" && reads++ > 0 ? 99 : Reflect.get(target, key)),
    getOwnPropertyDescriptor: (target, key) => Reflect.getOwnPropertyDescriptor(target, key),
  });
  const parsed = parseReleaseAuthorityVerdict(proxy) as typeof verified;
  expect(parsed).not.toBe(proxy);
  expect(parsed.enabledGeneration).toBe(3);
  expect(parsed.enabledGeneration).toBe(3);
  expect(parsed).toEqual(verified);
});

test("a Proxy whose descriptors change between reads still fails closed or yields one consistent snapshot", () => {
  let n = 0;
  const proxy = new Proxy({ ...verified }, {
    getOwnPropertyDescriptor: (target, key) => {
      const d = Reflect.getOwnPropertyDescriptor(target, key);
      return key === "releaseId" && d && n++ > 0 ? { ...d, value: "not-a-digest" } : d;
    },
  });
  const parsed = parseReleaseAuthorityVerdict(proxy);
  if (parsed.verdict === "verified") expect(parsed.releaseId).toBe("a".repeat(64));
  else expect(parsed).toEqual(ERROR);
  expect(Object.isFrozen(parsed)).toBe(true);
});

describe("exact own-key validation (recertification P3)", () => {
  const unverified = { verdict: "unverified", reason: "revoked" };
  // JSON.parse creates a real own "__proto__" data property (no setter is invoked).
  const withProto = (base: object, protoValue: unknown) =>
    JSON.parse(JSON.stringify({ ...base }).replace(/^\{/, `{"__proto__":${JSON.stringify(protoValue)},`)) as object;

  it.each([null, 0, false, "x", {}])("rejects an extra own __proto__ key (%p) on both verdict kinds", (protoValue) => {
    for (const base of [verified, unverified]) {
      const input = withProto(base, protoValue);
      expect(Object.hasOwn(input, "__proto__")).toBe(true);
      expect(parseReleaseAuthorityVerdict(input)).toEqual(ERROR);
    }
  });

  it("rejects an extra own __proto__ key defined with defineProperty", () => {
    const input = Object.defineProperty({ ...verified }, "__proto__", { value: null, enumerable: true, configurable: true, writable: true });
    expect(parseReleaseAuthorityVerdict(input)).toEqual(ERROR);
  });

  it("rejects extra non-enumerable properties", () => {
    for (const base of [verified, unverified]) {
      const input = Object.defineProperty({ ...base }, "approved", { value: true, enumerable: false });
      expect(parseReleaseAuthorityVerdict(input)).toEqual(ERROR);
    }
    const hiddenRequired = Object.defineProperty({ ...verified }, "releaseId", { value: "a".repeat(64), enumerable: false });
    expect(parseReleaseAuthorityVerdict(hiddenRequired)).toEqual(ERROR);
  });

  it("rejects extra symbol properties", () => {
    for (const base of [verified, unverified]) {
      expect(parseReleaseAuthorityVerdict({ ...base, [Symbol("approved")]: true })).toEqual(ERROR);
      expect(parseReleaseAuthorityVerdict(Object.defineProperty({ ...base }, Symbol.iterator, { value: 1, enumerable: false }))).toEqual(ERROR);
    }
  });

  it("accepts a verdict with exactly the approved keys, as a fresh frozen copy with only those keys", () => {
    for (const base of [verified, unverified]) {
      const input = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
      const parsed = parseReleaseAuthorityVerdict(input);
      expect(parsed).toEqual(base);
      expect(parsed).not.toBe(input);
      expect(Object.isFrozen(parsed)).toBe(true);
      expect(Reflect.ownKeys(parsed).sort()).toEqual(Object.keys(base).sort());
      expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    }
  });

  it("is isolated from input mutation after parsing", () => {
    const input: Record<string, unknown> = JSON.parse(JSON.stringify(verified)) as Record<string, unknown>;
    const parsed = parseReleaseAuthorityVerdict(input);
    input.enabledGeneration = 99; input.extra = true; delete input.releaseId;
    expect(parsed).toEqual(verified);
  });

  it("reads a stateful Proxy once: later values cannot change the verdict, extra keys still refuse", () => {
    let reads = 0;
    const stateful = new Proxy({ ...verified }, {
      getOwnPropertyDescriptor: (t, k) => {
        const d = Reflect.getOwnPropertyDescriptor(t, k);
        return k === "enabledGeneration" && d && reads++ > 1 ? { ...d, value: 99 } : d;
      },
    });
    const parsed = parseReleaseAuthorityVerdict(stateful) as typeof verified;
    expect([3, ERROR.verdict]).toContain(parsed.enabledGeneration ?? parsed.verdict);
    expect(parsed.enabledGeneration === 99).toBe(false);
    const extraKey = new Proxy({ ...verified }, { ownKeys: (t) => [...Reflect.ownKeys(t), "approved"],
      getOwnPropertyDescriptor: (t, k) => k === "approved" ? { value: true, enumerable: true, configurable: true, writable: true } : Reflect.getOwnPropertyDescriptor(t, k) });
    expect(parseReleaseAuthorityVerdict(extraKey)).toEqual(ERROR);
  });
});

describe("single input descriptor capture (final recertification P3)", () => {
  type Counts = { descriptors: Record<string, number>; ownKeys: number; get: number };
  function instrumented(target: object, override?: (key: PropertyKey, read: number, d: PropertyDescriptor | undefined) => PropertyDescriptor | undefined) {
    const counts: Counts = { descriptors: {}, ownKeys: 0, get: 0 };
    const proxy = new Proxy(target, {
      ownKeys: (t) => { counts.ownKeys += 1; return Reflect.ownKeys(t); },
      getOwnPropertyDescriptor: (t, k) => {
        const name = String(k);
        counts.descriptors[name] = (counts.descriptors[name] ?? 0) + 1;
        const d = Reflect.getOwnPropertyDescriptor(t, k);
        return override ? override(k, counts.descriptors[name], d) : d;
      },
      get: (t, k, r) => { counts.get += 1; return Reflect.get(t, k, r); },
    });
    return { proxy, counts };
  }

  it.each([
    ["unverified", { verdict: "unverified", reason: "revoked" }],
    ["verified", verified],
  ])("reads each %s input descriptor exactly once and never reads values through [[Get]]", (_label, base) => {
    const { proxy, counts } = instrumented({ ...base });
    expect(parseReleaseAuthorityVerdict(proxy)).toEqual(base);
    expect(counts.ownKeys).toBe(1);
    expect(counts.descriptors).toEqual(Object.fromEntries(Object.keys(base).map((k) => [k, 1])));
    expect(counts.get).toBe(0);
  });

  it("reads descriptors once even when the input is refused", () => {
    const { proxy, counts } = instrumented({ ...verified, approved: true });
    expect(parseReleaseAuthorityVerdict(proxy)).toEqual(ERROR);
    expect(counts.ownKeys).toBe(1);
    expect(Object.values(counts.descriptors).every((n) => n === 1)).toBe(true);
  });

  it("uses the first descriptor value when successive inspections would differ", () => {
    const { proxy } = instrumented({ verdict: "unverified", reason: "revoked" },
      (k, read, d) => (k === "reason" && d ? { ...d, value: read === 1 ? "revoked" : "signatureUnverified" } : d));
    expect(parseReleaseAuthorityVerdict(proxy)).toEqual({ verdict: "unverified", reason: "revoked" });
    const flips = instrumented({ ...verified },
      (k, read, d) => (k === "enabledGeneration" && d ? { ...d, value: read === 1 ? 3 : 99 } : d));
    expect(parseReleaseAuthorityVerdict(flips.proxy)).toEqual(verified);
  });

  it("fails closed when the first inspection is malformed, even if later ones would be valid", () => {
    const { proxy } = instrumented({ verdict: "unverified", reason: "revoked" },
      (k, read, d) => (k === "reason" && d && read === 1 ? { ...d, value: "trustMe" } : d));
    expect(parseReleaseAuthorityVerdict(proxy)).toEqual(ERROR);
  });

  it("fails closed, without throwing, on hostile Proxies and malformed descriptors", () => {
    const hostile: object[] = [
      new Proxy({}, { ownKeys: () => { throw new Error("ownKeys"); } }),
      new Proxy({}, { getPrototypeOf: () => { throw new Error("proto"); } }),
      new Proxy({ verdict: "unverified", reason: "revoked" }, { getOwnPropertyDescriptor: () => { throw new Error("gopd"); } }),
      new Proxy({ verdict: "unverified", reason: "revoked" }, { getOwnPropertyDescriptor: (t, k) =>
        k === "reason" ? { value: "revoked", get() { return "x"; }, enumerable: true, configurable: true } : Reflect.getOwnPropertyDescriptor(t, k) }),
      Object.defineProperty({ verdict: "unverified" }, "reason", { get: () => "revoked", enumerable: true }),
      Object.defineProperty({ verdict: "unverified" }, "reason", { set: () => undefined, enumerable: true }),
    ];
    for (const input of hostile) {
      expect(() => parseReleaseAuthorityVerdict(input)).not.toThrow();
      expect(parseReleaseAuthorityVerdict(input)).toEqual(ERROR);
    }
  });

  it("does not invoke inherited setters while building the snapshot", () => {
    let calls = 0;
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, "reason");
    Object.defineProperty(Object.prototype, "reason", { set() { calls += 1; }, configurable: true });
    try {
      expect(parseReleaseAuthorityVerdict({ verdict: "unverified", reason: "revoked" })).toEqual({ verdict: "unverified", reason: "revoked" });
      expect(calls).toBe(0);
    } finally {
      if (prior) Object.defineProperty(Object.prototype, "reason", prior);
      else delete (Object.prototype as Record<string, unknown>).reason;
    }
  });
});
