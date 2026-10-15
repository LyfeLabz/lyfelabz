// A3-3 SDK rerun classification. Retryable read errors must propagate unchanged so the
// Firestore SDK reruns the whole attempt (bounded by its own maxAttempts, revalidating
// everything); every other read failure becomes a policyUnavailable refusal.
import type { Transaction } from "firebase-admin/firestore";

import { PlatformError } from "../shared";
import { type TeacherUnitsEnforcement, evaluateAvailabilityInTransaction, isSdkRetryableTransactionError } from "./a3-enforcement";
import { UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER } from "./a3-release-authority";
import { emulatorExpectation, stubIdentity } from "./a3-test-support.test";

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
