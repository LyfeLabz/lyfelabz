/** A3-6 S1 Ed25519 public-key admission (RFC 8032 section 5.1).
 *
 * Installed OpenSSL verification does not reject small-order public keys, and with
 * such a key a fixed signature (R = identity, S = 0) verifies arbitrary messages.
 * Registry keys must therefore decode canonically to a point of the prime-order
 * subgroup other than the identity. Public keys only: variable-time arithmetic is
 * acceptable because no secret is involved. */
const P = 2n ** 255n - 19n;
/** Order of the prime-order subgroup (RFC 8032 L). */
export const ED25519_GROUP_ORDER = 2n ** 252n + 27742317777372353535851937790883648493n;

const mod = (a: bigint): bigint => ((a % P) + P) % P;
function power(base: bigint, exponent: bigint): bigint {
  let result = 1n, b = mod(base), e = exponent;
  while (e > 0n) { if (e & 1n) result = (result * b) % P; b = (b * b) % P; e >>= 1n; }
  return result;
}
const invert = (a: bigint): bigint => power(a, P - 2n);
const D = mod(-121665n * invert(121666n));
const SQRT_M1 = power(2n, (P - 1n) / 4n);

/** Extended coordinates (X:Y:Z:T), x = X/Z, y = Y/Z, xy = T/Z. */
export type Ed25519Point = Readonly<{ X: bigint; Y: bigint; Z: bigint; T: bigint }>;
export const ED25519_IDENTITY: Ed25519Point = Object.freeze({ X: 0n, Y: 1n, Z: 1n, T: 0n });

/** RFC 8032 5.1.3 decoding. Refuses y >= p, a negative zero x, and non-points. */
export function decodeEd25519Point(raw: Uint8Array): Ed25519Point | null {
  if (raw.length !== 32) return null;
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? raw[i] & 0x7f : raw[i]);
  const sign = raw[31] >> 7;
  if (y >= P) return null;
  const y2 = (y * y) % P, x2 = mod((y2 - 1n) * invert(mod(D * y2 + 1n)));
  if (x2 === 0n) return sign === 1 ? null : Object.freeze({ X: 0n, Y: y, Z: 1n, T: 0n });
  let x = power(x2, (P + 3n) / 8n);
  if (mod(x * x - x2) !== 0n) x = (x * SQRT_M1) % P;
  if (mod(x * x - x2) !== 0n) return null;
  if (Number(x & 1n) !== sign) x = P - x;
  return Object.freeze({ X: x, Y: y, Z: 1n, T: (x * y) % P });
}

/** RFC 8032 5.1.2 encoding. */
export function encodeEd25519Point(point: Ed25519Point): Buffer {
  const zInverse = invert(point.Z), x = mod(point.X * zInverse), y = mod(point.Y * zInverse);
  const out = Buffer.alloc(32);
  let value = y;
  for (let i = 0; i < 32; i++) { out[i] = Number(value & 0xffn); value >>= 8n; }
  out[31] |= Number(x & 1n) << 7;
  return out;
}

/** RFC 8032 5.1.4 addition (complete for Ed25519). */
export function addEd25519Points(a: Ed25519Point, b: Ed25519Point): Ed25519Point {
  const A = mod((a.Y - a.X) * (b.Y - b.X)), B = mod((a.Y + a.X) * (b.Y + b.X));
  const C = mod(a.T * 2n * D * b.T), Dz = mod(a.Z * 2n * b.Z);
  const E = mod(B - A), F = mod(Dz - C), G = mod(Dz + C), H = mod(B + A);
  return Object.freeze({ X: mod(E * F), Y: mod(G * H), Z: mod(F * G), T: mod(E * H) });
}

export function multiplyEd25519Point(point: Ed25519Point, scalar: bigint): Ed25519Point {
  if (scalar < 0n) throw new Error("negative scalar");
  let result = ED25519_IDENTITY, addend = point, k = scalar;
  while (k > 0n) { if (k & 1n) result = addEd25519Points(result, addend); addend = addEd25519Points(addend, addend); k >>= 1n; }
  return result;
}

export const isEd25519Identity = (point: Ed25519Point): boolean =>
  mod(point.X) === 0n && mod(point.Y - point.Z) === 0n;

/** True only for a canonical encoding of a non-identity point of prime order L.
 * Refuses every small-order (torsion) and mixed-order key. */
export function isPrimeOrderEd25519PublicKey(raw: Uint8Array): boolean {
  const point = decodeEd25519Point(raw);
  if (!point || isEd25519Identity(point)) return false;
  if (!encodeEd25519Point(point).equals(Buffer.from(raw))) return false;
  return isEd25519Identity(multiplyEd25519Point(point, ED25519_GROUP_ORDER));
}
