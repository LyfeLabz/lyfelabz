import { createHash } from "node:crypto";
import { array, integer, plainRecord, refuse, stringRule } from "./a3-protocol";

/** Matches A1 stable + JSON.stringify. Never serializes SDK objects or invokes getters. */
function stable(value: unknown, path: string): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") { stringRule(value, path); return value; }
  if (typeof value === "number") { integer(-Number.MAX_SAFE_INTEGER)(value, path); return value; }
  if (Array.isArray(value)) {
    array(() => undefined)(value, path);
    return value.map((v: unknown, i) => stable(v, `${path}[${i}]`));
  }
  const record = plainRecord(value, path);
  return Object.fromEntries(Object.keys(record).sort().map(k => {
    stringRule(k, path);
    return [k, stable(record[k], `${path}.${k}`)];
  }));
}
export function canonicalJSON(value: unknown): string {
  const active = new Set<object>();
  function check(v: unknown): void {
    if (v === null || typeof v !== "object") return;
    if (active.has(v)) refuse("$", "cyclic input");
    active.add(v);
    // Stable validates descriptors before any values are accessed.
    if (Array.isArray(v)) array(() => undefined)(v, "$"); else plainRecord(v, "$");
    for (const key of Object.keys(v)) check((v as Record<string, unknown>)[key]);
    active.delete(v);
  }
  check(value);
  return JSON.stringify(stable(value, "$"));
}
export const sha256Bytes = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
export const contentDigest = (value: unknown): string => sha256Bytes(canonicalJSON(value));
export const evidenceRef = (payload: unknown): string => `teacherUnitsReleaseEvidence/${contentDigest(payload)}`;
export const approvalSigningBytes = (statement: unknown): Uint8Array => Buffer.from(`lyfelabz.teacher-units-approval-v1\n${canonicalJSON(statement)}`, "utf8");

/** Check the exact decimal value before JSON.parse can round or underflow it. */
function numericToken(token: string): void {
  const parts = /^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(token);
  if (!parts) return refuse("$", "invalid numeric token");
  const fraction = parts[3] ?? "";
  const coefficient = `${parts[2]}${fraction}`.replace(/^0+/, "");
  if (!coefficient) {
    if (parts[1] === "-") refuse("$", "negative zero prohibited");
    return;
  }
  const digits = coefficient.replace(/0+$/, "");
  const scale = BigInt(parts[4] ?? "0") - BigInt(fraction.length) + BigInt(coefficient.length - digits.length);
  if (scale < 0n) refuse("$", "fractional numeric token prohibited");
  // Bound the result before exponentiation; huge exponents never allocate huge integers.
  if (BigInt(digits.length) + scale > 16n) refuse("$", "unsafe numeric token");
  if (BigInt(digits) * 10n ** scale > BigInt(Number.MAX_SAFE_INTEGER)) refuse("$", "unsafe numeric token");
}

/** Text boundary: reject duplicate keys before JSON.parse can discard them. */
export function parseStrictJSON(source: string): unknown {
  let offset = 0;
  const whitespace = (): void => { while (/[\t\n\r ]/.test(source[offset] ?? "!")) offset++; };
  function tokenString(): string {
    const start = offset++;
    while (offset < source.length) {
      const c = source[offset++];
      if (c === "\\") { offset++; continue; }
      if (c === '"') {
        const parsed: unknown = JSON.parse(source.slice(start, offset));
        stringRule(parsed, "$"); return parsed as string;
      }
    }
    return refuse("$", "unterminated JSON string");
  }
  function scan(): void {
    whitespace();
    const c = source[offset];
    if (c === '"') { tokenString(); return; }
    if (c === "{" || c === "[") {
      const isObject = c === "{"; const end = isObject ? "}" : "]";
      const keys = new Set<string>(); offset++; whitespace();
      if (source[offset] === end) { offset++; return; }
      while (offset < source.length) {
        whitespace();
        if (isObject) {
          if (source[offset] !== '"') refuse("$", "JSON key required");
          const key = tokenString();
          if (keys.has(key)) refuse("$", "duplicate JSON key"); keys.add(key);
          whitespace(); if (source[offset++] !== ":") refuse("$", "JSON colon required");
        }
        scan(); whitespace();
        if (source[offset] === end) { offset++; return; }
        if (source[offset++] !== ",") refuse("$", "JSON separator required");
      }
      return refuse("$", "unterminated JSON container");
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(source.slice(offset));
    if (!match) refuse("$", "invalid JSON token");
    if (/^[-0-9]/.test(match[0])) numericToken(match[0]);
    offset += match[0].length;
  }
  scan(); whitespace(); if (offset !== source.length) refuse("$", "trailing JSON input");
  const result: unknown = JSON.parse(source);
  canonicalJSON(result); return result;
}
