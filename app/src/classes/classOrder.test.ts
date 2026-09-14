/**
 * @jest-environment jsdom
 *
 * Sprint 30A.1 UX correction - canonical teacher class order.
 *
 * Unit coverage for the pure ordering logic (fallback ordering, the
 * saved-order merge, and the `ListClasses` composition wrapper) plus the
 * Firestore/callable read and write seams.
 */
import type { Functions } from "firebase/functions";
import type { Firestore } from "firebase/firestore";
import type { ClassSummary } from "./types";

const mockDoc = jest.fn(() => ({}));
const mockGetDoc = jest.fn();
jest.mock("firebase/firestore", () => ({
  doc: (...args: unknown[]) => (mockDoc as (...a: unknown[]) => unknown)(...args),
  getDoc: (...args: unknown[]) =>
    (mockGetDoc as (...a: unknown[]) => unknown)(...args),
}));

const mockHttpsCallableName = { value: null as string | null };
const mockCallablePayload = { value: null as unknown };
const mockCallableImpl = jest.fn(async (payload: unknown) => {
  mockCallablePayload.value = payload;
  return { data: { ok: true } };
});
jest.mock("firebase/functions", () => ({
  httpsCallable: (_fns: unknown, name: string) => {
    mockHttpsCallableName.value = name;
    return (payload: unknown) => mockCallableImpl(payload);
  },
}));

import {
  applyCanonicalClassOrder,
  computeFallbackClassOrder,
  createFirebaseUpdateTeacherClassOrder,
  createFirestoreReadTeacherClassOrder,
  createOrderedListClasses,
  moveClassId,
} from "./classOrder";

beforeEach(() => {
  mockDoc.mockClear();
  mockGetDoc.mockReset();
  mockHttpsCallableName.value = null;
  mockCallablePayload.value = null;
  mockCallableImpl.mockClear();
});

const active = (
  id: string,
  title: string,
  block?: string,
): ClassSummary =>
  Object.freeze({
    id,
    title,
    grade: "7",
    status: "active" as const,
    ...(block !== undefined ? { block } : {}),
  }) as ClassSummary;

const needsSetup = (id: string, title: string): ClassSummary =>
  Object.freeze({ id, title, status: "needsSetup" as const }) as ClassSummary;

describe("computeFallbackClassOrder", () => {
  test("sorts by block using a numeric-aware comparison, not lexicographic", () => {
    // Lexicographically "10" < "2", but a numeric-aware compare must put
    // "2" first - this is the exact bug a naive string sort would hit.
    const classes = [
      active("c1", "Science", "10"),
      active("c2", "Science", "2"),
      active("c3", "Science", "1"),
    ];
    expect(computeFallbackClassOrder(classes)).toEqual(["c3", "c2", "c1"]);
  });

  test("sorts letter blocks in natural order", () => {
    const classes = [
      active("c1", "Science", "C"),
      active("c2", "Science", "A"),
      active("c3", "Science", "B"),
    ];
    expect(computeFallbackClassOrder(classes)).toEqual(["c2", "c3", "c1"]);
  });

  test("classes with no block sort after classes with a block, by title", () => {
    const classes = [
      active("c1", "Zebra Studies"), // no block
      active("c2", "Science", "A"),
      needsSetup("c3", "Alpha Studies"), // needsSetup never has a block
    ];
    const order = computeFallbackClassOrder(classes);
    expect(order[0]).toBe("c2"); // has a block, sorts first
    expect(order.slice(1)).toEqual(["c3", "c1"]); // then by title
  });

  test("never hardcodes a letter/number scheme - period numbers work", () => {
    const classes = [
      active("c1", "Physics", "Period 10"),
      active("c2", "Physics", "Period 2"),
    ];
    expect(computeFallbackClassOrder(classes)).toEqual(["c2", "c1"]);
  });

  test("classes with no block metadata at all still produce a deterministic order", () => {
    const classes = [active("c1", "Beta"), active("c2", "Alpha")];
    expect(computeFallbackClassOrder(classes)).toEqual(["c2", "c1"]);
  });
});

