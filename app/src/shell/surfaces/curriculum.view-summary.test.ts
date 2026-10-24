/**
 * @jest-environment jsdom
 *
 * Regression tests for the Curriculum lesson-card Results action (formerly
 * the Sprint 28.6E View Summary action) and its lesson-level summary
 * surface entry/return. Results-first: an assigned card shows Results +
 * Preview; Manage Assignments lives inside Results.
 *
 *   - View Summary appears only for a lesson with owned published/closed
 *     assignment history; absent (no dead control) for a never-assigned
 *     lesson, and absent entirely when no lesson-summary callable is wired.
 *   - Clicking View Summary opens the lesson-level summary surface into the
 *     Curriculum outlet (the grid is hidden, not destroyed) so the shell
 *     stays mounted; Back restores the grid.
 *   - The action hierarchy stays intact (Assign primary, Preview, then the
 *     gold-accented View Summary; no roster/student rows in Curriculum).
 */
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import type { AssignmentDetailMetadata } from "../../assignments/detail/types";
import type {
  LessonSummary,
  LessonSummaryCallable,
} from "../../assignments/summary/types";
import {
  renderCurriculumSurface,
  _resetCurriculumSessionStateForTest,
} from "./curriculum";
import { getSurfaceableLessons } from "../../curriculum/curriculumManifest";

const freeze = <T>(v: T): T => Object.freeze(v) as T;

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

const teacher: Extract<Session, { kind: "activeTeacher" }> = freeze({
  kind: "activeTeacher",
  uid: "u-teacher",
  schoolId: "school-abc",
  displayName: "Ada Lovelace",
});

const oneClass: ReadonlyArray<ClassSummary> = freeze([
  freeze({ id: "c1", title: "6A", grade: "6", status: "active" }),
] as ClassSummary[]);

const listOne: ListClasses = () => Promise.resolve(oneClass);

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

// A real surfaceable lesson slug so the card actually renders.
const LESSON = getSurfaceableLessons()[0]!;

const makeDetailSeam = (hydrated: ReadonlyArray<AssignmentDetailMetadata>) => ({
  register: () => undefined,
  open: () => undefined,
  list: () => [...hydrated],
});

const summaryValue: LessonSummary = freeze({
  lessonSlug: LESSON.slug,
  classesAssigned: 3,
  students: 40,
  studentsCompleted: 30,
  completionPercentage: 75,
  averageBestPercentage: 82,
  assignmentsConsidered: 3,
});

const makeLessonSummary = (): {
  callable: LessonSummaryCallable;
  calls: string[];
} => {
  const calls: string[] = [];
  const callable: LessonSummaryCallable = (input) => {
    calls.push(input.lessonSlug);
    return Promise.resolve(summaryValue);
  };
  return { callable, calls };
};

const historyFor = (slug: string): AssignmentDetailMetadata[] => [
  freeze({
    assignmentId: "a1",
    title: "Check for Understanding",
    className: "6A",
    status: "published",
    lessonSlug: slug,
  }) as AssignmentDetailMetadata,
];

beforeEach(() => {
  _resetCurriculumSessionStateForTest();
  document
    .querySelectorAll("[data-testid=assign-overlay]")
    .forEach((el) => el.remove());
});

const cardAction = (mount: HTMLElement): HTMLButtonElement =>
  mount.querySelector<HTMLButtonElement>(
    `[data-testid=lesson-assign-${LESSON.slug}]`,
  )!;

