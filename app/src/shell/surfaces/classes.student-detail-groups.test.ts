/**
 * @jest-environment jsdom
 *
 * Student Detail on the Current occurrence-group model:
 *   ASSIGNMENT RECORDS ARE HISTORICAL. CURRENT IS OPERATIONAL.
 *   ATTEMPTS ARE CUMULATIVE. BEST PERFORMANCE IS CUMULATIVE.
 * One card per server-resolved group (valid / inactive), legacy per-
 * assignment cards for unresolved scopes, orphan attempts never hidden; plus
 * the class-session hold of the class-wide attempts read.
 */
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ClassesSurfaceDeps } from "./classes";
import type { CompletedAttemptSummary } from "../../assignments/detail/attempts-wire";
import type {
  AssessmentStudentAssignmentsForClassCallable,
  StudentAssignmentGroup,
} from "../../assignments/detail/studentAssignments-wire";
import { renderClassesSurface } from "./classes";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await flush();
};

const teacher: Extract<Session, { kind: "activeTeacher" }> = Object.freeze({
  kind: "activeTeacher",
  uid: "teacher-g",
  schoolId: "school-g",
  displayName: "Teacher",
});

const CLASS_A = "class-a";
const CLASS_B = "class-b";
const classes: ReadonlyArray<ClassSummary> = Object.freeze([
  Object.freeze({ id: CLASS_A, title: "(A) Science", status: "active", grade: "7", block: "A", isLmsLinked: false }),
  Object.freeze({ id: CLASS_B, title: "(B) Science", status: "active", grade: "7", block: "B", isLmsLinked: false }),
] as ClassSummary[]);

const ALICE = { studentId: "s-alice", studentDisplayName: "Alice Adams" };
const BOB = { studentId: "s-bob", studentDisplayName: "Bob Baker" };
const CARLA = { studentId: "s-carla", studentDisplayName: "Carla Chen" };

let seq = 0;
const attempt = (
  assignmentId: string,
  percentage: number,
  submittedAt: number,
  attemptNumber = 1,
  studentId = ALICE.studentId,
): CompletedAttemptSummary => ({
  attemptId: `at-${(seq += 1)}`,
  studentId,
  studentDisplayName: "x",
  assignmentId,
  attemptNumber,
  score: percentage,
  maxScore: 100,
  percentage,
  submittedAt,
});

const group = (overrides: Partial<StudentAssignmentGroup>): StudentAssignmentGroup => ({
  resolution: "valid",
  lessonSlug: "lesson_engineering-design",
  operationalAssignmentId: "a4",
  assignmentIds: ["a1", "a2", "a3", "a4"],
  title: "Engineering Design",
  status: "published",
  publishedAt: Date.UTC(2026, 8, 20, 12),
  hasLiveSession: false,
  isOperationalRecipient: true,
  ...overrides,
});

type Fixture = {
  attemptsByClass: Record<string, CompletedAttemptSummary[]>;
  groupsByStudent: Record<string, StudentAssignmentGroup[] | undefined>;
  assignmentsByStudent?: Record<string, Array<{ assignmentId: string; hasLiveSession: boolean }>>;
};

function harness(fx: Fixture) {
  const attemptsCalls: string[] = [];
  const expectedCalls: string[] = [];
  const loadAttempts = jest.fn(async (input: { classId: string }) => {
    attemptsCalls.push(input.classId);
    return { classId: input.classId, attempts: fx.attemptsByClass[input.classId] ?? [] };
  });
  const expected: AssessmentStudentAssignmentsForClassCallable = async (input) => {
    expectedCalls.push(`${input.classId}:${input.studentId}`);
    const groups = fx.groupsByStudent[input.studentId];
    return {
      classId: input.classId,
      studentId: input.studentId,
      assignments: fx.assignmentsByStudent?.[input.studentId] ?? [],
      ...(groups !== undefined ? { groups } : {}),
    };
  };
  const deps: ClassesSurfaceDeps = {
    listClasses: async () => classes,
    loadRoster: () => async (input: { classId: string }) => ({
      classId: input.classId,
      students: [ALICE, BOB, CARLA],
    }),
    loadAttempts: () => loadAttempts,
    loadExpectedAssignments: () => expected,
  };
  return { deps, attemptsCalls, expectedCalls };
}

