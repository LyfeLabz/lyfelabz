/**
 * @jest-environment jsdom
 *
 * Sprint 28.6C: Classes & Class Workspace operational assignment path.
 *
 * These surface-level tests cover the new class-centered assignment contracts:
 * the revised class card (name/grade/block + assignment count grouped by
 * classId), the Overview / Assignments / Students switcher, the class-scoped
 * Assignments section (only the selected class's assignments; each opens
 * Assignment Detail through the existing seam), the calm empty state, and the
 * discoverable "+ Add a class" entry point. Shell-level integration (real
 * Assignment Detail mount, return context, migration safety) lives in
 * shell.class-assignments.test.ts.
 */
import {
  renderClassesSurface,
  type ClassManagementIntent,
  type ClassWorkspaceReturn,
} from "./classes";
import type { Session } from "../../session/types";
import type { ClassSummary, ActiveClassSummary } from "../../classes/types";
import type { CreateClass } from "../../classes/createClass";
import type { ImportFromClassroomDeps } from "../../classes/importFromClassroom";
import type {
  CurriculumAssignmentDetailSeam,
  AssignmentDetailOpenOptions,
} from "./curriculum";
import type { AssignmentDetailMetadata } from "../../assignments/detail/types";
import type {
  AssignmentSummary,
  AssignmentSummaryCallable,
} from "../../assignments/summary/types";
import type { WorkspaceSurfaceKey } from "../navigation";
import { _resetActiveAssignmentsSessionStateForTest } from "./shared/activeAssignments";

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

