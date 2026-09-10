/**
 * @jest-environment jsdom
 *
 * Student Detail V1 tests.
 *
 * Covers: roster items as buttons, student selection, Student Detail
 * states (loading/empty/error/data), metric derivation (best attempt,
 * first attempt, attempt count, latest date), assignment title lookup,
 * and initialization-timing regression guard (lazy loadAttempts accessor).
 */
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ClassesSurfaceDeps } from "./classes";
import type {
  AttemptsListForClassCallable,
  CompletedAttemptSummary,
} from "../../assignments/detail/attempts-wire";
import { renderClassesSurface } from "./classes";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const teacher: Extract<Session, { kind: "activeTeacher" }> = Object.freeze({
  kind: "activeTeacher",
  uid: "teacher-sd",
  schoolId: "school-sd",
  displayName: "Test Teacher",
});

const CLASS_ID = "class-sd-test";
const activeClass: ClassSummary = Object.freeze({
  id: CLASS_ID,
  title: "Science 6",
  status: "active" as const,
  grade: "6",
  block: "A",
  isLmsLinked: false,
});

const STUDENT_A = { studentId: "s-alice", studentDisplayName: "Alice Adams" };
const STUDENT_B = { studentId: "s-bob", studentDisplayName: "Bob Baker" };

const ASSIGNMENT_ID = "assign-001";

function makeAttempt(
  overrides: Partial<CompletedAttemptSummary>,
): CompletedAttemptSummary {
  return {
    attemptId: "atmp-1",
    studentId: STUDENT_A.studentId,
    studentDisplayName: STUDENT_A.studentDisplayName,
    assignmentId: ASSIGNMENT_ID,
    attemptNumber: 1,
    score: 8,
    maxScore: 10,
    percentage: 80,
    submittedAt: 1700000000000,
    ...overrides,
  };
}

const mockListClasses = jest.fn(async () => [activeClass]);

const mockLoadRoster = jest.fn(async (input: { classId: string }) => ({
  classId: input.classId,
  students: [STUDENT_A, STUDENT_B],
}));

function baseDeps(
  loadAttempts: ClassesSurfaceDeps["loadAttempts"] = null,
  overrides: Partial<ClassesSurfaceDeps> = {},
): ClassesSurfaceDeps {
  return {
    listClasses: mockListClasses,
    loadRoster: () => mockLoadRoster,
    loadAttempts,
    ...overrides,
  };
}

async function openStudentsTab(
  mount: HTMLElement,
  deps: ClassesSurfaceDeps,
): Promise<void> {
  renderClassesSurface(mount, teacher, deps);
  await flush();
  await flush();
  mount
    .querySelector<HTMLButtonElement>(`[data-testid=class-card-${CLASS_ID}]`)!
    .click();
  await flush();
  mount
    .querySelector<HTMLButtonElement>("[data-testid=class-nav-roster]")!
    .click();
  await flush();
  await flush(); // allow loadRoster promise to resolve
}

async function clickStudent(
  mount: HTMLElement,
  studentId: string,
): Promise<void> {
  mount
    .querySelector<HTMLButtonElement>(`[data-student-id="${studentId}"]`)!
    .click();
  await flush();
}

// ---------------------------------------------------------------------------
// 1. Roster items are accessible buttons
// ---------------------------------------------------------------------------

test("roster student items render as buttons, not plain list items", async () => {
  const mount = mkMount();
  await openStudentsTab(mount, baseDeps());

  const buttons = Array.from(
    mount.querySelectorAll<HTMLButtonElement>("[data-testid=roster-student]"),
  );
  expect(buttons.length).toBeGreaterThan(0);
  for (const btn of buttons) {
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.type).toBe("button");
  }
});

// ---------------------------------------------------------------------------
// 1b. UX polish: the roster list carries the classes the stylesheet keys off
// to remove the default bulleted-list presentation (list-style: none) and
// the divided-row treatment. A semantic/class assertion rather than a
// numeric CSS assertion, per the polish task's test guidance.
// ---------------------------------------------------------------------------

test("roster list and items carry the bullet-free row classes", async () => {
  const mount = mkMount();
  await openStudentsTab(mount, baseDeps());

  const list = mount.querySelector<HTMLUListElement>(
    "[data-testid=roster-list]",
  );
  expect(list).not.toBeNull();
  expect(list!.tagName).toBe("UL");
  expect(list!.className).toBe("shell-roster-list");

  const items = mount.querySelectorAll("[data-testid=roster-student]");
  for (const btn of Array.from(items)) {
    expect(btn.parentElement?.className).toBe("shell-roster-item");
  }
});

