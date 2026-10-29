/**
 * @jest-environment jsdom
 *
 * Student Support Workspace (V2 P3, supportWorkspace.ts) through the real
 * shell: a teacher who owns zero classes of any status and has shared
 * students gets the simplified Student Support workspace (Student Support
 * landing, shared Student Detail, Sign out; no Curriculum, My Units, or
 * Settings), with navigation, direct URLs, and Back/Forward all refusing the
 * teaching-only surfaces. Teachers who own classes keep the full workspace.
 */
import type { Session } from "../session/types";
import type { ClassSummary } from "../classes/types";
import type { AssignmentRegistryReadiness } from "../assignments/detail/hydration";
import { installStudentSupportSeam } from "../supportAccess/session";
import type { SharedStudent, StudentSupportSeam } from "../supportAccess/types";
import { mountTeacherShell, type ShellDeps } from "./shell";

const JORDAN: SharedStudent = Object.freeze({
  grantId: "class-brown__s-jordan__u1",
  classId: "class-brown",
  classTitle: "Science 7",
  studentId: "s-jordan",
  studentDisplayName: "Jordan Smith",
  ownerDisplayName: "Mr. Brown",
  classBlock: "B",
});

const own: ClassSummary = Object.freeze({
  id: "class-own",
  title: "Own Science",
  status: "active" as const,
  grade: "7",
  block: "A",
  isLmsLinked: false,
});

type SeamControl = {
  seam: StudentSupportSeam;
  listShared: jest.Mock<Promise<ReadonlyArray<SharedStudent>>, []>;
  attemptsCalls: Array<{ classId: string; studentId: string }>;
};

const makeSeam = (
  listShared: () => Promise<ReadonlyArray<SharedStudent>> = () => Promise.resolve([JORDAN]),
): SeamControl => {
  const attemptsCalls: Array<{ classId: string; studentId: string }> = [];
  const mock = jest.fn(listShared);
  return {
    listShared: mock,
    attemptsCalls,
    seam: {
      listShared: mock,
      listForClass: () => Promise.resolve([]),
      grantMany: () => Promise.reject(new Error("unused")),
      revoke: () => Promise.resolve(),
      revokeMany: () => Promise.reject(new Error("unused")),
      listAttemptsForStudent: (input) => {
        attemptsCalls.push(input);
        return Promise.resolve({ classId: input.classId, studentId: input.studentId, attempts: [] });
      },
      revisionContent: null,
    },
  };
};

const makeShellDeps = (
  classes: ReadonlyArray<ClassSummary>,
  extra: Partial<ShellDeps> = {},
): ShellDeps => ({
  onSignOut: () => undefined,
  listClasses: () => Promise.resolve(classes),
  onLaunchPresentMode: () => undefined,
  loadExpectedAssignments: () => (input) =>
    Promise.resolve({ classId: input.classId, studentId: input.studentId, assignments: [] }),
  ...extra,
});

const teacherSession = (): Extract<Session, { kind: "activeTeacher" }> =>
  Object.freeze({ kind: "activeTeacher", uid: "u1", schoolId: "school-abc", displayName: "Support Teacher" });

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
};

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

const q = (root: ParentNode, testid: string) => root.querySelector<HTMLElement>(`[data-testid=${testid}]`);
const navKeys = (root: ParentNode): string[] =>
  Array.from(root.querySelectorAll<HTMLElement>("[data-testid^=nav-]")).map((b) =>
    b.getAttribute("data-testid")!.slice("nav-".length),
  );
const headline = (root: ParentNode): string | null => q(root, "surface-headline")?.textContent ?? null;
const activeSurface = (root: ParentNode): string | null =>
  q(root, "workspace-outlet")?.getAttribute("data-active-surface") ?? null;

async function mountShell(deps: ShellDeps): Promise<HTMLElement> {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  mountTeacherShell(teacherSession(), mount, deps);
  await settle();
  return mount;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/app/teacher");
});

afterEach(() => {
  installStudentSupportSeam(null);
  document.body.replaceChildren();
});

