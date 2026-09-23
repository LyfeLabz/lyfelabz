/**
 * @jest-environment jsdom
 *
 * Browser Back/Forward across the teacher workspace's nested pages:
 *   Classes -> class (per section) -> Assignment Summary
 *   class Assignments <-> Students
 *   Curriculum -> Lesson Summary
 *   Settings -> Manage connection
 * plus modal dialogs never being left open over the page Back restores.
 *
 * Drives the REAL shell, Classes, Curriculum, and Settings surfaces with the
 * browser's own history (`history.back()` / `forward()` in jsdom). Assignment
 * Summary is supplied through the same outlet seam production uses
 * (`setOutletController`), rendering a minimal stand-in whose Back control
 * invokes the real `onBack` the Classes surface supplies.
 */
import type { Session } from "../session/types";
import type { ClassSummary } from "../classes/types";
import type { AssignmentDetailMetadata } from "../assignments/detail/types";
import type {
  AssignmentSummary,
  AssignmentSummaryCallable,
  LessonSummaryCallable,
} from "../assignments/summary/types";
import type {
  IntegrationsConnection,
  IntegrationsDeps,
} from "../settings/integrations/types";
import type { AssignmentDetailOpenOptions } from "./surfaces/curriculum";
import { _resetCurriculumSessionStateForTest } from "./surfaces/curriculum";
import { getSurfaceableLessons } from "../curriculum/curriculumManifest";
import { mountTeacherShell, type ShellDeps } from "./shell";

const freeze = <T>(v: T): T => Object.freeze(v) as T;
const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await flush();
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

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const activeSurface = (mount: HTMLElement): string | null =>
  mount.querySelector("[data-testid=workspace-outlet]")?.getAttribute("data-active-surface") ??
  null;

const CLASS_ID = "hist-c1";
const OTHER_CLASS_ID = "hist-c2";
const classes: ReadonlyArray<ClassSummary> = freeze([
  freeze({ id: CLASS_ID, title: "(A) Science", grade: "6", block: "A", status: "active", isLmsLinked: false }),
  freeze({ id: OTHER_CLASS_ID, title: "(B) Science", grade: "6", block: "B", status: "active", isLmsLinked: false }),
] as ClassSummary[]);

const LESSON = getSurfaceableLessons()[0]!;
const registry: ReadonlyArray<AssignmentDetailMetadata> = freeze([
  freeze({
    assignmentId: "a-ed",
    title: "Engineering Design",
    status: "published" as const,
    className: "(A) Science",
    classId: CLASS_ID,
    lessonSlug: LESSON.slug,
    publishedAt: 1000,
  }),
  freeze({
    assignmentId: "a-other",
    title: "Other class work",
    status: "published" as const,
    className: "(B) Science",
    classId: OTHER_CLASS_ID,
    lessonSlug: LESSON.slug,
    publishedAt: 900,
  }),
]);

const summaryCallable: AssignmentSummaryCallable = async ({ assignmentId }) => {
  const summary: AssignmentSummary = {
    assignmentId,
    classId: CLASS_ID,
    totalStudents: 2,
    completedStudents: 1,
    inProgressStudents: 0,
    notStartedStudents: 1,
    completionPercentage: 50,
    averagePercentage: 80,
    highestPercentage: 80,
    lowestPercentage: 80,
    perfectScoreStudents: 0,
  };
  return summary;
};

const lessonSummaryCallable: LessonSummaryCallable = async (input) => ({
  lessonSlug: input.lessonSlug,
  classesAssigned: 1,
  students: 2,
  studentsCompleted: 1,
  completionPercentage: 50,
  averageBestPercentage: 80,
  assignmentsConsidered: 1,
});

const connection: IntegrationsConnection = freeze({
  connectionId: "conn-1",
  providerId: "googleClassroom",
  status: "active",
  scopes: freeze([]),
});

function makeIntegrations(): IntegrationsDeps {
  return {
    callables: {
      listProviders: async () => freeze([]),
      describeConnections: async () => freeze([connection]),
      beginConnection: async () => ({ authorizationUrl: "", state: "" }),
      completeConnection: async () => ({ connectionId: "", alreadyConnected: false }),
      disconnect: async () => ({ alreadyRevoked: false }),
      discoverClasses: async () => freeze([]),
      importClass: async () => ({ linkId: "", classId: "", lmsClassId: "", alreadyLinked: false }),
      listClassLinks: async () => freeze([]),
      publishAssignment: async () => ({ kind: "succeeded" }),
      listTopics: async () => freeze([]),
    },
    openOAuth: async () => ({ code: "", state: "" }),
    redirectUri: "https://example.test/oauth",
  } as unknown as IntegrationsDeps;
}

