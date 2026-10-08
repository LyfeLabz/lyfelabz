import {
  chooseCurrentTarget,
  listClassSwitchOptions,
  type ClassSwitcherClass,
} from "./class-switcher";
import type { AssignmentDetailMetadata } from "./types";

const meta = (
  assignmentId: string,
  classId: string,
  overrides: Partial<AssignmentDetailMetadata> = {},
): AssignmentDetailMetadata => ({
  assignmentId,
  title: "The Carbon Cycle",
  status: "published",
  className: `Class ${classId}`,
  classId,
  lessonSlug: "carbon-cycle",
  ...overrides,
});

const cls = (
  id: string,
  title: string,
  status: string = "active",
): ClassSwitcherClass => ({ id, title, status });

const SOURCE = meta("a-src", "c-src");

describe("listClassSwitchOptions", () => {
  test("offers every other class with the same lesson, in the class list's order", () => {
    const options = listClassSwitchOptions({
      source: SOURCE,
      classes: [cls("c-2", "Period 2"), cls("c-src", "SYT Acceptance"), cls("c-1", "Period 1")],
      assignments: [SOURCE, meta("a-1", "c-1"), meta("a-2", "c-2")],
    });
    expect(options.map((o) => [o.classId, o.className])).toEqual([
      ["c-2", "Period 2"],
      ["c-1", "Period 1"],
    ]);
    expect(options[0]!.target).toEqual({ kind: "assignment", assignmentId: "a-2" });
  });

  test("excludes the class being viewed even when it has another occurrence", () => {
    const options = listClassSwitchOptions({
      source: SOURCE,
      classes: [cls("c-src", "SYT Acceptance")],
      assignments: [SOURCE, meta("a-src-2", "c-src")],
    });
    expect(options).toEqual([]);
  });

  test("excludes unrelated lessons", () => {
    const options = listClassSwitchOptions({
      source: SOURCE,
      classes: [cls("c-1", "Period 1")],
      assignments: [SOURCE, meta("a-1", "c-1", { lessonSlug: "water-cycle" })],
    });
    expect(options).toEqual([]);
  });

  test("matches by canonical lessonSlug despite a different title", () => {
    const options = listClassSwitchOptions({
      source: SOURCE,
      classes: [cls("c-1", "Period 1")],
      assignments: [SOURCE, meta("a-1", "c-1", { title: "Carbon Cycle (retitled)" })],
    });
    expect(options.map((o) => o.classId)).toEqual(["c-1"]);
  });

  test("never matches an identical title with a different lessonSlug", () => {
    const options = listClassSwitchOptions({
      source: SOURCE,
      classes: [cls("c-1", "Period 1")],
      assignments: [
        SOURCE,
        meta("a-1", "c-1", { title: "The Carbon Cycle", lessonSlug: "carbon-cycle-review" }),
      ],
    });
    expect(options).toEqual([]);
  });

  test("excludes draft-only and legacy Closed-only classes", () => {
    const options = listClassSwitchOptions({
      source: SOURCE,
      classes: [cls("c-draft", "Drafts"), cls("c-closed", "Closed")],
      assignments: [
        SOURCE,
        meta("a-d", "c-draft", { status: "draft" }),
        meta("a-c", "c-closed", { status: "closed" }),
      ],
    });
    expect(options).toEqual([]);
  });

  test("a closed or draft occurrence does not make a single published occurrence ambiguous", () => {
    const options = listClassSwitchOptions({
      source: SOURCE,
      classes: [cls("c-1", "Period 1")],
      assignments: [
        SOURCE,
        meta("a-old", "c-1", { status: "closed" }),
        meta("a-new", "c-1"),
        meta("a-draft", "c-1", { status: "draft" }),
      ],
    });
    expect(options[0]!.target).toEqual({ kind: "assignment", assignmentId: "a-new" });
  });

  test("excludes archived and needsSetup classes", () => {
    const options = listClassSwitchOptions({
      source: SOURCE,
      classes: [cls("c-arch", "Old", "archived"), cls("c-setup", "New", "needsSetup")],
      assignments: [SOURCE, meta("a-arch", "c-arch"), meta("a-setup", "c-setup")],
    });
    expect(options).toEqual([]);
  });

  test("excludes a class that is not in the teacher's authorized class list", () => {
    const options = listClassSwitchOptions({
      source: SOURCE,
      classes: [cls("c-src", "SYT Acceptance")],
      assignments: [SOURCE, meta("a-foreign", "c-foreign")],
    });
    expect(options).toEqual([]);
  });

  test("more than one published occurrence requires resolving Current", () => {
    const options = listClassSwitchOptions({
      source: SOURCE,
      classes: [cls("c-1", "Period 1")],
      assignments: [SOURCE, meta("a-old", "c-1"), meta("a-new", "c-1"), meta("a-new", "c-1")],
    });
    expect(options[0]!.target).toEqual({
      kind: "resolveCurrent",
      lessonSlug: "carbon-cycle",
      publishedAssignmentIds: ["a-old", "a-new"],
    });
  });

  test("a historical source uses the same rules", () => {
    const historical = meta("a-src-old", "c-src");
    const options = listClassSwitchOptions({
      source: historical,
      classes: [cls("c-src", "SYT Acceptance"), cls("c-1", "Period 1")],
      assignments: [historical, SOURCE, meta("a-1", "c-1")],
    });
    expect(options.map((o) => o.target)).toEqual([
      { kind: "assignment", assignmentId: "a-1" },
    ]);
  });

  test("a source without a lessonSlug or classId offers nothing", () => {
    const options = listClassSwitchOptions({
      source: { ...SOURCE, lessonSlug: undefined },
      classes: [cls("c-1", "Period 1")],
      assignments: [meta("a-1", "c-1")],
    });
    expect(options).toEqual([]);
  });
});

describe("chooseCurrentTarget", () => {
  const ids = ["a-old", "a-new"];

  test("a valid Current among the published occurrences is chosen", () => {
    expect(
      chooseCurrentTarget(ids, { resolution: "valid", currentAssignmentId: "a-new" }),
    ).toBe("a-new");
  });

  test("a valid Current that is not a registry occurrence is not chosen", () => {
    expect(
      chooseCurrentTarget(ids, { resolution: "valid", currentAssignmentId: "a-elsewhere" }),
    ).toBeNull();
  });

  test.each(["unresolved", "invalid", "inactive"] as const)(
    "%s Current never picks an occurrence",
    (resolution) => {
      expect(chooseCurrentTarget(ids, { resolution, currentAssignmentId: null })).toBeNull();
    },
  );

  test("an unknown Current never picks an occurrence", () => {
    expect(chooseCurrentTarget(ids, null)).toBeNull();
  });
});