describe("support-only detection", () => {
  test("zero owned classes plus shared students presents the Student Support workspace", async () => {
    installStudentSupportSeam(makeSeam().seam);
    const mount = await mountShell(makeShellDeps([]));
    expect(headline(mount)).toBe("Student Support");
    expect(navKeys(mount)).toEqual(["lyfelabz", "classes"]);
    expect(q(mount, "nav-classes")!.textContent).toBe("Student Support");
    expect(q(mount, "sign-out")).not.toBeNull();
    const row = q(mount, "classes-shared-student")!;
    expect(row.textContent).toContain("Jordan Smith");
    expect(row.textContent).toContain("Mr. Brown · Science 7 · B Block");
    expect(row.textContent).not.toMatch(/@/);
    // No onboarding or class-management prompt.
    expect(q(mount, "classes-empty")).toBeNull();
    expect(q(mount, "classes-go-to-settings")).toBeNull();
  });

  test("a teacher who owns a class and has shared students keeps the full workspace", async () => {
    installStudentSupportSeam(makeSeam().seam);
    const mount = await mountShell(makeShellDeps([own]));
    expect(headline(mount)).toBe("Classes");
    expect(navKeys(mount)).toEqual(["lyfelabz", "classes", "curriculum", "settings"]);
    expect(q(mount, `class-card-${own.id}`)).not.toBeNull();
    expect(q(mount, "classes-shared-students")).not.toBeNull();
  });

  test("an archived class still counts as owned (any status)", async () => {
    installStudentSupportSeam(makeSeam().seam);
    const archived: ClassSummary = Object.freeze({ ...own, id: "class-old", status: "archived" as const });
    const mount = await mountShell(makeShellDeps([archived]));
    expect(navKeys(mount)).toContain("curriculum");
    expect(headline(mount)).toBe("Classes");
  });

  test("zero classes and zero shares keeps the existing onboarding", async () => {
    installStudentSupportSeam(makeSeam(() => Promise.resolve([])).seam);
    const mount = await mountShell(makeShellDeps([]));
    expect(headline(mount)).toBe("Classes");
    expect(q(mount, "classes-empty")).not.toBeNull();
    expect(navKeys(mount)).toEqual(["lyfelabz", "classes", "curriculum", "settings"]);
    expect(q(mount, "shared-students-error")).toBeNull();
  });

  test("while the shared read is pending, a zero-class teacher sees loading, not onboarding", async () => {
    let resolve: (v: ReadonlyArray<SharedStudent>) => void = () => undefined;
    installStudentSupportSeam(makeSeam(() => new Promise((r) => (resolve = r))).seam);
    const mount = await mountShell(makeShellDeps([]));
    expect(q(mount, "classes-status")!.textContent).toBe("Loading classes");
    expect(q(mount, "classes-empty")).toBeNull();
    resolve([JORDAN]);
    await settle();
    expect(headline(mount)).toBe("Student Support");
  });
});

describe("failed load and retry", () => {
  test("retry that returns no shared students shows the ordinary onboarding", async () => {
    let fail = true;
    installStudentSupportSeam(makeSeam(() => (fail ? Promise.reject(new Error("down")) : Promise.resolve([]))).seam);
    const mount = await mountShell(makeShellDeps([]));
    expect(q(mount, "workspace-unresolved")).not.toBeNull();
    fail = false;
    q(mount, "workspace-unresolved-retry")!.click();
    await settle();
    expect(q(mount, "classes-empty")).not.toBeNull();
    expect(navKeys(mount)).toEqual(["lyfelabz", "classes", "curriculum", "settings"]);
  });

  test("a failed shared read says so with a working Try again", async () => {
    let fail = true;
    const control = makeSeam(() => (fail ? Promise.reject(new Error("down")) : Promise.resolve([JORDAN])));
    installStudentSupportSeam(control.seam);
    const mount = await mountShell(makeShellDeps([]));
    // Unresolved workspace: neutral, neither onboarding nor "no students".
    expect(q(mount, "workspace-unresolved")!.textContent).toBe("We could not finish loading your workspace.");
    expect(headline(mount)).toBe("Welcome");
    expect(q(mount, "classes-empty")).toBeNull();
    expect(q(mount, "classes-go-to-settings")).toBeNull();
    expect(mount.textContent).not.toMatch(/No students|No classes/);
    fail = false;
    q(mount, "workspace-unresolved-retry")!.click();
    await settle();
    expect(control.listShared).toHaveBeenCalledTimes(2);
    expect(q(mount, "workspace-unresolved")).toBeNull();
    expect(headline(mount)).toBe("Student Support");
    expect(navKeys(mount)).toEqual(["lyfelabz", "classes"]);
  });

  test("a teacher with classes sees the error beneath their classes, not a blank section", async () => {
    installStudentSupportSeam(makeSeam(() => Promise.reject(new Error("down"))).seam);
    const mount = await mountShell(makeShellDeps([own]));
    expect(q(mount, `class-card-${own.id}`)).not.toBeNull();
    expect(q(mount, "shared-students-retry")).not.toBeNull();
  });

  test("a failed re-read on the Student Support landing offers Try again", async () => {
    let calls = 0;
    const control = makeSeam(() => {
      calls += 1;
      return calls === 2 ? Promise.reject(new Error("down")) : Promise.resolve([JORDAN]);
    });
    installStudentSupportSeam(control.seam);
    const mount = await mountShell(makeShellDeps([]));
    q(mount, "classes-shared-student")!.click();
    await settle();
    q(mount, "student-detail-back")!.click();
    await settle();
    expect(headline(mount)).toBe("Student Support");
    expect(q(mount, "shared-students-error")).not.toBeNull();
    q(mount, "shared-students-retry")!.click();
    await settle();
    expect(q(mount, "classes-shared-student")).not.toBeNull();
  });
});