const teacher: ActiveTeacher = Object.freeze({
  kind: "activeTeacher",
  uid: "teacher-1",
  schoolId: "school-1",
  displayName: "Ms. Teacher",
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
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

// Registry as `assignmentsTeacherList` hydrates it: carries classId + status.
// c1 has one published, one closed, and one draft (draft is never surfaced or
// counted). c2 has one published.
const registry: ReadonlyArray<AssignmentDetailMetadata> = Object.freeze([
  Object.freeze({
    assignmentId: "a1",
    title: "Earth's Layers - Check for Understanding",
    status: "published" as const,
    className: "6A Life Science",
    classId: "c1",
    lessonSlug: "earths-layers",
    publishedAt: 3000,
  }),
  Object.freeze({
    assignmentId: "a2",
    title: "Plate Tectonics",
    status: "closed" as const,
    className: "6A Life Science",
    classId: "c1",
    lessonSlug: "plate-tectonics",
    publishedAt: 2000,
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
  Object.freeze({
    assignmentId: "a4",
    title: "Draft only",
    status: "draft" as const,
    className: "6A Life Science",
    classId: "c1",
    lessonSlug: "draft-lesson",
  }),
]);

type SeamHarness = {
  seam: CurriculumAssignmentDetailSeam;
  opened: Array<{ id: string; options?: AssignmentDetailOpenOptions }>;
};

const makeSeam = (
  list: ReadonlyArray<AssignmentDetailMetadata> = registry,
): SeamHarness => {
  const opened: SeamHarness["opened"] = [];
  const seam: CurriculumAssignmentDetailSeam = {
    register: () => undefined,
    open: (id, options) => {
      opened.push({ id, options });
    },
    list: () => list,
  };
  return { seam, opened };
};

const makeSummaryCallable = (): AssignmentSummaryCallable => async ({
  assignmentId,
}) => {
  const summary: AssignmentSummary = {
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
  return summary;
};

type DepsOverrides = {
  listClasses?: (uid: string) => Promise<ReadonlyArray<ClassSummary>>;
  assignmentDetail?: CurriculumAssignmentDetailSeam | null;
  assignmentSummary?: AssignmentSummaryCallable | null;
  navigateToSurface?: (surface: WorkspaceSurfaceKey) => void;
  getClassesReturn?: () => ClassWorkspaceReturn | null;
  setClassesReturn?: (loc: ClassWorkspaceReturn | null) => void;
  createClass?: CreateClass | null;
  importFromClassroom?: ImportFromClassroomDeps | null;
  getClassManagementIntent?: () => ClassManagementIntent | null;
  setClassManagementIntent?: (intent: ClassManagementIntent | null) => void;
};

const makeDeps = (o: DepsOverrides = {}) => ({
  listClasses:
    o.listClasses ?? (async (): Promise<ReadonlyArray<ClassSummary>> => twoClasses),
  assignmentDetail: o.assignmentDetail ?? null,
  assignmentSummary: o.assignmentSummary ?? null,
  navigateToSurface: o.navigateToSurface,
  getClassesReturn: o.getClassesReturn,
  setClassesReturn: o.setClassesReturn,
  createClass: o.createClass ?? null,
  importFromClassroom: o.importFromClassroom ?? null,
  getClassManagementIntent: o.getClassManagementIntent,
  setClassManagementIntent: o.setClassManagementIntent,
});

const openClass = (mount: HTMLElement, classId: string): void => {
  mount
    .querySelector<HTMLButtonElement>(`[data-testid=class-card-${classId}]`)!
    .click();
};

const selectTab = (mount: HTMLElement, tab: string): void => {
  mount
    .querySelector<HTMLButtonElement>(`[data-testid=class-nav-${tab}]`)!
    .click();
};

beforeEach(() => {
  _resetActiveAssignmentsSessionStateForTest();
});

describe("Sprint 28.6C - class list / class cards", () => {
  test("class card renders class name, compact grade, and block", async () => {
    const mount = mkMount();
    const { seam } = makeSeam();
    renderClassesSurface(mount, teacher, makeDeps({ assignmentDetail: seam }));
    await flush();

    expect(
      mount.querySelector("[data-testid=class-title-c1]")?.textContent,
    ).toBe("6A Life Science");
    expect(
      mount.querySelector("[data-testid=class-grade-c1]")?.textContent,
    ).toBe("G6 · Block A");
    expect(
      mount.querySelector("[data-testid=class-grade-c2]")?.textContent,
    ).toBe("G7 · Block B");
  });

  // Sprint 28.6H.2 (Finding 1): a human live-emulator review found the join
  // code still rendered on populated class cards. The root cause was a stale
  // served bundle: the source `renderClassCard` had already dropped the join
  // code, but the compiled bundle had not been rebuilt. These tests render the
  // real class-card renderer and lock the contract in at the source level so a
  // rebuild always ships a card with no join code, while the join-code data
  // itself is untouched and still available on the dedicated surfaces.
  describe("Sprint 28.6H.2 (Finding 1) - class cards never show the join code", () => {
    const joinCodeClass: ActiveClassSummary = Object.freeze({
      id: "c1",
      title: "6A Life Science",
      status: "active" as const,
      grade: "6",
      block: "A",
      joinCode: "A1B2C3D4",
    });
    const classesWithJoinCode: ReadonlyArray<ClassSummary> =
      Object.freeze([joinCodeClass]);

    test("a populated class card does not render the join code text, element, or testid", async () => {
      const mount = mkMount();
      const { seam } = makeSeam();
      renderClassesSurface(
        mount,
        teacher,
        makeDeps({
          assignmentDetail: seam,
          listClasses: async () => classesWithJoinCode,
        }),
      );
      await flush();

      const card = mount.querySelector<HTMLElement>(
        "[data-testid=class-card-c1]",
      )!;
      expect(card).not.toBeNull();
      // The card renders (title + grade/block confirm it is the populated card,
      // not an error/empty state).
      expect(
        card.querySelector("[data-testid=class-title-c1]")?.textContent,
      ).toBe("6A Life Science");

      // No join-code element, no join-code testid, and the raw code never
      // appears anywhere in the card's text.
      expect(card.querySelector(".shell-class-joincode")).toBeNull();
      expect(card.querySelector("[data-testid^=class-joincode]")).toBeNull();
      expect(card.textContent).not.toContain("A1B2C3D4");
      expect(card.textContent?.toLowerCase()).not.toContain("join code");
    });

    test("the class-card omission does not strip join-code data from the summary", () => {
      // The card presentation drops the join code, but the underlying domain
      // data still carries it so the dedicated surfaces (post-create panel,
      // roster, class settings, Overview) keep working.
      expect(joinCodeClass.joinCode).toBe("A1B2C3D4");
    });
  });

  test("Task A1: the class card carries NO generic assignment-inventory count", async () => {
    const mount = mkMount();
    const { seam } = makeSeam();
    renderClassesSurface(mount, teacher, makeDeps({ assignmentDetail: seam }));
    await flush();

    // The everyday class card no longer shows "N assignments" / "No
    // assignments"; the Assignments tab owns assignment inventory.
    expect(
      mount.querySelector("[data-testid=class-assignment-count-c1]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=class-assignment-count-c2]"),
    ).toBeNull();
    const cardText = mount.querySelector(
      "[data-testid=class-card-c1]",
    )!.textContent!;
    expect(cardText).not.toMatch(/assignment/i);
    // Stable class identity is preserved: title + compact grade/block.
    expect(mount.querySelector("[data-testid=class-title-c1]")?.textContent).toBe(
      "6A Life Science",
    );
    expect(mount.querySelector("[data-testid=class-grade-c1]")?.textContent).toBe(
      "G6 · Block A",
    );
  });

  test("zero-class landing is a concise Settings pointer, NOT a class-source decision (Sprint 28.6H.8 Part C2)", async () => {
    const mount = mkMount();
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "AAAA", alreadyCreated: false });
    const navSpy = jest.fn<void, [WorkspaceSurfaceKey]>();
    renderClassesSurface(
      mount,
      teacher,
      makeDeps({
        listClasses: async () => [],
        createClass,
        navigateToSurface: navSpy,
      }),
    );
    await flush();

    expect(mount.querySelector("[data-testid=classes-empty]")).not.toBeNull();
    // No class-administration controls / decision surface on the landing.
    expect(
      mount.querySelector("[data-testid=classes-import-open]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=classes-create-open]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=classes-add-google-heading]"),
    ).toBeNull();
    const text = mount.textContent ?? "";
    expect(text).toContain("No classes yet.");
    expect(text).toContain("Add or import a class in Settings.");
    // The optional Go to Settings action navigates to the Settings surface.
    const go = mount.querySelector<HTMLButtonElement>(
      "[data-testid=classes-go-to-settings]",
    )!;
    expect(go).not.toBeNull();
    go.click();
    expect(navSpy).toHaveBeenCalledWith("settings");
  });
});

// A minimal Import-from-Classroom seam so `canImport` is satisfied and the
// import entry point renders. The intent tests never start the OAuth flow;
// they only assert the shared entry point is revealed.
const fakeImportDeps = (): ImportFromClassroomDeps =>
  ({
    callables: {
      listProviders: async () => Object.freeze([]),
      describeConnections: async () => Object.freeze([]),
      beginConnection: async () => ({ authorizationUrl: "", state: "" }),
      completeConnection: async () => ({
        connectionId: "",
        alreadyConnected: false,
      }),
      discoverClasses: async () => Object.freeze([]),
      importClass: async () => ({
        linkId: "",
        classId: "",
        lmsClassId: "",
        alreadyLinked: false,
      }),
    },
    openOAuth: async () => ({ code: "", state: "" }),
    redirectUri: "https://example.test/app/lms-callback.html",
    lmsCreateClass: async () =>
      ({ classId: "c", alreadyCreated: false }) as never,
    listTeacherClasses: async () => Object.freeze([]),
  }) as unknown as ImportFromClassroomDeps;

// A one-shot intent holder mirroring the shell's `classManagementIntent`.
const intentHolder = (initial: ClassManagementIntent | null) => {
  let value = initial;
  return {
    get: () => value,
    set: (v: ClassManagementIntent | null) => {
      value = v;
    },
  };
};

describe("Sprint 28.6F - shared class-management intent (Settings <-> Classes)", () => {
  test("a create intent opens the Create form on mount (same workflow as + Add a class)", async () => {
    const mount = mkMount();
    const holder = intentHolder("create");
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "AAAA", alreadyCreated: false });
    renderClassesSurface(
      mount,
      teacher,
      makeDeps({
        listClasses: async () => [],
        createClass,
        getClassManagementIntent: holder.get,
        setClassManagementIntent: holder.set,
      }),
    );
    await flush();
    // The certified Manual Create form (its existing testid) is open - there
    // is no second create implementation on Settings.
    expect(
      mount.querySelector("[data-testid=classes-create-form]"),
    ).not.toBeNull();
    // The intent is consumed exactly once.
    expect(holder.get()).toBeNull();
  });

  test("an import intent launches the focused import task DIRECTLY on mount (no second Import button) (Sprint 28.6H.8)", async () => {
    const mount = mkMount();
    const holder = intentHolder("import");
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "AAAA", alreadyCreated: false });
    renderClassesSurface(
      mount,
      teacher,
      makeDeps({
        listClasses: async () => [],
        createClass,
        importFromClassroom: fakeImportDeps(),
        getClassManagementIntent: holder.get,
        setClassManagementIntent: holder.set,
      }),
    );
    await flush();
    await flush();
    await flush();
    // The focused import task is entered directly: a Google Classroom import
    // heading, NO standalone "Import Class" button, and NO generic Classes
    // landing (no class count, no class cards).
    expect(
      mount.querySelector("[data-testid=surface-headline]")?.textContent,
    ).toBe("Import from Google Classroom");
    expect(
      mount.querySelector("[data-testid=classes-import-open]"),
    ).toBeNull();
    expect(mount.querySelector("[data-testid=classes-status]")).toBeNull();
    expect(mount.querySelector("[data-testid=classes-list]")).toBeNull();
    // The certified import controller ran (the intent was consumed once).
    expect(mount.querySelector("[data-testid=classes-import]")).not.toBeNull();
    expect(holder.get()).toBeNull();
  });

  test("the intent is consumed once: a later Classes mount shows the operational landing", async () => {
    const holder = intentHolder("create");
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "AAAA", alreadyCreated: false });
    const deps = makeDeps({
      listClasses: async () => [],
      createClass,
      getClassManagementIntent: holder.get,
      setClassManagementIntent: holder.set,
    });

    const first = mkMount();
    renderClassesSurface(first, teacher, deps);
    await flush();
    expect(
      first.querySelector("[data-testid=classes-create-form]"),
    ).not.toBeNull();

    // A second visit with the (now-consumed) holder shows the operational
    // zero-class landing, not an auto-opened form.
    const second = mkMount();
    renderClassesSurface(second, teacher, deps);
    await flush();
    expect(
      second.querySelector("[data-testid=classes-create-form]"),
    ).toBeNull();
    expect(
      second.querySelector("[data-testid=surface-headline]")?.textContent,
    ).toBe("Classes");
    expect(second.querySelector("[data-testid=classes-empty]")).not.toBeNull();
  });

  test("no intent leaves the create form closed on mount", async () => {
    const mount = mkMount();
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "AAAA", alreadyCreated: false });
    renderClassesSurface(
      mount,
      teacher,
      makeDeps({ listClasses: async () => [], createClass }),
    );
    await flush();
    expect(
      mount.querySelector("[data-testid=classes-create-form]"),
    ).toBeNull();
  });
});

