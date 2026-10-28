/**
 * @jest-environment jsdom
 *
 * Performance Operation 1: Classes no longer waits for assignment-registry
 * hydration.
 *
 * The seam here is built exactly as the entry point builds it: a real
 * session registry behind the real hydration controller, with the
 * `assignmentsTeacherList` response held in a controlled deferred promise.
 * The tests prove that Classes is usable while that promise is unresolved,
 * that the class Assignments region reads "loading" (never "No assignments
 * yet.") until it settles, and that settling refills only that region.
 */
import { renderClassesSurface, type ClassesSurfaceDeps } from "./classes";
import type { AssignmentDetailOpenOptions, CurriculumAssignmentDetailSeam } from "./curriculum";
import type { StudentDetailHistorySeam } from "./classes";
import type { AssignmentDetailClassSwitcher } from "../../assignments/detail/class-switcher";
import { renderAssignmentDetail } from "../../assignments/detail/detail";
import type { AssignmentRegistryReadiness } from "../../assignments/detail/hydration";
import type { AssessmentStudentAssignmentsForClassCallable } from "../../assignments/detail/studentAssignments-wire";
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { AssignmentDetailMetadata } from "../../assignments/detail/types";
import type { AttemptsListForClassCallable } from "../../assignments/detail/attempts-wire";
import { createAssignmentDetailRegistry } from "../../assignments/detail/registry";
import { createAssignmentRegistryHydration } from "../../assignments/detail/hydration";
import { _resetActiveAssignmentsSessionStateForTest } from "./shared/activeAssignments";
import { watchRegistryReadiness } from "./shared/registryReadiness";

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (err: unknown) => void;
};
const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const teacher: Extract<Session, { kind: "activeTeacher" }> = Object.freeze({
  kind: "activeTeacher",
  uid: "teacher-1",
  schoolId: "school-1",
  displayName: "Ms. Teacher",
});

const classes: ReadonlyArray<ClassSummary> = Object.freeze([
  Object.freeze({ id: "c1", title: "6A Life Science", status: "active" as const, grade: "6", block: "A" }),
  Object.freeze({ id: "c2", title: "7B Systems", status: "active" as const, grade: "7", block: "B" }),
]);

const a1: AssignmentDetailMetadata = Object.freeze({
  assignmentId: "a1",
  title: "Earth's Layers - Check for Understanding",
  status: "published" as const,
  className: "6A Life Science",
  classId: "c1",
  lessonSlug: "earths-layers",
  publishedAt: 3000,
});

type Items = ReadonlyArray<AssignmentDetailMetadata>;

// The entry point's seam, minus Firebase: registry + hydration controller.
const makeEntryPointSeam = () => {
  const registry = createAssignmentDetailRegistry();
  const hydration = createAssignmentRegistryHydration(registry);
  const responses: Array<Deferred<Items>> = [];
  const list = jest.fn(() => {
    const d = deferred<Items>();
    responses.push(d);
    return d.promise;
  });
  let runToken = 0;
  const bootstrapTeacher = (): void => {
    const token = ++runToken;
    hydration.start(
      { uid: teacher.uid, schoolId: teacher.schoolId, generation: token, isCurrent: () => token === runToken },
      list,
    );
  };
  const opened: string[] = [];
  const openOptions: Array<AssignmentDetailOpenOptions | undefined> = [];
  // Counts live subscriptions so detach-time disposal is observable.
  let active = 0;
  let created = 0;
  const readiness: AssignmentRegistryReadiness = {
    ...hydration.readiness,
    subscribe: (listener) => {
      active += 1;
      created += 1;
      const off = hydration.readiness.subscribe(listener);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        active -= 1;
        off();
      };
    },
  };
  const seam: CurriculumAssignmentDetailSeam = {
    register: (m) => {
      hydration.writer()(m);
    },
    open: (id, options) => {
      opened.push(id);
      openOptions.push(options);
    },
    list: () => registry.list(),
    registryStatus: readiness,
  };
  return {
    seam,
    hydration,
    list,
    responses,
    bootstrapTeacher,
    opened,
    openOptions,
    activeSubscriptions: () => active,
    createdSubscriptions: () => created,
  };
};

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const q = (root: ParentNode, testid: string): HTMLElement | null =>
  root.querySelector<HTMLElement>(`[data-testid=${testid}]`);