describe("shared Student Detail", () => {
  test("keeps teacher, class, and block context without Shared by / View only", async () => {
    const control = makeSeam();
    installStudentSupportSeam(control.seam);
    const mount = await mountShell(makeShellDeps([]));
    q(mount, "classes-shared-student")!.click();
    await settle();
    expect(q(mount, "student-detail-name")!.textContent).toBe("Jordan Smith");
    const context = q(mount, "student-detail-shared-context")!.textContent!;
    expect(context).toBe("Mr. Brown · Science 7 · B Block");
    expect(context).not.toMatch(/Shared by|View only/);
    expect(q(mount, "student-detail-back")!.textContent).toBe("Back to Student Support");
    expect(control.attemptsCalls).toEqual([{ classId: "class-brown", studentId: "s-jordan" }]);
  });

  test("the final grant revoked during the visit shows an empty Student Support page", async () => {
    let calls = 0;
    installStudentSupportSeam(
      makeSeam(() => {
        calls += 1;
        return Promise.resolve(calls === 1 ? [JORDAN] : []);
      }).seam,
    );
    const mount = await mountShell(makeShellDeps([]));
    q(mount, "classes-shared-student")!.click();
    await settle();
    q(mount, "student-detail-back")!.click();
    await settle();
    expect(headline(mount)).toBe("Student Support");
    expect(q(mount, "support-status")!.textContent).toBe("No students are shared with you right now.");
    expect(q(mount, "support-empty")).not.toBeNull();
    // Still the support workspace for this page life; no onboarding.
    expect(navKeys(mount)).toEqual(["lyfelabz", "classes"]);
    expect(q(mount, "classes-empty")).toBeNull();
  });
});

describe("navigation and history guards", () => {
  test("Back/Forward between the landing and a shared student's Detail", async () => {
    installStudentSupportSeam(makeSeam().seam);
    const mount = await mountShell(makeShellDeps([]));
    q(mount, "classes-shared-student")!.click();
    await settle();
    expect(window.history.state).toEqual({
      kind: "shell-student-detail",
      surface: "classes",
      classId: "class-brown",
      studentId: "s-jordan",
    });
    await realBack();
    await settle();
    expect(q(mount, "student-detail")).toBeNull();
    expect(headline(mount)).toBe("Student Support");
    await realForward();
    await settle();
    expect(q(mount, "student-detail-name")!.textContent).toBe("Jordan Smith");
    expect(q(mount, "student-detail-back")!.textContent).toBe("Back to Student Support");
  });

  test("the in-app Back replaces the Detail entry with the landing", async () => {
    installStudentSupportSeam(makeSeam().seam);
    const mount = await mountShell(makeShellDeps([]));
    q(mount, "classes-shared-student")!.click();
    await settle();
    const length = window.history.length;
    q(mount, "student-detail-back")!.click();
    await settle();
    expect(window.history.length).toBe(length);
    expect(window.history.state).toEqual({ kind: "shell-surface", surface: "classes" });
  });

  test.each([
    ["Curriculum", { kind: "shell-surface", surface: "curriculum" }],
    ["Settings", { kind: "shell-surface", surface: "settings" }],
    ["Settings integrations", { kind: "shell-settings-integrations", surface: "settings" }],
  ] as const)("a direct URL to %s lands on Student Support", async (_label, initialState) => {
    installStudentSupportSeam(makeSeam().seam);
    const mount = await mountShell(makeShellDeps([], { initialState }));
    expect(activeSurface(mount)).toBe("classes");
    expect(headline(mount)).toBe("Student Support");
    expect(navKeys(mount)).toEqual(["lyfelabz", "classes"]);
    expect(window.history.state).toEqual({ kind: "shell-surface", surface: "classes" });
  });

  test("a teaching-only history entry is refused and replaced, without a loop", async () => {
    installStudentSupportSeam(makeSeam().seam);
    // A stale entry beneath the shell (e.g. recorded before the last class
    // was archived elsewhere and the account became support-only).
    window.history.replaceState({ kind: "shell-surface", surface: "curriculum" }, "", "/app/teacher#curriculum");
    window.history.pushState(null, "", "/app/teacher");
    const mount = await mountShell(makeShellDeps([]));
    expect(headline(mount)).toBe("Student Support");
    await realBack();
    await settle();
    expect(activeSurface(mount)).toBe("classes");
    expect(headline(mount)).toBe("Student Support");
    expect(window.history.state).toEqual({ kind: "shell-surface", surface: "classes" });
    expect(q(mount, "curriculum-surface")).toBeNull();
  });

  test("an owned-class workspace entry is refused the same way", async () => {
    installStudentSupportSeam(makeSeam().seam);
    window.history.replaceState(
      { kind: "shell-classes-workspace", surface: "classes", classId: "class-x", section: "roster" },
      "",
      "/app/teacher",
    );
    window.history.pushState(null, "", "/app/teacher");
    const mount = await mountShell(makeShellDeps([]));
    await realBack();
    await settle();
    expect(headline(mount)).toBe("Student Support");
    expect(q(mount, "classes-shared-student")).not.toBeNull();
    expect(window.history.state).toEqual({ kind: "shell-surface", surface: "classes" });
  });
});

