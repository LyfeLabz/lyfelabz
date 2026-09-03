/**
 * @jest-environment jsdom
 */

// Sprint 27 Phase 4: unit tests for the `lmsDeepLinkResolve` client wire. The
// wire is the seam that keeps the arrival surface free of firebase/*. Tests
// inject a fake httpsCallable factory; no real bindings are exercised.

const callableInvocations: Array<{
  readonly name: string;
  readonly payload: unknown;
}> = [];

let callableResponse: unknown = null;
let callableRejection: Error | null = null;

jest.mock("firebase/functions", () => ({
  httpsCallable:
    (_functions: unknown, name: string) => (payload: unknown) => {
      callableInvocations.push({ name, payload });
      if (callableRejection !== null) {
        return Promise.reject(callableRejection);
      }
      return Promise.resolve({ data: callableResponse });
    },
}));

import type { Functions } from "firebase/functions";
import { createDeepLinkResolveCallable } from "./wire";

const reset = () => {
  callableInvocations.length = 0;
  callableResponse = null;
  callableRejection = null;
};

const okResolution = (over: Record<string, unknown> = {}) => ({
  assignmentId: "assign-1",
  classId: "class-1",
  lessonSlug: "lesson_g7_earths-layers",
  internalTarget: "assignmentLaunch",
  attemptContext: "authorized",
  ...over,
});

describe("createDeepLinkResolveCallable", () => {
  const fakeFunctions = {} as unknown as Functions;

  beforeEach(reset);

  test("targets lmsDeepLinkResolve and sends only the assignmentId", async () => {
    callableResponse = okResolution();
    const callable = createDeepLinkResolveCallable(fakeFunctions);
    await callable({ assignmentId: "assign-1" });
    expect(callableInvocations).toHaveLength(1);
    expect(callableInvocations[0].name).toBe("lmsDeepLinkResolve");
    expect(callableInvocations[0].payload).toEqual({ assignmentId: "assign-1" });
  });

  test("never sends a student/class/school/district identifier", async () => {
    callableResponse = okResolution();
    const callable = createDeepLinkResolveCallable(fakeFunctions);
    await callable({ assignmentId: "assign-1" });
    const payload = callableInvocations[0].payload as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(["assignmentId"]);
  });

  test("parses a well-formed resolution and freezes it", async () => {
    callableResponse = okResolution();
    const callable = createDeepLinkResolveCallable(fakeFunctions);
    const res = await callable({ assignmentId: "assign-1" });
    expect(res).toEqual(okResolution());
    expect(Object.isFrozen(res)).toBe(true);
  });

  test("parses an informational resolution", async () => {
    callableResponse = okResolution({
      internalTarget: "informational",
      attemptContext: "informational",
    });
    const callable = createDeepLinkResolveCallable(fakeFunctions);
    const res = await callable({ assignmentId: "assign-1" });
    expect(res.internalTarget).toBe("informational");
    expect(res.attemptContext).toBe("informational");
  });

  test.each([
    ["missing assignmentId", okResolution({ assignmentId: "" })],
    ["missing classId", okResolution({ classId: "" })],
    ["missing lessonSlug", okResolution({ lessonSlug: 0 })],
    ["unknown internalTarget", okResolution({ internalTarget: "hack" })],
    ["unknown attemptContext", okResolution({ attemptContext: "granted" })],
    ["null root", null],
    ["string root", "x"],
  ])("fails closed (throws) on malformed resolution: %s", async (_label, raw) => {
    callableResponse = raw;
    const callable = createDeepLinkResolveCallable(fakeFunctions);
    await expect(callable({ assignmentId: "assign-1" })).rejects.toThrow();
  });

  test("fails closed on an inconsistent authorized+non-launch pairing", async () => {
    callableResponse = okResolution({
      attemptContext: "authorized",
      internalTarget: "informational",
    });
    const callable = createDeepLinkResolveCallable(fakeFunctions);
    await expect(callable({ assignmentId: "assign-1" })).rejects.toThrow();
  });

  test("propagates a resolver rejection", async () => {
    callableRejection = new Error("enrollment-inactive");
    const callable = createDeepLinkResolveCallable(fakeFunctions);
    await expect(callable({ assignmentId: "assign-1" })).rejects.toThrow(
      "enrollment-inactive",
    );
  });

  // F5.2 §7.1 differentiation fields (Slice 5) - additive, optional, defensive.
  const REV = `pr${"a".repeat(64)}`;
  const PRESENTATION = {
    variantKey: "reading-adapted",
    presentationRevisionId: REV,
    path: `app/lessons/variants/lesson_earths-layers__${REV}.html`,
  };
  const REF = "0123456789abcdef0123456789abcdef";

  test("backward compatible: a resolution with no differentiation fields parses canonically", async () => {
    callableResponse = okResolution();
    const callable = createDeepLinkResolveCallable(fakeFunctions);
    const res = await callable({ assignmentId: "assign-1" });
    expect(res).not.toHaveProperty("presentation");
    expect(res).not.toHaveProperty("launchRef");
  });

  test("carries a well-formed presentation + launchRef verbatim", async () => {
    callableResponse = okResolution({ presentation: PRESENTATION, launchRef: REF });
    const callable = createDeepLinkResolveCallable(fakeFunctions);
    const res = await callable({ assignmentId: "assign-1" });
    expect(res.presentation).toEqual(PRESENTATION);
    expect(res.launchRef).toBe(REF);
  });

  test("drops a malformed presentation but still resolves canonically (no throw)", async () => {
    callableResponse = okResolution({
      presentation: { variantKey: "reading-adapted" },
      launchRef: REF,
    });
    const callable = createDeepLinkResolveCallable(fakeFunctions);
    const res = await callable({ assignmentId: "assign-1" });
    expect(res).not.toHaveProperty("presentation");
    expect(res.launchRef).toBe(REF);
  });
});