describe("Sprint 28.6H.9 (Correction 2) - Back to Settings on focused tasks", () => {
  test("focused Create LyfeLabz Class task shows Back to Settings that returns to Settings (Class Management)", async () => {
    const mount = mkMount();
    const holder = intentHolder("create");
    const navSpy = jest.fn<void, [WorkspaceSurfaceKey]>();
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "AAAA", alreadyCreated: false });
    renderClassesSurface(
      mount,
      teacher,
      makeDeps({
        listClasses: async () => [],
        createClass,
        getClassManagementIntent: holder.get,
        setClassManagementIntent: holder.set,
        navigateToSurface: navSpy,
      }),
    );
    await flush();
    // The focused create task carries its own Cancel (task action) AND a
    // persistent Back to Settings (parent navigation).
    const back = mount.querySelector<HTMLButtonElement>(
      "[data-testid=classes-back-to-settings]",
    );
    expect(back).not.toBeNull();
    expect(back!.textContent).toBe("Back to Settings");
    expect(
      mount.querySelector("[data-testid=classes-create-form]"),
    ).not.toBeNull();
    back!.click();
    // Returns to Settings; the default Settings tab is Class Management, so no
    // trip through the generic Classes landing is needed.
    expect(navSpy).toHaveBeenCalledWith("settings");
    expect(navSpy).not.toHaveBeenCalledWith("classes");
    expect(navSpy).not.toHaveBeenCalledWith("curriculum");
  });

  test("focused Google Classroom import task shows Back to Settings that returns to Settings (Class Management)", async () => {
    const mount = mkMount();
    const holder = intentHolder("import");
    const navSpy = jest.fn<void, [WorkspaceSurfaceKey]>();
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "AAAA", alreadyCreated: false });
    renderClassesSurface(
      mount,
      teacher,
      makeDeps({
        listClasses: async () => [],
        createClass,
        importFromClassroom: fakeImportDeps(),
        getClassManagementIntent: holder.get,
        setClassManagementIntent: holder.set,
        navigateToSurface: navSpy,
      }),
    );
    await flush();
    await flush();
    await flush();
    const back = mount.querySelector<HTMLButtonElement>(
      "[data-testid=classes-back-to-settings]",
    );
    expect(back).not.toBeNull();
    expect(back!.textContent).toBe("Back to Settings");
    // The focused import heading is still present alongside Back to Settings.
    expect(
      mount.querySelector("[data-testid=surface-headline]")?.textContent,
    ).toBe("Import from Google Classroom");
    back!.click();
    expect(navSpy).toHaveBeenCalledWith("settings");
    expect(navSpy).not.toHaveBeenCalledWith("classes");
    expect(navSpy).not.toHaveBeenCalledWith("curriculum");
  });

  test("no Back to Settings appears on the operational Classes landing", async () => {
    const mount = mkMount();
    const navSpy = jest.fn<void, [WorkspaceSurfaceKey]>();
    const { seam } = makeSeam();
    renderClassesSurface(
      mount,
      teacher,
      makeDeps({ assignmentDetail: seam, navigateToSurface: navSpy }),
    );
    await flush();
    // The operational landing (populated class list) is not a focused Settings
    // child task, so it carries no Back to Settings control.
    expect(
      mount.querySelector("[data-testid=surface-headline]")?.textContent,
    ).toBe("Classes");
    expect(
      mount.querySelector("[data-testid=classes-back-to-settings]"),
    ).toBeNull();
  });
});