describe("nonblocking startup", () => {
  test("Student Support renders while the teacher-owned assignment registry is still pending", async () => {
    installStudentSupportSeam(makeSeam().seam);
    const pending: AssignmentRegistryReadiness = {
      status: () => "pending",
      subscribe: () => () => undefined,
      settled: () => new Promise(() => undefined),
      retry: () => undefined,
    };
    const mount = await mountShell(
      makeShellDeps([], {
        assignmentDetail: {
          register: () => undefined,
          open: () => undefined,
          list: () => [],
          registryStatus: pending,
        },
      }),
    );
    expect(headline(mount)).toBe("Student Support");
    q(mount, "classes-shared-student")!.click();
    await settle();
    expect(q(mount, "student-detail-name")!.textContent).toBe("Jordan Smith");
  });
});

describe("existing teacher regressions", () => {
  test("a class owner keeps Curriculum, Settings, and Back/Forward between them", async () => {
    installStudentSupportSeam(makeSeam().seam);
    const mount = await mountShell(makeShellDeps([own]));
    q(mount, "nav-settings")!.click();
    await settle();
    expect(activeSurface(mount)).toBe("settings");
    q(mount, "nav-curriculum")!.click();
    await settle();
    expect(activeSurface(mount)).toBe("curriculum");
    await realBack();
    expect(activeSurface(mount)).toBe("settings");
    await realBack();
    expect(activeSurface(mount)).toBe("classes");
    await realForward();
    expect(activeSurface(mount)).toBe("settings");
  });

  test("a class owner's direct Settings URL is honored and no support probe changes it", async () => {
    installStudentSupportSeam(makeSeam().seam);
    const mount = await mountShell(
      makeShellDeps([own], { initialState: { kind: "shell-surface", surface: "settings" } }),
    );
    expect(activeSurface(mount)).toBe("settings");
    expect(navKeys(mount)).toEqual(["lyfelabz", "classes", "curriculum", "settings"]);
  });

  test("without the support seam nothing changes for a zero-class teacher", async () => {
    const mount = await mountShell(makeShellDeps([]));
    expect(q(mount, "classes-empty")).not.toBeNull();
    expect(navKeys(mount)).toEqual(["lyfelabz", "classes", "curriculum", "settings"]);
  });
});

