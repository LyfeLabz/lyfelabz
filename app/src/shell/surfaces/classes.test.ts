/**
 * @jest-environment jsdom
 */
import { renderClassesSurface } from "./classes";
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type {
  CreateClass,
  CreateClassInput,
} from "../../classes/createClass";
import type {
  ActivateClass,
  ActivateClassResult,
} from "../../classes/activateClass";
import type { SyncRoster, SyncRosterResult } from "../../classes/syncRoster";
import type { ImportFromClassroomDeps } from "../../classes/importFromClassroom";
import type {
  IntegrationsClassLink,
  IntegrationsConnection,
  IntegrationsLmsClass,
  IntegrationsLyfeLabzClass,
  IntegrationsProvider,
} from "../../settings/integrations/types";

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

const googleProvider: IntegrationsProvider = Object.freeze({
  providerId: "googleClassroom",
  displayName: "Google Classroom",
});
const activeConnection: IntegrationsConnection = Object.freeze({
  connectionId: "conn-1",
  providerId: "googleClassroom",
  status: "active",
  scopes: Object.freeze([]),
});
const defaultCourses: readonly IntegrationsLmsClass[] = Object.freeze([
  Object.freeze({ lmsClassId: "gc-1", name: "Period 3 Science" }),
  Object.freeze({ lmsClassId: "gc-2", name: "Period 5 Science" }),
]);

type ImportOverrides = {
  connections?: readonly IntegrationsConnection[];
  courses?: readonly IntegrationsLmsClass[];
  links?: readonly IntegrationsClassLink[];
  teacherClasses?: readonly IntegrationsLyfeLabzClass[];
  importClass?: ImportFromClassroomDeps["callables"]["importClass"];
};

function makeImportDeps(overrides: ImportOverrides = {}): {
  deps: ImportFromClassroomDeps;
  calls: string[];
} {
  const calls: string[] = [];
  const connections = overrides.connections ?? [activeConnection];
  const courses = overrides.courses ?? defaultCourses;
  const links = overrides.links ?? [];
  const teacherClasses = overrides.teacherClasses ?? [];
  const deps: ImportFromClassroomDeps = {
    callables: {
      listProviders: async () => {
        calls.push("listProviders");
        return [googleProvider];
      },
      describeConnections: async () => {
        calls.push("describeConnections");
        return connections;
      },
      beginConnection: async () => {
        calls.push("beginConnection");
        return { authorizationUrl: "https://auth.example/x", state: "s" };
      },
      completeConnection: async () => {
        calls.push("completeConnection");
        return { connectionId: "conn-new", alreadyConnected: false };
      },
      discoverClasses: async () => {
        calls.push("discoverClasses");
        return courses;
      },
      importClass:
        overrides.importClass ??
        (async ({ classId, lmsClassId }) => {
          calls.push(`importClass:${classId}:${lmsClassId}`);
          return {
            linkId: "link-1",
            classId,
            lmsClassId,
            alreadyLinked: false,
          };
        }),
    },
    openOAuth: async () => {
      calls.push("openOAuth");
      return { code: "c", state: "s" };
    },
    redirectUri: "https://example.test/app/lms-callback.html",
    lmsCreateClass: async ({ classId, title }: { classId: string; title: string }) => {
      calls.push(`lmsCreateClass:${title}`);
      return {
        classId,
        alreadyCreated: false,
      };
    },
    listTeacherClasses: async () => teacherClasses,
    listClassLinks: async () => links,
  };
  return { deps, calls };
}

const openCreateForm = async (mount: HTMLElement): Promise<void> => {
  await flush();
  mount
    .querySelector<HTMLButtonElement>("[data-testid=classes-create-open]")!
    .click();
};

