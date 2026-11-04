/**
 * @jest-environment jsdom
 *
 * Navigation performance: roster retry protection. A failed Students roster
 * read is retried only after a deliberate teacher action (showing Students,
 * Back to Students, a history restore, or Try again), never because the
 * Classes surface rerendered for an unrelated reason. In-flight reads are
 * always reused, and stale responses never replace newer data.
 */
import type { ActivateClass, ActivateClassResult } from "../../classes/activateClass";
import type { SyncRoster, SyncRosterResult } from "../../classes/syncRoster";
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

const CLASS_A = "retry-a";
const CLASS_B = "retry-b";
const classes: ReadonlyArray<ClassSummary> = Object.freeze([
  Object.freeze({ id: CLASS_A, title: "(A) Science", status: "active", grade: "6", block: "A" }),
  Object.freeze({ id: CLASS_B, title: "(B) Science", status: "active", grade: "6", block: "B" }),
] as ClassSummary[]);

const rosterFor = (classId: string): RosterResult => ({
  classId,
  students: [
    { studentId: `${classId}-s1`, studentDisplayName: `${classId} Student One` },
    { studentId: `${classId}-s2`, studentDisplayName: `${classId} Student Two` },
  ],
});

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
  const next = () => pending.shift()!;
  return { loader, pending, next };
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

const q = <T extends Element = HTMLElement>(mount: HTMLElement, testid: string) =>
  mount.querySelector<T>(`[data-testid=${testid}]`);
const openClass = async (mount: HTMLElement, id: string) => {
  q<HTMLButtonElement>(mount, `class-card-${id}`)!.click();
  await flush();
};
const backToList = async (mount: HTMLElement) => {
  q<HTMLButtonElement>(mount, "class-workspace-back")!.click();
  await flush();
};
const showStudents = async (mount: HTMLElement) => {
  q<HTMLButtonElement>(mount, "class-nav-roster")!.click();
  await flush();
};
const showAssignments = async (mount: HTMLElement) => {
  q<HTMLButtonElement>(mount, "class-nav-assignments")!.click();
  await flush();
};
const names = (mount: HTMLElement) =>
  Array.from(mount.querySelectorAll(".shell-roster-student-name")).map((n) => n.textContent);
const shown = (classId: string, n: "One" | "Two") => `${n}, ${classId} Student`;

// Opens class A on Students and fails its first roster read.
async function failedStudents(mount: HTMLElement, next: () => { reject: (e: unknown) => void }) {
  await openClass(mount, CLASS_A);
  await showStudents(mount);
  next().reject(new Error("unavailable"));
  await settle();
}

