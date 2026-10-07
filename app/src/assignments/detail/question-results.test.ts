/**
 * @jest-environment jsdom
 */
import * as fs from "fs";
import * as path from "path";
import { renderAssignmentDetail } from "./detail";
import type { AssignmentDetailMetadata } from "./types";
import type { AssignmentSummary } from "../summary/types";
import type {
  AttemptGetForTeacherCallable,
  AttemptsListForClassCallable,
  CompletedAttemptSummary,
  TeacherVisibleAttempt,
} from "./attempts-wire";
import {
  aggregatePerQuestion,
  groupAttemptCohorts,
  buildQuestionDetail,
  classifyQuestionPerformance,
  parseAssessmentRevisionContent,
  sharedAssessmentRevisionId,
  type AssessmentRevisionContent,
  type AssessmentRevisionContentReader,
} from "./question-summary";

// Question results analytics: overview grid + selected-question detail.

const REV = "assessment_earths-layers__r2";

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await flush();
};

type Item = { id: string; correct: string; chosen: string | null };

const mkDetailed = (
  n: number,
  items: (studentIndex: number) => ReadonlyArray<Item>,
  revision: (studentIndex: number) => string | null = () => REV,
): TeacherVisibleAttempt[] =>
  Array.from({ length: n }, (_, i) => ({
    attemptId: `att-${i + 1}`,
    studentId: `stu-${i + 1}`,
    assignmentId: "assign-1",
    attemptNumber: 1,
    percentage: 80,
    assessmentRevisionId: revision(i),
    itemResults: items(i).map((it) => ({
      itemId: it.id,
      isCorrect: it.chosen === it.correct,
      correctOptionId: it.correct,
      studentResponse: it.chosen,
    })),
  }));

const CONTENT: AssessmentRevisionContent = {
  revisionId: REV,
  items: [
    {
      itemId: "q1",
      stem: "Which layer is the thinnest?",
      options: [
        { optionId: "A", text: "Crust" },
        { optionId: "B", text: "Mantle" },
        { optionId: "C", text: "Outer core" },
        { optionId: "D", text: "Inner core" },
      ],
    },
    {
      itemId: "q2",
      stem: "Which layer flows slowly over long periods of time?",
      options: [
        { optionId: "A", text: "Crust" },
        { optionId: "B", text: "Mantle" },
        { optionId: "C", text: "Atmosphere" },
        { optionId: "D", text: "Inner core" },
      ],
    },
  ],
};

describe("classifyQuestionPerformance thresholds", () => {
  test.each([
    [100, "strong"],
    [80, "strong"],
    [79.9, "review"],
    [60, "review"],
    [59.9, "reteach"],
    [0, "reteach"],
  ])("%p%% is %s", (pct, band) => {
    expect(classifyQuestionPerformance(pct)).toBe(band);
  });
});

describe("sharedAssessmentRevisionId", () => {
  test("returns the single revision every attempt shares", () => {
    expect(sharedAssessmentRevisionId(mkDetailed(3, () => []))).toBe(REV);
  });
  test("is null when attempts span revisions", () => {
    const attempts = mkDetailed(3, () => [], (i) =>
      i === 2 ? "assessment_earths-layers__r1" : REV,
    );
    expect(sharedAssessmentRevisionId(attempts)).toBeNull();
  });
  test("is null when any attempt lacks a revision", () => {
    const attempts = mkDetailed(3, () => [], (i) => (i === 0 ? null : REV));
    expect(sharedAssessmentRevisionId(attempts)).toBeNull();
  });
});

describe("parseAssessmentRevisionContent", () => {
  test("keeps well-formed items and drops malformed ones", () => {
    const parsed = parseAssessmentRevisionContent(REV, {
      items: [
        { itemId: "q1", stem: "Stem", options: [{ optionId: "A", text: "x" }, { optionId: "", text: "bad" }] },
        { itemId: "q2", stem: "", options: [{ optionId: "A", text: "x" }] },
        { itemId: "q3", stem: "No options", options: [] },
        null,
        "junk",
      ],
    });
    expect(parsed?.items).toEqual([
      { itemId: "q1", stem: "Stem", options: [{ optionId: "A", text: "x" }] },
    ]);
  });
  test("returns null for a non-object or missing items", () => {
    expect(parseAssessmentRevisionContent(REV, null)).toBeNull();
    expect(parseAssessmentRevisionContent(REV, { items: "nope" })).toBeNull();
  });
});