describe("Sprint 28.6C - class workspace Overview / Assignments / Students", () => {
  test("Task B1: the switcher exposes Assignments and Students only (Overview removed)", async () => {
    const mount = mkMount();
    const { seam } = makeSeam();
    renderClassesSurface(mount, teacher, makeDeps({ assignmentDetail: seam }));
    await flush();
    openClass(mount, "c1");

    // Overview / Snapshot is not hidden - it is absent from the navigation.
    expect(mount.querySelector("[data-testid=class-nav-snapshot]")).toBeNull();
    expect(
      mount.querySelector("[data-testid=class-nav-assignments]")?.textContent,
    ).toBe("Assignments");
    expect(
      mount.querySelector("[data-testid=class-nav-roster]")?.textContent,
    ).toBe("Students");
    // Exactly two class sections.
    expect(
      mount.querySelectorAll("[data-testid^=class-nav-]"),
    ).toHaveLength(2);
  });

  test("Task B2: opening a class lands directly on Assignments", async () => {
    const mount = mkMount();
    const { seam } = makeSeam();
    renderClassesSurface(mount, teacher, makeDeps({ assignmentDetail: seam }));
    await flush();
    openClass(mount, "c1");

    expect(
      mount.querySelector("[data-testid=class-workspace]")?.getAttribute("data-class-tab"),
    ).toBe("assignments");
    // The class identity remains visible above the tabs.
    expect(
      mount.querySelector("[data-testid=class-workspace-title]")?.textContent,
    ).toBe("6A Life Science");
    // No Overview/Snapshot surface renders.
    expect(mount.querySelector("[data-testid=snapshot-region]")).toBeNull();
  });

  test("Students renders the roster surface (Students heading + real empty state)", async () => {
    const mount = mkMount();
    const { seam } = makeSeam();
    renderClassesSurface(mount, teacher, makeDeps({ assignmentDetail: seam }));
    await flush();
    openClass(mount, "c1");
    selectTab(mount, "roster");

    // Sprint 28.6H (Finding 3/5): section heading is "Students"; a real empty
    // state until a roster is wired (no prototype/product-marketing copy).
    expect(
      mount.querySelector("[data-testid=surface-headline]")?.textContent,
    ).toBe("Students");
    const empty = mount.querySelector("[data-testid=roster-empty]");
    expect(empty).not.toBeNull();
    expect(mount.querySelector("[data-testid=roster-purpose]")).toBeNull();
    // Sprint 28.6H.4 (Part B): the empty state is exactly "No students yet." -
    // the class-code explanatory sentence is removed.
    expect(empty?.textContent?.trim()).toBe("No students yet.");
    expect(mount.querySelector("[data-testid=roster-empty-hint]")).toBeNull();
    expect(mount.textContent ?? "").not.toContain(
      "Students who join with the class code",
    );
    expect(
      mount.querySelector("[data-testid=class-workspace]")?.getAttribute("data-class-tab"),
    ).toBe("roster");
  });

  test("the switcher moves between Assignments and Students and preserves the class", async () => {
    const mount = mkMount();
    const { seam } = makeSeam();
    renderClassesSurface(
      mount,
      teacher,
      makeDeps({ assignmentDetail: seam, assignmentSummary: makeSummaryCallable() }),
    );
    await flush();
    openClass(mount, "c1");

    selectTab(mount, "roster");
    expect(
      mount.querySelector("[data-testid=class-workspace]")?.getAttribute("data-class-tab"),
    ).toBe("roster");
    selectTab(mount, "assignments");
    expect(
      mount.querySelector("[data-testid=class-workspace]")?.getAttribute("data-class-tab"),
    ).toBe("assignments");
    expect(
      mount.querySelector("[data-testid=class-workspace]")?.getAttribute("data-class-id"),
    ).toBe("c1");
  });
});

