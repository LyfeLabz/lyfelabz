/**
 * @jest-environment jsdom
 *
 * Student Detail repeatedly missed questions (Student Support Workspace V2
 * P4). Question identity is (assessmentRevisionId, itemId): counts are kept
 * per revision, attempts without a revision are excluded, and wording comes
 * only from the revision text checked against a standard attempt.
 */
import type {
  TeacherVisibleAttempt,
  TeacherVisibleItemResult,
} from "../../assignments/detail/attempts-wire";
import type { AssessmentRevisionContent } from "../../assignments/detail/question-summary";
import { findRepeatedMisses, renderRepeatedMisses } from "./studentDetailRepeatedMisses";

const R1 = "assessment_earths-layers__r1";
const R2 = "assessment_earths-layers__r2";

// Stems carry a short tag so tests can tell which revision's text is shown.
const tag = (revisionId: string): string => revisionId.slice(-2);
const contentFor = (revisionId: string): AssessmentRevisionContent => ({
  revisionId,
  items: [
    { itemId: "q1", stem: `${tag(revisionId)} first`, options: [{ optionId: "A", text: "a" }, { optionId: "B", text: "b" }] },
    { itemId: "q2", stem: `${tag(revisionId)} second`, options: [{ optionId: "A", text: "a" }, { optionId: "B", text: "b" }] },
    { itemId: "q3", stem: `${tag(revisionId)} third`, options: [{ optionId: "A", text: "a" }, { optionId: "B", text: "b" }] },
  ],
});
const contents = new Map<string, AssessmentRevisionContent | null>([
  [R1, contentFor(R1)],
  [R2, contentFor(R2)],
]);

const miss = (itemId: string, response: string | null = "B"): TeacherVisibleItemResult => ({
  itemId,
  isCorrect: false,
  correctOptionId: "A",
  studentResponse: response,
});
const hit = (itemId: string): TeacherVisibleItemResult => ({
  itemId,
  isCorrect: true,
  correctOptionId: "A",
  studentResponse: "A",
});

let seq = 0;
const attempt = (
  itemResults: ReadonlyArray<TeacherVisibleItemResult>,
  overrides: Partial<TeacherVisibleAttempt> = {},
): TeacherVisibleAttempt => {
  seq += 1;
  return {
    attemptId: `att-${seq}`,
    studentId: "s1",
    assignmentId: "a1",
    attemptNumber: seq,
    percentage: 0,
    assessmentRevisionId: R1,
    canonicalContent: true,
    itemResults,
    ...overrides,
  };
};

