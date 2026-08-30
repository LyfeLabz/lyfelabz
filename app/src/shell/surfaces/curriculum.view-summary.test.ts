/**
 * @jest-environment jsdom
 *
 * Sprint 28.6E regression tests for the Curriculum lesson-card View
 * Summary action and its lesson-level summary surface entry/return.
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

describe("Curriculum View Summary control", () => {
  test("is visible for a lesson with owned published assignment history", () => {
    const mount = mkMount();
    const { callable } = makeLessonSummary();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignmentDetail: makeDetailSeam(historyFor(LESSON.slug)),
      lessonSummary: callable,
    });
    const btn = mount.querySelector<HTMLButtonElement>(
      `[data-testid=lesson-view-summary-${LESSON.slug}]`,
    );
    expect(btn).not.toBeNull();
    expect(btn!.hidden).toBe(false);
    expect(btn!.tagName).toBe("BUTTON");
  });

  test("is hidden (no dead control) for a never-assigned lesson", () => {
    const mount = mkMount();
    const { callable } = makeLessonSummary();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignmentDetail: makeDetailSeam([]),
      lessonSummary: callable,
    });
    const btn = mount.querySelector<HTMLButtonElement>(
      `[data-testid=lesson-view-summary-${LESSON.slug}]`,
    );
    // Rendered but hidden, so it never occupies the action row for a
    // lesson the teacher has not assigned.
    expect(btn).not.toBeNull();
    expect(btn!.hidden).toBe(true);
  });

  test("is not rendered at all when no lesson-summary callable is wired", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignmentDetail: makeDetailSeam(historyFor(LESSON.slug)),
      // lessonSummary omitted
    });
    expect(
      mount.querySelector(`[data-testid=lesson-view-summary-${LESSON.slug}]`),
    ).toBeNull();
  });

  test("clicking View Summary opens the lesson summary surface and hides the grid", async () => {
    const mount = mkMount();
    const { callable, calls } = makeLessonSummary();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignmentDetail: makeDetailSeam(historyFor(LESSON.slug)),
      lessonSummary: callable,
    });
    mount
      .querySelector<HTMLButtonElement>(
        `[data-testid=lesson-view-summary-${LESSON.slug}]`,
      )!
      .click();
    // The Curriculum grid is hidden (not destroyed) and the summary surface
    // is mounted into the same outlet, so the shell stays mounted and
    // Curriculum remains the active surface.
    const view = mount.querySelector<HTMLElement>(
      "[data-testid=curriculum-view]",
    )!;
    expect(view.hidden).toBe(true);
    const surface = mount.querySelector(
      "[data-testid=lesson-summary-surface]",
    );
    expect(surface).not.toBeNull();
    expect(calls).toEqual([LESSON.slug]);
    await flush();
    expect(
      mount.querySelector("[data-testid=lesson-summary-value-classes]")!
        .textContent,
    ).toBe("3");
  });

  test("Back to Curriculum restores the lesson grid", async () => {
    const mount = mkMount();
    const { callable } = makeLessonSummary();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignmentDetail: makeDetailSeam(historyFor(LESSON.slug)),
      lessonSummary: callable,
    });
    mount
      .querySelector<HTMLButtonElement>(
        `[data-testid=lesson-view-summary-${LESSON.slug}]`,
      )!
      .click();
    await flush();
    mount
      .querySelector<HTMLButtonElement>("[data-testid=lesson-summary-back]")!
      .click();
    // Grid restored; summary surface torn down.
    const view = mount.querySelector<HTMLElement>(
      "[data-testid=curriculum-view]",
    )!;
    expect(view.hidden).toBe(false);
    expect(
      mount.querySelector("[data-testid=lesson-summary-surface]"),
    ).toBeNull();
  });

  test("View Summary lives in the shared quiet footer, outside the Assign/Preview pair (Sprint 28.6H.3)", () => {
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
    const actions = card.querySelector<HTMLElement>(".shell-lesson-actions")!;
    const pair = actions.querySelector<HTMLElement>(
      ".shell-lesson-action-pair",
    )!;
    const footerRow = card.querySelector<HTMLElement>(
      ".shell-lesson-footer-row",
    )!;
    const assign = card.querySelector(
      `[data-testid=lesson-assign-${LESSON.slug}]`,
    )!;
    const summaryBtn = card.querySelector(
      `[data-testid=lesson-view-summary-${LESSON.slug}]`,
    )!;
    // Assign lives inside the dedicated pair; View Summary never does.
    expect(pair.contains(assign)).toBe(true);
    expect(pair.contains(summaryBtn)).toBe(false);
    // Sprint 28.6H.3 (Task D3/D4): View Summary is a quiet secondary action in
    // the shared card footer row, not in the primary actions stack, and the
    // footer sits after the actions (primary actions, then the quiet footer).
    expect(actions.contains(summaryBtn)).toBe(false);
    expect(Array.from(footerRow.children).includes(summaryBtn as Element)).toBe(
      true,
    );
    expect(
      actions.compareDocumentPosition(footerRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The View Summary control carries the restrained gold-accent class.
    expect(
      (summaryBtn as HTMLElement).classList.contains(
        "shell-lesson-view-summary",
      ),
    ).toBe(true);
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
    // Part B1: label becomes "Assign Again"; B2: still enabled.
    expect(assign.textContent).toBe("Reassign");
    expect(assign.disabled).toBe(false);
    // Part B3: the muted-green action class is applied (visual only).
    expect(assign.classList.contains("shell-lesson-reassign")).toBe(true);
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
    expect(assign.classList.contains("shell-lesson-reassign")).toBe(false);
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
