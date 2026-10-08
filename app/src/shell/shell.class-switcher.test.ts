/**
 * @jest-environment jsdom
 *
 * Same-assignment class selector, end to end through the REAL shell, the REAL
 * Classes surface, and the REAL Assignment Detail renderer (wired the way
 * index.ts wires it: registry-backed metadata reader, outlet controller,
 * Classes-supplied open options). Covers:
 *   - Detail A -> switch -> Detail B, then browser Back/Forward between the
 *     two Details (a popstate path where the Classes surface is not live);
 *   - "Back to class" from the switched Detail landing on B's Assignments;
 *   - the destination loading its own summary, roster, attempts, and
 *     Question Results;
 *   - eligibility (order, exclusions) and the static label for a lesson
 *     assigned to one class only;
 *   - more than one published occurrence resolved through Current, and the
 *     Assignments-list fallback when Current is not safely resolvable.
 */
import type { Session } from "../session/types";
import type { ClassSummary } from "../classes/types";
import type { AssignmentDetailMetadata } from "../assignments/detail/types";
import type { CurrentForFamily } from "../assignments/detail/grade-sync-context";
import type {
  AttemptGetForTeacherCallable,
  AttemptsListForClassCallable,
  CompletedAttemptSummary,
} from "../assignments/detail/attempts-wire";
import type { AssignmentRecipientListCallable } from "../assignments/detail/roster-wire";
import type {
  AssignmentSummary,
  AssignmentSummaryCallable,
} from "../assignments/summary/types";
import type {
  AssignmentDetailOpenOptions,
  TeacherShellOutletController,
} from "./surfaces/curriculum";
import { _resetCurriculumSessionStateForTest } from "./surfaces/curriculum";
import { renderAssignmentDetail } from "../assignments/detail/detail";
import { createAssignmentDetailRegistry } from "../assignments/detail/registry";
import { createAssignmentDetailMetadataReader } from "../assignments/detail/wire";
import { mountTeacherShell, type ShellDeps } from "./shell";

const freeze = <T>(v: T): T => Object.freeze(v) as T;
const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await flush();
};
const realBack = async (): Promise<void> => {
  window.history.back();
  await new Promise((r) => setTimeout(r, 100));
  await settle();
};
const realForward = async (): Promise<void> => {
  window.history.forward();
  await new Promise((r) => setTimeout(r, 100));
  await settle();
};

const teacher = (): Extract<Session, { kind: "activeTeacher" }> =>
  freeze({ kind: "activeTeacher", uid: "u1", schoolId: "school-abc", displayName: "Ada Lovelace" });

const SLUG = "carbon-cycle";

const active = (id: string, title: string): ClassSummary =>
  freeze({ id, title, grade: "7", block: "A", status: "active", isLmsLinked: false }) as ClassSummary;

// The teacher's saved order: B first, then the source A, then C.
const CLASSES: ReadonlyArray<ClassSummary> = freeze([
  active("c-b", "Period B"),
  active("c-a", "SYT Acceptance"),
  active("c-c", "Period C"),
  active("c-closed", "Closed Only"),
  active("c-draft", "Draft Only"),
  active("c-other", "Other Lesson"),
  freeze({ id: "c-arch", title: "Archived", grade: "7", block: "A", status: "archived" }) as ClassSummary,
  freeze({ id: "c-setup", title: "Needs Setup", status: "needsSetup" }) as ClassSummary,
]);

const meta = (
  assignmentId: string,
  classId: string,
  className: string,
  overrides: Partial<AssignmentDetailMetadata> = {},
): AssignmentDetailMetadata =>
  freeze({
    assignmentId,
    title: "The Carbon Cycle",
    status: "published" as const,
    className,
    classId,
    lessonSlug: SLUG,
    publishedAt: 1000,
    ...overrides,
  });

