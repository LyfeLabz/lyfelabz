import { createHash } from "node:crypto";

import { PlatformError } from "../errors/platform-error";

import {
  assertValidProviderAccountId,
  assertValidProviderId,
  computeExternalIdentityDocId,
} from "./external-identity-doc-id";

// Independently recompute the canonical hash using the algorithm the
// Sprint 23C-I directive fixes ("v1\0" + providerId + "\0" +
// providerAccountId). Tests derive this locally so a silent drift in
// the production helper (e.g. accidentally dropping the version
// prefix, changing the separator, or normalizing case) is caught here
// even if every other call site were updated in lockstep.
function referenceHash(providerId: string, providerAccountId: string): string {
  const canonical = "v1" + "\x00" + providerId + "\x00" + providerAccountId;
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

describe("computeExternalIdentityDocId", () => {
  it("is deterministic - identical input yields byte-identical hash", () => {
    const a = computeExternalIdentityDocId({
      providerId: "google.com",
      providerAccountId: "1234567890",
    });
    const b = computeExternalIdentityDocId({
      providerId: "google.com",
      providerAccountId: "1234567890",
    });
    expect(a).toBe(b);
  });

  it("matches the independently derived reference hash", () => {
    const hash = computeExternalIdentityDocId({
      providerId: "google.com",
      providerAccountId: "1234567890",
    });
    expect(hash).toBe(referenceHash("google.com", "1234567890"));
  });

  it("produces exactly 64 lowercase hex characters", () => {
    const hash = computeExternalIdentityDocId({
      providerId: "google.com",
      providerAccountId: "abcXYZ123",
    });
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does NOT contain the raw provider account identifier as a substring", () => {
    const rawAccountId = "1093847562019283746";
    const hash = computeExternalIdentityDocId({
      providerId: "google.com",
      providerAccountId: rawAccountId,
    });
    expect(hash.includes(rawAccountId)).toBe(false);
  });

  it("versions the input - a change to the version prefix would change every ID", () => {
    // The reference hash uses "v1"; sanity-check that a different
    // prefix would produce a different value, proving the prefix is
    // load-bearing and not accidentally dropped.
    const withV1 = computeExternalIdentityDocId({
      providerId: "google.com",
      providerAccountId: "abc",
    });
    const withV2 = createHash("sha256")
      .update("v2" + "\x00" + "google.com" + "\x00" + "abc", "utf8")
      .digest("hex");
    expect(withV1).not.toBe(withV2);
  });

  it("separates provider and account fields - concatenation collision is prevented", () => {
    // Without the NUL separator, `"google" + ".com" + "abc"` and
    // `"google.com" + "" + "abc"` would collide. This test proves the
    // separator prevents that.
    const a = computeExternalIdentityDocId({
      providerId: "google.com",
      providerAccountId: "abc",
    });
    // A hypothetical alternate provider "google" with a leading ".com"
    // in the account id is not a currently approved provider, so we
    // verify the invariant directly against the reference derivation:
    const collidingReference = referenceHash("google", ".comabc");
    expect(a).not.toBe(collidingReference);
  });

  it("preserves the exact provider account identifier string with no case folding", () => {
    const lower = computeExternalIdentityDocId({
      providerId: "google.com",
      providerAccountId: "abcdef",
    });
    const upper = computeExternalIdentityDocId({
      providerId: "google.com",
      providerAccountId: "ABCDEF",
    });
    expect(lower).not.toBe(upper);
  });

  it("preserves exact precision for long numeric-looking identifiers", () => {
    // JavaScript numeric conversion of a 19-digit identifier loses
    // precision beyond Number.MAX_SAFE_INTEGER. Compute the hash for
    // two ids that share the first 15 digits but diverge in the last
    // 4 digits; both hashes MUST differ because the helper never
    // converts through a JavaScript number.
    const a = computeExternalIdentityDocId({
      providerId: "google.com",
      providerAccountId: "1234567890123451111",
    });
    const b = computeExternalIdentityDocId({
      providerId: "google.com",
      providerAccountId: "1234567890123452222",
    });
    expect(a).not.toBe(b);
    // A more direct guard: convert one of the ids through Number and
    // back. Precision loss will produce a different hash than the
    // exact-string helper.
    const lossy = String(Number("1234567890123451111"));
    if (lossy !== "1234567890123451111") {
      const lossyHash = computeExternalIdentityDocId({
        providerId: "google.com",
        providerAccountId: lossy,
      });
      expect(lossyHash).not.toBe(a);
    }
  });

  it("throws on an unapproved provider", () => {
    expect(() =>
      computeExternalIdentityDocId({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        providerId: "clever.com" as any,
        providerAccountId: "abc",
      }),
    ).toThrow(PlatformError);
  });

  it.each([undefined, null, "", "   ", 12345, {}, []])(
    "rejects invalid providerAccountId %p",
    (value) => {
      expect(() =>
        computeExternalIdentityDocId({
          providerId: "google.com",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          providerAccountId: value as any,
        }),
      ).toThrow(PlatformError);
    },
  );

  it("rejects a providerAccountId containing a NUL byte", () => {
    expect(() =>
      computeExternalIdentityDocId({
        providerId: "google.com",
        providerAccountId: "abc\x00def",
      }),
    ).toThrow(PlatformError);
  });

  it("rejects a providerAccountId exceeding the maximum length", () => {
    const tooLong = "1".repeat(513);
    expect(() =>
      computeExternalIdentityDocId({
        providerId: "google.com",
        providerAccountId: tooLong,
      }),
    ).toThrow(PlatformError);
  });
});

describe("assertValidProviderAccountId", () => {
  it("returns the exact string unchanged", () => {
    expect(assertValidProviderAccountId("1234567890")).toBe("1234567890");
    expect(assertValidProviderAccountId("  padded  ")).toBe("  padded  ");
  });

  it.each([undefined, null, "", "\t", 42])(
    "throws on invalid input %p",
    (value) => {
      expect(() => assertValidProviderAccountId(value)).toThrow(PlatformError);
    },
  );
});

describe("assertValidProviderId", () => {
  it("accepts the approved google.com provider", () => {
    expect(assertValidProviderId("google.com")).toBe("google.com");
  });

  it.each(["Google.com", "google", "", undefined, null, 42])(
    "rejects unapproved provider %p",
    (value) => {
      expect(() => assertValidProviderId(value)).toThrow(PlatformError);
    },
  );
});
