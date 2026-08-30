/**
 * @jest-environment jsdom
 *
 * Regression suite for the Sprint 25 certification (scenario B2)
 * stale-class-cache defect.
 *
 * Bug reproduced during B2 browser certification: the Curriculum
 * surface warms a module-scoped, uid-keyed teacher class cache
 * (`cachedClasses`) on mount. Because the SPA re-renders in place
 * instead of reloading the module, that cache survived (1) a
 * same-session class mutation performed on the Classes surface and (2) a
 * same-uid sign-out/sign-in. The Classes page read classes fresh while
 * the Assign dialog kept serving the pre-mutation (often empty) list.
 *
 * The fix is a bounded class-cache invalidation
 * (`invalidateCurriculumClassCache`) invoked after every class mutation
 * on the Classes surface and at every auth bootstrap transition. These
 * tests lock the corrected behavior in place and would fail before the
 * fix (the second Assign open would still show the stale list).
 */
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import type { CreateClass } from "../../classes/createClass";
import {
  renderCurriculumSurface,
  invalidateCurriculumClassCache,
  _resetCurriculumSessionStateForTest,
} from "./curriculum";
import { renderClassesSurface } from "./classes";

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

const freeze = <T>(v: T): T => Object.freeze(v) as T;

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

const teacherA: ActiveTeacher = freeze({
  kind: "activeTeacher",
  uid: "teacher-A",
  schoolId: "school-abc",
  displayName: "Ada Lovelace",
});

const teacherB: ActiveTeacher = freeze({
  kind: "activeTeacher",
  uid: "teacher-B",
  schoolId: "school-abc",
  displayName: "Blaise Pascal",
});

const activeClass = (
  id: string,
  title: string,
  grade: string,
): ClassSummary =>
  freeze({ id, title, grade, status: "active", isLmsLinked: false });

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

// Drive the Assign dialog for a lesson card, waiting for the async class
// load to settle, then report which state it rendered.
const openAssign = async (
  mount: HTMLElement,
  slug: string,
): Promise<void> => {
  mount
    .querySelector<HTMLButtonElement>(`[data-testid=lesson-assign-${slug}]`)
    ?.click();
  await flush();
  await flush();
  await flush();
};

const closeAssign = (): void => {
  document
    .querySelectorAll("[data-testid=assign-overlay]")
    .forEach((el) => el.remove());
};