const REGISTRY: ReadonlyArray<AssignmentDetailMetadata> = [
  meta("a-a", "c-a", "SYT Acceptance"),
  meta("a-b", "c-b", "Period B", { title: "Carbon Cycle (Period B title)" }),
  // Two published occurrences (e.g. the in-session registry after a
  // same-lesson reassignment): Current must be resolved on selection.
  meta("a-c-old", "c-c", "Period C", { publishedAt: 500 }),
  meta("a-c-new", "c-c", "Period C", { publishedAt: 2000 }),
  meta("a-closed", "c-closed", "Closed Only", { status: "closed" }),
  meta("a-draft", "c-draft", "Draft Only", { status: "draft" }),
  meta("a-other", "c-other", "Other Lesson", { lessonSlug: "water-cycle" }),
  meta("a-arch", "c-arch", "Archived"),
  meta("a-setup", "c-setup", "Needs Setup"),
  // Not one of this teacher's classes.
  meta("a-foreign", "c-foreign", "Someone Else"),
];

type Calls = {
  summary: string[];
  recipients: string[];
  attemptsList: string[];
  attemptGet: string[];
  resolveCurrent: Array<{ classId: string; lessonSlug: string }>;
};

const attempt = (assignmentId: string, studentId: string): CompletedAttemptSummary =>
  freeze({
    attemptId: `att-${assignmentId}-${studentId}`,
    studentId,
    studentDisplayName: `Student ${studentId}`,
    assignmentId,
    attemptNumber: 1,
    score: 8,
    maxScore: 10,
    percentage: 80,
    submittedAt: 1000,
  });

function makeHarness(current: CurrentForFamily | Error) {
  const calls: Calls = { summary: [], recipients: [], attemptsList: [], attemptGet: [], resolveCurrent: [] };
  const registry = createAssignmentDetailRegistry();
  for (const m of REGISTRY) registry.register(m);

  const summaryCallable: AssignmentSummaryCallable = async ({ assignmentId }) => {
    calls.summary.push(assignmentId);
    const summary: AssignmentSummary = {
      assignmentId,
      classId: "x",
      totalStudents: 3,
      completedStudents: 3,
      inProgressStudents: 0,
      notStartedStudents: 0,
      completionPercentage: 100,
      averagePercentage: 80,
      highestPercentage: 80,
      lowestPercentage: 80,
      perfectScoreStudents: 0,
    };
    return summary;
  };
  const recipientListCallable: AssignmentRecipientListCallable = async ({ assignmentId }) => {
    calls.recipients.push(assignmentId);
    return {
      assignmentId,
      recipients: ["1", "2", "3"].map((n) => ({
        studentId: `${assignmentId}-s${n}`,
        studentDisplayName: `Student ${assignmentId}-${n}`,
      })),
    };
  };
  const attemptsListForClassCallable: AttemptsListForClassCallable = async ({ classId }) => {
    calls.attemptsList.push(classId);
    const ids = REGISTRY.filter((m) => m.classId === classId).map((m) => m.assignmentId);
    return {
      classId,
      attempts: ids.flatMap((id) => ["s1", "s2", "s3"].map((s) => attempt(id, `${id}-${s}`))),
    };
  };
  const attemptGetForTeacherCallable: AttemptGetForTeacherCallable = async ({ attemptId }) => {
    calls.attemptGet.push(attemptId);
    return {
      attemptId,
      studentId: "s",
      assignmentId: attemptId,
      attemptNumber: 1,
      percentage: 80,
      itemResults: [
        { itemId: "q1", isCorrect: true, correctOptionId: "a", studentResponse: "a" },
      ],
    } as unknown as Awaited<ReturnType<AttemptGetForTeacherCallable>>;
  };

  let outlet: TeacherShellOutletController | null = null;
  const opened: string[] = [];
  const seam = {
    register: (m: AssignmentDetailMetadata) => registry.register(m),
    list: () => registry.list(),
    setOutletController: (c: TeacherShellOutletController | null) => {
      outlet = c;
    },
    setStudentSelectionController: () => undefined,
    resolveCurrent: async (input: { readonly classId: string; readonly lessonSlug: string }) => {
      calls.resolveCurrent.push({ ...input });
      if (current instanceof Error) throw current;
      return current;
    },
    // Mirrors index.ts `openAssignmentDetail`: a fresh Detail render per open.
    open: (assignmentId: string, options?: AssignmentDetailOpenOptions) => {
      opened.push(assignmentId);
      outlet?.show((host) => {
        renderAssignmentDetail(host, {
          assignmentId,
          loadMetadata: createAssignmentDetailMetadataReader(registry),
          summaryCallable,
          onBack: () => options?.onBack?.(),
          backLabel: options?.backLabel,
          classSwitcher: options?.classSwitcher,
          recipientListCallable,
          attemptsListForClassCallable,
          attemptGetForTeacherCallable,
        });
      });
    },
  };
  return { seam, calls, opened };
}

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