describe("Curriculum Results action (results-first card actions)", () => {
  test("an assigned lesson shows exactly Results + Preview; no separate View Summary control", () => {
    const mount = mkMount();
    const { callable } = makeLessonSummary();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignmentDetail: makeDetailSeam(historyFor(LESSON.slug)),
      lessonSummary: callable,
    });
    const card = mount.querySelector<HTMLElement>(
      `[data-testid=lesson-card-${LESSON.slug}]`,
    )!;
    const pair = card.querySelector<HTMLElement>(".shell-lesson-action-pair")!;
    expect(Array.from(pair.children).map((c) => c.textContent)).toEqual([
      "Results",
      "Preview",
    ]);
    const btn = cardAction(mount);
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("data-action")).toBe("results");
    expect(btn.getAttribute("aria-label")).toBe(`Results for ${LESSON.title}`);
    expect(btn.classList.contains("shell-lesson-results-action")).toBe(true);
    expect(btn.classList.contains("shell-lesson-assigned-action")).toBe(false);
    // The redundant card-level Summary control is gone.
    expect(card.querySelector("[data-testid^=lesson-view-summary-]")).toBeNull();
    expect(card.querySelector(".shell-lesson-view-summary")).toBeNull();
    expect(card.textContent).not.toMatch(/Summary/);
  });

  test("an unassigned lesson shows exactly Assign + Preview", () => {
    const mount = mkMount();
    const { callable } = makeLessonSummary();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignmentDetail: makeDetailSeam([]),
      lessonSummary: callable,
    });
    const pair = mount.querySelector<HTMLElement>(
      `[data-testid=lesson-action-pair-${LESSON.slug}]`,
    )!;
    expect(Array.from(pair.children).map((c) => c.textContent)).toEqual([
      "Assign",
      "Preview",
    ]);
    const btn = cardAction(mount);
    expect(btn.getAttribute("data-action")).toBe("assign");
    expect(btn.classList.contains("shell-lesson-results-action")).toBe(false);
    btn.click();
    // Assign keeps the existing assignment workflow.
    expect(document.querySelector("[data-testid=assign-overlay]")).not.toBeNull();
  });

  test("without a lesson-summary callable an assigned card keeps Manage (no dead Results control)", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignmentDetail: makeDetailSeam(historyFor(LESSON.slug)),
      // lessonSummary omitted
    });
    expect(cardAction(mount).textContent).toBe("Manage");
    expect(cardAction(mount).getAttribute("data-action")).toBe("manage");
  });

  test("clicking Results opens the existing summary surface, presented as Results, and hides the grid", async () => {
    const mount = mkMount();
    const { callable, calls } = makeLessonSummary();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignmentDetail: makeDetailSeam(historyFor(LESSON.slug)),
      lessonSummary: callable,
    });
    cardAction(mount).click();
    const view = mount.querySelector<HTMLElement>(
      "[data-testid=curriculum-view]",
    )!;
    expect(view.hidden).toBe(true);
    expect(mount.querySelector("[data-testid=lesson-summary-surface]")).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=lesson-summary-eyebrow]")!.textContent,
    ).toBe("Results");
    // Results never opens the assign dialog.
    expect(document.querySelector("[data-testid=assign-overlay]")).toBeNull();
    expect(calls).toEqual([LESSON.slug]);
    await flush();
    expect(
      mount.querySelector("[data-testid=lesson-summary-value-classes]")!
        .textContent,
    ).toBe("3");
  });

  test("Manage Assignments in Results opens the existing assignment dialog, even with zero submissions", async () => {
    const mount = mkMount();
    const empty: LessonSummaryCallable = () =>
      Promise.resolve(
        freeze({
          lessonSlug: LESSON.slug,
          classesAssigned: 1,
          students: 0,
          studentsCompleted: 0,
          completionPercentage: 0,
          averageBestPercentage: null,
          assignmentsConsidered: 1,
        }),
      );
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignmentDetail: makeDetailSeam(historyFor(LESSON.slug)),
      lessonSummary: empty,
    });
    cardAction(mount).click();
    await flush();
    // Still Results: zero submissions never marks a lesson unassigned.
    expect(cardAction(mount).textContent).toBe("Results");
    expect(
      mount.querySelector("[data-testid=lesson-summary-value-average]")!
        .textContent,
    ).toBe("No completed scores yet");
    const manage = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-summary-manage]",
    )!;
    expect(manage.textContent).toBe("Manage Assignments");
    manage.click();
    expect(document.querySelector("[data-testid=assign-overlay]")).not.toBeNull();
  });

  test("Back to Curriculum restores the grid and returns focus to the Results action", async () => {
    const mount = mkMount();
    const { callable } = makeLessonSummary();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignmentDetail: makeDetailSeam(historyFor(LESSON.slug)),
      lessonSummary: callable,
    });
    cardAction(mount).click();
    await flush();
    mount
      .querySelector<HTMLButtonElement>("[data-testid=lesson-summary-back]")!
      .click();
    const view = mount.querySelector<HTMLElement>(
      "[data-testid=curriculum-view]",
    )!;
    expect(view.hidden).toBe(false);
    expect(mount.querySelector("[data-testid=lesson-summary-surface]")).toBeNull();
    expect(document.activeElement).toBe(cardAction(mount));
  });
});

