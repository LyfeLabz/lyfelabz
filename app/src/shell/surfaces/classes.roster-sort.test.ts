/**
 * @jest-environment jsdom
 *
 * Sprint 30 roster polish: the teacher-controlled roster sort preference on
 * Classes -> class -> Students. Default Last name (A-Z); a compact Sort
 * control reorders the list immediately; the choice persists per teacher in
 * this browser (navigation, re-mount/reload), drives Student Detail
 * Previous/Next, and is the same preference Assignment Detail reads.
 */
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ClassesSurfaceDeps } from "./classes";
import { renderClassesSurface } from "./classes";
import {
  clearAllStoredRosterSort,
  createRosterSortPreference,
} from "../../teacherPreferences/rosterSortStorage";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await flush();
};

const teacher: Extract<Session, { kind: "activeTeacher" }> = Object.freeze({
  kind: "activeTeacher",
  uid: "teacher-sort",
  schoolId: "school-t",
  displayName: "Teacher",
});

const CLASS_A = "class-a";
const classes: ReadonlyArray<ClassSummary> = Object.freeze([
  Object.freeze({ id: CLASS_A, title: "(A) Science", status: "active", grade: "7", block: "A", isLmsLinked: false }),
] as ClassSummary[]);

// Server order is display-name order (enrollmentsListForClass).
const STUDENTS = [
  { studentId: "s-adr", studentDisplayName: "Adrianna Zimmer" },
  { studentId: "s-ben", studentDisplayName: "Ben Adams" },
  { studentId: "s-cal", studentDisplayName: "Cal Moss" },
  { studentId: "s-una", studentDisplayName: "Name unavailable" },
];

const deps: ClassesSurfaceDeps = {
  listClasses: async () => classes,
  loadRoster: () => async (input: { classId: string }) => ({
    classId: input.classId,
    students: STUDENTS,
  }),
  loadAttempts: () => async (input: { classId: string }) => ({
    classId: input.classId,
    attempts: [],
  }),
};

const q = (root: ParentNode, sel: string) => root.querySelector<HTMLElement>(sel);
const listed = (mount: HTMLElement) =>
  Array.from(mount.querySelectorAll("[data-testid=roster-student]")).map((b) => b.textContent);
const select = (mount: HTMLElement) =>
  q(mount, "[data-testid=roster-sort-select]") as HTMLSelectElement;
const choose = (mount: HTMLElement, value: string) => {
  const el = select(mount);
  el.value = value;
  el.dispatchEvent(new Event("change"));
};

async function openStudents(): Promise<HTMLElement> {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  renderClassesSurface(mount, teacher, deps);
  await settle();
  q(mount, `[data-testid=class-card-${CLASS_A}]`)!.click();
  await settle();
  q(mount, "[data-testid=class-nav-roster]")!.click();
  await settle();
  return mount;
}

beforeEach(() => {
  document.body.innerHTML = "";
  clearAllStoredRosterSort();
  localStorage.clear();
});
afterAll(() => {
  clearAllStoredRosterSort();
  localStorage.clear();
});

describe("Students list sort preference", () => {
  test("no saved preference: Last name (A-Z), shown as the selected option", async () => {
    const mount = await openStudents();
    expect(select(mount).value).toBe("lastName");
    expect(q(mount, "[data-testid=roster-sort] label")!.textContent).toBe("Sort");
    expect(listed(mount)).toEqual(["Adams, Ben", "Moss, Cal", "Zimmer, Adrianna", "Name unavailable"]);
  });

  test("changing the control reorders immediately, keeps focus, and names still open Student Detail", async () => {
    const mount = await openStudents();
    select(mount).focus();
    choose(mount, "firstName");
    expect(listed(mount)).toEqual(["Adrianna Zimmer", "Ben Adams", "Cal Moss", "Name unavailable"]);
    expect(document.activeElement).toBe(select(mount));
    q(mount, '[data-student-id="s-ben"]')!.click();
    await settle();
    expect(q(mount, "[data-testid=student-detail]")).not.toBeNull();
  });

  test("the choice survives navigation away and back, and a fresh mount (reload)", async () => {
    const mount = await openStudents();
    choose(mount, "firstName");
    q(mount, "[data-testid=class-nav-assignments]")!.click();
    await settle();
    q(mount, "[data-testid=class-nav-roster]")!.click();
    await settle();
    expect(select(mount).value).toBe("firstName");
    expect(listed(mount)[0]).toBe("Adrianna Zimmer");

    document.body.innerHTML = "";
    clearAllStoredRosterSort(); // drop in-memory state only...
    localStorage.setItem("lyfelabz.roster.sort.teacher-sort", "firstName"); // ...the browser keeps its store
    const reloaded = await openStudents();
    expect(select(reloaded).value).toBe("firstName");
    expect(listed(reloaded)).toEqual(["Adrianna Zimmer", "Ben Adams", "Cal Moss", "Name unavailable"]);
  });

  test("the teacher can switch back to Last name", async () => {
    const mount = await openStudents();
    choose(mount, "firstName");
    choose(mount, "lastName");
    expect(listed(mount)[0]).toBe("Adams, Ben");
    expect(localStorage.getItem("lyfelabz.roster.sort.teacher-sort")).toBe("lastName");
  });

  test("Student Detail Previous/Next walks the list in the displayed order", async () => {
    const mount = await openStudents();
    q(mount, '[data-student-id="s-cal"]')!.click();
    await settle();
    // Last name: Ben Adams, Cal Moss, Adrianna Zimmer.
    expect(q(mount, "[data-testid=student-detail-prev]")!.getAttribute("aria-label")).toBe(
      "Previous student: Ben Adams",
    );
    expect(q(mount, "[data-testid=student-detail-next]")!.getAttribute("aria-label")).toBe(
      "Next student: Adrianna Zimmer",
    );

    document.body.innerHTML = "";
    createRosterSortPreference(teacher.uid).write("firstName");
    const again = await openStudents();
    q(again, '[data-student-id="s-cal"]')!.click();
    await settle();
    // First name: Adrianna Zimmer, Ben Adams, Cal Moss, Name unavailable.
    expect(q(again, "[data-testid=student-detail-prev]")!.getAttribute("aria-label")).toBe(
      "Previous student: Ben Adams",
    );
    expect(q(again, "[data-testid=student-detail-next]")!.getAttribute("aria-label")).toBe(
      "Next student: Name unavailable",
    );
  });

  test("Students list and Assignment Detail share one per-teacher preference", async () => {
    const mount = await openStudents();
    choose(mount, "firstName");
    // Assignment Detail is handed createRosterSortPreference(uid) by the entry point.
    expect(createRosterSortPreference(teacher.uid).read()).toBe("firstName");
    expect(createRosterSortPreference("another-teacher").read()).toBe("lastName");
  });
});
