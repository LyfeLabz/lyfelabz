import { buildAssignmentLaunchUrl } from "./launch";
import type { AssignmentsListForStudentItem } from "./types";

const mkItem = (
  overrides: Partial<AssignmentsListForStudentItem> = {},
): AssignmentsListForStudentItem =>
  Object.freeze({
    assignmentId: "assign-1",
    lessonSlug: "what-is-life",
    title: "What is life?",
    status: "published" as const,
    publishedAt: 1_700_000_000_000,
    ...overrides,
  });

describe("buildAssignmentLaunchUrl", () => {
  test("uses the canonical lesson URL and encodes only the assignmentId", () => {
    const url = buildAssignmentLaunchUrl(mkItem());
    expect(url).toBe("/lesson_what-is-life.html?assignment=assign-1");
  });

  test("percent-encodes reserved characters in assignmentId", () => {
    const url = buildAssignmentLaunchUrl(
      mkItem({ assignmentId: "a b&c?d#e/f=g" }),
    );
    expect(url).toBe(
      `/lesson_what-is-life.html?assignment=${encodeURIComponent("a b&c?d#e/f=g")}`,
    );
  });

  test("adds only the assignment parameter and no other query keys", () => {
    const raw = buildAssignmentLaunchUrl(mkItem());
    expect(raw).not.toBeNull();
    const [, query = ""] = raw!.split("?");
    const params = new URLSearchParams(query);
    expect(Array.from(params.keys())).toEqual(["assignment"]);
  });

  test.each([
    ["uid", "uid=u1"],
    ["schoolId", "schoolId=s1"],
    ["districtId", "districtId=d1"],
    ["teacherId", "teacherId=t1"],
    ["classId", "classId=c1"],
    ["recipient", "recipient=r1"],
    ["session", "session=sess-1"],
    ["token", "token=t"],
    ["score", "score=100"],
  ])("never leaks %s into the URL", (_key, needle) => {
    const url = buildAssignmentLaunchUrl(mkItem()) ?? "";
    expect(url).not.toContain(needle);
  });

  test.each([
    ["empty assignmentId", { assignmentId: "" }],
    ["empty lessonSlug", { lessonSlug: "" }],
    ["path traversal in slug", { lessonSlug: "../secret" }],
    ["slash in slug", { lessonSlug: "foo/bar" }],
    ["query in slug", { lessonSlug: "what?evil=1" }],
    ["space in slug", { lessonSlug: "what is life" }],
    ["leading dash in slug", { lessonSlug: "-what-is-life" }],
    ["trailing dash in slug", { lessonSlug: "what-is-life-" }],
  ])("rejects malformed item: %s", (_label, overrides) => {
    expect(buildAssignmentLaunchUrl(mkItem(overrides))).toBeNull();
  });

  test("does not depend on window.location", () => {
    // Sentinel: buildAssignmentLaunchUrl is a pure function of the
    // supplied item. A regression that read window.location would fail
    // in the pure-node environment used by this test file.
    expect(typeof buildAssignmentLaunchUrl).toBe("function");
    const url = buildAssignmentLaunchUrl(mkItem());
    expect(url).toMatch(/^\/lesson_/);
  });
});