describe("buildQuestionDetail", () => {
  const attempts = mkDetailed(5, (i) => [
    { id: "q1", correct: "A", chosen: i < 3 ? "A" : i === 3 ? "C" : null },
  ]);
  const q1 = aggregatePerQuestion(attempts).questions[0]!;

  test("pairs revision text in authored order with real counts and the correct answer", () => {
    const detail = buildQuestionDetail(q1, CONTENT);
    expect(detail.stem).toBe("Which layer is the thinnest?");
    expect(detail.choices.map((c) => [c.optionId, c.text, c.chosenCount, c.chosenPercentage, c.isCorrect])).toEqual([
      ["A", "Crust", 3, 60, true],
      ["B", "Mantle", 0, 0, false],
      ["C", "Outer core", 1, 20, false],
      ["D", "Inner core", 0, 0, false],
    ]);
    expect(detail.noAnswerCount).toBe(1);
    expect(detail.noAnswerPercentage).toBe(20);
  });

  test("without content keeps option ids and statistics only (correct option always listed)", () => {
    const allWrong = aggregatePerQuestion(
      mkDetailed(3, () => [{ id: "q1", correct: "B", chosen: "D" }]),
    ).questions[0]!;
    const detail = buildQuestionDetail(allWrong, null);
    expect(detail.stem).toBeNull();
    expect(detail.choices.map((c) => [c.optionId, c.text, c.chosenCount, c.isCorrect])).toEqual([
      ["B", null, 0, true],
      ["D", null, 3, false],
    ]);
  });

  test("ignores a revision item inconsistent with the recorded results", () => {
    const mismatched = aggregatePerQuestion(
      mkDetailed(3, () => [{ id: "q1", correct: "E", chosen: "E" }]),
    ).questions[0]!;
    const detail = buildQuestionDetail(mismatched, CONTENT);
    expect(detail.stem).toBeNull();
    expect(detail.choices.every((c) => c.text === null)).toBe(true);
  });

  test("an item missing from the revision has no text", () => {
    const other = aggregatePerQuestion(
      mkDetailed(3, () => [{ id: "q9", correct: "A", chosen: "A" }]),
    ).questions[0]!;
    expect(buildQuestionDetail(other, CONTENT).stem).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rendered surface
// ---------------------------------------------------------------------------

const metadata: AssignmentDetailMetadata = Object.freeze({
  assignmentId: "assign-1",
  title: "Earth's Layers",
  status: "published",
  className: "Period 3",
  classId: "class-1",
}) as AssignmentDetailMetadata;

const summary: AssignmentSummary = Object.freeze({
  assignmentId: "assign-1",
  classId: "class-1",
  totalStudents: 17,
  completedStudents: 17,
  inProgressStudents: 0,
  notStartedStudents: 0,
  completionPercentage: 100,
  averagePercentage: 80,
  highestPercentage: 100,
  lowestPercentage: 40,
  perfectScoreStudents: 1,
}) as AssignmentSummary;

// 10 students; q1..q10 with correct counts chosen to hit each band.
const CORRECT_BY_ITEM = [10, 8, 7, 6, 5, 9, 10, 10, 10, 10];
const tenQuestionAttempts = (
  revision: (i: number) => string | null = () => REV,
): TeacherVisibleAttempt[] =>
  mkDetailed(
    10,
    (s) =>
      CORRECT_BY_ITEM.map((correctCount, q) => ({
        id: `q${q + 1}`,
        correct: "A",
        chosen: s < correctCount ? "A" : s % 2 === 0 ? "B" : "C",
      })),
    revision,
  );

function mountPanel(
  detailed: TeacherVisibleAttempt[],
  reader?: AssessmentRevisionContentReader,
): { mount: HTMLElement; readerCalls: string[]; fetched: string[] } {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const listed: CompletedAttemptSummary[] = detailed.map((a, i) => ({
    attemptId: a.attemptId,
    studentId: a.studentId,
    studentDisplayName: `Student ${i + 1}`,
    assignmentId: "assign-1",
    attemptNumber: a.attemptNumber,
    score: 8,
    maxScore: 10,
    percentage: a.percentage,
    submittedAt: 1000 + i,
  }));
  const byId = new Map(detailed.map((a) => [a.attemptId, a]));
  const attemptsList: AttemptsListForClassCallable = ({ classId }) =>
    Promise.resolve({ classId, attempts: listed });
  const fetched: string[] = [];
  const attemptGet: AttemptGetForTeacherCallable = ({ attemptId }) => {
    fetched.push(attemptId);
    const a = byId.get(attemptId);
    return a === undefined ? Promise.reject(new Error("missing")) : Promise.resolve(a);
  };
  const readerCalls: string[] = [];
  renderAssignmentDetail(mount, {
    assignmentId: "assign-1",
    loadMetadata: () => Promise.resolve(metadata),
    summaryCallable: () => Promise.resolve(summary),
    recipientListCallable: () =>
      Promise.resolve({
        assignmentId: "assign-1",
        recipients: listed.map((l) => ({
          studentId: l.studentId,
          studentDisplayName: l.studentDisplayName,
        })),
      }),
    attemptsListForClassCallable: attemptsList,
    attemptGetForTeacherCallable: attemptGet,
    ...(reader === undefined
      ? {}
      : {
          assessmentRevisionContentReader: (id: string) => {
            readerCalls.push(id);
            return reader(id);
          },
        }),
  });
  return { mount, readerCalls, fetched };
}

const tiles = (mount: HTMLElement): HTMLButtonElement[] =>
  Array.from(
    mount.querySelectorAll<HTMLButtonElement>(
      "[data-testid^=assignment-detail-question-tile-]",
    ),
  );
const detailRegion = (mount: HTMLElement): HTMLElement =>
  mount.querySelector<HTMLElement>("[data-testid=assignment-detail-question-detail]")!;

const tenContent: AssessmentRevisionContent = {
  revisionId: REV,
  items: CORRECT_BY_ITEM.map((_, q) => ({
    itemId: `q${q + 1}`,
    stem: `Question stem ${q + 1} ${"with a deliberately long clause ".repeat(q === 2 ? 8 : 0)}`.trim(),
    options: [
      { optionId: "A", text: `Right answer ${q + 1}` },
      { optionId: "B", text: `Distractor B ${q + 1}` },
      { optionId: "C", text: `Distractor C ${q + 1}` },
      { optionId: "D", text: `Distractor D ${q + 1}` },
    ],
  })),
};

afterEach(() => {
  document.body.textContent = "";
});

describe("Question results overview grid", () => {
  test("renders one compact tile per question in canonical order with percent and student count", async () => {
    const { mount } = mountPanel(tenQuestionAttempts(), () => Promise.resolve(tenContent));
    await settle();
    const all = tiles(mount);
    expect(all).toHaveLength(10);
    expect(all.map((t) => t.querySelector(".shell-assignment-detail-question-number")?.textContent)).toEqual(
      ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9", "Q10"],
    );
    expect(all.map((t) => t.getAttribute("data-item-id"))).toEqual(
      CORRECT_BY_ITEM.map((_, q) => `q${q + 1}`),
    );
    const t3 = all[2]!;
    expect(t3.querySelector(".shell-assignment-detail-question-rate")?.textContent).toBe("70% correct");
    expect(t3.querySelector(".shell-assignment-detail-question-count")?.textContent).toBe("7 of 10 students");
    // No raw item id, no answer distribution, no question text on tiles.
    expect(t3.textContent).not.toMatch(/\bq3\b/);
    expect(t3.textContent).not.toMatch(/Question stem|Distractor/);
    expect(mount.querySelectorAll(".shell-assignment-detail-question-choice")).toHaveLength(0);
  });

  test("tiles are semantic toggle buttons tied to the detail region", async () => {
    const { mount } = mountPanel(tenQuestionAttempts(), () => Promise.resolve(tenContent));
    await settle();
    for (const t of tiles(mount)) {
      expect(t.tagName).toBe("BUTTON");
      expect(t.type).toBe("button");
      expect(t.getAttribute("aria-pressed")).toBe("false");
      expect(t.getAttribute("aria-controls")).toBe(detailRegion(mount).id);
    }
  });

  test("performance bands follow the thresholds and carry text, not color alone", async () => {
    const { mount } = mountPanel(tenQuestionAttempts(), () => Promise.resolve(tenContent));
    await settle();
    const all = tiles(mount);
    const bands = all.map((t) => t.getAttribute("data-band"));
    // 100, 80, 70, 60, 50, 90, ...
    expect(bands.slice(0, 6)).toEqual(["strong", "strong", "review", "review", "reteach", "strong"]);
    expect(all[2]!.classList.contains("shell-assignment-detail-question-review")).toBe(true);
    expect(all[4]!.classList.contains("shell-assignment-detail-question-reteach")).toBe(true);
    const band = (n: number): HTMLElement =>
      mount.querySelector<HTMLElement>(`[data-testid=assignment-detail-question-band-${n}]`)!;
    expect(band(3).textContent).toBe("Review");
    expect(band(3).className).toBe("shell-assignment-detail-question-band");
    expect(band(5).textContent).toBe("Reteach");
    // Strong recedes visually but is still exposed to assistive technology.
    expect(band(1).textContent).toBe("Strong");
    expect(band(1).className).toBe("shell-assignment-detail-questions-sr");
  });

  test("no question is selected initially and the detail region is hidden", async () => {
    const { mount } = mountPanel(tenQuestionAttempts(), () => Promise.resolve(tenContent));
    await settle();
    expect(tiles(mount).some((t) => t.getAttribute("aria-pressed") === "true")).toBe(false);
    expect(detailRegion(mount).hidden).toBe(true);
  });
});

describe("Question detail", () => {
  test("selecting a tile opens the detail with question text, choices, counts, and the correct answer", async () => {
    const { mount, readerCalls } = mountPanel(tenQuestionAttempts(), () => Promise.resolve(tenContent));
    await settle();
    expect(readerCalls).toEqual([REV]);
    tiles(mount)[2]!.click();
    const region = detailRegion(mount);
    expect(region.hidden).toBe(false);
    expect(tiles(mount)[2]!.getAttribute("aria-pressed")).toBe("true");
    expect(region.getAttribute("role")).toBe("region");
    const heading = region.querySelector("h4")!;
    expect(heading.textContent).toBe("Question 3");
    expect(region.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(
      region.querySelector("[data-testid=assignment-detail-question-stem]")?.textContent,
    ).toMatch(/^Question stem 3 with a deliberately long clause/);
    expect(
      region.querySelector("[data-testid=assignment-detail-question-detail-rate]")?.textContent,
    ).toBe("70% correct (7 of 10 students)");
    const choice = (id: string): HTMLElement =>
      region.querySelector<HTMLElement>(`[data-testid=assignment-detail-question-choice-${id}]`)!;
    expect(choice("A").querySelector(".shell-assignment-detail-question-choice-text")?.textContent).toBe(
      "A. Right answer 3✓ Correct answer",
    );
    expect(choice("A").querySelector(".shell-assignment-detail-question-choice-stat")?.textContent).toBe("70% (7 students)");
    // Students 7, 8, 9 (index) wrong: 8 chose B (even), 7 and 9 chose C.
    expect(choice("B").querySelector(".shell-assignment-detail-question-choice-stat")?.textContent).toBe("10% (1 student)");
    expect(choice("C").querySelector(".shell-assignment-detail-question-choice-stat")?.textContent).toBe("20% (2 students)");
    expect(choice("D").querySelector(".shell-assignment-detail-question-choice-stat")?.textContent).toBe("0% (0 students)");
    // Exactly one correct marker, with text (not color alone).
    const marks = region.querySelectorAll("[data-testid=assignment-detail-question-correct-mark]");
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe("✓ Correct answer");
    expect(marks[0]!.querySelector("[aria-hidden=true]")?.textContent).toBe("✓ ");
    // No speculative diagnosis language.
    expect(region.textContent).not.toMatch(/misconception/i);
    // Assistive-technology announcement of the update.
    expect(
      mount.querySelector("[data-testid=assignment-detail-question-announcer]")?.textContent,
    ).toBe("Showing question 3 details below.");
  });

  test("switching tiles updates the single detail region and the pressed state", async () => {
    const { mount } = mountPanel(tenQuestionAttempts(), () => Promise.resolve(tenContent));
    await settle();
    tiles(mount)[2]!.click();
    tiles(mount)[4]!.click();
    expect(mount.querySelectorAll("[data-testid=assignment-detail-question-detail]")).toHaveLength(1);
    expect(detailRegion(mount).querySelector("h4")?.textContent).toBe("Question 5");
    const pressed = tiles(mount).map((t) => t.getAttribute("aria-pressed"));
    expect(pressed.filter((p) => p === "true")).toHaveLength(1);
    expect(pressed[4]).toBe("true");
    expect(pressed[2]).toBe("false");
  });

  test("selecting the open tile again closes the detail", async () => {
    const { mount } = mountPanel(tenQuestionAttempts(), () => Promise.resolve(tenContent));
    await settle();
    tiles(mount)[1]!.click();
    tiles(mount)[1]!.click();
    expect(detailRegion(mount).hidden).toBe(true);
    expect(tiles(mount)[1]!.getAttribute("aria-pressed")).toBe("false");
  });

  test("keyboard: tiles are native buttons, so Enter/Space activation reaches the same handler", async () => {
    const { mount } = mountPanel(tenQuestionAttempts(), () => Promise.resolve(tenContent));
    await settle();
    const t = tiles(mount)[0]!;
    t.focus();
    expect(document.activeElement).toBe(t);
    // jsdom does not synthesize click from key events; native buttons do in
    // browsers. Verify no tabindex override removes it from tab order.
    expect(t.hasAttribute("tabindex")).toBe(false);
    expect(t.disabled).toBe(false);
  });

  test("attempts spanning revisions never show question text (no cross-revision pairing)", async () => {
    const { mount, readerCalls } = mountPanel(
      tenQuestionAttempts((i) => (i === 0 ? "assessment_earths-layers__r1" : REV)),
      () => Promise.resolve(tenContent),
    );
    await settle();
    expect(readerCalls).toEqual([]);
    tiles(mount)[2]!.click();
    const region = detailRegion(mount);
    expect(region.querySelector("[data-testid=assignment-detail-question-stem]")?.textContent).toBe(
      "Question text is not available for these results.",
    );
    expect(region.textContent).not.toMatch(/Right answer|Distractor/);
    // Statistics and the correct answer still render by option id.
    expect(region.querySelectorAll("[data-testid=assignment-detail-question-correct-mark]")).toHaveLength(1);
  });

  test("a reader result for a different revision is ignored", async () => {
    const { mount } = mountPanel(tenQuestionAttempts(), () =>
      Promise.resolve({ ...tenContent, revisionId: "assessment_earths-layers__r1" }),
    );
    await settle();
    tiles(mount)[0]!.click();
    expect(detailRegion(mount).textContent).not.toMatch(/Right answer/);
  });

  test("a failing or absent reader degrades to results without text", async () => {
    const failing = mountPanel(tenQuestionAttempts(), () => Promise.reject(new Error("denied")));
    await settle();
    expect(tiles(failing.mount)).toHaveLength(10);
    tiles(failing.mount)[0]!.click();
    expect(detailRegion(failing.mount).textContent).toMatch(/Question text is not available/);
    document.body.textContent = "";

    const absent = mountPanel(tenQuestionAttempts());
    await settle();
    tiles(absent.mount)[0]!.click();
    const choice = detailRegion(absent.mount).querySelector(
      "[data-testid=assignment-detail-question-choice-A] .shell-assignment-detail-question-choice-letter",
    );
    expect(choice?.textContent).toBe("A");
  });

  test("unanswered responses appear as a No answer row with real counts", async () => {
    const attempts = mkDetailed(4, (i) => [
      { id: "q1", correct: "A", chosen: i === 3 ? null : "A" },
    ]);
    const { mount } = mountPanel(attempts, () => Promise.resolve(CONTENT));
    await settle();
    tiles(mount)[0]!.click();
    const none = detailRegion(mount).querySelector(
      "[data-testid=assignment-detail-question-choice-none]",
    );
    expect(none?.textContent).toMatch(/^No answer/);
    expect(none?.querySelector(".shell-assignment-detail-question-choice-stat")?.textContent).toBe("25% (1 student)");
  });

  test("below the minimum attempt count no grid renders and no revision is read", async () => {
    const { mount, readerCalls } = mountPanel(tenQuestionAttempts().slice(0, 2), () =>
      Promise.resolve(tenContent),
    );
    await settle();
    expect(tiles(mount)).toHaveLength(0);
    expect(mount.querySelector("[data-testid=assignment-detail-questions-deferred]")).not.toBeNull();
    expect(readerCalls).toEqual([]);
  });

  test("ids in the rendered panel stay unique and every aria reference resolves", async () => {
    const { mount } = mountPanel(tenQuestionAttempts(), () => Promise.resolve(tenContent));
    await settle();
    tiles(mount)[0]!.click();
    const ids = Array.from(mount.querySelectorAll<HTMLElement>("[id]")).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const el of Array.from(mount.querySelectorAll<HTMLElement>("[aria-controls],[aria-labelledby]"))) {
      const ref = el.getAttribute("aria-controls") ?? el.getAttribute("aria-labelledby")!;
      expect(mount.querySelectorAll(`#${ref}`)).toHaveLength(1);
    }
  });
});

describe("Question results CSS contract", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../../../index.html"), "utf8");
  const rule = (selector: string): string | null => {
    const i = html.indexOf(`  ${selector} {`);
    if (i === -1) return null;
    return html.slice(i, html.indexOf("}", i));
  };

  test("the overview is a grid capped at five columns that reduces with available width", () => {
    const body = rule(".shell-assignment-detail-questions-list");
    expect(body).toMatch(/display:\s*grid/);
    expect(body).toMatch(/list-style:\s*none/);
    expect(body).toMatch(/repeat\(\s*auto-fill/);
    expect(body).toMatch(/minmax\(max\(9rem, calc\(\(100% - 4 \* var\(--tw-question-gap\)\) \/ 5\)\), 1fr\)/);
  });

  test("bands reuse the existing roster status washes", () => {
    const scope = rule(".shell-assignment-detail-questions")!;
    expect(scope).toMatch(/--tw-question-review-bg:\s*rgba\(255, 176, 32, 0\.08\)/);
    expect(scope).toMatch(/--tw-question-reteach-bg:\s*rgba\(220, 61, 61, 0\.05\)/);
  });

  test("selected and focus states are visible and not color-only", () => {
    expect(rule('.shell-assignment-detail-question-tile[aria-pressed="true"]')).toMatch(/box-shadow:\s*inset/);
    expect(rule(".shell-assignment-detail-question-tile:focus-visible")).toMatch(/outline:\s*var\(--tw-focus-outline\)/);
  });

  test("long question and answer text wraps", () => {
    expect(rule(".shell-assignment-detail-question-stem")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule(".shell-assignment-detail-question-choice-text")).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

// ---------------------------------------------------------------------------
// Numbered attempt cohorts
// ---------------------------------------------------------------------------

// Builds attempt N for the given student indexes. Each student answers q1
// and q2; `q1Right(s)` decides q1 correctness, q2 is always correct.
const cohort = (
  n: number,
  students: ReadonlyArray<number>,
  q1Right: (s: number) => boolean,
  revision: (s: number) => string | null = () => REV,
  percentage = 50,
): TeacherVisibleAttempt[] =>
  students.map((s) => ({
    attemptId: `assign-1__stu-${s}__a${n}`,
    studentId: `stu-${s}`,
    assignmentId: "assign-1",
    attemptNumber: n,
    percentage,
    assessmentRevisionId: revision(s),
    itemResults: [
      { itemId: "q1", isCorrect: q1Right(s), correctOptionId: "A", studentResponse: q1Right(s) ? "A" : "C" },
      { itemId: "q2", isCorrect: true, correctOptionId: "B", studentResponse: "B" },
    ],
  }));

const range = (count: number): number[] => Array.from({ length: count }, (_, i) => i + 1);

// Attempt 1: 17 students, q1 correct for 10 (58.8%, Reteach).
// Attempt 2: 8 students, q1 correct for 7 (87.5%, Strong). Attempt 1 is
// scored low (50%) and attempt 2 high (100%), so a best-attempt view would
// pick attempt 2 for those students.
// Attempt 3: 2 students (below the minimum).
const threeCohorts = (): TeacherVisibleAttempt[] => [
  ...cohort(1, range(17), (s) => s <= 10, () => REV, 50),
  ...cohort(2, range(8), (s) => s <= 7, () => REV, 100),
  ...cohort(3, [1, 2], () => true, () => REV, 100),
];

const attemptSelect = (mount: HTMLElement): HTMLSelectElement | null =>
  mount.querySelector<HTMLSelectElement>("[data-testid=assignment-detail-questions-attempt-select]");
const chooseAttempt = async (mount: HTMLElement, n: number): Promise<void> => {
  const select = attemptSelect(mount)!;
  select.value = String(n);
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
};
const tileText = (mount: HTMLElement, n: number, cls: string): string | null | undefined =>
  mount.querySelector(`[data-testid=assignment-detail-question-tile-${n}] .${cls}`)?.textContent;

describe("groupAttemptCohorts", () => {
  test("groups by canonical attemptNumber, sorted numerically, one per student", () => {
    const attempts = [
      { attemptId: "x__s1__a10", studentId: "s1", attemptNumber: 10 },
      { attemptId: "x__s1__a2", studentId: "s1", attemptNumber: 2 },
      { attemptId: "x__s1__a1", studentId: "s1", attemptNumber: 1 },
      { attemptId: "x__s2__a1", studentId: "s2", attemptNumber: 1 },
      { attemptId: "x__s2__a1-dup", studentId: "s2", attemptNumber: 1 },
      { attemptId: "bad0", studentId: "s3", attemptNumber: 0 },
      { attemptId: "badf", studentId: "s3", attemptNumber: 1.5 },
    ];
    const cohorts = groupAttemptCohorts(attempts);
    expect(Array.from(cohorts.keys())).toEqual([1, 2, 10]);
    expect(cohorts.get(1)!.map((a) => a.attemptId)).toEqual(["x__s1__a1", "x__s2__a1"]);
    expect(cohorts.get(2)).toHaveLength(1);
  });
});

describe("Question results attempt cohorts", () => {
  test("defaults to Attempt 1 with its own denominator, not each student's best attempt", async () => {
    const { mount } = mountPanel(threeCohorts(), () => Promise.resolve(CONTENT));
    await settle();
    expect(attemptSelect(mount)?.value).toBe("1");
    expect(tileText(mount, 1, "shell-assignment-detail-question-rate")).toBe("58.8% correct");
    expect(tileText(mount, 1, "shell-assignment-detail-question-count")).toBe("10 of 17 students");
    expect(tiles(mount)[0]!.getAttribute("data-band")).toBe("reteach");
  });

  test("selector lists only existing attempt numbers in ascending order", async () => {
    const attempts = [
      ...cohort(2, range(4), () => true),
      ...cohort(1, range(5), () => true),
      ...cohort(10, range(3), () => true),
    ];
    const { mount } = mountPanel(attempts, () => Promise.resolve(CONTENT));
    await settle();
    const select = attemptSelect(mount)!;
    expect(select.tagName).toBe("SELECT");
    expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual([
      ["1", "Attempt 1"],
      ["2", "Attempt 2"],
      ["10", "Attempt 10"],
    ]);
    const label = mount.querySelector(`label[for=${select.id}]`);
    expect(label?.textContent).toBe("View question results:");
  });

  test("selector and note are hidden when only Attempt 1 exists", async () => {
    const { mount } = mountPanel(cohort(1, range(5), () => true), () => Promise.resolve(CONTENT));
    await settle();
    expect(tiles(mount)).toHaveLength(2);
    expect(attemptSelect(mount)).toBeNull();
    expect(mount.querySelector("[data-testid=assignment-detail-questions-attempt-note]")).toBeNull();
  });

  test("the explanatory note accompanies the selector and describes it", async () => {
    const { mount } = mountPanel(threeCohorts(), () => Promise.resolve(CONTENT));
    await settle();
    const note = mount.querySelector<HTMLElement>("[data-testid=assignment-detail-questions-attempt-note]")!;
    expect(note.textContent).toBe("Results include students who completed the selected attempt.");
    expect(attemptSelect(mount)!.getAttribute("aria-describedby")).toBe(note.id);
  });

  test("switching to Attempt 2 recomputes percentages, counts, and bands from that cohort only", async () => {
    const { mount } = mountPanel(threeCohorts(), () => Promise.resolve(CONTENT));
    await settle();
    await chooseAttempt(mount, 2);
    expect(attemptSelect(mount)!.value).toBe("2");
    expect(tileText(mount, 1, "shell-assignment-detail-question-rate")).toBe("87.5% correct");
    expect(tileText(mount, 1, "shell-assignment-detail-question-count")).toBe("7 of 8 students");
    expect(tiles(mount)[0]!.getAttribute("data-band")).toBe("strong");
    expect(
      mount.querySelector("[data-testid=assignment-detail-question-announcer]")?.textContent,
    ).toBe("Showing Attempt 2 results for 8 students.");
    // Back to Attempt 1 restores the 17-student cohort.
    await chooseAttempt(mount, 1);
    expect(tileText(mount, 1, "shell-assignment-detail-question-count")).toBe("10 of 17 students");
    expect(tiles(mount)[0]!.getAttribute("data-band")).toBe("reteach");
  });

  test("switching attempts closes the open question; detail then uses the new cohort", async () => {
    const { mount } = mountPanel(threeCohorts(), () => Promise.resolve(CONTENT));
    await settle();
    tiles(mount)[0]!.click();
    expect(detailRegion(mount).hidden).toBe(false);
    await chooseAttempt(mount, 2);
    expect(detailRegion(mount).hidden).toBe(true);
    expect(tiles(mount).every((t) => t.getAttribute("aria-pressed") === "false")).toBe(true);
    expect(mount.querySelectorAll("[data-testid=assignment-detail-question-detail]")).toHaveLength(1);
    tiles(mount)[0]!.click();
    const region = detailRegion(mount);
    expect(
      region.querySelector("[data-testid=assignment-detail-question-detail-rate]")?.textContent,
    ).toBe("87.5% correct (7 of 8 students)");
    expect(
      region.querySelector("[data-testid=assignment-detail-question-choice-C] .shell-assignment-detail-question-choice-stat")?.textContent,
    ).toBe("12.5% (1 student)");
  });

  test("a later cohort below the minimum stays selectable and shows the insufficient state with no item data", async () => {
    const { mount } = mountPanel(threeCohorts(), () => Promise.resolve(CONTENT));
    await settle();
    expect(Array.from(attemptSelect(mount)!.options).map((o) => o.value)).toContain("3");
    await chooseAttempt(mount, 3);
    expect(attemptSelect(mount)!.value).toBe("3");
    expect(tiles(mount)).toHaveLength(0);
    expect(mount.querySelector("[data-testid=assignment-detail-question-detail]")).toBeNull();
    expect(
      mount.querySelector("[data-testid=assignment-detail-questions-deferred]")?.textContent,
    ).toBe("Question-level results will appear after more students submit.");
    expect(
      mount.querySelector("[data-testid=assignment-detail-question-announcer]")?.textContent,
    ).toMatch(/^Attempt 3: question-level results will appear/);
    // Selector stays available to switch back.
    await chooseAttempt(mount, 2);
    expect(tiles(mount)).toHaveLength(2);
  });

  test("each cohort fetches only its own attempts; below-minimum cohorts fetch none", async () => {
    const { mount, fetched } = mountPanel(threeCohorts(), () => Promise.resolve(CONTENT));
    await settle();
    expect(fetched).toHaveLength(17);
    expect(fetched.every((id) => id.endsWith("__a1"))).toBe(true);
    await chooseAttempt(mount, 3);
    expect(fetched).toHaveLength(17);
    await chooseAttempt(mount, 2);
    expect(fetched.slice(17)).toHaveLength(8);
    expect(fetched.slice(17).every((id) => id.endsWith("__a2"))).toBe(true);
  });

  test("Attempt 1 below the minimum shows the insufficient state but Attempt 2 can still be chosen", async () => {
    const attempts = [...cohort(1, range(2), () => true), ...cohort(2, range(2), () => true)];
    const { mount } = mountPanel(attempts, () => Promise.resolve(CONTENT));
    await settle();
    expect(attemptSelect(mount)?.value).toBe("1");
    expect(mount.querySelector("[data-testid=assignment-detail-questions-deferred]")).not.toBeNull();
    expect(tiles(mount)).toHaveLength(0);
  });

  test("revision safety is evaluated per selected cohort", async () => {
    const reads: string[] = [];
    const attempts = [
      ...cohort(1, range(4), () => true),
      // Attempt 2 cohort spans revisions (defensive case).
      ...cohort(2, range(3), () => true, (s) => (s === 3 ? "assessment_earths-layers__r1" : REV)),
    ];
    const { mount } = mountPanel(attempts, (id) => {
      reads.push(id);
      return Promise.resolve(CONTENT);
    });
    await settle();
    tiles(mount)[0]!.click();
    expect(detailRegion(mount).textContent).toMatch(/Which layer is the thinnest\?/);
    await chooseAttempt(mount, 2);
    tiles(mount)[0]!.click();
    const region = detailRegion(mount);
    expect(region.textContent).toMatch(/Question text is not available for these results\./);
    expect(region.textContent).not.toMatch(/Crust|thinnest/);
    // Statistics and correct-answer identification remain.
    expect(region.querySelectorAll("[data-testid=assignment-detail-question-correct-mark]")).toHaveLength(1);
    // Only the Attempt 1 cohort's shared revision was ever read.
    expect(reads).toEqual([REV]);
  });

  test("ids stay unique with the selector present", async () => {
    const { mount } = mountPanel(threeCohorts(), () => Promise.resolve(CONTENT));
    await settle();
    tiles(mount)[0]!.click();
    const ids = Array.from(mount.querySelectorAll<HTMLElement>("[id]")).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const el of Array.from(mount.querySelectorAll<HTMLElement>("[aria-describedby]"))) {
      expect(mount.querySelectorAll(`#${el.getAttribute("aria-describedby")}`)).toHaveLength(1);
    }
  });
});

describe("Question results attempt selector CSS", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../../../index.html"), "utf8");
  const rule = (selector: string): string | null => {
    const i = html.indexOf(`  ${selector} {`);
    return i === -1 ? null : html.slice(i, html.indexOf("}", i));
  };
  test("selector row wraps, select has a focus ring and a coarse-pointer touch target", () => {
    expect(rule(".shell-assignment-detail-questions-attempt")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule(".shell-assignment-detail-questions-attempt-select")).toMatch(/max-width:\s*100%/);
    expect(rule(".shell-assignment-detail-questions-attempt-select:focus-visible")).toMatch(/var\(--tw-focus-ring\)/);
    expect(html).toMatch(/@media \(pointer: coarse\) \{\s*\.shell-assignment-detail-questions-attempt-select \{ min-height: 44px; \}/);
    expect(rule(".shell-assignment-detail-questions-attempt-note")).toMatch(/color:\s*var\(--tw-ink-muted\)/);
  });
});
