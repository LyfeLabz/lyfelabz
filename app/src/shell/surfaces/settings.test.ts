/**
 * @jest-environment jsdom
 */
import { renderSettingsSurface, type SettingsDeps } from "./settings";
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ClassManagementIntent } from "./classes";
import type {
  IntegrationsCallables,
  IntegrationsConnection,
  IntegrationsDeps,
} from "../../settings/integrations/types";

// Sprint 28.6H.3 (Part C) - Settings becomes the administrative home.
//   - "Google Classroom" section: read-only connection state + Manage control.
//   - "Class Management" section: Import (primary) + Create (secondary), which
//     invoke the SHARED class-management workflow (one implementation, two entry
//     points), plus roster sync for Google Classroom-linked classes only.
//   - No Default Grade, no future-facing previews, no Session identity leak, no
//     automatic roster mutation on render.

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

const teacher: ActiveTeacher = Object.freeze({
  kind: "activeTeacher",
  uid: "u1",
  schoolId: "school-abc",
  displayName: "Ada Lovelace",
});

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const activeConnection: IntegrationsConnection = Object.freeze({
  connectionId: "conn-1",
  providerId: "googleClassroom",
  status: "active",
  scopes: Object.freeze([]),
});

function makeIntegrations(
  connections: readonly IntegrationsConnection[],
): IntegrationsDeps {
  const base = {
    listProviders: async () => Object.freeze([]),
    describeConnections: async () => Object.freeze(connections),
    beginConnection: async () => ({ authorizationUrl: "", state: "" }),
    completeConnection: async () => ({
      connectionId: "",
      alreadyConnected: false,
    }),
    disconnect: async () => ({ alreadyRevoked: false }),
    discoverClasses: async () => Object.freeze([]),
    importClass: async () => ({
      linkId: "",
      classId: "",
      lmsClassId: "",
      alreadyLinked: false,
    }),
    listClassTopics: async () => Object.freeze([]),
    refreshClass: async () =>
      Object.freeze({
        linkId: "",
        classId: "",
        lmsClassId: "",
        providerId: "googleClassroom",
        status: "healthy" as const,
        changed: false,
      }),
    publishAssignment: async () =>
      Object.freeze({ publicationId: "", status: "succeeded" as const }),
  } as unknown as IntegrationsCallables;
  return {
    callables: base,
    openOAuth: async () => ({ code: "", state: "" }),
    listTeacherClasses: async () => Object.freeze([]),
    redirectUri: "https://example.test/app/lms-callback.html",
  };
}

const lmsClass: ClassSummary = Object.freeze({
  id: "c-lms",
  title: "Period 1 Science",
  status: "active",
  grade: "6",
  block: "A",
  joinCode: "JOIN1",
  isLmsLinked: true,
});
const manualClass: ClassSummary = Object.freeze({
  id: "c-manual",
  title: "Manual Homeroom",
  status: "active",
  grade: "7",
  block: "B",
  joinCode: "JOIN2",
  isLmsLinked: false,
});

const wiredDeps = (
  connections: readonly IntegrationsConnection[] = [activeConnection],
  overrides: Partial<SettingsDeps> = {},
): SettingsDeps => ({
  integrations: makeIntegrations(connections),
  openClassManagement: () => {
    /* replaced per test */
  },
  canImportClasses: true,
  canCreateClasses: true,
  listClasses: async () => Object.freeze([lmsClass, manualClass]),
  ...overrides,
});