async function mountShell(current: CurrentForFamily | Error = { resolution: "valid", currentAssignmentId: "a-c-new" }) {
  const mount = mkMount();
  const harness = makeHarness(current);
  let listClassesCalls = 0;
  mountTeacherShell(teacher(), mount, {
    onSignOut: () => undefined,
    onLaunchPresentMode: () => undefined,
    listClasses: async () => {
      listClassesCalls += 1;
      return CLASSES;
    },
    assignmentDetail: harness.seam,
    // The class Assignments dashboard's progress line (not recorded).
    assignmentSummary: async ({ assignmentId }: { assignmentId: string }) => ({
      assignmentId,
      classId: "x",
      totalStudents: 3,
      completedStudents: 1,
      inProgressStudents: 1,
      notStartedStudents: 1,
      completionPercentage: 33,
      averagePercentage: 80,
      highestPercentage: 80,
      lowestPercentage: 80,
      perfectScoreStudents: 0,
    }),
  } as unknown as ShellDeps);
  await settle();
  return { mount, ...harness, listClassesCalls: () => listClassesCalls };
}

const detailId = (mount: HTMLElement): string | null =>
  mount.querySelector("[data-testid=assignment-detail]")?.getAttribute("data-assignment-id") ?? null;
const classLabel = (mount: HTMLElement): string | null =>
  mount.querySelector("[data-testid=assignment-detail-class-value]")?.textContent ?? null;
const toggle = (mount: HTMLElement): HTMLButtonElement | null =>
  mount.querySelector<HTMLButtonElement>("[data-testid=assignment-detail-class-toggle]");
const optionLabels = (mount: HTMLElement): string[] =>
  Array.from(
    mount.querySelectorAll("[data-testid=assignment-detail-class-options] button"),
  ).map((b) => b.textContent ?? "");
const onClassAssignments = (mount: HTMLElement, classId: string): boolean =>
  mount.querySelector('[data-testid=class-nav-assignments][aria-current="page"]') !== null &&
  mount.querySelector("[data-testid=assignment-detail]") === null &&
  window.history.state?.kind === "shell-classes-workspace" &&
  window.history.state?.classId === classId;

async function openDetail(mount: HTMLElement, classId: string, assignmentId: string): Promise<void> {
  mount.querySelector<HTMLButtonElement>(`[data-testid=class-card-${classId}]`)!.click();
  await settle();
  mount.querySelector<HTMLButtonElement>(`[data-testid=active-assignment-open-${assignmentId}]`)!.click();
  await settle();
}

async function switchTo(mount: HTMLElement, classId: string): Promise<void> {
  toggle(mount)!.click();
  mount.querySelector<HTMLButtonElement>(`[data-testid=assignment-detail-class-option-${classId}]`)!.click();
  await settle();
}

beforeEach(() => {
  window.history.replaceState(null, "", "/app/teacher");
  _resetCurriculumSessionStateForTest();
  document.body.textContent = "";
});

