/**
 * @jest-environment jsdom
 *
 * Sprint 28.6C: end-to-end (real shell) coverage of the class-centered
 * assignment path. These tests drive the actual Teacher Workspace shell with a
 * faithful assignment-detail seam (the same shape the entry point wires): it
 * captures the shell's outlet controller and, on open(id, options), renders a
 * Detail stand-in into that outlet and wires a Back control to options.onBack -
 * exactly as index.ts does with the real Assignment Detail surface.
 *
 * Proven here:
 *  - Assignment Detail opens from Classes -> Class -> Assignments into the shell
 *    outlet, with the shell chrome intact and Classes still the active context.
 *  - The Back control reads "Back to class" and returns to the same class's
 *    Assignments section (not Curriculum).
 *  - Migration safety: default landing, nav order, and Present Mode are
 *    unchanged; the Curriculum-origin Detail path (no options) is unaffected.
 */
import { mountTeacherShell, type ShellDeps } from "./shell";
import { NAVIGATION_ITEMS } from "./navigation";
import type {
  CurriculumAssignmentDetailSeam,
  TeacherShellOutletController,
  AssignmentDetailOpenOptions,
} from "./surfaces/curriculum";
import type { AssignmentDetailMetadata } from "../assignments/detail/types";
import type {
  AssignmentSummary,
  AssignmentSummaryCallable,
} from "../assignments/summary/types";
import type { Session } from "../session/types";
import type { ClassSummary } from "../classes/types";
import { _resetActiveAssignmentsSessionStateForTest } from "./surfaces/shared/activeAssignments";

const teacher = (): Extract<Session, { kind: "activeTeacher" }> =>
  Object.freeze({
    kind: "activeTeacher",
    uid: "u1",
    schoolId: "school-abc",
    displayName: "Ada Lovelace",
  }) as Extract<Session, { kind: "activeTeacher" }>;

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  div.id = "app-root";
  document.body.appendChild(div);
  return div;
};

const twoClasses: ReadonlyArray<ClassSummary> = Object.freeze([
  Object.freeze({
    id: "c1",
    title: "6A Life Science",
    status: "active" as const,
    grade: "6",
    block: "A",
  }),
  Object.freeze({
    id: "c2",
    title: "7B Systems",
    status: "active" as const,
    grade: "7",
    block: "B",
  }),
]);

const registry: ReadonlyArray<AssignmentDetailMetadata> = Object.freeze([
  Object.freeze({
    assignmentId: "a1",
    title: "Earth's Layers",
    status: "published" as const,
    className: "6A Life Science",
    classId: "c1",
    lessonSlug: "earths-layers",
    publishedAt: 3000,
  }),
  Object.freeze({
    assignmentId: "a3",
    title: "Ecosystems",
    status: "published" as const,
    className: "7B Systems",
    classId: "c2",
    lessonSlug: "ecosystems",
    publishedAt: 1500,
  }),
]);

const summaryCallable: AssignmentSummaryCallable = async ({ assignmentId }) => {
  const s: AssignmentSummary = {
    assignmentId,
    classId: "c1",
    totalStudents: 22,
    completedStudents: 18,
    inProgressStudents: 2,
    notStartedStudents: 2,
    completionPercentage: 82,
    averagePercentage: 74,
    highestPercentage: 100,
    lowestPercentage: 40,
    perfectScoreStudents: 3,
  };
  return s;
};

// A faithful seam: it holds the outlet controller the shell registers and, on
// open, renders a Detail stand-in into the outlet with a Back control wired to
// options.onBack - mirroring the entry-point opener.
const makeSeam = (): {
  seam: CurriculumAssignmentDetailSeam;
  lastOptions: () => AssignmentDetailOpenOptions | undefined;
} => {
  let controller: TeacherShellOutletController | null = null;
  let captured: AssignmentDetailOpenOptions | undefined;
  const seam: CurriculumAssignmentDetailSeam = {
    register: () => undefined,
    list: () => registry,
    open: (id, options) => {
      captured = options;
      const render = (host: HTMLElement): void => {
        const el = host.ownerDocument.createElement("section");
        el.setAttribute("data-testid", "detail-stub");
        el.setAttribute("data-assignment-id", id);
        const back = host.ownerDocument.createElement("button");
        back.setAttribute("data-testid", "detail-back");
        back.textContent = options?.backLabel ?? "Back to Curriculum";
        back.addEventListener("click", () => options?.onBack?.());
        el.appendChild(back);
        host.appendChild(el);
      };
      controller?.show(render);
    },
    setOutletController: (c) => {
      controller = c;
    },
  };
  return { seam, lastOptions: () => captured };
};

const makeDeps = (
  seam: CurriculumAssignmentDetailSeam,
  overrides: Partial<ShellDeps> = {},
): ShellDeps => ({
  onSignOut: () => undefined,
  listClasses: async () => twoClasses,
  onLaunchPresentMode: () => undefined,
  assignmentDetail: seam,
  assignmentSummary: summaryCallable,
  ...overrides,
});

