import { isSafeToResend, normalizeTeacherUnitError } from "./errors";
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
    expect(e.recovery).toBe("retry");
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
    expect(isSafeToResend(e)).toBe(false);
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

  test("network failures are retryable", () => {
    for (const err of [
      httpsError("functions/unavailable"),
      httpsError("functions/deadline-exceeded"),
      new TypeError("Failed to fetch"),
    ]) {
      const e = normalizeTeacherUnitError(err);
      expect(e.category).toBe("network");
      expect(e.recovery).toBe("retry");
      expect(isSafeToResend(e)).toBe(true);
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
      expect(e.recovery).toBe("retry");
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
      expect(out.canResend).toBe(false);
    }
  });

  test("network failures report canResend without resending", async () => {
    const fn = jest.fn(async () => {
      throw httpsError("functions/unavailable");
    });
    const out = await runTeacherUnitMutation(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ ok: false, canResend: true });
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