describe("Create Class form input focus", () => {
  test("typing consecutive characters keeps the same input element and focus", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "AAAA", alreadyCreated: false });
    renderClassesSurface(mount, teacher, { listClasses, createClass });
    await openCreateForm(mount);

    const first = mount.querySelector<HTMLInputElement>(
      "[data-testid=classes-create-title]",
    )!;
    expect(first).not.toBeNull();
    first.focus();
    expect(document.activeElement).toBe(first);

    for (const ch of "Room 101") {
      first.value = first.value + ch;
      first.dispatchEvent(new Event("input", { bubbles: true }));
    }

    const after = mount.querySelector<HTMLInputElement>(
      "[data-testid=classes-create-title]",
    )!;
    expect(after).toBe(first);
    expect(document.activeElement).toBe(first);
    expect(after.value).toBe("Room 101");
  });

  test("Grade and Block selects update state and are submitted", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const captured: CreateClassInput[] = [];
    const createClass: CreateClass = async (input) => {
      captured.push(input);
      return Object.freeze({
        classId: "c",
        joinCode: "BBBB",
        alreadyCreated: false,
      });
    };
    renderClassesSurface(mount, teacher, { listClasses, createClass });
    await openCreateForm(mount);

    const title = mount.querySelector<HTMLInputElement>(
      "[data-testid=classes-create-title]",
    )!;
    title.value = "Period 2";
    title.dispatchEvent(new Event("input", { bubbles: true }));

    const grade = mount.querySelector<HTMLSelectElement>(
      "[data-testid=classes-create-grade]",
    )!;
    grade.value = "8";
    grade.dispatchEvent(new Event("change", { bubbles: true }));

    const block = mount.querySelector<HTMLSelectElement>(
      "[data-testid=classes-create-block]",
    )!;
    block.value = "C";
    block.dispatchEvent(new Event("change", { bubbles: true }));

    mount
      .querySelector<HTMLFormElement>("[data-testid=classes-create-form]")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await flush();
    await flush();

    expect(captured).toEqual([
      { title: "Period 2", grade: "8", block: "C" },
    ]);
  });

  test("Cancel closes the form and resets to the Create button", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "CCCC", alreadyCreated: false });
    renderClassesSurface(mount, teacher, { listClasses, createClass });
    await openCreateForm(mount);

    const title = mount.querySelector<HTMLInputElement>(
      "[data-testid=classes-create-title]",
    )!;
    title.value = "Draft I abandon";
    title.dispatchEvent(new Event("input", { bubbles: true }));

    mount
      .querySelector<HTMLButtonElement>("[data-testid=classes-create-cancel]")!
      .click();

    expect(
      mount.querySelector("[data-testid=classes-create-form]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=classes-create-open]"),
    ).not.toBeNull();

    mount
      .querySelector<HTMLButtonElement>("[data-testid=classes-create-open]")!
      .click();
    const reopened = mount.querySelector<HTMLInputElement>(
      "[data-testid=classes-create-title]",
    )!;
    expect(reopened.value).toBe("");
  });

  test("Import stub is inert when the import-from-classroom seam is absent (test-only fallback)", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "EEEE", alreadyCreated: false });
    renderClassesSurface(mount, teacher, { listClasses, createClass });
    await flush();

    const importBtn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=classes-import-open]",
    );
    expect(importBtn).not.toBeNull();
    expect(importBtn!.textContent).toBe("Import Class from Google Classroom");
    expect(importBtn!.disabled).toBe(true);
    expect(importBtn!.getAttribute("aria-disabled")).toBe("true");

    const status = mount.querySelector<HTMLElement>(
      "[data-testid=classes-import-status]",
    );
    expect(status).not.toBeNull();
    expect(status!.textContent).toMatch(/not available/i);

    const createBtn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=classes-create-open]",
    );
    expect(createBtn).not.toBeNull();
    expect(createBtn!.textContent).toBe("Create LyfeLabz Class");
    // Ordering: the primary Import entry point precedes the secondary
    // Create LyfeLabz Class entry point in the DOM.
    const importIdx = Array.from(
      mount.querySelectorAll<HTMLElement>("[data-testid]"),
    ).findIndex((n) => n.getAttribute("data-testid") === "classes-import-open");
    const createIdx = Array.from(
      mount.querySelectorAll<HTMLElement>("[data-testid]"),
    ).findIndex((n) => n.getAttribute("data-testid") === "classes-create-open");
    expect(importIdx).toBeGreaterThanOrEqual(0);
    expect(createIdx).toBeGreaterThan(importIdx);

    // aria-describedby links the disabled button to the explanatory
    // status paragraph, so a screen reader announces the "coming soon"
    // reason on focus rather than only when the tooltip fires.
    expect(importBtn!.getAttribute("aria-describedby")).toBe(
      "classes-import-status",
    );
    expect(status!.id).toBe("classes-import-status");
  });

  test("Sprint 24B Phase 1: Classes exposes exactly the two approved entry points and no third class control", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "FFFF", alreadyCreated: false });
    renderClassesSurface(mount, teacher, { listClasses, createClass });
    await flush();

    // The two approved entry points are present.
    expect(
      mount.querySelector("[data-testid=classes-import-open]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=classes-create-open]"),
    ).not.toBeNull();

    // No third class-creation or class-import affordance from the old
    // Settings-side surface may have slipped in.
    expect(
      mount.querySelector("[data-testid=integrations-import-googleClassroom]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=integrations-imported-classes]"),
    ).toBeNull();
  });

  test("Sprint 24B Phase 2: Import button is active when import-from-classroom seam is wired", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "GGGG", alreadyCreated: false });
    const importDeps = makeImportDeps();
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      importFromClassroom: importDeps.deps,
    });
    await flush();

    const btn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=classes-import-open]",
    );
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(false);
    expect(btn!.textContent).toBe("Import Class from Google Classroom");
    // Teacher does not need to visit Settings; the entry point is on Classes.
    expect(
      mount.querySelector("[data-testid=integrations-surface]"),
    ).toBeNull();
  });

  test("Sprint 24B Phase 2B.4: connected teacher, click Import, picks a course and lands in the class setup form", async () => {
    // Phase 2B.4 replaces the Phase 2 hard-coded active-class path with
    // the ratified lifecycle: lmsCreateClass -> importClass -> setup
    // form. The linked class is `needsSetup` until the teacher confirms
    // grade and block through classesActivate.
    const mount = mkMount();
    let capturedClassId: string | null = null;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => {
      if (capturedClassId === null) return [];
      return [
        Object.freeze({
          id: capturedClassId,
          title: "Period 3 Science",
          status: "needsSetup" as const,
        }),
      ];
    };
    const createClass: CreateClass = async () =>
      Object.freeze({
        classId: "unused",
        joinCode: "unused",
        alreadyCreated: false,
      });
    const importDeps = makeImportDeps();
    // Intercept the classId that flows through so the second listClasses
    // call can surface the just-linked needsSetup class.
    const originalLms = importDeps.deps.lmsCreateClass;
    (importDeps.deps as { lmsCreateClass: typeof originalLms }).lmsCreateClass = async (input) => {
      const result = await originalLms(input);
      capturedClassId = result.classId;
      return result;
    };
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      importFromClassroom: importDeps.deps,
    });
    await flush();

    mount
      .querySelector<HTMLButtonElement>("[data-testid=classes-import-open]")!
      .click();
    await flush();
    await flush();

    // Course picker rendered.
    expect(
      mount.querySelector("[data-testid=classes-import-panel]"),
    ).not.toBeNull();
    const courseBtn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=classes-import-course-gc-1]",
    );
    expect(courseBtn).not.toBeNull();

    courseBtn!.click();
    await flush();
    await flush();
    await flush();

    // Create-then-link order. No hard-coded grade/block on create.
    expect(importDeps.calls).toContain("lmsCreateClass:Period 3 Science");
    const importCall = importDeps.calls.find(
      (c) => c.startsWith("importClass:") && c.endsWith(":gc-1"),
    );
    expect(importCall).toBeDefined();
    // Manual Create form is not shown.
    expect(
      mount.querySelector("[data-testid=classes-create-form]"),
    ).toBeNull();
    // Workspace opens directly on the setup form.
    const workspace = mount.querySelector("[data-testid=class-workspace]");
    expect(workspace).not.toBeNull();
    expect(workspace!.getAttribute("data-class-tab")).toBe("setup");
    expect(
      mount.querySelector("[data-testid=class-setup-form]"),
    ).not.toBeNull();
    // No join code is shown before activation.
    expect(
      mount.querySelector("[data-testid=classes-joincode-panel]"),
    ).toBeNull();
  });

  test("Sprint 24B Phase 2: disconnected teacher begins OAuth from Classes and continues to discovery automatically", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "HHHH", alreadyCreated: false });
    const importDeps = makeImportDeps({ connections: [] });
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      importFromClassroom: importDeps.deps,
    });
    await flush();

    mount
      .querySelector<HTMLButtonElement>("[data-testid=classes-import-open]")!
      .click();
    await flush();
    await flush();
    await flush();

    // OAuth was initiated from Classes without any Settings detour.
    expect(importDeps.calls).toContain("beginConnection");
    expect(importDeps.calls).toContain("openOAuth");
    expect(importDeps.calls).toContain("completeConnection");
    // After OAuth completes, discovery ran and the course picker is on screen.
    expect(importDeps.calls).toContain("discoverClasses");
    expect(
      mount.querySelector("[data-testid=classes-import-panel]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=classes-import-course-gc-1]"),
    ).not.toBeNull();
  });

  test("Sprint 24B Phase 2: duplicate course surfaces Open class / Cancel and does not offer Import anyway", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [
      Object.freeze({
        id: "existing-class",
        title: "Existing Science",
        grade: "7",
        block: "A",
        status: "active" as const,
        joinCode: "JOINCODE",
      }),
    ];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "IIII", alreadyCreated: false });
    const importDeps = makeImportDeps({
      links: [
        Object.freeze({
          linkId: "link-existing",
          classId: "existing-class",
          providerId: "googleClassroom",
          lmsClassId: "gc-1",
        }),
      ],
      teacherClasses: [
        Object.freeze({
          id: "existing-class",
          title: "Existing Science",
          grade: "7",
        }),
      ],
    });
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      importFromClassroom: importDeps.deps,
    });
    await flush();

    mount
      .querySelector<HTMLButtonElement>("[data-testid=classes-import-open]")!
      .click();
    await flush();
    await flush();

    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=classes-import-course-gc-1]",
      )!
      .click();
    await flush();
    await flush();

    expect(
      mount.querySelector("[data-testid=classes-import-duplicate]"),
    ).not.toBeNull();
    // Open class and Cancel are present, Import anyway is not.
    expect(
      mount.querySelector("[data-testid=classes-import-open-existing]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=classes-import-cancel]"),
    ).not.toBeNull();
    const anyway = Array.from(
      mount.querySelectorAll<HTMLElement>("[data-testid]"),
    ).find((n) => /import-anyway/i.test(n.getAttribute("data-testid") ?? ""));
    expect(anyway).toBeUndefined();
    // The classesCreate and importClass callables must not have been invoked.
    expect(importDeps.calls.some((c) => c.startsWith("lmsCreateClass"))).toBe(
      false,
    );
    expect(importDeps.calls.some((c) => c.startsWith("importClass"))).toBe(
      false,
    );
  });

  test("Sprint 24B Phase 2: importClass failure after create shows recovery text mentioning the created class and stops at the linking stage", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async () =>
      Object.freeze({
        classId: "new-class-1",
        joinCode: "AAAABBBB",
        alreadyCreated: false,
      });
    const importDeps = makeImportDeps({
      importClass: async () => {
        const err = new Error("boom");
        (err as { code?: string }).code = "unavailable";
        throw err;
      },
    });
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      importFromClassroom: importDeps.deps,
    });
    await flush();

    mount
      .querySelector<HTMLButtonElement>("[data-testid=classes-import-open]")!
      .click();
    await flush();
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=classes-import-course-gc-1]",
      )!
      .click();
    await flush();
    await flush();
    await flush();

    const err = mount.querySelector<HTMLElement>(
      "[data-testid=classes-import-error]",
    );
    expect(err).not.toBeNull();
    expect(err!.textContent).toMatch(/Period 3 Science/);
    // Raw error code does not leak.
    expect(err!.textContent).not.toMatch(/unavailable/i);
    const linkingStage = mount.querySelector<HTMLElement>(
      "[data-testid=classes-import-stage-linking]",
    );
    expect(linkingStage).not.toBeNull();
    expect(linkingStage!.getAttribute("data-status")).toBe("failed");
  });

  test("full typed title submits verbatim, unaltered by the surface", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const captured: CreateClassInput[] = [];
    const createClass: CreateClass = async (input) => {
      captured.push(input);
      return Object.freeze({
        classId: "c",
        joinCode: "DDDD",
        alreadyCreated: false,
      });
    };
    renderClassesSurface(mount, teacher, { listClasses, createClass });
    await openCreateForm(mount);

    const title = mount.querySelector<HTMLInputElement>(
      "[data-testid=classes-create-title]",
    )!;
    const typed = "Mr. Kankel Block A";
    for (const ch of typed) {
      title.value = title.value + ch;
      title.dispatchEvent(new Event("input", { bubbles: true }));
    }
    // Phase 2B.4: grade and block are always explicit; no fallback.
    const grade = mount.querySelector<HTMLSelectElement>(
      "[data-testid=classes-create-grade]",
    )!;
    grade.value = "7";
    grade.dispatchEvent(new Event("change", { bubbles: true }));
    const block = mount.querySelector<HTMLSelectElement>(
      "[data-testid=classes-create-block]",
    )!;
    block.value = "A";
    block.dispatchEvent(new Event("change", { bubbles: true }));

    mount
      .querySelector<HTMLFormElement>("[data-testid=classes-create-form]")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await flush();
    await flush();

    expect(captured[0]?.title).toBe(typed);
  });

  test("Sprint 24B Phase 2B.1: needsSetup class renders label, setup affordance, and no join code", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [
      Object.freeze({
        id: "needs-setup-class",
        title: "Imported Period 4",
        status: "needsSetup" as const,
      }),
    ];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "ZZZZ", alreadyCreated: false });
    renderClassesSurface(mount, teacher, { listClasses, createClass });
    await flush();
    await flush();

    const affordance = mount.querySelector<HTMLElement>(
      "[data-testid=class-setup-affordance-needs-setup-class]",
    );
    expect(affordance).not.toBeNull();
    expect(affordance!.textContent).toMatch(/finish setting up/i);
    // Phase 2B.4: an explicit Finish setup call-to-action is present.
    expect(
      mount.querySelector("[data-testid=class-setup-cta-needs-setup-class]"),
    ).not.toBeNull();

    const status = mount.querySelector<HTMLElement>(
      "[data-testid=class-status-needs-setup-class]",
    );
    expect(status).not.toBeNull();
    expect(status!.textContent).toBe("Setup needed");

    // No join code, grade, or block is rendered for a needsSetup card.
    expect(
      mount.querySelector("[data-testid=class-joincode-needs-setup-class]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=class-grade-needs-setup-class]"),
    ).toBeNull();
  });
});