describe("Students roster retry protection", () => {
  test("initial roster load makes exactly one request", async () => {
    const { loader, next } = controllableLoader();
    const mount = await mountClasses({ loadRoster: () => loader });
    await openClass(mount, CLASS_A);
    await showStudents(mount);
    expect(loader).toHaveBeenCalledTimes(1);
    next().resolve(rosterFor(CLASS_A));
    await settle();
    expect(names(mount)).toEqual([shown(CLASS_A, "One"), shown(CLASS_A, "Two")]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test("a failure shows the error with Try again and no false empty roster", async () => {
    const { loader, next } = controllableLoader();
    const mount = await mountClasses({ loadRoster: () => loader });
    await failedStudents(mount, next);
    expect(q(mount, "roster-error")).not.toBeNull();
    expect(q(mount, "roster-retry")).not.toBeNull();
    expect(q(mount, "roster-empty")).toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test("an incidental rerender after a failure does not retry and keeps the error visible", async () => {
    // A real non-navigation rerender of the Students view: the automatic
    // post-activation Google Classroom roster sync settling (here, failing)
    // while the teacher is on Students.
    const LMS = "retry-lms";
    const needsSetup = { id: LMS, title: "LMS", status: "needsSetup", isLmsLinked: true } as ClassSummary;
    const active = { id: LMS, title: "LMS", status: "active", grade: "7", block: "B", isLmsLinked: true } as ClassSummary;
    let listCalls = 0;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> =>
      ++listCalls === 1 ? [needsSetup] : [active];
    let rejectSync: (e: unknown) => void = () => undefined;
    const syncRoster: SyncRoster = jest.fn(
      () =>
        new Promise<SyncRosterResult>((_resolve, reject) => {
          rejectSync = reject;
        }),
    );
    const activateResult: ActivateClassResult = {
      classId: LMS,
      status: "active",
      joinCode: null,
      alreadyActive: false,
    };
    const activateClass: ActivateClass = async () => activateResult;
    const { loader, next } = controllableLoader();
    const mount = await mountClasses({
      listClasses,
      syncRoster,
      activateClass,
      loadRoster: () => loader,
    });
    await openClass(mount, LMS);
    const grade = q<HTMLSelectElement>(mount, "class-setup-grade")!;
    grade.value = "7";
    grade.dispatchEvent(new Event("change", { bubbles: true }));
    const block = q<HTMLSelectElement>(mount, "class-setup-block")!;
    block.value = "B";
    block.dispatchEvent(new Event("change", { bubbles: true }));
    q<HTMLFormElement>(mount, "class-setup-form")!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await settle();
    expect(syncRoster).toHaveBeenCalledTimes(1);

    await showStudents(mount);
    expect(loader).toHaveBeenCalledTimes(1);
    next().reject(new Error("unavailable"));
    await settle();
    expect(q(mount, "roster-error")).not.toBeNull();

    rejectSync({ kind: "unknown" });
    await settle();

    expect(loader).toHaveBeenCalledTimes(1);
    expect(q(mount, "roster-error")).not.toBeNull();
    expect(q(mount, "roster-retry")).not.toBeNull();
    expect(q(mount, "roster-loading")).toBeNull();
  });

  test("Try again makes exactly one additional request and shows the roster", async () => {
    const { loader, next } = controllableLoader();
    const mount = await mountClasses({ loadRoster: () => loader });
    await failedStudents(mount, next);

    q<HTMLButtonElement>(mount, "roster-retry")!.click();
    await flush();
    expect(loader).toHaveBeenCalledTimes(2);
    // The error (and its button) is replaced by the loading state.
    expect(q(mount, "roster-retry")).toBeNull();
    expect(q(mount, "roster-loading")).not.toBeNull();

    next().resolve(rosterFor(CLASS_A));
    await settle();
    expect(names(mount)).toEqual([shown(CLASS_A, "One"), shown(CLASS_A, "Two")]);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  test("a retry already in flight is reused, never duplicated", async () => {
    const { loader, next } = controllableLoader();
    const mount = await mountClasses({ loadRoster: () => loader });
    await failedStudents(mount, next);
    q<HTMLButtonElement>(mount, "roster-retry")!.click();
    await flush();
    await showAssignments(mount);
    await showStudents(mount);
    expect(loader).toHaveBeenCalledTimes(2);
    next().resolve(rosterFor(CLASS_A));
    await settle();
    expect(names(mount)).toHaveLength(2);
  });

  test("a failed retry shows the error again without looping", async () => {
    const { loader, next } = controllableLoader();
    const mount = await mountClasses({ loadRoster: () => loader });
    await failedStudents(mount, next);
    q<HTMLButtonElement>(mount, "roster-retry")!.click();
    await flush();
    next().reject(new Error("still unavailable"));
    await settle();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(q(mount, "roster-error")).not.toBeNull();
    expect(q(mount, "roster-retry")).not.toBeNull();
  });

  test("deliberately re-entering Students retries once", async () => {
    const { loader, next } = controllableLoader();
    const mount = await mountClasses({ loadRoster: () => loader });
    await failedStudents(mount, next);
    await showAssignments(mount);
    expect(loader).toHaveBeenCalledTimes(1);
    await showStudents(mount);
    expect(loader).toHaveBeenCalledTimes(2);
    next().resolve(rosterFor(CLASS_A));
    await settle();
    expect(q(mount, "roster-error")).toBeNull();
    expect(names(mount)).toHaveLength(2);
  });

  test("switching classes after a failure loads the new class's roster", async () => {
    const { loader, pending, next } = controllableLoader();
    const mount = await mountClasses({ loadRoster: () => loader });
    await failedStudents(mount, next);
    await backToList(mount);
    await openClass(mount, CLASS_B);
    await showStudents(mount);
    expect(loader).toHaveBeenLastCalledWith({ classId: CLASS_B });
    expect(pending).toHaveLength(1);
    next().resolve(rosterFor(CLASS_B));
    await settle();
    expect(names(mount)).toEqual([shown(CLASS_B, "One"), shown(CLASS_B, "Two")]);
  });

  test("a late response from an abandoned retry never replaces the newer class's roster", async () => {
    const { loader, pending, next } = controllableLoader();
    const mount = await mountClasses({ loadRoster: () => loader });
    await failedStudents(mount, next);
    q<HTMLButtonElement>(mount, "roster-retry")!.click();
    await flush();
    await backToList(mount);
    await openClass(mount, CLASS_B);
    await showStudents(mount);

    const staleA = pending.find((p) => p.classId === CLASS_A)!;
    const freshB = pending.find((p) => p.classId === CLASS_B)!;
    freshB.resolve(rosterFor(CLASS_B));
    await settle();
    staleA.resolve(rosterFor(CLASS_A));
    await settle();
    expect(names(mount)).toEqual([shown(CLASS_B, "One"), shown(CLASS_B, "Two")]);
  });
});
