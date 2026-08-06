// URL-safe classId generator shared by Manual Create and by the Google
// Classroom import orchestration. Matches the server-side
// CLASS_ID_PATTERN `^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$`.
// This module is deliberately firebase-free so shell-adjacent
// consumers (importFromClassroom.ts) can call it without breaking the
// shell "no firebase imports" invariant.
//
// Uses crypto.getRandomValues on browsers; falls back to Math.random
// only in environments where crypto is unavailable (never on the live
// platform).

const CLASS_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const CLASS_ID_LENGTH = 20;

export function generateClassId(): string {
  const g =
    typeof globalThis !== "undefined"
      ? (globalThis as { crypto?: Crypto }).crypto
      : undefined;
  const bytes = new Uint8Array(CLASS_ID_LENGTH);
  if (g && typeof g.getRandomValues === "function") {
    g.getRandomValues(bytes);
  } else {
    for (let i = 0; i < CLASS_ID_LENGTH; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = "";
  for (let i = 0; i < CLASS_ID_LENGTH; i += 1) {
    out += CLASS_ID_ALPHABET[bytes[i]! % CLASS_ID_ALPHABET.length];
  }
  return out;
}