// Sprint 24B Phase 2B.2 - Teacher `defaultGrade` preference integration
// on Manual Create.
describe("Manual Create default grade preference", () => {
  test("prefills grade from saved defaultGrade when present", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "AAAA", alreadyCreated: false });
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      defaultGrade: "8",
    });
    await openCreateForm(mount);

    const grade = mount.querySelector<HTMLSelectElement>(
      "[data-testid=classes-create-grade]",
    )!;
    expect(grade.value).toBe("8");
  });

  test("Phase 2B.4: no defaultGrade preference leaves the grade select unselected (no Grade 7 default)", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "AAAA", alreadyCreated: false });
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      defaultGrade: null,
    });
    await openCreateForm(mount);

    const grade = mount.querySelector<HTMLSelectElement>(
      "[data-testid=classes-create-grade]",
    )!;
    expect(grade.value).toBe("");
    const block = mount.querySelector<HTMLSelectElement>(
      "[data-testid=classes-create-block]",
    )!;
    expect(block.value).toBe("");
  });

  test("Phase 2B.4: Manual Create submit is rejected when grade is not chosen", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const captured: CreateClassInput[] = [];
    const createClass: CreateClass = async (input) => {
      captured.push(input);
      return Object.freeze({
        classId: "c",
        joinCode: "AAAA",
        alreadyCreated: false,
      });
    };
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      defaultGrade: null,
    });
    await openCreateForm(mount);
    const title = mount.querySelector<HTMLInputElement>(
      "[data-testid=classes-create-title]",
    )!;
    title.value = "No grade chosen";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    mount
      .querySelector<HTMLFormElement>("[data-testid=classes-create-form]")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(captured).toEqual([]);
    const err = mount.querySelector<HTMLElement>(
      "[data-testid=classes-create-error]",
    );
    expect(err).not.toBeNull();
    expect(err!.textContent).toMatch(/grade/i);
  });

  test("Manual Create remains usable when the preference reader has not resolved", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "AAAA", alreadyCreated: false });
    // Absent defaultGrade in deps is equivalent to a failed read.
    renderClassesSurface(mount, teacher, { listClasses, createClass });
    await openCreateForm(mount);
    expect(
      mount.querySelector("[data-testid=classes-create-form]"),
    ).not.toBeNull();
  });

  test("teacher may override the prefilled grade before submission", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const captured: CreateClassInput[] = [];
    const createClass: CreateClass = async (input) => {
      captured.push(input);
      return Object.freeze({
        classId: "c",
        joinCode: "CODE",
        alreadyCreated: false,
      });
    };
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      defaultGrade: "6",
    });
    await openCreateForm(mount);

    const title = mount.querySelector<HTMLInputElement>(
      "[data-testid=classes-create-title]",
    )!;
    title.value = "Override";
    title.dispatchEvent(new Event("input", { bubbles: true }));

    const grade = mount.querySelector<HTMLSelectElement>(
      "[data-testid=classes-create-grade]",
    )!;
    expect(grade.value).toBe("6");
    grade.value = "8";
    grade.dispatchEvent(new Event("change", { bubbles: true }));
    // Phase 2B.4: block never prefills.
    const block = mount.querySelector<HTMLSelectElement>(
      "[data-testid=classes-create-block]",
    )!;
    block.value = "B";
    block.dispatchEvent(new Event("change", { bubbles: true }));

    mount
      .querySelector<HTMLFormElement>("[data-testid=classes-create-form]")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    await flush();
    expect(captured[0]!.grade).toBe("8");
    expect(captured[0]!.block).toBe("B");
  });

  test("successful class creation triggers a best-effort preference update", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "CODE", alreadyCreated: false });
    const updates: Array<"6" | "7" | "8" | null> = [];
    const updateDefaultGrade = async (
      next: "6" | "7" | "8" | null,
    ): Promise<void> => {
      updates.push(next);
    };
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      defaultGrade: null,
      updateDefaultGrade,
    });
    await openCreateForm(mount);
    const title = mount.querySelector<HTMLInputElement>(
      "[data-testid=classes-create-title]",
    )!;
    title.value = "New";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    const grade = mount.querySelector<HTMLSelectElement>(
      "[data-testid=classes-create-grade]",
    )!;
    grade.value = "6";
    grade.dispatchEvent(new Event("change", { bubbles: true }));
    const block = mount.querySelector<HTMLSelectElement>(
      "[data-testid=classes-create-block]",
    )!;
    block.value = "A";
    block.dispatchEvent(new Event("change", { bubbles: true }));

    mount
      .querySelector<HTMLFormElement>("[data-testid=classes-create-form]")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    await flush();
    expect(updates).toEqual(["6"]);
  });

  test("failed class creation does not update the preference", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async () => {
      throw Object.assign(new Error("nope"), { code: "internal" });
    };
    const updates: Array<"6" | "7" | "8" | null> = [];
    const updateDefaultGrade = async (
      next: "6" | "7" | "8" | null,
    ): Promise<void> => {
      updates.push(next);
    };
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      defaultGrade: null,
      updateDefaultGrade,
    });
    await openCreateForm(mount);
    const title = mount.querySelector<HTMLInputElement>(
      "[data-testid=classes-create-title]",
    )!;
    title.value = "Fail";
    title.dispatchEvent(new Event("input", { bubbles: true }));

    mount
      .querySelector<HTMLFormElement>("[data-testid=classes-create-form]")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    await flush();
    expect(updates).toEqual([]);
  });

  test("failed preference update does not undo a successful class creation", async () => {
    const mount = mkMount();
    const created: string[] = [];
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async (input) => {
      created.push(input.title);
      return Object.freeze({
        classId: "c",
        joinCode: "OK",
        alreadyCreated: false,
      });
    };
    const updateDefaultGrade = async (): Promise<void> => {
      throw new Error("preference storage unavailable");
    };
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      defaultGrade: null,
      updateDefaultGrade,
    });
    await openCreateForm(mount);
    const title = mount.querySelector<HTMLInputElement>(
      "[data-testid=classes-create-title]",
    )!;
    title.value = "Survives";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    // Phase 2B.4: explicit grade and block are required.
    const grade = mount.querySelector<HTMLSelectElement>(
      "[data-testid=classes-create-grade]",
    )!;
    grade.value = "7";
    grade.dispatchEvent(new Event("change", { bubbles: true }));
    const block = mount.querySelector<HTMLSelectElement>(
      "[data-testid=classes-create-block]",
    )!;
    block.value = "A";
    block.dispatchEvent(new Event("change", { bubbles: true }));
    mount
      .querySelector<HTMLFormElement>("[data-testid=classes-create-form]")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    await flush();
    await flush();
    // Class creation succeeded even though the best-effort preference
    // write threw.
    expect(created).toEqual(["Survives"]);
    // The join-code panel signals success.
    expect(
      mount.querySelector("[data-testid=classes-joincode-panel]"),
    ).not.toBeNull();
  });
});