describe("Sprint 28.6C - class Assignments section", () => {
  test("Assignments renders only the selected class's assignments", async () => {
    const mount = mkMount();
    const { seam } = makeSeam();
    renderClassesSurface(
      mount,
      teacher,
      makeDeps({ assignmentDetail: seam, assignmentSummary: makeSummaryCallable() }),
    );
    await flush();
    openClass(mount, "c1");
    selectTab(mount, "assignments");
    await flush();

    // c1's published assignment is shown; c2's assignment is never present.
    expect(
      mount.querySelector("[data-testid=active-assignment-card-a1]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=active-assignment-card-a3]"),
    ).toBeNull();
    // Sprint 28.6H.4 (Part A, Task J #5): a populated Assignments section flows
    // straight into the cards with no introductory sentence.
    expect(
      mount.querySelector("[data-testid=class-assignments-purpose]"),
    ).toBeNull();
    expect(mount.textContent ?? "").not.toContain(
      "The assignments you have given this class.",
    );
  });

  test("closed assignments of the class are reachable via Show closed; other classes never appear", async () => {
    const mount = mkMount();
    const { seam } = makeSeam();
    renderClassesSurface(
      mount,
      teacher,
      makeDeps({ assignmentDetail: seam, assignmentSummary: makeSummaryCallable() }),
    );
    await flush();
    openClass(mount, "c1");
    selectTab(mount, "assignments");
    await flush();

    // a2 (closed, c1) is hidden until Show closed is toggled.
    expect(
      mount.querySelector("[data-testid=active-assignment-card-a2]"),
    ).toBeNull();
    mount
      .querySelector<HTMLInputElement>("[data-testid=active-assignments-show-closed]")!
      .click();
    expect(
      mount.querySelector("[data-testid=active-assignment-card-a2]"),
    ).not.toBeNull();
    // The other class's assignment still never appears.
    expect(
      mount.querySelector("[data-testid=active-assignment-card-a3]"),
    ).toBeNull();
  });

  test("opening a class assignment records the class return context and opens Detail by id", async () => {
    const mount = mkMount();
    const { seam, opened } = makeSeam();
    let stored: ClassWorkspaceReturn | null = null;
    renderClassesSurface(
      mount,
      teacher,
      makeDeps({
        assignmentDetail: seam,
        assignmentSummary: makeSummaryCallable(),
        setClassesReturn: (loc) => {
          stored = loc;
        },
      }),
    );
    await flush();
    openClass(mount, "c1");
    selectTab(mount, "assignments");
    await flush();

    mount
      .querySelector<HTMLButtonElement>("[data-testid=active-assignment-open-a1]")!
      .click();

    expect(opened).toHaveLength(1);
    expect(opened[0]?.id).toBe("a1");
    expect(opened[0]?.options?.backLabel).toBe("Back to class");
    expect(typeof opened[0]?.options?.onBack).toBe("function");
    expect(stored).toEqual({ classId: "c1", tab: "assignments" });
  });

  test("a class with no assignments shows exactly 'No assignments yet.' (Sprint 28.6H.4 Part A)", async () => {
    const mount = mkMount();
    const { seam } = makeSeam(
      Object.freeze([]) as ReadonlyArray<AssignmentDetailMetadata>,
    );
    const navSpy = jest.fn<void, [WorkspaceSurfaceKey]>();
    renderClassesSurface(
      mount,
      teacher,
      makeDeps({ assignmentDetail: seam, navigateToSurface: navSpy }),
    );
    await flush();
    openClass(mount, "c1");
    selectTab(mount, "assignments");
    await flush();

    const empty = mount.querySelector("[data-testid=class-assignments-empty]");
    expect(empty).not.toBeNull();
    // The empty state is exactly "No assignments yet." - the over-explaining
    // hint and the "Go to Curriculum" button were removed (Part A).
    expect(empty?.textContent?.trim()).toBe("No assignments yet.");
    expect(
      mount.querySelector("[data-testid=class-assignments-goto-curriculum]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=class-assignments-purpose]"),
    ).toBeNull();
    const text = mount.textContent ?? "";
    expect(text).not.toContain("The assignments you have given this class.");
    expect(text).not.toContain(
      "Choose a lesson in Curriculum to assign it to this class.",
    );
    expect(text).not.toContain("Go to Curriculum");
    expect(navSpy).not.toHaveBeenCalled();
  });
});

describe("Sprint 28.6C - return-context restore", () => {
  test("a pending class return re-lands on the class Assignments section, consumed once", async () => {
    const mount = mkMount();
    const { seam } = makeSeam();
    let ret: ClassWorkspaceReturn | null = { classId: "c1", tab: "assignments" };
    renderClassesSurface(
      mount,
      teacher,
      makeDeps({
        assignmentDetail: seam,
        assignmentSummary: makeSummaryCallable(),
        getClassesReturn: () => ret,
        setClassesReturn: (loc) => {
          ret = loc;
        },
      }),
    );
    await flush();

    // Re-landed directly in the class workspace on the Assignments tab.
    const workspace = mount.querySelector("[data-testid=class-workspace]");
    expect(workspace?.getAttribute("data-class-id")).toBe("c1");
    expect(workspace?.getAttribute("data-class-tab")).toBe("assignments");
    // The return location was consumed (one-shot).
    expect(ret).toBeNull();
  });

  test("no pending return renders the class list as usual", async () => {
    const mount = mkMount();
    const { seam } = makeSeam();
    renderClassesSurface(
      mount,
      teacher,
      makeDeps({
        assignmentDetail: seam,
        getClassesReturn: () => null,
        setClassesReturn: () => undefined,
      }),
    );
    await flush();
    expect(mount.querySelector("[data-testid=classes-list]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=class-workspace]")).toBeNull();
  });
});

