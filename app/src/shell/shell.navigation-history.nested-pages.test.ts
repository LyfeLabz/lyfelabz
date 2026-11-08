/**
 * @jest-environment jsdom
 *
 * Browser Back/Forward across the teacher workspace's nested pages:
 *   Classes -> class (per section) -> Assignment Summary
 *   class Assignments <-> Students
 *   Curriculum -> Lesson Summary
 *   Curriculum resource-type tabs (and the primary Curriculum nav reset)
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
import type { AssignmentRegistryReadiness } from "../assignments/detail/hydration";
import type {
  AssignmentSummary,
  AssignmentSummaryCallable,
  LessonSummaryCallable,
} from "../assignments/summary/types";
import type {
  IntegrationsConnection,
  IntegrationsDeps,
} from "../settings/integrations/types";
import type { AssignmentDetailOpenOptions, TeacherShellStudentSelectionController } from "./surfaces/curriculum";
import { _resetCurriculumSessionStateForTest } from "./surfaces/curriculum";
import { getSurfaceableLessons } from "../curriculum/curriculumManifest";
import { installStudentSupportSeam } from "../supportAccess/session";
import { mountTeacherShell, type ShellDeps } from "./shell";
import { hashForState, parseShellHash, type ShellHistoryState } from "./navigationHistory";
import { installGradeImprovementsSeam } from "../assignments/gradeImprovements/session";
import type { GradeImprovementHistory } from "../assignments/gradeImprovements/types";

const freeze = <T>(v: T): T => Object.freeze(v) as T;
const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await flush();
};
const traverse = async (go: () => void): Promise<void> => {
  go();
  await new Promise((r) => setTimeout(r, 100));
  await settle();
};
const realBack = (): Promise<void> => traverse(() => window.history.back());
const realForward = (): Promise<void> => traverse(() => window.history.forward());

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
function makeAssignmentDetailSeam(checkHistoryOrigin: (classId: string, assignmentId: string) => Promise<boolean>) {
  let outlet: { show: (render: (host: HTMLElement) => void) => void } | null = null;
  let selection: TeacherShellStudentSelectionController | null = null;
  const opened: string[] = [];
  const seam = {
    register: () => undefined,
    list: () => registry,
    checkHistoryOrigin,
    setOutletController: (c: { show: (render: (host: HTMLElement) => void) => void } | null) => {
      outlet = c;
    },
    setStudentSelectionController: (controller: TeacherShellStudentSelectionController | null) => {
      selection = controller;
    },
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
        const student = document.createElement("button");
        student.setAttribute("data-testid", "assignment-summary-student");
        student.addEventListener("click", () => selection?.selectStudent({
          classId: CLASS_ID,
          ...roster[0]!,
          returnToAssignmentId: assignmentId,
        }));
        summary.appendChild(student);
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

async function mountShell(
  extra: Partial<ShellDeps> = {},
  checkHistoryOrigin = async (classId: string, assignmentId: string) =>
    registry.some((item) => item.classId === classId && item.assignmentId === assignmentId),
  registryStatus?: AssignmentRegistryReadiness,
) {
  const mount = mkMount();
  const detail = makeAssignmentDetailSeam(checkHistoryOrigin);
  mountTeacherShell(teacher(), mount, {
    onSignOut: () => undefined,
    onLaunchPresentMode: () => undefined,
    listClasses: async () => classes,
    assignmentDetail: { ...detail.seam, registryStatus },
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

afterEach(() => {
  installStudentSupportSeam(null);
  installGradeImprovementsSeam(null);
  document.body.replaceChildren();
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

describe("class destinations on a fresh shell after browser traversal", () => {
  test("restores roster-origin Detail with only authorized roster data and no Summary origin", async () => {
    const check = jest.fn(async () => false);
    const studentWork = jest.fn(async ({ classId, studentId }: { classId: string; studentId: string }) => ({ classId, studentId, assignments: [] }));
    const hash = hashForState({ kind: "shell-student-detail", surface: "classes", classId: CLASS_ID, studentId: "s-1" });
    const { mount } = await mountShell({
      initialState: parseShellHash(hash), loadExpectedAssignments: () => studentWork,
      loadAttempts: () => async ({ classId }) => ({ classId, attempts: [] }),
    }, check);

    expect(window.location.hash).toBe(hash);
    expect(mount.querySelector("[data-testid=student-detail-name]")?.textContent).toBe("Student One");
    expect(mount.querySelector("[data-testid=student-detail-back]")?.textContent).toBe("Back to Students");
    expect(check).not.toHaveBeenCalled();
    expect(studentWork.mock.calls).toEqual([[{ classId: CLASS_ID, studentId: "s-1" }]]);
  });

  test("a failed Classes landing read can retry in place", async () => {
    const listClasses = jest.fn<Promise<ReadonlyArray<ClassSummary>>, [string]>()
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValueOnce(classes);
    const { mount } = await mountShell({ listClasses });
    const length = window.history.length;
    const retry = mount.querySelector<HTMLButtonElement>("[data-testid=classes-retry]");
    expect(retry).not.toBeNull();
    retry!.click();
    await settle();
    expect(onClassesList(mount)).toBe(true);
    expect(listClasses.mock.calls).toEqual([["u1"], ["u1"]]);
    expect(window.history.length).toBe(length);
  });

  test.each(["Students", "Student Detail", "Assignment Summary"] as const)(
    "restores %s without adding a history entry",
    async (destination) => {
      const { mount: source } = await mountShell();
      await openClass(source);
      if (destination === "Students") {
        source.querySelector<HTMLButtonElement>("[data-testid=class-nav-roster]")!.click();
      } else {
        await openSummary(source);
        source.querySelector<HTMLButtonElement>("[data-testid=assignment-summary-student]")!.click();
      }
      await settle();
      await realBack();
      if (destination !== "Assignment Summary") await realForward();

      const hash = window.location.hash;
      const length = window.history.length;
      source.remove();
      // The fragment is sufficient even if the current entry has no state.
      window.history.replaceState(null, "", window.location.href);
      installStudentSupportSeam({
        listShared: async () => [],
        listForClass: async () => [],
        grantMany: async () => [],
        revoke: async () => undefined,
        revokeMany: async () => [],
        listAttemptsForStudent: async ({ classId, studentId }) => ({ classId, studentId, attempts: [] }),
        revisionContent: null,
      });
      let allowSummary!: (eligible: boolean) => void;
      const summaryEligibility = new Promise<boolean>((resolve) => { allowSummary = resolve; });
      const check = jest.fn(() =>
        destination === "Assignment Summary" ? summaryEligibility : Promise.resolve(true),
      );
      let releaseClasses!: (ownedClasses: typeof classes) => void;
      const ownedClasses = new Promise<typeof classes>((resolve) => { releaseClasses = resolve; });
      const listClasses = jest.fn(() =>
        destination === "Assignment Summary" ? ownedClasses : Promise.resolve(classes),
      );
      const assignmentSummary = jest.fn(summaryCallable);
      const { mount, opened } = await mountShell({
        initialState: parseShellHash(hash), listClasses, assignmentSummary,
      }, check);

      if (destination === "Assignment Summary") {
        expect(mount.querySelector("[data-testid=classes-status]")?.textContent)
          .toBe("Loading assignment summary");
        expect(mount.textContent).not.toContain(classes[0]!.title);
        expect(check).not.toHaveBeenCalled();
        releaseClasses(classes);
        await settle();

        // Refresh after real browser Back. The registry is ready and the
        // class list resolved, but the assignment origin is still being checked.
        expect(check.mock.calls).toEqual([[CLASS_ID, "a-ed"]]);
        expect(opened).toEqual([]);
        const outlet = mount.querySelector("[data-testid=workspace-outlet]")!;
        expect(outlet.querySelector("button, a, input, select, [tabindex='0']")).toBeNull();
        expect(outlet.querySelector("[data-testid=class-workspace]")).toBeNull();
        expect(outlet.querySelector("[role=status]")?.textContent).toBe("Loading assignment summary");
        expect(assignmentSummary).not.toHaveBeenCalled();
        allowSummary(true);
        await settle();
        expect(opened).toEqual(["a-ed"]);
      }

      expect(onStudents(mount)).toBe(destination !== "Assignment Summary");
      expect(onSummary(mount)).toBe(destination === "Assignment Summary");
      expect(mount.querySelector("[data-testid=student-detail-name]")?.textContent)
        .toBe(destination === "Student Detail" ? "Student One" : undefined);
      expect(check.mock.calls).toEqual(destination === "Students" ? [] : [[CLASS_ID, "a-ed"]]);
      expect(listClasses).toHaveBeenCalledTimes(1);
      expect(window.location.hash).toBe(hash);
      expect(window.history.length).toBe(length);

      if (destination === "Assignment Summary") {
        await realForward();
        expect(mount.querySelector("[data-testid=student-detail-name]")?.textContent).toBe("Student One");
        await realBack();
        expect(onSummary(mount)).toBe(true);
        expect(window.history.length).toBe(length);
      }
    },
  );

  test.each([
    ["#classes/roster/unowned", false, false],
    ["#classes/assignment/unowned/a-ed", false, false],
    [`#classes/assignment/${CLASS_ID}/missing`, true, false],
    [`#classes/assignment/${CLASS_ID}/a-ed`, true, true],
    [`#classes/student/${CLASS_ID}/s-1/assignment/a-ed`, true, true],
  ] as const)("fails safely for unavailable startup destination %s", async (hash, inClass, checksOrigin) => {
    const check = jest.fn(async () => false);
    const studentWork = jest.fn();
    const length = window.history.length;
    const { mount, opened } = await mountShell({
      initialState: parseShellHash(hash), loadExpectedAssignments: () => studentWork,
    }, check);

    expect(opened).toEqual([]);
    expect(mount.querySelector("[data-testid=student-detail-name]")).toBeNull();
    expect(inClass ? onClassAssignments(mount) : onClassesList(mount)).toBe(true);
    expect(check.mock.calls).toEqual(checksOrigin ? [[CLASS_ID, "a-ed"]] : []);
    expect(studentWork).not.toHaveBeenCalled();
    expect(window.history.length).toBe(length);
  });
});

test.each([false, true])("grade history is read once per visit with a late roster (history already settled: %s)", async (settled) => {
  let releaseRoster!: () => void;
  const requests: Array<(records: ReadonlyArray<GradeImprovementHistory>) => void> = [];
  const gradeHistory = jest.fn<
    Promise<ReadonlyArray<GradeImprovementHistory>>,
    [{ classId: string; studentId: string }]
  >(() => new Promise((resolve) => requests.push(resolve)));
  installGradeImprovementsSeam({
    listForStudent: gradeHistory,
    listForAssignment: jest.fn(),
    acknowledge: jest.fn(),
    reverse: jest.fn(),
  });
  const expected = jest.fn(async ({ classId, studentId }: { classId: string; studentId: string }) =>
    ({ classId, studentId, assignments: [{ assignmentId: "a-ed", hasLiveSession: false }] }));
  const { mount } = await mountShell({
    loadExpectedAssignments: () => expected,
    loadAttempts: () => async ({ classId }) => ({
      classId,
      attempts: roster.map(({ studentId, studentDisplayName }) => ({
        attemptId: `attempt-${studentId}`, studentId, studentDisplayName, assignmentId: "a-ed",
        attemptNumber: 1, score: 8, maxScore: 10, percentage: 80, submittedAt: 1000,
      })),
    }),
    loadRoster: () => ({ classId }) => new Promise((resolve) => {
      releaseRoster = () => resolve({ classId, students: roster });
    }),
  });
  const historyFor = (studentId: string, percentage: number): GradeImprovementHistory => ({
    assignmentId: "a-ed",
    studentId,
    effective: { eventId: "event", attemptId: "attempt", percentage },
    events: [{
      eventId: "event", type: "acknowledged", attemptId: "attempt", percentage,
      baselinePercentage: null, targetEventId: null, createdAt: null, byCaller: true,
    }],
  });
  const gradeStatus = () => mount.querySelector("[data-testid=student-detail-grade-update-status-a-ed]")?.textContent;
  await openClass(mount);
  await openSummary(mount);
  mount.querySelector<HTMLButtonElement>("[data-testid=assignment-summary-student]")!.click();
  await settle();
  expect(gradeHistory.mock.calls).toEqual([[{ classId: CLASS_ID, studentId: "s-1" }]]);
  if (settled) {
    requests[0]!([historyFor("s-1", 80)]);
    await settle();
    expect(gradeStatus()).toContain("80%");
  }

  const firstRender = mount.querySelector("[data-testid=student-detail-name]");
  releaseRoster();
  await settle();
  expect(mount.querySelector("[data-testid=student-detail-name]")).not.toBe(firstRender);
  expect(expected).toHaveBeenCalledTimes(1);
  expect(gradeHistory).toHaveBeenCalledTimes(1);
  if (settled) expect(gradeStatus()).toContain("80%");

  mount.querySelector<HTMLButtonElement>("[data-testid=student-detail-next]")!.click();
  await settle();
  expect(gradeHistory).toHaveBeenLastCalledWith({ classId: CLASS_ID, studentId: "s-2" });
  requests[1]!([historyFor("s-2", 95)]);
  if (!settled) requests[0]!([historyFor("s-1", 80)]);
  await settle();
  expect(gradeStatus()).toContain("95%");

  mount.querySelector<HTMLButtonElement>("[data-testid=student-detail-prev]")!.click();
  await settle();
  expect(gradeHistory).toHaveBeenCalledTimes(3);
  expect(gradeHistory).toHaveBeenLastCalledWith({ classId: CLASS_ID, studentId: "s-1" });
  expect(gradeStatus()).toBeUndefined();
  requests[2]!([historyFor("s-1", 85)]);
  await settle();
  expect(gradeStatus()).toContain("85%");

  mount.querySelector<HTMLButtonElement>("[data-testid=class-workspace-back]")!.click();
  mount.querySelector<HTMLButtonElement>(`[data-testid=class-card-${OTHER_CLASS_ID}]`)!.click();
  mount.querySelector<HTMLButtonElement>("[data-testid=class-nav-roster]")!.click();
  releaseRoster();
  await settle();
  mount.querySelector<HTMLButtonElement>('[data-testid=roster-student][data-student-id="s-1"]')!.click();
  await settle();
  expect(gradeHistory).toHaveBeenCalledTimes(4);
  expect(gradeHistory).toHaveBeenLastCalledWith({ classId: OTHER_CLASS_ID, studentId: "s-1" });
  expect(gradeStatus()).toBeUndefined();
});

describe("Assignment-origin Student Detail history", () => {
  test.each([
    "button", "browser Back", "late registry", "direct", "replaced", "wrong assignment",
    "invalid Summary state", "mismatched detail", "denied", "superseded",
  ] as const)(
    "return to Summary after a fresh Student Detail mount: %s",
    async (outcome) => {
      const { mount: source } = await mountShell();
      await openClass(source);
      await openSummary(source);
      const summaryUrl = window.location.href;
      source.querySelector<HTMLButtonElement>("[data-testid=assignment-summary-student]")!.click();
      await settle();
      const detailUrl = window.location.href;
      const detailState = window.history.state;
      const length = window.history.length;
      source.remove();
      if (outcome === "invalid Summary state") {
        await realBack();
        window.history.replaceState(null, "", summaryUrl);
        await realForward();
      }
      if (outcome === "direct") window.history.replaceState(null, "", detailUrl);
      if (outcome === "mismatched detail") {
        window.history.replaceState({ ...detailState, studentId: "s-2" }, "", detailUrl);
      }
      // jsdom supplies real Back/Forward but does not implement Navigation.entries().
      const precedingUrl = outcome === "direct" ? undefined
        : outcome === "replaced" ? new URL(`#classes/assignments/${CLASS_ID}`, summaryUrl).href
        : outcome === "wrong assignment" ? new URL(`#classes/assignment/${CLASS_ID}/a-other`, summaryUrl).href
        : summaryUrl;
      Object.defineProperty(window, "navigation", {
        configurable: true,
        value: {
          currentEntry: { index: 1 },
          entries: () => [precedingUrl && { url: precedingUrl, sameDocument: true }, { url: detailUrl }],
        },
      });
      try {
        let release!: (allowed: boolean) => void;
        const check = jest.fn(() => outcome === "superseded"
          ? new Promise<boolean>((resolve) => { release = resolve; })
          : Promise.resolve(outcome !== "denied"),
        );
        let registryReady = outcome !== "late registry";
        let releaseRegistry!: () => void;
        const registrySettled = new Promise<void>((resolve) => { releaseRegistry = resolve; });
        const registryListeners = new Set<() => void>();
        const registryStatus: AssignmentRegistryReadiness = {
          status: () => registryReady ? "ready" : "pending",
          subscribe: (listener) => {
            registryListeners.add(listener);
            return () => { registryListeners.delete(listener); };
          },
          retry: () => undefined,
          settled: () => registryReady ? Promise.resolve() : registrySettled,
        };
        const loadRoster = jest.fn(async ({ classId }: { classId: string }) => ({ classId, students: roster }));
        const { mount, opened } = await mountShell({
          initialState: parseShellHash(window.location.hash),
          loadRoster: () => loadRoster,
        }, check, registryStatus);
        const backButton = () => mount.querySelector<HTMLButtonElement>("[data-testid=student-detail-back]");
        if (outcome === "superseded") {
          expect(backButton()).toBeNull();
          expect(onClassAssignments(mount)).toBe(false);
          await realBack();
          release(true);
          await settle();
          expect(onSummary(mount)).toBe(true);
          expect(backButton()).toBeNull();
          expect(loadRoster).not.toHaveBeenCalled();
          expect(window.history.length).toBe(length);
          return;
        }
        expect(check.mock.calls).toEqual([[CLASS_ID, "a-ed"]]);
        if (outcome === "denied") {
          expect(opened).toEqual([]);
          expect(backButton()).toBeNull();
          expect(onClassAssignments(mount)).toBe(true);
          // The authorized class fallback can load its own roster count.
          expect(loadRoster.mock.calls).toEqual([[{ classId: CLASS_ID }]]);
          return;
        }

        expect(mount.querySelector("[data-testid=student-detail-name]")?.textContent).toBe("Student One");
        expect(loadRoster.mock.calls).toEqual([[{ classId: CLASS_ID }]]);
        expect(window.location.href).toBe(detailUrl);
        expect(backButton()?.textContent).toBe("Back to assignment");
        if (outcome === "browser Back") await realBack();
        else await traverse(() => backButton()!.click());
        if (outcome === "late registry") {
          const outlet = mount.querySelector("[data-testid=workspace-outlet]")!;
          expect(outlet.textContent).toContain("Loading assignment summary");
          expect(outlet.querySelector("button, a")).toBeNull();
          expect(onClassAssignments(mount)).toBe(false);
          registryReady = true;
          releaseRegistry();
          registryListeners.forEach((listener) => listener());
          await settle();
        }
        expect(window.history.length).toBe(length);
        expect(check).toHaveBeenCalledTimes(1);
        expect(loadRoster).toHaveBeenCalledTimes(1);
        if (outcome === "button" || outcome === "browser Back" || outcome === "late registry") {
          expect(window.location.href).toBe(summaryUrl);
          expect(onSummary(mount)).toBe(true);
          await realForward();
          expect(window.location.href).toBe(detailUrl);
          expect(mount.querySelector("[data-testid=student-detail-name]")?.textContent).toBe("Student One");
          expect(check).toHaveBeenCalledTimes(2);
          expect(loadRoster).toHaveBeenCalledTimes(2);
          expect(window.history.length).toBe(length);
        } else {
          expect(opened).toEqual([]);
          expect(onClassAssignments(mount)).toBe(true);
          expect(window.location.hash).toBe(`#classes/assignments/${CLASS_ID}`);
        }
      } finally {
        Reflect.deleteProperty(window, "navigation");
      }
    },
  );

  test.each([false, true])("Back and Forward restore the student and origin (reopened: %s)", async (reopened) => {
    const expected = jest.fn(async ({ classId, studentId }: { classId: string; studentId: string }) =>
      ({ classId, studentId, assignments: [] }),
    );
    let releaseRoster!: () => void;
    const progress = jest.fn(summaryCallable);
    const loadRoster = jest.fn(({ classId }: { classId: string }) =>
      new Promise<{ classId: string; students: typeof roster }>((resolve) => {
        releaseRoster = () => resolve({ classId, students: roster });
      }),
    );
    const { mount } = await mountShell({
      assignmentSummary: progress,
      loadExpectedAssignments: () => expected,
      loadAttempts: () => async ({ classId }) => ({ classId, attempts: [] }),
      loadRoster: () => loadRoster,
    });
    await openClass(mount);
    await openSummary(mount);
    const selectStudent = () =>
      mount.querySelector<HTMLButtonElement>("[data-testid=assignment-summary-student]")!.click();
    const backToAssignment = () =>
      mount.querySelector<HTMLButtonElement>("[data-testid=student-detail-back]")!.click();
    const studentHeading = () => mount.querySelector("[data-testid=student-detail-name]")?.textContent;

    const historyLength = window.history.length;
    const summaryState = { ...window.history.state, returnKey: expect.any(String) };
    selectStudent();
    await settle();
    expect(window.history.length).toBe(historyLength + 1);
    expect(window.history.state).toMatchObject({
      kind: "shell-student-detail", surface: "classes",
      classId: CLASS_ID, studentId: "s-1", originAssignmentId: "a-ed",
    });
    expect(studentHeading()).toBe("Student One");
    expect(expected).toHaveBeenCalledTimes(1);
    releaseRoster();
    await settle();
    expect(expected).toHaveBeenCalledTimes(1);

    if (reopened) {
      await traverse(backToAssignment);
      expect(onSummary(mount)).toBe(true);
      expect(window.history.state).toEqual(summaryState);
      expect(window.history.length).toBe(historyLength + 1);
      selectStudent();
      await settle();
      expect(expected).toHaveBeenCalledTimes(2);
      expect(window.history.length).toBe(historyLength + 1);
    }
    const studentState = window.history.state;
    await realBack();
    expect(onSummary(mount)).toBe(true);
    expect(window.history.state).toEqual(summaryState);
    progress.mockClear();
    loadRoster.mockClear();
    await realForward();
    expect(window.history.state).toEqual(studentState);
    expect(studentHeading()).toBeUndefined();
    expect(mount.textContent).toContain("Loading student detail");
    expect(onClassAssignments(mount)).toBe(false);
    expect(loadRoster.mock.calls).toEqual([[{ classId: CLASS_ID }]]);
    const beforeRestore = expected.mock.calls.length;
    releaseRoster();
    await settle();
    expect(studentHeading()).toBe("Student One");
    expect(expected).toHaveBeenCalledTimes(beforeRestore + 1);
    expect(expected).toHaveBeenLastCalledWith({ classId: CLASS_ID, studentId: "s-1" });
    expect(loadRoster).toHaveBeenCalledTimes(1);
    expect(progress).not.toHaveBeenCalled();
    await traverse(backToAssignment);
    expect(onSummary(mount)).toBe(true);
    expect(window.history.state).toEqual(summaryState);
    expect(window.history.length).toBe(historyLength + 1);
    await realBack();
    expect(onClassAssignments(mount)).toBe(true);
    expect(window.history.state).toMatchObject({ kind: "shell-classes-workspace", classId: CLASS_ID });
    await realForward();
    expect(window.history.state).toEqual(summaryState);
    await realForward();
    expect(window.history.state).toEqual(studentState);
    releaseRoster();
    await settle();
    expect(studentHeading()).toBe("Student One");
  });

  test("Back to assignment skips the Previous/Next visits and preserves their Forward entries", async () => {
    const { mount } = await mountShell();
    await openClass(mount);
    await openSummary(mount);
    const summaryState = { ...window.history.state, returnKey: expect.any(String) };
    const length = window.history.length;
    mount.querySelector<HTMLButtonElement>("[data-testid=assignment-summary-student]")!.click();
    await settle();
    mount.querySelector<HTMLButtonElement>("[data-testid=student-detail-next]")!.click();
    expect(window.history.state).toMatchObject({ studentId: "s-2", originAssignmentId: "a-ed" });
    await traverse(() => mount.querySelector<HTMLButtonElement>("[data-testid=student-detail-back]")!.click());
    expect(window.history.state).toEqual(summaryState);
    expect(window.history.length).toBe(length + 2);
    for (const student of roster) {
      await realForward();
      expect(window.history.state).toMatchObject({ studentId: student.studentId });
      expect(mount.querySelector("[data-testid=student-detail-name]")?.textContent).toBe(student.studentDisplayName);
    }
  });

  test.each([false, true])("Back to assignment replaces the first student when the original Summary was replaced (neighbor: %s)", async (neighbor) => {
    const { mount } = await mountShell();
    await openClass(mount);
    await openSummary(mount);
    mount.querySelector<HTMLButtonElement>("[data-testid=assignment-summary-student]")!.click();
    await settle();
    if (neighbor) mount.querySelector<HTMLButtonElement>("[data-testid=student-detail-next]")!.click();
    const studentState = window.history.state;
    const length = window.history.length;
    const steps = neighbor ? 2 : 1;
    await traverse(() => window.history.go(-steps));
    mount.querySelector<HTMLButtonElement>("[data-testid=assignment-summary-back]")!.click();
    await settle();
    await traverse(() => window.history.go(steps));
    expect(window.history.state).toEqual(studentState);
    expect(mount.querySelector("[data-testid=student-detail-name]")?.textContent).toBe(neighbor ? "Student Two" : "Student One");
    await traverse(() => mount.querySelector<HTMLButtonElement>("[data-testid=student-detail-back]")!.click());
    expect(onSummary(mount)).toBe(true);
    expect(window.history.state).toMatchObject({ kind: "shell-assignment-detail", assignmentId: "a-ed" });
    expect(window.history.length).toBe(length);
    const fallbackState = window.history.state;
    await realBack();
    expect(onClassAssignments(mount)).toBe(true);
    await realForward();
    expect(window.history.state).toEqual(fallbackState);
    expect(onSummary(mount)).toBe(true);
    if (neighbor) {
      await realForward();
      expect(window.history.state).toEqual(studentState);
      expect(mount.querySelector("[data-testid=student-detail-name]")?.textContent).toBe("Student Two");
    }
  });

  test("Back to assignment recovers a replaced Summary twice from the surviving second student", async () => {
    const { mount } = await mountShell();
    const backToClass = () =>
      mount.querySelector<HTMLButtonElement>("[data-testid=assignment-summary-back]")!.click();
    const backToAssignment = () =>
      mount.querySelector<HTMLButtonElement>("[data-testid=student-detail-back]")!.click();
    await openClass(mount);
    await openSummary(mount);
    mount.querySelector<HTMLButtonElement>("[data-testid=assignment-summary-student]")!.click();
    await settle();
    mount.querySelector<HTMLButtonElement>("[data-testid=student-detail-next]")!.click();
    const second = window.history.state;
    expect(second).toMatchObject({
      kind: "shell-student-detail", classId: CLASS_ID, studentId: "s-2", originAssignmentId: "a-ed",
      assignmentReturn: { key: expect.any(String), steps: 2 },
    });
    const summary = {
      kind: "shell-assignment-detail", surface: "classes", classId: CLASS_ID, assignmentId: "a-ed",
      returnKey: second.assignmentReturn.key,
    };
    const length = window.history.length;

    await traverse(() => window.history.go(-2));
    expect(window.history.state).toEqual(summary);
    expect(onSummary(mount)).toBe(true);
    backToClass();
    await settle();
    const workspace = window.history.state;
    expect(workspace).toMatchObject({ kind: "shell-classes-workspace", classId: CLASS_ID, section: "assignments" });
    expect(onClassAssignments(mount)).toBe(true);
    await traverse(() => window.history.go(2));

    for (let visit = 0; visit < 2; visit += 1) {
      expect(window.history.state).toEqual(second);
      expect(mount.querySelector("[data-testid=student-detail-name]")?.textContent).toBe("Student Two");
      await traverse(backToAssignment);
      expect(window.history.state).toEqual(summary);
      expect(onSummary(mount)).toBe(true);
      expect(window.history.length).toBe(length);
      if (visit === 0) {
        backToClass();
        await settle();
        expect(window.history.state).toEqual({ ...workspace, returnKey: summary.returnKey });
        expect(onClassAssignments(mount)).toBe(true);
        await realForward();
      }
    }

    await realBack();
    expect(window.history.state).toEqual(workspace);
    expect(onClassAssignments(mount)).toBe(true);
    await realForward();
    expect(window.history.state).toEqual(summary);
    expect(onSummary(mount)).toBe(true);
    await realForward();
    expect(window.history.state).toEqual(second);
    expect(mount.querySelector("[data-testid=student-detail-name]")?.textContent).toBe("Student Two");
    await realBack();
    expect(window.history.state).toEqual(summary);
    expect(onSummary(mount)).toBe(true);
    expect(window.history.length).toBe(length);
  });

  test("replacing Summary B leaves the original Summary A reachable from its second student", async () => {
    const { mount } = await mountShell();
    await openClass(mount);
    const workspaceA = window.history.state;
    await openSummary(mount);
    mount.querySelector<HTMLButtonElement>("[data-testid=assignment-summary-student]")!.click();
    await settle();
    const first = window.history.state;
    const summaryA = { kind: "shell-assignment-detail", surface: "classes", classId: CLASS_ID,
      assignmentId: "a-ed", returnKey: first.assignmentReturn.key };
    mount.querySelector<HTMLButtonElement>("[data-testid=student-detail-next]")!.click();
    const second = window.history.state;
    const lengthAtSecond = window.history.length;

    mount.querySelector<HTMLButtonElement>("[data-testid=nav-curriculum]")!.click();
    mount.querySelector<HTMLButtonElement>("[data-testid=nav-classes]")!.click();
    await settle();
    mount.querySelector<HTMLButtonElement>(`[data-testid=class-card-${OTHER_CLASS_ID}]`)!.click();
    await settle();
    mount.querySelector<HTMLButtonElement>("[data-testid=active-assignment-open-a-other]")!.click();
    expect(onSummary(mount, "a-other")).toBe(true);
    mount.querySelector<HTMLButtonElement>("[data-testid=assignment-summary-back]")!.click();
    await settle();
    expect(window.history.state).toMatchObject({ kind: "shell-classes-workspace", classId: OTHER_CLASS_ID });
    const length = window.history.length;

    await traverse(() => window.history.go(lengthAtSecond - length));
    expect(window.history.state).toEqual(second);
    expect(mount.querySelector("[data-testid=student-detail-name]")?.textContent).toBe("Student Two");
    await traverse(() => mount.querySelector<HTMLButtonElement>("[data-testid=student-detail-back]")!.click());
    expect(window.history.state).toEqual(summaryA);
    expect(onSummary(mount)).toBe(true);
    expect(window.history.length).toBe(length);
    await realBack();
    expect(window.history.state).toEqual(workspaceA);
    expect(onClassAssignments(mount)).toBe(true);
    await realForward();
    expect(window.history.state).toEqual(summaryA);
    await realForward();
    expect(window.history.state).toEqual(first);
    await realForward();
    expect(window.history.state).toEqual(second);
    expect(mount.querySelector("[data-testid=student-detail-name]")?.textContent).toBe("Student Two");
  });

  test("a history jump while classes are loading restores the latest workspace using the same read", async () => {
    let releaseClasses!: () => void;
    const listClasses = jest.fn().mockResolvedValueOnce(classes).mockImplementationOnce(
      () => new Promise((resolve) => { releaseClasses = () => resolve(classes); }),
    ).mockResolvedValue(classes);
    const { mount } = await mountShell({ listClasses });
    await openClass(mount);
    const workspaceState = window.history.state;
    await openSummary(mount);
    mount.querySelector<HTMLButtonElement>("[data-testid=assignment-summary-student]")!.click();
    expect(mount.textContent).toContain("Loading classes");
    await traverse(() => window.history.go(-2));
    expect(window.history.state).toEqual(workspaceState);
    expect(mount.textContent).toContain("Loading classes");
    await realBack();
    expect(window.history.state).toEqual({ kind: "shell-surface", surface: "classes" });
    await realForward();
    expect(window.history.state).toEqual(workspaceState);
    releaseClasses();
    await settle();
    expect(onClassAssignments(mount)).toBe(true);
    expect(listClasses).toHaveBeenCalledTimes(2);
    await realForward();
    expect(onSummary(mount)).toBe(true);
    await realForward();
    expect(mount.querySelector("[data-testid=student-detail-name]")?.textContent).toBe("Student One");
  });

  test.each(["Classes landing", "unavailable Summary"] as const)(
    "a pending workspace cannot reopen after navigation to %s",
    async (destination) => {
      const unavailable: ShellHistoryState = {
        kind: "shell-assignment-detail", surface: "classes",
        classId: OTHER_CLASS_ID, assignmentId: "missing-assignment",
      };
      const workspace: ShellHistoryState = {
        kind: "shell-classes-workspace", surface: "classes", classId: CLASS_ID, section: "assignments",
      };
      const curriculum = { kind: "shell-surface", surface: "curriculum" } as const;
      window.history.replaceState(unavailable, "", hashForState(unavailable));
      window.history.pushState(workspace, "", hashForState(workspace));
      window.history.pushState(curriculum, "", hashForState(curriculum));

      let releaseClasses!: () => void;
      const listClasses = jest.fn<Promise<readonly ClassSummary[]>, [string]>(async () => classes);
      const loadRoster = jest.fn(async ({ classId }: { classId: string }) => ({ classId, students: roster }));
      const { mount, opened } = await mountShell({ initialState: curriculum, listClasses, loadRoster: () => loadRoster });
      listClasses.mockClear();
      listClasses.mockImplementationOnce(() => new Promise((resolve) => {
        releaseClasses = () => resolve(classes);
      }));
      const length = window.history.length;

      await realBack();
      expect(window.history.state).toEqual(workspace);
      expect(window.location.hash).toBe(hashForState(workspace));
      expect(mount.textContent).toContain("Loading classes");
      expect(listClasses.mock.calls).toEqual([["u1"]]);
      expect(loadRoster).not.toHaveBeenCalled();

      const landing = destination === "Classes landing";
      if (landing) {
        await realForward();
        expect(window.history.state).toEqual(curriculum);
        expect(activeSurface(mount)).toBe("curriculum");
        mount.querySelector<HTMLButtonElement>("[data-testid=nav-classes]")!.click();
        await settle();
      } else {
        await realBack();
        expect(mount.textContent).toContain("Loading classes");
        expect(listClasses.mock.calls).toEqual([["u1"]]);
      }

      const selected = landing ? { kind: "shell-surface", surface: "classes" } as const : unavailable;
      const expectLanding = () => {
        expect(window.history.state).toEqual(selected);
        expect(window.location.hash).toBe(hashForState(selected));
        expect(window.history.length).toBe(length + (landing ? 1 : 0));
        expect({
          surface: activeSurface(mount),
          classesList: onClassesList(mount),
          classAssignments: onClassAssignments(mount),
          opened,
          rosterCalls: loadRoster.mock.calls,
        }).toEqual({ surface: "classes", classesList: true, classAssignments: false, opened: [], rosterCalls: [] });
      };
      if (landing) expectLanding();
      releaseClasses();
      await settle();
      expectLanding();
    },
  );

  test.each([
    { label: "pre-shell entry", state: null, hash: "#legacy" },
    {
      label: "gated My Units entry",
      state: { kind: "shell-units-archived", surface: "units" },
      hash: "#units/archived",
    },
  ])("traversing to a $label cancels the workspace waiting for the class list", async ({ state, hash }) => {
    const url = "/app/teacher" + hash;
    window.history.replaceState(state, "", url);
    window.history.pushState(null, "", "/app/teacher");
    let releaseClasses!: () => void;
    const listClasses = jest.fn<Promise<readonly ClassSummary[]>, [string]>(async () => classes);
    const loadRoster = jest.fn(async ({ classId }: { classId: string }) => ({ classId, students: roster }));
    const { mount } = await mountShell({ listClasses, loadRoster: () => loadRoster });
    await openClass(mount);
    const workspace = window.history.state;
    mount.querySelector<HTMLButtonElement>("[data-testid=nav-curriculum]")!.click();
    await settle();
    const length = window.history.length;
    listClasses.mockClear();
    loadRoster.mockClear();
    listClasses.mockImplementationOnce(() => new Promise((resolve) => {
      releaseClasses = () => resolve(classes);
    }));

    await realBack();
    expect(window.history.state).toEqual(workspace);
    expect(mount.textContent).toContain("Loading classes");
    expect(listClasses.mock.calls).toEqual([["u1"]]);
    await traverse(() => window.history.go(-2));
    expect(window.history.state).toEqual(state);
    expect(window.location.pathname + window.location.hash).toBe(url);
    releaseClasses();
    await settle();

    expect(window.history.state).toEqual(state);
    expect(window.location.pathname + window.location.hash).toBe(url);
    expect(window.history.length).toBe(length);
    expect({
      unitsMounted: mount.querySelector('[data-active-surface="units"]') !== null,
      classesList: onClassesList(mount),
      classAssignments: onClassAssignments(mount),
      rosterCalls: loadRoster.mock.calls,
    }).toEqual({ unitsMounted: false, classesList: true, classAssignments: false, rosterCalls: [] });
    expect(listClasses.mock.calls).toEqual([["u1"]]);

    if (state === null) {
      await realForward();
      expect(window.history.state).toEqual({ kind: "shell-surface", surface: "classes" });
      expect(window.location.hash).toBe("#classes");
      expect(onClassesList(mount)).toBe(true);
      expect(loadRoster).not.toHaveBeenCalled();
      await realForward();
      expect(window.history.state).toEqual(workspace);
      expect(window.location.hash).toBe(hashForState(workspace));
      expect(onClassAssignments(mount)).toBe(true);
      expect(loadRoster.mock.calls).toEqual([[{ classId: CLASS_ID }]]);
      expect(listClasses.mock.calls).toEqual([["u1"]]);
      expect(window.history.length).toBe(length);
    }
  });

  test("rapid Back and Forward between assignment students share only the pending class-list read", async () => {
    let releaseClasses!: () => void;
    const listClasses = jest.fn().mockResolvedValueOnce(classes).mockResolvedValueOnce(classes)
      .mockImplementationOnce(() => new Promise((resolve) => { releaseClasses = () => resolve(classes); }))
      .mockResolvedValue(classes);
    const check = jest.fn(async () => true);
    const expected = jest.fn(async ({ classId, studentId }: { classId: string; studentId: string }) =>
      ({ classId, studentId, assignments: [] }));
    const { mount } = await mountShell({
      listClasses,
      loadExpectedAssignments: () => expected,
      loadAttempts: () => async ({ classId }) => ({ classId, attempts: [] }),
    }, check);
    await openClass(mount);
    await openSummary(mount);
    mount.querySelector<HTMLButtonElement>("[data-testid=assignment-summary-student]")!.click();
    await settle();
    const first = window.history.state;
    mount.querySelector<HTMLButtonElement>("[data-testid=student-detail-next]")!.click();
    const second = window.history.state;
    const length = window.history.length;
    expected.mockClear();

    await realBack();
    expect(window.history.state).toEqual(first);
    expect(mount.textContent).toContain("Loading classes");
    expect(listClasses).toHaveBeenCalledTimes(3);
    await realForward();
    expect(window.history.state).toEqual(second);
    expect(mount.textContent).toContain("Loading classes");
    expect(listClasses).toHaveBeenCalledTimes(3);
    expect(check).not.toHaveBeenCalled();
    expect(expected).not.toHaveBeenCalled();

    releaseClasses();
    await settle();
    expect(window.history.length).toBe(length);
    expect(window.history.state).toEqual(second);
    expect(mount.querySelector("[data-testid=student-detail-name]")?.textContent).toBe("Student Two");
    expect(check.mock.calls).toEqual([[CLASS_ID, "a-ed"]]);
    expect(expected.mock.calls).toEqual([[{ classId: CLASS_ID, studentId: "s-2" }]]);

    await realBack();
    expect(window.history.state).toEqual(first);
    expect(mount.querySelector("[data-testid=student-detail-name]")?.textContent).toBe("Student One");
    expect(listClasses).toHaveBeenCalledTimes(4);
  });

  test.each(["restore", "teardown", "legacy"] as const)("startup holds the latest browser destination (%s)", async (outcome) => {
    if (outcome === "legacy") {
      window.history.replaceState(null, "", "/app/teacher#legacy");
      window.history.pushState(null, "", "/app/teacher");
    }
    const { mount: source } = await mountShell();
    await openClass(source);
    await openSummary(source);
    source.querySelector<HTMLButtonElement>("[data-testid=assignment-summary-student]")!.click();
    await settle();
    const first = window.history.state;
    const firstHash = window.location.hash;
    source.querySelector<HTMLButtonElement>("[data-testid=student-detail-next]")!.click();
    const second = window.history.state;
    source.querySelector<HTMLButtonElement>("[data-testid=nav-curriculum]")!.click();
    const length = window.history.length;
    source.remove();

    const listShared = jest.fn(async () => []);
    installStudentSupportSeam({
      listShared,
      listForClass: async () => [],
      grantMany: async () => [],
      revoke: async () => undefined,
      revokeMany: async () => [],
      listAttemptsForStudent: async ({ classId, studentId }) => ({ classId, studentId, attempts: [] }),
      revisionContent: null,
    });
    let releaseClasses!: () => void;
    const listClasses = jest.fn(() => new Promise<ReadonlyArray<ClassSummary>>((resolve) => {
      releaseClasses = () => resolve(outcome === "teardown" ? [] : classes);
    }));
    const check = jest.fn(async () => true);
    const loadRoster = jest.fn(async ({ classId }: { classId: string }) => ({ classId, students: roster }));
    const { mount } = await mountShell({
      listClasses, loadRoster: () => loadRoster, initialState: { kind: "shell-surface", surface: "curriculum" },
    }, check);
    expect(mount.querySelector("[data-testid=shell-workspace-resolving]")).not.toBeNull();
    await realBack();
    expect(window.history.state).toEqual(second);
    await realBack();
    expect(window.history.state).toEqual(first);
    expect(check).not.toHaveBeenCalled();

    if (outcome === "teardown") {
      mount.remove();
      installStudentSupportSeam(null);
      const replacement = await mountShell();
      const replacementState = window.history.state;
      releaseClasses();
      await settle();
      expect(window.history.state).toEqual(replacementState);
      expect(window.location.hash).toBe("#classes");
      expect(listShared).not.toHaveBeenCalled();
      expect(onClassesList(replacement.mount)).toBe(true);
      expect(check).not.toHaveBeenCalled();
      expect(loadRoster).not.toHaveBeenCalled();
    } else if (outcome === "legacy") {
      await traverse(() => window.history.go(-4));
      expect(window.history.state).toBeNull();
      expect(window.location.hash).toBe("#legacy");
      releaseClasses();
      await settle();
      expect(window.history.state).toBeNull();
      expect(window.location.hash).toBe("#legacy");
      expect(mount.querySelector("[data-testid=student-detail-name]")).toBeNull();
      expect(check).not.toHaveBeenCalled();
      expect(loadRoster).not.toHaveBeenCalled();
    } else {
      releaseClasses();
      await settle();
      expect(window.history.state).toEqual(first);
      expect(window.location.hash).toBe(firstHash);
      expect(mount.querySelector("[data-testid=student-detail-name]")?.textContent).toBe("Student One");
      expect(check.mock.calls).toEqual([[CLASS_ID, "a-ed"]]);
      expect(loadRoster.mock.calls).toEqual([[{ classId: CLASS_ID }]]);
      // The old shell's trail cannot authorize a history jump in this shell.
      mount.querySelector<HTMLButtonElement>("[data-testid=student-detail-back]")!.click();
      expect(window.history.state).toEqual({
        kind: "shell-classes-workspace", surface: "classes", classId: CLASS_ID, section: "assignments",
      });
      expect(onClassAssignments(mount)).toBe(true);
    }
    expect(window.history.length).toBe(length);
    expect(listClasses).toHaveBeenCalledTimes(1);
  });

  test("leaving a pending restoration prevents the late roster from reopening Student Detail", async () => {
    let releaseRoster: (() => void) | undefined;
    const { mount } = await mountShell({
      loadRoster: () => ({ classId }) => new Promise((resolve) => {
        releaseRoster = () => resolve({ classId, students: roster });
      }),
    });
    window.dispatchEvent(new PopStateEvent("popstate", {
      state: {
        kind: "shell-student-detail", surface: "classes",
        classId: CLASS_ID, studentId: "s-1", originAssignmentId: "a-ed",
      },
    }));
    await settle();
    expect(mount.textContent).toContain("Loading student detail");
    window.dispatchEvent(new PopStateEvent("popstate", {
      state: { kind: "shell-classes-workspace", surface: "classes", classId: CLASS_ID, section: "roster" },
    }));
    releaseRoster?.();
    await settle();
    expect(onStudents(mount)).toBe(true);
    expect(mount.querySelector("[data-testid=student-detail]")).toBeNull();
  });

  test.each([
    { classId: CLASS_ID, studentId: "s-1", originAssignmentId: "a-other" },
    { classId: CLASS_ID, studentId: "missing-student", originAssignmentId: "a-ed" },
    { classId: "unowned-class", studentId: "s-1", originAssignmentId: "a-ed" },
  ])("does not open Student Detail from a stale or unauthorized history entry (%j)", async (target) => {
    const expected = jest.fn();
    const { mount } = await mountShell({
      loadExpectedAssignments: () => expected,
      loadAttempts: () => async ({ classId }) => ({ classId, attempts: [] }),
    });
    window.dispatchEvent(new PopStateEvent("popstate", {
      state: { kind: "shell-student-detail", surface: "classes", ...target },
    }));
    await settle();
    expect(mount.querySelector("[data-testid=student-detail]")).toBeNull();
    expect(expected).not.toHaveBeenCalled();
    expect(target.classId === CLASS_ID ? onClassAssignments(mount) : onClassesList(mount)).toBe(true);
  });

  test.each([false, "denied"] as const)("Forward fails safely when the registry is stale and the server returns %s", async (outcome) => {
    const check = jest.fn(async () => {
      if (outcome === "denied") throw new Error("permission-denied");
      return false;
    });
    const expected = jest.fn(async ({ classId, studentId }: { classId: string; studentId: string }) =>
      ({ classId, studentId, assignments: [] }),
    );
    const attempts = jest.fn(async ({ classId }: { classId: string }) => ({ classId, attempts: [] }));
    const { mount } = await mountShell({
      loadExpectedAssignments: () => expected,
      loadAttempts: () => attempts,
    }, check);
    await openClass(mount);
    await openSummary(mount);
    mount.querySelector<HTMLButtonElement>("[data-testid=assignment-summary-student]")!.click();
    await settle();
    await realBack();
    expect(onSummary(mount)).toBe(true);
    expected.mockClear();
    attempts.mockClear();
    await realForward();
    expect(check.mock.calls).toEqual([[CLASS_ID, "a-ed"]]);
    expect(mount.querySelector("[data-testid=student-detail]")).toBeNull();
    expect(onClassAssignments(mount)).toBe(true);
    expect(expected).not.toHaveBeenCalled();
    expect(attempts).not.toHaveBeenCalled();
  });

  test("a late eligibility response after browser Back cannot load a roster or reopen Student Detail", async () => {
    let allowOrigin!: (eligible: boolean) => void;
    const check = jest.fn(() => new Promise<boolean>((resolve) => { allowOrigin = resolve; }));
    const loadRoster = jest.fn(async ({ classId }: { classId: string }) => ({ classId, students: roster }));
    const { mount } = await mountShell({ loadRoster: () => loadRoster }, check);
    await openClass(mount);
    await openSummary(mount);
    mount.querySelector<HTMLButtonElement>("[data-testid=assignment-summary-student]")!.click();
    await settle();
    await realBack();
    await realForward();
    expect(check.mock.calls).toEqual([[CLASS_ID, "a-ed"]]);
    expect(mount.textContent).toContain("Loading student detail");
    loadRoster.mockClear();
    await realBack();
    allowOrigin(true);
    await settle();
    expect(onSummary(mount)).toBe(true);
    expect(mount.querySelector("[data-testid=student-detail]")).toBeNull();
    expect(loadRoster).not.toHaveBeenCalled();
  });

  test("traversing to a pre-shell entry cancels pending assignment eligibility without replacing the entry", async () => {
    window.history.replaceState(null, "", "/app/teacher#legacy");
    window.history.pushState(null, "", "/app/teacher");
    let allowOrigin!: (eligible: boolean) => void;
    const check = jest.fn(() => new Promise<boolean>((resolve) => { allowOrigin = resolve; }));
    const loadRoster = jest.fn(async ({ classId }: { classId: string }) => ({ classId, students: roster }));
    const { mount } = await mountShell({ loadRoster: () => loadRoster }, check);
    await openClass(mount);
    await openSummary(mount);
    mount.querySelector<HTMLButtonElement>("[data-testid=assignment-summary-student]")!.click();
    await settle();
    const student = window.history.state;
    const length = window.history.length;
    await realBack();
    await realForward();
    expect(window.history.state).toEqual(student);
    expect(check.mock.calls).toEqual([[CLASS_ID, "a-ed"]]);
    expect(mount.textContent).toContain("Loading student detail");
    const rosterCalls = loadRoster.mock.calls.length;

    await traverse(() => window.history.go(-4));
    expect(window.history.state).toBeNull();
    expect(window.location.pathname + window.location.hash).toBe("/app/teacher#legacy");
    allowOrigin(true);
    await settle();

    expect({
      rosterCalls: loadRoster.mock.calls.length,
      student: mount.querySelector("[data-testid=student-detail-name]")?.textContent,
    }).toEqual({ rosterCalls, student: undefined });
    expect(onClassesList(mount)).toBe(true);
    expect(window.history.state).toBeNull();
    expect(window.location.pathname + window.location.hash).toBe("/app/teacher#legacy");
    expect(window.history.length).toBe(length);
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
    mount.querySelector<HTMLButtonElement>(`[data-testid=lesson-assign-${LESSON.slug}]`)!.click();
    await settle();
  }

  test("Results pushes an entry; Back returns to the lesson grid; Forward re-opens the summary", async () => {
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

describe("Curriculum resource-type tabs", () => {
  const tab = (mount: HTMLElement, key: string): HTMLButtonElement =>
    mount.querySelector<HTMLButtonElement>(`[data-testid=curriculum-tab-${key}]`)!;
  const selectedTab = (mount: HTMLElement): string | null =>
    mount
      .querySelector('[data-testid=curriculum-tabs] [aria-selected="true"]')
      ?.getAttribute("data-testid") ?? null;
  const navCurriculum = async (mount: HTMLElement): Promise<void> => {
    mount.querySelector<HTMLButtonElement>("[data-testid=nav-curriculum]")!.click();
    await settle();
  };

  test("tab switches push entries; Back walks Simulations -> Investigations -> Lessons", async () => {
    const { mount } = await mountShell();
    await navCurriculum(mount);
    expect(selectedTab(mount)).toBe("curriculum-tab-lessons");
    expect(window.location.hash).toBe("#curriculum");

    tab(mount, "investigations").click();
    await settle();
    expect(window.history.state).toEqual({
      kind: "shell-curriculum-tab",
      surface: "curriculum",
      tab: "investigations",
    });
    expect(window.location.hash).toBe("#curriculum/investigations");
    tab(mount, "simulations").click();
    await settle();
    expect(window.location.hash).toBe("#curriculum/simulations");

    await realBack();
    expect(activeSurface(mount)).toBe("curriculum");
    expect(selectedTab(mount)).toBe("curriculum-tab-investigations");
    expect(mount.querySelector("[data-testid=curriculum-panel-investigations]")).not.toBeNull();

    await realBack();
    expect(selectedTab(mount)).toBe("curriculum-tab-lessons");
    expect(window.history.state).toEqual({ kind: "shell-surface", surface: "curriculum" });
    expect(mount.querySelector<HTMLElement>("[data-testid=curriculum-panel-lessons]")!.hidden).toBe(false);

    await realForward();
    expect(selectedTab(mount)).toBe("curriculum-tab-investigations");
  });

  test("re-selecting the active tab pushes nothing; Back from a tab after leaving Curriculum restores it", async () => {
    const { mount } = await mountShell();
    await navCurriculum(mount);
    tab(mount, "extensions").click();
    await settle();
    const pushSpy = jest.spyOn(window.history, "pushState");
    try {
      tab(mount, "extensions").click();
      expect(pushSpy).not.toHaveBeenCalled();
    } finally {
      pushSpy.mockRestore();
    }
    mount.querySelector<HTMLButtonElement>("[data-testid=nav-settings]")!.click();
    await settle();
    await realBack();
    expect(activeSurface(mount)).toBe("curriculum");
    expect(selectedTab(mount)).toBe("curriculum-tab-extensions");
  });

  test("a malformed or unknown tab in history state fails closed", async () => {
    const { mount } = await mountShell();
    await navCurriculum(mount);
    for (const bad of ["tools", "games", "lessons", "", 7, "__proto__"]) {
      window.dispatchEvent(
        new PopStateEvent("popstate", {
          state: { kind: "shell-curriculum-tab", surface: "curriculum", tab: bad },
        }),
      );
      await settle();
      expect(selectedTab(mount)).toBe("curriculum-tab-lessons");
    }
  });

  test("primary Curriculum nav returns to Lessons from every resource tab, pushing one entry; repeats push nothing", async () => {
    const { mount } = await mountShell();
    await navCurriculum(mount);
    for (const key of ["investigations", "simulations", "extensions", "challenges"]) {
      tab(mount, key).click();
      await settle();
      expect(selectedTab(mount)).toBe(`curriculum-tab-${key}`);
      await navCurriculum(mount);
      expect(selectedTab(mount)).toBe("curriculum-tab-lessons");
      expect(window.history.state).toEqual({ kind: "shell-surface", surface: "curriculum" });
      expect(window.location.hash).toBe("#curriculum");
    }
    const pushSpy = jest.spyOn(window.history, "pushState");
    try {
      await navCurriculum(mount);
      await navCurriculum(mount);
      expect(pushSpy).not.toHaveBeenCalled();
    } finally {
      pushSpy.mockRestore();
    }
    // Back from the nav-driven Lessons entry returns to the tab it left.
    await realBack();
    expect(selectedTab(mount)).toBe("curriculum-tab-challenges");
  });

  test("primary Curriculum nav closes Lesson Summary to Lessons; Back re-opens the summary", async () => {
    const { mount } = await mountShell();
    await navCurriculum(mount);
    mount.querySelector<HTMLButtonElement>(`[data-testid=lesson-assign-${LESSON.slug}]`)!.click();
    await settle();
    expect(mount.querySelector("[data-testid=lesson-summary-surface]")).not.toBeNull();

    await navCurriculum(mount);
    expect(mount.querySelector("[data-testid=lesson-summary-surface]")).toBeNull();
    expect(mount.querySelector<HTMLElement>("[data-testid=curriculum-view]")!.hidden).toBe(false);
    expect(selectedTab(mount)).toBe("curriculum-tab-lessons");
    expect(window.history.state).toEqual({ kind: "shell-surface", surface: "curriculum" });

    await realBack();
    expect(mount.querySelector("[data-testid=lesson-summary-surface]")).not.toBeNull();
    await realBack();
    expect(mount.querySelector("[data-testid=lesson-summary-surface]")).toBeNull();
    expect(selectedTab(mount)).toBe("curriculum-tab-lessons");
  });

  test("Lesson Summary history still works after a tab round trip", async () => {
    const { mount } = await mountShell();
    await navCurriculum(mount);
    tab(mount, "investigations").click();
    await settle();
    tab(mount, "lessons").click();
    await settle();
    expect(window.history.state).toEqual({ kind: "shell-surface", surface: "curriculum" });
    mount.querySelector<HTMLButtonElement>(`[data-testid=lesson-assign-${LESSON.slug}]`)!.click();
    await settle();
    await realBack();
    expect(mount.querySelector("[data-testid=lesson-summary-surface]")).toBeNull();
    expect(selectedTab(mount)).toBe("curriculum-tab-lessons");
    await realBack();
    expect(selectedTab(mount)).toBe("curriculum-tab-investigations");
    await realForward();
    await realForward();
    expect(mount.querySelector("[data-testid=lesson-summary-surface]")).not.toBeNull();
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
    // Results-first: an assigned lesson's card action is Results, so open
    // the Assign dialog from a never-assigned lesson.
    const unassigned = getSurfaceableLessons().find(
      (l) => !registry.some((r) => r.lessonSlug === l.slug),
    )!;
    const assign = mount.querySelector<HTMLButtonElement>(`[data-testid=lesson-assign-${unassigned.slug}]`)!;
    expect(assign.textContent).toBe("Assign");
    assign.click();
    await settle();
    expect(document.querySelector("[data-testid=assign-overlay]")).not.toBeNull();

    await realBack();
    expect(activeSurface(mount)).toBe("classes");
    expect(document.querySelector("[data-testid=assign-overlay]")).toBeNull();
  });
});

describe("Lesson Results -> Class Results -> Assignment Summary", () => {
  const withClasses: LessonSummaryCallable = async (input) =>
    Object.assign(await lessonSummaryCallable(input), {
      classes: [
        {
          classId: CLASS_ID,
          students: 2,
          studentsCompleted: 1,
          completionPercentage: 50,
          averageBestPercentage: 80,
          assignmentsConsidered: 1,
        },
      ],
    });

  test("class Results pushes the class's assignment entry; in-app Back replaces it with the same Results", async () => {
    const { mount, opened } = await mountShell({ lessonSummary: withClasses });
    mount.querySelector<HTMLButtonElement>("[data-testid=nav-curriculum]")!.click();
    await settle();
    mount.querySelector<HTMLButtonElement>(`[data-testid=lesson-assign-${LESSON.slug}]`)!.click();
    await settle();
    mount
      .querySelector<HTMLButtonElement>(`[data-testid=lesson-class-result-view-${CLASS_ID}]`)!
      .click();
    await settle();
    expect(opened).toEqual(["a-ed"]);
    expect(onSummary(mount)).toBe(true);
    expect(window.history.state).toEqual({
      kind: "shell-assignment-detail",
      surface: "classes",
      classId: CLASS_ID,
      assignmentId: "a-ed",
    });
    const back = mount.querySelector<HTMLButtonElement>("[data-testid=assignment-summary-back]")!;
    expect(back.textContent).toBe("Back to Results");

    const pushSpy = jest.spyOn(window.history, "pushState");
    try {
      back.click();
      await settle();
      expect(pushSpy).not.toHaveBeenCalled();
    } finally {
      pushSpy.mockRestore();
    }
    expect(activeSurface(mount)).toBe("curriculum");
    expect(mount.querySelector("[data-testid=lesson-summary-surface]")).not.toBeNull();
    expect(mount.querySelector(`[data-testid=lesson-class-result-${CLASS_ID}]`)).not.toBeNull();
    expect(window.history.state).toEqual({
      kind: "shell-lesson-summary",
      surface: "curriculum",
      lessonSlug: LESSON.slug,
    });

    // The certified replace-never-back() pattern (as "Back to class" in
    // Classes): the Detail entry became this Results entry, so browser Back
    // first lands on the Results entry beneath it, then on the lesson grid.
    await realBack();
    expect(mount.querySelector("[data-testid=lesson-summary-surface]")).not.toBeNull();
    await realBack();
    expect(mount.querySelector("[data-testid=lesson-summary-surface]")).toBeNull();
  });

  test("browser Back from the class's assignment returns to Results; Forward re-opens the assignment", async () => {
    const { mount } = await mountShell({ lessonSummary: withClasses });
    mount.querySelector<HTMLButtonElement>("[data-testid=nav-curriculum]")!.click();
    await settle();
    mount.querySelector<HTMLButtonElement>(`[data-testid=lesson-assign-${LESSON.slug}]`)!.click();
    await settle();
    mount
      .querySelector<HTMLButtonElement>(`[data-testid=lesson-class-result-view-${CLASS_ID}]`)!
      .click();
    await settle();
    expect(onSummary(mount)).toBe(true);
    await realBack();
    expect(activeSurface(mount)).toBe("curriculum");
    expect(mount.querySelector(`[data-testid=lesson-class-result-${CLASS_ID}]`)).not.toBeNull();
    await realForward();
    expect(onSummary(mount)).toBe(true);
  });
});