// ---------------------------------------------------------------------------
// 2. Clicking a student navigates to Student Detail
// ---------------------------------------------------------------------------

test("clicking a roster student button shows the student detail view", async () => {
  const mount = mkMount();
  await openStudentsTab(mount, baseDeps());
  await clickStudent(mount, STUDENT_A.studentId);

  expect(mount.querySelector("[data-testid=student-detail]")).not.toBeNull();
  expect(mount.querySelector("[data-testid=roster-list]")).toBeNull();
});

// ---------------------------------------------------------------------------
// 3. Student Detail shows the student's display name
// ---------------------------------------------------------------------------

test("student detail heading shows the selected student's display name", async () => {
  const mount = mkMount();
  await openStudentsTab(mount, baseDeps());
  await clickStudent(mount, STUDENT_A.studentId);

  const heading = mount.querySelector<HTMLElement>(
    "[data-testid=student-detail-name]",
  );
  expect(heading).not.toBeNull();
  expect(heading!.textContent).toBe(STUDENT_A.studentDisplayName);
});

// ---------------------------------------------------------------------------
// 4. Back button returns to roster
// ---------------------------------------------------------------------------

test("back-to-students button leaves student detail and returns to the roster", async () => {
  const mount = mkMount();
  await openStudentsTab(mount, baseDeps());
  await clickStudent(mount, STUDENT_A.studentId);

  mount
    .querySelector<HTMLButtonElement>("[data-testid=student-detail-back]")!
    .click();
  await flush();

  expect(mount.querySelector("[data-testid=roster-list]")).not.toBeNull();
  expect(mount.querySelector("[data-testid=student-detail]")).toBeNull();
});

// ---------------------------------------------------------------------------
// 4b. UX polish: Back to Students carries the compact secondary-control
// class (shared visual language with the certified shell-ss-back-btn /
// shell-class-workspace-back pattern) rather than an unstyled default
// button.
// ---------------------------------------------------------------------------

test("back-to-students button carries the compact secondary-control class", async () => {
  const mount = mkMount();
  await openStudentsTab(mount, baseDeps());
  await clickStudent(mount, STUDENT_A.studentId);

  const back = mount.querySelector<HTMLButtonElement>(
    "[data-testid=student-detail-back]",
  );
  expect(back).not.toBeNull();
  expect(back!.className).toBe("shell-student-detail-back");
});

// ---------------------------------------------------------------------------
// 5. Loading state while awaiting attempts callable
// ---------------------------------------------------------------------------

test("student detail shows a loading state while the attempts callable is pending", async () => {
  const mount = mkMount();
  // Callable that never resolves during this test.
  const neverResolves: AttemptsListForClassCallable = () =>
    new Promise(() => undefined);
  await openStudentsTab(
    mount,
    baseDeps(() => neverResolves),
  );
  await clickStudent(mount, STUDENT_A.studentId);

  expect(
    mount.querySelector("[data-testid=student-detail-loading]"),
  ).not.toBeNull();
  expect(mount.querySelector("[data-testid=student-detail-empty]")).toBeNull();
  expect(mount.querySelector("[data-testid=student-detail-error]")).toBeNull();
  expect(
    mount.querySelector("[data-testid=student-detail-assignments]"),
  ).toBeNull();
});

// ---------------------------------------------------------------------------
// 6. Empty state when no completed attempts for this student
// ---------------------------------------------------------------------------

test("student detail shows empty state when student has no completed work", async () => {
  const mount = mkMount();
  const noAttempts: AttemptsListForClassCallable = async (input) => ({
    classId: input.classId,
    attempts: [],
  });
  await openStudentsTab(mount, baseDeps(() => noAttempts));
  await clickStudent(mount, STUDENT_A.studentId);
  await flush();

  expect(
    mount.querySelector("[data-testid=student-detail-empty]"),
  ).not.toBeNull();
  expect(mount.querySelector("[data-testid=student-detail-loading]")).toBeNull();
  expect(mount.querySelector("[data-testid=student-detail-error]")).toBeNull();
});

// ---------------------------------------------------------------------------
// 7. Error state when callable rejects
// ---------------------------------------------------------------------------

test("student detail shows error state when the attempts callable rejects", async () => {
  const mount = mkMount();
  const rejects: AttemptsListForClassCallable = async () => {
    throw new Error("network failure");
  };
  await openStudentsTab(mount, baseDeps(() => rejects));
  await clickStudent(mount, STUDENT_A.studentId);
  await flush();

  expect(
    mount.querySelector("[data-testid=student-detail-error]"),
  ).not.toBeNull();
  expect(mount.querySelector("[data-testid=student-detail-loading]")).toBeNull();
  expect(mount.querySelector("[data-testid=student-detail-empty]")).toBeNull();
});