const openClass = (mount: HTMLElement, classId: string): void => {
  q(mount, `class-card-${classId}`)!.click();
};

const deps = (
  seam: CurriculumAssignmentDetailSeam,
  overrides: Partial<ClassesSurfaceDeps> = {},
): ClassesSurfaceDeps => ({
  listClasses: async () => classes,
  assignmentDetail: seam,
  ...overrides,
});

beforeEach(() => {
  _resetActiveAssignmentsSessionStateForTest();
  document.body.textContent = "";
});

describe("Classes is usable while assignment hydration is pending", () => {
  test("the class list loads and a class opens before the deferred enumeration resolves", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const listClasses = jest.fn(async () => classes);
    const mount = mkMount();
    renderClassesSurface(mount, teacher, deps(h.seam, { listClasses }));
    // Class-list loading begins independently of hydration.
    expect(listClasses).toHaveBeenCalledTimes(1);
    expect(h.list).toHaveBeenCalledTimes(1);
    await flush();

    expect(h.hydration.status()).toBe("pending");
    expect(q(mount, "class-card-c1")).not.toBeNull();
    expect(q(mount, "class-card-c2")).not.toBeNull();

    openClass(mount, "c1");
    await flush();
    expect(q(mount, "class-workspace")?.getAttribute("data-class-id")).toBe("c1");
    expect(q(mount, "class-nav-roster")).not.toBeNull();

    // The assignment-dependent region reads loading, never the empty state.
    const loading = q(mount, "class-assignments-loading");
    expect(loading).not.toBeNull();
    expect(loading!.getAttribute("role")).toBe("status");
    expect(loading!.textContent).toBe("Loading assignments…");
    expect(q(mount, "class-assignments-empty")).toBeNull();
    expect(mount.textContent).not.toContain("No assignments yet.");

    // Still pending: nothing above depended on the enumeration settling.
    expect(h.hydration.status()).toBe("pending");
  });

  test("hydration remaining pending indefinitely never blocks class navigation", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const mount = mkMount();
    renderClassesSurface(mount, teacher, deps(h.seam));
    await flush();
    openClass(mount, "c1");
    await flush();
    q(mount, "class-workspace-back")!.click();
    await flush();
    openClass(mount, "c2");
    await flush();
    expect(q(mount, "class-workspace")?.getAttribute("data-class-id")).toBe("c2");
    expect(q(mount, "class-assignments-loading")).not.toBeNull();
    for (let i = 0; i < 5; i += 1) await flush();
    expect(q(mount, "class-assignments-loading")).not.toBeNull();
    expect(h.list).toHaveBeenCalledTimes(1);
  });
});

