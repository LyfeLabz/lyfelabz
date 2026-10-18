// A3-3 SDK rerun classification. Retryable read errors must propagate unchanged so the
// Firestore SDK reruns the whole attempt (bounded by its own maxAttempts, revalidating
// everything); every other read failure becomes a policyUnavailable refusal.
import type { Transaction } from "firebase-admin/firestore";

import { PlatformError } from "../shared";
import {
  PRODUCTION_TEACHER_UNITS_ENFORCEMENT, RUNTIME_PLACEMENT_FINGERPRINT, TEACHER_UNITS_POLICY_PATH, type TeacherUnitsEnforcement, a3Refusal, evaluateAvailabilityInTransaction,
  isSdkRetryableTransactionError,
} from "./a3-enforcement";
import { type ReleaseAuthorityVerifier, UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER } from "./a3-release-authority";
import { buildEnabledChain, emulatorExpectation, stubIdentity, testEnforcement, testVerifier } from "./a3-test-support.test";

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// The installed SDK keeps its predicate module-private; compile its exact source.
function installedSdkPredicate(): (err: unknown) => boolean {
  const file = require.resolve("@google-cloud/firestore/build/src/transaction.js");
  const pkg = JSON.parse(readFileSync(require.resolve("@google-cloud/firestore/package.json"), "utf8")) as { version: string };
  expect(pkg.version).toBe("7.11.6");
  const source = readFileSync(file, "utf8");
  const match = /function isRetryableTransactionError\(error\) \{[\s\S]*?\n {4}return false;\n\}/.exec(source);
  if (!match) throw new Error("installed SDK predicate not found");
  return runInNewContext(`(${match[0]})`) as (err: unknown) => boolean;
}

const grpc = (code: number, message = "x") => Object.assign(new Error(message), { code });
const EXPIRED = grpc(3, "The referenced transaction has expired or is no longer valid.");

const CASES: [string, unknown, boolean][] = [
  ...[1, 2, 4, 8, 10, 13, 14, 16].map((code): [string, unknown, boolean] => [`gRPC ${String(code)}`, grpc(code), true]),
  ["INVALID_ARGUMENT transaction expired", EXPIRED, true],
  ["INVALID_ARGUMENT other", grpc(3, "Invalid document path"), false],
  ["INVALID_ARGUMENT without message", Object.assign({}, { code: 3 }), false],
  ["NOT_FOUND", grpc(5), false],
  ["ALREADY_EXISTS", grpc(6), false],
  ["PERMISSION_DENIED", grpc(7), false],
  ["FAILED_PRECONDITION", grpc(9), false],
  ["string code", Object.assign(new Error("aborted"), { code: "aborted" }), false],
  ["PlatformError", new PlatformError("teacherUnits.policyUnavailable", "x"), false],
  ["null", null, false],
];

test.each(CASES)("classifies %s exactly as the installed SDK", (_label, err, expected) => {
  expect(isSdkRetryableTransactionError(err)).toBe(expected);
});

test("matches the installed SDK predicate exactly", () => {
  const sdk = installedSdkPredicate();
  for (const [, err] of CASES) {
    // The SDK predicate dereferences `message` for INVALID_ARGUMENT and throws without
    // one; gRPC errors always carry a message. Ours returns false (no rerun) there.
    if (err === null || typeof err !== "object" || typeof (err as { message?: unknown }).message !== "string") continue;
    expect(isSdkRetryableTransactionError(err)).toBe(sdk(err));
  }
});

describe("policy read failures inside an authoritative attempt", () => {
  const identity = stubIdentity(emulatorExpectation("demo-a3-test"));
  const enforcement: TeacherUnitsEnforcement = {
    resolveIdentity: () => Promise.resolve(identity),
    isIdentityCurrent: () => true,
    provenance: () => { throw new Error("unused"); },
    verifier: UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER,
  };
  const scope = { identity, enforcement, endpoint: "teacherUnitsList" } as const;
  const failingTx = (err: Error) => ({ get: () => Promise.reject(err) }) as unknown as Transaction;

  it("propagates an expired-transaction error unchanged so the SDK reruns the attempt", async () => {
    await expect(evaluateAvailabilityInTransaction(failingTx(EXPIRED), scope)).rejects.toBe(EXPIRED);
  });

  it("refuses an unrelated INVALID_ARGUMENT as policyUnavailable (no rerun)", async () => {
    const err = grpc(3, "Invalid document path");
    await expect(evaluateAvailabilityInTransaction(failingTx(err), scope)).rejects.toMatchObject({
      code: "teacherUnits.policyUnavailable",
    });
  });
});