// Production-shaped Assignment Summary seam: `open` renders into the shell
// outlet through the controller the shell registers.
function makeAssignmentDetailSeam() {
  let outlet: { show: (render: (host: HTMLElement) => void) => void } | null = null;
  const opened: string[] = [];
  const seam = {
    register: () => undefined,
    list: () => registry,
    setOutletController: (c: { show: (render: (host: HTMLElement) => void) => void } | null) => {
      outlet = c;
    },
    setStudentSelectionController: () => undefined,
    open: (assignmentId: string, options?: AssignmentDetailOpenOptions) => {
      opened.push(assignmentId);
      outlet?.show((host) => {
        const summary = document.createElement("section");
        summary.setAttribute("data-testid", "assignment-summary-stub");
        summary.setAttribute("data-assignment-id", assignmentId);
        const back = document.createElement("button");
        back.setAttribute("data-testid", "assignment-summary-back");
        back.textContent = options?.backLabel ?? "Back";
        back.addEventListener("click", () => options?.onBack?.());
        summary.appendChild(back);
        host.appendChild(summary);
      });
    },
  };
  return { seam, opened };
}

const roster = [
  { studentId: "s-1", studentDisplayName: "Student One" },
  { studentId: "s-2", studentDisplayName: "Student Two" },
];

async function mountShell(extra: Partial<ShellDeps> = {}) {
  const mount = mkMount();
  const detail = makeAssignmentDetailSeam();
  mountTeacherShell(teacher(), mount, {
    onSignOut: () => undefined,
    onLaunchPresentMode: () => undefined,
    listClasses: async () => classes,
    assignmentDetail: detail.seam,
    assignmentSummary: summaryCallable,
    lessonSummary: lessonSummaryCallable,
    loadRoster: () => async (input: { readonly classId: string }) => ({ classId: input.classId, students: roster }),
    ...extra,
  } as ShellDeps);
  await settle();
  return { mount, opened: detail.opened };
}

const onClassAssignments = (mount: HTMLElement): boolean =>
  mount.querySelector('[data-testid=class-nav-assignments][aria-current="page"]') !== null;
const onStudents = (mount: HTMLElement): boolean =>
  mount.querySelector('[data-testid=class-nav-roster][aria-current="page"]') !== null;
const onClassesList = (mount: HTMLElement): boolean =>
  mount.querySelector(`[data-testid=class-card-${CLASS_ID}]`) !== null &&
  mount.querySelector("[data-testid=class-nav-assignments]") === null;
const onSummary = (mount: HTMLElement, id = "a-ed"): boolean =>
  mount.querySelector(`[data-testid=assignment-summary-stub][data-assignment-id="${id}"]`) !== null;

async function openClass(mount: HTMLElement): Promise<void> {
  mount.querySelector<HTMLButtonElement>(`[data-testid=class-card-${CLASS_ID}]`)!.click();
  await settle();
}
async function openSummary(mount: HTMLElement): Promise<void> {
  mount.querySelector<HTMLButtonElement>("[data-testid=active-assignment-open-a-ed]")!.click();
  await settle();
}

beforeEach(() => {
  window.history.replaceState(null, "", "/app/teacher");
  _resetCurriculumSessionStateForTest();
  document.querySelectorAll("[data-testid=assign-overlay]").forEach((el) => el.remove());
});

