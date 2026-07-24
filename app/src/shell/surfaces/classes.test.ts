/**
 * @jest-environment jsdom
 */
import { renderClassesSurface } from "./classes";
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type {
  CreateClass,
  CreateClassInput,
} from "../../classes/createClass";

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

const openCreateForm = async (mount: HTMLElement): Promise<void> => {
  await flush();
  mount
    .querySelector<HTMLButtonElement>("[data-testid=classes-create-open]")!
    .click();
};

describe("Create Class form input focus", () => {
  test("typing consecutive characters keeps the same input element and focus", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "AAAA", alreadyCreated: false });
    renderClassesSurface(mount, teacher, { listClasses, createClass });
    await openCreateForm(mount);

    const first = mount.querySelector<HTMLInputElement>(
      "[data-testid=classes-create-title]",
    )!;
    expect(first).not.toBeNull();
    first.focus();
    expect(document.activeElement).toBe(first);

    for (const ch of "Room 101") {
      first.value = first.value + ch;
      first.dispatchEvent(new Event("input", { bubbles: true }));
    }

    const after = mount.querySelector<HTMLInputElement>(
      "[data-testid=classes-create-title]",
    )!;
    expect(after).toBe(first);
    expect(document.activeElement).toBe(first);
    expect(after.value).toBe("Room 101");
  });

  test("Grade and Block selects update state and are submitted", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const captured: CreateClassInput[] = [];
    const createClass: CreateClass = async (input) => {
      captured.push(input);
      return Object.freeze({
        classId: "c",
        joinCode: "BBBB",
        alreadyCreated: false,
      });
    };
    renderClassesSurface(mount, teacher, { listClasses, createClass });
    await openCreateForm(mount);

    const title = mount.querySelector<HTMLInputElement>(
      "[data-testid=classes-create-title]",
    )!;
    title.value = "Period 2";
    title.dispatchEvent(new Event("input", { bubbles: true }));

    const grade = mount.querySelector<HTMLSelectElement>(
      "[data-testid=classes-create-grade]",
    )!;
    grade.value = "8";
    grade.dispatchEvent(new Event("change", { bubbles: true }));

    const block = mount.querySelector<HTMLSelectElement>(
      "[data-testid=classes-create-block]",
    )!;
    block.value = "C";
    block.dispatchEvent(new Event("change", { bubbles: true }));

    mount
      .querySelector<HTMLFormElement>("[data-testid=classes-create-form]")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await flush();
    await flush();

    expect(captured).toEqual([
      { title: "Period 2", grade: "8", block: "C" },
    ]);
  });

  test("Cancel closes the form and resets to the Create button", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "CCCC", alreadyCreated: false });
    renderClassesSurface(mount, teacher, { listClasses, createClass });
    await openCreateForm(mount);

    const title = mount.querySelector<HTMLInputElement>(
      "[data-testid=classes-create-title]",
    )!;
    title.value = "Draft I abandon";
    title.dispatchEvent(new Event("input", { bubbles: true }));

    mount
      .querySelector<HTMLButtonElement>("[data-testid=classes-create-cancel]")!
      .click();

    expect(
      mount.querySelector("[data-testid=classes-create-form]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=classes-create-open]"),
    ).not.toBeNull();

    mount
      .querySelector<HTMLButtonElement>("[data-testid=classes-create-open]")!
      .click();
    const reopened = mount.querySelector<HTMLInputElement>(
      "[data-testid=classes-create-title]",
    )!;
    expect(reopened.value).toBe("");
  });

  test("full typed title submits verbatim, unaltered by the surface", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const captured: CreateClassInput[] = [];
    const createClass: CreateClass = async (input) => {
      captured.push(input);
      return Object.freeze({
        classId: "c",
        joinCode: "DDDD",
        alreadyCreated: false,
      });
    };
    renderClassesSurface(mount, teacher, { listClasses, createClass });
    await openCreateForm(mount);

    const title = mount.querySelector<HTMLInputElement>(
      "[data-testid=classes-create-title]",
    )!;
    const typed = "Mr. Kankel Block A";
    for (const ch of typed) {
      title.value = title.value + ch;
      title.dispatchEvent(new Event("input", { bubbles: true }));
    }

    mount
      .querySelector<HTMLFormElement>("[data-testid=classes-create-form]")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await flush();
    await flush();

    expect(captured[0]?.title).toBe(typed);
  });
});
