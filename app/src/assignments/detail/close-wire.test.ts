/**
 * @jest-environment jsdom
 */

// Sprint 13D: unit tests for the `assignmentsClose` wire. The wire is
// the seam that keeps the pure Assignment Detail surface free of
// firebase/*. Tests inject a fake `httpsCallable` factory through a
// jest.mock; no real firebase/functions bindings are exercised.

const callableInvocations: Array<{
  readonly name: string;
  readonly payload: unknown;
}> = [];

let callableResponse: unknown = null;
let callableRejection: Error | null = null;

jest.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) =>
    (payload: unknown) => {
      callableInvocations.push({ name, payload });
      if (callableRejection !== null) {
        return Promise.reject(callableRejection);
      }
      return Promise.resolve({ data: callableResponse });
    },
}));

import { createAssignmentsCloseCallable } from "./close-wire";

const FAKE_FUNCTIONS = {} as never;

beforeEach(() => {
  callableInvocations.length = 0;
  callableResponse = null;
  callableRejection = null;
});

describe("createAssignmentsCloseCallable", () => {
  test("invokes the assignmentsClose callable with the assignment id", async () => {
    callableResponse = {
      assignmentId: "assign-1",
      status: "closed",
      alreadyClosed: false,
    };
    const callable = createAssignmentsCloseCallable(FAKE_FUNCTIONS);
    const result = await callable({ assignmentId: "assign-1" });
    expect(callableInvocations).toEqual([
      { name: "assignmentsClose", payload: { assignmentId: "assign-1" } },
    ]);
    expect(result).toEqual({
      assignmentId: "assign-1",
      status: "closed",
      alreadyClosed: false,
    });
  });

  test("propagates already-closed idempotent responses", async () => {
    callableResponse = {
      assignmentId: "assign-2",
      status: "closed",
      alreadyClosed: true,
    };
    const callable = createAssignmentsCloseCallable(FAKE_FUNCTIONS);
    const result = await callable({ assignmentId: "assign-2" });
    expect(result.alreadyClosed).toBe(true);
    expect(result.status).toBe("closed");
  });

  test("rejects when the callable response shape is malformed", async () => {
    callableResponse = { assignmentId: "assign-1", status: "open" };
    const callable = createAssignmentsCloseCallable(FAKE_FUNCTIONS);
    await expect(callable({ assignmentId: "assign-1" })).rejects.toThrow(
      /unexpected shape/,
    );
  });

  test("rejects when the callable itself rejects", async () => {
    callableRejection = new Error("permission-denied");
    const callable = createAssignmentsCloseCallable(FAKE_FUNCTIONS);
    await expect(callable({ assignmentId: "assign-1" })).rejects.toThrow(
      /permission-denied/,
    );
  });
});
