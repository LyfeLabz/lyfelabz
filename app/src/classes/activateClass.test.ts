/**
 * @jest-environment jsdom
 */
import { createFirebaseActivateClass } from "./activateClass";
import type { Functions } from "firebase/functions";

// Sprint 24B Phase 2B.4 - Client wrapper tests for the certified
// `classesActivate` callable.

let lastCallableName: string | null = null;
let lastPayload: unknown = null;
let responseData: unknown = null;
let shouldThrow: unknown = null;

jest.mock("firebase/functions", () => ({
  httpsCallable: (_fns: unknown, name: string) => {
    lastCallableName = name;
    return async (payload: unknown) => {
      lastPayload = payload;
      if (shouldThrow) throw shouldThrow;
      return { data: responseData };
    };
  },
}));

const fns = {} as unknown as Functions;

beforeEach(() => {
  lastCallableName = null;
  lastPayload = null;
  responseData = null;
  shouldThrow = null;
});

describe("createFirebaseActivateClass", () => {
  test("targets the classesActivate callable and passes classId + grade + block", async () => {
    responseData = {
      classId: "cid1",
      status: "active",
      joinCode: "AAAABBBB",
      alreadyActive: false,
    };
    const activate = createFirebaseActivateClass(fns);
    const result = await activate({ classId: "cid1", grade: "7", block: "A" });
    expect(lastCallableName).toBe("classesActivate");
    expect(lastPayload).toEqual({
      classId: "cid1",
      grade: "7",
      block: "A",
    });
    expect(result.classId).toBe("cid1");
    expect(result.status).toBe("active");
    expect(result.joinCode).toBe("AAAABBBB");
    expect(result.alreadyActive).toBe(false);
  });

  test("preserves alreadyActive true on idempotent activation", async () => {
    responseData = {
      classId: "cid",
      status: "active",
      joinCode: "CCCCDDDD",
      alreadyActive: true,
    };
    const activate = createFirebaseActivateClass(fns);
    const result = await activate({ classId: "cid", grade: "8", block: "C" });
    expect(result.alreadyActive).toBe(true);
    expect(result.joinCode).toBe("CCCCDDDD");
  });

  test("rethrows callable errors unchanged", async () => {
    shouldThrow = Object.assign(new Error("nope"), {
      code: "classes.alreadyActiveConflict",
    });
    const activate = createFirebaseActivateClass(fns);
    await expect(
      activate({ classId: "cid", grade: "6", block: "B" }),
    ).rejects.toMatchObject({ code: "classes.alreadyActiveConflict" });
  });
});