// Sprint 24B Phase 2B.4 - imported-class setup form / activation flow.
describe("Imported-class setup form (Phase 2B.4)", () => {
  // Manual-class fixtures (no isLmsLinked). The joinCode on activeSummary
  // is correct for a manually created class. LMS-class fixtures live in
  // the Phase 2B.8 describe blocks below.
  const needsSetupSummary: ClassSummary = Object.freeze({
    id: "cid-needssetup-1",
    title: "Imported Period 4",
    status: "needsSetup" as const,
  });
  const activeSummary: ClassSummary = Object.freeze({
    id: "cid-needssetup-1",
    title: "Imported Period 4",
    status: "active" as const,
    grade: "7",
    block: "A",
    joinCode: "AAAABBBB",
  });

  const openSetup = async (mount: HTMLElement): Promise<void> => {
    await flush();
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        `[data-testid=class-card-${needsSetupSummary.id}]`,
      )!
      .click();
    await flush();
  };

  test("opening a needsSetup class routes directly to the setup form", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [
      needsSetupSummary,
    ];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "X", alreadyCreated: false });
    const activateClass = jest.fn();
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      activateClass,
    });
    await openSetup(mount);

    expect(
      mount.querySelector("[data-testid=class-setup-form]"),
    ).not.toBeNull();
    // Snapshot / roster nav is hidden for a needsSetup class.
    expect(mount.querySelector("[data-testid=class-nav]")).toBeNull();
    // Grade begins empty when no preference exists.
    const grade = mount.querySelector<HTMLSelectElement>(
      "[data-testid=class-setup-grade]",
    )!;
    expect(grade.value).toBe("");
    const block = mount.querySelector<HTMLSelectElement>(
      "[data-testid=class-setup-block]",
    )!;
    expect(block.value).toBe("");
    // Class title appears in the setup headline.
    const headline = mount.querySelector<HTMLElement>(
      "[data-testid=surface-headline]",
    );
    expect(headline!.textContent).toMatch(/Imported Period 4/);
    // No join code before activation.
    expect(
      mount.querySelector("[data-testid=classes-joincode-panel]"),
    ).toBeNull();
  });

  test("saved defaultGrade prefills the setup grade select", async () => {
    const mount = mkMount();
    const listClasses = async () => [needsSetupSummary];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "X", alreadyCreated: false });
    const activateClass = jest.fn();
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      activateClass,
      defaultGrade: "8",
    });
    await openSetup(mount);
    const grade = mount.querySelector<HTMLSelectElement>(
      "[data-testid=class-setup-grade]",
    )!;
    expect(grade.value).toBe("8");
    const block = mount.querySelector<HTMLSelectElement>(
      "[data-testid=class-setup-block]",
    )!;
    expect(block.value).toBe("");
  });

  test("submit without grade is rejected before activation is invoked", async () => {
    const mount = mkMount();
    const listClasses = async () => [needsSetupSummary];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "X", alreadyCreated: false });
    const activateClass = jest.fn();
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      activateClass,
    });
    await openSetup(mount);
    mount
      .querySelector<HTMLFormElement>("[data-testid=class-setup-form]")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(activateClass).not.toHaveBeenCalled();
    const err = mount.querySelector<HTMLElement>(
      "[data-testid=class-setup-error]",
    );
    expect(err).not.toBeNull();
    expect(err!.textContent).toMatch(/grade/i);
  });

  test("submit without block is rejected before activation is invoked", async () => {
    const mount = mkMount();
    const listClasses = async () => [needsSetupSummary];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "X", alreadyCreated: false });
    const activateClass = jest.fn();
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      activateClass,
      defaultGrade: "7",
    });
    await openSetup(mount);
    mount
      .querySelector<HTMLFormElement>("[data-testid=class-setup-form]")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(activateClass).not.toHaveBeenCalled();
    const err = mount.querySelector<HTMLElement>(
      "[data-testid=class-setup-error]",
    );
    expect(err).not.toBeNull();
    expect(err!.textContent).toMatch(/block/i);
  });

  test("valid submission calls classesActivate with only classId, grade, block", async () => {
    const mount = mkMount();
    let calls = 0;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => {
      calls += 1;
      return calls === 1 ? [needsSetupSummary] : [activeSummary];
    };
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "X", alreadyCreated: false });
    const activateArgs: unknown[] = [];
    const activateClass = jest.fn(async (input: unknown) => {
      activateArgs.push(input);
      return Object.freeze({
        classId: (input as { classId: string }).classId,
        status: "active" as const,
        joinCode: "AAAABBBB",
        alreadyActive: false,
      });
    });
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      activateClass,
    });
    await openSetup(mount);
    const grade = mount.querySelector<HTMLSelectElement>(
      "[data-testid=class-setup-grade]",
    )!;
    grade.value = "7";
    grade.dispatchEvent(new Event("change", { bubbles: true }));
    const block = mount.querySelector<HTMLSelectElement>(
      "[data-testid=class-setup-block]",
    )!;
    block.value = "C";
    block.dispatchEvent(new Event("change", { bubbles: true }));
    mount
      .querySelector<HTMLFormElement>("[data-testid=class-setup-form]")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    await flush();
    await flush();
    expect(activateArgs).toEqual([
      { classId: "cid-needssetup-1", grade: "7", block: "C" },
    ]);
  });

  test("successful activation navigates to Snapshot on the now-active class", async () => {
    const mount = mkMount();
    let calls = 0;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => {
      calls += 1;
      return calls === 1 ? [needsSetupSummary] : [activeSummary];
    };
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "X", alreadyCreated: false });
    const activateClass = async () =>
      Object.freeze({
        classId: needsSetupSummary.id,
        status: "active" as const,
        joinCode: "AAAABBBB",
        alreadyActive: false,
      });
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      activateClass,
    });
    await openSetup(mount);
    const grade = mount.querySelector<HTMLSelectElement>(
      "[data-testid=class-setup-grade]",
    )!;
    grade.value = "7";
    grade.dispatchEvent(new Event("change", { bubbles: true }));
    const block = mount.querySelector<HTMLSelectElement>(
      "[data-testid=class-setup-block]",
    )!;
    block.value = "A";
    block.dispatchEvent(new Event("change", { bubbles: true }));
    mount
      .querySelector<HTMLFormElement>("[data-testid=class-setup-form]")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    await flush();
    await flush();
    const workspace = mount.querySelector<HTMLElement>(
      "[data-testid=class-workspace]",
    );
    expect(workspace).not.toBeNull();
    expect(workspace!.getAttribute("data-class-tab")).toBe("snapshot");
    expect(
      mount.querySelector("[data-testid=class-setup-form]"),
    ).toBeNull();
  });

  test("activation failure leaves the setup form editable with the error surfaced", async () => {
    const mount = mkMount();
    const listClasses = async () => [needsSetupSummary];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "X", alreadyCreated: false });
    const activateClass = async () => {
      throw Object.assign(new Error("nope"), {
        code: "classes.joinCodeGenerationFailed",
      });
    };
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      activateClass,
    });
    await openSetup(mount);
    const grade = mount.querySelector<HTMLSelectElement>(
      "[data-testid=class-setup-grade]",
    )!;
    grade.value = "7";
    grade.dispatchEvent(new Event("change", { bubbles: true }));
    const block = mount.querySelector<HTMLSelectElement>(
      "[data-testid=class-setup-block]",
    )!;
    block.value = "A";
    block.dispatchEvent(new Event("change", { bubbles: true }));
    mount
      .querySelector<HTMLFormElement>("[data-testid=class-setup-form]")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    await flush();
    // Form remains, error is announced, values still selected.
    expect(
      mount.querySelector("[data-testid=class-setup-form]"),
    ).not.toBeNull();
    const err = mount.querySelector<HTMLElement>(
      "[data-testid=class-setup-error]",
    );
    expect(err).not.toBeNull();
    expect(err!.textContent).not.toMatch(/joinCodeGenerationFailed/);
    // Submit is re-enabled.
    const submit = mount.querySelector<HTMLButtonElement>(
      "[data-testid=class-setup-submit]",
    )!;
    expect(submit.disabled).toBe(false);
  });

  test("preference update fires best-effort after successful activation", async () => {
    const mount = mkMount();
    let calls = 0;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => {
      calls += 1;
      return calls === 1 ? [needsSetupSummary] : [activeSummary];
    };
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "X", alreadyCreated: false });
    const activateClass = async () =>
      Object.freeze({
        classId: needsSetupSummary.id,
        status: "active" as const,
        joinCode: "AAAABBBB",
        alreadyActive: false,
      });
    const updates: Array<"6" | "7" | "8" | null> = [];
    const updateDefaultGrade = async (next: "6" | "7" | "8" | null) => {
      updates.push(next);
    };
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      activateClass,
      updateDefaultGrade,
    });
    await openSetup(mount);
    const grade = mount.querySelector<HTMLSelectElement>(
      "[data-testid=class-setup-grade]",
    )!;
    grade.value = "8";
    grade.dispatchEvent(new Event("change", { bubbles: true }));
    const block = mount.querySelector<HTMLSelectElement>(
      "[data-testid=class-setup-block]",
    )!;
    block.value = "D";
    block.dispatchEvent(new Event("change", { bubbles: true }));
    mount
      .querySelector<HTMLFormElement>("[data-testid=class-setup-form]")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    await flush();
    await flush();
    expect(updates).toEqual(["8"]);
  });

  test("preference update failure does not undo activation", async () => {
    const mount = mkMount();
    let calls = 0;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => {
      calls += 1;
      return calls === 1 ? [needsSetupSummary] : [activeSummary];
    };
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "X", alreadyCreated: false });
    const activateClass = async () =>
      Object.freeze({
        classId: needsSetupSummary.id,
        status: "active" as const,
        joinCode: "AAAABBBB",
        alreadyActive: false,
      });
    const updateDefaultGrade = async () => {
      throw new Error("preference storage unavailable");
    };
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      activateClass,
      updateDefaultGrade,
    });
    await openSetup(mount);
    const grade = mount.querySelector<HTMLSelectElement>(
      "[data-testid=class-setup-grade]",
    )!;
    grade.value = "7";
    grade.dispatchEvent(new Event("change", { bubbles: true }));
    const block = mount.querySelector<HTMLSelectElement>(
      "[data-testid=class-setup-block]",
    )!;
    block.value = "A";
    block.dispatchEvent(new Event("change", { bubbles: true }));
    mount
      .querySelector<HTMLFormElement>("[data-testid=class-setup-form]")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    await flush();
    await flush();
    // Navigation still landed on Snapshot for the now-active class.
    const workspace = mount.querySelector<HTMLElement>(
      "[data-testid=class-workspace]",
    );
    expect(workspace).not.toBeNull();
    expect(workspace!.getAttribute("data-class-tab")).toBe("snapshot");
  });

  test("cancel returns to Classes list without invoking activation", async () => {
    const mount = mkMount();
    const listClasses = async () => [needsSetupSummary];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "X", alreadyCreated: false });
    const activateClass = jest.fn();
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      activateClass,
    });
    await openSetup(mount);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=class-setup-cancel]")!
      .click();
    await flush();
    expect(activateClass).not.toHaveBeenCalled();
    expect(
      mount.querySelector("[data-testid=classes-list]"),
    ).not.toBeNull();
  });

  test("without an activateClass seam the submit button is disabled and unavailable copy is shown", async () => {
    const mount = mkMount();
    const listClasses = async () => [needsSetupSummary];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "X", alreadyCreated: false });
    renderClassesSurface(mount, teacher, { listClasses, createClass });
    await openSetup(mount);
    const submit = mount.querySelector<HTMLButtonElement>(
      "[data-testid=class-setup-submit]",
    );
    expect(submit).not.toBeNull();
    expect(submit!.disabled).toBe(true);
    expect(
      mount.querySelector("[data-testid=class-setup-unavailable]"),
    ).not.toBeNull();
  });
});