const dialogClassRow = (classId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-testid=assign-row-${classId}]`);

const dialogEmpty = (): HTMLElement | null =>
  document.querySelector<HTMLElement>("[data-testid=assign-empty]");

describe("Curriculum class-cache invalidation (Sprint 25 B2)", () => {
  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    closeAssign();
    document.body.innerHTML = "";
  });

  test("warm empty cache, class later exists, invalidation makes Assign show it", async () => {
    const store: { rows: ClassSummary[] } = { rows: [] };
    const listClasses: ListClasses = () => Promise.resolve(freeze([...store.rows]));

    const mount = mkMount();
    renderCurriculumSurface(mount, teacherA, { listClasses });
    await flush(); // prefetch warms the cache with the empty list

    // First open: no active classes yet.
    await openAssign(mount, "earths-layers");
    expect(dialogEmpty()).not.toBeNull();
    expect(dialogClassRow("c1")).toBeNull();
    closeAssign();

    // A class now exists server-side.
    store.rows = [activeClass("c1", "6A", "6")];

    // Reopen WITHOUT invalidation: the stale cache still serves empty.
    // This documents the defect the fix targets.
    await openAssign(mount, "earths-layers");
    expect(dialogEmpty()).not.toBeNull();
    expect(dialogClassRow("c1")).toBeNull();
    closeAssign();

    // Invalidate, then reopen: the dialog re-fetches and shows the class.
    invalidateCurriculumClassCache();
    await openAssign(mount, "earths-layers");
    expect(dialogEmpty()).toBeNull();
    expect(dialogClassRow("c1")).not.toBeNull();
  });

  test("same-session create-then-assign shows the new class in Assign", async () => {
    const store: { rows: ClassSummary[] } = { rows: [] };
    const listClasses: ListClasses = () => Promise.resolve(freeze([...store.rows]));
    const createClass: CreateClass = async (input) => {
      store.rows = [...store.rows, activeClass("c-new", input.title, input.grade)];
      return freeze({
        classId: "c-new",
        joinCode: "AAAA",
        alreadyCreated: false,
      });
    };

    // Curriculum mounts first and warms the empty cache (the certification
    // scenario opened Curriculum before any class existed).
    const curriculumMount = mkMount();
    renderCurriculumSurface(curriculumMount, teacherA, { listClasses });
    await flush();

    // Create a class on the Classes surface. Sprint 28.6H.8: the manual create
    // form is reached via the shared class-management "create" intent (Settings
    // -> Create LyfeLabz Class), not a landing button.
    const classesMount = mkMount();
    renderClassesSurface(classesMount, teacherA, {
      listClasses,
      createClass,
      getClassManagementIntent: (): "create" => "create",
      setClassManagementIntent: () => {},
    });
    await flush();

    const title = classesMount.querySelector<HTMLInputElement>(
      "[data-testid=classes-create-title]",
    )!;
    title.value = "Period 3";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    const grade = classesMount.querySelector<HTMLSelectElement>(
      "[data-testid=classes-create-grade]",
    )!;
    grade.value = "7";
    grade.dispatchEvent(new Event("change", { bubbles: true }));
    const block = classesMount.querySelector<HTMLSelectElement>(
      "[data-testid=classes-create-block]",
    )!;
    block.value = "B";
    block.dispatchEvent(new Event("change", { bubbles: true }));
    classesMount
      .querySelector<HTMLFormElement>("[data-testid=classes-create-form]")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    await flush();

    // The create path invalidated the Curriculum cache; opening Assign now
    // re-fetches and sees the class that was just created.
    await openAssign(curriculumMount, "earths-layers");
    expect(dialogEmpty()).toBeNull();
    expect(dialogClassRow("c-new")).not.toBeNull();
  });

  test("same-uid sign-out/sign-in clears the stale cache", async () => {
    const store: { rows: ClassSummary[] } = {
      rows: [activeClass("c1", "6A", "6")],
    };
    const listClasses: ListClasses = () => Promise.resolve(freeze([...store.rows]));

    const mount1 = mkMount();
    renderCurriculumSurface(mount1, teacherA, { listClasses });
    await flush();
    await openAssign(mount1, "earths-layers");
    expect(dialogClassRow("c1")).not.toBeNull();
    closeAssign();

    // Same teacher signs out and back in; the underlying session now
    // resolves a different class set. The bootstrap boundary (`rerun` in
    // index.ts) calls invalidateCurriculumClassCache before dispatching
    // the new session; simulate that boundary here.
    store.rows = [activeClass("c9", "9Z", "7")];
    invalidateCurriculumClassCache();

    const mount2 = mkMount();
    renderCurriculumSurface(mount2, teacherA, { listClasses });
    await flush();
    await openAssign(mount2, "earths-layers");
    expect(dialogClassRow("c9")).not.toBeNull();
    // The prior session's row must not leak into the new same-uid session.
    expect(dialogClassRow("c1")).toBeNull();
  });

  test("cross-teacher safety: teacher A cache cannot leak to teacher B", async () => {
    const rowsA = [activeClass("a1", "A Class", "6")];
    const rowsB = [activeClass("b1", "B Class", "7")];
    const listClasses: ListClasses = (uid) =>
      Promise.resolve(freeze(uid === "teacher-A" ? [...rowsA] : [...rowsB]));

    // Teacher A warms the cache.
    const mA = mkMount();
    renderCurriculumSurface(mA, teacherA, { listClasses });
    await flush();
    await openAssign(mA, "earths-layers");
    expect(dialogClassRow("a1")).not.toBeNull();
    closeAssign();

    // Teacher B (different uid) opens Assign and sees only B's classes;
    // the uid key already isolates the two teachers.
    const mB = mkMount();
    renderCurriculumSurface(mB, teacherB, { listClasses });
    await flush();
    await openAssign(mB, "earths-layers");
    expect(dialogClassRow("b1")).not.toBeNull();
    expect(dialogClassRow("a1")).toBeNull();
    closeAssign();

    // After invalidation, teacher A still re-fetches its own classes.
    invalidateCurriculumClassCache();
    const mA2 = mkMount();
    renderCurriculumSurface(mA2, teacherA, { listClasses });
    await flush();
    await openAssign(mA2, "earths-layers");
    expect(dialogClassRow("a1")).not.toBeNull();
    expect(dialogClassRow("b1")).toBeNull();
  });

  test("existing Assign behavior is unchanged when the cache is valid", async () => {
    let calls = 0;
    const rows = [activeClass("c1", "6A", "6")];
    const listClasses: ListClasses = () => {
      calls += 1;
      return Promise.resolve(freeze([...rows]));
    };

    const mount = mkMount();
    renderCurriculumSurface(mount, teacherA, { listClasses });
    await flush();
    const afterPrefetch = calls; // single prefetch fetch

    // Two consecutive Assign opens with no intervening mutation: both are
    // served from the valid cache with no additional fetch.
    await openAssign(mount, "earths-layers");
    expect(dialogClassRow("c1")).not.toBeNull();
    closeAssign();

    await openAssign(mount, "earths-layers");
    expect(dialogClassRow("c1")).not.toBeNull();

    expect(calls).toBe(afterPrefetch);
    expect(afterPrefetch).toBe(1);
  });
});