describe("eligibility", () => {
  test("offers only other active classes with a published occurrence of the same lesson, in saved class order", async () => {
    const { mount } = await mountShell();
    await openDetail(mount, "c-a", "a-a");
    expect(detailId(mount)).toBe("a-a");
    expect(classLabel(mount)).toBe("SYT Acceptance");
    toggle(mount)!.click();
    expect(optionLabels(mount)).toEqual(["Period B", "Period C"]);
  });

  test("opening the menu issues no request", async () => {
    const { mount, calls, listClassesCalls } = await mountShell();
    await openDetail(mount, "c-a", "a-a");
    const before = JSON.stringify(calls);
    const listBefore = listClassesCalls();
    toggle(mount)!.click();
    await settle();
    toggle(mount)!.click();
    await settle();
    expect(JSON.stringify(calls)).toBe(before);
    expect(listClassesCalls()).toBe(listBefore);
  });

  test("a lesson assigned to one class only keeps the static class label", async () => {
    const { mount } = await mountShell();
    await openDetail(mount, "c-other", "a-other");
    expect(detailId(mount)).toBe("a-other");
    expect(toggle(mount)).toBeNull();
    const label = mount.querySelector("[data-testid=assignment-detail-class-value]")!;
    expect(label.tagName).toBe("P");
    expect(label.textContent).toBe("Other Lesson");
  });
});

describe("switching to a single published occurrence", () => {
  test("opens B's Detail as a pushed entry, with B's own data and no Current lookup", async () => {
    const { mount, calls, opened } = await mountShell();
    await openDetail(mount, "c-a", "a-a");
    const pushSpy = jest.spyOn(window.history, "pushState");
    const replaceSpy = jest.spyOn(window.history, "replaceState");
    calls.summary.length = 0;
    calls.recipients.length = 0;
    calls.attemptsList.length = 0;
    calls.attemptGet.length = 0;
    try {
      await switchTo(mount, "c-b");
      expect(pushSpy).toHaveBeenCalledTimes(1);
      expect(replaceSpy).not.toHaveBeenCalled();
    } finally {
      pushSpy.mockRestore();
      replaceSpy.mockRestore();
    }
    expect(opened[opened.length - 1]).toBe("a-b");
    expect(window.history.state).toEqual({
      kind: "shell-assignment-detail",
      surface: "classes",
      classId: "c-b",
      assignmentId: "a-b",
    });
    expect(detailId(mount)).toBe("a-b");
    expect(classLabel(mount)).toBe("Period B");
    expect(calls.resolveCurrent).toEqual([]);
    // Destination-specific metrics, roster, attempts, and Question Results.
    expect(new Set(calls.summary)).toEqual(new Set(["a-b"]));
    expect(calls.recipients).toEqual(["a-b"]);
    expect(new Set(calls.attemptsList)).toEqual(new Set(["c-b"]));
    expect(calls.attemptGet.length).toBeGreaterThan(0);
    expect(calls.attemptGet.every((id) => id.startsWith("att-a-b-"))).toBe(true);
    const roster = mount.querySelector("[data-testid=assignment-detail-roster-host]")?.textContent ?? "";
    expect(roster).toContain("a-b-1, Student");
    expect(roster).not.toContain("a-a-");
    expect(mount.querySelector("[data-testid=assignment-detail-question-tile-1]")).not.toBeNull();
    // B's own menu now offers A (and C), never B.
    toggle(mount)!.click();
    expect(optionLabels(mount)).toEqual(["SYT Acceptance", "Period C"]);
    expect(mount.querySelectorAll("[data-testid=assignment-detail]")).toHaveLength(1);
  });

  test("browser Back restores A's Detail and Forward restores B's, with no stale context", async () => {
    const { mount } = await mountShell();
    await openDetail(mount, "c-a", "a-a");
    await switchTo(mount, "c-b");
    expect(detailId(mount)).toBe("a-b");

    await realBack();
    expect(detailId(mount)).toBe("a-a");
    expect(classLabel(mount)).toBe("SYT Acceptance");
    expect(mount.querySelectorAll("[data-testid=assignment-detail]")).toHaveLength(1);
    // The switcher is available again once the class list settles.
    expect(toggle(mount)).not.toBeNull();

    await realForward();
    expect(detailId(mount)).toBe("a-b");
    expect(classLabel(mount)).toBe("Period B");
    expect(mount.querySelectorAll("[data-testid=assignment-detail]")).toHaveLength(1);

    await realBack();
    expect(detailId(mount)).toBe("a-a");
    await realBack();
    expect(onClassAssignments(mount, "c-a")).toBe(true);
  });

  test("'Back to class' from the switched Detail lands on B's Assignments", async () => {
    const { mount } = await mountShell();
    await openDetail(mount, "c-a", "a-a");
    await switchTo(mount, "c-b");
    const back = mount.querySelector<HTMLButtonElement>("[data-testid=assignment-detail-back]")!;
    expect(back.textContent).toBe("Back to class");
    back.click();
    await settle();
    expect(onClassAssignments(mount, "c-b")).toBe(true);
    expect(mount.querySelector("[data-testid=active-assignment-open-a-b]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=active-assignment-open-a-a]")).toBeNull();
  });

  test("after Back to A, A's 'Back to class' returns to A's Assignments", async () => {
    const { mount } = await mountShell();
    await openDetail(mount, "c-a", "a-a");
    await switchTo(mount, "c-b");
    await realBack();
    expect(detailId(mount)).toBe("a-a");
    mount.querySelector<HTMLButtonElement>("[data-testid=assignment-detail-back]")!.click();
    await settle();
    expect(onClassAssignments(mount, "c-a")).toBe(true);
  });
});