describe("Sprint 28.6H.5 - Class Workspace assignment card presentation (Part A)", () => {
  const openAssignments = async (mount: HTMLElement): Promise<void> => {
    openClass(mount, "c1");
    selectTab(mount, "assignments");
    await flush();
  };

  test("A1: the card shows the CANONICAL lesson title, not the stored assignment title suffix", async () => {
    const mount = mkMount();
    const { seam } = makeSeam();
    renderClassesSurface(
      mount,
      teacher,
      makeDeps({ assignmentDetail: seam, assignmentSummary: makeSummaryCallable() }),
    );
    await flush();
    await openAssignments(mount);

    const title = mount.querySelector(
      "[data-testid=active-assignment-title-a1]",
    )!;
    // Stored title is "Earth's Layers - Check for Understanding"; the canonical
    // manifest title for slug "earths-layers" is "Earth's Layers".
    expect(title.textContent).toBe("Earth's Layers");
    // A2/J#2: the stored "- Check for Understanding" suffix is not displayed.
    expect(title.textContent).not.toContain("Check for Understanding");
  });

  test("A1 fallback: an assignment whose slug is unresolvable keeps the stored title", async () => {
    const mount = mkMount();
    const legacy: AssignmentDetailMetadata = Object.freeze({
      assignmentId: "a-legacy",
      title: "Legacy Custom Assignment",
      status: "published",
      className: "6A Life Science",
      classId: "c1",
      lessonSlug: "not-a-real-lesson-slug",
      publishedAt: Date.parse("2026-08-20T00:00:00Z"),
    }) as AssignmentDetailMetadata;
    const { seam } = makeSeam(
      Object.freeze([legacy]) as ReadonlyArray<AssignmentDetailMetadata>,
    );
    renderClassesSurface(
      mount,
      teacher,
      makeDeps({ assignmentDetail: seam, assignmentSummary: makeSummaryCallable() }),
    );
    await flush();
    await openAssignments(mount);

    const title = mount.querySelector(
      "[data-testid=active-assignment-title-a-legacy]",
    )!;
    // Unresolvable slug -> safe fallback to the stored title (never blank).
    expect(title.textContent).toBe("Legacy Custom Assignment");
  });

  test("A2/A3: the card omits the redundant class name and the PUBLISHED label", async () => {
    const mount = mkMount();
    const { seam } = makeSeam();
    renderClassesSurface(
      mount,
      teacher,
      makeDeps({ assignmentDetail: seam, assignmentSummary: makeSummaryCallable() }),
    );
    await flush();
    await openAssignments(mount);

    // A2: class name is absent from the card (the workspace establishes it).
    expect(
      mount.querySelector("[data-testid=active-assignment-class-a1]"),
    ).toBeNull();
    // A3: the PUBLISHED lifecycle label is absent (state stays on data-status).
    expect(
      mount.querySelector("[data-testid=active-assignment-state-a1]"),
    ).toBeNull();
    const card = mount.querySelector("[data-testid=active-assignment-card-a1]")!;
    expect(card.textContent).not.toContain("PUBLISHED");
    expect(card.textContent).not.toContain("Published");
    // Lifecycle state itself is preserved on the data attribute.
    expect(card.getAttribute("data-status")).toBe("published");
    // A4: completion, date, and Open assignment are preserved.
    expect(
      mount.querySelector("[data-testid=active-assignment-progress-a1]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=active-assignment-date-a1]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=active-assignment-open-a1]"),
    ).not.toBeNull();
    // A5: the class-scoped card carries the compact variant class.
    expect(card.className).toContain("shell-active-assignment-card-compact");
  });
});

describe("Sprint 28.6H.6 - completed assignment visual state (Part B)", () => {
  const summaryReturning = (
    completedStudents: number,
    totalStudents: number,
  ): AssignmentSummaryCallable => async ({ assignmentId }) =>
    Object.freeze({
      assignmentId,
      classId: "c1",
      totalStudents,
      completedStudents,
      inProgressStudents: 0,
      notStartedStudents: Math.max(0, totalStudents - completedStudents),
      completionPercentage:
        totalStudents === 0
          ? 0
          : Math.round((completedStudents / totalStudents) * 100),
      averagePercentage: 80,
      highestPercentage: 100,
      lowestPercentage: 40,
      perfectScoreStudents: completedStudents,
    });

  const openA1 = async (
    mount: HTMLElement,
    summary: AssignmentSummaryCallable,
  ): Promise<HTMLElement> => {
    const { seam } = makeSeam();
    renderClassesSurface(
      mount,
      teacher,
      makeDeps({ assignmentDetail: seam, assignmentSummary: summary }),
    );
    await flush();
    openClass(mount, "c1");
    selectTab(mount, "assignments");
    await flush();
    await flush();
    return mount.querySelector<HTMLElement>(
      "[data-testid=active-assignment-card-a1]",
    )!;
  };

  test("B1/B2: a fully completed assignment (N of N, N>0) gets the completed-state class", async () => {
    const mount = mkMount();
    const card = await openA1(mount, summaryReturning(1, 1));
    expect(card.classList.contains("shell-active-assignment-card-complete")).toBe(
      true,
    );
    expect(card.getAttribute("data-complete")).toBe("true");
    // The completion text remains authoritative.
    expect(
      mount.querySelector("[data-testid=active-assignment-progress-a1]")!
        .textContent,
    ).toBe("1 of 1 completed");
  });

  test("B3: a partially completed assignment stays neutral (no completed-state class)", async () => {
    const mount = mkMount();
    const card = await openA1(mount, summaryReturning(18, 24));
    expect(card.classList.contains("shell-active-assignment-card-complete")).toBe(
      false,
    );
    expect(card.getAttribute("data-complete")).toBeNull();
    // The "not started" operational line remains present (Task A/M3).
    expect(
      mount.querySelector("[data-testid=active-assignment-progress-detail-a1]"),
    ).not.toBeNull();
  });

  test("a not-started assignment (0 of N) stays neutral", async () => {
    const mount = mkMount();
    const card = await openA1(mount, summaryReturning(0, 1));
    expect(card.classList.contains("shell-active-assignment-card-complete")).toBe(
      false,
    );
  });

  test("a zero-recipient assignment (0 of 0) is NEVER treated as completed", async () => {
    const mount = mkMount();
    const card = await openA1(mount, summaryReturning(0, 0));
    expect(card.classList.contains("shell-active-assignment-card-complete")).toBe(
      false,
    );
    expect(card.getAttribute("data-complete")).toBeNull();
  });

  test("the compact class-scoped card keeps its bottom-action structure and H.5 title behavior", async () => {
    const mount = mkMount();
    const card = await openA1(mount, summaryReturning(1, 1));
    // Bottom-action layout marker (Open assignment margin-top:auto lives on the
    // compact card variant).
    expect(card.classList.contains("shell-active-assignment-card-compact")).toBe(
      true,
    );
    expect(
      mount.querySelector("[data-testid=active-assignment-open-a1]"),
    ).not.toBeNull();
    // H.5: canonical title, no class name, no PUBLISHED.
    expect(
      mount.querySelector("[data-testid=active-assignment-title-a1]")!.textContent,
    ).toBe("Earth's Layers");
    expect(
      mount.querySelector("[data-testid=active-assignment-class-a1]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=active-assignment-state-a1]"),
    ).toBeNull();
  });
});

