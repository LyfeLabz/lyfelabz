/**
 * @jest-environment jsdom
 *
 * Sprint 30 Show Your Thinking on Student Detail. Each card with attempts
 * gets a disclosure that lists every attempt with the written response
 * frozen on THAT attempt, read lazily through the certified
 * `assessmentAttemptGetForTeacher` callable. Attempts are historical and
 * cumulative: a Current occurrence group lists each attempt on every
 * occurrence separately, never merged, and Current changing never moves a
 * response between attempts.
 */
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ClassesSurfaceDeps } from "./classes";
import type {
  AttemptGetForTeacherCallable,
  CompletedAttemptSummary,
  TeacherVisibleAttempt,
} from "../../assignments/detail/attempts-wire";
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
  uid: "teacher-t",
  schoolId: "school-t",
  displayName: "Teacher",
});

const CLASS_A = "class-a";
const classes: ReadonlyArray<ClassSummary> = Object.freeze([
  Object.freeze({ id: CLASS_A, title: "(A) Science", status: "active", grade: "7", block: "A", isLmsLinked: false }),
] as ClassSummary[]);

const ALICE = { studentId: "s-alice", studentDisplayName: "Alice Adams" };
const BOB = { studentId: "s-bob", studentDisplayName: "Bob Baker" };

const attempt = (
  attemptId: string,
  assignmentId: string,
  submittedAt: number,
  attemptNumber = 1,
  studentId = ALICE.studentId,
): CompletedAttemptSummary => ({
  attemptId,
  studentId,
  studentDisplayName: "x",
  assignmentId,
  attemptNumber,
  score: 7,
  maxScore: 10,
  percentage: 70,
  submittedAt,
});

const group = (overrides: Partial<StudentAssignmentGroup>): StudentAssignmentGroup => ({
  resolution: "valid",
  lessonSlug: "lesson_earths-layers",
  operationalAssignmentId: "a3",
  assignmentIds: ["a1", "a2", "a3"],
  title: "Earth's Layers",
  status: "published",
  publishedAt: Date.UTC(2026, 8, 20, 12),
  hasLiveSession: false,
  isOperationalRecipient: true,
  ...overrides,
});

type Fixture = {
  attempts: CompletedAttemptSummary[];
  groups?: StudentAssignmentGroup[];
  expected?: Array<{ assignmentId: string; hasLiveSession: boolean }>;
  written: Record<string, string | null | Error>;
  withDetail?: boolean;
};

function harness(fx: Fixture) {
  const detailCalls: string[] = [];
  const attemptDetail: AttemptGetForTeacherCallable = async ({ attemptId }) => {
    detailCalls.push(attemptId);
    const value = fx.written[attemptId];
    if (value instanceof Error) throw value;
    const summary = fx.attempts.find((a) => a.attemptId === attemptId)!;
    const detail: TeacherVisibleAttempt = {
      attemptId,
      studentId: summary.studentId,
      assignmentId: summary.assignmentId,
      attemptNumber: summary.attemptNumber,
      percentage: summary.percentage,
      itemResults: [],
      writtenResponse: value ?? null,
    };
    return detail;
  };
  const expected: AssessmentStudentAssignmentsForClassCallable = async (input) => ({
    classId: input.classId,
    studentId: input.studentId,
    assignments: fx.expected ?? [],
    ...(fx.groups !== undefined ? { groups: fx.groups } : {}),
  });
  const deps: ClassesSurfaceDeps = {
    listClasses: async () => classes,
    loadRoster: () => async (input: { classId: string }) => ({
      classId: input.classId,
      students: [ALICE, BOB],
    }),
    loadAttempts: () => async (input: { classId: string }) => ({
      classId: input.classId,
      attempts: fx.attempts,
    }),
    loadExpectedAssignments: () => expected,
    ...(fx.withDetail === false ? {} : { loadAttemptDetail: () => attemptDetail }),
  };
  return { deps, detailCalls };
}

const q = (root: ParentNode, sel: string) => root.querySelector<HTMLElement>(sel);
const qa = (root: ParentNode, sel: string) => Array.from(root.querySelectorAll<HTMLElement>(sel));
const cards = (mount: HTMLElement) => qa(mount, "[data-testid=student-detail-assignments] > li");

