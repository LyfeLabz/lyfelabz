/**
 * @jest-environment jsdom
 *
 * Sprint 30A.1 human-review finalization - Assign displays canonical
 * class order but never edits it.
 *
 * Human review moved class reordering to the Classes workspace entirely
 * (see classes.class-reorder.test.ts). This file proves the Assign side
 * of that correction: no drag handles or reorder controls exist in the
 * Assign dialog, Assign renders class rows in exactly the order its
 * `listClasses` seam provides (no secondary alphabetical/grade/block
 * sort), and selecting/deselecting a class never changes that order.
 */
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import type { AssignmentsCallables } from "../../settings/integrations/types";
import {
  renderCurriculumSurface,
  _resetCurriculumSessionStateForTest,
} from "./curriculum";

const freeze = <T>(v: T): T => Object.freeze(v) as T;
const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await flush();
};

const teacher: Extract<Session, { kind: "activeTeacher" }> = freeze({
  kind: "activeTeacher",
  uid: "u-teacher",
  schoolId: "school-abc",
  displayName: "Ada Lovelace",
});

// Deliberately NOT alphabetical, NOT grade-sorted, NOT block-sorted - if
// Assign applied any secondary sort, this order would be visibly rewritten
// (e.g. into c1/c2/c3/c4 by title, or grouped by grade).
const fourClasses: ReadonlyArray<ClassSummary> = freeze([
  freeze({ id: "c3", title: "G Science", grade: "7", block: "D", status: "active" }),
  freeze({ id: "c1", title: "A Science", grade: "6", block: "A", status: "active" }),
  freeze({ id: "c4", title: "C Science", grade: "6", block: "C", status: "active" }),
  freeze({ id: "c2", title: "E Science", grade: "7", block: "B", status: "active" }),
] as ClassSummary[]);
const listFour: ListClasses = () => Promise.resolve(fourClasses);

const okAssignments = (): AssignmentsCallables => ({
  createDraft: async (input) => ({
    assignmentId: input.assignmentId,
    status: "draft",
    alreadyCreated: false,
  }),
  publish: async (input) => ({
    assignmentId: input.assignmentId,
    status: "published",
    alreadyPublished: false,
  }),
  lifecycleState: async () => ({
    state: "neverAssigned" as const,
    candidates: [],
  }),
  recipientsReconcile: async (input) => ({
    assignmentId: input.assignmentId,
    added: 0,
    alreadyCurrent: 0,
  }),
});

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const openDialogFor = async (mount: HTMLElement, slug: string): Promise<void> => {
  mount
    .querySelector<HTMLButtonElement>(`[data-testid=lesson-assign-${slug}]`)
    ?.click();
  await settle();
};

const domOrder = (): string[] =>
  Array.from(document.querySelectorAll<HTMLElement>(".shell-assign-class-row")).map(
    (el) => el.getAttribute("data-class-id") ?? "",
  );

describe("Assign dialog - displays canonical order only, never edits it (Sprint 30A.1 human-review finalization)", () => {
  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    document
      .querySelectorAll("[data-testid=assign-overlay]")
      .forEach((el) => el.remove());
  });

  test("rows render in exactly the order the class list provides - no alphabetical, grade, or block sort", async () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFour,
      assignments: okAssignments(),
    });
    await openDialogFor(mount, "earths-layers");
    expect(domOrder()).toEqual(["c3", "c1", "c4", "c2"]);
  });

  test("no drag handles exist anywhere in the dialog", async () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFour,
      assignments: okAssignments(),
    });
    await openDialogFor(mount, "earths-layers");

    expect(
      document.querySelectorAll("[data-testid^=assign-row-drag-]"),
    ).toHaveLength(0);
    expect(
      document.querySelector(".shell-assign-drag-handle"),
    ).toBeNull();
    // Every row's first interactive control is the selection checkbox.
    for (const id of ["c1", "c2", "c3", "c4"]) {
      const row = document.querySelector<HTMLElement>(
        `[data-testid=assign-row-${id}]`,
      )!;
      const firstControl = row.querySelector("input, button, select");
      expect(firstControl).toBe(
        document.querySelector(`[data-testid=assign-row-enabled-${id}]`),
      );
    }
  });

  test("no row carries a keyboard reorder binding (ArrowUp/ArrowDown on a row do nothing)", async () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFour,
      assignments: okAssignments(),
    });
    await openDialogFor(mount, "earths-layers");

    const before = domOrder();
    const row = document.querySelector<HTMLElement>("[data-testid=assign-row-c1]")!;
    row.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true, bubbles: true }),
    );
    row.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", cancelable: true, bubbles: true }),
    );
    expect(domOrder()).toEqual(before);
  });

  test("deselecting and reselecting classes never changes their canonical order", async () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFour,
      assignments: okAssignments(),
    });
    await openDialogFor(mount, "earths-layers");

    const before = domOrder();
    document
      .querySelector<HTMLInputElement>("[data-testid=assign-row-enabled-c1]")!
      .click();
    document
      .querySelector<HTMLInputElement>("[data-testid=assign-row-enabled-c4]")!
      .click();
    expect(domOrder()).toEqual(before);

    document
      .querySelector<HTMLInputElement>("[data-testid=assign-row-enabled-c4]")!
      .click();
    expect(domOrder()).toEqual(before);
  });
});
