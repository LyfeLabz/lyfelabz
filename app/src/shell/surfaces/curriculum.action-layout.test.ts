/**
 * @jest-environment jsdom
 *
 * Sprint 28.6H.2 (Finding 2) regression tests for the Curriculum lesson-card
 * ACTION LAYOUT.
 *
 * A human live-emulator review found that Assign and Preview were rendered
 * narrow and mismatched on cards that also showed View Summary, while cards
 * without View Summary showed the intended wide, equal pair. The root cause
 * was structural: all three controls shared one flex row, and View Summary
 * (flex-basis:100%) failed to wrap because Assign/Preview used flex-basis:0,
 * so it stole width from the pair.
 *
 * These tests lock in the corrected architecture so it is impossible for a
 * future change to put View Summary back into the Assign/Preview sizing row:
 *
 *   - Assign and Preview always live together inside the dedicated
 *     `.shell-lesson-action-pair` container.
 *   - The pair contains EXACTLY those two controls - never View Summary,
 *     never the toggle - regardless of assignment history.
 *   - View Summary is a sibling of the pair (a direct child of
 *     `.shell-lesson-actions`), so it is outside the pair's width
 *     calculation.
 *   - View Summary is conditional on assignment history and never replaces
 *     Assign.
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

const lessonSummaryCallable: LessonSummaryCallable = () =>
  Promise.resolve(summaryValue);

const historyFor = (slug: string): AssignmentDetailMetadata[] => [
  freeze({
    assignmentId: "a1",
    title: "Check for Understanding",
    className: "6A",
    status: "published",
    lessonSlug: slug,
  }) as AssignmentDetailMetadata,
];

const cardFor = (mount: HTMLElement): HTMLElement =>
  mount.querySelector<HTMLElement>(
    `[data-testid=lesson-card-${LESSON.slug}]`,
  )!;

const pairFor = (mount: HTMLElement): HTMLElement =>
  cardFor(mount).querySelector<HTMLElement>(".shell-lesson-action-pair")!;

beforeEach(() => {
  _resetCurriculumSessionStateForTest();
  document
    .querySelectorAll("[data-testid=assign-overlay]")
    .forEach((el) => el.remove());
});

describe("Curriculum action layout (Sprint 28.6H.2, Finding 2)", () => {
  test("every card renders Assign (never-assigned)", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: listOne });
    const assign = cardFor(mount).querySelector<HTMLButtonElement>(
      `[data-testid=lesson-assign-${LESSON.slug}]`,
    );
    expect(assign).not.toBeNull();
    expect(assign!.textContent).toBe("Assign");
  });

  test("every card renders Preview", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: listOne });
    const preview = cardFor(mount).querySelector(
      `[data-testid=lesson-preview-${LESSON.slug}]`,
    );
    expect(preview).not.toBeNull();
  });

  test("an assigned-history card renders 'Reassign' (the action is never replaced/disabled)", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignmentDetail: makeDetailSeam(historyFor(LESSON.slug)),
      lessonSummary: lessonSummaryCallable,
    });
    const card = cardFor(mount);
    const assign = card.querySelector<HTMLButtonElement>(
      `[data-testid=lesson-assign-${LESSON.slug}]`,
    );
    const summaryBtn = card.querySelector(
      `[data-testid=lesson-view-summary-${LESSON.slug}]`,
    );
    // Sprint 28.6H.7 (Part B): a previously assigned lesson reads "Assign
    // Again" (still fully active, same action); View Summary appears in
    // addition to it.
    expect(assign).not.toBeNull();
    expect(assign!.textContent).toBe("Reassign");
    expect(assign!.disabled).toBe(false);
    expect(summaryBtn).not.toBeNull();
  });

  test("Assign and Preview share the dedicated pair container", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: listOne });
    const pair = pairFor(mount);
    const assign = cardFor(mount).querySelector(
      `[data-testid=lesson-assign-${LESSON.slug}]`,
    )!;
    const preview = cardFor(mount).querySelector(
      `[data-testid=lesson-preview-${LESSON.slug}]`,
    )!;
    expect(pair.contains(assign)).toBe(true);
    expect(pair.contains(preview)).toBe(true);
    // The pair's direct children are exactly Assign then Preview - nothing
    // else is ever placed in the sizing row.
    const kids = Array.from(pair.children);
    expect(kids).toEqual([assign, preview]);
  });

  test("View Summary is OUTSIDE the Assign/Preview pair (a sibling of it)", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignmentDetail: makeDetailSeam(historyFor(LESSON.slug)),
      lessonSummary: lessonSummaryCallable,
    });
    const card = cardFor(mount);
    const actions = card.querySelector<HTMLElement>(".shell-lesson-actions")!;
    const pair = pairFor(mount);
    const footerRow = card.querySelector<HTMLElement>(
      ".shell-lesson-footer-row",
    )!;
    const summaryBtn = card.querySelector(
      `[data-testid=lesson-view-summary-${LESSON.slug}]`,
    )!;
    // Sprint 28.6H.3 (Task D3): View Summary never sits inside the primary
    // Assign/Preview pair (so it can never shrink them), and it no longer lives
    // in the actions stack either - it is a member of the shared quiet footer
    // row alongside the Resources disclosure.
    expect(pair.contains(summaryBtn)).toBe(false);
    expect(actions.contains(summaryBtn)).toBe(false);
    expect(Array.from(footerRow.children).includes(summaryBtn)).toBe(true);
  });

  test("the conditional View Summary does not alter the pair's membership", () => {
    // With View Summary (history + callable wired).
    const withSummary = mkMount();
    renderCurriculumSurface(withSummary, teacher, {
      listClasses: listOne,
      assignmentDetail: makeDetailSeam(historyFor(LESSON.slug)),
      lessonSummary: lessonSummaryCallable,
    });
    const withKids = Array.from(pairFor(withSummary).children).map(
      (el) => el.getAttribute("data-testid"),
    );

    // Without View Summary (no callable wired at all).
    _resetCurriculumSessionStateForTest();
    const withoutSummary = mkMount();
    renderCurriculumSurface(withoutSummary, teacher, {
      listClasses: listOne,
    });
    const withoutKids = Array.from(pairFor(withoutSummary).children).map(
      (el) => el.getAttribute("data-testid"),
    );

    // The pair holds exactly Assign + Preview in both cases; the presence of
    // View Summary changes nothing about the paired sizing row.
    expect(withKids).toEqual([
      `lesson-assign-${LESSON.slug}`,
      `lesson-preview-${LESSON.slug}`,
    ]);
    expect(withoutKids).toEqual(withKids);
  });

  test("View Summary remains conditional on assignment history", () => {
    // Never-assigned: the control is rendered but hidden (no dead control),
    // and it is still outside the pair.
    const neverAssigned = mkMount();
    renderCurriculumSurface(neverAssigned, teacher, {
      listClasses: listOne,
      assignmentDetail: makeDetailSeam([]),
      lessonSummary: lessonSummaryCallable,
    });
    const hiddenBtn = cardFor(neverAssigned).querySelector<HTMLButtonElement>(
      `[data-testid=lesson-view-summary-${LESSON.slug}]`,
    )!;
    expect(hiddenBtn.hidden).toBe(true);
    expect(pairFor(neverAssigned).contains(hiddenBtn)).toBe(false);

    // With published history: the same control is visible.
    _resetCurriculumSessionStateForTest();
    const assigned = mkMount();
    renderCurriculumSurface(assigned, teacher, {
      listClasses: listOne,
      assignmentDetail: makeDetailSeam(historyFor(LESSON.slug)),
      lessonSummary: lessonSummaryCallable,
    });
    const shownBtn = cardFor(assigned).querySelector<HTMLButtonElement>(
      `[data-testid=lesson-view-summary-${LESSON.slug}]`,
    )!;
    expect(shownBtn.hidden).toBe(false);
  });
});
