/**
 * @jest-environment jsdom
 */

// Sprint 17 Slice 4: unit tests for the `assignmentsListForStudent` wire.
// The wire is the seam that keeps the pure activeStudent surface free of
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

import type { Functions } from "firebase/functions";
import {
  createAssignmentsListForStudentCallable,
  parseAssignmentsListForStudentItem,
} from "./wire";

const resetInvocations = () => {
  callableInvocations.length = 0;
  callableResponse = null;
  callableRejection = null;
};

const okItem = (over: Record<string, unknown> = {}) => ({
  assignmentId: "assign-1",
  lessonSlug: "what-is-life",
  title: "What is life?",
  status: "published" as const,
  publishedAt: 1_700_000_000_000,
  ...over,
});

describe("parseAssignmentsListForStudentItem", () => {
  const base = okItem();

  test("accepts a well-formed item and returns a frozen shape", () => {
    const item = parseAssignmentsListForStudentItem(base);
    expect(item).not.toBeNull();
    expect(item).toEqual(base);
    expect(Object.isFrozen(item)).toBe(true);
  });

  test("accepts publishedAt=null", () => {
    const item = parseAssignmentsListForStudentItem({
      ...base,
      publishedAt: null,
    });
    expect(item?.publishedAt).toBeNull();
  });

  test.each([
    ["missing assignmentId", { ...base, assignmentId: "" }],
    ["non-string assignmentId", { ...base, assignmentId: 1 }],
    ["missing lessonSlug", { ...base, lessonSlug: "" }],
    ["missing title", { ...base, title: "" }],
    ["draft status", { ...base, status: "draft" }],
    ["closed status", { ...base, status: "closed" }],
    ["archived status", { ...base, status: "archived" }],
    ["NaN publishedAt", { ...base, publishedAt: Number.NaN }],
    ["string publishedAt", { ...base, publishedAt: "later" }],
    ["null root", null],
    ["string root", "assign-1"],
  ])("rejects malformed item: %s", (_label, raw) => {
    expect(parseAssignmentsListForStudentItem(raw)).toBeNull();
  });
});

describe("createAssignmentsListForStudentCallable", () => {
  const fakeFunctions = {} as unknown as Functions;

  beforeEach(() => {
    resetInvocations();
  });

  test("registers the callable under the certified name and sends the empty request payload", async () => {
    callableResponse = { items: [] };
    const callable = createAssignmentsListForStudentCallable(fakeFunctions);
    await callable();
    expect(callableInvocations).toHaveLength(1);
    expect(callableInvocations[0].name).toBe("assignmentsListForStudent");
    expect(callableInvocations[0].payload).toEqual({});
  });

  test("normalizes a well-formed response and freezes the item list", async () => {
    callableResponse = {
      items: [
        okItem(),
        okItem({
          assignmentId: "assign-2",
          lessonSlug: "cell-types",
          title: "Cell Types",
        }),
      ],
    };
    const callable = createAssignmentsListForStudentCallable(fakeFunctions);
    const res = await callable();
    expect(res.items).toHaveLength(2);
    expect(res.items[0]).toEqual(okItem());
    expect(Object.isFrozen(res.items)).toBe(true);
    expect(Object.isFrozen(res.items[0])).toBe(true);
  });

  test("silently drops malformed items but keeps the good ones", async () => {
    callableResponse = {
      items: [
        okItem(),
        { ...okItem({ assignmentId: "assign-2" }), status: "draft" },
        { ...okItem({ assignmentId: "assign-3" }), lessonSlug: "" },
        null,
        "assign-4",
      ],
    };
    const callable = createAssignmentsListForStudentCallable(fakeFunctions);
    const res = await callable();
    expect(res.items).toHaveLength(1);
    expect(res.items[0].assignmentId).toBe("assign-1");
  });

  test("returns an empty list when the response is empty or malformed at the root", async () => {
    for (const raw of [
      null,
      undefined,
      {},
      { items: null },
      { items: "not-an-array" },
    ]) {
      resetInvocations();
      callableResponse = raw;
      const callable = createAssignmentsListForStudentCallable(fakeFunctions);
      const res = await callable();
      expect(res.items).toEqual([]);
    }
  });

  test("propagates callable failures so the surface can render a recoverable error", async () => {
    callableRejection = new Error("network");
    const callable = createAssignmentsListForStudentCallable(fakeFunctions);
    await expect(callable()).rejects.toThrow("network");
  });
});
