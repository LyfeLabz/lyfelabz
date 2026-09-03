import { isValidGrantId } from "../types/launch-grant";
import { generateGrantId } from "./launch-grant-id";

// F5.2 §3.6 - grant-id generation is CSPRNG-backed, exactly 32 lowercase hex
// chars, and never a timestamp/sequence/UUID variant. We assert the format
// invariant and (probabilistically) uniqueness/high entropy.

describe("generateGrantId (§3.6)", () => {
  it("always produces a valid 32-lowercase-hex id", () => {
    for (let i = 0; i < 1000; i += 1) {
      const id = generateGrantId();
      expect(isValidGrantId(id)).toBe(true);
      expect(id).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it("produces distinct ids across many draws (128-bit entropy, no collision)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      seen.add(generateGrantId());
    }
    expect(seen.size).toBe(10_000);
  });

  it("is not derived from a timestamp or a monotonic sequence", () => {
    // Two ids drawn back-to-back share no long common prefix (a timestamp- or
    // counter-derived id would). This is a heuristic guard, not a proof.
    const a = generateGrantId();
    const b = generateGrantId();
    let sharedPrefix = 0;
    for (let i = 0; i < a.length && a[i] === b[i]; i += 1) sharedPrefix += 1;
    expect(sharedPrefix).toBeLessThan(8);
  });
});
