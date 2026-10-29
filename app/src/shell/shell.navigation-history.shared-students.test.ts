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

async function mountWithSharedList(): Promise<HTMLElement> {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  mountTeacherShell(teacherSession(), mount, makeShellDeps());
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
    const mount = await mountWithSharedList();
    q(mount, "[data-testid=classes-shared-student]")!.click();
    await settle();

    await realBack();
    await settle();
    expect(q(mount, "[data-testid=student-detail]")).toBeNull();
    expect(q(mount, "[data-testid=classes-shared-students]")).not.toBeNull();
    expect(q(mount, `[data-testid=class-card-${own.id}]`)).not.toBeNull();

    await realForward();
    await settle();
    expect(q(mount, "[data-testid=student-detail-name]")!.textContent).toBe("Ada Student");
    expect(q(mount, "[data-testid=student-detail-shared-context]")).not.toBeNull();
    expect(q(mount, "[data-testid=student-detail-grade-update-undo-a1]")).toBeNull();
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