async function openStudent(fx: Fixture, studentId = ALICE.studentId) {
  const h = harness(fx);
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  renderClassesSurface(mount, teacher, h.deps);
  await settle();
  q(mount, `[data-testid=class-card-${CLASS_A}]`)!.click();
  await settle();
  q(mount, "[data-testid=class-nav-roster]")!.click();
  await settle();
  q(mount, `[data-student-id="${studentId}"]`)!.click();
  await settle();
  return { mount, ...h };
}

async function toggle(card: HTMLElement) {
  q(card, "[data-testid=student-detail-thinking-toggle]")!.click();
  await settle();
}

const rows = (card: HTMLElement) =>
  qa(card, "[data-testid=student-detail-thinking-item]").map((li) => ({
    attemptId: li.getAttribute("data-attempt-id"),
    label: q(li, ".shell-student-detail-thinking-label")!.textContent,
    text: q(li, "[data-testid=student-detail-thinking-text]")?.textContent ?? null,
    none: q(li, "[data-testid=student-detail-thinking-none]") !== null,
    error: q(li, "[data-testid=student-detail-thinking-error]") !== null,
  }));

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("Student Detail Show Your Thinking", () => {
  const history = () => [
    attempt("at-1", "a1", 1000),
    attempt("at-3", "a2", 3000),
    attempt("at-2", "a1", 2000, 2),
    attempt("bob-1", "a1", 1500, 1, BOB.studentId),
  ];
  const written = {
    "at-1": "First try: the core is hot.",
    "at-2": "Second try: convection moves plates.",
    "at-3": "Third try on the reassigned lesson: heat, convection, plates, quakes.",
    "bob-1": "Bob's own thinking.",
  };

  test("renders no disclosure when the attempt-detail accessor is absent (pre-feature behavior)", async () => {
    const { mount } = await openStudent({
      attempts: history(),
      groups: [group({})],
      written,
      withDetail: false,
    });
    expect(cards(mount)).toHaveLength(1);
    expect(q(mount, "[data-testid=student-detail-thinking-toggle]")).toBeNull();
  });

  test("is lazy: opening Student Detail reads no attempt detail", async () => {
    const { mount, detailCalls } = await openStudent({ attempts: history(), groups: [group({})], written });
    const card = cards(mount)[0]!;
    const btn = q(card, "[data-testid=student-detail-thinking-toggle]")!;
    expect(btn.textContent).toBe("Show Your Thinking");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(q(card, "[data-testid=student-detail-thinking]")!.hidden).toBe(true);
    expect(detailCalls).toEqual([]);
  });

  test("lists every attempt across the Current group's occurrences, oldest first, each with its own response", async () => {
    const { mount, detailCalls } = await openStudent({ attempts: history(), groups: [group({})], written });
    const card = cards(mount)[0]!;
    await toggle(card);
    const btn = q(card, "[data-testid=student-detail-thinking-toggle]")!;
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.getAttribute("aria-controls")).toBe(q(card, "[data-testid=student-detail-thinking]")!.id);
    expect(rows(card).map((r) => [r.attemptId, r.text])).toEqual([
      ["at-1", written["at-1"]],
      ["at-2", written["at-2"]],
      ["at-3", written["at-3"]],
    ]);
    expect(rows(card)[1]!.label).toMatch(/^Attempt 2 · \d{2}\/\d{2}\/\d{4}$/);
    // Only this student's attempts are ever read.
    expect(detailCalls.sort()).toEqual(["at-1", "at-2", "at-3"]);
  });

  test("Current changing never moves a historical attempt's response", async () => {
    const fx = { attempts: history(), written };
    const before = await openStudent({ ...fx, groups: [group({})] });
    await toggle(cards(before.mount)[0]!);
    const beforeRows = rows(cards(before.mount)[0]!);

    document.body.innerHTML = "";
    const after = await openStudent({
      ...fx,
      groups: [group({ operationalAssignmentId: "a4", assignmentIds: ["a1", "a2", "a3", "a4"] })],
    });
    await toggle(cards(after.mount)[0]!);
    expect(rows(cards(after.mount)[0]!)).toEqual(beforeRows);
  });

  test("an attempt without a saved response says so instead of hiding the attempt", async () => {
    const { mount } = await openStudent({
      attempts: history(),
      groups: [group({})],
      written: { ...written, "at-1": null },
    });
    const card = cards(mount)[0]!;
    await toggle(card);
    const r = rows(card);
    expect(r).toHaveLength(3);
    expect(r[0]!.none).toBe(true);
    expect(r[0]!.text).toBeNull();
    expect(r[1]!.text).toBe(written["at-2"]);
  });

  test("closing hides the panel and reopening does not read again", async () => {
    const { mount, detailCalls } = await openStudent({ attempts: history(), groups: [group({})], written });
    const card = cards(mount)[0]!;
    await toggle(card);
    await toggle(card);
    expect(q(card, "[data-testid=student-detail-thinking-toggle]")!.getAttribute("aria-expanded")).toBe("false");
    expect(q(card, "[data-testid=student-detail-thinking]")!.hidden).toBe(true);
    await toggle(card);
    expect(detailCalls).toHaveLength(3);
    expect(rows(card)).toHaveLength(3);
  });

  test("a failed read shows an error for that attempt only and retries on reopen", async () => {
    const fx: Fixture = {
      attempts: history(),
      groups: [group({})],
      written: { ...written, "at-2": new Error("unavailable") },
    };
    const { mount, detailCalls } = await openStudent(fx);
    const card = cards(mount)[0]!;
    await toggle(card);
    expect(rows(card).map((r) => r.error)).toEqual([false, true, false]);
    expect(rows(card)[0]!.text).toBe(written["at-1"]);

    fx.written["at-2"] = written["at-2"];
    await toggle(card);
    await toggle(card);
    expect(detailCalls.filter((id) => id === "at-2")).toHaveLength(2);
    expect(rows(card).map((r) => r.text)).toEqual([written["at-1"], written["at-2"], written["at-3"]]);
  });

  test("renders student text as text, never as markup", async () => {
    const { mount } = await openStudent({
      attempts: [attempt("at-x", "a1", 1000)],
      groups: [group({})],
      written: { "at-x": "<img src=x onerror=alert(1)> heat & convection" },
    });
    const card = cards(mount)[0]!;
    await toggle(card);
    expect(q(card, "img")).toBeNull();
    expect(rows(card)[0]!.text).toBe("<img src=x onerror=alert(1)> heat & convection");
  });

  test("a Closed (inactive) history card and an orphan attempt card each get their own disclosure", async () => {
    const { mount } = await openStudent({
      attempts: [attempt("at-1", "a1", 1000), attempt("at-9", "z9", 9000)],
      groups: [group({ resolution: "inactive", operationalAssignmentId: null, assignmentIds: ["a1"] })],
      written: { "at-1": "Closed-lesson thinking.", "at-9": "Orphan thinking." },
    });
    const [closed, orphan] = cards(mount);
    expect(closed!.getAttribute("data-assignment-status")).toBe("closed");
    await toggle(closed!);
    await toggle(orphan!);
    expect(rows(closed!).map((r) => r.text)).toEqual(["Closed-lesson thinking."]);
    expect(rows(orphan!).map((r) => r.text)).toEqual(["Orphan thinking."]);
  });

  test("not-started cards have no disclosure; the pre-grouping per-assignment cards do", async () => {
    const { mount } = await openStudent({
      attempts: [attempt("at-1", "a1", 1000)],
      expected: [
        { assignmentId: "a1", hasLiveSession: false },
        { assignmentId: "a2", hasLiveSession: false },
      ],
      written: { "at-1": "Per-assignment thinking." },
    });
    const completed = q(mount, "[data-testid=student-detail-assignment]")!;
    const notStarted = q(mount, "[data-testid=student-detail-assignment-not-started]")!;
    expect(q(notStarted, "[data-testid=student-detail-thinking-toggle]")).toBeNull();
    await toggle(completed);
    expect(rows(completed).map((r) => r.text)).toEqual(["Per-assignment thinking."]);
  });
});