describe("findRepeatedMisses", () => {
  it("counts the same item in the same revision together", () => {
    const a = findRepeatedMisses(
      [attempt([miss("q1"), hit("q2"), miss("q3")]), attempt([miss("q1"), miss("q2"), hit("q3")]), attempt([miss("q1"), hit("q2"), miss("q3")])],
      contents,
    );
    expect(a.comparable).toBe(true);
    expect(a.revisionCount).toBe(1);
    expect(a.groups).toHaveLength(1);
    expect(a.groups[0]!.questions).toEqual([
      { itemId: "q1", number: 1, stem: `${tag(R1)} first`, missed: 3, of: 3 },
      { itemId: "q3", number: 3, stem: `${tag(R1)} third`, missed: 2, of: 3 },
    ]);
  });

  it("never merges the same itemId across revisions", () => {
    const a = findRepeatedMisses(
      [attempt([miss("q1"), hit("q2")]), attempt([miss("q1"), hit("q2")], { assessmentRevisionId: R2 })],
      contents,
    );
    expect(a.groups).toEqual([]);
    expect(a.revisionCount).toBe(2);
    // Neither revision has two attempts, so nothing could be compared.
    expect(a.comparable).toBe(false);
  });

  it("analyzes mixed revisions in one card separately, numbered by first use", () => {
    const a = findRepeatedMisses(
      [
        attempt([miss("q1"), miss("q2")]),
        attempt([miss("q1"), hit("q2")], { assessmentRevisionId: R2 }),
        attempt([miss("q1"), miss("q2")]),
        attempt([miss("q1"), hit("q2")], { assessmentRevisionId: R2 }),
        attempt([hit("q1"), miss("q2")], { assessmentRevisionId: R2 }),
      ],
      contents,
    );
    expect(a.groups.map((g) => [g.revisionId, g.version, g.attempts])).toEqual([
      [R1, 1, 2],
      [R2, 2, 3],
    ]);
    expect(a.groups[0]!.questions.map((q) => [q.itemId, q.missed, q.of, q.stem])).toEqual([
      ["q1", 2, 2, `${tag(R1)} first`],
      ["q2", 2, 2, `${tag(R1)} second`],
    ]);
    expect(a.groups[1]!.questions.map((q) => [q.itemId, q.missed, q.of, q.stem])).toEqual([
      ["q1", 2, 3, `${tag(R2)} first`],
    ]);
  });

  it("excludes attempts without a usable revision id instead of guessing", () => {
    const a = findRepeatedMisses(
      [
        attempt([miss("q1")], { assessmentRevisionId: null }),
        attempt([miss("q1")], { assessmentRevisionId: "" }),
        attempt([miss("q1")], { assessmentRevisionId: undefined }),
        attempt([miss("q1")]),
      ],
      contents,
    );
    expect(a.excludedAttempts).toBe(3);
    expect(a.groups).toEqual([]);
    expect(a.comparable).toBe(false);
  });

  it("counts an unanswered item as a miss, as finalize scores it", () => {
    const a = findRepeatedMisses([attempt([miss("q1", null)]), attempt([miss("q1", "")])], contents);
    expect(a.groups[0]!.questions).toEqual([{ itemId: "q1", number: 1, stem: `${tag(R1)} first`, missed: 2, of: 2 }]);
  });

  it("never counts an item whose correctness is unknown", () => {
    const unknown = { itemId: "q1", correctOptionId: "A", studentResponse: "B" } as unknown as TeacherVisibleItemResult;
    const a = findRepeatedMisses([attempt([unknown]), attempt([unknown]), attempt([miss("q1")])], contents);
    expect(a.groups).toEqual([]);
  });

  it("uses only attempts that contain the item as its denominator", () => {
    const a = findRepeatedMisses(
      [attempt([miss("q1"), miss("q2")]), attempt([miss("q1")]), attempt([hit("q1"), miss("q2")]), attempt([hit("q1")])],
      contents,
    );
    expect(a.groups[0]!.questions.map((q) => [q.itemId, q.missed, q.of])).toEqual([
      ["q1", 2, 4],
      ["q2", 2, 2],
    ]);
  });

  it("counts a duplicated attempt, or a duplicated item within an attempt, once", () => {
    const one = attempt([miss("q1"), miss("q1")]);
    const a = findRepeatedMisses([one, one, { ...one }], contents);
    expect(a.groups).toEqual([]);
    expect(a.comparable).toBe(false);
  });

  it("prefers standard wording when standard and adapted attempts share the revision", () => {
    const a = findRepeatedMisses(
      [attempt([miss("q1")], { canonicalContent: false }), attempt([miss("q1")]), attempt([miss("q1")], { canonicalContent: false })],
      contents,
    );
    expect(a.groups[0]!.questions[0]).toEqual({ itemId: "q1", number: 1, stem: `${tag(R1)} first`, missed: 3, of: 3 });
  });

  it("shows only the question number when every attempt was adapted", () => {
    const a = findRepeatedMisses(
      [attempt([hit("q2"), miss("q1")], { canonicalContent: false }), attempt([hit("q2"), miss("q1")], { canonicalContent: false })],
      contents,
    );
    expect(a.groups[0]!.questions).toEqual([{ itemId: "q1", number: 2, stem: null, missed: 2, of: 2 }]);
  });

  it("never pairs wording from another revision or wording inconsistent with the responses", () => {
    const wrongRevision = new Map([[R1, contentFor(R2)]]);
    expect(findRepeatedMisses([attempt([miss("q1")]), attempt([miss("q1")])], wrongRevision).groups[0]!.questions[0]!.stem).toBeNull();
    const a = findRepeatedMisses([attempt([miss("q1", "Z")]), attempt([miss("q1")])], contents);
    expect(a.groups[0]!.questions[0]!.stem).toBeNull();
    expect(findRepeatedMisses([attempt([miss("q1")]), attempt([miss("q1")])], new Map()).groups[0]!.questions[0]!.stem).toBeNull();
  });

  it("drops an unreliable question number instead of guessing one", () => {
    const a = findRepeatedMisses([attempt([miss("q1"), hit("q2")]), attempt([hit("q2"), miss("q1")])], contents);
    expect(a.groups[0]!.questions[0]!.number).toBeNull();
  });

  it("reports comparable attempts with no repeated miss", () => {
    const a = findRepeatedMisses([attempt([miss("q1"), hit("q2")]), attempt([hit("q1"), miss("q2")])], contents);
    expect(a).toEqual({ groups: [], revisionCount: 1, comparable: true, excludedAttempts: 0 });
  });
});

