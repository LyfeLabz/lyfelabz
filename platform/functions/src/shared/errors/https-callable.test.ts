// Sprint 11C Remediation Slice 1 - Critical Finding C-3.
//
// Tests for the central PlatformError -> HttpsError translation layer.
// Verifies that (a) the canonical platform code is preserved on the
// wire in `details.code`, (b) the coarse Firebase code maps correctly,
// and (c) native HttpsError values are passed through unchanged.

import { logger } from "firebase-functions";
import { HttpsError } from "firebase-functions/v2/https";

import { PlatformError } from "./platform-error";
import {
  mapPlatformCodeToHttpsCode,
  translateThrown,
} from "./https-callable";

describe("mapPlatformCodeToHttpsCode", () => {
  it("maps authentication refusals to unauthenticated", () => {
    expect(mapPlatformCodeToHttpsCode("unauthenticated")).toBe("unauthenticated");
    expect(mapPlatformCodeToHttpsCode("claim-stale")).toBe("unauthenticated");
  });

  it("maps permission refusals to permission-denied", () => {
    expect(mapPlatformCodeToHttpsCode("role-forbidden")).toBe("permission-denied");
    expect(mapPlatformCodeToHttpsCode("district-mismatch")).toBe(
      "permission-denied",
    );
    expect(mapPlatformCodeToHttpsCode("account-inactive")).toBe(
      "permission-denied",
    );
  });

  it("maps not-found identifiers to not-found", () => {
    expect(mapPlatformCodeToHttpsCode("assignment-not-found")).toBe("not-found");
    expect(mapPlatformCodeToHttpsCode("submissions.notFound")).toBe("not-found");
    expect(mapPlatformCodeToHttpsCode("assessmentAttempts.sessionNotFound")).toBe(
      "not-found",
    );
    expect(mapPlatformCodeToHttpsCode("assessmentAttempts.revisionMissing")).toBe(
      "not-found",
    );
  });

  it("maps conflict identifiers to already-exists", () => {
    expect(mapPlatformCodeToHttpsCode("submissions.conflict")).toBe(
      "already-exists",
    );
    expect(
      mapPlatformCodeToHttpsCode("assessmentAttempts.writeConflict"),
    ).toBe("already-exists");
  });

  it("maps request-shape identifiers to invalid-argument", () => {
    expect(
      mapPlatformCodeToHttpsCode("assessmentAttempts.invalidRequest"),
    ).toBe("invalid-argument");
    expect(
      mapPlatformCodeToHttpsCode("submissions.invalidSubmissionId"),
    ).toBe("invalid-argument");
  });

  // Sprint 11D I-4/R-2. Namespaced identifiers ending in canonical
  // permission/auth suffixes MUST map to their canonical Firebase code
  // without requiring exact-string entries per callable domain.
  it("I-4: maps namespaced .unauthenticated suffix to unauthenticated", () => {
    expect(mapPlatformCodeToHttpsCode("lms.unauthenticated")).toBe(
      "unauthenticated",
    );
    expect(mapPlatformCodeToHttpsCode("submissions.unauthenticated")).toBe(
      "unauthenticated",
    );
  });

  it("I-4: maps namespaced permission suffixes to permission-denied", () => {
    expect(mapPlatformCodeToHttpsCode("lms.unauthorized")).toBe(
      "permission-denied",
    );
    expect(mapPlatformCodeToHttpsCode("lms.forbidden")).toBe(
      "permission-denied",
    );
    expect(mapPlatformCodeToHttpsCode("assessmentAttempts.notOwned")).toBe(
      "permission-denied",
    );
    expect(mapPlatformCodeToHttpsCode("classes.notEnrolled")).toBe(
      "permission-denied",
    );
  });

  it("falls back to failed-precondition for business-rule refusals", () => {
    expect(mapPlatformCodeToHttpsCode("assignment-window-closed")).toBe(
      "failed-precondition",
    );
    expect(mapPlatformCodeToHttpsCode("enrollment-inactive")).toBe(
      "failed-precondition",
    );
    expect(mapPlatformCodeToHttpsCode("submissions.legacyWritesDisabled")).toBe(
      "failed-precondition",
    );
  });
});

describe("translateThrown", () => {
  it("translates a PlatformError to an HttpsError preserving the canonical code in details", () => {
    const platform = new PlatformError(
      "assignment-window-closed",
      "Window closed.",
    );
    const translated = translateThrown(platform);
    expect(translated).toBeInstanceOf(HttpsError);
    expect(translated.code).toBe("failed-precondition");
    expect(translated.message).toBe("Window closed.");
    expect(translated.details).toEqual({ code: "assignment-window-closed" });
  });

  it("preserves a namespaced canonical code in details", () => {
    const platform = new PlatformError(
      "assessmentAttempts.sessionNotFound",
      "gone.",
    );
    const translated = translateThrown(platform);
    expect(translated.code).toBe("not-found");
    expect(translated.details).toEqual({
      code: "assessmentAttempts.sessionNotFound",
    });
  });

  it("passes an existing HttpsError through unchanged", () => {
    const original = new HttpsError("permission-denied", "no.");
    const translated = translateThrown(original);
    expect(translated).toBe(original);
  });

  it("coerces an unknown throwable into an internal error without leaking details", () => {
    const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => undefined);
    try {
      const translated = translateThrown(new Error("boom"));
      expect(translated).toBeInstanceOf(HttpsError);
      expect(translated.code).toBe("internal");
      expect(translated.message).not.toContain("boom");
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("translateThrown diagnostic logging", () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(logger, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("logs a raw Error exactly once as callable.unhandled with message and stack", () => {
    const raw = new Error("underlying boom");
    const translated = translateThrown(raw, { callableName: "classesCreateHandler" });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [event, payload] = errorSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(event).toBe("callable.unhandled");
    expect(payload.callableName).toBe("classesCreateHandler");
    expect(payload.name).toBe("Error");
    expect(payload.message).toBe("underlying boom");
    expect(typeof payload.stack).toBe("string");
    expect(String(payload.stack)).toContain("underlying boom");

    expect(translated.code).toBe("internal");
    expect(translated.message).toBe("An unexpected error occurred.");
  });

  it("logs an Error cause when present", () => {
    const inner = new Error("root cause");
    const outer = new Error("wrapper");
    (outer as { cause?: unknown }).cause = inner;

    translateThrown(outer);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [, payload] = errorSpy.mock.calls[0] as [string, Record<string, unknown>];
    const cause = payload.cause as { name: string; message: string; stack?: string };
    expect(cause.name).toBe("Error");
    expect(cause.message).toBe("root cause");
    expect(typeof cause.stack).toBe("string");
  });

  it("logs a non-Error throwable as NonError without leaking to client", () => {
    const translated = translateThrown("string boom");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [, payload] = errorSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload.name).toBe("NonError");
    expect(payload.message).toBe("string boom");
    expect(translated.code).toBe("internal");
    expect(translated.message).toBe("An unexpected error occurred.");
  });

  it("does not log when a PlatformError is translated", () => {
    const translated = translateThrown(
      new PlatformError("assignment-window-closed", "Window closed."),
    );
    expect(errorSpy).not.toHaveBeenCalled();
    expect(translated.code).toBe("failed-precondition");
    expect(translated.message).toBe("Window closed.");
    expect(translated.details).toEqual({ code: "assignment-window-closed" });
  });

  it("does not log when an existing HttpsError passes through", () => {
    const original = new HttpsError("permission-denied", "no.");
    const translated = translateThrown(original);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(translated).toBe(original);
  });
});