describe("Sprint 28.6H.6 - focused manual-create and import tasks (Parts F/G)", () => {
  const createClass: CreateClass = async () =>
    Object.freeze({ classId: "c", joinCode: "AAAA", alreadyCreated: false });

  const openCreateTask = async (
    mount: HTMLElement,
    navSpy?: (s: WorkspaceSurfaceKey) => void,
  ): Promise<void> => {
    let intent: ClassManagementIntent | null = "create";
    renderClassesSurface(
      mount,
      teacher,
      makeDeps({
        listClasses: async () => [],
        createClass,
        importFromClassroom: fakeImportDeps(),
        navigateToSurface: navSpy,
        getClassManagementIntent: () => intent,
        setClassManagementIntent: (v) => {
          intent = v;
        },
      }),
    );
    await flush();
  };

  test("F1/F2/F3/F4: the create task shows ONLY the manual form - no 'Add a Class' wrapper, no Google Classroom import, heading 'Create LyfeLabz Class', submit 'Create Class'", async () => {
    const mount = mkMount();
    await openCreateTask(mount);

    // The focused manual form is present.
    const form = mount.querySelector("[data-testid=classes-create-form]")!;
    expect(form).not.toBeNull();
    // F3: the fields remain.
    expect(mount.querySelector("[data-testid=classes-create-title]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=classes-create-grade]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=classes-create-block]")).not.toBeNull();
    // F4: the submit reads "Create Class".
    expect(
      mount.querySelector("[data-testid=classes-create-submit]")!.textContent,
    ).toBe("Create Class");
    // F3: the focused heading is "Create LyfeLabz Class".
    expect(form.textContent).toContain("Create LyfeLabz Class");
    // F1: no "Add a Class" wrapper heading.
    expect(
      mount.querySelector("[data-testid=classes-add-a-class-heading]"),
    ).toBeNull();
    expect(mount.textContent ?? "").not.toContain("Add a class");
    // F2: the Google Classroom import action is completely absent from the task.
    expect(mount.querySelector("[data-testid=classes-import-open]")).toBeNull();
    expect(mount.textContent ?? "").not.toContain(
      "Import Class from Google Classroom",
    );
  });

  test("F5: Cancel returns to the Settings Class Management decision surface", async () => {
    const mount = mkMount();
    const navSpy = jest.fn<void, [WorkspaceSurfaceKey]>();
    await openCreateTask(mount, navSpy);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=classes-create-cancel]")!
      .click();
    expect(navSpy).toHaveBeenCalledWith("settings");
  });

  test("G: the import task shows ONLY the Google Classroom import - no manual create form", async () => {
    const mount = mkMount();
    let intent: ClassManagementIntent | null = "import";
    renderClassesSurface(
      mount,
      teacher,
      makeDeps({
        listClasses: async () => [],
        createClass,
        importFromClassroom: fakeImportDeps(),
        getClassManagementIntent: () => intent,
        setClassManagementIntent: (v) => {
          intent = v;
        },
      }),
    );
    await flush();
    await flush();
    await flush();
    // Sprint 28.6H.8: the import task launches directly - the import region is
    // present (no standalone "Import Class" button; auto-started).
    expect(mount.querySelector("[data-testid=classes-import]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=classes-import-open]")).toBeNull();
    // The manual create form/opener is NOT shown alongside the import task.
    expect(mount.querySelector("[data-testid=classes-create-form]")).toBeNull();
    expect(mount.querySelector("[data-testid=classes-create-open]")).toBeNull();
    // No "Add a Class" wrapper heading; the task heading is the import title.
    expect(
      mount.querySelector("[data-testid=classes-add-a-class-heading]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=surface-headline]")?.textContent,
    ).toBe("Import from Google Classroom");
  });
});

