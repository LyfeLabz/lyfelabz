import { buildAssignmentLaunchUrl, buildRevisionBoundLessonPath } from "./launch";
import { resolveAssessmentRevisionPath } from "./revisionPaths";
import type { AssignmentsListForStudentItem } from "./types";

const mkItem = (
  overrides: Partial<AssignmentsListForStudentItem> = {},
): AssignmentsListForStudentItem =>
  Object.freeze({
    assignmentId: "assign-1",
    // F5.3 Slice 9D: an assignment launch routes to the canonical page of the
    // assignment's FROZEN revision (server-derived), from the build-generated
    // revision-path table.
    lessonSlug: "what-is-life",
    title: "What is life?",
    status: "published" as const,
    publishedAt: 1_700_000_000_000,
    assessmentRevisionId: `assessment_${overrides.lessonSlug ?? "what-is-life"}__r1`,
    ...overrides,
  });

describe("buildAssignmentLaunchUrl", () => {
  test("uses the canonical lesson URL and encodes only the assignmentId", () => {
    const url = buildAssignmentLaunchUrl(mkItem());
    expect(url).toBe("/app/lessons/lesson_what-is-life.html#assignment=assign-1");
  });

  test("percent-encodes reserved characters in assignmentId", () => {
    const url = buildAssignmentLaunchUrl(
      mkItem({ assignmentId: "a b&c?d#e/f=g" }),
    );
    expect(url).toBe(
      `/app/lessons/lesson_what-is-life.html#assignment=${encodeURIComponent("a b&c?d#e/f=g")}`,
    );
  });

  test("carries only the assignment parameter, in the fragment, and no query string at all", () => {
    const raw = buildAssignmentLaunchUrl(mkItem());
    expect(raw).not.toBeNull();
    const url = new URL(raw!, "https://lyfelabz.test");
    expect(url.search).toBe("");
    expect(Array.from(new URLSearchParams(url.hash.slice(1)).keys())).toEqual(["assignment"]);
    expect(new URLSearchParams(url.hash.slice(1)).get("assignment")).toBe("assign-1");
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
    expect(url).toMatch(/^\/app\/lessons\/lesson_/);
  });

  // Sprint 18: Earth's Layers pilot uses the generated v2 artifact. Since the
  // Earth's Layers r2 authoring pass it has two committed revisions, so an
  // assignment frozen at r1 opens the r1 revision rendition.
  test("Earth's Layers resolves to the v2 rendition of the assignment's frozen revision", () => {
    const url = buildAssignmentLaunchUrl(
      mkItem({ lessonSlug: "earths-layers", assignmentId: "asg-42" }),
    );
    expect(url).toBe("/app/lessons/assessment-revisions/lesson_earths-layers__r1.html#assignment=asg-42");
  });

  test("a lesson with no page in the revision-path table has no launch URL (no v1 or current fallback)", () => {
    // F5.3 Slice 9D: ragebaiting is a real but gated, non-assignable lesson
    // with no committed assessment; it has no revision page, so the launch
    // fails closed instead of falling back to its v1 root page.
    expect(buildAssignmentLaunchUrl(mkItem({ lessonSlug: "ragebaiting", assignmentId: "asg-7" }))).toBeNull();
  });
});