const click = (mount: HTMLElement, testid: string): void => {
  mount.querySelector<HTMLButtonElement>(`[data-testid=${testid}]`)!.click();
};

// Navigate: Classes -> class c1 -> Assignments tab. Returns after flushing.
const reachClassAssignments = async (mount: HTMLElement): Promise<void> => {
  click(mount, "nav-classes");
  await flush();
  click(mount, "class-card-c1");
  click(mount, "class-nav-assignments");
  await flush();
};

beforeEach(() => {
  _resetActiveAssignmentsSessionStateForTest();
});

describe("Sprint 28.6C - Assignment Detail from Classes -> Class -> Assignments", () => {
  test("opening an assignment renders Detail in the shell outlet with chrome intact and Classes active", async () => {
    const mount = mkMount();
    const { seam, lastOptions } = makeSeam();
    mountTeacherShell(teacher(), mount, makeDeps(seam));
    await reachClassAssignments(mount);

    // Only c1's assignment is shown; c2's never appears.
    expect(
      mount.querySelector("[data-testid=active-assignment-card-a1]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=active-assignment-card-a3]"),
    ).toBeNull();

    click(mount, "active-assignment-open-a1");

    // Detail rendered into the shell outlet; chrome preserved.
    const detail = mount.querySelector("[data-testid=detail-stub]");
    expect(detail).not.toBeNull();
    expect(detail?.getAttribute("data-assignment-id")).toBe("a1");
    expect(mount.querySelector("[data-testid=shell-header]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=shell-nav]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=shell-footer]")).not.toBeNull();

    // Classes stays the active navigation context (not Curriculum).
    expect(
      mount.querySelector("[data-testid=nav-classes]")?.getAttribute("aria-current"),
    ).toBe("page");
    expect(
      mount.querySelector("[data-testid=nav-curriculum]")?.getAttribute("aria-current"),
    ).toBeNull();

    // The Back control names the class context.
    expect(lastOptions()?.backLabel).toBe("Back to class");
    expect(mount.querySelector("[data-testid=detail-back]")?.textContent).toBe(
      "Back to class",
    );
  });

  test("returning from Detail re-lands on the same class's Assignments section", async () => {
    const mount = mkMount();
    const { seam } = makeSeam();
    mountTeacherShell(teacher(), mount, makeDeps(seam));
    await reachClassAssignments(mount);
    click(mount, "active-assignment-open-a1");
    expect(mount.querySelector("[data-testid=detail-stub]")).not.toBeNull();

    // Back returns to the class-centered context, not Curriculum.
    click(mount, "detail-back");
    await flush();

    expect(mount.querySelector("[data-testid=detail-stub]")).toBeNull();
    const workspace = mount.querySelector("[data-testid=class-workspace]");
    expect(workspace?.getAttribute("data-class-id")).toBe("c1");
    expect(workspace?.getAttribute("data-class-tab")).toBe("assignments");
    // We are not stranded in Curriculum.
    expect(
      mount.querySelector("[data-testid=nav-classes]")?.getAttribute("aria-current"),
    ).toBe("page");
  });

  test("the Curriculum-origin Detail path is unaffected (default Back label, no options)", () => {
    const mount = mkMount();
    const { seam } = makeSeam();
    mountTeacherShell(teacher(), mount, makeDeps(seam));
    // Simulate a Curriculum-origin open exactly as index.ts would: no options.
    seam.open("a1");
    const back = mount.querySelector("[data-testid=detail-back]");
    expect(back).not.toBeNull();
    expect(back?.textContent).toBe("Back to Curriculum");
  });
});

describe("Sprint 28.6D - teacher information-architecture transition", () => {
  test("default teacher landing surface is Classes", () => {
    const mount = mkMount();
    const { seam } = makeSeam();
    mountTeacherShell(teacher(), mount, makeDeps(seam));
    expect(
      mount.querySelector("[data-testid=workspace-outlet]")?.getAttribute("data-active-surface"),
    ).toBe("classes");
    expect(
      mount.querySelector("[data-testid=nav-classes]")?.getAttribute("aria-current"),
    ).toBe("page");
  });

  test("primary navigation order is Classes, Curriculum, Settings with Present Mode removed", () => {
    const order = NAVIGATION_ITEMS.map((i) => i.key);
    expect(order).toEqual([
      "lyfelabz",
      "classes",
      "curriculum",
      "settings",
    ]);
    const mount = mkMount();
    const { seam } = makeSeam();
    mountTeacherShell(teacher(), mount, makeDeps(seam));
    expect(mount.querySelector("[data-testid=nav-present-mode]")).toBeNull();
    expect((mount.textContent ?? "")).not.toContain("Present Mode");
  });
});