describe("loading -> ready / unavailable transitions", () => {
  test("success refills only the Assignments region; headline, focus, and workspace are not remounted", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const mount = mkMount();
    renderClassesSurface(mount, teacher, deps(h.seam));
    await flush();
    openClass(mount, "c1");
    await flush();

    const workspace = q(mount, "class-workspace");
    const headline = q(mount, "surface-headline");
    const back = q(mount, "class-workspace-back") as HTMLButtonElement;
    back.focus();
    expect(document.activeElement).toBe(back);

    h.responses[0]!.resolve([a1]);
    await flush();

    expect(q(mount, "class-assignments-loading")).toBeNull();
    expect(q(mount, "active-assignment-card-a1")).not.toBeNull();
    expect(q(mount, "class-workspace")).toBe(workspace);
    expect(q(mount, "surface-headline")).toBe(headline);
    expect(document.activeElement).toBe(back);
  });

  test("a successful EMPTY enumeration then shows the genuine empty state", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const mount = mkMount();
    renderClassesSurface(mount, teacher, deps(h.seam));
    await flush();
    openClass(mount, "c1");
    await flush();
    expect(q(mount, "class-assignments-empty")).toBeNull();
    h.responses[0]!.resolve([]);
    await flush();
    expect(q(mount, "class-assignments-loading")).toBeNull();
    expect(q(mount, "class-assignments-empty")?.textContent).toBe("No assignments yet.");
  });

  test("failure shows unavailable (not empty) with Try again; retry recovers in place", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const mount = mkMount();
    renderClassesSurface(mount, teacher, deps(h.seam));
    await flush();
    openClass(mount, "c1");
    await flush();

    h.responses[0]!.reject(new Error("outage"));
    await flush();
    expect(q(mount, "class-assignments-unavailable")).not.toBeNull();
    expect(q(mount, "class-assignments-empty")).toBeNull();
    // The rest of the workspace stays usable.
    expect(q(mount, "class-nav-roster")).not.toBeNull();

    const retry = q(mount, "class-assignments-retry") as HTMLButtonElement;
    retry.focus();
    retry.click();
    expect(h.list).toHaveBeenCalledTimes(2);
    expect(q(mount, "class-assignments-loading")).not.toBeNull();
    // Focus that sat on the replaced Try again control stays in the section.
    expect(document.activeElement).toBe(q(mount, "surface-headline"));

    h.responses[1]!.resolve([a1]);
    await flush();
    expect(q(mount, "active-assignment-card-a1")).not.toBeNull();
  });

  test("a ready registry renders the assignments immediately with no loading state", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    h.responses[0]!.resolve([a1]);
    await flush();
    const mount = mkMount();
    renderClassesSurface(mount, teacher, deps(h.seam));
    await flush();
    openClass(mount, "c1");
    await flush();
    expect(q(mount, "class-assignments-loading")).toBeNull();
    expect(q(mount, "active-assignment-card-a1")).not.toBeNull();
  });
});