describe("Curriculum previously-assigned card state (Sprint 28.6H.6 Part C)", () => {
  const cardFor = (mount: HTMLElement): HTMLElement =>
    mount.querySelector<HTMLElement>(`[data-testid=lesson-card-${LESSON.slug}]`)!;

  test("a previously assigned lesson receives the assigned-state class (from existing data)", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      // The assigned signal comes from the existing hydrated assignment
      // registry (published/closed history) - no new persistence/backend.
      assignmentDetail: makeDetailSeam(historyFor(LESSON.slug)),
    });
    const card = cardFor(mount);
    expect(card.classList.contains("shell-lesson-card-assigned")).toBe(true);
    expect(card.getAttribute("data-lesson-assigned")).toBe("true");
  });

  test("a never-assigned lesson stays neutral (no assigned-state class)", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignmentDetail: makeDetailSeam([]),
    });
    const card = cardFor(mount);
    expect(card.classList.contains("shell-lesson-card-assigned")).toBe(false);
    expect(card.getAttribute("data-lesson-assigned")).toBe("false");
  });

  test("a previously assigned lesson shows green-outline 'Reassign' (still active, same workflow) with the slate tint (Sprint 28.6H.8 Part B)", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignmentDetail: makeDetailSeam(historyFor(LESSON.slug)),
    });
    const card = cardFor(mount);
    const assign = card.querySelector<HTMLButtonElement>(
      `[data-testid=lesson-assign-${LESSON.slug}]`,
    )!;
    expect(assign).not.toBeNull();
    expect(assign.textContent).toBe("Manage");
    expect(assign.disabled).toBe(false);
    expect(assign.classList.contains("shell-lesson-assigned-action")).toBe(true);
    // Part B5: the assigned-card slate tint is preserved alongside.
    expect(card.classList.contains("shell-lesson-card-assigned")).toBe(true);
    // Preview is still present and unchanged.
    expect(
      card.querySelector(`[data-testid=lesson-preview-${LESSON.slug}]`),
    ).not.toBeNull();
  });

  test("a never-assigned lesson keeps full-strength green 'Assign' (no muted-green class)", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignmentDetail: makeDetailSeam([]),
    });
    const assign = cardFor(mount).querySelector<HTMLButtonElement>(
      `[data-testid=lesson-assign-${LESSON.slug}]`,
    )!;
    expect(assign.textContent).toBe("Assign");
    expect(assign.classList.contains("shell-lesson-assigned-action")).toBe(false);
  });

  test("clicking 'Reassign' invokes the same assignment workflow as Assign (Part B2)", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignmentDetail: makeDetailSeam(historyFor(LESSON.slug)),
    });
    const assign = cardFor(mount).querySelector<HTMLButtonElement>(
      `[data-testid=lesson-assign-${LESSON.slug}]`,
    )!;
    assign.click();
    // The certified Assign dialog opens (same workflow as first-time Assign).
    expect(
      document.querySelector("[data-testid=assign-overlay]"),
    ).not.toBeNull();
  });
});