describe("switching to a class with several published occurrences", () => {
  test("a valid Current among them is opened", async () => {
    const { mount, calls } = await mountShell({ resolution: "valid", currentAssignmentId: "a-c-new" });
    await openDetail(mount, "c-a", "a-a");
    await switchTo(mount, "c-c");
    expect(calls.resolveCurrent).toEqual([{ classId: "c-c", lessonSlug: SLUG }]);
    expect(detailId(mount)).toBe("a-c-new");
    expect(window.history.state).toEqual({
      kind: "shell-assignment-detail",
      surface: "classes",
      classId: "c-c",
      assignmentId: "a-c-new",
    });
  });

  test.each([
    ["unresolved", { resolution: "unresolved", currentAssignmentId: null }],
    ["invalid", { resolution: "invalid", currentAssignmentId: null }],
    ["inactive", { resolution: "inactive", currentAssignmentId: null }],
    ["valid but not a registry occurrence", { resolution: "valid", currentAssignmentId: "a-c-missing" }],
    ["lookup failure", new Error("unavailable")],
  ] as const)(
    "%s Current falls back to that class's Assignments, never an arbitrary occurrence, and Back returns to A",
    async (_label, current) => {
      const { mount, opened } = await mountShell(current as CurrentForFamily | Error);
      await openDetail(mount, "c-a", "a-a");
      const openedBefore = opened.length;
      await switchTo(mount, "c-c");
      expect(opened.length).toBe(openedBefore);
      expect(onClassAssignments(mount, "c-c")).toBe(true);
      expect(mount.querySelector("[data-testid=active-assignment-open-a-c-new]")).not.toBeNull();

      await realBack();
      expect(detailId(mount)).toBe("a-a");
      await realForward();
      expect(onClassAssignments(mount, "c-c")).toBe(true);
    },
  );

  test("a Current resolved after the teacher has left the Detail does nothing", async () => {
    const { mount, seam, opened } = await mountShell();
    let resolve: (c: CurrentForFamily) => void = () => undefined;
    (seam as { resolveCurrent: unknown }).resolveCurrent = () =>
      new Promise<CurrentForFamily>((r) => {
        resolve = r;
      });
    await openDetail(mount, "c-a", "a-a");
    toggle(mount)!.click();
    mount.querySelector<HTMLButtonElement>("[data-testid=assignment-detail-class-option-c-c]")!.click();
    await settle();
    mount.querySelector<HTMLButtonElement>("[data-testid=assignment-detail-back]")!.click();
    await settle();
    expect(onClassAssignments(mount, "c-a")).toBe(true);
    const openedBefore = opened.length;
    resolve({ resolution: "valid", currentAssignmentId: "a-c-new" });
    await settle();
    expect(opened.length).toBe(openedBefore);
    expect(onClassAssignments(mount, "c-a")).toBe(true);
  });
});