describe("navigation during hydration", () => {
  test("remounting the surface never re-enumerates, and a detached surface is never updated", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const first = mkMount();
    renderClassesSurface(first, teacher, deps(h.seam));
    await flush();
    openClass(first, "c1");
    await flush();
    const staleRegion = q(first, "class-assignments-region")!;
    // Navigate away: the shell replaces the outlet's content.
    first.remove();

    const second = mkMount();
    renderClassesSurface(second, teacher, deps(h.seam));
    await flush();
    openClass(second, "c1");
    await flush();
    expect(h.list).toHaveBeenCalledTimes(1);

    h.responses[0]!.resolve([a1]);
    await flush();
    expect(q(second, "active-assignment-card-a1")).not.toBeNull();
    // The detached region kept its loading content; it was never refilled.
    expect(q(staleRegion, "class-assignments-loading")).not.toBeNull();
    expect(q(staleRegion, "active-assignment-card-a1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Student Detail (audit correction 7): student work never waits for the
// registry; the registry only enriches it afterward.
// ---------------------------------------------------------------------------

const aliceAttempt = {
  attemptId: "t1",
  studentId: "s-alice",
  studentDisplayName: "Alice Adams",
  assignmentId: "a1",
  attemptNumber: 1,
  score: 8,
  maxScore: 10,
  percentage: 80,
  submittedAt: 1700000000000,
};

const openAliceDetail = async (
  h: ReturnType<typeof makeEntryPointSeam>,
  expected: AssessmentStudentAssignmentsForClassCallable | null,
): Promise<HTMLElement> => {
  const loadAttempts: AttemptsListForClassCallable = async (input) => ({
    classId: input.classId,
    attempts: [aliceAttempt],
  });
  const mount = mkMount();
  renderClassesSurface(
    mount,
    teacher,
    deps(h.seam, {
      loadRoster: () => async (input: { classId: string }) => ({
        classId: input.classId,
        students: [{ studentId: "s-alice", studentDisplayName: "Alice Adams" }],
      }),
      loadAttempts: () => loadAttempts,
      loadExpectedAssignments: expected === null ? null : () => expected,
    }),
  );
  await flush();
  openClass(mount, "c1");
  await flush();
  q(mount, "class-nav-roster")!.click();
  await flush();
  await flush();
  mount.querySelector<HTMLButtonElement>('[data-student-id="s-alice"]')!.click();
  await flush();
  await flush();
  return mount;
};

// The server's grouped response carries the authoritative title.
const groupedExpected: AssessmentStudentAssignmentsForClassCallable = async () => ({
  classId: "c1",
  studentId: "s-alice",
  assignments: [{ assignmentId: "a1", hasLiveSession: false }],
  groups: [
    {
      resolution: "valid",
      lessonSlug: "earths-layers",
      operationalAssignmentId: "a1",
      assignmentIds: ["a1"],
      title: "Earth's Layers - Server Title",
      status: "published",
      publishedAt: 3000,
      hasLiveSession: false,
      isOperationalRecipient: true,
    },
  ],
}) as never;

describe("Student Detail renders student work without waiting for the registry", () => {
  test("hydration pending indefinitely: authoritative grouped work still appears", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const mount = await openAliceDetail(h, groupedExpected);
    expect(h.hydration.status()).toBe("pending");
    expect(q(mount, "student-detail-loading")).toBeNull();
    expect(q(mount, "student-detail-empty")).toBeNull();
    expect(mount.textContent).toContain("Earth's Layers - Server Title");
  });

  test("late enrichment: work shown first, then registry metadata fills in once ready", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    // No grouped response: the per-assignment path titles from the registry.
    const mount = await openAliceDetail(h, null);
    expect(q(mount, "student-detail-loading")).toBeNull();
    expect(mount.textContent).not.toContain("Earth's Layers - Check for Understanding");
    h.responses[0]!.resolve([a1]);
    await flush();
    await flush();
    expect(mount.textContent).toContain("Earth's Layers - Check for Understanding");
    expect(h.activeSubscriptions()).toBe(0);
  });

  test("hydration failure: valid student work stays visible", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const mount = await openAliceDetail(h, groupedExpected);
    const before = mount.textContent;
    h.responses[0]!.reject(new Error("outage"));
    await flush();
    await flush();
    expect(mount.textContent).toBe(before);
    expect(mount.textContent).toContain("Earth's Layers - Server Title");
    expect(q(mount, "student-detail-error")).toBeNull();
  });

  test("an empty registry adds nothing and does not re-render the list", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const mount = await openAliceDetail(h, groupedExpected);
    const list = q(mount, "student-detail")!.querySelector("ul, ol");
    h.responses[0]!.resolve([]);
    await flush();
    await flush();
    expect(q(mount, "student-detail")!.querySelector("ul, ol")).toBe(list);
  });
});

// ---------------------------------------------------------------------------
// Sol re-audit: late enrichment must not destroy an active review.
// ---------------------------------------------------------------------------

const a2: AssignmentDetailMetadata = Object.freeze({
  assignmentId: "a2",
  title: "Plate Tectonics - Check for Understanding",
  status: "published" as const,
  className: "6A Life Science",
  classId: "c1",
  lessonSlug: "plate-tectonics",
  publishedAt: 2000,
});

const attemptOf = (attemptId: string, assignmentId: string, attemptNumber: number, percentage: number) => ({
  attemptId,
  studentId: "s-alice",
  studentDisplayName: "Alice Adams",
  assignmentId,
  attemptNumber,
  score: Math.round(percentage / 10),
  maxScore: 10,
  percentage,
  submittedAt: 1700000000000 + attemptNumber * 1000 + (assignmentId === "a2" ? 100 : 0),
});

// Per-attempt detail: each attempt has its own correct count and response.
const correctByAttempt: Record<string, number> = { t1: 2, t2: 1, t3: 3 };
const attemptDetailFor = (attemptId: string) => ({
  attemptId,
  studentId: "s-alice",
  assignmentId: attemptId === "t1" ? "a1" : "a2",
  attemptNumber: attemptId === "t3" ? 2 : 1,
  percentage: 50,
  writtenResponse: `Response for ${attemptId}`,
  itemResults: [1, 2, 3].map((n) => ({
    itemId: `q${n}`,
    isCorrect: n <= correctByAttempt[attemptId]!,
    correctOptionId: "A",
    studentResponse: "A",
    explanation: "",
  })),
});

const openTwoCardDetail = async (h: ReturnType<typeof makeEntryPointSeam>) => {
  const loadAttempts: AttemptsListForClassCallable = async (input) => ({
    classId: input.classId,
    attempts: [
      attemptOf("t1", "a1", 1, 80),
      attemptOf("t2", "a2", 1, 40),
      attemptOf("t3", "a2", 2, 90),
    ],
  });
  const mount = mkMount();
  renderClassesSurface(
    mount,
    teacher,
    deps(h.seam, {
      loadRoster: () => async (input: { classId: string }) => ({
        classId: input.classId,
        students: [{ studentId: "s-alice", studentDisplayName: "Alice Adams" }],
      }),
      loadAttempts: () => loadAttempts,
      loadAttemptDetail: () => (async (input: { attemptId: string }) => attemptDetailFor(input.attemptId)) as never,
    }),
  );
  await flush();
  openClass(mount, "c1");
  await flush();
  q(mount, "class-nav-roster")!.click();
  await flush();
  await flush();
  mount.querySelector<HTMLButtonElement>('[data-student-id="s-alice"]')!.click();
  await flush();
  await flush();
  return mount;
};

const cardFor = (mount: HTMLElement, assignmentId: string): HTMLElement =>
  mount.querySelector<HTMLElement>(`[data-testid=student-detail-assignments] > [data-assignment-id="${assignmentId}"]`)!;

describe("late enrichment preserves an active Student Detail review", () => {
  test("open review, selected attempt, disclosure, and focus on the SECOND card all survive hydration", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const mount = await openTwoCardDetail(h);

    // Student work is visible before hydration.
    expect(h.hydration.status()).toBe("pending");
    const first = cardFor(mount, "a1");
    const second = cardFor(mount, "a2");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    const titleOf = (card: HTMLElement) =>
      card.querySelector("[data-testid=student-detail-assignment-title]")!.textContent;
    expect(titleOf(second)).toBe("Assignment");

    // The teacher works on the second card: Show Your Thinking, then
    // Review questions with the first (older) attempt selected.
    const thinkingToggle = second.querySelector<HTMLButtonElement>("[data-testid=student-detail-thinking-toggle]")!;
    thinkingToggle.click();
    await flush();
    await flush();
    const reviewToggle = second.querySelector<HTMLButtonElement>("[data-testid=student-detail-review-toggle]")!;
    reviewToggle.click();
    await flush();
    await flush();
    const select = second.querySelector<HTMLSelectElement>("[data-testid=student-detail-review-select]")!;
    select.value = "0";
    select.dispatchEvent(new Event("change"));
    await flush();
    await flush();
    const summary = () =>
      second.querySelector("[data-testid=student-detail-review-summary]")?.textContent ?? null;
    expect(summary()).toBe("1 of 3 correct");
    const thinkingText = second.querySelector("[data-testid=student-detail-thinking]")!.textContent;
    expect(thinkingText).toContain("Response for t2");
    select.focus();
    expect(document.activeElement).toBe(select);

    // Hydration lands with metadata for both cards.
    h.responses[0]!.resolve([a1, a2]);
    await flush();
    await flush();

    // Same card elements: nothing was rebuilt.
    expect(cardFor(mount, "a2")).toBe(second);
    expect(cardFor(mount, "a1")).toBe(first);
    // Disclosures stay open with their content.
    expect(thinkingToggle.getAttribute("aria-expanded")).toBe("true");
    expect(second.querySelector("[data-testid=student-detail-thinking]")!.textContent).toBe(thinkingText);
    expect(reviewToggle.getAttribute("aria-expanded")).toBe("true");
    expect(second.querySelector<HTMLElement>("[data-testid=student-detail-review]")!.hidden).toBe(false);
    // The selected attempt and its review content are unchanged.
    expect(second.querySelector<HTMLSelectElement>("[data-testid=student-detail-review-select]")).toBe(select);
    expect(select.value).toBe("0");
    expect(summary()).toBe("1 of 3 correct");
    // Focus is still on the second card's control, not the first card's.
    expect(document.activeElement).toBe(select);
    expect(first.contains(document.activeElement)).toBe(false);
    // Metadata updated in place.
    expect(titleOf(second)).toBe("Plate Tectonics - Check for Understanding");
    expect(titleOf(first)).toBe("Earth's Layers - Check for Understanding");
    expect(second.querySelector("[data-testid=student-detail-assignment-meta-a2]")).not.toBeNull();
    expect(h.activeSubscriptions()).toBe(0);
  });

  test("a detached Student Detail receives no late DOM updates", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const mount = await openTwoCardDetail(h);
    const second = cardFor(mount, "a2");
    mount.remove();
    await flush();
    expect(h.activeSubscriptions()).toBe(0);
    h.responses[0]!.resolve([a1, a2]);
    await flush();
    await flush();
    expect(second.querySelector("[data-testid=student-detail-assignment-title]")!.textContent).toBe("Assignment");
    expect(second.querySelector("[data-testid=student-detail-assignment-meta-a2]")).toBeNull();
  });
});

