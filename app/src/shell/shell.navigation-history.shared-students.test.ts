/**
 * @jest-environment jsdom
 *
 * Browser Back/Forward for a support educator's shared student (PDR-032).
 * Opening a student from "Shared students" reuses the existing Student
 * Detail history entry; browser Back returns to the Classes list with the
 * Shared students section, Forward re-opens the same read-only Student
 * Detail, and the in-app "Back to Shared students" replaces the entry instead of
 * pushing. Exercised through the real shell with real history.back() /
 * forward(), like shell.navigation-history.test.ts.
 */
import type { Session } from "../session/types";
import type { ClassSummary } from "../classes/types";
import { installStudentSupportSeam } from "../supportAccess/session";
import type { SharedStudent, StudentSupportSeam } from "../supportAccess/types";
import { mountTeacherShell, type ShellDeps } from "./shell";

const SHARED: SharedStudent = Object.freeze({
  grantId: "class-shared__s-ada__u1",
  classId: "class-shared",
  classTitle: "Science 7B",
  studentId: "s-ada",
  studentDisplayName: "Ada Student",
  ownerDisplayName: "Ms. Owner",
  classBlock: null,
});

const seam: StudentSupportSeam = {
  listShared: () => Promise.resolve([SHARED]),
  listForClass: () => Promise.resolve([]),
  grantMany: () => Promise.reject(new Error("unused")),
  revoke: () => Promise.resolve(),
  revokeMany: () => Promise.reject(new Error("unused")),
  listAttemptsForStudent: (input) =>
    Promise.resolve({ classId: input.classId, studentId: input.studentId, attempts: [] }),
  revisionContent: null,
};

const own: ClassSummary = Object.freeze({
  id: "class-own",
  title: "Own Science",
  status: "active" as const,
  grade: "7",
  block: "A",
  isLmsLinked: false,
});

const makeShellDeps = (): ShellDeps => ({
  onSignOut: () => undefined,
  listClasses: () => Promise.resolve([own]),
  onLaunchPresentMode: () => undefined,
  loadExpectedAssignments: () => (input) =>
    Promise.resolve({ classId: input.classId, studentId: input.studentId, assignments: [] }),
});

const teacherSession = (): Extract<Session, { kind: "activeTeacher" }> =>
  Object.freeze({ kind: "activeTeacher", uid: "u1", schoolId: "school-abc", displayName: "Support Teacher" });

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
};

// Same traversal helper as shell.navigation-history.test.ts: awaited by the
// real `popstate`, then a short render allowance.
const traverse = async (go: () => void): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("popstate", onPop);
      reject(new Error("history traversal did not fire popstate"));
    }, 5000);
    const onPop = (): void => {
      clearTimeout(timer);
      resolve();
    };
    window.addEventListener("popstate", onPop, { once: true });
    go();
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
};
const realBack = (): Promise<void> => traverse(() => window.history.back());
const realForward = (): Promise<void> => traverse(() => window.history.forward());

const q = (mount: HTMLElement, sel: string) => mount.querySelector<HTMLElement>(sel);

async function mountWithSharedList(extra: Partial<ShellDeps> = {}): Promise<HTMLElement> {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  mountTeacherShell(teacherSession(), mount, { ...makeShellDeps(), ...extra });
  await settle();
  expect(q(mount, "[data-testid=classes-shared-students]")).not.toBeNull();
  return mount;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/app/teacher");
  installStudentSupportSeam(seam);
});

afterEach(() => {
  installStudentSupportSeam(null);
  document.body.replaceChildren();
});