describe("Settings tabbed administrative surface (Sprint 28.6H.4, Part E)", () => {
  test("renders exactly two tabs - Class Management (default) and Student Services (Sprint 28.6H.5 Part E)", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps());
    const tablist = mount.querySelector("[data-testid=settings-tabs]")!;
    expect(tablist.getAttribute("role")).toBe("tablist");
    const tabs = mount.querySelectorAll("[role=tab]");
    expect(tabs).toHaveLength(2);
    const cm = mount.querySelector("[data-testid=settings-tab-class-management]")!;
    const ss = mount.querySelector("[data-testid=settings-tab-student-services]")!;
    expect(cm.textContent).toBe("Class Management");
    expect(ss.textContent).toBe("Student Services");
    // Class Management is the default (selected); Student Services is not.
    expect(cm.getAttribute("aria-selected")).toBe("true");
    expect(ss.getAttribute("aria-selected")).toBe("false");
    // The default panel is Class Management (Student Services panel not rendered).
    const panel = mount.querySelector(
      "[data-testid=settings-panel-class-management]",
    )!;
    expect(panel.getAttribute("role")).toBe("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(cm.id);
    // aria-controls references the rendered panel (single-panel tab swap).
    expect(cm.getAttribute("aria-controls")).toBe(panel.id);
    expect(
      mount.querySelector("[data-testid=settings-panel-student-services]"),
    ).toBeNull();
  });

  // ── Slice 7: Student Services functional UI ──────────────────────────────

  // Student list now returns identity only (studentId + studentDisplayName).
  // Accommodation state for a selected student is loaded via getAccommodation.
  const makeListStudents = (
    students: Array<{ studentId: string; studentDisplayName: string }> = [],
  ) => jest.fn().mockResolvedValue({ classId: "cls-1", students });

  const makeGetAccommodation = (rev = 0, status: "active" | "inactive" = "inactive") =>
    jest.fn().mockResolvedValue(
      rev === 0
        ? { configRevision: 0 }
        : {
            configRevision: rev,
            readingAccessibility:
              status === "active"
                ? { status: "active", level: "adapted" }
                : { status: "inactive" },
            updatedBy: "teacher-uid",
          },
    );

  const makeSetAccommodation = (
    newRev: number,
    newStatus: "active" | "inactive" = "active",
    shouldReject = false,
  ) => {
    const mock = jest.fn();
    if (shouldReject) {
      mock.mockRejectedValue({ code: "accommodations.conflict" });
    } else {
      mock.mockResolvedValue({
        studentId: "stu-1",
        configRevision: newRev,
        readingAccessibility:
          newStatus === "active"
            ? { status: "active", level: "adapted" }
            : { status: "inactive" },
        noop: false,
      });
    }
    return mock;
  };

  // Base deps with all three seams wired. `students` is identity-only.
  const wiredSSDeps = (
    students: Array<{ studentId: string; studentDisplayName: string }> = [],
    getRevision = 2,
    getStatus: "active" | "inactive" = "inactive",
  ): SettingsDeps => ({
    ...wiredDeps(),
    listStudents: makeListStudents(students),
    getAccommodation: makeGetAccommodation(getRevision, getStatus),
    setAccommodation: makeSetAccommodation(getRevision + 1),
  });

  const switchToSS = (mount: HTMLElement) =>
    mount
      .querySelector<HTMLButtonElement>("[data-testid=settings-tab-student-services]")!
      .click();

  // Shared setup: load class list, select a class, await student load.
  const selectClass = async (mount: HTMLElement, classId: string) => {
    await Promise.resolve();
    await Promise.resolve();
    const select = mount.querySelector<HTMLSelectElement>("[data-testid=ss-class-select]")!;
    select.value = classId;
    select.dispatchEvent(new Event("change"));
    await Promise.resolve();
    await Promise.resolve();
  };

  const openStudentDetail = async (mount: HTMLElement, studentId: string, classId: string) => {
    await selectClass(mount, classId);
    mount.querySelector<HTMLButtonElement>(`[data-testid=ss-student-btn-${studentId}]`)!.click();
    await Promise.resolve();
    await Promise.resolve();
  };

  test("Student Services with no accommodation seams shows placeholder (Slice 7 graceful degradation)", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps());
    switchToSS(mount);
    const panel = mount.querySelector("[data-testid=settings-panel-student-services]")!;
    expect(panel.getAttribute("role")).toBe("tabpanel");
    const note = mount.querySelector("[data-testid=settings-student-services-note]")!;
    expect(note.textContent).toBe("Student accommodations and supports will be managed here.");
    expect(panel.querySelectorAll("input, select, textarea")).toHaveLength(0);
    expect(mount.querySelector("[data-testid=settings-panel-class-management]")).toBeNull();
  });

  test("Student Services with seams wired shows a class picker and no placeholder (Slice 7)", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps(undefined, {
      listStudents: makeListStudents(),
      getAccommodation: makeGetAccommodation(),
      setAccommodation: makeSetAccommodation(1),
    }));
    switchToSS(mount);
    expect(mount.querySelector("[data-testid=settings-student-services-note]")).toBeNull();
    expect(mount.querySelector("[data-testid=ss-class-picker]")).not.toBeNull();
    expect(mount.querySelector<HTMLSelectElement>("[data-testid=ss-class-select]")).not.toBeNull();
  });

  test("Student Services shows no redundant instruction when no class is selected", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredSSDeps());
    switchToSS(mount);
    // The class label and picker convey the interaction; no redundant prose.
    expect(mount.querySelector("[data-testid=ss-no-class-hint]")).toBeNull();
    expect(mount.querySelector("[data-testid=ss-class-picker]")).not.toBeNull();
  });

  test("Student Services class picker lists active classes", async () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredSSDeps());
    switchToSS(mount);
    await Promise.resolve();
    await Promise.resolve();
    const options = Array.from(
      mount.querySelector<HTMLSelectElement>("[data-testid=ss-class-select]")!.options,
    ).map((o) => o.value).filter(Boolean);
    expect(options.length).toBeGreaterThan(0);
  });

  test("Student Services shows loading state while fetching students", async () => {
    const mount = mkMount();
    let resolveList!: (v: { classId: string; students: [] }) => void;
    const pendingList = jest.fn().mockReturnValue(
      new Promise<{ classId: string; students: [] }>((r) => { resolveList = r; }),
    );
    renderSettingsSurface(mount, teacher, {
      ...wiredSSDeps(),
      listStudents: pendingList,
      listClasses: async () => Object.freeze([lmsClass]),
    });
    switchToSS(mount);
    await selectClass(mount, lmsClass.id);
    expect(mount.querySelector("[data-testid=ss-students-loading]")).not.toBeNull();
    resolveList({ classId: lmsClass.id, students: [] });
  });

  test("Student Services shows student list (name buttons, no accommodation badges)", async () => {
    const mount = mkMount();
    const students = [
      { studentId: "stu-1", studentDisplayName: "Alice" },
      { studentId: "stu-2", studentDisplayName: "Bob" },
    ];
    renderSettingsSurface(mount, teacher, {
      ...wiredSSDeps(students),
      listClasses: async () => Object.freeze([lmsClass]),
    });
    switchToSS(mount);
    await selectClass(mount, lmsClass.id);
    const list = mount.querySelector("[data-testid=ss-student-list]");
    expect(list).not.toBeNull();
    // shell-ss-student-list carries list-style: none; confirming no bullet marker.
    expect(list?.className).toContain("shell-ss-student-list");
    expect(mount.querySelector("[data-testid=ss-student-btn-stu-1]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=ss-student-btn-stu-2]")).not.toBeNull();
    // No accommodation-status badges on the list.
    expect(mount.querySelector("[data-testid=ss-student-ra-badge-stu-1]")).toBeNull();
    expect(mount.querySelector("[data-testid=ss-student-ra-badge-stu-2]")).toBeNull();
    // No "Reading support" or On/Off terminology in the list view.
    const listText = (mount.querySelector("[data-testid=ss-student-list]")?.textContent ?? "").toLowerCase();
    expect(listText).not.toContain("reading support");
    expect(listText).not.toContain("on");
    expect(listText).not.toContain("off");
  });

  test("Student Services shows Reading Accessibility card heading (not 'adapted') for a selected student", async () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, {
      ...wiredSSDeps([{ studentId: "stu-1", studentDisplayName: "Alice" }], 2, "inactive"),
      listClasses: async () => Object.freeze([lmsClass]),
    });
    switchToSS(mount);
    await openStudentDetail(mount, "stu-1", lmsClass.id);
    expect(mount.querySelector("[data-testid=ss-ra-card-heading]")?.textContent).toBe("Reading Accessibility");
    const panel = mount.querySelector("[data-testid=settings-panel-student-services]")!;
    expect((panel.textContent ?? "").toLowerCase()).not.toContain("adapted");
  });

  test("Student Services status line shows 'Inactive' without repeating the service name", async () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, {
      ...wiredSSDeps([{ studentId: "stu-1", studentDisplayName: "Alice" }], 2, "inactive"),
      listClasses: async () => Object.freeze([lmsClass]),
    });
    switchToSS(mount);
    await openStudentDetail(mount, "stu-1", lmsClass.id);
    const status = mount.querySelector("[data-testid=ss-ra-status]");
    // Status shows only the state word; service heading provides context.
    expect(status?.textContent).toBe("Inactive");
    // Redundant prefix must not appear.
    expect((status?.textContent ?? "")).not.toContain("Reading Accessibility: Inactive");
    expect((status?.textContent ?? "")).not.toContain("Reading Accessibility:");
    expect((status?.textContent ?? "")).not.toContain("On");
    expect((status?.textContent ?? "")).not.toContain("Off");
  });

  test("Student Services status line shows 'Active' without repeating the service name", async () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, {
      ...wiredSSDeps([{ studentId: "stu-1", studentDisplayName: "Alice" }], 3, "active"),
      listClasses: async () => Object.freeze([lmsClass]),
    });
    switchToSS(mount);
    await openStudentDetail(mount, "stu-1", lmsClass.id);
    // Status shows only the state word; service heading provides context.
    expect(mount.querySelector("[data-testid=ss-ra-status]")?.textContent).toBe("Active");
    // Redundant prefix must not appear.
    expect((mount.querySelector("[data-testid=ss-ra-status]")?.textContent ?? "")).not.toContain("Reading Accessibility:");
    expect((mount.querySelector("[data-testid=settings-panel-student-services]")?.textContent ?? "")).not.toContain("Reading Accessibility: Active");
    expect((mount.querySelector("[data-testid=settings-panel-student-services]")?.textContent ?? "")).not.toContain("Reading Accessibility: Inactive");
    // Active description shown.
    expect(mount.querySelector("[data-testid=ss-ra-active-desc]")).not.toBeNull();
  });

  test("Student Services shows canonical scope note (applies to the student, not an assignment)", async () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, {
      ...wiredSSDeps([{ studentId: "stu-1", studentDisplayName: "Alice" }], 2, "inactive"),
      listClasses: async () => Object.freeze([lmsClass]),
    });
    switchToSS(mount);
    await openStudentDetail(mount, "stu-1", lmsClass.id);
    const scope = mount.querySelector("[data-testid=ss-ra-scope]");
    expect(scope?.textContent).toBe("Student services apply to the student, not an individual assignment.");
  });

  test("Student Services action button reads 'Activate' for inactive service", async () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, {
      ...wiredSSDeps([{ studentId: "stu-1", studentDisplayName: "Alice" }], 2, "inactive"),
      listClasses: async () => Object.freeze([lmsClass]),
    });
    switchToSS(mount);
    await openStudentDetail(mount, "stu-1", lmsClass.id);
    expect(mount.querySelector("[data-testid=ss-ra-action]")?.textContent).toBe("Activate");
  });

  test("Student Services action button reads 'Deactivate' for active service", async () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, {
      ...wiredSSDeps([{ studentId: "stu-1", studentDisplayName: "Alice" }], 3, "active"),
      listClasses: async () => Object.freeze([lmsClass]),
    });
    switchToSS(mount);
    await openStudentDetail(mount, "stu-1", lmsClass.id);
    expect(mount.querySelector("[data-testid=ss-ra-action]")?.textContent).toBe("Deactivate");
  });

  test("browsing Student Services (class, student list, student detail) is read-only: no accommodation is written", async () => {
    const mount = mkMount();
    const listMock = makeListStudents([{ studentId: "stu-1", studentDisplayName: "Alice" }]);
    const getMock = makeGetAccommodation(0, "inactive");
    const setMock = makeSetAccommodation(1);
    renderSettingsSurface(mount, teacher, {
      ...wiredDeps(),
      listStudents: listMock,
      getAccommodation: getMock,
      setAccommodation: setMock,
      listClasses: async () => Object.freeze([lmsClass]),
    });
    switchToSS(mount);
    await openStudentDetail(mount, "stu-1", lmsClass.id);
    expect(mount.querySelector("[data-testid=ss-ra-action]")?.textContent).toBe("Activate");
    expect(listMock).toHaveBeenCalled();
    expect(getMock).toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });

  test("Student Services deactivation requires a confirmation step before writing", async () => {
    const mount = mkMount();
    const setMock = makeSetAccommodation(4);
    renderSettingsSurface(mount, teacher, {
      ...wiredSSDeps([{ studentId: "stu-1", studentDisplayName: "Alice" }], 3, "active"),
      listClasses: async () => Object.freeze([lmsClass]),
      setAccommodation: setMock,
    });
    switchToSS(mount);
    await openStudentDetail(mount, "stu-1", lmsClass.id);
    // Click Deactivate - must NOT write immediately.
    mount.querySelector<HTMLButtonElement>("[data-testid=ss-ra-action]")!.click();
    expect(setMock).not.toHaveBeenCalled();
    // Confirmation dialog must appear.
    expect(mount.querySelector("[data-testid=ss-deactivate-confirm]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=ss-deactivate-confirm-btn]")?.textContent).toBe("Yes, deactivate");
    expect(mount.querySelector("[data-testid=ss-deactivate-cancel-btn]")?.textContent).toBe("Cancel");
  });

  test("Student Services deactivation confirmation - Cancel restores the card without writing", async () => {
    const mount = mkMount();
    const setMock = makeSetAccommodation(4);
    renderSettingsSurface(mount, teacher, {
      ...wiredSSDeps([{ studentId: "stu-1", studentDisplayName: "Alice" }], 3, "active"),
      listClasses: async () => Object.freeze([lmsClass]),
      setAccommodation: setMock,
    });
    switchToSS(mount);
    await openStudentDetail(mount, "stu-1", lmsClass.id);
    mount.querySelector<HTMLButtonElement>("[data-testid=ss-ra-action]")!.click();
    mount.querySelector<HTMLButtonElement>("[data-testid=ss-deactivate-cancel-btn]")!.click();
    expect(setMock).not.toHaveBeenCalled();
    expect(mount.querySelector("[data-testid=ss-deactivate-confirm]")).toBeNull();
    expect(mount.querySelector("[data-testid=ss-ra-action]")?.textContent).toBe("Deactivate");
  });

  test("Student Services Back button returns to student list", async () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, {
      ...wiredSSDeps([{ studentId: "stu-1", studentDisplayName: "Alice" }]),
      listClasses: async () => Object.freeze([lmsClass]),
    });
    switchToSS(mount);
    await openStudentDetail(mount, "stu-1", lmsClass.id);
    const ssBack = mount.querySelector<HTMLButtonElement>("[data-testid=ss-back-btn]")!;
    // Control hierarchy Op 1: shared Back control; the arrow is CSS
    // presentation, not part of the accessible label text.
    expect(ssBack.classList.contains("shell-back")).toBe(true);
    expect(ssBack.textContent).toBe("Back to student list");
    ssBack.click();
    expect(mount.querySelector("[data-testid=ss-student-list]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=ss-student-detail]")).toBeNull();
  });

  test("Student Services does not expose configRevision or internal fields to the UI", async () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, {
      ...wiredSSDeps([{ studentId: "stu-1", studentDisplayName: "Alice" }], 7, "inactive"),
      listClasses: async () => Object.freeze([lmsClass]),
    });
    switchToSS(mount);
    await openStudentDetail(mount, "stu-1", lmsClass.id);
    const text = (mount.querySelector("[data-testid=settings-panel-student-services]")?.textContent ?? "").toLowerCase();
    expect(text).not.toContain("configrevision");
    expect(text).not.toContain("variantkey");
    expect(text).not.toContain("presentationrevision");
    expect(text).not.toContain("launchref");
    expect(text).not.toContain("deliveryoutcome");
    expect(text).not.toContain("adapted");
    expect(text).not.toContain("reading support");
    expect(text).not.toContain("turn on");
    expect(text).not.toContain("turn off");
  });

  test("selecting Student Services then back to Class Management restores the panel", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps());
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=settings-tab-student-services]",
      )!
      .click();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=settings-tab-class-management]",
      )!
      .click();
    expect(
      mount.querySelector("[data-testid=settings-panel-class-management]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=settings-panel-student-services]"),
    ).toBeNull();
    expect(
      mount
        .querySelector("[data-testid=settings-tab-class-management]")!
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  test("does NOT render an Accommodations tab, and Student Services has no fake toggles (Part G / Task E2)", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps());
    // The second tab is "Student Services", never "Accommodations".
    expect(mount.querySelectorAll("[role=tab]")).toHaveLength(2);
    const labels = Array.from(mount.querySelectorAll("[role=tab]")).map(
      (t) => t.textContent,
    );
    expect(labels).toEqual(["Class Management", "Student Services"]);
    // Default (Class Management) render exposes no accommodation controls.
    expect(mount.querySelectorAll("input")).toHaveLength(0);
  });

  test("does NOT expose any Archive control (Part F)", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps());
    const text = (mount.textContent ?? "").toLowerCase();
    expect(text).not.toContain("archive");
  });

  test("renders the Google Classroom section heading inside the panel", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps());
    const heading = mount.querySelector(
      "[data-testid=settings-classroom-heading]",
    );
    expect(heading?.textContent).toBe("Google Classroom");
    expect(heading?.tagName.toLowerCase()).toBe("h3");
    const panel = mount.querySelector(
      "[data-testid=settings-panel-class-management]",
    )!;
    expect(panel.contains(heading)).toBe(true);
  });

  test("Class Management is only the TAB label, not repeated as a section heading", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps());
    // The only element carrying "Class Management" is the tab. The classes list
    // heading reads "Classes" (Task E5/E7), not "Class Management".
    const classesHeading = mount.querySelector(
      "[data-testid=settings-classes-heading]",
    );
    expect(classesHeading?.textContent).toBe("Classes");
  });

  test("does not render a generic introductory sentence (Finding 11)", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps());
    expect(mount.querySelector("[data-testid=settings-intro]")).toBeNull();
    expect(
      mount.querySelector("[data-testid=surface-headline]")!.textContent,
    ).toBe("Settings");
  });

  test("Import Class lives in the Google Classroom section; Create LyfeLabz Class in a separate LyfeLabz Classes section (Sprint 28.6H.6 Part D/E)", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps());
    const importBtn = mount.querySelector(
      "[data-testid=settings-import-class]",
    )!;
    const createBtn = mount.querySelector(
      "[data-testid=settings-create-class]",
    )!;
    expect(importBtn.textContent).toBe("Import Class");
    // Task E2: the Settings action names the source explicitly.
    expect(createBtn.textContent).toBe("Create LyfeLabz Class");
    // Task E3: Import primary (filled), Create secondary (outlined).
    expect(importBtn.className).toContain("shell-settings-class-action--primary");
    expect(createBtn.className).toContain(
      "shell-settings-class-action--secondary",
    );
    // Part E1: Import belongs to the Google Classroom section.
    const gcSection = mount.querySelector(
      "[data-testid=settings-classroom-section]",
    )!;
    expect(gcSection.contains(importBtn)).toBe(true);
    expect(gcSection.contains(createBtn)).toBe(false);
    // Part E2: Create belongs to the separate LyfeLabz Classes section.
    const llSection = mount.querySelector(
      "[data-testid=settings-lyfelabz-section]",
    )!;
    expect(
      mount.querySelector("[data-testid=settings-lyfelabz-heading]")!.textContent,
    ).toBe("LyfeLabz Classes");
    expect(llSection.contains(createBtn)).toBe(true);
    expect(llSection.contains(importBtn)).toBe(false);
    // Import (Google Classroom) precedes Create (LyfeLabz) in the DOM.
    expect(
      importBtn.compareDocumentPosition(createBtn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("Import / Create invoke the SHARED class-management opener with the right intent", () => {
    const intents: (ClassManagementIntent | null)[] = [];
    const mount = mkMount();
    renderSettingsSurface(
      mount,
      teacher,
      wiredDeps([activeConnection], {
        openClassManagement: (intent) => intents.push(intent),
      }),
    );
    mount
      .querySelector<HTMLButtonElement>("[data-testid=settings-import-class]")!
      .click();
    mount
      .querySelector<HTMLButtonElement>("[data-testid=settings-create-class]")!
      .click();
    expect(intents).toEqual(["import", "create"]);
  });

  test("the primary Class Management surface exposes NO proactive connection status but shows Manage connection when integrations are wired (Phase 8F.1)", async () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps([activeConnection]));
    await flush();
    // No proactive connection-status line (Connected / Not connected pills).
    expect(
      mount.querySelector("[data-testid=settings-classroom-connection]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=settings-open-integrations]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=settings-connection-row]"),
    ).toBeNull();
    const text = mount.textContent ?? "";
    expect(text).not.toContain("Connected");
    expect(text).not.toContain("Not connected");
    // Manage connection IS now present (Phase 8F.1 restore).
    expect(
      mount.querySelector("[data-testid=settings-manage-connection]"),
    ).not.toBeNull();
    expect(text).toContain("Manage connection");
    // The Google Classroom section still exists and Import Class is present.
    expect(
      mount.querySelector("[data-testid=settings-classroom-heading]")!.textContent,
    ).toBe("Google Classroom");
    expect(
      mount.querySelector("[data-testid=settings-import-class]"),
    ).not.toBeNull();
  });

  test("Phase 8F.1: Manage connection not shown when integrations are unwired (null)", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, { integrations: null });
    expect(
      mount.querySelector("[data-testid=settings-manage-connection]"),
    ).toBeNull();
    // Google Classroom section still present.
    expect(
      mount.querySelector("[data-testid=settings-classroom-heading]"),
    ).not.toBeNull();
  });

  test("Phase 8F.1: clicking Manage connection opens the existing integrations surface", async () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps([activeConnection]));
    await flush();
    const manageBtn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=settings-manage-connection]",
    )!;
    expect(manageBtn).not.toBeNull();
    manageBtn.click();
    await flush();
    await flush();
    // The integrations surface is now mounted (has its own testid).
    expect(
      mount.querySelector("[data-testid=integrations-surface]"),
    ).not.toBeNull();
    // The Settings root tabs are no longer visible.
    expect(
      mount.querySelector("[data-testid=settings-tabs]"),
    ).toBeNull();
  });

  test("Phase 8F.1: Back to Settings from integrations returns to the Settings root", async () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps([activeConnection]));
    await flush();
    mount.querySelector<HTMLButtonElement>("[data-testid=settings-manage-connection]")!.click();
    await flush();
    await flush();
    // Back button is provided by the integrations surface.
    const backBtn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=integrations-back]",
    )!;
    expect(backBtn).not.toBeNull();
    // Control hierarchy Op 1: the shared Back control, no longer borrowing
    // the sidebar navigation button class; the arrow is CSS presentation.
    expect(backBtn.classList.contains("shell-back")).toBe(true);
    expect(backBtn.classList.contains("shell-nav-button")).toBe(false);
    expect(backBtn.textContent).toBe("Back to Settings");
    backBtn.click();
    await flush();
    // Settings root is restored.
    expect(
      mount.querySelector("[data-testid=settings-tabs]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=integrations-surface]"),
    ).toBeNull();
  });

  test("with no active connection, the surface still shows no connection UI (Part C/E)", async () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps([]));
    await flush();
    expect(
      mount.querySelector("[data-testid=settings-classroom-connection]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=settings-open-integrations]"),
    ).toBeNull();
    // Import Class remains the entry point.
    expect(
      mount.querySelector("[data-testid=settings-import-class]"),
    ).not.toBeNull();
  });

  test("the Classes list shows BOTH linked and manual classes as compact rows with a source label (Task E5)", async () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps());
    await flush();
    const lms = mount.querySelector(
      "[data-testid=settings-class-item-c-lms]",
    )!;
    const manual = mount.querySelector(
      "[data-testid=settings-class-item-c-manual]",
    )!;
    expect(lms).not.toBeNull();
    expect(manual).not.toBeNull();
    // Compact row structure: not the oversized primary-workspace class card.
    expect(lms.querySelector(".shell-class-card")).toBeNull();
    // Source suffix on the meta line lets the teacher scan managed classes.
    expect(lms.textContent).toContain("Google Classroom");
    expect(lms.textContent).toContain("G6 · Block A");
    expect(manual.textContent).toContain("LyfeLabz");
    expect(manual.textContent).toContain("G7 · Block B");
  });

  test("Sprint 29G.5K-2: NO Sync roster button renders for any class (manual or Google Classroom)", async () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps());
    await flush();
    // The linked and manual class rows both still render as identity rows...
    expect(
      mount.querySelector("[data-testid=settings-class-item-c-lms]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=settings-class-item-c-manual]"),
    ).not.toBeNull();
    // ...but the manual roster-sync control is gone entirely - no button on
    // any class, no per-class sync panel.
    expect(
      mount.querySelectorAll("[data-testid=class-rostersync-button]"),
    ).toHaveLength(0);
    expect(
      mount.querySelectorAll("[data-testid=class-rostersync-status]"),
    ).toHaveLength(0);
  });

  test("Sprint 29G.5K-2: no synchronization instruction text appears in normal teacher UI", async () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps());
    await flush();
    const text = (mount.textContent ?? "").toLowerCase();
    expect(text).not.toContain("sync roster");
    expect(text).not.toContain("sync the roster");
    expect(text).not.toContain("haven't finished signing in");
    expect(text).not.toContain(
      "sync brings the latest google classroom roster into lyfelabz.",
    );
  });

  test("does not render a Default Grade control or any form control", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps());
    expect(
      mount.querySelector("[data-testid=settings-default-grade]"),
    ).toBeNull();
    expect(mount.querySelectorAll("select")).toHaveLength(0);
    expect(mount.querySelectorAll("input")).toHaveLength(0);
  });

  test("does not render removed future-facing category previews / growth notice / filler", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps());
    expect(mount.querySelector("[data-testid=settings-categories]")).toBeNull();
    const text = (mount.textContent ?? "").toLowerCase();
    expect(text).not.toContain("coming soon");
  });

  test("does not render Session identity (uid, schoolId, email, or display name)", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps());
    const text = mount.textContent ?? "";
    expect(text).not.toContain("u1");
    expect(text).not.toContain("school-abc");
    expect(text).not.toContain("Ada Lovelace");
  });

  test("with no integrations wired: still no connection UI, and the Google Classroom section stands (Part C/E)", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, { integrations: null });
    expect(
      mount.querySelector("[data-testid=settings-classroom-connection]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=settings-open-integrations]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=settings-classroom-heading]")!.textContent,
    ).toBe("Google Classroom");
  });
});

