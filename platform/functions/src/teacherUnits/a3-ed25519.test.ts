// A3-6 S1 remediation P1: prime-order Ed25519 public-key admission. Torsion encodings
// are checked against installed OpenSSL as an independent oracle: each one it accepts
// must admit the universal forgery (R = identity, S = 0) for some message.
import { createHash, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import {
  ED25519_GROUP_ORDER, addEd25519Points, decodeEd25519Point, encodeEd25519Point, isEd25519Identity,
  isPrimeOrderEd25519PublicKey, multiplyEd25519Point,
} from "./a3-ed25519";

const SPKI = Buffer.from("302a300506032b6570032100", "hex");
const hex = (h: string) => Buffer.from(h, "hex");
const BASE = hex("5866666666666666666666666666666666666666666666666666666666666666");
const IDENTITY = hex("0100000000000000000000000000000000000000000000000000000000000000");

/** The eight canonical encodings of the small-order (torsion) points. */
const TORSION: Array<[string, number]> = [
  ["0100000000000000000000000000000000000000000000000000000000000000", 1],
  ["ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f", 2],
  ["0000000000000000000000000000000000000000000000000000000000000000", 4],
  ["0000000000000000000000000000000000000000000000000000000000000080", 4],
  ["26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05", 8],
  ["26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85", 8],
  ["c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a", 8],
  ["c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa", 8],
];
/** Noncanonical encodings of small-order points (x = 0 with sign set, or y >= p). */
const NONCANONICAL = [
  "0100000000000000000000000000000000000000000000000000000000000080",
  "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
];

function honestKey(): { raw: Buffer; seed: Buffer } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" });
  return { raw: publicKey.export({ format: "der", type: "spki" }).subarray(12), seed: Buffer.from(jwk.d as string, "base64url") };
}
function opensslAccepts(raw: Buffer): boolean {
  try { createPublicKey({ key: Buffer.concat([SPKI, raw]), format: "der", type: "spki" }); return true; } catch { return false; }
}
/** True when OpenSSL verifies the fixed forgery for at least one of 256 messages. */
function forgeable(raw: Buffer): boolean {
  const key = createPublicKey({ key: Buffer.concat([SPKI, raw]), format: "der", type: "spki" });
  const forged = Buffer.concat([IDENTITY, Buffer.alloc(32)]);
  for (let i = 0; i < 256; i++) if (verify(null, Buffer.from(`message-${i}`), key, forged)) return true;
  return false;
}

describe("curve arithmetic agrees with OpenSSL", () => {
  it("derives OpenSSL's public key from its seed (RFC 8032 5.1.5)", () => {
    const base = decodeEd25519Point(BASE);
    if (!base) throw new Error("base point");
    for (let i = 0; i < 5; i++) {
      const { raw, seed } = honestKey();
      const h = createHash("sha512").update(seed).digest().subarray(0, 32);
      h[0] &= 248; h[31] &= 127; h[31] |= 64;
      const scalar = BigInt(`0x${Buffer.from(h).reverse().toString("hex")}`);
      expect(encodeEd25519Point(multiplyEd25519Point(base, scalar)).equals(raw)).toBe(true);
    }
  });

  it("the base point has prime order", () => {
    const base = decodeEd25519Point(BASE);
    if (!base) throw new Error("base point");
    expect(isEd25519Identity(multiplyEd25519Point(base, ED25519_GROUP_ORDER))).toBe(true);
    expect(isEd25519Identity(base)).toBe(false);
  });
});

describe("admission", () => {
  it("admits honestly generated keys", () => {
    for (let i = 0; i < 20; i++) expect(isPrimeOrderEd25519PublicKey(honestKey().raw)).toBe(true);
  });

  test.each(TORSION)("refuses torsion point %s (order %i), which OpenSSL accepts and is forgeable", (encoded, order) => {
    const raw = hex(encoded);
    const point = decodeEd25519Point(raw);
    if (!point) throw new Error("torsion point must decode");
    expect(isEd25519Identity(multiplyEd25519Point(point, BigInt(order)))).toBe(true);
    expect(isPrimeOrderEd25519PublicKey(raw)).toBe(false);
    if (opensslAccepts(raw)) expect(forgeable(raw)).toBe(true);
  });

  test.each(NONCANONICAL)("refuses noncanonical small-order encoding %s", encoded => {
    expect(isPrimeOrderEd25519PublicKey(hex(encoded))).toBe(false);
  });

  it("refuses mixed-order keys (honest key plus a torsion point)", () => {
    const honest = decodeEd25519Point(honestKey().raw);
    const torsion = decodeEd25519Point(hex(TORSION[4][0]));
    if (!honest || !torsion) throw new Error("decode");
    const mixed = encodeEd25519Point(addEd25519Points(honest, torsion));
    expect(opensslAccepts(mixed)).toBe(true);
    expect(isPrimeOrderEd25519PublicKey(mixed)).toBe(false);
  });

  it("refuses wrong lengths and non-points", () => {
    expect(isPrimeOrderEd25519PublicKey(Buffer.alloc(31))).toBe(false);
    expect(isPrimeOrderEd25519PublicKey(Buffer.alloc(33))).toBe(false);
    // y = 2 is not on the curve.
    expect(decodeEd25519Point(hex("0200000000000000000000000000000000000000000000000000000000000000"))).toBeNull();
  });
});