describe("direct links resolve before any teaching-only surface paints", () => {
  const curriculum = { kind: "shell-surface", surface: "curriculum" } as const;
  const settingsUrl = { kind: "shell-surface", surface: "settings" } as const;

  test.each([
    ["Curriculum", curriculum],
    ["Settings", settingsUrl],
  ] as const)("support-only %s link never mounts the teaching surface", async (_label, initialState) => {
    const control = makeSeam();
    installStudentSupportSeam(control.seam);
    const listClasses = jest.fn(() => Promise.resolve([] as ReadonlyArray<ClassSummary>));
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const seen: Array<string | null> = [];
    const observer = new MutationObserver(() => seen.push(activeSurface(mount)));
    observer.observe(mount, { childList: true, subtree: true });
    mountTeacherShell(teacherSession(), mount, makeShellDeps([], { initialState, listClasses }));
    // Synchronously: neutral status, no surface, no navigation.
    expect(q(mount, "shell-workspace-resolving")!.textContent).toBe("Loading your workspace");
    expect(activeSurface(mount)).toBeNull();
    expect(navKeys(mount)).toEqual([]);
    await settle();
    observer.disconnect();
    expect(seen.filter((v) => v !== null && v !== "classes")).toEqual([]);
    expect(activeSurface(mount)).toBe("classes");
    expect(headline(mount)).toBe("Student Support");
    expect(navKeys(mount)).toEqual(["lyfelabz", "classes"]);
    expect(window.history.state).toEqual({ kind: "shell-surface", surface: "classes" });
    // The resolution reads are handed to Classes, not repeated.
    expect(listClasses).toHaveBeenCalledTimes(1);
    expect(control.listShared).toHaveBeenCalledTimes(1);
  });

  test("a class owner's Curriculum link mounts once the class list arrives, without the shared read", async () => {
    const control = makeSeam();
    installStudentSupportSeam(control.seam);
    const listClasses = jest.fn(() => Promise.resolve([own] as ReadonlyArray<ClassSummary>));
    const mount = await mountShell(makeShellDeps([own], { initialState: curriculum, listClasses }));
    expect(activeSurface(mount)).toBe("curriculum");
    expect(navKeys(mount)).toEqual(["lyfelabz", "classes", "curriculum", "settings"]);
    expect(window.history.state).toEqual(curriculum);
    expect(control.listShared).not.toHaveBeenCalled();
  });

  test("zero classes and zero shares honors the Settings link", async () => {
    installStudentSupportSeam(makeSeam(() => Promise.resolve([])).seam);
    const mount = await mountShell(makeShellDeps([], { initialState: settingsUrl }));
    expect(activeSurface(mount)).toBe("settings");
    expect(navKeys(mount)).toEqual(["lyfelabz", "classes", "curriculum", "settings"]);
  });

  test("a failed shared read on a direct link shows the neutral retry, then resolves", async () => {
    let fail = true;
    const control = makeSeam(() => (fail ? Promise.reject(new Error("down")) : Promise.resolve([JORDAN])));
    installStudentSupportSeam(control.seam);
    const mount = await mountShell(makeShellDeps([], { initialState: curriculum }));
    expect(activeSurface(mount)).toBe("classes");
    expect(q(mount, "workspace-unresolved")).not.toBeNull();
    fail = false;
    q(mount, "workspace-unresolved-retry")!.click();
    await settle();
    expect(headline(mount)).toBe("Student Support");
    expect(navKeys(mount)).toEqual(["lyfelabz", "classes"]);
  });

  test("a failed class list mounts the requested surface (its own error path)", async () => {
    installStudentSupportSeam(makeSeam().seam);
    const mount = await mountShell(
      makeShellDeps([], { initialState: settingsUrl, listClasses: () => Promise.reject(new Error("down")) }),
    );
    expect(activeSurface(mount)).toBe("settings");
  });

  test("Back/Forward after resolving a direct link", async () => {
    installStudentSupportSeam(makeSeam().seam);
    const mount = await mountShell(makeShellDeps([], { initialState: curriculum }));
    q(mount, "classes-shared-student")!.click();
    await settle();
    await realBack();
    await settle();
    expect(headline(mount)).toBe("Student Support");
    await realForward();
    await settle();
    expect(q(mount, "student-detail-name")!.textContent).toBe("Jordan Smith");
  });

  test("a direct link resolves while the assignment registry is still pending", async () => {
    installStudentSupportSeam(makeSeam().seam);
    const pending: AssignmentRegistryReadiness = {
      status: () => "pending",
      subscribe: () => () => undefined,
      settled: () => new Promise(() => undefined),
      retry: () => undefined,
    };
    const mount = await mountShell(
      makeShellDeps([], {
        initialState: curriculum,
        assignmentDetail: { register: () => undefined, open: () => undefined, list: () => [], registryStatus: pending },
      }),
    );
    expect(headline(mount)).toBe("Student Support");
    expect(q(mount, "classes-shared-student")).not.toBeNull();
  });

  test("ordinary startup on Classes is not gated", () => {
    installStudentSupportSeam(makeSeam().seam);
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    mountTeacherShell(teacherSession(), mount, makeShellDeps([own]));
    expect(q(mount, "shell-workspace-resolving")).toBeNull();
    expect(activeSurface(mount)).toBe("classes");
    expect(navKeys(mount)).toEqual(["lyfelabz", "classes", "curriculum", "settings"]);
  });
});

