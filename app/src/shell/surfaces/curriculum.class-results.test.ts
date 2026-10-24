/**
 * @jest-environment jsdom
 *
 * Class Results: the lesson Results page lists each assigned class beneath
 * the four lesson metrics, using the server's per-class `classes` rows of the
 * certified `assessmentLessonSummary` callable. Results opens the class's
 * EXISTING Assignment Detail (chosen like the class switcher, never a guess),
 * and Back from Detail re-enters the same Results page. Results opened from
 * My Units returns there.
 */
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import type { AssignmentDetailMetadata } from "../../assignments/detail/types";
import type {
  LessonClassResult,
  LessonResults,
  LessonResultsCallable,
} from "../../assignments/summary/lessonResults";
import { parseLessonResults } from "../../assignments/summary/lessonResults";
import {
  renderCurriculumSurface,
  _resetCurriculumSessionStateForTest,
  type AssignmentDetailOpenOptions,
  type LessonResultsIntent,
} from "./curriculum";
import { renderLessonSummarySurface } from "./lessonSummary";

const freeze = <T>(v: T): T => Object.freeze(v) as T;
const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await flush();
};

const teacher: Extract<Session, { kind: "activeTeacher" }> = freeze({
  kind: "activeTeacher",
  uid: "u-teacher",
  schoolId: "school-abc",
  displayName: "Ada Lovelace",
});

// Saved class order: 7B first, then 6A.
const classes: ReadonlyArray<ClassSummary> = freeze([
  freeze({ id: "c2", title: "7B", grade: "7", status: "active" }),
  freeze({ id: "c1", title: "6A", grade: "6", status: "active" }),
] as ClassSummary[]);
const listClasses: ListClasses = () => Promise.resolve(classes);

const SLUG = "earths-layers";

const row = (over: Partial<LessonClassResult> & { classId: string }): LessonClassResult =>
  freeze({
    students: 0,
    studentsCompleted: 0,
    completionPercentage: 0,
    averageBestPercentage: null,
    assignmentsConsidered: 1,
    ...over,
  });

const results = (over: Partial<LessonResults> = {}): LessonResults =>
  freeze({
    lessonSlug: SLUG,
    classesAssigned: 2,
    students: 30,
    studentsCompleted: 12,
    completionPercentage: 40,
    averageBestPercentage: 81,
    assignmentsConsidered: 3,
    ...over,
  });

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const q = (root: ParentNode, id: string): HTMLElement | null =>
  root.querySelector<HTMLElement>(`[data-testid=${id}]`);
const text = (root: ParentNode, id: string): string | null => q(root, id)?.textContent ?? null;

const meta = (
  assignmentId: string,
  classId: string,
  status: AssignmentDetailMetadata["status"] = "published",
): AssignmentDetailMetadata =>
  freeze({
    assignmentId,
    title: "Earth's Layers",
    className: classId === "c1" ? "6A" : classId === "c2" ? "7B" : "Old class",
    status,
    lessonSlug: SLUG,
    classId,
  });

beforeEach(() => {
  _resetCurriculumSessionStateForTest();
  document.body.textContent = "";
});

// ---------------------------------------------------------------------------
// Surface states (renderLessonSummarySurface)
// ---------------------------------------------------------------------------

const renderSurface = async (
  payload: LessonResults | Error,
  seam?: Parameters<typeof renderLessonSummarySurface>[1]["classResults"],
) => {
  const host = mkMount();
  const calls: string[] = [];
  const callable: LessonResultsCallable = (input) => {
    calls.push(input.lessonSlug);
    return payload instanceof Error ? Promise.reject(payload) : Promise.resolve(payload);
  };
  const handle = renderLessonSummarySurface(host, {
    doc: document,
    lessonTitle: "Earth's Layers",
    lessonSlug: SLUG,
    lessonSummary: callable,
    onBack: () => undefined,
    ...(seam === undefined ? {} : { classResults: seam }),
  });
  await settle();
  return { host, handle, calls };
};

const describeFromList = (classId: string) => {
  const index = classes.findIndex((c) => c.id === classId);
  const c = classes[index];
  return c === undefined ? null : { name: c.title, order: index };
};