describe("Browser Back/Forward: Shared students -> read-only Student Detail", () => {
  test("opening a shared student pushes the existing Student Detail entry", async () => {
    const mount = await mountWithSharedList();
    const before = window.history.length;
    q(mount, "[data-testid=classes-shared-student]")!.click();
    await settle();
    expect(q(mount, "[data-testid=student-detail-shared-context]")).not.toBeNull();
    expect(window.history.length).toBe(before + 1);
    expect(window.history.state).toEqual({
      kind: "shell-student-detail",
      surface: "classes",
      classId: "class-shared",
      studentId: "s-ada",
    });
  });

  test("browser Back returns to Shared students and Forward re-opens the same student", async () => {
    const listAttemptsForStudent = jest.fn(seam.listAttemptsForStudent);
    installStudentSupportSeam({ ...seam, listAttemptsForStudent });
    const loadRoster = jest.fn();
    const mount = await mountWithSharedList({ loadRoster: () => loadRoster });
    const listDestination = window.history.state;
    const listUrl = window.location.href;
    q(mount, "[data-testid=classes-shared-student]")!.click();
    await settle();
    const studentDestination = window.history.state;
    const studentUrl = window.location.href;
    const length = window.history.length;
    const target = { classId: SHARED.classId, studentId: SHARED.studentId };
    expect(listAttemptsForStudent.mock.calls).toEqual([[target]]);

    await realBack();
    await settle();
    expect(window.history.state).toEqual(listDestination);
    expect(window.location.href).toBe(listUrl);
    expect(window.history.length).toBe(length);
    expect(q(mount, "[data-testid=student-detail]")).toBeNull();
    expect(q(mount, "[data-testid=classes-shared-students]")).not.toBeNull();
    expect(q(mount, `[data-testid=class-card-${own.id}]`)).not.toBeNull();
    expect(listAttemptsForStudent.mock.calls).toEqual([[target]]);
    expect(loadRoster).not.toHaveBeenCalled();

    await realForward();
    await settle();
    expect(window.history.state).toEqual(studentDestination);
    expect(window.location.href).toBe(studentUrl);
    expect(window.history.length).toBe(length);
    expect(q(mount, "[data-testid=student-detail-name]")!.textContent).toBe("Ada Student");
    expect(q(mount, "[data-testid=student-detail-shared-context]")).not.toBeNull();
    expect(q(mount, "[data-testid=student-detail-grade-update-undo-a1]")).toBeNull();
    expect(listAttemptsForStudent.mock.calls).toEqual([[target], [target]]);
    expect(loadRoster).not.toHaveBeenCalled();
  });

  test.each(["authorized", "support-only", "revoked", "superseded", "gated My Units", "session changed"] as const)(
    "startup restores the shared student selected during preflight only if still authorized and current (%s)",
    async (outcome) => {
      const unitsDestination = { kind: "shell-units-archived", surface: "units" };
      if (outcome === "gated My Units") {
        window.history.replaceState(unitsDestination, "", "/app/teacher#units/archived");
        window.history.pushState(null, "", "/app/teacher");
      }
      const unitsUrl = new URL("/app/teacher#units/archived", window.location.href).href;
      const previous = await mountWithSharedList();
      const listDestination = window.history.state;
      const listUrl = window.location.href;
      q(previous, "[data-testid=classes-shared-student]")!.click();
      await settle();
      expect(q(previous, "[data-testid=student-detail-shared-context]")).not.toBeNull();
      const destination = window.history.state;
      const url = window.location.href;
      q(previous, "[data-testid=nav-curriculum]")!.click();
      const length = window.history.length;
      previous.remove();

      let releaseClasses!: () => void;
      let releaseShared!: (students: readonly SharedStudent[]) => void;
      const listClasses = jest.fn<Promise<readonly ClassSummary[]>, [string]>(() => new Promise((resolve) => {
        releaseClasses = () => resolve(outcome === "support-only" ? [] : [own]);
      }));
      const listShared = jest.fn(() => new Promise<readonly SharedStudent[]>((resolve) => {
        releaseShared = resolve;
      }));
      const listAttemptsForStudent = jest.fn(seam.listAttemptsForStudent);
      installStudentSupportSeam({ ...seam, listShared, listAttemptsForStudent });
      const loadRoster = jest.fn();
      const loadExpectedAssignments = jest.fn(async ({ classId, studentId }: { classId: string; studentId: string }) =>
        ({ classId, studentId, assignments: [] }));
      const mount = document.createElement("div");
      document.body.appendChild(mount);
      mountTeacherShell(teacherSession(), mount, {
        ...makeShellDeps(), listClasses, loadRoster: () => loadRoster,
        loadExpectedAssignments: () => loadExpectedAssignments,
        initialState: { kind: "shell-surface", surface: "curriculum" },
      });

      expect(q(mount, "[data-testid=shell-workspace-resolving]")).not.toBeNull();
      await realBack();
      expect(window.history.state).toEqual(destination);
      expect(window.location.href).toBe(url);
      expect(listShared).not.toHaveBeenCalled();
      releaseClasses();
      await settle();
      expect(q(mount, "[data-testid=student-detail-name]")).toBeNull();
      expect(listAttemptsForStudent).not.toHaveBeenCalled();
      expect(loadExpectedAssignments).not.toHaveBeenCalled();
      expect(listShared).toHaveBeenCalledTimes(1);
      if (outcome === "superseded") await realBack();
      let expectedState = outcome === "superseded" ? listDestination : destination;
      let expectedUrl = outcome === "superseded" ? listUrl : url;
      if (outcome === "gated My Units") {
        await traverse(() => window.history.go(-2));
        expectedState = unitsDestination;
        expectedUrl = unitsUrl;
        expect(window.history.state).toEqual(expectedState);
        expect(window.location.href).toBe(expectedUrl);
        expect(q(mount, "[data-testid=student-detail]")).toBeNull();
      }
      if (outcome === "session changed") {
        installStudentSupportSeam(null);
        const replacement = document.createElement("div");
        document.body.replaceChildren(replacement);
        mountTeacherShell({ ...teacherSession(), uid: "u2" }, replacement, {
          ...makeShellDeps(), listClasses: async () => [],
        });
        expectedState = window.history.state;
        expectedUrl = window.location.href;
      }
      releaseShared(outcome === "revoked" ? [] : [SHARED]);
      await settle();

      expect(window.history.state).toEqual(expectedState);
      expect(window.location.href).toBe(expectedUrl);
      expect(window.history.length).toBe(length);
      expect(listClasses.mock.calls).toEqual([["u1"]]);
      expect(listShared).toHaveBeenCalledTimes(1);
      expect(loadRoster).not.toHaveBeenCalled();
      expect(q(mount, '[data-active-surface="units"]')).toBeNull();
      if (outcome === "authorized" || outcome === "support-only") {
        expect(q(mount, "[data-testid=student-detail-name]")?.textContent).toBe(SHARED.studentDisplayName);
        expect(q(mount, "[data-testid=student-detail-shared-context]")).not.toBeNull();
        expect(q(mount, "[data-testid=student-detail-grade-update-undo-a1]")).toBeNull();
        expect(q(mount, "[data-testid=student-detail-next]")).toBeNull();
        const target = { classId: SHARED.classId, studentId: SHARED.studentId };
        expect(listAttemptsForStudent.mock.calls).toEqual([[target]]);
        expect(loadExpectedAssignments.mock.calls).toEqual([[target]]);
      } else {
        expect({
          detail: q(mount, "[data-testid=student-detail-name]")?.textContent ?? null,
          activeDetail: q(document.body, "[data-testid=student-detail-name]")?.textContent ?? null,
          attemptsCalls: listAttemptsForStudent.mock.calls,
          assignmentCalls: loadExpectedAssignments.mock.calls,
        }).toEqual({ detail: null, activeDetail: null, attemptsCalls: [], assignmentCalls: [] });
      }
    },
  );

  test("an assignment-origin entry cannot restore a shared student as an owned student", async () => {
    const checkHistoryOrigin = jest.fn(async () => true);
    const loadRoster = jest.fn(async () => ({ classId: SHARED.classId, students: [SHARED] }));
    const mount = await mountWithSharedList({
      assignmentDetail: { register: () => undefined, open: () => undefined, checkHistoryOrigin },
      loadRoster: () => loadRoster,
    });
    window.dispatchEvent(new PopStateEvent("popstate", {
      state: {
        kind: "shell-student-detail",
        surface: "classes",
        classId: SHARED.classId,
        studentId: SHARED.studentId,
        originAssignmentId: "unowned-assignment",
      },
    }));
    await settle();
    expect(q(mount, "[data-testid=student-detail]")).toBeNull();
    expect(q(mount, "[data-testid=classes-shared-student]")).not.toBeNull();
    expect(checkHistoryOrigin).not.toHaveBeenCalled();
    expect(loadRoster).not.toHaveBeenCalled();
  });

  test("the in-app Back to Shared students replaces the entry rather than pushing", async () => {
    const mount = await mountWithSharedList();
    q(mount, "[data-testid=classes-shared-student]")!.click();
    await settle();
    const length = window.history.length;
    q(mount, "[data-testid=student-detail-back]")!.click();
    await settle();
    expect(q(mount, "[data-testid=classes-shared-students]")).not.toBeNull();
    expect(window.history.length).toBe(length);
    expect(window.history.state).toEqual({ kind: "shell-surface", surface: "classes" });
  });
});
