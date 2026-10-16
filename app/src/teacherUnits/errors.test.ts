import { normalizeTeacherUnitError } from "./errors";
import { isUncertainMutationFailure } from "./mutationReconciliation";
import {
  createMutationGate,
  gradeOrderGateKey,
  runTeacherUnitMutation,
} from "./saveCoordination";

const httpsError = (fbCode: string, details?: Record<string, unknown>) =>
  Object.assign(new Error("server text that must not leak"), { code: fbCode, details });

describe("normalizeTeacherUnitError", () => {
  test.each([
    ["teacherUnits.writeConflict", "conflict", "refresh"],
    ["teacherUnits.invalidStatus", "invalidStatus", "refresh"],
    ["teacherUnits.notFound", "notFound", "returnToList"],
    ["teacherUnits.resourceNotPlaceable", "resourceRejected", "refresh"],
    ["teacherUnits.duplicateResource", "resourceRejected", "refresh"],
    ["teacherUnits.idempotencyKeyConflict", "idempotencyKeyConflict", "refresh"],
    ["teacherUnits.listLimitExceeded", "limitExceeded", "none"],
    ["teacherUnits.invalidTitle", "invalidField", "editField"],
    ["teacherUnits.invalidDescription", "invalidField", "editField"],
    ["teacherUnits.invalidGrade", "invalidField", "editField"],
    ["teacherUnits.invalidRequest", "invalidRequest", "refresh"],
    ["teacherUnits.invalidResourceIds", "invalidRequest", "refresh"],
    ["teacherUnits.invalidUnitOrder", "invalidRequest", "refresh"],
    ["role-forbidden", "unauthorized", "signIn"],
    ["account-inactive", "unauthorized", "signIn"],
    ["claim-stale", "unauthorized", "signIn"],
    ["claim-state-mismatch", "unauthorized", "signIn"],
    ["district-mismatch", "unauthorized", "signIn"],
    ["school-district-mismatch", "unauthorized", "signIn"],
  ])("%s -> %s / %s", (code, category, recovery) => {
    const e = normalizeTeacherUnitError(httpsError("functions/x", { code }));
    expect(e.category).toBe(category);
    expect(e.recovery).toBe(recovery);
    expect(e.code).toBe(code);
    expect(e.message).not.toMatch(/server text|teacherUnits\./);
    expect(e.message).not.toContain("\u2014");
  });

  test("conflict wording does not claim a refresh happened", () => {
    const e = normalizeTeacherUnitError(
      httpsError("functions/already-exists", { code: "teacherUnits.writeConflict" }),
    );
    expect(e.message).not.toMatch(/we loaded|we refreshed|loaded the latest/i);
    expect(e.message).toMatch(/Refresh to load the latest version/);
  });

  test("uncertain outcomes never claim the change failed or the server was unreached", () => {
    for (const err of [
      httpsError("functions/unavailable"),
      httpsError("functions/deadline-exceeded"),
      httpsError("functions/internal"),
      new TypeError("Failed to fetch"),
      httpsError("functions/x", { code: "account-inactive" }),
    ]) {
      const m = normalizeTeacherUnitError(err).message;
      expect(m).toMatch(/couldn't confirm whether your change was saved/);
      expect(m).not.toMatch(/could not reach|was not saved|failed to save|never/i);
    }
  });

  test("key conflict wording does not invite a fresh create", () => {
    const m = normalizeTeacherUnitError(
      httpsError("functions/failed-precondition", { code: "teacherUnits.idempotencyKeyConflict" }),
    ).message;
    expect(m).toMatch(/couldn't confirm whether this unit was created/);
    expect(m).not.toMatch(/try again/i);
  });

  test("reorder conflict retains unitId and currentRevision", () => {
    const e = normalizeTeacherUnitError(
      httpsError("functions/already-exists", {
        code: "teacherUnits.writeConflict",
        unitId: "AbCdEfGhIjKlMnOpQrSt",
        currentRevision: 5,
      }),
    );
    expect(e.conflictUnitId).toBe("AbCdEfGhIjKlMnOpQrSt");
    expect(e.currentRevision).toBe(5);
    expect(e.message).not.toContain("AbCdEfGhIjKlMnOpQrSt");
    const noDetails = normalizeTeacherUnitError(
      httpsError("functions/already-exists", { code: "teacherUnits.writeConflict", currentRevision: 1.5 }),
    );
    expect(noDetails.conflictUnitId).toBeNull();
    expect(noDetails.currentRevision).toBeNull();
  });

  test.each([
    "toString",
    "constructor",
    "__proto__",
    "hasOwnProperty",
    "valueOf",
    "prototype",
    "",
    "teacherUnits.",
    "teacherUnits.invalidTitle ",
    "TEACHERUNITS.INVALIDTITLE",
    "\u0000",
  ])("prototype-like or unusual code %p falls back safely", (code) => {
    const e = normalizeTeacherUnitError(httpsError("functions/x", { code }));
    expect(e.category).toBe("unexpected");
    expect(e.recovery).toBe("refresh");
    expect(e.field).toBeNull();
    expect(typeof e.message).toBe("string");
    expect(e.message.length).toBeGreaterThan(0);
  });

  test("every normalized result has a valid shape", () => {
    const categories = new Set([
      "conflict", "invalidStatus", "notFound", "resourceRejected", "idempotencyKeyConflict",
      "invalidField", "invalidRequest", "limitExceeded", "unauthorized", "network", "unexpected",
    ]);
    const recoveries = new Set(["refresh", "returnToList", "editField", "retry", "signIn", "none"]);
    const fields = new Set([null, "title", "description", "grade"]);
    const inputs: unknown[] = [
      null, undefined, 0, "x", [], {}, { details: null }, { details: { code: 5 } },
      { details: { code: "toString" } }, { code: "constructor" }, { code: "__proto__" },
      httpsError("functions/x", { code: "teacherUnits.invalidGrade" }),
      httpsError("functions/x", { code: "teacherUnits.idempotencyKeyConflict" }),
    ];
    for (const input of inputs) {
      const e = normalizeTeacherUnitError(input);
      expect(categories.has(e.category)).toBe(true);
      expect(recoveries.has(e.recovery)).toBe(true);
      expect(fields.has(e.field)).toBe(true);
      expect(typeof e.message).toBe("string");
      expect(typeof e.code).toBe("string");
    }
  });

  test("conflict carries currentRevision", () => {
    const e = normalizeTeacherUnitError(
      httpsError("functions/already-exists", { code: "teacherUnits.writeConflict", currentRevision: 7 }),
    );
    expect(e.currentRevision).toBe(7);
    expect(isUncertainMutationFailure(e)).toBe(true);
  });

  test("resource rejections carry the rejected ids", () => {
    expect(
      normalizeTeacherUnitError(
        httpsError("functions/invalid-argument", {
          code: "teacherUnits.resourceNotPlaceable",
          resourceIds: ["ragebaiting", 3],
        }),
      ).rejectedResourceIds,
    ).toEqual(["ragebaiting"]);
    expect(
      normalizeTeacherUnitError(
        httpsError("functions/invalid-argument", {
          code: "teacherUnits.duplicateResource",
          resourceId: "earths-layers",
        }),
      ).rejectedResourceIds,
    ).toEqual(["earths-layers"]);
  });

  test("field failures name the field", () => {
    expect(
      normalizeTeacherUnitError(httpsError("functions/invalid-argument", { code: "teacherUnits.invalidTitle" }))
        .field,
    ).toBe("title");
  });

  // A3-4 S2: a network failure after dispatch may follow a commit. It is
  // never a retry signal; the outcome is reconciled by reading.
  test("network failures are uncertain and recover by refreshing, never by resending", () => {
    for (const err of [
      httpsError("functions/unavailable"),
      httpsError("functions/deadline-exceeded"),
      new TypeError("Failed to fetch"),
    ]) {
      const e = normalizeTeacherUnitError(err);
      expect(e.category).toBe("network");
      expect(e.recovery).toBe("refresh");
      expect(isUncertainMutationFailure(e)).toBe(true);
    }
  });

  test("Firebase-only auth codes fall back to unauthorized", () => {
    expect(normalizeTeacherUnitError(httpsError("functions/unauthenticated")).category).toBe(
      "unauthorized",
    );
    expect(normalizeTeacherUnitError(httpsError("functions/permission-denied")).category).toBe(
      "unauthorized",
    );
  });

  test("unknown errors fall back to unexpected, never success", () => {
    for (const err of [httpsError("functions/internal"), "boom", null, undefined, {}]) {
      const e = normalizeTeacherUnitError(err);
      expect(e.category).toBe("unexpected");
      expect(e.recovery).toBe("refresh");
      expect(isUncertainMutationFailure(e)).toBe(true);
      expect(e.message).not.toMatch(/server text|teacherUnits\./);
      expect(e.conflictUnitId).toBeNull();
    }
  });
});

describe("runTeacherUnitMutation", () => {
  test("noop responses are successes carrying the server state", async () => {
    const out = await runTeacherUnitMutation(async () => ({ noop: true, unit: { revision: 4 } }));
    expect(out).toEqual({ ok: true, result: { noop: true, unit: { revision: 4 } } });
  });

  test("a conflict is returned once, not replayed", async () => {
    const fn = jest.fn(async () => {
      throw httpsError("functions/already-exists", { code: "teacherUnits.writeConflict" });
    });
    const out = await runTeacherUnitMutation(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.category).toBe("conflict");
      expect("canResend" in out).toBe(false);
    }
  });

  test("network failures carry no resend signal and are not resent", async () => {
    const fn = jest.fn(async () => {
      throw httpsError("functions/unavailable");
    });
    const out = await runTeacherUnitMutation(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(out.ok).toBe(false);
    expect(Object.keys(out).sort()).toEqual(["error", "ok"]);
  });
});

describe("createMutationGate", () => {
  test("allows one in-flight mutation per key", async () => {
    const gate = createMutationGate();
    let release!: () => void;
    const first = gate.run("u1", () => new Promise<void>((r) => (release = r)));
    expect(first).not.toBeNull();
    expect(gate.isBusy("u1")).toBe(true);
    expect(gate.run("u1", async () => undefined)).toBeNull();
    expect(gate.run("u2", async () => undefined)).not.toBeNull();
    expect(gate.run(gradeOrderGateKey("7"), async () => undefined)).not.toBeNull();
    release();
    await first;
    expect(gate.isBusy("u1")).toBe(false);
  });

  test("releases the key after a failure", async () => {
    const gate = createMutationGate();
    await expect(
      gate.run("u1", async () => {
        throw new Error("x");
      }),
    ).rejects.toThrow("x");
    expect(gate.isBusy("u1")).toBe(false);
  });
});

describe("A3-3 codes (U2_6_A3_3_APPROVED_DECISIONS.md)", () => {
  const A3_UNCONFIRMED = [
    "teacherUnits.runtimeIdentityUnavailable",
    "teacherUnits.policyUnavailable",
    "teacherUnits.policyMissing",
    "teacherUnits.policyInvalid",
    "teacherUnits.availabilityClosed",
    "teacherUnits.deploymentIneligible",
    "teacherUnits.policyChanged",
    "teacherUnits.placementMismatch",
    "teacherUnits.contractUnsupported",
  ];
  test("responseUnavailable is unconfirmed, never a success, rejection or resend", () => {
    const e = normalizeTeacherUnitError(
      httpsError("unavailable", { code: "teacherUnits.responseUnavailable", outcome: "unconfirmed", operation: "update" }),
    );
    expect(e).toMatchObject({ category: "unconfirmed", recovery: "refresh", code: "teacherUnits.responseUnavailable" });
    expect(e.message).toBe("Your change may have been saved, but it could not be confirmed. Reload your units before trying again.");
    expect(isUncertainMutationFailure(e)).toBe(true);
  });
  test.each(A3_UNCONFIRMED)("%s (may be raised inside a transaction) is unconfirmed and never resendable", (code) => {
    const e = normalizeTeacherUnitError(httpsError("failed-precondition", { code }));
    expect(e.category).toBe("unconfirmed");
    expect(e.recovery).toBe("refresh");
    expect(isUncertainMutationFailure(e)).toBe(true);
    expect(e.message).not.toMatch(/server text/);
  });
  test("unconfirmed codes are never classified as compatibilityBlocked", () => {
    for (const code of [...A3_UNCONFIRMED, "teacherUnits.responseUnavailable", "teacherUnits.compatibilityBlocked"]) {
      expect(normalizeTeacherUnitError(httpsError("unavailable", { code })).category).not.toBe("compatibilityBlocked");
    }
  });
  test.each(["teacherUnits.compatibilityRequired", "teacherUnits.invalidCompatibility"])(
    "%s (decided before any transaction) is an invalid request",
    (code) => {
      const e = normalizeTeacherUnitError(httpsError("invalid-argument", { code }));
      expect(e.category).toBe("invalidRequest");
      // Proven pre-transaction refusal: never collapsed into uncertainty.
      expect(isUncertainMutationFailure(e)).toBe(false);
    },
  );
});
