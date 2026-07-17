import {
  compareAssignmentsForSelection,
  groupAssignmentsByLesson,
  isValidForSelection,
} from "./grouping";
import type { AssignmentDetailMetadata } from "./types";

const m = (
  overrides: Partial<AssignmentDetailMetadata> & {
    readonly assignmentId: string;
    readonly lessonSlug: string;
    readonly className: string;
  },
): AssignmentDetailMetadata => ({
  title: "Lesson Title",
  status: "published",
  ...overrides,
});

describe("groupAssignmentsByLesson", () => {
  test("groups by lessonSlug", () => {
    const grouped = groupAssignmentsByLesson([
      m({ assignmentId: "a1", lessonSlug: "l1", className: "6A" }),
      m({ assignmentId: "a2", lessonSlug: "l2", className: "6A" }),
    ]);
    expect(Array.from(grouped.keys()).sort()).toEqual(["l1", "l2"]);
    expect(grouped.get("l1")).toHaveLength(1);
    expect(grouped.get("l2")).toHaveLength(1);
  });

  test("preserves two assignments for one lesson", () => {
    const grouped = groupAssignmentsByLesson([
      m({ assignmentId: "a1", lessonSlug: "l1", className: "6A" }),
      m({ assignmentId: "a2", lessonSlug: "l1", className: "6B" }),
    ]);
    expect(grouped.get("l1")).toHaveLength(2);
  });

  test("deduplicates by assignmentId (last write wins)", () => {
    const grouped = groupAssignmentsByLesson([
      m({ assignmentId: "a1", lessonSlug: "l1", className: "6A", title: "old" }),
      m({ assignmentId: "a1", lessonSlug: "l1", className: "6A", title: "new" }),
    ]);
    expect(grouped.get("l1")).toHaveLength(1);
    expect(grouped.get("l1")?.[0]?.title).toBe("new");
  });

  test("excludes malformed entries but keeps valid siblings", () => {
    const grouped = groupAssignmentsByLesson([
      m({ assignmentId: "a1", lessonSlug: "l1", className: "6A" }),
      { assignmentId: "", lessonSlug: "l1", title: "t", className: "6B", status: "published" },
      m({ assignmentId: "a3", lessonSlug: "l1", className: "6C" }),
    ]);
    expect(grouped.get("l1")).toHaveLength(2);
    expect(grouped.get("l1")?.map((x) => x.assignmentId).sort()).toEqual(["a1", "a3"]);
  });

  test("input order does not change output order", () => {
    const a = m({ assignmentId: "a1", lessonSlug: "l1", className: "6B" });
    const b = m({ assignmentId: "a2", lessonSlug: "l1", className: "6A" });
    const forward = groupAssignmentsByLesson([a, b]).get("l1");
    const reverse = groupAssignmentsByLesson([b, a]).get("l1");
    expect(forward?.map((x) => x.assignmentId)).toEqual(["a2", "a1"]);
    expect(reverse?.map((x) => x.assignmentId)).toEqual(["a2", "a1"]);
  });
});

describe("compareAssignmentsForSelection", () => {
  test("class name ascending", () => {
    const arr = [
      m({ assignmentId: "a1", lessonSlug: "l", className: "6B" }),
      m({ assignmentId: "a2", lessonSlug: "l", className: "6A" }),
    ].sort(compareAssignmentsForSelection);
    expect(arr.map((x) => x.className)).toEqual(["6A", "6B"]);
  });

  test("published sorts before closed for identical class names", () => {
    const arr = [
      m({ assignmentId: "a1", lessonSlug: "l", className: "6A", status: "closed" }),
      m({ assignmentId: "a2", lessonSlug: "l", className: "6A", status: "published" }),
    ].sort(compareAssignmentsForSelection);
    expect(arr.map((x) => x.status)).toEqual(["published", "closed"]);
  });

  test("title tie-breaker is stable", () => {
    const arr = [
      m({ assignmentId: "a1", lessonSlug: "l", className: "6A", title: "Beta" }),
      m({ assignmentId: "a2", lessonSlug: "l", className: "6A", title: "Alpha" }),
    ].sort(compareAssignmentsForSelection);
    expect(arr.map((x) => x.title)).toEqual(["Alpha", "Beta"]);
  });

  test("assignmentId final tie-breaker is stable", () => {
    const arr = [
      m({ assignmentId: "a2", lessonSlug: "l", className: "6A" }),
      m({ assignmentId: "a1", lessonSlug: "l", className: "6A" }),
    ].sort(compareAssignmentsForSelection);
    expect(arr.map((x) => x.assignmentId)).toEqual(["a1", "a2"]);
  });
});

describe("isValidForSelection", () => {
  test("rejects missing lesson slug", () => {
    expect(
      isValidForSelection({
        assignmentId: "a1",
        title: "t",
        className: "6A",
        status: "published",
      }),
    ).toBe(false);
  });
  test("accepts a fully-specified entry", () => {
    expect(
      isValidForSelection(
        m({ assignmentId: "a1", lessonSlug: "l1", className: "6A" }),
      ),
    ).toBe(true);
  });
});