// F5.3 Slice 9D (addendum 21.5): revision-bound canonical routing.
describe("revision-bound canonical routing (F5.3 Slice 9D)", () => {
  const EL = "earths-layers";
  const R1 = `assessment_${EL}__r1`;
  const R2 = `assessment_${EL}__r2`;
  // Synthetic multi-revision state: r2 is current, r1 is historical; each
  // revision maps to its own rendition (the shape the 9B build emits).
  const synthetic = {
    schemaVersion: 1,
    kind: "lyfelabz.assessmentRevisionPaths",
    lessons: {
      [EL]: {
        [R1]: `/app/lessons/assessment-revisions/lesson_${EL}__r1.html`,
        [R2]: `/app/lessons/assessment-revisions/lesson_${EL}__r2.html`,
      },
    },
  };

  test("with the real r2 current, an r1 assignment routes to the exact r1 rendition, never the current page", () => {
    expect(buildAssignmentLaunchUrl(mkItem({ lessonSlug: EL, assessmentRevisionId: R1, assignmentId: "a1" }))).toBe(
      "/app/lessons/assessment-revisions/lesson_earths-layers__r1.html#assignment=a1",
    );
  });

  test("an r2 assignment routes to the exact r2 rendition from the committed table", () => {
    expect(buildAssignmentLaunchUrl(mkItem({ lessonSlug: EL, assessmentRevisionId: R2, assignmentId: "a2" }))).toBe(
      "/app/lessons/assessment-revisions/lesson_earths-layers__r2.html#assignment=a2",
    );
  });

  test("with a synthetic r2 current, r1 stays r1 and r2 routes to its own rendition", () => {
    expect(resolveAssessmentRevisionPath(EL, R1, synthetic)).toBe(`/app/lessons/assessment-revisions/lesson_${EL}__r1.html`);
    expect(resolveAssessmentRevisionPath(EL, R2, synthetic)).toBe(`/app/lessons/assessment-revisions/lesson_${EL}__r2.html`);
  });

  test.each([
    ["a missing revision", undefined],
    ["an unmapped revision", `assessment_${EL}__r3`],
    ["a malformed revision", `assessment_${EL}__r01`],
    ["another lesson's revision", "assessment_water-cycle__r1"],
    ["a non-string revision", 1],
  ])("%s refuses (no current or unversioned fallback)", (_label, rev) => {
    expect(buildAssignmentLaunchUrl(mkItem({ lessonSlug: EL, assessmentRevisionId: rev as string | undefined }))).toBeNull();
    expect(buildRevisionBoundLessonPath(EL, rev)).toBeNull();
  });

  test("a table entry with an unexpected path shape, kind, or schema is refused", () => {
    const bad = { ...synthetic, lessons: { [EL]: { [R1]: "https://evil.example/x.html" } } };
    expect(resolveAssessmentRevisionPath(EL, R1, bad)).toBeNull();
    expect(resolveAssessmentRevisionPath(EL, R1, { ...synthetic, kind: "other" })).toBeNull();
    expect(resolveAssessmentRevisionPath(EL, R1, { ...synthetic, schemaVersion: 2 })).toBeNull();
    expect(resolveAssessmentRevisionPath(EL, "__proto__", synthetic)).toBeNull();
  });

  test("the URL never carries the revision; only the assignment id is added", () => {
    const url = buildAssignmentLaunchUrl(mkItem({ lessonSlug: EL, assessmentRevisionId: R1 }))!;
    expect(url).not.toContain("assessment_");
    const parsed = new URL(url, "https://lyfelabz.test");
    expect(parsed.search).toBe("");
    expect([...new URLSearchParams(parsed.hash.slice(1)).keys()]).toEqual(["assignment"]);
  });

  test("the bundled table is the committed 9B table (single-revision r1 -> unversioned v2 page; Earth's Layers -> renditions)", () => {
    for (const slug of ["what-is-life", "nature-of-waves", "conducting-experiments"]) {
      expect(buildRevisionBoundLessonPath(slug, `assessment_${slug}__r1`)).toBe(`/app/lessons/lesson_${slug}.html`);
    }
    expect(buildRevisionBoundLessonPath(EL, R1)).toBe(`/app/lessons/assessment-revisions/lesson_${EL}__r1.html`);
    expect(buildRevisionBoundLessonPath(EL, R2)).toBe(`/app/lessons/assessment-revisions/lesson_${EL}__r2.html`);
    // No revision maps to the unversioned (current) Earth's Layers page.
    expect(buildRevisionBoundLessonPath(EL, `assessment_${EL}__r3`)).toBeNull();
  });
});
