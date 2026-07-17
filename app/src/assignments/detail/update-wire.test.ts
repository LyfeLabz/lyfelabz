/**
 * @jest-environment jsdom
 */

// Sprint 13G: unit tests for the `assignmentsUpdateDraft` wire. The wire
// is the seam that keeps the pure Assignment Detail surface free of
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

import { createAssignmentsUpdateDraftCallable } from "./update-wire";

const FAKE_FUNCTIONS = {} as never;

beforeEach(() => {
  callableInvocations.length = 0;
  callableResponse = null;
  callableRejection = null;
});

describe("createAssignmentsUpdateDraftCallable", () => {
  test("invokes the assignmentsUpdateDraft callable with only supplied fields", async () => {
    callableResponse = {
      assignmentId: "assign-1",
      alreadyUpdated: false,
    };
    const callable = createAssignmentsUpdateDraftCallable(FAKE_FUNCTIONS);
    const result = await callable({
      assignmentId: "assign-1",
      title: "Updated Title",
    });
    expect(callableInvocations).toEqual([
      {
        name: "assignmentsUpdateDraft",
        payload: { assignmentId: "assign-1", title: "Updated Title" },
      },
    ]);
    expect(result).toEqual({
      assignmentId: "assign-1",
      alreadyUpdated: false,
    });
  });

  test("includes instructions on the payload when supplied", async () => {
    callableResponse = {
      assignmentId: "assign-1",
      alreadyUpdated: false,
    };
    const callable = createAssignmentsUpdateDraftCallable(FAKE_FUNCTIONS);
    await callable({
      assignmentId: "assign-1",
      title: "Updated Title",
      instructions: "Read the introduction and answer question 3.",
    });
    expect(callableInvocations).toEqual([
      {
        name: "assignmentsUpdateDraft",
        payload: {
          assignmentId: "assign-1",
          title: "Updated Title",
          instructions: "Read the introduction and answer question 3.",
        },
      },
    ]);
  });

  test("omits instructions from the payload when not supplied", async () => {
    callableResponse = {
      assignmentId: "assign-1",
      alreadyUpdated: false,
    };
    const callable = createAssignmentsUpdateDraftCallable(FAKE_FUNCTIONS);
    await callable({
      assignmentId: "assign-1",
      title: "Updated Title",
    });
    expect(callableInvocations[0]?.payload).toEqual({
      assignmentId: "assign-1",
      title: "Updated Title",
    });
  });

  test("omits title from the payload when not supplied", async () => {
    callableResponse = {
      assignmentId: "assign-2",
      alreadyUpdated: true,
    };
    const callable = createAssignmentsUpdateDraftCallable(FAKE_FUNCTIONS);
    await callable({ assignmentId: "assign-2" });
    expect(callableInvocations).toEqual([
      {
        name: "assignmentsUpdateDraft",
        payload: { assignmentId: "assign-2" },
      },
    ]);
  });

  test("propagates alreadyUpdated idempotent responses", async () => {
    callableResponse = {
      assignmentId: "assign-3",
      alreadyUpdated: true,
    };
    const callable = createAssignmentsUpdateDraftCallable(FAKE_FUNCTIONS);
    const result = await callable({
      assignmentId: "assign-3",
      title: "Same Title",
    });
    expect(result.alreadyUpdated).toBe(true);
  });

  test("rejects when the callable response shape is malformed", async () => {
    callableResponse = { assignmentId: "assign-1" };
    const callable = createAssignmentsUpdateDraftCallable(FAKE_FUNCTIONS);
    await expect(
      callable({ assignmentId: "assign-1", title: "x" }),
    ).rejects.toThrow(/unexpected shape/);
  });

  test("rejects when the callable itself rejects", async () => {
    callableRejection = new Error("permission-denied");
    const callable = createAssignmentsUpdateDraftCallable(FAKE_FUNCTIONS);
    await expect(
      callable({ assignmentId: "assign-1", title: "x" }),
    ).rejects.toThrow(/permission-denied/);
  });
});