describe("renderRepeatedMisses", () => {
  const render = (
    attempts: ReadonlyArray<TeacherVisibleAttempt>,
    partial = { analyzed: attempts.length, total: attempts.length },
  ): HTMLElement => {
    const host = document.createElement("div");
    renderRepeatedMisses(document, host, findRepeatedMisses(attempts, contents), partial);
    return host;
  };

  it("labels each question with its number and missed count", () => {
    const host = render([attempt([miss("q1"), miss("q2")]), attempt([miss("q1"), hit("q2")])]);
    const toggle = host.querySelector<HTMLButtonElement>("[data-testid=student-detail-repeat-toggle]")!;
    const body = host.querySelector<HTMLElement>("[data-testid=student-detail-repeat-body]")!;
    expect(toggle.textContent).toBe("Missed more than once (1)");
    // Collapsed by default, a real disclosure with the standard chevron.
    expect(toggle.type).toBe("button");
    expect(toggle.className).toContain("ll-chevron");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe(body.id);
    expect(body.hidden).toBe(true);
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(body.hidden).toBe(false);
    const items = host.querySelectorAll("[data-testid=student-detail-repeat-item]");
    expect(items).toHaveLength(1);
    expect(items[0]!.querySelector("[data-testid=student-detail-repeat-number]")!.textContent).toBe("Question 1");
    expect(items[0]!.querySelector("[data-testid=student-detail-repeat-count]")!.textContent).toBe("Missed 2 of 2 attempts");
    expect(items[0]!.querySelector("[data-testid=student-detail-repeat-stem]")!.textContent).toBe(`${tag(R1)} first`);
    // Revision ids are never shown.
    expect(host.innerHTML).not.toContain(R1);
  });

  it("counts every repeated question across versions in the header, and collapses again", () => {
    const host = render([
      attempt([miss("q1"), miss("q2")]),
      attempt([miss("q1"), miss("q2")]),
      attempt([miss("q1")], { assessmentRevisionId: R2 }),
      attempt([miss("q1")], { assessmentRevisionId: R2 }),
    ]);
    const toggle = host.querySelector<HTMLButtonElement>("[data-testid=student-detail-repeat-toggle]")!;
    const body = host.querySelector<HTMLElement>("[data-testid=student-detail-repeat-body]")!;
    expect(toggle.textContent).toBe(`Missed more than once (${body.querySelectorAll("[data-testid=student-detail-repeat-item]").length})`);
    expect(body.querySelectorAll("[data-testid=student-detail-repeat-item]").length).toBeGreaterThan(1);
    toggle.click();
    toggle.click();
    expect(body.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows no disclosure when nothing repeats", () => {
    const host = render([attempt([miss("q1")]), attempt([hit("q1")])]);
    expect(host.querySelector("[data-testid=student-detail-repeat-toggle]")).toBeNull();
    expect(host.querySelector("[data-testid=student-detail-repeat-none]")).not.toBeNull();
  });

  it("separates versions when the quiz changed between attempts", () => {
    const host = render([
      attempt([miss("q1")]),
      attempt([miss("q1")]),
      attempt([miss("q1")], { assessmentRevisionId: R2 }),
      attempt([miss("q1")], { assessmentRevisionId: R2 }),
    ]);
    expect(host.querySelector("[data-testid=student-detail-repeat-versions]")!.textContent).toBe(
      "This quiz changed between attempts, so each version is counted separately.",
    );
    expect(Array.from(host.querySelectorAll("[data-testid=student-detail-repeat-version]")).map((e) => e.textContent)).toEqual([
      "Version 1",
      "Version 2",
    ]);
    expect(host.querySelectorAll("[data-testid=student-detail-repeat-list]")).toHaveLength(2);
  });

  it("is one quiet line with no repeats, and never implies mastery when data is insufficient", () => {
    const none = render([attempt([miss("q1")]), attempt([hit("q1")])]);
    expect(none.textContent).toBe("No question was missed more than once.");
    const unavailable = render([attempt([miss("q1")]), attempt([miss("q1")], { assessmentRevisionId: null })]);
    expect(unavailable.textContent).toBe("These attempts can't be compared question by question.");
  });

  it("states when only the most recent attempts were analyzed", () => {
    const host = render([attempt([miss("q1")]), attempt([miss("q1")])], { analyzed: 2, total: 3 });
    expect(host.querySelector("[data-testid=student-detail-repeat-scope]")!.textContent).toBe(
      "Based on the 2 most recent attempts.",
    );
  });
});
