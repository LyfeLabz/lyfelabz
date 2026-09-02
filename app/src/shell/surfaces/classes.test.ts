/**
 * @jest-environment jsdom
 */
import { renderClassesSurface, renderRosterSyncPanel } from "./classes";
import type { RosterSyncView } from "./classes";
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
  discoverClasses?: ImportFromClassroomDeps["callables"]["discoverClasses"];
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
      discoverClasses:
        overrides.discoverClasses ??
        (async () => {
          calls.push("discoverClasses");
          return courses;
        }),
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

// Sprint 28.6H.8: the manual create form is reached via the shared
// class-management "create" intent (Settings -> Create LyfeLabz Class), not a
// landing button. This renders the Classes surface with that intent so the
// certified Manual Create form opens directly.
const openCreateForm = async (
  mount: HTMLElement,
  deps: Parameters<typeof renderClassesSurface>[2],
): Promise<void> => {
  let intent: "create" | "import" | null = "create";
  mount.textContent = "";
  renderClassesSurface(mount, teacher, {
    ...deps,
    getClassManagementIntent: () => intent,
    setClassManagementIntent: (v) => {
      intent = v;
    },
  });
  await flush();
};

describe("Create Class form input focus", () => {
  test("typing consecutive characters keeps the same input element and focus", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "AAAA", alreadyCreated: false });
    await openCreateForm(mount, { listClasses, createClass });

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
    await openCreateForm(mount, { listClasses, createClass });

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

  test("Cancel closes the create form and returns to Settings (Sprint 28.6H.8)", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "CCCC", alreadyCreated: false });
    const navSpy = jest.fn();
    await openCreateForm(mount, {
      listClasses,
      createClass,
      navigateToSurface: navSpy,
    });

    const title = mount.querySelector<HTMLInputElement>(
      "[data-testid=classes-create-title]",
    )!;
    title.value = "Draft I abandon";
    title.dispatchEvent(new Event("input", { bubbles: true }));

    mount
      .querySelector<HTMLButtonElement>("[data-testid=classes-create-cancel]")!
      .click();

    // Cancel routes the teacher back to Settings -> Class Management (the
    // decision surface); the shell then tears down the Classes surface. Classes
    // no longer hosts a landing "Create" button to fall back to.
    expect(navSpy).toHaveBeenCalledWith("settings");
  });

  test("Sprint 28.6H.8: an import intent without a wired import seam is inert (falls back to the operational landing)", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "EEEE", alreadyCreated: false });
    // Import intent but NO importFromClassroom seam: the focused import task is
    // not activated (import requires the certified seam); the surface shows the
    // operational zero-class landing (Settings guidance), never a broken task.
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      getClassManagementIntent: (): "import" => "import",
      setClassManagementIntent: () => {},
    });
    await flush();
    expect(
      mount.querySelector("[data-testid=classes-import-open]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=surface-headline]")?.textContent,
    ).toBe("Classes");
    expect(mount.querySelector("[data-testid=classes-empty]")).not.toBeNull();
  });

  test("Sprint 28.6H.8: the operational Classes landing hosts no class-administration controls", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "FFFF", alreadyCreated: false });
    renderClassesSurface(mount, teacher, { listClasses, createClass });
    await flush();

    // Class administration (Import / Create) lives in Settings, not here.
    expect(
      mount.querySelector("[data-testid=classes-import-open]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=classes-create-open]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=integrations-import-googleClassroom]"),
    ).toBeNull();
  });

  test("Sprint 28.6H.8: a wired import seam + intent auto-launches the focused import task into course discovery (no manual Import button)", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "GGGG", alreadyCreated: false });
    const importDeps = makeImportDeps();
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      importFromClassroom: importDeps.deps,
      getClassManagementIntent: (): "import" => "import",
      setClassManagementIntent: () => {},
    });
    await flush();
    await flush();
    await flush();

    // No standalone "Import Class" button (Part D3 - no second Import click);
    // the connected teacher's flow auto-started straight into course discovery.
    expect(
      mount.querySelector("[data-testid=classes-import-open]"),
    ).toBeNull();
    expect(importDeps.calls).toContain("discoverClasses");
    expect(
      mount.querySelector("[data-testid=classes-import-panel]"),
    ).not.toBeNull();
    // The task heading is Google Classroom import, not the generic "Classes".
    expect(
      mount.querySelector("[data-testid=surface-headline]")?.textContent,
    ).toBe("Import from Google Classroom");
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
      getClassManagementIntent: (): "import" => "import",
      setClassManagementIntent: () => {},
    });
    await flush();
    // Sprint 28.6H.8: the import task auto-starts (no manual Import click).
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
      getClassManagementIntent: (): "import" => "import",
      setClassManagementIntent: () => {},
    });
    await flush();
    // Sprint 28.6H.8: the import task auto-starts (no manual Import click).
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
    // Sprint 28.6H.3 (Task A2/C3): with classes present, the everyday Classes
    // landing has no "+ Add class" control - class management moved to Settings.
    // The import workflow is reached via the shared class-management intent the
    // Settings Import control sets. Drive that one-shot intent so the certified
    // import entry point opens on this populated list (the SAME workflow).
    let intent: "create" | "import" | null = "import";
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      importFromClassroom: importDeps.deps,
      getClassManagementIntent: () => intent,
      setClassManagementIntent: (next) => {
        intent = next;
      },
    });
    await flush();
    // Sprint 28.6H.8: the import task auto-starts (no manual Import click).
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
      getClassManagementIntent: (): "import" => "import",
      setClassManagementIntent: () => {},
    });
    await flush();
    // Sprint 28.6H.8: the import task auto-starts (no manual Import click).
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
    // Sprint 28.6H.9 (Correction 3): the numbered four-step import process list
    // is removed from the focused import task; no stepper renders in any state,
    // including this linking error.
    expect(
      mount.querySelector("[data-testid=classes-import-stages]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=classes-import-stage-linking]"),
    ).toBeNull();
  });

  test("Sprint 28.6H.9 (Correction 3/4): a recoverable import error shows no stepper and a Try again / Close hierarchy", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "AAAA", alreadyCreated: false });
    // Fail at the discovering stage (a non-linking, recoverable stage) so the
    // error state renders BOTH Try again and Close - the cancellation-style
    // recovery state the hierarchy correction targets.
    const importDeps = makeImportDeps({
      discoverClasses: async () => {
        throw new Error("boom");
      },
    });
    renderClassesSurface(mount, teacher, {
      listClasses,
      createClass,
      importFromClassroom: importDeps.deps,
      getClassManagementIntent: (): "import" => "import",
      setClassManagementIntent: () => {},
    });
    await flush();
    await flush();
    await flush();
    await flush();

    const err = mount.querySelector<HTMLElement>(
      "[data-testid=classes-import-error]",
    );
    expect(err).not.toBeNull();

    // Correction 3: no numbered process stepper in any state.
    expect(
      mount.querySelector("[data-testid=classes-import-stages]"),
    ).toBeNull();

    // Correction 4: Try again is the primary recovery action; Close is the
    // neutral secondary. The hierarchy is carried by dedicated classes (the
    // primary-green retry vs the outlined secondary cancel), and Try again
    // precedes Close in DOM order.
    const retry = mount.querySelector<HTMLButtonElement>(
      "[data-testid=classes-import-retry]",
    );
    const close = mount.querySelector<HTMLButtonElement>(
      "[data-testid=classes-import-cancel]",
    );
    expect(retry).not.toBeNull();
    expect(close).not.toBeNull();
    expect(retry!.textContent).toBe("Try again");
    expect(close!.textContent).toBe("Close");
    expect(retry!.classList.contains("shell-classes-import-retry")).toBe(true);
    expect(close!.classList.contains("shell-classes-import-cancel")).toBe(true);
    // Try again comes before Close in document order (primary first).
    expect(
      retry!.compareDocumentPosition(close!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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
    await openCreateForm(mount, { listClasses, createClass });

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

    // Sprint 28.6H (Finding 2): the class-card status badge is removed. The
    // needsSetup state is carried by the "Finish setting up..." affordance and
    // the "Finish setup" CTA above, so no status pill is rendered on the card.
    expect(
      mount.querySelector("[data-testid=class-status-needs-setup-class]"),
    ).toBeNull();

    // No join code, grade, or block is rendered for a needsSetup card.
    expect(
      mount.querySelector("[data-testid=class-joincode-needs-setup-class]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=class-grade-needs-setup-class]"),
    ).toBeNull();
  });
});