describe("Classes -> class -> Assignments -> Assignment Summary (production failure)", () => {
  test("opening a class and then Summary each create their own history entry", async () => {
    const { mount } = await mountShell();
    await openClass(mount);
    expect(window.history.state).toEqual({
      kind: "shell-classes-workspace",
      surface: "classes",
      classId: CLASS_ID,
      section: "assignments",
    });
    await openSummary(mount);
    expect(onSummary(mount)).toBe(true);
    expect(window.history.state).toEqual({
      kind: "shell-assignment-detail",
      surface: "classes",
      classId: CLASS_ID,
      assignmentId: "a-ed",
    });
    expect(window.location.hash).toBe(`#classes/assignment/${CLASS_ID}/a-ed`);
  });

  test("browser Back: Summary -> class Assignments -> Classes; Forward: Classes -> class Assignments -> Summary", async () => {
    const { mount } = await mountShell();
    await openClass(mount);
    await openSummary(mount);

    await realBack();
    expect(onSummary(mount)).toBe(false);
    expect(onClassAssignments(mount)).toBe(true);
    expect(mount.querySelector("[data-testid=active-assignment-open-a-ed]")).not.toBeNull();

    await realBack();
    expect(onClassesList(mount)).toBe(true);

    await realForward();
    expect(onClassAssignments(mount)).toBe(true);

    await realForward();
    expect(onSummary(mount)).toBe(true);
  });

  test("in-app 'Back to class' lands on class Assignments and REPLACES the Summary entry (no push, no history.back)", async () => {
    const { mount } = await mountShell();
    await openClass(mount);
    await openSummary(mount);
    const pushSpy = jest.spyOn(window.history, "pushState");
    const backSpy = jest.spyOn(window.history, "back");
    try {
      mount.querySelector<HTMLButtonElement>("[data-testid=assignment-summary-back]")!.click();
      await settle();
      expect(onClassAssignments(mount)).toBe(true);
      expect(window.history.state).toEqual({
        kind: "shell-classes-workspace",
        surface: "classes",
        classId: CLASS_ID,
        section: "assignments",
      });
      expect(pushSpy).not.toHaveBeenCalled();
      expect(backSpy).not.toHaveBeenCalled();
    } finally {
      pushSpy.mockRestore();
      backSpy.mockRestore();
    }
  });

  test("Summary -> another top-level surface -> Back re-opens the Summary, and Back again reaches class Assignments", async () => {
    const { mount } = await mountShell();
    await openClass(mount);
    await openSummary(mount);
    mount.querySelector<HTMLButtonElement>("[data-testid=nav-curriculum]")!.click();
    await settle();
    expect(activeSurface(mount)).toBe("curriculum");

    await realBack();
    // Summary occupies the shell outlet (no surface outlet element while it
    // shows); Classes is the active navigation context.
    expect(onSummary(mount)).toBe(true);
    expect(mount.querySelector('[data-testid=nav-classes][aria-current="page"]')).not.toBeNull();

    await realBack();
    expect(onClassAssignments(mount)).toBe(true);
  });

  test("popstate restoration of this chain never pushes new entries (no loops)", async () => {
    const { mount } = await mountShell();
    await openClass(mount);
    await openSummary(mount);
    const pushSpy = jest.spyOn(window.history, "pushState");
    try {
      await realBack();
      await realBack();
      await realForward();
      await realForward();
      expect(pushSpy).not.toHaveBeenCalled();
    } finally {
      pushSpy.mockRestore();
    }
  });

  test("a Summary entry for an assignment outside that class (or unknown) fails closed onto the class's Assignments", async () => {
    const { mount, opened } = await mountShell();
    await openClass(mount);
    const before = opened.length;
    window.dispatchEvent(
      new PopStateEvent("popstate", {
        state: { kind: "shell-assignment-detail", surface: "classes", classId: CLASS_ID, assignmentId: "a-other" },
      }),
    );
    await settle();
    window.dispatchEvent(
      new PopStateEvent("popstate", {
        state: { kind: "shell-assignment-detail", surface: "classes", classId: CLASS_ID, assignmentId: "a-missing" },
      }),
    );
    await settle();
    expect(opened.length).toBe(before);
    expect(onSummary(mount, "a-other")).toBe(false);
    expect(onClassAssignments(mount)).toBe(true);
  });
});

describe("class Assignments <-> Students", () => {
  test("switching sections is reversible: Back/Forward walk Students <-> Assignments, then to the Classes list", async () => {
    const { mount } = await mountShell();
    await openClass(mount);
    mount.querySelector<HTMLButtonElement>("[data-testid=class-nav-roster]")!.click();
    await settle();
    expect(onStudents(mount)).toBe(true);
    mount.querySelector<HTMLButtonElement>("[data-testid=class-nav-assignments]")!.click();
    await settle();
    expect(onClassAssignments(mount)).toBe(true);

    await realBack();
    expect(onStudents(mount)).toBe(true);
    await realBack();
    expect(onClassAssignments(mount)).toBe(true);
    await realBack();
    expect(onClassesList(mount)).toBe(true);

    await realForward();
    expect(onClassAssignments(mount)).toBe(true);
    await realForward();
    expect(onStudents(mount)).toBe(true);
  });

  test("Students -> Student Detail -> Back keeps the certified behavior (Students list, then Assignments)", async () => {
    const { mount } = await mountShell();
    await openClass(mount);
    mount.querySelector<HTMLButtonElement>("[data-testid=class-nav-roster]")!.click();
    await settle();
    mount.querySelector<HTMLButtonElement>('[data-testid=roster-student][data-student-id="s-1"]')!.click();
    await settle();
    expect(mount.querySelector("[data-testid=student-detail]")).not.toBeNull();

    await realBack();
    expect(mount.querySelector("[data-testid=student-detail]")).toBeNull();
    expect(onStudents(mount)).toBe(true);
    await realBack();
    expect(onClassAssignments(mount)).toBe(true);
  });
});

