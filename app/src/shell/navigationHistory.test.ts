import {
  parseShellHistoryState,
  isWorkspaceSurfaceKey,
  hashForSurface,
  hashForClassesWorkspace,
  hashForStudentDetail,
  parseSurfaceFromHash,
  urlWithHash,
} from "./navigationHistory";

describe("navigationHistory: parseShellHistoryState", () => {
  test("accepts a valid shell-surface state", () => {
    expect(parseShellHistoryState({ kind: "shell-surface", surface: "curriculum" })).toEqual({
      kind: "shell-surface",
      surface: "curriculum",
    });
  });

  test("accepts a shell-classes-workspace state recorded before per-section history (it keeps its Students meaning)", () => {
    expect(
      parseShellHistoryState({
        kind: "shell-classes-workspace",
        surface: "classes",
        classId: "c1",
      }),
    ).toEqual({ kind: "shell-classes-workspace", surface: "classes", classId: "c1", section: "roster" });
  });

  test.each(["assignments", "roster", "setup"])(
    "accepts a shell-classes-workspace state for section %s",
    (section) => {
      expect(
        parseShellHistoryState({ kind: "shell-classes-workspace", surface: "classes", classId: "c1", section }),
      ).toEqual({ kind: "shell-classes-workspace", surface: "classes", classId: "c1", section });
    },
  );

  test("rejects an unknown class workspace section (fails closed)", () => {
    expect(
      parseShellHistoryState({ kind: "shell-classes-workspace", surface: "classes", classId: "c1", section: "overview" }),
    ).toBeNull();
  });

  test("accepts the new nested-page states and rejects malformed ones", () => {
    expect(
      parseShellHistoryState({ kind: "shell-assignment-detail", surface: "classes", classId: "c1", assignmentId: "a1" }),
    ).toEqual({ kind: "shell-assignment-detail", surface: "classes", classId: "c1", assignmentId: "a1" });
    expect(
      parseShellHistoryState({ kind: "shell-lesson-summary", surface: "curriculum", lessonSlug: "engineering-design" }),
    ).toEqual({ kind: "shell-lesson-summary", surface: "curriculum", lessonSlug: "engineering-design" });
    expect(parseShellHistoryState({ kind: "shell-settings-integrations", surface: "settings" })).toEqual({
      kind: "shell-settings-integrations",
      surface: "settings",
    });
    expect(parseShellHistoryState({ kind: "shell-assignment-detail", surface: "classes", classId: "c1" })).toBeNull();
    expect(parseShellHistoryState({ kind: "shell-assignment-detail", surface: "curriculum", classId: "c1", assignmentId: "a" })).toBeNull();
    expect(parseShellHistoryState({ kind: "shell-lesson-summary", surface: "curriculum", lessonSlug: "" })).toBeNull();
    expect(parseShellHistoryState({ kind: "shell-settings-integrations", surface: "classes" })).toBeNull();
  });

  test("accepts a valid shell-student-detail state", () => {
    expect(
      parseShellHistoryState({
        kind: "shell-student-detail",
        surface: "classes",
        classId: "c1",
        studentId: "s1",
      }),
    ).toEqual({
      kind: "shell-student-detail",
      surface: "classes",
      classId: "c1",
      studentId: "s1",
    });
  });

  test.each([
    null,
    undefined,
    "a string",
    42,
    {},
    { kind: "shell-surface", surface: "not-a-surface" },
    { kind: "shell-surface" },
    { kind: "shell-classes-workspace", surface: "curriculum", classId: "c1" },
    { kind: "shell-classes-workspace", surface: "classes", classId: "" },
    { kind: "shell-classes-workspace", surface: "classes" },
    { kind: "shell-student-detail", surface: "curriculum", classId: "c1", studentId: "s1" },
    { kind: "shell-student-detail", surface: "classes", classId: "", studentId: "s1" },
    { kind: "shell-student-detail", surface: "classes", classId: "c1", studentId: "" },
    { kind: "shell-student-detail", surface: "classes", classId: "c1" },
    { kind: "unknown-kind" },
  ])("rejects malformed/foreign value %p", (value) => {
    expect(parseShellHistoryState(value)).toBeNull();
  });
});

describe("navigationHistory: surface key validation", () => {
  test("accepts exactly the three workspace surfaces", () => {
    expect(isWorkspaceSurfaceKey("classes")).toBe(true);
    expect(isWorkspaceSurfaceKey("curriculum")).toBe(true);
    expect(isWorkspaceSurfaceKey("settings")).toBe(true);
    expect(isWorkspaceSurfaceKey("students")).toBe(false);
    expect(isWorkspaceSurfaceKey(123)).toBe(false);
  });
});

describe("navigationHistory: hash/URL helpers", () => {
  test("hashForSurface produces a bare, deterministic fragment", () => {
    expect(hashForSurface("curriculum")).toBe("#curriculum");
  });

  test("hashForClassesWorkspace carries only the opaque classId, URI-encoded", () => {
    expect(hashForClassesWorkspace("c 1")).toBe("#classes/roster/c%201");
  });

  test("hashForStudentDetail carries only opaque ids, URI-encoded", () => {
    expect(hashForStudentDetail("c 1", "s/1")).toBe(
      "#classes/student/c%201/s%2F1",
    );
  });

  test("parseSurfaceFromHash round-trips a valid surface hash", () => {
    expect(parseSurfaceFromHash("#settings")).toBe("settings");
    expect(parseSurfaceFromHash("settings")).toBe("settings");
  });

  test("parseSurfaceFromHash rejects a nested-detail or garbage hash", () => {
    expect(parseSurfaceFromHash("#classes/student/c1/s1")).toBeNull();
    expect(parseSurfaceFromHash("")).toBeNull();
    expect(parseSurfaceFromHash("#")).toBeNull();
  });

  test("urlWithHash preserves the given pathname exactly, appending only the hash", () => {
    expect(urlWithHash("/app/teacher", "#curriculum")).toBe("/app/teacher#curriculum");
    expect(urlWithHash("/app/a/xyz", "#classes")).toBe("/app/a/xyz#classes");
  });
});