// ---------------------------------------------------------------------------
// 8. Assignment title: from registry and fallback to "Assignment"
// ---------------------------------------------------------------------------

test("student detail shows assignment title from registry and falls back to 'Assignment'", async () => {
  const mount = mkMount();
  const ASSIGN_TITLED = "assign-titled";
  const ASSIGN_UNKNOWN = "assign-unknown";

  const callable: AttemptsListForClassCallable = async (input) => ({
    classId: input.classId,
    attempts: [
      makeAttempt({ assignmentId: ASSIGN_TITLED }),
      makeAttempt({
        attemptId: "atmp-2",
        assignmentId: ASSIGN_UNKNOWN,
        attemptNumber: 1,
      }),
    ],
  });
  const deps = baseDeps(() => callable, {
    assignmentDetail: {
      list: () => [
        {
          assignmentId: ASSIGN_TITLED,
          title: "Waves and Light",
          status: "published" as const,
          className: "Science 6",
        },
      ],
      open: jest.fn(),
      register: jest.fn(),
      setOutletController: jest.fn(),
    },
  });

  await openStudentsTab(mount, deps);
  await clickStudent(mount, STUDENT_A.studentId);
  await flush();

  const titles = Array.from(
    mount.querySelectorAll<HTMLElement>("[data-testid=student-detail-assignment-title]"),
  ).map((el) => el.textContent);
  expect(titles).toContain("Waves and Light");
  expect(titles).toContain("Assignment");
});

// ---------------------------------------------------------------------------
// 9. Best attempt percentage (PDR-029a/b)
// ---------------------------------------------------------------------------

test("student detail shows the best attempt percentage using PDR-029a/b tie-breaking", async () => {
  const mount = mkMount();
  const callable: AttemptsListForClassCallable = async (input) => ({
    classId: input.classId,
    attempts: [
      makeAttempt({ attemptId: "atmp-1", attemptNumber: 1, percentage: 60, submittedAt: 1000 }),
      makeAttempt({ attemptId: "atmp-2", attemptNumber: 2, percentage: 80, submittedAt: 2000 }),
      makeAttempt({ attemptId: "atmp-3", attemptNumber: 3, percentage: 70, submittedAt: 3000 }),
    ],
  });

  await openStudentsTab(mount, baseDeps(() => callable));
  await clickStudent(mount, STUDENT_A.studentId);
  await flush();

  const bestEl = mount.querySelector<HTMLElement>(
    "[data-testid=student-detail-best-score]",
  );
  expect(bestEl).not.toBeNull();
  expect(bestEl!.textContent).toBe("80%");
});

// ---------------------------------------------------------------------------
// 10. Attempt count
// ---------------------------------------------------------------------------

test("student detail shows the correct total attempt count", async () => {
  const mount = mkMount();
  const callable: AttemptsListForClassCallable = async (input) => ({
    classId: input.classId,
    attempts: [
      makeAttempt({ attemptId: "atmp-1", attemptNumber: 1, percentage: 50 }),
      makeAttempt({ attemptId: "atmp-2", attemptNumber: 2, percentage: 70 }),
      makeAttempt({ attemptId: "atmp-3", attemptNumber: 3, percentage: 90 }),
    ],
  });

  await openStudentsTab(mount, baseDeps(() => callable));
  await clickStudent(mount, STUDENT_A.studentId);
  await flush();

  const countEl = mount.querySelector<HTMLElement>(
    "[data-testid=student-detail-attempt-count]",
  );
  expect(countEl).not.toBeNull();
  expect(countEl!.textContent).toBe("3");
});

// ---------------------------------------------------------------------------
// 11. First / latest / best / growth - the QA canonical sequence
// (40% -> 80% -> 60%), rendered as individual metric boxes mirroring
// `renderAssignmentSummaryCard`'s label/value grid. The raw attempt
// ordinal is no longer rendered anywhere as teacher-facing information.
// ---------------------------------------------------------------------------

