/**
 * @jest-environment jsdom
 */

// Sprint 27 Phase 5: unit tests for the late-recipient wires. The wires keep
// the pure Assignment Detail surface free of firebase/*. Tests inject a fake
// `httpsCallable` factory through a jest.mock; no real firebase/functions
// bindings are exercised.

const callableInvocations: Array<{
  readonly name: string;
  readonly payload: unknown;
}> = [];

let candidatesResponse: unknown = null;
let addResponse: unknown = null;
let callableRejection: Error | null = null;

jest.mock("firebase/functions", () => ({
  httpsCallable:
    (_functions: unknown, name: string) =>
    (payload: unknown) => {
      callableInvocations.push({ name, payload });
      if (callableRejection !== null) {
        return Promise.reject(callableRejection);
      }
      const data =
        name === "assignmentsRecipientCandidatesList"
          ? candidatesResponse
          : addResponse;
      return Promise.resolve({ data });
    },
}));

import {
  createAssignmentRecipientCandidatesListCallable,
  createAssignmentsRecipientAddCallable,
} from "./late-recipient-wire";

const FAKE_FUNCTIONS = {} as never;

beforeEach(() => {
  callableInvocations.length = 0;
  candidatesResponse = null;
  addResponse = null;
  callableRejection = null;
});

describe("createAssignmentRecipientCandidatesListCallable", () => {
  test("invokes the certified callable with only the assignmentId", async () => {
    candidatesResponse = {
      assignmentId: "assign-1",
      candidates: [
        { studentId: "s-a", studentDisplayName: "Ada" },
        { studentId: "s-b", studentDisplayName: "Ben" },
      ],
    };
    const callable = createAssignmentRecipientCandidatesListCallable(
      FAKE_FUNCTIONS,
    );
    const res = await callable({ assignmentId: "assign-1" });
    expect(callableInvocations).toEqual([
      {
        name: "assignmentsRecipientCandidatesList",
        payload: { assignmentId: "assign-1" },
      },
    ]);
    expect(res.assignmentId).toBe("assign-1");
    expect(res.candidates.map((c) => c.studentId)).toEqual(["s-a", "s-b"]);
  });

  test("drops malformed candidate items defensively", async () => {
    candidatesResponse = {
      assignmentId: "assign-1",
      candidates: [
        { studentId: "s-a", studentDisplayName: "Ada" },
        { studentId: "s-b" }, // missing display name
        { studentDisplayName: "No Id" }, // missing id
        null,
        "nope",
        { studentId: "", studentDisplayName: "Empty" },
      ],
    };
    const callable = createAssignmentRecipientCandidatesListCallable(
      FAKE_FUNCTIONS,
    );
    const res = await callable({ assignmentId: "assign-1" });
    expect(res.candidates).toEqual([
      { studentId: "s-a", studentDisplayName: "Ada" },
    ]);
  });

  test("tolerates a missing candidates array", async () => {
    candidatesResponse = { assignmentId: "assign-1" };
    const callable = createAssignmentRecipientCandidatesListCallable(
      FAKE_FUNCTIONS,
    );
    const res = await callable({ assignmentId: "assign-1" });
    expect(res.candidates).toEqual([]);
    expect(res.assignmentId).toBe("assign-1");
  });

  test("propagates a callable rejection", async () => {
    callableRejection = new Error("permission-denied");
    const callable = createAssignmentRecipientCandidatesListCallable(
      FAKE_FUNCTIONS,
    );
    await expect(callable({ assignmentId: "assign-1" })).rejects.toThrow(
      /permission-denied/,
    );
  });
});

describe("createAssignmentsRecipientAddCallable", () => {
  test("invokes assignmentsRecipientAdd with only the id pair", async () => {
    addResponse = { assignmentId: "assign-1", studentId: "s-a", added: true };
    const callable = createAssignmentsRecipientAddCallable(FAKE_FUNCTIONS);
    const res = await callable({ assignmentId: "assign-1", studentId: "s-a" });
    expect(callableInvocations).toEqual([
      {
        name: "assignmentsRecipientAdd",
        payload: { assignmentId: "assign-1", studentId: "s-a" },
      },
    ]);
    expect(res).toEqual({
      assignmentId: "assign-1",
      studentId: "s-a",
      added: true,
    });
  });

  test("never sends a client-controlled source or ownership field", async () => {
    addResponse = { assignmentId: "assign-1", studentId: "s-a", added: true };
    const callable = createAssignmentsRecipientAddCallable(FAKE_FUNCTIONS);
    await callable({ assignmentId: "assign-1", studentId: "s-a" });
    const payload = callableInvocations[0].payload as Record<string, unknown>;
    for (const forbidden of [
      "source",
      "status",
      "classId",
      "schoolId",
      "teacherId",
      "districtId",
      "assignedAt",
      "assignedBy",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(payload, forbidden)).toBe(
        false,
      );
    }
  });

  test("reports the idempotent already-added replay as added: false", async () => {
    addResponse = { assignmentId: "assign-1", studentId: "s-a", added: false };
    const callable = createAssignmentsRecipientAddCallable(FAKE_FUNCTIONS);
    const res = await callable({ assignmentId: "assign-1", studentId: "s-a" });
    expect(res.added).toBe(false);
  });

  test("propagates a callable rejection", async () => {
    callableRejection = new Error("enrollment-inactive");
    const callable = createAssignmentsRecipientAddCallable(FAKE_FUNCTIONS);
    await expect(
      callable({ assignmentId: "assign-1", studentId: "s-a" }),
    ).rejects.toThrow(/enrollment-inactive/);
  });
});