describe("Curriculum -> Lesson Summary", () => {
  async function openLessonSummary(mount: HTMLElement): Promise<void> {
    mount.querySelector<HTMLButtonElement>("[data-testid=nav-curriculum]")!.click();
    await settle();
    mount.querySelector<HTMLButtonElement>(`[data-testid=lesson-view-summary-${LESSON.slug}]`)!.click();
    await settle();
  }

  test("View summary pushes an entry; Back returns to the lesson grid; Forward re-opens the summary", async () => {
    const { mount } = await mountShell();
    await openLessonSummary(mount);
    expect(mount.querySelector("[data-testid=lesson-summary-surface]")).not.toBeNull();
    expect(window.history.state).toEqual({
      kind: "shell-lesson-summary",
      surface: "curriculum",
      lessonSlug: LESSON.slug,
    });

    await realBack();
    expect(activeSurface(mount)).toBe("curriculum");
    expect(mount.querySelector("[data-testid=lesson-summary-surface]")).toBeNull();
    expect(mount.querySelector<HTMLElement>("[data-testid=curriculum-view]")!.hidden).toBe(false);

    await realForward();
    expect(mount.querySelector("[data-testid=lesson-summary-surface]")).not.toBeNull();
  });

  test("the summary's in-app Back replaces its entry with Curriculum (no push)", async () => {
    const { mount } = await mountShell();
    await openLessonSummary(mount);
    const pushSpy = jest.spyOn(window.history, "pushState");
    try {
      mount.querySelector<HTMLButtonElement>("[data-testid=lesson-summary-back]")!.click();
      await settle();
      expect(mount.querySelector("[data-testid=lesson-summary-surface]")).toBeNull();
      expect(window.history.state).toEqual({ kind: "shell-surface", surface: "curriculum" });
      expect(pushSpy).not.toHaveBeenCalled();
    } finally {
      pushSpy.mockRestore();
    }
  });

  test("an unknown lesson slug in history fails closed (grid stays)", async () => {
    const { mount } = await mountShell();
    mount.querySelector<HTMLButtonElement>("[data-testid=nav-curriculum]")!.click();
    await settle();
    window.dispatchEvent(
      new PopStateEvent("popstate", {
        state: { kind: "shell-lesson-summary", surface: "curriculum", lessonSlug: "no-such-lesson" },
      }),
    );
    await settle();
    expect(mount.querySelector("[data-testid=lesson-summary-surface]")).toBeNull();
  });
});

describe("Settings -> Manage connection", () => {
  test("Manage connection pushes an entry; Back returns to Settings; Forward re-opens it; in-app Back replaces", async () => {
    const { mount } = await mountShell({ integrations: makeIntegrations() });
    mount.querySelector<HTMLButtonElement>("[data-testid=nav-settings]")!.click();
    await settle();
    mount.querySelector<HTMLButtonElement>("[data-testid=settings-manage-connection]")!.click();
    await settle();
    expect(mount.querySelector("[data-testid=integrations-surface]")).not.toBeNull();
    expect(window.history.state).toEqual({ kind: "shell-settings-integrations", surface: "settings" });

    await realBack();
    expect(activeSurface(mount)).toBe("settings");
    expect(mount.querySelector("[data-testid=integrations-surface]")).toBeNull();
    expect(mount.querySelector("[data-testid=settings-tabs]")).not.toBeNull();

    await realForward();
    expect(mount.querySelector("[data-testid=integrations-surface]")).not.toBeNull();

    const pushSpy = jest.spyOn(window.history, "pushState");
    try {
      mount.querySelector<HTMLButtonElement>("[data-testid=integrations-back]")!.click();
      await settle();
      expect(mount.querySelector("[data-testid=settings-tabs]")).not.toBeNull();
      expect(window.history.state).toEqual({ kind: "shell-surface", surface: "settings" });
      expect(pushSpy).not.toHaveBeenCalled();
    } finally {
      pushSpy.mockRestore();
    }
  });
});

describe("modal dialogs are never left open over the page Back restores", () => {
  test("the Curriculum Assign dialog is dismissed when Back navigates", async () => {
    const { mount } = await mountShell();
    mount.querySelector<HTMLButtonElement>("[data-testid=nav-curriculum]")!.click();
    await settle();
    mount.querySelector<HTMLButtonElement>(`[data-testid=lesson-assign-${LESSON.slug}]`)!.click();
    await settle();
    expect(document.querySelector("[data-testid=assign-overlay]")).not.toBeNull();

    await realBack();
    expect(activeSurface(mount)).toBe("classes");
    expect(document.querySelector("[data-testid=assign-overlay]")).toBeNull();
  });
});
