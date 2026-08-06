/**
 * @jest-environment jsdom
 */
import { createFirebaseLmsCreateClass } from "./lmsCreateClass";
import type { Functions } from "firebase/functions";

// Sprint 24B Phase 2B.4 - Client wrapper tests for the certified
// `classesLmsCreate` callable. Uses a jest.mock over firebase/functions
// so no live SDK is exercised.

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

describe("createFirebaseLmsCreateClass", () => {
  test("targets the classesLmsCreate callable and passes only classId + title", async () => {
    responseData = {
      classId: "abcdef0123456789wxyz",
      status: "needsSetup",
      alreadyCreated: false,
    };
    const create = createFirebaseLmsCreateClass(fns);
    const result = await create({
      classId: "abcdef0123456789wxyz",
      title: "Period 3 Science",
    });
    expect(lastCallableName).toBe("classesLmsCreate");
    expect(lastPayload).toEqual({
      classId: "abcdef0123456789wxyz",
      title: "Period 3 Science",
    });
    expect(result.classId).toBe("abcdef0123456789wxyz");
    expect(result.alreadyCreated).toBe(false);
  });

  test("preserves alreadyCreated true on idempotent replay", async () => {
    responseData = {
      classId: "cid1",
      status: "needsSetup",
      alreadyCreated: true,
    };
    const create = createFirebaseLmsCreateClass(fns);
    const result = await create({ classId: "cid1", title: "T" });
    expect(result.alreadyCreated).toBe(true);
  });

  test("falls back to input classId when server response omits it", async () => {
    responseData = { status: "needsSetup" };
    const create = createFirebaseLmsCreateClass(fns);
    const result = await create({ classId: "cid-fallback", title: "T" });
    expect(result.classId).toBe("cid-fallback");
    expect(result.alreadyCreated).toBe(false);
  });

  test("rethrows callable errors unchanged", async () => {
    shouldThrow = Object.assign(new Error("nope"), {
      code: "classes.conflict",
    });
    const create = createFirebaseLmsCreateClass(fns);
    await expect(create({ classId: "cid", title: "T" })).rejects.toMatchObject({
      code: "classes.conflict",
    });
  });
});
