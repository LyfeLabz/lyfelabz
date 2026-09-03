import {
  LAUNCH_GRANT_TTL_MS,
  assertLaunchGrantPairInvariant,
  computeGrantExpiryMs,
  isValidGrantId,
} from "./launch-grant";

// F5.2 §3.6 - launch-grant contract unit tests (grant-id format, the
// both-or-neither pair invariant, and the 6-hour TTL derivation).

describe("launch-grant: grant-id format (§3.6)", () => {
  it("accepts exactly 32 lowercase hex chars", () => {
    expect(isValidGrantId("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isValidGrantId("f".repeat(32))).toBe(true);
  });

  it("rejects wrong length, uppercase, non-hex, and non-strings", () => {
    expect(isValidGrantId("abc")).toBe(false);
    expect(isValidGrantId("a".repeat(31))).toBe(false);
    expect(isValidGrantId("a".repeat(33))).toBe(false);
    expect(isValidGrantId("A".repeat(32))).toBe(false); // uppercase
    expect(isValidGrantId("g".repeat(32))).toBe(false); // non-hex
    expect(isValidGrantId(`${"a".repeat(31)}-`)).toBe(false);
    expect(isValidGrantId(123)).toBe(false);
    expect(isValidGrantId(undefined)).toBe(false);
  });
});

describe("launch-grant: pair invariant (§3.6/§8.1)", () => {
  it("accepts a differentiated grant with BOTH fields", () => {
    expect(() =>
      assertLaunchGrantPairInvariant({
        outcomeAtIssuance: "differentiated",
        variantKey: "reading-adapted",
        presentationRevisionId: `pr${"a".repeat(64)}`,
      }),
    ).not.toThrow();
  });

  it("accepts a canonicalFallback grant with NEITHER field", () => {
    expect(() =>
      assertLaunchGrantPairInvariant({ outcomeAtIssuance: "canonicalFallback" }),
    ).not.toThrow();
  });

  it("rejects a differentiated grant missing the pair", () => {
    expect(() =>
      assertLaunchGrantPairInvariant({ outcomeAtIssuance: "differentiated" }),
    ).toThrow();
  });

  it("rejects a canonicalFallback grant carrying a (fake/stale) pair", () => {
    expect(() =>
      assertLaunchGrantPairInvariant({
        outcomeAtIssuance: "canonicalFallback",
        variantKey: "reading-adapted",
        presentationRevisionId: `pr${"a".repeat(64)}`,
      }),
    ).toThrow();
  });

  it("rejects exactly one field present (both-or-neither)", () => {
    expect(() =>
      assertLaunchGrantPairInvariant({
        outcomeAtIssuance: "differentiated",
        variantKey: "reading-adapted",
      }),
    ).toThrow();
    expect(() =>
      assertLaunchGrantPairInvariant({
        outcomeAtIssuance: "differentiated",
        presentationRevisionId: `pr${"a".repeat(64)}`,
      }),
    ).toThrow();
  });
});

describe("launch-grant: TTL (§3.6)", () => {
  it("is exactly 6 hours", () => {
    expect(LAUNCH_GRANT_TTL_MS).toBe(6 * 60 * 60 * 1000);
  });

  it("derives expiry as issuedAt + TTL", () => {
    const issued = 1_700_000_000_000;
    expect(computeGrantExpiryMs(issued)).toBe(issued + LAUNCH_GRANT_TTL_MS);
  });
});