// Sprint 24B Phase 2B.8 - LMS activation auto-sync.
// These tests use LMS-specific fixtures. An LMS class never carries a
// joinCode (Phase 2B.7 invariant) and always carries isLmsLinked: true.
describe("Phase 2B.8: LMS activation auto-sync", () => {
  const LMS_CLASS_ID = "cid-lms-autosync-1";

  const lmsNeedsSetupSummary: ClassSummary = Object.freeze({
    id: LMS_CLASS_ID,
    title: "LMS Period 4",
    status: "needsSetup" as const,
    isLmsLinked: true,
  });
  const lmsActiveSummary: ClassSummary = Object.freeze({
    id: LMS_CLASS_ID,
    title: "LMS Period 4",
    status: "active" as const,
    grade: "7",
    block: "B",
    isLmsLinked: true,
  });

  const activateResult: ActivateClassResult = Object.freeze({
    classId: LMS_CLASS_ID,
    status: "active" as const,
    joinCode: null,
    alreadyActive: false,
  });

  const defaultSyncResult: SyncRosterResult = Object.freeze({
    classId: LMS_CLASS_ID,
    added: 22,
    reactivated: 0,
    unchanged: 3,
    withdrawn: 1,
    unresolved: 0,
    skipped: 0,
    upstreamRosterEmpty: false,
  });

  const openLmsSetup = async (mount: HTMLElement): Promise<void> => {
    await flush();
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        `[data-testid=class-card-${LMS_CLASS_ID}]`,
      )!
      .click();
    await flush();
  };

  const submitSetupForm = (mount: HTMLElement): void => {
    const grade = mount.querySelector<HTMLSelectElement>(
      "[data-testid=class-setup-grade]",
    )!;
    grade.value = "7";
    grade.dispatchEvent(new Event("change", { bubbles: true }));
    const block = mount.querySelector<HTMLSelectElement>(
      "[data-testid=class-setup-block]",
    )!;
    block.value = "B";
    block.dispatchEvent(new Event("change", { bubbles: true }));
    mount
      .querySelector<HTMLFormElement>("[data-testid=class-setup-form]")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  };

  test("syncRoster is called exactly once with the activated classId after LMS activation", async () => {
    const mount = mkMount();
    let listCallCount = 0;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => {
      listCallCount++;
      return listCallCount === 1 ? [lmsNeedsSetupSummary] : [lmsActiveSummary];
    };
    const syncRoster = jest.fn(
      async (): Promise<SyncRosterResult> =>
        defaultSyncResult,
    );
    const activateClass: ActivateClass = async () => activateResult;
    renderClassesSurface(mount, teacher, {
      listClasses,
      syncRoster,
      activateClass,
    });
    await openLmsSetup(mount);
    submitSetupForm(mount);
    await flush();
    await flush();
    await flush();
    expect(syncRoster).toHaveBeenCalledTimes(1);
    expect(syncRoster).toHaveBeenCalledWith({ classId: LMS_CLASS_ID });
  });

  test("syncRoster call carries only { classId } - no extra fields", async () => {
    const mount = mkMount();
    let listCallCount = 0;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => {
      listCallCount++;
      return listCallCount === 1 ? [lmsNeedsSetupSummary] : [lmsActiveSummary];
    };
    const calls: Array<unknown> = [];
    const syncRoster: SyncRoster = async (input) => {
      calls.push({ ...input });
      return defaultSyncResult;
    };
    const activateClass: ActivateClass = async () => activateResult;
    renderClassesSurface(mount, teacher, {
      listClasses,
      syncRoster,
      activateClass,
    });
    await openLmsSetup(mount);
    submitSetupForm(mount);
    await flush();
    await flush();
    await flush();
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0] as object)).toEqual(["classId"]);
    expect((calls[0] as { classId: string }).classId).toBe(LMS_CLASS_ID);
  });

  test("syncRoster is not called before activateClass resolves", async () => {
    const mount = mkMount();
    let listCallCount = 0;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => {
      listCallCount++;
      return listCallCount === 1 ? [lmsNeedsSetupSummary] : [lmsActiveSummary];
    };
    const syncRoster = jest.fn(
      async (): Promise<SyncRosterResult> =>
        defaultSyncResult,
    );
    let resolveActivate!: (r: ActivateClassResult) => void;
    const activateClass: ActivateClass = () =>
      new Promise<ActivateClassResult>((resolve) => {
        resolveActivate = resolve;
      });
    renderClassesSurface(mount, teacher, {
      listClasses,
      syncRoster,
      activateClass,
    });
    await openLmsSetup(mount);
    submitSetupForm(mount);
    await flush();
    // activateClass promise is still pending; syncRoster must not have fired
    expect(syncRoster).not.toHaveBeenCalled();
    resolveActivate(activateResult);
    await flush();
    await flush();
    expect(syncRoster).toHaveBeenCalledTimes(1);
  });

  test("syncRoster is not called before the refreshed class list resolves", async () => {
    const mount = mkMount();
    let listCallCount = 0;
    let resolveList2!: (classes: ReadonlyArray<ClassSummary>) => void;
    const listClasses = (): Promise<ReadonlyArray<ClassSummary>> => {
      listCallCount++;
      if (listCallCount === 1) return Promise.resolve([lmsNeedsSetupSummary]);
      return new Promise<ReadonlyArray<ClassSummary>>((resolve) => {
        resolveList2 = resolve;
      });
    };
    const syncRoster = jest.fn(
      async (): Promise<SyncRosterResult> =>
        defaultSyncResult,
    );
    const activateClass: ActivateClass = async () => activateResult;
    renderClassesSurface(mount, teacher, {
      listClasses,
      syncRoster,
      activateClass,
    });
    await openLmsSetup(mount);
    submitSetupForm(mount);
    // activateClass resolves immediately; allow its .then() to fire
    await flush();
    await flush();
    // Second listClasses call is still pending; syncRoster must not have fired
    expect(syncRoster).not.toHaveBeenCalled();
    resolveList2([lmsActiveSummary]);
    await flush();
    expect(syncRoster).toHaveBeenCalledTimes(1);
  });

  test("roster sync panel is rendered before syncRoster promise resolves", async () => {
    const mount = mkMount();
    let listCallCount = 0;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => {
      listCallCount++;
      return listCallCount === 1 ? [lmsNeedsSetupSummary] : [lmsActiveSummary];
    };
    let resolveSyncRoster!: (r: SyncRosterResult) => void;
    const syncRoster: SyncRoster = () =>
      new Promise<SyncRosterResult>((resolve) => {
        resolveSyncRoster = resolve;
      });
    const activateClass: ActivateClass = async () => activateResult;
    renderClassesSurface(mount, teacher, {
      listClasses,
      syncRoster,
      activateClass,
    });
    await openLmsSetup(mount);
    submitSetupForm(mount);
    await flush();
    await flush();
    await flush();
    // syncRoster is in flight; panel must already be visible
    expect(
      mount.querySelector("[data-testid=class-rostersync]"),
    ).not.toBeNull();
    resolveSyncRoster(defaultSyncResult);
    await flush();
  });

  test("sync button is disabled with aria-busy while syncRoster is in flight", async () => {
    const mount = mkMount();
    let listCallCount = 0;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => {
      listCallCount++;
      return listCallCount === 1 ? [lmsNeedsSetupSummary] : [lmsActiveSummary];
    };
    let resolveSyncRoster!: (r: SyncRosterResult) => void;
    const syncRoster: SyncRoster = () =>
      new Promise<SyncRosterResult>((resolve) => {
        resolveSyncRoster = resolve;
      });
    const activateClass: ActivateClass = async () => activateResult;
    renderClassesSurface(mount, teacher, {
      listClasses,
      syncRoster,
      activateClass,
    });
    await openLmsSetup(mount);
    submitSetupForm(mount);
    await flush();
    await flush();
    await flush();
    const button = mount.querySelector<HTMLButtonElement>(
      "[data-testid=class-rostersync-button]",
    );
    expect(button).not.toBeNull();
    expect(button!.disabled).toBe(true);
    expect(button!.getAttribute("aria-busy")).toBe("true");
    resolveSyncRoster(defaultSyncResult);
    await flush();
    const buttonAfter = mount.querySelector<HTMLButtonElement>(
      "[data-testid=class-rostersync-button]",
    );
    expect(buttonAfter!.disabled).toBe(false);
    expect(buttonAfter!.getAttribute("aria-busy")).toBeNull();
  });

  test("workspace renders snapshot for the activated class before syncRoster completes", async () => {
    const mount = mkMount();
    let listCallCount = 0;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => {
      listCallCount++;
      return listCallCount === 1 ? [lmsNeedsSetupSummary] : [lmsActiveSummary];
    };
    let resolveSyncRoster!: (r: SyncRosterResult) => void;
    const syncRoster: SyncRoster = () =>
      new Promise<SyncRosterResult>((resolve) => {
        resolveSyncRoster = resolve;
      });
    const activateClass: ActivateClass = async () => activateResult;
    renderClassesSurface(mount, teacher, {
      listClasses,
      syncRoster,
      activateClass,
    });
    await openLmsSetup(mount);
    submitSetupForm(mount);
    await flush();
    await flush();
    await flush();
    const workspace = mount.querySelector<HTMLElement>(
      "[data-testid=class-workspace]",
    );
    expect(workspace).not.toBeNull();
    expect(workspace!.getAttribute("data-class-tab")).toBe("snapshot");
    expect(mount.querySelector("[data-testid=class-setup-form]")).toBeNull();
    resolveSyncRoster(defaultSyncResult);
    await flush();
  });

  test("after syncRoster resolves the status area shows aggregate counters", async () => {
    const mount = mkMount();
    let listCallCount = 0;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => {
      listCallCount++;
      return listCallCount === 1 ? [lmsNeedsSetupSummary] : [lmsActiveSummary];
    };
    const syncRoster: SyncRoster = async () => defaultSyncResult;
    const activateClass: ActivateClass = async () => activateResult;
    renderClassesSurface(mount, teacher, {
      listClasses,
      syncRoster,
      activateClass,
    });
    await openLmsSetup(mount);
    submitSetupForm(mount);
    await flush();
    await flush();
    await flush();
    const status = mount.querySelector<HTMLElement>(
      "[data-testid=class-rostersync-status]",
    );
    expect(status).not.toBeNull();
    expect(status!.textContent).toMatch(/Roster synced/);
    expect(status!.textContent).toMatch(/Added: 22/);
    expect(status!.textContent).toMatch(/Unchanged: 3/);
    expect(status!.textContent).toMatch(/Withdrawn: 1/);
    expect(status!.textContent).toMatch(/Unresolved: 0/);
    expect(
      mount.querySelector("[data-testid=class-rostersync]")!.getAttribute(
        "data-rostersync-status",
      ),
    ).toBe("ok");
  });

  test("after syncRoster rejects the status area shows calm error recovery copy", async () => {
    const mount = mkMount();
    let listCallCount = 0;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => {
      listCallCount++;
      return listCallCount === 1 ? [lmsNeedsSetupSummary] : [lmsActiveSummary];
    };
    const syncRoster: SyncRoster = async () => {
      // Throw a shaped error matching the SyncRosterError contract.
      // runRosterSync checks err.kind as a string property rather than
      // instanceof, so a plain shaped Error is sufficient here.
      throw Object.assign(new Error("network failure"), {
        kind: "transient" as const,
        serverCode: null,
        name: "SyncRosterError",
      });
    };
    const activateClass: ActivateClass = async () => activateResult;
    renderClassesSurface(mount, teacher, {
      listClasses,
      syncRoster,
      activateClass,
    });
    await openLmsSetup(mount);
    submitSetupForm(mount);
    await flush();
    await flush();
    await flush();
    const status = mount.querySelector<HTMLElement>(
      "[data-testid=class-rostersync-status]",
    );
    expect(status).not.toBeNull();
    // Calm recovery copy; raw error message and error kind must not appear
    expect(status!.textContent).not.toMatch(/network failure/i);
    expect(status!.textContent).not.toMatch(/transient/i);
    const panel = mount.querySelector("[data-testid=class-rostersync]")!;
    expect(panel.getAttribute("data-rostersync-status")).toBe("error");
    expect(panel.getAttribute("data-rostersync-error-kind")).toBe("transient");
  });

  test("listClasses is called exactly twice: once on mount and once after activation", async () => {
    const mount = mkMount();
    let listCallCount = 0;
    const listClasses = jest.fn(
      async (): Promise<ReadonlyArray<ClassSummary>> => {
        listCallCount++;
        return listCallCount === 1
          ? [lmsNeedsSetupSummary]
          : [lmsActiveSummary];
      },
    );
    const syncRoster: SyncRoster = async () => defaultSyncResult;
    const activateClass: ActivateClass = async () => activateResult;
    renderClassesSurface(mount, teacher, {
      listClasses,
      syncRoster,
      activateClass,
    });
    await openLmsSetup(mount);
    submitSetupForm(mount);
    await flush();
    await flush();
    await flush();
    expect(listClasses).toHaveBeenCalledTimes(2);
  });
});