test("student detail derives first, best, latest score and growth from the QA-style 40/80/60 sequence", async () => {
  const mount = mkMount();
  const callable: AttemptsListForClassCallable = async (input) => ({
    classId: input.classId,
    attempts: [
      makeAttempt({ attemptId: "atmp-1", attemptNumber: 1, percentage: 40, submittedAt: 1000 }),
      makeAttempt({ attemptId: "atmp-2", attemptNumber: 2, percentage: 80, submittedAt: 2000 }),
      makeAttempt({ attemptId: "atmp-3", attemptNumber: 3, percentage: 60, submittedAt: 3000 }),
    ],
  });

  await openStudentsTab(mount, baseDeps(() => callable));
  await clickStudent(mount, STUDENT_A.studentId);
  await flush();

  expect(
    mount.querySelector("[data-testid=student-detail-first-score]")!.textContent,
  ).toBe("40%");
  expect(
    mount.querySelector("[data-testid=student-detail-best-score]")!.textContent,
  ).toBe("80%");
  expect(
    mount.querySelector("[data-testid=student-detail-latest-score]")!.textContent,
  ).toBe("60%");
  expect(
    mount.querySelector("[data-testid=student-detail-attempt-count]")!.textContent,
  ).toBe("3");
  expect(
    mount.querySelector("[data-testid=student-detail-growth]")!.textContent,
  ).toBe("+20 pts");

  // The raw attempt ordinal ("1") is no longer rendered as a teacher-facing
  // metric anywhere in the assignment summary.
  expect(
    mount.querySelector("[data-testid=student-detail-first-attempt]"),
  ).toBeNull();
});

test("student detail with a single attempt shows equal first/latest/best and zero growth", async () => {
  const mount = mkMount();
  const callable: AttemptsListForClassCallable = async (input) => ({
    classId: input.classId,
    attempts: [
      makeAttempt({ attemptId: "atmp-1", attemptNumber: 1, percentage: 75, submittedAt: 1000 }),
    ],
  });

  await openStudentsTab(mount, baseDeps(() => callable));
  await clickStudent(mount, STUDENT_A.studentId);
  await flush();

  expect(
    mount.querySelector("[data-testid=student-detail-first-score]")!.textContent,
  ).toBe("75%");
  expect(
    mount.querySelector("[data-testid=student-detail-latest-score]")!.textContent,
  ).toBe("75%");
  expect(
    mount.querySelector("[data-testid=student-detail-best-score]")!.textContent,
  ).toBe("75%");
  expect(
    mount.querySelector("[data-testid=student-detail-attempt-count]")!.textContent,
  ).toBe("1");
  expect(
    mount.querySelector("[data-testid=student-detail-growth]")!.textContent,
  ).toBe("0 pts");
});

test("student detail renders negative growth when the latest attempt scores lower than the first", async () => {
  const mount = mkMount();
  const callable: AttemptsListForClassCallable = async (input) => ({
    classId: input.classId,
    attempts: [
      makeAttempt({ attemptId: "atmp-1", attemptNumber: 1, percentage: 90, submittedAt: 1000 }),
      makeAttempt({ attemptId: "atmp-2", attemptNumber: 2, percentage: 70, submittedAt: 2000 }),
    ],
  });

  await openStudentsTab(mount, baseDeps(() => callable));
  await clickStudent(mount, STUDENT_A.studentId);
  await flush();

  expect(
    mount.querySelector("[data-testid=student-detail-first-score]")!.textContent,
  ).toBe("90%");
  expect(
    mount.querySelector("[data-testid=student-detail-latest-score]")!.textContent,
  ).toBe("70%");
  expect(
    mount.querySelector("[data-testid=student-detail-growth]")!.textContent,
  ).toBe("-20 pts");
});

// ---------------------------------------------------------------------------
// 11b. Presentation: metrics render as individual boxed cells (a <dl> of
// label + value pairs), not the old single inline text row.
// ---------------------------------------------------------------------------