// O6: the callVerifier / readEvidence boundary. Only the exact error object that
// A3-3's own readEvidence raised in this attempt, classified by txRead as
// SDK-retryable or policyUnavailable, escapes the verifier; anything else is
// unverified `error` (ineligible), whatever its code, name, message or shape.
describe("O6 verifier exception boundary", () => {
  const expected = emulatorExpectation("demo-a3-test");
  const identity = stubIdentity(expected);
  const chain = buildEnabledChain(expected, RUNTIME_PLACEMENT_FINGERPRINT);
  const scope = (verifier: ReleaseAuthorityVerifier) =>
    ({ identity, enforcement: testEnforcement(identity, chain, { verifier }), endpoint: "teacherUnitsList" }) as const;
  const DOCS: Record<string, unknown> = { [TEACHER_UNITS_POLICY_PATH]: chain.policy, ...chain.documents };
  // A transaction over the chain whose reads of `failPath` reject with `fail()`.
  const chainTx = (failPath: string | null, fail: () => Error, overrides: Record<string, unknown> = {}) => {
    const reads: string[] = [];
    const tx = { get: (r: { path: string }) => {
      reads.push(r.path);
      if (r.path === failPath) return Promise.reject(fail());
      const data = Object.hasOwn(overrides, r.path) ? overrides[r.path] : DOCS[r.path];
      return Promise.resolve({ exists: data !== undefined, data: () => data });
    } } as unknown as Transaction;
    return { tx, reads };
  };
  // A verifier that reads the certification through readEvidence, then answers.
  const reading = (after: (err: unknown) => unknown = (err) => { throw err; }) => {
    const inner = testVerifier(chain);
    return { verify: async (input: Parameters<ReleaseAuthorityVerifier["verify"]>[0]) => {
      try { await input.readEvidence(chain.certificationEvidenceRef); } catch (err) { return after(err) as never; }
      return inner.verify(input);
    } };
  };
  const RETRYABLE: [string, () => Error][] = [
    ...[1, 2, 4, 8, 10, 13, 14, 16].map((code): [string, () => Error] => [`gRPC ${String(code)}`, () => grpc(code)]),
    ["ABORTED", () => grpc(10, "Aborted due to cross-transaction contention.")],
    ["INVALID_ARGUMENT transaction expired", () => grpc(3, "The referenced transaction has expired or is no longer valid.")],
  ];

  it("control: the reading verifier over an intact chain is enabled", async () => {
    const { tx, reads } = chainTx(null, () => new Error("unused"));
    expect((await evaluateAvailabilityInTransaction(tx, scope(reading()))).kind).toBe("enabled");
    expect(reads.filter((p) => p === chain.certificationEvidenceRef)).toHaveLength(1);
  });

  it.each(RETRYABLE)("propagates the original readEvidence %s error unchanged", async (_label, make) => {
    const err = make();
    const { tx } = chainTx(chain.certificationEvidenceRef, () => err);
    await expect(evaluateAvailabilityInTransaction(tx, scope(reading()))).rejects.toBe(err);
  });

  it("routes a non-retryable readEvidence failure to the canonical policyUnavailable refusal", async () => {
    const denied = grpc(7, "denied");
    const { tx } = chainTx(chain.certificationEvidenceRef, () => denied);
    const thrown = await evaluateAvailabilityInTransaction(tx, scope(reading())).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(PlatformError);
    expect(thrown).toMatchObject({ code: "teacherUnits.policyUnavailable" });
    expect((thrown as { cause?: unknown }).cause).toBe(denied);
  });

  it.each(RETRYABLE)("fails closed on a verifier-originated %s-shaped error", async (_label, make) => {
    const { tx } = chainTx(null, () => new Error("unused"));
    const own = { verify: () => Promise.reject(make()) } as ReleaseAuthorityVerifier;
    expect((await evaluateAvailabilityInTransaction(tx, scope(own))).kind).toBe("ineligible");
  });

  it("fails closed on a verifier-originated policyUnavailable refusal", async () => {
    const { tx } = chainTx(null, () => new Error("unused"));
    const own = { verify: () => Promise.reject(a3Refusal("teacherUnits.policyUnavailable")) } as ReleaseAuthorityVerifier;
    expect((await evaluateAvailabilityInTransaction(tx, scope(own))).kind).toBe("ineligible");
  });

  it.each([
    ["an equal-shaped retryable copy", (err: unknown) => { throw Object.assign(new Error((err as Error).message), { code: (err as { code: number }).code }); }],
    ["a fresh policyUnavailable refusal", () => { throw a3Refusal("teacherUnits.policyUnavailable"); }],
    ["a wrapped error", (err: unknown) => { throw new Error("wrapped", { cause: err }); }],
  ])("fails closed when the verifier swallows a readEvidence failure and throws %s", async (_label, after) => {
    for (const fail of [() => grpc(10), () => grpc(7)]) {
      const { tx } = chainTx(chain.certificationEvidenceRef, fail);
      expect((await evaluateAvailabilityInTransaction(tx, scope(reading(after)))).kind).toBe("ineligible");
    }
  });

  it("keeps invalid and unsupported evidence failing closed", async () => {
    const invalid = chainTx(null, () => new Error("unused"), { [chain.certificationEvidenceRef]: { schemaVersion: 1 } });
    expect((await evaluateAvailabilityInTransaction(invalid.tx, scope(reading()))).kind).toBe("ineligible");
    const unsupported = { verify: async (input: Parameters<ReleaseAuthorityVerifier["verify"]>[0]) => {
      await input.readEvidence("teacherUnits/anything"); return testVerifier(chain).verify(input);
    } };
    expect((await evaluateAvailabilityInTransaction(chainTx(null, () => new Error("unused")).tx, scope(unsupported))).kind).toBe("ineligible");
  });

  it("tracks failures per attempt: an earlier attempt's error object never escapes a later one", async () => {
    const err = grpc(10);
    let stash: unknown = null;
    const first = chainTx(chain.certificationEvidenceRef, () => err);
    const capture = reading((e) => { stash = e; throw e; });
    await expect(evaluateAvailabilityInTransaction(first.tx, scope(capture))).rejects.toBe(err);
    // Next attempt reads fine, but the verifier rethrows the earlier attempt's object.
    const second = chainTx(null, () => new Error("unused"));
    const replay = { verify: async (input: Parameters<ReleaseAuthorityVerifier["verify"]>[0]) => {
      await input.readEvidence(chain.certificationEvidenceRef); throw stash;
    } } as ReleaseAuthorityVerifier;
    expect((await evaluateAvailabilityInTransaction(second.tx, scope(replay))).kind).toBe("ineligible");
    expect(second.reads).toContain(chain.certificationEvidenceRef);
  });

  it("production enforcement still uses the UNCONFIGURED verifier", () => {
    expect(PRODUCTION_TEACHER_UNITS_ENFORCEMENT.verifier).toBe(UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER);
  });
});