// Sprint 28.6F - grade/block belong to the class, not the teacher. The
// global `defaultGrade` preference (and its Manual Create prefill / best-
// effort write) were removed (Blueprint §14). Manual Create derives grade
// and block only from this class's own form; nothing is inherited.
describe("Manual Create grade/block (per-class, Sprint 28.6F)", () => {
  test("the grade and block selects begin unselected (no inherited default)", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "AAAA", alreadyCreated: false });
    await openCreateForm(mount, {
      listClasses,
      createClass,
    });

    const grade = mount.querySelector<HTMLSelectElement>(
      "[data-testid=classes-create-grade]",
    )!;
    expect(grade.value).toBe("");
    const block = mount.querySelector<HTMLSelectElement>(
      "[data-testid=classes-create-block]",
    )!;
    expect(block.value).toBe("");
  });

  test("Manual Create submit is rejected when grade is not chosen", async () => {
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
    await openCreateForm(mount, {
      listClasses,
      createClass,
    });
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

  test("Manual Create form renders with empty grade/block and is usable", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "AAAA", alreadyCreated: false });
    await openCreateForm(mount, { listClasses, createClass });
    expect(
      mount.querySelector("[data-testid=classes-create-form]"),
    ).not.toBeNull();
  });

  test("the grade and block the teacher chooses for this class are submitted", async () => {
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
    await openCreateForm(mount, {
      listClasses,
      createClass,
    });

    const title = mount.querySelector<HTMLInputElement>(
      "[data-testid=classes-create-title]",
    )!;
    title.value = "Chosen";
    title.dispatchEvent(new Event("input", { bubbles: true }));

    const grade = mount.querySelector<HTMLSelectElement>(
      "[data-testid=classes-create-grade]",
    )!;
    // Nothing is preselected; the teacher picks the grade for this class.
    expect(grade.value).toBe("");
    grade.value = "8";
    grade.dispatchEvent(new Event("change", { bubbles: true }));
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

  test("successful class creation reveals the join-code panel", async () => {
    const mount = mkMount();
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => [];
    const createClass: CreateClass = async () =>
      Object.freeze({ classId: "c", joinCode: "CODE", alreadyCreated: false });
    await openCreateForm(mount, {
      listClasses,
      createClass,
    });
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
    // The join-code panel signals a successful create.
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
    });
    await openSetup(mount);
    // Choose a grade for this class so validation reaches the block check.
    const grade = mount.querySelector<HTMLSelectElement>(
      "[data-testid=class-setup-grade]",
    )!;
    grade.value = "7";
    grade.dispatchEvent(new Event("change", { bubbles: true }));
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

  test("successful activation navigates to Assignments on the now-active class", async () => {
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
    expect(workspace!.getAttribute("data-class-tab")).toBe("assignments");
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

  test("Task B3/C4: the automatic post-activation sync still fires, but the class workspace renders NO roster-sync UI (it moved to Settings)", async () => {
    const mount = mkMount();
    let listCallCount = 0;
    const listClasses = async (): Promise<ReadonlyArray<ClassSummary>> => {
      listCallCount++;
      return listCallCount === 1 ? [lmsNeedsSetupSummary] : [lmsActiveSummary];
    };
    let syncCalls = 0;
    let resolveSyncRoster!: (r: SyncRosterResult) => void;
    const syncRoster: SyncRoster = () => {
      syncCalls += 1;
      return new Promise<SyncRosterResult>((resolve) => {
        resolveSyncRoster = resolve;
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
    // The automatic post-activation roster sync (backend behavior) still fires.
    expect(syncCalls).toBe(1);
    // But the everyday class workspace no longer hosts any roster-sync UI or a
    // "Manage class" disclosure - roster administration lives in Settings.
    expect(mount.querySelector("[data-testid=class-rostersync]")).toBeNull();
    expect(
      mount.querySelector("[data-testid=class-rostersync-button]"),
    ).toBeNull();
    expect(mount.querySelector("[data-testid=class-manage-toggle]")).toBeNull();
    expect(mount.querySelector("[data-testid=class-manage-panel]")).toBeNull();
    // The activated class lands on Assignments (Overview removed).
    const workspace = mount.querySelector<HTMLElement>(
      "[data-testid=class-workspace]",
    )!;
    expect(workspace.getAttribute("data-class-tab")).toBe("assignments");
    resolveSyncRoster(defaultSyncResult);
    await flush();
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

// Sprint 28.6H.3 (Task B3/C4): the former "roster sync panel and manual sync
// button" and "sync state persistence across rerenders" describes exercised the
// roster-sync UI that lived in the class workspace ("Manage class" disclosure).
// That administration moved to Settings -> Class Management (one implementation,
// reusing the certified `lmsClassesSyncRoster` callable and the shared status
// panel). Its behavior - roster sync offered only for Google Classroom-linked
// classes, invoked exactly once per click, aggregate-only status, and no
// automatic sync on render - is now covered by settings.test.ts. The automatic
// post-activation sync (backend behavior, unchanged) and the absence of any
// roster-sync UI in the class workspace are covered above in the
// "LMS activation auto-sync" describe.

describe("29F - roster sync unresolved teacher guidance", () => {
  const okView = (unresolved: number): RosterSyncView =>
    Object.freeze({
      available: true,
      onSyncClick: () => {},
      entry: {
        status: "ok" as const,
        at: 0,
        counters: {
          added: 2,
          reactivated: 0,
          unchanged: 3,
          withdrawn: 1,
          unresolved,
          skipped: 0,
          upstreamRosterEmpty: false,
        },
      },
    });

  const statusText = (unresolved: number): string => {
    const panel = renderRosterSyncPanel(document, okView(unresolved));
    return (
      panel.querySelector("[data-testid=class-rostersync-status]")
        ?.textContent ?? ""
    );
  };

  test("unresolved = 0 shows the plain success summary and no guidance", () => {
    const text = statusText(0);
    expect(text).toContain("Added: 2");
    expect(text).toContain("Unchanged: 3");
    expect(text).toContain("Withdrawn: 1");
    expect(text).not.toMatch(/sign(ing)? in/i);
    // The bare "Unresolved:" label is gone.
    expect(text).not.toContain("Unresolved:");
  });

  test("unresolved = 1 uses singular guidance and keeps the counts", () => {
    const text = statusText(1);
    expect(text).toContain("Added: 2");
    expect(text).toContain("Unchanged: 3");
    expect(text).toContain("Withdrawn: 1");
    expect(text).toContain(
      "1 student hasn't finished signing in to LyfeLabz with their school Google account yet.",
    );
    expect(text).toContain("sync the roster again");
    expect(text).not.toContain("Unresolved:");
  });

  test("unresolved > 1 uses plural guidance and keeps the counts", () => {
    const text = statusText(3);
    expect(text).toContain("Added: 2");
    expect(text).toContain("Unchanged: 3");
    expect(text).toContain("Withdrawn: 1");
    expect(text).toContain(
      "3 students haven't finished signing in to LyfeLabz with their school Google accounts yet.",
    );
    expect(text).not.toContain("Unresolved:");
  });
});