const q = (mount: HTMLElement, sel: string) => mount.querySelector<HTMLElement>(sel);
const qa = (mount: HTMLElement, sel: string) => Array.from(mount.querySelectorAll<HTMLElement>(sel));
const text = (mount: HTMLElement, testid: string) => q(mount, `[data-testid=${testid}]`)?.textContent ?? null;
const cards = (mount: HTMLElement) =>
  qa(mount, "[data-testid=student-detail-assignments] > li");

async function mountSurface(deps: ClassesSurfaceDeps) {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  renderClassesSurface(mount, teacher, deps);
  await settle();
  return mount;
}
async function openClass(mount: HTMLElement, classId: string) {
  q(mount, `[data-testid=class-card-${classId}]`)!.click();
  await settle();
}
async function showStudents(mount: HTMLElement) {
  q(mount, "[data-testid=class-nav-roster]")!.click();
  await settle();
}
async function openStudent(mount: HTMLElement, studentId: string) {
  q(mount, `[data-student-id="${studentId}"]`)!.click();
  await settle();
}
async function backToClasses(mount: HTMLElement) {
  q(mount, "[data-testid=class-workspace-back]")!.click();
  await settle();
}
async function openAlice(fx: Fixture) {
  const h = harness(fx);
  const mount = await mountSurface(h.deps);
  await openClass(mount, CLASS_A);
  await showStudents(mount);
  await openStudent(mount, ALICE.studentId);
  return { mount, ...h };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("valid Current: one cumulative card per class + lesson", () => {
  const history = () => [
    attempt("a1", 40, 1000),
    attempt("a2", 80, 2000),
    attempt("a3", 60, 3000, 1),
    attempt("a3", 70, 3500, 2),
  ];

  test("four occurrences with one Current render as ONE card; superseded occurrences never render separately", async () => {
    const { mount } = await openAlice({
      attemptsByClass: { [CLASS_A]: history() },
      groupsByStudent: { [ALICE.studentId]: [group({})] },
    });
    expect(cards(mount)).toHaveLength(1);
    const card = cards(mount)[0]!;
    expect(card.getAttribute("data-assignment-id")).toBe("a4");
    expect(card.getAttribute("data-group-resolution")).toBe("valid");
    for (const id of ["a1", "a2", "a3"]) {
      expect(q(mount, `[data-assignment-id="${id}"]`)).toBeNull();
    }
    // Title from Current (the registry is empty: never the generic fallback).
    expect(text(mount, "student-detail-assignment-title")).toBe("Engineering Design");
    expect(q(mount, "[data-testid=student-detail-assignment-meta-a4]")?.textContent).toMatch(/^Published /);
  });

  test("metrics are cumulative across every occurrence in the group", async () => {
    const { mount } = await openAlice({
      attemptsByClass: { [CLASS_A]: history() },
      groupsByStudent: { [ALICE.studentId]: [group({})] },
    });
    expect(text(mount, "student-detail-best-score")).toBe("80%");
    expect(text(mount, "student-detail-first-score")).toBe("40%"); // earliest submission, not "attempt #1 of some occurrence"
    expect(text(mount, "student-detail-latest-score")).toBe("70%");
    expect(text(mount, "student-detail-growth")).toBe("+30 pts");
    expect(text(mount, "student-detail-attempt-count")).toBe("4");
    expect(text(mount, "student-detail-latest-date")).toBe(
      [
        String(new Date(3500).getMonth() + 1).padStart(2, "0"),
        String(new Date(3500).getDate()).padStart(2, "0"),
        String(new Date(3500).getFullYear()),
      ].join("/"),
    );
  });

  test("history but no attempt on Current keeps the cumulative metrics and shows 'Current: Not started' separately", async () => {
    const { mount } = await openAlice({
      attemptsByClass: { [CLASS_A]: history() },
      groupsByStudent: { [ALICE.studentId]: [group({})] },
    });
    expect(text(mount, "student-detail-current-status-a4")).toBe("Current: Not started");
    // The lesson itself is never described as simply "Not started".
    expect(q(mount, "[data-testid=student-detail-assignment-not-started]")).toBeNull();
    expect(text(mount, "student-detail-best-score")).toBe("80%");
  });

  test("an attempt on Current removes the separate Current status", async () => {
    const { mount } = await openAlice({
      attemptsByClass: { [CLASS_A]: [...history(), attempt("a4", 90, 5000)] },
      groupsByStudent: { [ALICE.studentId]: [group({})] },
    });
    expect(q(mount, "[data-testid=student-detail-current-status-a4]")).toBeNull();
    expect(text(mount, "student-detail-best-score")).toBe("90%");
    expect(text(mount, "student-detail-attempt-count")).toBe("5");
  });

  test("a live session on Current shows 'Current: In progress' next to the history", async () => {
    const { mount } = await openAlice({
      attemptsByClass: { [CLASS_A]: history() },
      groupsByStudent: { [ALICE.studentId]: [group({ hasLiveSession: true })] },
    });
    expect(text(mount, "student-detail-current-status-a4")).toBe("Current: In progress");
  });

  test("no history: the card is Current's own state (Not started / In progress), with no fabricated score", async () => {
    let { mount } = await openAlice({
      attemptsByClass: { [CLASS_A]: [] },
      groupsByStudent: { [ALICE.studentId]: [group({})] },
    });
    expect(cards(mount)).toHaveLength(1);
    expect(text(mount, "student-detail-assignment-status-a4")).toBe("Not started");
    expect(q(mount, "[data-testid=student-detail-metrics]")).toBeNull();
    document.body.innerHTML = "";
    ({ mount } = await openAlice({
      attemptsByClass: { [CLASS_A]: [] },
      groupsByStudent: { [ALICE.studentId]: [group({ hasLiveSession: true })] },
    }));
    expect(text(mount, "student-detail-assignment-status-a4")).toBe("In progress");
  });
});

describe("inactive (managed Current closed/archived): one cumulative Closed card", () => {
  const inactive = (overrides: Partial<StudentAssignmentGroup> = {}) =>
    group({
      resolution: "inactive",
      operationalAssignmentId: null,
      assignmentIds: ["a1", "a2"],
      status: "closed",
      hasLiveSession: false,
      isOperationalRecipient: false,
      ...overrides,
    });

  test("one Closed card with cumulative metrics; never 'Not started'; no older assignment resurrected", async () => {
    const { mount } = await openAlice({
      attemptsByClass: { [CLASS_A]: [attempt("a1", 50, 1000), attempt("a2", 75, 2000)] },
      groupsByStudent: { [ALICE.studentId]: [inactive()] },
    });
    expect(cards(mount)).toHaveLength(1);
    const card = cards(mount)[0]!;
    expect(card.getAttribute("data-testid")).toBe("student-detail-assignment-closed");
    expect(card.getAttribute("data-assignment-status")).toBe("closed");
    expect(text(mount, "student-detail-assignment-status-a1")).toBe("Closed");
    expect(text(mount, "student-detail-best-score")).toBe("75%");
    expect(text(mount, "student-detail-attempt-count")).toBe("2");
    expect(mount.textContent).not.toContain("Not started");
    expect(mount.textContent).not.toContain("In progress");
    expect(q(mount, "[data-assignment-id=\"a2\"]")).toBeNull();
    expect(q(mount, "[data-testid=student-detail-assignment] button, [data-testid=student-detail-assignment-closed] a")).toBeNull();
  });

  test("with no attempts it is still one Closed card, never 'Not started'", async () => {
    const { mount } = await openAlice({
      attemptsByClass: { [CLASS_A]: [] },
      groupsByStudent: { [ALICE.studentId]: [inactive()] },
    });
    expect(cards(mount)).toHaveLength(1);
    expect(text(mount, "student-detail-assignment-status-a1")).toBe("Closed");
    expect(mount.textContent).not.toContain("Not started");
  });
});

describe("unresolved legacy / invalid Current: no grouping, real titles", () => {
  const unresolved = (id: string, publishedAt: number, hasLiveSession = false) =>
    group({
      resolution: "unresolved",
      operationalAssignmentId: id,
      assignmentIds: [id],
      publishedAt,
      hasLiveSession,
    });

  test("each assignment keeps its own card, titled by the server instead of the generic 'Assignment'", async () => {
    const { mount } = await openAlice({
      attemptsByClass: { [CLASS_A]: [attempt("u1", 65, 1000)] },
      groupsByStudent: {
        [ALICE.studentId]: [unresolved("u1", Date.UTC(2026, 8, 1, 12)), unresolved("u2", Date.UTC(2026, 8, 8, 12))],
      },
    });
    expect(cards(mount).map((c) => c.getAttribute("data-assignment-id"))).toEqual(["u1", "u2"]);
    expect(qa(mount, "[data-testid=student-detail-assignment-title]").map((t) => t.textContent)).toEqual([
      "Engineering Design",
      "Engineering Design",
    ]);
    expect(q(mount, "[data-testid=student-detail-assignments]")!.textContent).not.toContain("Assignment");
    // No heuristic combination: u1's score stays on u1; u2 is its own state.
    expect(text(mount, "student-detail-best-score")).toBe("65%");
    expect(text(mount, "student-detail-assignment-status-u2")).toBe("Not started");
  });

  test("an invalid Current arrives as unresolved entries and is rendered without choosing a Current", async () => {
    // The server fails an invalid pointer safe to "unresolved" per assignment.
    const { mount } = await openAlice({
      attemptsByClass: { [CLASS_A]: [attempt("u1", 65, 1000), attempt("u2", 95, 2000)] },
      groupsByStudent: {
        [ALICE.studentId]: [unresolved("u1", 1000), unresolved("u2", 2000)],
      },
    });
    expect(cards(mount)).toHaveLength(2);
    expect(qa(mount, "[data-testid=student-detail-best-score]").map((e) => e.textContent)).toEqual(["65%", "95%"]);
    expect(q(mount, "[data-group-resolution=valid]")).toBeNull();
  });
});

describe("history safety", () => {
  test("an attempt outside every group keeps its own card next to the group card", async () => {
    const { mount } = await openAlice({
      attemptsByClass: { [CLASS_A]: [attempt("a2", 80, 2000), attempt("orphan-1", 55, 900)] },
      groupsByStudent: { [ALICE.studentId]: [group({})] },
    });
    expect(cards(mount).map((c) => c.getAttribute("data-assignment-id"))).toEqual(["a4", "orphan-1"]);
    expect(qa(mount, "[data-testid=student-detail-best-score]").map((e) => e.textContent)).toEqual(["80%", "55%"]);
  });

  test("an empty groups list still shows every completed attempt (never hidden)", async () => {
    const { mount } = await openAlice({
      attemptsByClass: { [CLASS_A]: [attempt("x1", 70, 1000)] },
      groupsByStudent: { [ALICE.studentId]: [] },
    });
    expect(cards(mount).map((c) => c.getAttribute("data-assignment-id"))).toEqual(["x1"]);
  });

  test("a server without `groups` keeps the per-assignment fallback (older Function)", async () => {
    const { mount } = await openAlice({
      attemptsByClass: { [CLASS_A]: [attempt("a1", 40, 1000), attempt("a2", 80, 2000)] },
      groupsByStudent: { [ALICE.studentId]: undefined },
      assignmentsByStudent: {
        [ALICE.studentId]: [
          { assignmentId: "a1", hasLiveSession: false },
          { assignmentId: "a2", hasLiveSession: false },
          { assignmentId: "a4", hasLiveSession: false },
        ],
      },
    });
    expect(cards(mount).map((c) => c.getAttribute("data-assignment-id"))).toEqual(["a1", "a2", "a4"]);
  });
});

describe("class attempts are read once per class session", () => {
  test("showing Students reads the class attempts once, before any student is opened, and never per student", async () => {
    const h = harness({ attemptsByClass: { [CLASS_A]: [] }, groupsByStudent: {} });
    const mount = await mountSurface(h.deps);
    await openClass(mount, CLASS_A);
    expect(h.attemptsCalls).toEqual([]); // Assignments view: nothing yet
    await showStudents(mount);
    expect(h.attemptsCalls).toEqual([CLASS_A]);
    expect(h.expectedCalls).toEqual([]); // no per-student prefetch
  });

  test("switching students within the class never re-fetches the class-wide attempts", async () => {
    const { mount, attemptsCalls, expectedCalls } = await openAlice({
      attemptsByClass: {
        [CLASS_A]: [attempt("a4", 60, 1000), attempt("a4", 90, 1000, 1, BOB.studentId)],
      },
      groupsByStudent: { [ALICE.studentId]: [group({})], [BOB.studentId]: [group({})] },
    });
    expect(text(mount, "student-detail-best-score")).toBe("60%");
    q(mount, "[data-testid=student-detail-next]")!.click();
    await settle();
    expect(text(mount, "student-detail-best-score")).toBe("90%");
    q(mount, "[data-testid=student-detail-prev]")!.click();
    await settle();
    q(mount, "[data-testid=student-detail-back]")!.click();
    await settle();
    await openStudent(mount, BOB.studentId);
    expect(attemptsCalls).toEqual([CLASS_A]);
    expect(expectedCalls).toEqual([
      `${CLASS_A}:${ALICE.studentId}`,
      `${CLASS_A}:${BOB.studentId}`,
      `${CLASS_A}:${ALICE.studentId}`,
      `${CLASS_A}:${BOB.studentId}`,
    ]);
  });

  test("leaving the class drops the held attempts; class B never shows class A's attempts; reopening A reads fresh", async () => {
    const h = harness({
      attemptsByClass: {
        [CLASS_A]: [attempt("a4", 60, 1000)],
        [CLASS_B]: [attempt("b4", 95, 1000)],
      },
      groupsByStudent: {
        [ALICE.studentId]: [group({}), group({ operationalAssignmentId: "b4", assignmentIds: ["b4"] })],
      },
    });
    const mount = await mountSurface(h.deps);
    await openClass(mount, CLASS_A);
    await showStudents(mount);
    await openStudent(mount, ALICE.studentId);
    expect(qa(mount, "[data-testid=student-detail-best-score]").map((e) => e.textContent)).toEqual(["60%"]);

    await backToClasses(mount);
    await openClass(mount, CLASS_B);
    await showStudents(mount);
    await openStudent(mount, ALICE.studentId);
    expect(qa(mount, "[data-testid=student-detail-best-score]").map((e) => e.textContent)).toEqual(["95%"]);

    await backToClasses(mount);
    await openClass(mount, CLASS_A);
    await showStudents(mount);
    expect(h.attemptsCalls).toEqual([CLASS_A, CLASS_B, CLASS_A]);
  });

  test("browser Back/Forward straight into another class never reuses the previous class's attempts", async () => {
    let controller: { restoreWorkspace: (classId: string, section?: "assignments" | "roster" | "setup") => boolean } | null = null;
    const h = harness({
      attemptsByClass: {
        [CLASS_A]: [attempt("a4", 60, 1000)],
        [CLASS_B]: [attempt("b4", 95, 1000)],
      },
      groupsByStudent: {
        [ALICE.studentId]: [group({}), group({ operationalAssignmentId: "b4", assignmentIds: ["b4"] })],
      },
    });
    const mount = await mountSurface({
      ...h.deps,
      studentDetailHistory: {
        notify: () => undefined,
        registerController: (c: never) => {
          controller = c;
        },
      } as never,
    });
    await openClass(mount, CLASS_A);
    await showStudents(mount);
    await openStudent(mount, ALICE.studentId);
    expect(qa(mount, "[data-testid=student-detail-best-score]").map((e) => e.textContent)).toEqual(["60%"]);

    // A popstate restore lands directly on class B's Students section.
    expect(controller!.restoreWorkspace(CLASS_B, "roster")).toBe(true);
    await settle();
    await openStudent(mount, ALICE.studentId);
    expect(qa(mount, "[data-testid=student-detail-best-score]").map((e) => e.textContent)).toEqual(["95%"]);
    expect(h.attemptsCalls).toEqual([CLASS_A, CLASS_B]);
  });

  test("a failed class attempts read is not kept: the next student view retries", async () => {
    let fail = true;
    const calls: string[] = [];
    const h = harness({ attemptsByClass: {}, groupsByStudent: {} });
    const deps: ClassesSurfaceDeps = {
      ...h.deps,
      loadAttempts: () => async (input: { classId: string }) => {
        calls.push(input.classId);
        if (fail) throw new Error("unavailable");
        return { classId: input.classId, attempts: [attempt("a4", 88, 1000, 1, BOB.studentId)] };
      },
    };
    const mount = await mountSurface(deps);
    await openClass(mount, CLASS_A);
    await showStudents(mount);
    await openStudent(mount, ALICE.studentId);
    expect(q(mount, "[data-testid=student-detail-error]")).not.toBeNull();
    fail = false;
    // Students-tab read and the student view's retry both failed: one read
    // per view, never a burst.
    expect(calls).toEqual([CLASS_A, CLASS_A]);
    q(mount, "[data-testid=student-detail-next]")!.click();
    await settle();
    expect(calls).toEqual([CLASS_A, CLASS_A, CLASS_A]);
    expect(q(mount, "[data-testid=student-detail-error]")).toBeNull();
    expect(text(mount, "student-detail-best-score")).toBe("88%");
  });

  test("rapid Next / Previous: a late response for a student no longer shown never overwrites the current one", async () => {
    const pending = new Map<string, (groups: StudentAssignmentGroup[]) => void>();
    const h = harness({
      attemptsByClass: {
        [CLASS_A]: [attempt("a4", 60, 1000), attempt("a4", 99, 1000, 1, BOB.studentId)],
      },
      groupsByStudent: {},
    });
    const deps: ClassesSurfaceDeps = {
      ...h.deps,
      loadExpectedAssignments: () => (input) =>
        new Promise((resolve) => {
          pending.set(input.studentId, (groups) =>
            resolve({ classId: input.classId, studentId: input.studentId, assignments: [], groups }),
          );
        }),
    };
    const mount = await mountSurface(deps);
    await openClass(mount, CLASS_A);
    await showStudents(mount);
    await openStudent(mount, ALICE.studentId);
    q(mount, "[data-testid=student-detail-next]")!.click(); // Bob (pending)
    await settle();
    q(mount, "[data-testid=student-detail-prev]")!.click(); // back to Alice (pending again)
    await settle();
    // Alice's latest request resolves, then Bob's stale one arrives late.
    pending.get(ALICE.studentId)!([group({})]);
    await settle();
    pending.get(BOB.studentId)!([group({})]);
    await settle();
    expect(text(mount, "student-detail-name")).toBe(ALICE.studentDisplayName);
    expect(qa(mount, "[data-testid=student-detail-best-score]").map((e) => e.textContent)).toEqual(["60%"]);
  });
});