// Sprint 30A: Settings tab keyboard accessibility. Roving tabindex with
// AUTOMATIC activation: ArrowLeft/ArrowRight (wrapping), Home, and End both
// focus and select the destination tab. Click behavior is unchanged.
describe("Settings tabs keyboard navigation (Sprint 30A)", () => {
  const CM = "settings-tab-class-management";
  const SS = "settings-tab-student-services";

  const tabEl = (mount: HTMLElement, testid: string): HTMLButtonElement =>
    mount.querySelector<HTMLButtonElement>(`[data-testid=${testid}]`)!;

  const press = (mount: HTMLElement, testid: string, key: string): KeyboardEvent => {
    const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    tabEl(mount, testid).dispatchEvent(ev);
    return ev;
  };

  // Asserts exactly one selected tab, roving tabindex, focus, and a coherent
  // tab/panel relationship for the expected selection.
  const expectSelected = (mount: HTMLElement, selected: string): void => {
    const tabs = Array.from(mount.querySelectorAll<HTMLButtonElement>("[role=tab]"));
    expect(tabs).toHaveLength(2);
    for (const t of tabs) {
      const isSel = t.getAttribute("data-testid") === selected;
      expect(t.getAttribute("aria-selected")).toBe(isSel ? "true" : "false");
      expect(t.tabIndex).toBe(isSel ? 0 : -1);
    }
    const active = tabEl(mount, selected);
    expect(document.activeElement).toBe(active);
    const panels = mount.querySelectorAll("[role=tabpanel]");
    expect(panels).toHaveLength(1);
    const panel = panels[0]!;
    expect(panel.getAttribute("aria-labelledby")).toBe(active.id);
    for (const t of tabs) expect(t.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("data-testid")).toBe(
      selected === CM ? "settings-panel-class-management" : "settings-panel-student-services",
    );
  };

  const focusTab = (mount: HTMLElement, testid: string): void => {
    tabEl(mount, testid).focus();
  };

  test("initial state: selected tab is the single Tab stop (tabIndex 0), inactive tab is -1", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps());
    focusTab(mount, CM);
    expectSelected(mount, CM);
    // Inactive tabs are not additional sequential Tab stops.
    const tabStops = Array.from(
      mount.querySelectorAll<HTMLElement>("[role=tablist] [role=tab]"),
    ).filter((t) => t.tabIndex >= 0);
    expect(tabStops).toHaveLength(1);
  });

  test("ArrowRight focuses and activates the next tab, and wraps last to first", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps());
    focusTab(mount, CM);
    const ev = press(mount, CM, "ArrowRight");
    expect(ev.defaultPrevented).toBe(true);
    expectSelected(mount, SS);
    press(mount, SS, "ArrowRight");
    expectSelected(mount, CM);
  });

  test("ArrowLeft focuses and activates the previous tab, and wraps first to last", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps());
    focusTab(mount, CM);
    press(mount, CM, "ArrowLeft");
    expectSelected(mount, SS);
    press(mount, SS, "ArrowLeft");
    expectSelected(mount, CM);
  });

  test("Home activates the first tab; End activates the final tab", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps());
    focusTab(mount, CM);
    const endEv = press(mount, CM, "End");
    expect(endEv.defaultPrevented).toBe(true);
    expectSelected(mount, SS);
    press(mount, SS, "Home");
    expectSelected(mount, CM);
    // Home on the already-first tab keeps selection and focus.
    const homeEv = press(mount, CM, "Home");
    expect(homeEv.defaultPrevented).toBe(true);
    expectSelected(mount, CM);
  });

  test("unrelated keys (Tab, Enter, Space, ArrowDown, letters) are not hijacked", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps());
    focusTab(mount, CM);
    for (const key of ["Tab", "Enter", " ", "ArrowDown", "ArrowUp", "a"]) {
      const ev = press(mount, CM, key);
      expect(ev.defaultPrevented).toBe(false);
    }
    expectSelected(mount, CM);
  });

  test("click selection still works and updates the roving tabindex", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps());
    tabEl(mount, SS).click();
    expectSelected(mount, SS);
    tabEl(mount, CM).click();
    expectSelected(mount, CM);
    // Keyboard continues from the clicked tab.
    press(mount, CM, "End");
    expectSelected(mount, SS);
  });

  test("keyboard-selected tab is remembered across the Settings Back/Forward subview round trip, with no history entry", () => {
    let controller: { restoreIntegrations: () => boolean; restoreRoot: () => void } | null =
      null;
    const push = jest.fn();
    const replace = jest.fn();
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, {
      ...wiredDeps([activeConnection]),
      settingsHistory: {
        push,
        replace,
        registerController: (c) => {
          controller = c;
        },
      },
    });
    focusTab(mount, CM);
    press(mount, CM, "ArrowRight");
    press(mount, SS, "ArrowLeft");
    press(mount, CM, "End");
    expectSelected(mount, SS);
    // Tab switching never touches browser history.
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    // Browser Forward into Manage connection, then Back to the Settings root.
    expect(controller!.restoreIntegrations()).toBe(true);
    expect(mount.querySelector("[data-testid=settings-tabs]")).toBeNull();
    controller!.restoreRoot();
    const ss = tabEl(mount, SS);
    expect(ss.getAttribute("aria-selected")).toBe("true");
    expect(ss.tabIndex).toBe(0);
    expect(tabEl(mount, CM).tabIndex).toBe(-1);
    expect(
      mount.querySelector("[data-testid=settings-panel-student-services]"),
    ).not.toBeNull();
  });
});
