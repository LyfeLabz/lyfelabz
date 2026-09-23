/**
 * @jest-environment jsdom
 *
 * Students-tab roster lifecycle: opening a class prefetches THAT class's
 * roster in the background (never blocking Assignments); switching to
 * Students renders the already-resolved roster with no loading state and no
 * second request; tab switching never refetches; a different class never
 * shows the previous class's roster; failures are not cached and the next
 * Students visit retries.
 */
import type { ClassSummary } from "../../classes/types";
import type { Session } from "../../session/types";
import { renderClassesSurface } from "./classes";

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;
type RosterResult = {
  classId: string;
  students: ReadonlyArray<{ studentId: string; studentDisplayName: string }>;
};

const teacher: ActiveTeacher = Object.freeze({
  kind: "activeTeacher",
  uid: "u1",
  schoolId: "school-abc",
  displayName: "Ada Lovelace",
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await flush();
};

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const CLASS_A = "roster-a";
const CLASS_B = "roster-b";
const NEEDS_SETUP = "roster-setup";
const classes: ReadonlyArray<ClassSummary> = Object.freeze([
  Object.freeze({ id: CLASS_A, title: "(A) Science", status: "active", grade: "6", block: "A" }),
  Object.freeze({ id: CLASS_B, title: "(B) Science", status: "active", grade: "6", block: "B" }),
  Object.freeze({ id: NEEDS_SETUP, title: "New Class", status: "needsSetup" }),
] as ClassSummary[]);

const rosterFor = (classId: string): RosterResult => ({
  classId,
  students: [
    { studentId: `${classId}-s1`, studentDisplayName: `${classId} Student One` },
    { studentId: `${classId}-s2`, studentDisplayName: `${classId} Student Two` },
  ],
});

// A roster reader whose responses the test resolves/rejects explicitly.
function controllableLoader() {
  const pending: Array<{
    classId: string;
    resolve: (v: RosterResult) => void;
    reject: (e: unknown) => void;
  }> = [];
  const loader = jest.fn(
    (input: { readonly classId: string }) =>
      new Promise<RosterResult>((resolve, reject) => {
        pending.push({ classId: input.classId, resolve, reject });
      }),
  );
  const resolveAll = () => {
    for (const p of pending.splice(0)) p.resolve(rosterFor(p.classId));
  };
  return { loader, pending, resolveAll };
}

async function mountClasses(extra: Partial<Parameters<typeof renderClassesSurface>[2]>) {
  const mount = mkMount();
  renderClassesSurface(mount, teacher, {
    listClasses: async () => classes,
    ...extra,
  });
  await settle();
  return mount;
}

const openClass = async (mount: HTMLElement, id: string) => {
  mount.querySelector<HTMLButtonElement>(`[data-testid=class-card-${id}]`)!.click();
  await flush();
};
const showStudents = async (mount: HTMLElement) => {
  mount.querySelector<HTMLButtonElement>("[data-testid=class-nav-roster]")!.click();
  await flush();
};
const showAssignments = async (mount: HTMLElement) => {
  mount.querySelector<HTMLButtonElement>("[data-testid=class-nav-assignments]")!.click();
  await flush();
};
const names = (mount: HTMLElement) =>
  Array.from(mount.querySelectorAll(".shell-roster-student-name")).map((n) => n.textContent);

describe("Students roster prefetch on class open", () => {
  test("opening a class starts THAT class's roster read in the background (and only that class's)", async () => {
    const { loader } = controllableLoader();
    const mount = await mountClasses({ loadRoster: () => loader });
    expect(loader).not.toHaveBeenCalled(); // nothing prefetched for every class

    await openClass(mount, CLASS_A);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledWith({ classId: CLASS_A });
  });

  test("the Assignments view renders immediately, not blocked by the pending roster read", async () => {
    const { loader } = controllableLoader(); // never resolved in this test
    const mount = await mountClasses({ loadRoster: () => loader });
    await openClass(mount, CLASS_A);

    expect(
      mount.querySelector('[data-testid=class-nav-assignments][aria-current="page"]'),
    ).not.toBeNull();
    expect(mount.querySelector("[data-testid=roster-loading]")).toBeNull();
  });

  test("Students uses the prefetched roster immediately: no loading state and no second request", async () => {
    const { loader, resolveAll } = controllableLoader();
    const mount = await mountClasses({ loadRoster: () => loader });
    await openClass(mount, CLASS_A);
    resolveAll();
    await settle();

    await showStudents(mount);

    expect(mount.querySelector("[data-testid=roster-loading]")).toBeNull();
    expect(names(mount)).toEqual([`${CLASS_A} Student One`, `${CLASS_A} Student Two`]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test("clicking Students before the prefetch resolves shows the existing loading state, then the list, without a duplicate request", async () => {
    const { loader, resolveAll } = controllableLoader();
    const mount = await mountClasses({ loadRoster: () => loader });
    await openClass(mount, CLASS_A);
    await showStudents(mount);
    expect(mount.querySelector("[data-testid=roster-loading]")).not.toBeNull();

    resolveAll();
    await settle();

    expect(mount.querySelector("[data-testid=roster-loading]")).toBeNull();
    expect(names(mount)).toEqual([`${CLASS_A} Student One`, `${CLASS_A} Student Two`]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test("repeated Assignments <-> Students switching never refetches", async () => {
    const { loader, resolveAll } = controllableLoader();
    const mount = await mountClasses({ loadRoster: () => loader });
    await openClass(mount, CLASS_A);
    resolveAll();
    await settle();
    for (let i = 0; i < 3; i += 1) {
      await showStudents(mount);
      expect(mount.querySelector("[data-testid=roster-loading]")).toBeNull();
      await showAssignments(mount);
    }
    await showStudents(mount);
    expect(names(mount)).toHaveLength(2);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test("changing classes never shows the previous class's roster (and a late response for it is discarded)", async () => {
    const { loader, pending } = controllableLoader();
    const mount = await mountClasses({ loadRoster: () => loader });
    await openClass(mount, CLASS_A);
    // Leave for the list and open class B while A's read is still in flight.
    mount.querySelector<HTMLButtonElement>("[data-testid=class-workspace-back]")!.click();
    await flush();
    await openClass(mount, CLASS_B);
    await showStudents(mount);

    // A's (stale) response arrives late, then B's.
    const a = pending.find((p) => p.classId === CLASS_A)!;
    const b = pending.find((p) => p.classId === CLASS_B)!;
    a.resolve(rosterFor(CLASS_A));
    await settle();
    expect(names(mount)).not.toContain(`${CLASS_A} Student One`);
    b.resolve(rosterFor(CLASS_B));
    await settle();

    expect(names(mount)).toEqual([`${CLASS_B} Student One`, `${CLASS_B} Student Two`]);
  });

  test("reopening a class fetches its roster anew (freshness per class open)", async () => {
    const { loader, resolveAll } = controllableLoader();
    const mount = await mountClasses({ loadRoster: () => loader });
    await openClass(mount, CLASS_A);
    resolveAll();
    await settle();
    mount.querySelector<HTMLButtonElement>("[data-testid=class-workspace-back]")!.click();
    await flush();
    await openClass(mount, CLASS_A);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  test("a failed read shows the error (never a false empty roster) and is not cached: the next Students visit retries", async () => {
    const { loader, pending, resolveAll } = controllableLoader();
    const mount = await mountClasses({ loadRoster: () => loader });
    await openClass(mount, CLASS_A);
    await showStudents(mount);
    pending.splice(0)[0]!.reject(new Error("unavailable"));
    await settle();
    expect(mount.querySelector("[data-testid=roster-error]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=roster-empty]")).toBeNull();

    await showAssignments(mount);
    expect(loader).toHaveBeenCalledTimes(1); // no retry from the Assignments view
    await showStudents(mount);
    expect(loader).toHaveBeenCalledTimes(2); // retried on the Students visit
    resolveAll();
    await settle();
    expect(mount.querySelector("[data-testid=roster-error]")).toBeNull();
    expect(names(mount)).toHaveLength(2);
  });

  test("the class-open membership refresh completes BEFORE the roster prefetch reads (no staler roster than before)", async () => {
    const order: string[] = [];
    let finishRefresh!: () => void;
    const refreshRoster = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = () => {
            order.push("refresh-done");
            resolve();
          };
        }),
    );
    const loader = jest.fn(async (input: { readonly classId: string }) => {
      order.push("roster-read");
      return rosterFor(input.classId);
    });
    const lmsClasses = [{ ...classes[0]!, isLmsLinked: true }] as ClassSummary[];
    const mount = mkMount();
    renderClassesSurface(mount, teacher, {
      listClasses: async () => lmsClasses,
      loadRoster: () => loader,
      refreshRoster: refreshRoster as never,
    });
    await settle();
    await openClass(mount, CLASS_A);
    await settle();
    expect(loader).not.toHaveBeenCalled();

    finishRefresh();
    await settle();
    expect(order).toEqual(["refresh-done", "roster-read"]);
  });

  test("a needsSetup class opens on Setup and prefetches no roster", async () => {
    const { loader } = controllableLoader();
    const mount = await mountClasses({ loadRoster: () => loader });
    await openClass(mount, NEEDS_SETUP);
    expect(loader).not.toHaveBeenCalled();
  });
});