describe("applyCanonicalClassOrder", () => {
  const classes = [
    active("c1", "A Science", "A"),
    active("c2", "C Science", "C"),
    active("c3", "E Science", "E"),
  ];

  test("no persisted order at all falls back to the deterministic order", () => {
    const ordered = applyCanonicalClassOrder(classes, null);
    expect(ordered.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });

  test("a full persisted order is honored verbatim", () => {
    const ordered = applyCanonicalClassOrder(classes, ["c3", "c1", "c2"]);
    expect(ordered.map((c) => c.id)).toEqual(["c3", "c1", "c2"]);
  });

  test("a newly added class not in the persisted order is appended, never spliced into the middle", () => {
    const withNewClass = [...classes, active("c4", "G Science", "G")];
    const ordered = applyCanonicalClassOrder(withNewClass, ["c3", "c1", "c2"]);
    expect(ordered.map((c) => c.id)).toEqual(["c3", "c1", "c2", "c4"]);
  });

  test("a deleted/archived class id in the persisted order is silently ignored", () => {
    const ordered = applyCanonicalClassOrder(classes, [
      "c3",
      "no-longer-exists",
      "c1",
      "c2",
    ]);
    expect(ordered.map((c) => c.id)).toEqual(["c3", "c1", "c2"]);
  });

  test("a duplicate id in a corrupt persisted order is de-duplicated, not repeated", () => {
    const ordered = applyCanonicalClassOrder(classes, ["c1", "c1", "c2", "c3"]);
    expect(ordered.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(ordered).toHaveLength(3);
  });
});

// Sprint 30A.1 human-review finalization: the pure array-surgery step the
// Classes workspace's drag-drop and keyboard reorder interactions reduce
// to (see classes.ts). Deterministic and side-effect-free.
describe("moveClassId", () => {
  const ids = ["c1", "c2", "c3", "c4"];

  test("moves an id to just before another id", () => {
    expect(moveClassId(ids, "c1", "c3")).toEqual(["c2", "c1", "c3", "c4"]);
  });

  test("moves an id to the end when beforeId is null", () => {
    expect(moveClassId(ids, "c1", null)).toEqual(["c2", "c3", "c4", "c1"]);
  });

  test("moving an id before itself is a no-op", () => {
    expect(moveClassId(ids, "c2", "c3")).toEqual(["c1", "c2", "c3", "c4"]);
  });

  test("an id not present in the list is a no-op (returns the same array)", () => {
    const result = moveClassId(ids, "not-a-real-id", "c2");
    expect(result).toBe(ids);
  });

  test("a beforeId not present in the list falls back to appending at the end", () => {
    expect(moveClassId(ids, "c1", "not-a-real-id")).toEqual(["c2", "c3", "c4", "c1"]);
  });

  test("is deterministic - the same inputs always produce the same output", () => {
    expect(moveClassId(ids, "c4", "c1")).toEqual(moveClassId(ids, "c4", "c1"));
  });
});

describe("createOrderedListClasses", () => {
  test("composes the base reader with the persisted order", async () => {
    const classes = [
      active("c1", "A Science", "A"),
      active("c2", "C Science", "C"),
    ];
    const listClasses = async () => classes;
    const readOrder = async () => ["c2", "c1"];
    const ordered = createOrderedListClasses(listClasses, readOrder);
    const result = await ordered("uid-1");
    expect(result.map((c) => c.id)).toEqual(["c2", "c1"]);
  });

  test("degrades to the fallback order when reading the preference fails, rather than breaking the list", async () => {
    // createOrderedListClasses itself already catches a rejecting order
    // reader internally and degrades to the fallback order - ordering is
    // documented as a convenience, never a load-bearing read.
    const classes = [active("c1", "B Science", "B"), active("c2", "A Science", "A")];
    const listClasses = async () => classes;
    const failingReadOrder = async (): Promise<readonly string[] | null> => {
      throw new Error("network blip");
    };
    const ordered = createOrderedListClasses(listClasses, failingReadOrder);
    await expect(ordered("uid-1")).resolves.toMatchObject([
      { id: "c2" },
      { id: "c1" },
    ]);
  });
});

describe("createFirestoreReadTeacherClassOrder", () => {
  test("returns the persisted array when the doc exists with string entries", async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ classOrder: ["c2", "c1"] }),
    });
    const read = createFirestoreReadTeacherClassOrder({} as unknown as Firestore);
    await expect(read("uid-1")).resolves.toEqual(["c2", "c1"]);
  });

  test("returns null when the doc does not exist", async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => false,
      data: () => undefined,
    });
    const read = createFirestoreReadTeacherClassOrder({} as unknown as Firestore);
    await expect(read("uid-1")).resolves.toBeNull();
  });

  test("returns null for a malformed (non-array) classOrder field", async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ classOrder: "not-an-array" }),
    });
    const read = createFirestoreReadTeacherClassOrder({} as unknown as Firestore);
    await expect(read("uid-1")).resolves.toBeNull();
  });
});

describe("createFirebaseUpdateTeacherClassOrder", () => {
  test("invokes teacherClassOrderUpdate with the classOrder payload", async () => {
    const update = createFirebaseUpdateTeacherClassOrder(
      {} as unknown as Functions,
    );
    await update(["c2", "c1"]);
    expect(mockHttpsCallableName.value).toBe("teacherClassOrderUpdate");
    expect(mockCallablePayload.value).toEqual({ classOrder: ["c2", "c1"] });
  });
});
