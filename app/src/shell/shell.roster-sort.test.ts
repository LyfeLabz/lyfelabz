/**
 * @jest-environment jsdom
 *
 * Sprint 30 roster sort, staging-defect regression. Drives the REAL teacher
 * shell composition (mountTeacherShell -> workspace outlet -> Classes ->
 * class -> Students -> Student Detail), not the Classes surface in isolation,
 * and asserts the rendered DOM order. The roster loader deliberately returns
 * students in an order that is neither last-name nor first-name order, and
 * the names are chosen so the two orders are visibly different from each
 * other, so no assertion can pass by coincidence of input order.
 */
import type { Session } from "../session/types";
import type { ClassSummary } from "../classes/types";
import { mountTeacherShell, type ShellDeps } from "./shell";
import { clearAllStoredRosterSort } from "../teacherPreferences/rosterSortStorage";

const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await flush();
};

const UID = "u-roster-sort";
const teacherSession = (): Extract<Session, { kind: "activeTeacher" }> =>
  Object.freeze({ kind: "activeTeacher", uid: UID, schoolId: "school-abc", displayName: "Teacher" });

const CLASS_ID = "sort-class-1";
const summary: ClassSummary = Object.freeze({
  id: CLASS_ID,
  title: "Sort Science",
  status: "active" as const,
  grade: "7",
  block: "B",
  isLmsLinked: false,
});

// Loader order (arbitrary):   Zed Carter, Christopher Brown, Maya Allen, Adrianna Zimmer, Name unavailable
// Last name (A-Z):            Maya Allen, Christopher Brown, Zed Carter, Adrianna Zimmer, Name unavailable
// First name (A-Z):           Adrianna Zimmer, Christopher Brown, Maya Allen, Zed Carter, Name unavailable
const LOADER_ORDER = [
  { studentId: "s-zed", studentDisplayName: "Zed Carter" },
  { studentId: "s-chris", studentDisplayName: "Christopher Brown" },
  { studentId: "s-maya", studentDisplayName: "Maya Allen" },
  { studentId: "s-adr", studentDisplayName: "Adrianna Zimmer" },
  { studentId: "s-una", studentDisplayName: "Name unavailable" },
];
// Natural names in each order; rows PRESENT Last name order as "Last, First".
const LAST = ["Maya Allen", "Christopher Brown", "Zed Carter", "Adrianna Zimmer", "Name unavailable"];
const LAST_SHOWN = ["Allen, Maya", "Brown, Christopher", "Carter, Zed", "Zimmer, Adrianna", "Name unavailable"];
const FIRST = ["Adrianna Zimmer", "Christopher Brown", "Maya Allen", "Zed Carter", "Name unavailable"];

const deps = (): ShellDeps => ({
  onSignOut: () => undefined,
  listClasses: async () => [summary],
  onLaunchPresentMode: () => undefined,
  loadRoster: () => async (input: { readonly classId: string }) => ({
    classId: input.classId,
    students: LOADER_ORDER,
  }),
});

const q = (root: ParentNode, sel: string) => root.querySelector<HTMLElement>(sel);
const rendered = (mount: HTMLElement) =>
  Array.from(mount.querySelectorAll("[data-testid=roster-list] [data-testid=roster-student]")).map(
    (b) => b.textContent,
  );
const select = (mount: HTMLElement) => q(mount, "[data-testid=roster-sort-select]") as HTMLSelectElement;
const choose = (mount: HTMLElement, value: string) => {
  select(mount).value = value;
  select(mount).dispatchEvent(new Event("change", { bubbles: true }));
};

async function mountStudents(): Promise<HTMLElement> {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  mountTeacherShell(teacherSession(), mount, deps());
  await settle();
  q(mount, `[data-testid=class-card-${CLASS_ID}]`)!.click();
  await settle();
  q(mount, "[data-testid=class-nav-roster]")!.click();
  await settle();
  return mount;
}

// Walk Student Detail Next from the first listed student; returns the
// Student Detail headings visited (always the natural name), which must
// follow the visible Students order.
async function walkNext(mount: HTMLElement, firstId: string): Promise<string[]> {
  q(mount, `[data-testid=roster-student][data-student-id="${firstId}"]`)!.click();
  await settle();
  const visited: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    visited.push(q(mount, "[data-testid=student-detail-name]")?.textContent ?? "?");
    const next = q(mount, "[data-testid=student-detail-next]");
    if (next === null) break;
    next.click();
    await settle();
  }
  return visited;
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/app/teacher");
  clearAllStoredRosterSort();
  localStorage.clear();
});
afterAll(() => {
  clearAllStoredRosterSort();
  localStorage.clear();
});

describe("Students roster sort through the real teacher shell", () => {
  test("Last name rows read 'Brown, Christopher'; clicking it opens Christopher Brown by id with a natural heading", async () => {
    const mount = await mountStudents();
    const row = q(mount, '[data-testid=roster-student][data-student-id="s-chris"]')!;
    expect(row.textContent).toBe("Brown, Christopher");
    row.click();
    await settle();
    expect(q(mount, "[data-testid=student-detail-name]")!.textContent).toBe("Christopher Brown");
    expect(q(mount, "[data-testid=student-detail-next]")!.getAttribute("aria-label")).toBe(
      "Next student: Zed Carter",
    );
  });

  test("a saved Last name preference restores the Last, First presentation on load", async () => {
    localStorage.setItem(`lyfelabz.roster.sort.${UID}`, "lastName");
    const mount = await mountStudents();
    expect(rendered(mount)).toEqual(LAST_SHOWN);
  });

  test("A. no saved preference: control says Last name AND the DOM rows are in last-name order", async () => {
    const mount = await mountStudents();
    expect(select(mount).value).toBe("lastName");
    expect(rendered(mount)).toEqual(LAST_SHOWN);
  });

  test("B/C. changing to First name reorders the visible rows; changing back restores last-name order", async () => {
    const mount = await mountStudents();
    choose(mount, "firstName");
    expect(rendered(mount)).toEqual(FIRST);
    choose(mount, "lastName");
    expect(rendered(mount)).toEqual(LAST_SHOWN);
  });

  test("D. a saved First name preference renders first-name order on load, and after navigating away and back", async () => {
    localStorage.setItem(`lyfelabz.roster.sort.${UID}`, "firstName");
    const mount = await mountStudents();
    expect(select(mount).value).toBe("firstName");
    expect(rendered(mount)).toEqual(FIRST);

    q(mount, "[data-testid=class-nav-assignments]")!.click();
    await settle();
    q(mount, "[data-testid=class-nav-roster]")!.click();
    await settle();
    expect(select(mount).value).toBe("firstName");
    expect(rendered(mount)).toEqual(FIRST);
  });

  test("E. Student Detail Next walks exactly the visible order, for each preference", async () => {
    const lastMount = await mountStudents();
    expect(rendered(lastMount)).toEqual(LAST_SHOWN);
    expect(await walkNext(lastMount, "s-maya")).toEqual(LAST);

    document.body.innerHTML = "";
    localStorage.setItem(`lyfelabz.roster.sort.${UID}`, "firstName");
    clearAllStoredRosterSort();
    localStorage.setItem(`lyfelabz.roster.sort.${UID}`, "firstName");
    const firstMount = await mountStudents();
    expect(rendered(firstMount)).toEqual(FIRST);
    expect(await walkNext(firstMount, "s-adr")).toEqual(FIRST);
  });
});