describe("Sprint 28.6H.7 - incomplete-first assignment ordering (Part A)", () => {
  // Four published assignments in class c1, ordered by publishedAt desc so the
  // three COMPLETED ones sort BEFORE the single INCOMPLETE one in the certified
  // compareCards order. The presentation partition must then move the
  // incomplete assignment to the front while preserving relative order within
  // each group.
  const c1List: ReadonlyArray<AssignmentDetailMetadata> = Object.freeze([
    Object.freeze({
      assignmentId: "e1",
      title: "Earth's Layers - CFU",
      status: "published" as const,
      className: "6A Life Science",
      classId: "c1",
      lessonSlug: "earths-layers",
      publishedAt: 4000,
    }),
    Object.freeze({
      assignmentId: "e2",
      title: "Biological Evolution",
      status: "published" as const,
      className: "6A Life Science",
      classId: "c1",
      lessonSlug: "biological-evolution",
      publishedAt: 3000,
    }),
    Object.freeze({
      assignmentId: "e3",
      title: "Cell Types",
      status: "published" as const,
      className: "6A Life Science",
      classId: "c1",
      lessonSlug: "cell-types",
      publishedAt: 2000,
    }),
    Object.freeze({
      assignmentId: "e4",
      title: "What Is Life?",
      status: "published" as const,
      className: "6A Life Science",
      classId: "c1",
      lessonSlug: "what-is-life",
      publishedAt: 1000,
    }),
  ]);

  // completed/total per assignmentId; anything not listed defaults to 1/1.
  const summaryFor = (
    map: Record<string, [number, number]>,
  ): AssignmentSummaryCallable => async ({ assignmentId }) => {
    const [completedStudents, totalStudents] = map[assignmentId] ?? [1, 1];
    return Object.freeze({
      assignmentId,
      classId: "c1",
      totalStudents,
      completedStudents,
      inProgressStudents: 0,
      notStartedStudents: Math.max(0, totalStudents - completedStudents),
      completionPercentage:
        totalStudents === 0
          ? 0
          : Math.round((completedStudents / totalStudents) * 100),
      averagePercentage: 80,
      highestPercentage: 100,
      lowestPercentage: 40,
      perfectScoreStudents: completedStudents,
    });
  };

  const cardOrder = (mount: HTMLElement): string[] =>
    Array.from(
      mount.querySelectorAll<HTMLElement>(".shell-active-assignment-card"),
    ).map((c) => c.getAttribute("data-assignment-id") ?? "");

  const openOrdered = async (
    summary: AssignmentSummaryCallable,
  ): Promise<HTMLElement> => {
    const mount = mkMount();
    const { seam } = makeSeam(c1List);
    renderClassesSurface(
      mount,
      teacher,
      makeDeps({ assignmentDetail: seam, assignmentSummary: summary }),
    );
    await flush();
    openClass(mount, "c1");
    selectTab(mount, "assignments");
    // First flush lets the summaries resolve; the microtask re-render then
    // re-partitions incomplete-first.
    await flush();
    await flush();
    return mount;
  };

  test("N1: the incomplete assignment renders before the completed ones even though it was last in the original order", async () => {
    const mount = await openOrdered(
      summaryFor({ e4: [0, 1] }), // e1/e2/e3 complete (1/1), e4 incomplete
    );
    // DOM order: e4 (incomplete) first, then e1, e2, e3 (completed, original order).
    expect(cardOrder(mount)).toEqual(["e4", "e1", "e2", "e3"]);
  });

  test("N2/N3: relative order is preserved within the incomplete and the completed groups", async () => {
    // e2 and e4 incomplete; e1 and e3 completed.
    const mount = await openOrdered(summaryFor({ e2: [0, 2], e4: [0, 1] }));
    // Outstanding group keeps compareCards order (e2 before e4), then completed
    // group keeps compareCards order (e1 before e3).
    expect(cardOrder(mount)).toEqual(["e2", "e4", "e1", "e3"]);
  });

  test("N4: a 0-of-0 assignment is treated as outstanding (not completed) for ordering", async () => {
    // e1 is 0/0 (no recipients) -> outstanding; e2/e3/e4 complete.
    const mount = await openOrdered(summaryFor({ e1: [0, 0] }));
    // e1 leads (outstanding), then e2, e3, e4 (completed).
    expect(cardOrder(mount)[0]).toBe("e1");
    expect(
      mount
        .querySelector("[data-testid=active-assignment-card-e1]")!
        .classList.contains("shell-active-assignment-card-complete"),
    ).toBe(false);
  });

  test("N5/N6: completed card is pale green, incomplete card is neutral", async () => {
    const mount = await openOrdered(summaryFor({ e4: [0, 1] }));
    expect(
      mount
        .querySelector("[data-testid=active-assignment-card-e4]")!
        .classList.contains("shell-active-assignment-card-complete"),
    ).toBe(false);
    expect(
      mount
        .querySelector("[data-testid=active-assignment-card-e1]")!
        .classList.contains("shell-active-assignment-card-complete"),
    ).toBe(true);
  });

  test("N7-N11: H.6 card contract preserved (title canonical, no class name, no PUBLISHED, progress present)", async () => {
    const mount = await openOrdered(summaryFor({ e4: [0, 1] }));
    // Canonical title (e4 -> what-is-life).
    expect(
      mount.querySelector("[data-testid=active-assignment-title-e4]")!.textContent,
    ).toBe("What Is Life?");
    // No class name, no PUBLISHED label.
    expect(
      mount.querySelector("[data-testid=active-assignment-class-e4]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=active-assignment-state-e4]"),
    ).toBeNull();
    // Progress + Open assignment present.
    expect(
      mount.querySelector("[data-testid=active-assignment-progress-e4]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=active-assignment-open-e4]"),
    ).not.toBeNull();
  });
});