describe("a stale Student Detail response installs no watch", () => {
  test("leaving before student work resolves: no subscription or observer is retained", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const held = deferred<{ classId: string; attempts: typeof aliceAttempt[] }>();
    const loadAttempts: AttemptsListForClassCallable = () => held.promise as never;
    const observe = jest.spyOn(MutationObserver.prototype, "observe");
    const disconnect = jest.spyOn(MutationObserver.prototype, "disconnect");
    try {
      const mount = mkMount();
      renderClassesSurface(
        mount,
        teacher,
        deps(h.seam, {
          loadRoster: () => async (input: { classId: string }) => ({
            classId: input.classId,
            students: [{ studentId: "s-alice", studentDisplayName: "Alice Adams" }],
          }),
          loadAttempts: () => loadAttempts,
        }),
      );
      await flush();
      openClass(mount, "c1");
      await flush();
      q(mount, "class-nav-roster")!.click();
      await flush();
      await flush();
      mount.querySelector<HTMLButtonElement>('[data-student-id="s-alice"]')!.click();
      await flush();
      expect(q(mount, "student-detail-loading")).not.toBeNull();
      // Navigate away (the surface leaves the document).
      mount.remove();
      await flush();
      const createdBefore = h.createdSubscriptions();
      const observesBefore = observe.mock.calls.length;
      // Student work resolves late; hydration is still pending.
      held.resolve({ classId: "c1", attempts: [aliceAttempt] });
      await flush();
      await flush();
      expect(h.hydration.status()).toBe("pending");
      // No watch was even installed for the stale response.
      expect(h.createdSubscriptions()).toBe(createdBefore);
      expect(observe.mock.calls.length).toBe(observesBefore);
      expect(h.activeSubscriptions()).toBe(0);
    } finally {
      observe.mockRestore();
      disconnect.mockRestore();
    }
  });
});

