import { buildAssignmentLaunchUrl } from "./launch";
import type { AssignmentsListForStudentItem } from "./types";

const mkItem = (
  overrides: Partial<AssignmentsListForStudentItem> = {},
): AssignmentsListForStudentItem =>
  Object.freeze({
    assignmentId: "assign-1",
    // After Sprint 28 Phase 5A.1, every assignable lesson (all 49) is
    // v2-overridden, so there is no assignable lesson left on the v1 path.
    // ragebaiting is a real but gated (non-surfaceable, non-assignable)
    // lesson that is intentionally absent from LESSON_LAUNCH_OVERRIDES, so it
    // exercises the launcher's v1 fallback for any non-overridden slug.
    lessonSlug: "ragebaiting",
    title: "Ragebaiting",
    status: "published" as const,
    publishedAt: 1_700_000_000_000,
    ...overrides,
  });

describe("buildAssignmentLaunchUrl", () => {
  test("uses the canonical lesson URL and encodes only the assignmentId", () => {
    const url = buildAssignmentLaunchUrl(mkItem());
    expect(url).toBe("/lesson_ragebaiting.html?assignment=assign-1");
  });

  test("percent-encodes reserved characters in assignmentId", () => {
    const url = buildAssignmentLaunchUrl(
      mkItem({ assignmentId: "a b&c?d#e/f=g" }),
    );
    expect(url).toBe(
      `/lesson_ragebaiting.html?assignment=${encodeURIComponent("a b&c?d#e/f=g")}`,
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

  // Sprint 18: Earth's Layers pilot uses the generated v2 artifact.
  test("Earth's Layers pilot resolves to the v2 artifact path", () => {
    const url = buildAssignmentLaunchUrl(
      mkItem({ lessonSlug: "earths-layers", assignmentId: "asg-42" }),
    );
    expect(url).toBe("/app/lessons/lesson_earths-layers.html?assignment=asg-42");
  });

  test("non-overridden lessons still resolve to the v1 root-level path", () => {
    // With all 49 assignable lessons v2-overridden after Phase 5A.1, the
    // gated (non-surfaceable) ragebaiting lesson is the canonical
    // non-overridden example that exercises the launcher's v1 fallback.
    const url = buildAssignmentLaunchUrl(
      mkItem({ lessonSlug: "ragebaiting", assignmentId: "asg-7" }),
    );
    expect(url).toBe("/lesson_ragebaiting.html?assignment=asg-7");
  });
});