// Sprint 24B Phase 2B.8 - negative gates for auto-sync.
// syncRoster must remain uncalled in each scenario.
describe("Phase 2B.8: auto-sync negative gates", () => {
  const LMS_CLASS_ID = "cid-lms-gate-1";

  const lmsNeedsSetupSummary: ClassSummary = Object.freeze({
    id: LMS_CLASS_ID,
    title: "LMS Period 4",
    status: "needsSetup" as const,
    isLmsLinked: true,
  });
  const lmsActiveSummary: ClassSummary = Object.freeze({
    id: LMS_CLASS_ID,
    title: "LMS Period 4",
    status: "active" as const,
    grade: "7",
    block: "B",
    isLmsLinked: true,
  });

  const activateResult: ActivateClassResult = Object.freeze({
    classId: LMS_CLASS_ID,
    status: "active" as const,
    joinCode: null,
    alreadyActive: false,
  });

  const emptySyncResult: SyncRosterResult = Object.freeze({
    classId: LMS_CLASS_ID,
    added: 0,
    reactivated: 0,
    unchanged: 0,
    withdrawn: 0,
    unresolved: 0,
    skipped: 0,
    upstreamRosterEmpty: false,
  });

  const openLmsSetup = async (mount: HTMLElement): Promise<void> => {
    await flush();
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        `[data-testid=class-card-${LMS_CLASS_ID}]`,
      )!
      .click();
    await flush();
  };

  const submitSetupForm = (mount: HTMLElement): void => {
    const grade = mount.querySelector<HTMLSelectElement>(
      "[data-testid=class-setup-grade]",
    )!;
    grade.value = "7";
    grade.dispatchEvent(new Event("change", { bubbles: true }));
    const block = mount.querySelector<HTMLSelectElement>(
      "[data-testid=class-setup-block]",
    )!;
    block.value = "B";
    block.dispatchEvent(new Event("change", { bubbles: true }));
    mount
      .querySelector<HTMLFormElement>("[data-testid=class-setup-form]")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  };

  test("syncRoster is not called when activateClass rejects", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [
      lmsNeedsSetupSummary,
    ];
    const syncRoster = jest.fn(
      async (): Promise<SyncRosterResult> =>
        emptySyncResult,
    );
    const activateClass: ActivateClass = async () => {
      throw Object.assign(new Error("activation failed"), {
        code: "classes.joinCodeGenerationFailed",
      });
    };
    renderClassesSurface(mount, teacher, {
      listClasses,
      syncRoster,
      activateClass,
    });
    await openLmsSetup(mount);
    submitSetupForm(mount);
    await flush();
    await flush();
    expect(syncRoster).not.toHaveBeenCalled();
  });

  test("syncRoster is not called when the refreshed class remains needsSetup", async () => {
    const mount = mkMount();
    // Both list calls return needsSetup; simulates a read-after-write
    // visibility delay where the class doc has not yet flipped to active.
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [
      lmsNeedsSetupSummary,
    ];
    const syncRoster = jest.fn(
      async (): Promise<SyncRosterResult> =>
        emptySyncResult,
    );
    const activateClass: ActivateClass = async () => activateResult;
    renderClassesSurface(mount, teacher, {
      listClasses,
      syncRoster,
      activateClass,
    });
    await openLmsSetup(mount);
    submitSetupForm(mount);
    await flush();
    await flush();
    await flush();
    expect(syncRoster).not.toHaveBeenCalled();
  });

  test("syncRoster is not called when the activated class is absent from the refreshed list", async () => {
    const mount = mkMount();
    let listCallCount = 0;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => {
      listCallCount++;
      // Second call returns an empty list; class disappeared (race with archive).
      return listCallCount === 1 ? [lmsNeedsSetupSummary] : [];
    };
    const syncRoster = jest.fn(
      async (): Promise<SyncRosterResult> =>
        emptySyncResult,
    );
    const activateClass: ActivateClass = async () => activateResult;
    renderClassesSurface(mount, teacher, {
      listClasses,
      syncRoster,
      activateClass,
    });
    await openLmsSetup(mount);
    submitSetupForm(mount);
    await flush();
    await flush();
    await flush();
    expect(syncRoster).not.toHaveBeenCalled();
  });

  test("syncRoster is not called when the refreshed class is active but isLmsLinked is false", async () => {
    const mount = mkMount();
    const manualActiveSummary: ClassSummary = Object.freeze({
      id: LMS_CLASS_ID,
      title: "Manual Period 4",
      status: "active" as const,
      grade: "7",
      block: "B",
      joinCode: "AAAABBBB",
      isLmsLinked: false,
    });
    let listCallCount = 0;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => {
      listCallCount++;
      return listCallCount === 1 ? [lmsNeedsSetupSummary] : [manualActiveSummary];
    };
    const syncRoster = jest.fn(
      async (): Promise<SyncRosterResult> =>
        emptySyncResult,
    );
    const activateClass: ActivateClass = async () => activateResult;
    renderClassesSurface(mount, teacher, {
      listClasses,
      syncRoster,
      activateClass,
    });
    await openLmsSetup(mount);
    submitSetupForm(mount);
    await flush();
    await flush();
    await flush();
    expect(syncRoster).not.toHaveBeenCalled();
  });

  test("syncRoster is not called when the refreshed class is active and isLmsLinked is absent", async () => {
    const mount = mkMount();
    const plainActiveSummary: ClassSummary = Object.freeze({
      id: LMS_CLASS_ID,
      title: "Plain Period 4",
      status: "active" as const,
      grade: "7",
      block: "B",
    });
    let listCallCount = 0;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => {
      listCallCount++;
      return listCallCount === 1 ? [lmsNeedsSetupSummary] : [plainActiveSummary];
    };
    const syncRoster = jest.fn(
      async (): Promise<SyncRosterResult> =>
        emptySyncResult,
    );
    const activateClass: ActivateClass = async () => activateResult;
    renderClassesSurface(mount, teacher, {
      listClasses,
      syncRoster,
      activateClass,
    });
    await openLmsSetup(mount);
    submitSetupForm(mount);
    await flush();
    await flush();
    await flush();
    expect(syncRoster).not.toHaveBeenCalled();
  });

  test("syncRoster is not called when the syncRoster dependency is absent", async () => {
    const mount = mkMount();
    let listCallCount = 0;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => {
      listCallCount++;
      return listCallCount === 1 ? [lmsNeedsSetupSummary] : [lmsActiveSummary];
    };
    const activateClass: ActivateClass = async () => activateResult;
    // syncRoster is not passed; surface must not throw and workspace must appear
    renderClassesSurface(mount, teacher, {
      listClasses,
      activateClass,
    });
    await openLmsSetup(mount);
    submitSetupForm(mount);
    await flush();
    await flush();
    await flush();
    const workspace = mount.querySelector("[data-testid=class-workspace]");
    expect(workspace).not.toBeNull();
    expect(mount.querySelector("[data-testid=class-rostersync]")).toBeNull();
  });

  test("syncRoster is not called when the list refresh after activation rejects", async () => {
    const mount = mkMount();
    let listCallCount = 0;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => {
      listCallCount++;
      if (listCallCount === 1) return [lmsNeedsSetupSummary];
      throw new Error("Firestore unavailable");
    };
    const syncRoster = jest.fn(
      async (): Promise<SyncRosterResult> =>
        emptySyncResult,
    );
    const activateClass: ActivateClass = async () => activateResult;
    renderClassesSurface(mount, teacher, {
      listClasses,
      syncRoster,
      activateClass,
    });
    await openLmsSetup(mount);
    submitSetupForm(mount);
    await flush();
    await flush();
    await flush();
    expect(syncRoster).not.toHaveBeenCalled();
    // Surface falls back to the class list on refresh failure
    expect(
      mount.querySelector("[data-testid=classes-list]"),
    ).not.toBeNull();
  });
});