describe("the shared readiness watch never retains a detached owner", () => {
  test("an owner that is never attached is released after the render pass", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const owner = document.createElement("div");
    watchRegistryReadiness(owner, h.seam.registryStatus!, () => undefined);
    expect(h.activeSubscriptions()).toBe(1);
    await flush();
    expect(h.activeSubscriptions()).toBe(0);
  });

  test("an owner attached in the same render pass stays watched and receives updates", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const owner = document.createElement("div");
    const seen: string[] = [];
    watchRegistryReadiness(owner, h.seam.registryStatus!, (status) => seen.push(status));
    document.body.appendChild(owner);
    await flush();
    expect(h.activeSubscriptions()).toBe(1);
    h.responses[0]!.resolve([]);
    await flush();
    expect(seen).toEqual(["ready"]);
    expect(h.activeSubscriptions()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// History restore of a class's Assignment Detail (audit correction 5).
// ---------------------------------------------------------------------------

type HistoryController = Parameters<StudentDetailHistorySeam["registerController"]>[0];

const mountWithHistory = async (h: ReturnType<typeof makeEntryPointSeam>) => {
  let controller: HistoryController | null = null;
  const notify = jest.fn();
  const studentDetailHistory: StudentDetailHistorySeam = {
    notify,
    registerController: (c) => {
      controller = c;
    },
  };
  const mount = mkMount();
  renderClassesSurface(mount, teacher, deps(h.seam, { studentDetailHistory }));
  await flush();
  openClass(mount, "c1");
  await flush();
  notify.mockClear();
  return { mount, notify, controller: () => controller as unknown as HistoryController };
};

describe("restoring a class's Assignment Detail while the registry hydrates", () => {
  test("pending: the intent is held and opens Detail once hydration lands, adding no history entry", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const { notify, controller } = await mountWithHistory(h);
    expect(controller().restoreAssignmentDetail("c1", "a1")).toBe(false);
    expect(h.opened).toEqual([]);
    h.responses[0]!.resolve([a1]);
    await flush();
    await flush();
    expect(h.opened).toEqual(["a1"]);
    expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "enter-assignment-detail" }));
    expect(h.activeSubscriptions()).toBe(0);
  });

  test("ready: restores synchronously exactly as before", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    h.responses[0]!.resolve([a1]);
    await flush();
    const { controller } = await mountWithHistory(h);
    expect(controller().restoreAssignmentDetail("c1", "a1")).toBe(true);
    expect(h.opened).toEqual(["a1"]);
  });

  test("canceled by newer navigation inside Classes (a click)", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const { mount, controller } = await mountWithHistory(h);
    controller().restoreAssignmentDetail("c1", "a1");
    q(mount, "class-nav-roster")!.click();
    h.responses[0]!.resolve([a1]);
    await flush();
    await flush();
    expect(h.opened).toEqual([]);
    expect(q(mount, "class-workspace")?.getAttribute("data-class-tab")).toBe("roster");
  });

  test("canceled by a newer history restore", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const { controller } = await mountWithHistory(h);
    controller().restoreAssignmentDetail("c1", "a1");
    controller().restoreToTopList();
    h.responses[0]!.resolve([a1]);
    await flush();
    await flush();
    expect(h.opened).toEqual([]);
  });

  test("canceled when Classes leaves the document (another surface, or a new bootstrap context)", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const { mount, controller } = await mountWithHistory(h);
    controller().restoreAssignmentDetail("c1", "a1");
    mount.remove();
    await flush();
    expect(h.activeSubscriptions()).toBe(0);
    h.responses[0]!.resolve([a1]);
    await flush();
    await flush();
    expect(h.opened).toEqual([]);
  });

  test("a new bootstrap generation never completes the old intent", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const { controller } = await mountWithHistory(h);
    controller().restoreAssignmentDetail("c1", "a1");
    h.bootstrapTeacher(); // account/school switch or re-bootstrap
    h.responses[1]!.resolve([a1]);
    h.responses[0]!.resolve([a1]);
    await flush();
    await flush();
    expect(h.opened).toEqual([]);
  });

  test("a genuinely missing assignment stays on the class's Assignments section", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const { mount, controller } = await mountWithHistory(h);
    controller().restoreAssignmentDetail("c1", "a-missing");
    h.responses[0]!.resolve([a1]);
    await flush();
    await flush();
    expect(h.opened).toEqual([]);
    expect(q(mount, "active-assignment-card-a1")).not.toBeNull();
  });

  test("hydration failure cancels the intent; the section offers Try again instead", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const { mount, controller } = await mountWithHistory(h);
    controller().restoreAssignmentDetail("c1", "a1");
    h.responses[0]!.reject(new Error("outage"));
    await flush();
    expect(q(mount, "class-assignments-retry")).not.toBeNull();
    h.hydration.retry();
    h.responses[1]!.resolve([a1]);
    await flush();
    await flush();
    expect(h.opened).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Class switcher readiness (audit correction 6).
// ---------------------------------------------------------------------------

const a1InC2: AssignmentDetailMetadata = Object.freeze({
  ...a1,
  assignmentId: "a1-c2",
  className: "7B Systems",
  classId: "c2",
});

const openSwitcherDetail = async (h: ReturnType<typeof makeEntryPointSeam>) => {
  const { controller } = await mountWithHistory(h);
  // An in-session publish makes a1 openable before hydration lands.
  h.seam.register(a1);
  expect(controller().restoreAssignmentDetail("c1", "a1")).toBe(true);
  const switcher = h.openOptions[0]!.classSwitcher!;
  return switcher;
};

// The real Assignment Detail surface, rendered with the switcher Classes
// handed to `open`, into its own host (as the shell outlet would).
const renderSwitcherDetail = (switcher: AssignmentDetailClassSwitcher): HTMLElement => {
  const host = mkMount();
  renderAssignmentDetail(host, {
    assignmentId: "a1",
    loadMetadata: async () => a1,
    summaryCallable: () => new Promise(() => undefined),
    classSwitcher: switcher,
  });
  return host;
};

describe("class switcher reflects both the class list and the registry", () => {
  test("pending: options unreported; the open Detail upgrades to the switcher after hydration", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const switcher = await openSwitcherDetail(h);
    expect(switcher.options(a1)).toBeNull();
    const detail = renderSwitcherDetail(switcher);
    await flush();
    await flush();
    expect(q(detail, "assignment-detail-class-switcher")).toBeNull();
    expect(q(detail, "assignment-detail-class-value")?.textContent).toBe("6A Life Science");
    h.responses[0]!.resolve([a1, a1InC2]);
    await flush();
    await flush();
    expect(q(detail, "assignment-detail-class-switcher")).not.toBeNull();
    expect(switcher.options(a1)!.map((o) => o.classId)).toContain("c2");
    expect(h.list).toHaveBeenCalledTimes(1);
    expect(h.activeSubscriptions()).toBe(0);
  });

  test("failure keeps options unreported; recovery through retry upgrades the open Detail", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const switcher = await openSwitcherDetail(h);
    const detail = renderSwitcherDetail(switcher);
    await flush();
    await flush();
    h.responses[0]!.reject(new Error("outage"));
    await flush();
    await flush();
    expect(switcher.options(a1)).toBeNull();
    expect(q(detail, "assignment-detail-class-switcher")).toBeNull();
    h.hydration.retry();
    h.responses[1]!.resolve([a1, a1InC2]);
    await flush();
    await flush();
    expect(q(detail, "assignment-detail-class-switcher")).not.toBeNull();
    expect(switcher.options(a1)!.map((o) => o.classId)).toContain("c2");
  });

  test("leaving Detail while pending releases its subscription; repeat visits never accumulate", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const switcher = await openSwitcherDetail(h);
    // Only the Classes region existed before Detail; Classes detaches when
    // Detail opens, as in the shell.
    const baseline = h.activeSubscriptions();
    for (let visit = 0; visit < 3; visit += 1) {
      const detail = renderSwitcherDetail(switcher);
      await flush();
      await flush();
      expect(h.activeSubscriptions()).toBe(baseline + 1);
      detail.remove();
      await flush();
      expect(h.activeSubscriptions()).toBe(baseline);
    }
    expect(h.hydration.status()).toBe("pending");
    // A Detail open now still upgrades correctly when hydration lands.
    const active = renderSwitcherDetail(switcher);
    await flush();
    await flush();
    h.responses[0]!.resolve([a1, a1InC2]);
    await flush();
    await flush();
    expect(q(active, "assignment-detail-class-switcher")).not.toBeNull();
  });

  test("ready at mount: options are immediate", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    h.responses[0]!.resolve([a1, a1InC2]);
    await flush();
    const switcher = await openSwitcherDetail(h);
    expect(switcher.options(a1)!.map((o) => o.classId)).toContain("c2");
    const detail = renderSwitcherDetail(switcher);
    await flush();
    await flush();
    expect(q(detail, "assignment-detail-class-switcher")).not.toBeNull();
    expect(h.activeSubscriptions()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Detached subscriptions (audit correction 9).
// ---------------------------------------------------------------------------

describe("detached Classes regions dispose their subscriptions", () => {
  test("leaving the Assignments section disposes its watch without any hydration event", async () => {
    const h = makeEntryPointSeam();
    h.bootstrapTeacher();
    const mount = mkMount();
    renderClassesSurface(mount, teacher, deps(h.seam));
    await flush();
    openClass(mount, "c1");
    await flush();
    expect(h.activeSubscriptions()).toBe(1);
    q(mount, "class-nav-roster")!.click();
    await flush();
    expect(h.activeSubscriptions()).toBe(0);
    expect(h.hydration.status()).toBe("pending");
  });
});