describe("unresolved workspace hides all navigation", () => {
  const failing = (): { control: SeamControl; succeed: (v: ReadonlyArray<SharedStudent>) => void } => {
    let result: ReadonlyArray<SharedStudent> | null = null;
    const control = makeSeam(() => (result === null ? Promise.reject(new Error("down")) : Promise.resolve(result)));
    return { control, succeed: (v) => (result = v) };
  };

  test("no sidebar while unresolved; Sign out, message, and Try again remain", async () => {
    const { control } = failing();
    installStudentSupportSeam(control.seam);
    const mount = await mountShell(makeShellDeps([]));
    expect(q(mount, "workspace-unresolved")).not.toBeNull();
    expect(navKeys(mount)).toEqual([]);
    expect(q(mount, "shell-nav")).toBeNull();
    expect(q(mount, "sign-out")).not.toBeNull();
    expect(q(mount, "workspace-unresolved-retry")).not.toBeNull();
  });

  test("the sidebar stays hidden while a retry is in flight", async () => {
    let release: (v: ReadonlyArray<SharedStudent>) => void = () => undefined;
    let calls = 0;
    installStudentSupportSeam(
      makeSeam(() => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error("down")) : new Promise((r) => (release = r));
      }).seam,
    );
    const mount = await mountShell(makeShellDeps([]));
    q(mount, "workspace-unresolved-retry")!.click();
    await settle();
    expect(navKeys(mount)).toEqual([]);
    release([]);
    await settle();
    expect(q(mount, "classes-empty")).not.toBeNull();
    expect(navKeys(mount)).toEqual(["lyfelabz", "classes", "curriculum", "settings"]);
  });

  test("retry with shared students shows Student Support navigation", async () => {
    const { control, succeed } = failing();
    installStudentSupportSeam(control.seam);
    const mount = await mountShell(makeShellDeps([]));
    succeed([JORDAN]);
    q(mount, "workspace-unresolved-retry")!.click();
    await settle();
    expect(navKeys(mount)).toEqual(["lyfelabz", "classes"]);
    expect(headline(mount)).toBe("Student Support");
  });

  test("retry with no shared students shows the normal onboarding and navigation", async () => {
    const { control, succeed } = failing();
    installStudentSupportSeam(control.seam);
    const mount = await mountShell(makeShellDeps([]));
    succeed([]);
    q(mount, "workspace-unresolved-retry")!.click();
    await settle();
    expect(q(mount, "classes-empty")).not.toBeNull();
    expect(navKeys(mount)).toEqual(["lyfelabz", "classes", "curriculum", "settings"]);
  });

  test("a class owner whose shared read fails keeps the full Teacher Workspace", async () => {
    installStudentSupportSeam(failing().control.seam);
    const mount = await mountShell(makeShellDeps([own]));
    expect(navKeys(mount)).toEqual(["lyfelabz", "classes", "curriculum", "settings"]);
    expect(q(mount, "workspace-unresolved")).toBeNull();
  });

  test("a direct Settings link that resolves unresolved shows no sidebar", async () => {
    installStudentSupportSeam(failing().control.seam);
    const mount = await mountShell(
      makeShellDeps([], { initialState: { kind: "shell-surface", surface: "settings" } }),
    );
    expect(activeSurface(mount)).toBe("classes");
    expect(q(mount, "workspace-unresolved")).not.toBeNull();
    expect(navKeys(mount)).toEqual([]);
  });

  test("Back to a stale teaching entry while unresolved stays on the retry page", async () => {
    installStudentSupportSeam(failing().control.seam);
    window.history.replaceState({ kind: "shell-surface", surface: "settings" }, "", "/app/teacher#settings");
    window.history.pushState(null, "", "/app/teacher");
    const mount = await mountShell(makeShellDeps([]));
    await realBack();
    await settle();
    expect(activeSurface(mount)).toBe("classes");
    expect(q(mount, "workspace-unresolved")).not.toBeNull();
    expect(navKeys(mount)).toEqual([]);
    expect(window.history.state).toEqual({ kind: "shell-surface", surface: "classes" });
  });
});