// Sprint 24B Phase 2B.8 - roster sync panel and manual sync button.
// These tests navigate to an already-active LMS class and interact with
// the Sync roster affordance directly.
describe("Phase 2B.8: roster sync panel and manual sync button", () => {
  const LMS_CLASS_ID = "cid-lms-panel-1";

  const lmsActiveSummary: ClassSummary = Object.freeze({
    id: LMS_CLASS_ID,
    title: "LMS Active Period 4",
    status: "active" as const,
    grade: "7",
    block: "B",
    isLmsLinked: true,
  });

  const manualActiveSummary: ClassSummary = Object.freeze({
    id: "cid-manual-panel-1",
    title: "Manual Active Period 4",
    status: "active" as const,
    grade: "7",
    block: "C",
    joinCode: "MMMMNNN",
  });

  const lmsNeedsSetupSummary: ClassSummary = Object.freeze({
    id: LMS_CLASS_ID,
    title: "LMS Active Period 4",
    status: "needsSetup" as const,
    isLmsLinked: true,
  });

  const defaultSyncResult: SyncRosterResult = Object.freeze({
    classId: LMS_CLASS_ID,
    added: 10,
    reactivated: 2,
    unchanged: 5,
    withdrawn: 1,
    unresolved: 0,
    skipped: 0,
    upstreamRosterEmpty: false,
  });

  const openWorkspace = async (
    mount: HTMLElement,
    classId: string,
  ): Promise<void> => {
    await flush();
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        `[data-testid=class-card-${classId}]`,
      )!
      .click();
    await flush();
  };

  test("roster sync panel renders for an active LMS-linked class with syncRoster available", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [
      lmsActiveSummary,
    ];
    const syncRoster: SyncRoster = async () => defaultSyncResult;
    renderClassesSurface(mount, teacher, { listClasses, syncRoster });
    await openWorkspace(mount, LMS_CLASS_ID);
    expect(
      mount.querySelector("[data-testid=class-rostersync]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=class-rostersync-button]"),
    ).not.toBeNull();
  });

  test("roster sync panel does not render for a manual active class (isLmsLinked absent)", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [
      manualActiveSummary,
    ];
    const syncRoster: SyncRoster = async () => defaultSyncResult;
    renderClassesSurface(mount, teacher, { listClasses, syncRoster });
    await openWorkspace(mount, "cid-manual-panel-1");
    expect(mount.querySelector("[data-testid=class-rostersync]")).toBeNull();
  });

  test("roster sync panel does not render for a manual active class (isLmsLinked: false)", async () => {
    const mount = mkMount();
    const explicitlyManualSummary: ClassSummary = Object.freeze({
      id: "cid-explicit-manual-1",
      title: "Manual Period 5",
      status: "active" as const,
      grade: "7",
      block: "D",
      joinCode: "ZZZZWWWW",
      isLmsLinked: false,
    });
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [
      explicitlyManualSummary,
    ];
    const syncRoster: SyncRoster = async () => defaultSyncResult;
    renderClassesSurface(mount, teacher, { listClasses, syncRoster });
    await openWorkspace(mount, "cid-explicit-manual-1");
    expect(mount.querySelector("[data-testid=class-rostersync]")).toBeNull();
  });

  test("roster sync panel does not render for a needsSetup class", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [
      lmsNeedsSetupSummary,
    ];
    const syncRoster: SyncRoster = async () => defaultSyncResult;
    const activateClass = jest.fn();
    renderClassesSurface(mount, teacher, {
      listClasses,
      syncRoster,
      activateClass,
    });
    await flush();
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        `[data-testid=class-card-${LMS_CLASS_ID}]`,
      )!
      .click();
    await flush();
    expect(
      mount.querySelector("[data-testid=class-setup-form]"),
    ).not.toBeNull();
    expect(mount.querySelector("[data-testid=class-rostersync]")).toBeNull();
  });

  test("roster sync panel does not render when the syncRoster dependency is absent", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [
      lmsActiveSummary,
    ];
    renderClassesSurface(mount, teacher, { listClasses });
    await openWorkspace(mount, LMS_CLASS_ID);
    expect(mount.querySelector("[data-testid=class-rostersync]")).toBeNull();
  });

  test("Sync roster button invokes syncRoster exactly once per click", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [
      lmsActiveSummary,
    ];
    const syncRoster = jest.fn(
      async (): Promise<SyncRosterResult> =>
        defaultSyncResult,
    );
    renderClassesSurface(mount, teacher, { listClasses, syncRoster });
    await openWorkspace(mount, LMS_CLASS_ID);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=class-rostersync-button]")!
      .click();
    await flush();
    await flush();
    expect(syncRoster).toHaveBeenCalledTimes(1);
    expect(syncRoster).toHaveBeenCalledWith({ classId: LMS_CLASS_ID });
  });

  test("sync button is disabled with aria-busy while syncRoster is in flight", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [
      lmsActiveSummary,
    ];
    let resolveSyncRoster!: (r: SyncRosterResult) => void;
    const syncRoster: SyncRoster = () =>
      new Promise<SyncRosterResult>((resolve) => {
        resolveSyncRoster = resolve;
      });
    renderClassesSurface(mount, teacher, { listClasses, syncRoster });
    await openWorkspace(mount, LMS_CLASS_ID);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=class-rostersync-button]")!
      .click();
    await flush();
    const button = mount.querySelector<HTMLButtonElement>(
      "[data-testid=class-rostersync-button]",
    );
    expect(button!.disabled).toBe(true);
    expect(button!.getAttribute("aria-busy")).toBe("true");
    resolveSyncRoster(defaultSyncResult);
    await flush();
    const buttonAfter = mount.querySelector<HTMLButtonElement>(
      "[data-testid=class-rostersync-button]",
    );
    expect(buttonAfter!.disabled).toBe(false);
    expect(buttonAfter!.getAttribute("aria-busy")).toBeNull();
  });

  test("duplicate concurrent button clicks are suppressed", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [
      lmsActiveSummary,
    ];
    let resolveSyncRoster!: (r: SyncRosterResult) => void;
    const syncRoster = jest.fn(
      (): Promise<SyncRosterResult> =>
        new Promise<SyncRosterResult>((resolve) => {
          resolveSyncRoster = resolve;
        }),
    );
    renderClassesSurface(mount, teacher, { listClasses, syncRoster });
    await openWorkspace(mount, LMS_CLASS_ID);
    const button = mount.querySelector<HTMLButtonElement>(
      "[data-testid=class-rostersync-button]",
    )!;
    button.click();
    await flush();
    // Second click while in flight: the in-flight guard must block it
    button.click();
    await flush();
    expect(syncRoster).toHaveBeenCalledTimes(1);
    resolveSyncRoster(defaultSyncResult);
    await flush();
  });

  test("successful sync displays aggregate counters in the status area", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [
      lmsActiveSummary,
    ];
    const syncRoster: SyncRoster = async () => defaultSyncResult;
    renderClassesSurface(mount, teacher, { listClasses, syncRoster });
    await openWorkspace(mount, LMS_CLASS_ID);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=class-rostersync-button]")!
      .click();
    await flush();
    await flush();
    const status = mount.querySelector<HTMLElement>(
      "[data-testid=class-rostersync-status]",
    );
    expect(status).not.toBeNull();
    expect(status!.textContent).toMatch(/Roster synced/);
    expect(status!.textContent).toMatch(/Added: 10/);
    expect(status!.textContent).toMatch(/Unchanged: 5/);
    expect(status!.textContent).toMatch(/Withdrawn: 1/);
    expect(
      mount
        .querySelector("[data-testid=class-rostersync]")!
        .getAttribute("data-rostersync-status"),
    ).toBe("ok");
  });

  test("sync failure displays calm recovery copy and class workspace remains active", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [
      lmsActiveSummary,
    ];
    const syncRoster: SyncRoster = async () => {
      throw Object.assign(new Error("OAuth expired."), {
        kind: "reconnectRequired" as const,
        serverCode: "lms.upstreamAuthorizationFailed",
        name: "SyncRosterError",
      });
    };
    renderClassesSurface(mount, teacher, { listClasses, syncRoster });
    await openWorkspace(mount, LMS_CLASS_ID);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=class-rostersync-button]")!
      .click();
    await flush();
    await flush();
    const workspace = mount.querySelector<HTMLElement>(
      "[data-testid=class-workspace]",
    );
    expect(workspace).not.toBeNull();
    const status = mount.querySelector<HTMLElement>(
      "[data-testid=class-rostersync-status]",
    );
    expect(status).not.toBeNull();
    // Raw error message and server code must not appear in the UI
    expect(status!.textContent).not.toMatch(/OAuth expired/i);
    expect(status!.textContent).not.toMatch(/upstreamAuthorizationFailed/i);
    expect(status!.textContent).toMatch(/reconnect/i);
    const panel = mount.querySelector("[data-testid=class-rostersync]")!;
    expect(panel.getAttribute("data-rostersync-status")).toBe("error");
    expect(panel.getAttribute("data-rostersync-error-kind")).toBe(
      "reconnectRequired",
    );
  });
});

