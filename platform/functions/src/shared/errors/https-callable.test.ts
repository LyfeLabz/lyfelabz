// Sprint 11C Remediation Slice 1 - Critical Finding C-3.
//
// Tests for the central PlatformError -> HttpsError translation layer.
// Verifies that (a) the canonical platform code is preserved on the
// wire in `details.code`, (b) the coarse Firebase code maps correctly,
// and (c) native HttpsError values are passed through unchanged.

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
    const translated = translateThrown(new Error("boom"));
    expect(translated).toBeInstanceOf(HttpsError);
    expect(translated.code).toBe("internal");
    expect(translated.message).not.toContain("boom");
  });
});