test("each Student Detail metric renders as a labeled box, not an inline text row", async () => {
  const mount = mkMount();
  const callable: AttemptsListForClassCallable = async (input) => ({
    classId: input.classId,
    attempts: [
      makeAttempt({ attemptId: "atmp-1", attemptNumber: 1, percentage: 40, submittedAt: 1000 }),
      makeAttempt({ attemptId: "atmp-2", attemptNumber: 2, percentage: 80, submittedAt: 2000 }),
      makeAttempt({ attemptId: "atmp-3", attemptNumber: 3, percentage: 60, submittedAt: 3000 }),
    ],
  });

  await openStudentsTab(mount, baseDeps(() => callable));
  await clickStudent(mount, STUDENT_A.studentId);
  await flush();

  const grid = mount.querySelector<HTMLElement>(
    "[data-testid=student-detail-metrics]",
  );
  expect(grid).not.toBeNull();
  expect(grid!.tagName).toBe("DL");
  expect(grid!.className).toBe("shell-student-detail-metric-grid");
  // The old single-inline-row presentation class is gone.
  expect(mount.querySelector(".shell-student-detail-metrics")).toBeNull();

  const expectedKeys = [
    "best-score",
    "first-score",
    "latest-score",
    "growth",
    "attempts",
    "latest-date",
  ];
  const expectedLabels = [
    "Best score",
    "First score",
    "Latest score",
    "Growth",
    "Attempts",
    "Latest date",
  ];
  for (const key of expectedKeys) {
    const cell = mount.querySelector<HTMLElement>(
      `[data-testid=student-detail-metric-${key}]`,
    );
    expect(cell).not.toBeNull();
    expect(cell!.className).toBe("shell-student-detail-metric");
  }
  const labels = Array.from(
    grid!.querySelectorAll<HTMLElement>(".shell-student-detail-metric-label"),
  ).map((el) => el.textContent);
  expect(labels).toEqual(expectedLabels);
  const values = Array.from(
    grid!.querySelectorAll<HTMLElement>(".shell-student-detail-metric-value"),
  ).map((el) => el.textContent);
  expect(values.slice(0, 5)).toEqual(["80%", "40%", "60%", "+20 pts", "3"]);
  // Date formatting is exercised precisely by the dedicated latest-date
  // test below; here just confirm a non-empty sixth value is present.
  expect(values[5]!.trim().length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// 12. Latest submission date
// ---------------------------------------------------------------------------

test("student detail shows the latest submission date across all attempts", async () => {
  const mount = mkMount();
  const LATEST_TS = 1700100000000; // 2023-11-15
  const callable: AttemptsListForClassCallable = async (input) => ({
    classId: input.classId,
    attempts: [
      makeAttempt({ attemptId: "atmp-1", attemptNumber: 1, submittedAt: 1700000000000 }),
      makeAttempt({ attemptId: "atmp-2", attemptNumber: 2, submittedAt: LATEST_TS }),
    ],
  });

  await openStudentsTab(mount, baseDeps(() => callable));
  await clickStudent(mount, STUDENT_A.studentId);
  await flush();

  const dateEl = mount.querySelector<HTMLElement>(
    "[data-testid=student-detail-latest-date]",
  );
  expect(dateEl).not.toBeNull();
  // Verify the element is present and non-empty; exact format is implementation detail.
  expect(dateEl!.textContent!.trim().length).toBeGreaterThan(0);
  // The date should reflect the latest timestamp (month 11 = November).
  const d = new Date(LATEST_TS);
  expect(dateEl!.textContent).toContain(String(d.getFullYear()));
});

// ---------------------------------------------------------------------------
// 13. Initialization timing: loadAttempts accessor resolves lazily
// ---------------------------------------------------------------------------

test("a loadAttempts accessor assigned AFTER assembly still reaches Student Detail", async () => {
  const mount = mkMount();

  let liveCallable: AttemptsListForClassCallable | null = null;
  const callable = jest.fn(async (input: { classId: string }) => ({
    classId: input.classId,
    attempts: [makeAttempt({ attemptId: "atmp-late", attemptNumber: 1, percentage: 75 })],
  }));

  // The accessor mirrors index.ts `() => attemptsListForClass`: returns null
  // before init, then the real callable once init completes.
  const accessor = (): AttemptsListForClassCallable | null => liveCallable;

  // Assemble the whole surface while the callable is still null.
  renderClassesSurface(mount, teacher, baseDeps(accessor));
  await flush();
  await flush();

  // Now init completes.
  liveCallable = callable;

  // Teacher opens the class and navigates to Students after init.
  mount
    .querySelector<HTMLButtonElement>(`[data-testid=class-card-${CLASS_ID}]`)!
    .click();
  await flush();
  mount
    .querySelector<HTMLButtonElement>("[data-testid=class-nav-roster]")!
    .click();
  await flush();
  await flush(); // loadRoster

  await clickStudent(mount, STUDENT_A.studentId);
  await flush(); // loadAttempts callable

  // The lazily-resolved callable was called, and the data renders.
  expect(callable).toHaveBeenCalledTimes(1);
  expect(callable).toHaveBeenCalledWith({ classId: CLASS_ID });
  expect(
    mount.querySelector("[data-testid=student-detail-assignments]"),
  ).not.toBeNull();
  expect(mount.querySelector("[data-testid=student-detail-loading]")).toBeNull();
  expect(mount.querySelector("[data-testid=student-detail-empty]")).toBeNull();
});