// Sprint 24B Phase 2B.8 - sync state persistence across rerenders.
describe("Phase 2B.8: sync state persistence across rerenders", () => {
  const LMS_CLASS_ID = "cid-lms-persist-1";

  const lmsNeedsSetupSummary: ClassSummary = Object.freeze({
    id: LMS_CLASS_ID,
    title: "LMS Period 4",
    status: "needsSetup" as const,
    isLmsLinked: true,
  });
  const lmsActiveSummary: ClassSummary = Object.freeze({
    id: LMS_CLASS_ID,
    title: "LMS Period 4",
    status: "active" as const,
    grade: "7",
    block: "B",
    isLmsLinked: true,
  });

  const activateResult: ActivateClassResult = Object.freeze({
    classId: LMS_CLASS_ID,
    status: "active" as const,
    joinCode: null,
    alreadyActive: false,
  });

  const defaultSyncResult: SyncRosterResult = Object.freeze({
    classId: LMS_CLASS_ID,
    added: 5,
    reactivated: 0,
    unchanged: 10,
    withdrawn: 0,
    unresolved: 0,
    skipped: 0,
    upstreamRosterEmpty: false,
  });

  const openLmsSetup = async (mount: HTMLElement): Promise<void> => {
    await flush();
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        `[data-testid=class-card-${LMS_CLASS_ID}]`,
      )!
      .click();
    await flush();
  };

  const submitSetupForm = (mount: HTMLElement): void => {
    const grade = mount.querySelector<HTMLSelectElement>(
      "[data-testid=class-setup-grade]",
    )!;
    grade.value = "7";
    grade.dispatchEvent(new Event("change", { bubbles: true }));
    const block = mount.querySelector<HTMLSelectElement>(
      "[data-testid=class-setup-block]",
    )!;
    block.value = "B";
    block.dispatchEvent(new Event("change", { bubbles: true }));
    mount
      .querySelector<HTMLFormElement>("[data-testid=class-setup-form]")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  };

  test("selected class remains selected in the workspace after activation", async () => {
    const mount = mkMount();
    let listCallCount = 0;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => {
      listCallCount++;
      return listCallCount === 1 ? [lmsNeedsSetupSummary] : [lmsActiveSummary];
    };
    const syncRoster: SyncRoster = async () => defaultSyncResult;
    const activateClass: ActivateClass = async () => activateResult;
    renderClassesSurface(mount, teacher, {
      listClasses,
      syncRoster,
      activateClass,
    });
    await openLmsSetup(mount);
    submitSetupForm(mount);
    await flush();
    await flush();
    await flush();
    const workspace = mount.querySelector<HTMLElement>(
      "[data-testid=class-workspace]",
    );
    expect(workspace).not.toBeNull();
    expect(workspace!.getAttribute("data-class-id")).toBe(LMS_CLASS_ID);
  });

  test("roster sync entry is idle before the first manual sync request", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [
      lmsActiveSummary,
    ];
    // Use a plain mock: the test validates idle state before any click,
    // so syncRoster should never be invoked in this test.
    const syncRoster: SyncRoster = async () => defaultSyncResult;
    renderClassesSurface(mount, teacher, { listClasses, syncRoster });
    await flush();
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        `[data-testid=class-card-${LMS_CLASS_ID}]`,
      )!
      .click();
    await flush();
    const button = mount.querySelector<HTMLButtonElement>(
      "[data-testid=class-rostersync-button]",
    );
    expect(button).not.toBeNull();
    expect(button!.disabled).toBe(false);
    const status = mount.querySelector<HTMLElement>(
      "[data-testid=class-rostersync-status]",
    );
    expect(status!.textContent).toMatch(/Sync brings/);
  });

  test("roster sync entry is syncing while syncRoster is in flight", async () => {
    const mount = mkMount();
    let listCallCount = 0;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => {
      listCallCount++;
      return listCallCount === 1 ? [lmsNeedsSetupSummary] : [lmsActiveSummary];
    };
    let resolveSyncRoster!: (r: SyncRosterResult) => void;
    const syncRoster: SyncRoster = () =>
      new Promise<SyncRosterResult>((resolve) => {
        resolveSyncRoster = resolve;
      });
    const activateClass: ActivateClass = async () => activateResult;
    renderClassesSurface(mount, teacher, {
      listClasses,
      syncRoster,
      activateClass,
    });
    await openLmsSetup(mount);
    submitSetupForm(mount);
    await flush();
    await flush();
    await flush();
    const status = mount.querySelector<HTMLElement>(
      "[data-testid=class-rostersync-status]",
    );
    expect(status!.textContent).toMatch(/Synchronizing roster/);
    resolveSyncRoster(defaultSyncResult);
    await flush();
  });

  test("roster sync entry transitions to ok after syncRoster resolves", async () => {
    const mount = mkMount();
    let listCallCount = 0;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => {
      listCallCount++;
      return listCallCount === 1 ? [lmsNeedsSetupSummary] : [lmsActiveSummary];
    };
    const syncRoster: SyncRoster = async () => defaultSyncResult;
    const activateClass: ActivateClass = async () => activateResult;
    renderClassesSurface(mount, teacher, {
      listClasses,
      syncRoster,
      activateClass,
    });
    await openLmsSetup(mount);
    submitSetupForm(mount);
    await flush();
    await flush();
    await flush();
    expect(
      mount
        .querySelector("[data-testid=class-rostersync]")!
        .getAttribute("data-rostersync-status"),
    ).toBe("ok");
  });

  test("sync can be triggered again after the first in-flight request completes", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [
      lmsActiveSummary,
    ];
    let syncCallCount = 0;
    let resolveFirst!: (r: SyncRosterResult) => void;
    const syncRoster: SyncRoster = () => {
      syncCallCount++;
      return new Promise<SyncRosterResult>((resolve) => {
        resolveFirst = resolve;
      });
    };
    renderClassesSurface(mount, teacher, { listClasses, syncRoster });
    await flush();
    await flush();
    mount
      .querySelector<HTMLButtonElement>(
        `[data-testid=class-card-${LMS_CLASS_ID}]`,
      )!
      .click();
    await flush();
    mount
      .querySelector<HTMLButtonElement>("[data-testid=class-rostersync-button]")!
      .click();
    await flush();
    expect(syncCallCount).toBe(1);
    // Click again while in flight: suppressed
    mount
      .querySelector<HTMLButtonElement>("[data-testid=class-rostersync-button]")!
      .click();
    await flush();
    expect(syncCallCount).toBe(1);
    // Resolve first sync
    resolveFirst(defaultSyncResult);
    await flush();
    // Button re-enabled; a second sync can now be triggered
    mount
      .querySelector<HTMLButtonElement>("[data-testid=class-rostersync-button]")!
      .click();
    await flush();
    await flush();
    expect(syncCallCount).toBe(2);
  });

  test("setup form does not re-appear after activation completes", async () => {
    const mount = mkMount();
    let listCallCount = 0;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => {
      listCallCount++;
      return listCallCount === 1 ? [lmsNeedsSetupSummary] : [lmsActiveSummary];
    };
    const syncRoster: SyncRoster = async () => defaultSyncResult;
    const activateClass: ActivateClass = async () => activateResult;
    renderClassesSurface(mount, teacher, {
      listClasses,
      syncRoster,
      activateClass,
    });
    await openLmsSetup(mount);
    submitSetupForm(mount);
    await flush();
    await flush();
    await flush();
    // Workspace is visible; setup form must not re-appear
    expect(
      mount.querySelector("[data-testid=class-workspace]"),
    ).not.toBeNull();
    expect(mount.querySelector("[data-testid=class-setup-form]")).toBeNull();
    // Roster sync panel is visible (LMS class, syncRoster available)
    expect(
      mount.querySelector("[data-testid=class-rostersync]"),
    ).not.toBeNull();
  });
});
