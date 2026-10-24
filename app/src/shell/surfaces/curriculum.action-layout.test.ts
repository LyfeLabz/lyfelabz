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
 *   - Results-first: an assigned lesson relabels Assign as Results in
 *     place, so the pair still holds exactly two controls and the separate
 *     View Summary control no longer exists.
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

  test("an assigned-history card renders Results in place of Assign (same button, never disabled)", () => {
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
    expect(assign).not.toBeNull();
    expect(assign!.textContent).toBe("Results");
    expect(assign!.disabled).toBe(false);
    expect(card.querySelector("[data-testid^=lesson-view-summary-]")).toBeNull();
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

  test("the Results state does not alter the pair's membership", () => {
    // With Results (history + callable wired).
    const withSummary = mkMount();
    renderCurriculumSurface(withSummary, teacher, {
      listClasses: listOne,
      assignmentDetail: makeDetailSeam(historyFor(LESSON.slug)),
      lessonSummary: lessonSummaryCallable,
    });
    const withKids = Array.from(pairFor(withSummary).children).map(
      (el) => el.getAttribute("data-testid"),
    );

    // Without Results (no callable wired at all).
    _resetCurriculumSessionStateForTest();
    const withoutSummary = mkMount();
    renderCurriculumSurface(withoutSummary, teacher, {
      listClasses: listOne,
    });
    const withoutKids = Array.from(pairFor(withoutSummary).children).map(
      (el) => el.getAttribute("data-testid"),
    );

    // The pair holds exactly the primary action + Preview in both cases.
    expect(withKids).toEqual([
      `lesson-assign-${LESSON.slug}`,
      `lesson-preview-${LESSON.slug}`,
    ]);
    expect(withoutKids).toEqual(withKids);
  });

  test("Assign becomes Results only with assignment history; the pair keeps two controls", () => {
    const neverAssigned = mkMount();
    renderCurriculumSurface(neverAssigned, teacher, {
      listClasses: listOne,
      assignmentDetail: makeDetailSeam([]),
      lessonSummary: lessonSummaryCallable,
    });
    expect(
      Array.from(pairFor(neverAssigned).children).map((el) => el.textContent),
    ).toEqual(["Assign", "Preview"]);

    _resetCurriculumSessionStateForTest();
    const assigned = mkMount();
    renderCurriculumSurface(assigned, teacher, {
      listClasses: listOne,
      assignmentDetail: makeDetailSeam(historyFor(LESSON.slug)),
      lessonSummary: lessonSummaryCallable,
    });
    expect(
      Array.from(pairFor(assigned).children).map((el) => el.textContent),
    ).toEqual(["Results", "Preview"]);
  });
});
