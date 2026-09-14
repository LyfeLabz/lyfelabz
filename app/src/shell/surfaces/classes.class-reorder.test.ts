/**
 * @jest-environment jsdom
 *
 * Sprint 30A.1 human-review finalization - class-card reordering.
 *
 * Human review moved reordering from the Assign dialog to the Classes
 * workspace (see curriculum.class-order-display.test.ts for Assign's side:
 * display-only, no drag controls, no secondary sort). This file exercises
 * the Classes workspace's own drag handle: pointer-drag reordering,
 * keyboard reordering (the accessible path), persistence through the
 * injected `updateClassOrder` seam, and non-destructive failure handling.
 *
 * The canonical order itself (fallback ordering, the saved-order merge)
 * is unit-tested in classOrder.test.ts / classOrderMath.ts; this file only
 * covers what the Classes workspace DOES with an already-ordered list:
 * renders it, lets the teacher drag/keyboard-reorder it, and persists the
 * result. Grid column count is a CSS-only concern (the DOM order alone
 * drives visual reading order per `.shell-classes-list`'s grid rules) and
 * is not independently re-tested here per the project's convention of not
 * unit-testing layout/CSS outcomes in jsdom.
 */
import { renderClassesSurface } from "./classes";
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

const teacher: ActiveTeacher = Object.freeze({
  kind: "activeTeacher",
  uid: "teacher-1",
  schoolId: "school-1",
  displayName: "Ms. Teacher",
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

// Arrives in this order - proving classes.ts renders whatever order it is
// handed (canonical ordering itself is computed upstream by
// `createOrderedListClasses`, unit-tested in classOrder.test.ts).
const fourClasses: ReadonlyArray<ClassSummary> = Object.freeze([
  Object.freeze({ id: "c1", title: "A Science", grade: "6", status: "active" }),
  Object.freeze({ id: "c2", title: "C Science", grade: "6", status: "active" }),
  Object.freeze({ id: "c3", title: "E Science", grade: "7", status: "active" }),
  Object.freeze({ id: "c4", title: "G Science", grade: "7", status: "active" }),
] as ClassSummary[]);
const listFour = async (): Promise<ReadonlyArray<ClassSummary>> => fourClasses;

const domOrder = (): string[] =>
  Array.from(document.querySelectorAll<HTMLElement>(".shell-classes-item")).map(
    (el) => el.getAttribute("data-class-id") ?? "",
  );

const dragHandle = (id: string): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>(`[data-testid=class-card-drag-${id}]`)!;

const item = (id: string): HTMLElement =>
  document.querySelector<HTMLElement>(`.shell-classes-item[data-class-id="${id}"]`)!;

describe("Classes workspace - class card reordering (Sprint 30A.1 human-review finalization)", () => {
  // Each test mounts a fresh `<div>` via `mkMount()` but never removes the
  // previous test's; without this, `domOrder()`/`item()`'s global
  // `document.querySelectorAll` would also match stale cards left over
  // from earlier tests in this file.
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("cards render in the exact canonical order the class list provides", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, { listClasses: listFour });
    await flush();
    expect(domOrder()).toEqual(["c1", "c2", "c3", "c4"]);
  });

  test("dragging a card onto another moves it there", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, { listClasses: listFour });
    await flush();

    // Drag c1 and drop it on c3: c1 moves to just before c3.
    item("c1").dispatchEvent(new Event("dragstart"));
    item("c3").dispatchEvent(new Event("dragover", { cancelable: true }));
    item("c3").dispatchEvent(new Event("drop", { cancelable: true }));

    expect(domOrder()).toEqual(["c2", "c1", "c3", "c4"]);
  });

  test("the card stays draggable=false until the handle (not the card) receives a pointerdown", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, { listClasses: listFour });
    await flush();

    expect(item("c1").draggable).toBe(false);
    // A pointerdown on the card itself (as opposed to its drag handle)
    // never arms dragging - only grabbing the handle does.
    document
      .querySelector<HTMLButtonElement>("[data-testid=class-card-c1]")!
      .dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(item("c1").draggable).toBe(false);

    dragHandle("c1").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(item("c1").draggable).toBe(true);
  });

  test("keyboard: ArrowRight on the handle moves the card one position later and keeps focus on the same handle", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, { listClasses: listFour });
    await flush();

    const handle = dragHandle("c2");
    handle.focus();
    handle.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true }),
    );

    expect(domOrder()).toEqual(["c1", "c3", "c2", "c4"]);
    // Focus follows the moved card's own handle so repeated key presses
    // keep working without the teacher re-locating the control.
    expect(document.activeElement).toBe(dragHandle("c2"));
  });

  test("keyboard: ArrowLeft on the handle moves the card one position earlier", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, { listClasses: listFour });
    await flush();

    const handle = dragHandle("c3");
    handle.focus();
    handle.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true }),
    );

    expect(domOrder()).toEqual(["c1", "c3", "c2", "c4"]);
  });

  test("ArrowLeft on the first card and ArrowRight on the last card are no-ops", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, { listClasses: listFour });
    await flush();

    dragHandle("c1").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true }),
    );
    expect(domOrder()).toEqual(["c1", "c2", "c3", "c4"]);

    dragHandle("c4").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true }),
    );
    expect(domOrder()).toEqual(["c1", "c2", "c3", "c4"]);
  });

  test("the drag handle is accessible: a real button with a keyboard-oriented label, distinct from the card", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, { listClasses: listFour });
    await flush();

    const handle = dragHandle("c1");
    expect(handle.tagName).toBe("BUTTON");
    expect(handle.getAttribute("aria-label")).toMatch(/arrow keys/i);
    expect(handle).not.toBe(
      document.querySelector("[data-testid=class-card-c1]"),
    );
  });

  test("a keyboard reorder persists the new order through the injected updateClassOrder seam", async () => {
    const calls: ReadonlyArray<string>[] = [];
    const updateClassOrder = async (order: ReadonlyArray<string>) => {
      calls.push(order);
    };
    const mount = mkMount();
    renderClassesSurface(mount, teacher, { listClasses: listFour, updateClassOrder });
    await flush();

    dragHandle("c2").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true }),
    );
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(["c1", "c3", "c2", "c4"]);
  });

  test("a drag-and-drop reorder also persists through updateClassOrder", async () => {
    const calls: ReadonlyArray<string>[] = [];
    const updateClassOrder = async (order: ReadonlyArray<string>) => {
      calls.push(order);
    };
    const mount = mkMount();
    renderClassesSurface(mount, teacher, { listClasses: listFour, updateClassOrder });
    await flush();

    item("c4").dispatchEvent(new Event("dragstart"));
    item("c1").dispatchEvent(new Event("dragover", { cancelable: true }));
    item("c1").dispatchEvent(new Event("drop", { cancelable: true }));
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(["c4", "c1", "c2", "c3"]);
  });

  test("a failed save never reverts the visual reorder, and surfaces a non-blocking notice", async () => {
    const updateClassOrder = async (): Promise<void> => {
      throw new Error("network blip");
    };
    const mount = mkMount();
    renderClassesSurface(mount, teacher, { listClasses: listFour, updateClassOrder });
    await flush();

    dragHandle("c1").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true }),
    );
    await flush();

    // The visual reorder stands even though persistence failed - no
    // unpredictable revert.
    expect(domOrder()).toEqual(["c2", "c1", "c3", "c4"]);
    // The canonical preference is not silently claimed as saved: a
    // visible, honest notice appears.
    const notice = document.querySelector<HTMLElement>(
      "[data-testid=classes-order-error]",
    );
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toMatch(/couldn.t save/i);
  });

  test("without an updateClassOrder seam, reordering still updates the visual order locally", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, { listClasses: listFour });
    await flush();

    dragHandle("c1").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true }),
    );

    expect(domOrder()).toEqual(["c2", "c1", "c3", "c4"]);
    expect(
      document.querySelector("[data-testid=classes-order-error]"),
    ).toBeNull();
  });
});