describe("Class Results surface", () => {
  test("keeps the four lesson metrics and adds a Class Results section beneath them", async () => {
    const { host } = await renderSurface(
      results({ classes: [row({ classId: "c1", students: 25, studentsCompleted: 10, completionPercentage: 40, averageBestPercentage: 78 })] }),
      { describe: describeFromList },
    );
    expect(text(host, "lesson-summary-value-classes")).toBe("2");
    expect(text(host, "lesson-summary-value-students")).toBe("30");
    expect(text(host, "lesson-summary-value-completion")).toBe("40%");
    expect(text(host, "lesson-summary-value-average")).toBe("81%");
    const section = q(host, "lesson-class-results")!;
    expect(section.querySelector("h3")?.textContent).toBe("Class Results");
    // Section follows the metrics.
    const metrics = q(host, "lesson-summary-metrics")!;
    expect(metrics.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("single class: name, students, completed fraction, percentage, average best", async () => {
    const { host } = await renderSurface(
      results({
        classesAssigned: 1,
        classes: [row({ classId: "c1", students: 25, studentsCompleted: 10, completionPercentage: 40, averageBestPercentage: 78 })],
      }),
      { describe: describeFromList },
    );
    const li = q(host, "lesson-class-result-c1")!;
    expect(li.querySelector("h4")?.textContent).toBe("6A");
    expect(text(host, "lesson-class-result-students-c1")).toBe("25");
    expect(text(host, "lesson-class-result-completion-c1")).toBe("10 / 25 (40%)");
    expect(text(host, "lesson-class-result-average-c1")).toBe("78%");
    expect(text(host, "lesson-class-result-status-c1")).toBe("Partially complete");
    expect(li.getAttribute("data-participation")).toBe("partial");
  });

  test("multiple classes follow the teacher's saved class order", async () => {
    const { host } = await renderSurface(
      results({ classes: [row({ classId: "c1", students: 2 }), row({ classId: "c2", students: 3 })] }),
      { describe: describeFromList },
    );
    const ids = Array.from(
      q(host, "lesson-class-results-list")!.querySelectorAll("li"),
    ).map((li) => li.getAttribute("data-testid"));
    expect(ids).toEqual(["lesson-class-result-c2", "lesson-class-result-c1"]);
  });

  test("assigned with zero submissions reads 'No submissions yet', never a 0% average", async () => {
    const { host } = await renderSurface(
      results({ classes: [row({ classId: "c1", students: 25 })] }),
      { describe: describeFromList },
    );
    expect(text(host, "lesson-class-result-status-c1")).toBe("No submissions yet");
    // The unavailable average is a named dash, never "0%"; the real 0-of-25
    // completion count is kept.
    const avg = q(host, "lesson-class-result-average-c1")!;
    expect(avg.textContent).toBe("--");
    expect(avg.getAttribute("data-unavailable")).toBe("true");
    expect(avg.querySelector("[role=img]")?.getAttribute("aria-label")).toBe("Not available");
    expect(avg.textContent).not.toMatch(/0%/);
    expect(text(host, "lesson-class-result-completion-c1")).toBe("0 / 25 (0%)");
  });

  test("complete participation and an empty roster are distinct states", async () => {
    const { host } = await renderSurface(
      results({
        classes: [
          row({ classId: "c1", students: 4, studentsCompleted: 4, completionPercentage: 100, averageBestPercentage: 92 }),
          row({ classId: "c2", students: 0 }),
        ],
      }),
      { describe: describeFromList },
    );
    expect(text(host, "lesson-class-result-status-c1")).toBe("All students completed");
    expect(text(host, "lesson-class-result-status-c2")).toBe("No students assigned");
    // An empty roster keeps its status and its real "0" student count; the
    // completion and average metrics are unavailable dashes, not zeros.
    expect(text(host, "lesson-class-result-students-c2")).toBe("0");
    for (const key of ["completion", "average"]) {
      const dd = q(host, `lesson-class-result-${key}-c2`)!;
      expect(dd.textContent).toBe("--");
      expect(dd.querySelector("[role=img]")?.getAttribute("aria-label")).toBe("Not available");
    }
  });

  test("renders the server's best score (multiple attempts are resolved server-side, never recomputed)", async () => {
    const { host } = await renderSurface(
      results({ classes: [row({ classId: "c1", students: 1, studentsCompleted: 1, completionPercentage: 100, averageBestPercentage: 90, assignmentsConsidered: 2 })] }),
      { describe: describeFromList },
    );
    expect(text(host, "lesson-class-result-average-c1")).toBe("90%");
  });

  test("a backend without class rows shows 'unavailable', not an empty list", async () => {
    const { host } = await renderSurface(results(), { describe: describeFromList });
    expect(text(host, "lesson-class-results-unavailable")).toBe(
      "Class results are not available right now.",
    );
    expect(q(host, "lesson-class-results-list")).toBeNull();
  });

  test("rows missing while classes are assigned is treated as unavailable", async () => {
    const { host } = await renderSurface(results({ classes: [] }), { describe: describeFromList });
    expect(q(host, "lesson-class-results-unavailable")).not.toBeNull();
  });

  test("an unassigned lesson says so instead of listing zero rows", async () => {
    const { host } = await renderSurface(
      results({ classesAssigned: 0, students: 0, studentsCompleted: 0, completionPercentage: 0, averageBestPercentage: null, classes: [] }),
      { describe: describeFromList },
    );
    expect(text(host, "lesson-class-results-empty")).toBe(
      "This lesson has not been assigned to a class yet.",
    );
  });

  test("a failed load shows the existing error and retry, with no class rows", async () => {
    const { host } = await renderSurface(new Error("boom"), { describe: describeFromList });
    expect(q(host, "lesson-summary-error")).not.toBeNull();
    expect(q(host, "lesson-class-results")).toBeNull();
  });

  test("only the classes the server returned are listed; an unknown class has no View action", async () => {
    const onView = jest.fn();
    const { host } = await renderSurface(
      results({ classes: [row({ classId: "c1", students: 2 }), row({ classId: "c-unknown", students: 2 })] }),
      { describe: describeFromList, onView },
    );
    expect(host.querySelectorAll(".shell-lesson-class-result")).toHaveLength(2);
    expect(q(host, "lesson-class-result-c-unknown")?.querySelector("h4")?.textContent).toBe("Class");
    expect(q(host, "lesson-class-result-view-c-unknown")).toBeNull();
    const view = q(host, "lesson-class-result-view-c1") as HTMLButtonElement;
    expect(view.textContent).toBe("Results");
    expect(view.getAttribute("aria-label")).toBe("6A results for Earth's Layers");
    view.click();
    expect(onView).toHaveBeenCalledWith("c1", "6A");
  });

  test("refresh re-reads and re-renders the class rows", async () => {
    let completed = 0;
    const host = mkMount();
    const handle = renderLessonSummarySurface(host, {
      doc: document,
      lessonTitle: "Earth's Layers",
      lessonSlug: SLUG,
      lessonSummary: () =>
        Promise.resolve(results({ classes: [row({ classId: "c1", students: 5, studentsCompleted: completed })] })),
      onBack: () => undefined,
      classResults: { describe: describeFromList },
    });
    await settle();
    expect(text(host, "lesson-class-result-status-c1")).toBe("No submissions yet");
    completed = 5;
    handle.refresh();
    await settle();
    expect(text(host, "lesson-class-result-status-c1")).toBe("All students completed");
  });
});

// ---------------------------------------------------------------------------
// Wire parsing
// ---------------------------------------------------------------------------

describe("parseLessonResults", () => {
  const base = {
    lessonSlug: SLUG,
    classesAssigned: 1,
    students: 2,
    studentsCompleted: 1,
    completionPercentage: 50,
    averageBestPercentage: 70,
    assignmentsConsidered: 1,
  };
  test("keeps well-formed class rows (projected to the allowlist)", () => {
    const parsed = parseLessonResults({
      ...base,
      classes: [{ ...row({ classId: "c1", students: 2 }), extra: "dropped" }],
    });
    expect(parsed.classes).toEqual([row({ classId: "c1", students: 2 })]);
  });
  test("drops a malformed breakdown entirely (unavailable, never half-parsed)", () => {
    const parsed = parseLessonResults({
      ...base,
      classes: [row({ classId: "c1" }), { classId: "c2", students: "x" }],
    });
    expect(parsed.classes).toBeUndefined();
  });
  test("an older backend without classes parses as before", () => {
    expect(parseLessonResults(base).classes).toBeUndefined();
  });
  test("a malformed lesson-wide payload still fails loudly", () => {
    expect(() => parseLessonResults({ ...base, students: "x" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Curriculum navigation into and out of class results
// ---------------------------------------------------------------------------

const mountCurriculum = async (opts: {
  readonly registry: ReadonlyArray<AssignmentDetailMetadata>;
  readonly classRows: ReadonlyArray<LessonClassResult>;
  readonly resolveCurrent?: jest.Mock;
  readonly intent?: LessonResultsIntent;
  readonly openOnLoad?: boolean;
}) => {
  const opened: Array<{ id: string; options: AssignmentDetailOpenOptions | undefined }> = [];
  const openLessonResults = jest.fn();
  const returnToMyUnits = jest.fn();
  const mount = mkMount();
  let intent: LessonResultsIntent | null = opts.intent ?? null;
  renderCurriculumSurface(mount, teacher, {
    listClasses,
    assignmentDetail: {
      register: () => undefined,
      open: (id, options) => {
        opened.push({ id, options });
      },
      list: () => opts.registry,
      ...(opts.resolveCurrent === undefined ? {} : { resolveCurrent: opts.resolveCurrent }),
    },
    lessonSummary: () => Promise.resolve(results({ classes: opts.classRows })),
    consumeLessonResultsIntent: () => {
      const i = intent;
      intent = null;
      return i;
    },
    openLessonResults,
    returnToMyUnits,
  });
  await settle();
  if (opts.openOnLoad !== false && opts.intent === undefined) {
    q(mount, `lesson-assign-${SLUG}`)!.click();
    await settle();
  }
  return { mount, opened, openLessonResults, returnToMyUnits };
};

describe("Class Results navigation", () => {
  test("Results opens the class's one published occurrence; Back re-enters Results without a new history entry", async () => {
    const h = await mountCurriculum({
      registry: [meta("a-c1", "c1"), meta("a-c2", "c2")],
      classRows: [row({ classId: "c1", students: 3 }), row({ classId: "c2", students: 2 })],
    });
    (q(h.mount, "lesson-class-result-view-c1") as HTMLButtonElement).click();
    await settle();
    expect(h.opened.map((o) => o.id)).toEqual(["a-c1"]);
    const options = h.opened[0]?.options;
    expect(options?.backLabel).toBe("Back to Results");
    options?.onBack?.();
    expect(h.openLessonResults).toHaveBeenCalledWith({
      lessonSlug: SLUG,
      returnTo: { kind: "curriculum" },
      restore: true,
    });
  });

  test("several published occurrences resolve the class's canonical Current", async () => {
    const resolveCurrent = jest.fn().mockResolvedValue({
      resolution: "valid",
      currentAssignmentId: "a-new",
    });
    const h = await mountCurriculum({
      registry: [meta("a-old", "c1"), meta("a-new", "c1")],
      classRows: [row({ classId: "c1", students: 3 })],
      resolveCurrent,
    });
    (q(h.mount, "lesson-class-result-view-c1") as HTMLButtonElement).click();
    await settle();
    expect(resolveCurrent).toHaveBeenCalledWith({ classId: "c1", lessonSlug: SLUG });
    expect(h.opened.map((o) => o.id)).toEqual(["a-new"]);
  });

  test("an unresolvable Current never guesses; it points the teacher to Classes", async () => {
    const resolveCurrent = jest.fn().mockResolvedValue({
      resolution: "unresolved",
      currentAssignmentId: null,
    });
    const h = await mountCurriculum({
      registry: [meta("a-old", "c1"), meta("a-new", "c1")],
      classRows: [row({ classId: "c1", students: 3 })],
      resolveCurrent,
    });
    (q(h.mount, "lesson-class-result-view-c1") as HTMLButtonElement).click();
    await settle();
    expect(h.opened).toEqual([]);
    expect(text(h.mount, "lesson-summary-status")).toBe(
      "Open 6A under Classes to choose which assignment to review.",
    );
  });

  test("a class with only one closed occurrence opens it", async () => {
    const h = await mountCurriculum({
      registry: [meta("a-closed", "c1", "closed")],
      classRows: [row({ classId: "c1", students: 3 })],
    });
    (q(h.mount, "lesson-class-result-view-c1") as HTMLButtonElement).click();
    await settle();
    expect(h.opened.map((o) => o.id)).toEqual(["a-closed"]);
  });

  test("a class no longer in the class list keeps its registry name", async () => {
    const h = await mountCurriculum({
      registry: [meta("a-old", "c-old")],
      classRows: [row({ classId: "c-old", students: 3 })],
    });
    expect(q(h.mount, "lesson-class-result-c-old")?.querySelector("h4")?.textContent).toBe("Old class");
  });

  test("a Results intent from My Units opens Results with Back to My Units", async () => {
    const unit = { unitId: "unit-1", grade: "7" as const };
    const h = await mountCurriculum({
      registry: [meta("a-c1", "c1")],
      classRows: [row({ classId: "c1", students: 3 })],
      intent: { lessonSlug: SLUG, returnTo: { kind: "units", unit }, restore: false },
    });
    const back = q(h.mount, "lesson-summary-back") as HTMLButtonElement;
    expect(back.textContent).toBe("Back to My Units");
    expect(q(h.mount, "lesson-class-result-c1")).not.toBeNull();
    // The class's Detail returns to these same Results, keeping the origin.
    (q(h.mount, "lesson-class-result-view-c1") as HTMLButtonElement).click();
    await settle();
    h.opened[0]?.options?.onBack?.();
    expect(h.openLessonResults).toHaveBeenCalledWith({
      lessonSlug: SLUG,
      returnTo: { kind: "units", unit },
      restore: true,
    });
    back.click();
    expect(h.returnToMyUnits).toHaveBeenCalledWith(unit);
  });

  test("without the shell seam, Detail keeps its certified default Back", async () => {
    const opened: Array<AssignmentDetailOpenOptions | undefined> = [];
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses,
      assignmentDetail: {
        register: () => undefined,
        open: (_id, options) => {
          opened.push(options);
        },
        list: () => [meta("a-c1", "c1")],
      },
      lessonSummary: () => Promise.resolve(results({ classes: [row({ classId: "c1", students: 1 })] })),
    });
    await settle();
    q(mount, `lesson-assign-${SLUG}`)!.click();
    await settle();
    (q(mount, "lesson-class-result-view-c1") as HTMLButtonElement).click();
    await settle();
    expect(opened).toEqual([{}]);
  });
});
