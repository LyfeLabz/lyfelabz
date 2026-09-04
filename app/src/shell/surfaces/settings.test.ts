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

  test("Student Services is selectable and shows a restrained placeholder (Sprint 28.6H.5 Part E)", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps());
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=settings-tab-student-services]",
      )!
      .click();
    const ss = mount.querySelector("[data-testid=settings-tab-student-services]")!;
    const cm = mount.querySelector("[data-testid=settings-tab-class-management]")!;
    expect(ss.getAttribute("aria-selected")).toBe("true");
    expect(cm.getAttribute("aria-selected")).toBe("false");
    // The Student Services panel is now rendered with its restrained message.
    const panel = mount.querySelector(
      "[data-testid=settings-panel-student-services]",
    )!;
    expect(panel.getAttribute("role")).toBe("tabpanel");
    const note = mount.querySelector(
      "[data-testid=settings-student-services-note]",
    )!;
    expect(note.textContent).toBe(
      "Student accommodations and supports will be managed here.",
    );
    // No accommodation controls, toggles, or form inputs of any kind.
    expect(panel.querySelectorAll("input, select, textarea")).toHaveLength(0);
    // The Class Management panel is swapped out (not merely hidden).
    expect(
      mount.querySelector("[data-testid=settings-panel-class-management]"),
    ).toBeNull();
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

  test("the primary Class Management surface exposes NO Connected / Not connected / Manage connection (Sprint 28.6H.7 Part C/E, N#24-26)", async () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, wiredDeps([activeConnection]));
    await flush();
    // No connection-status line and no Manage connection control.
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
    expect(text).not.toContain("Manage connection");
    // The Google Classroom section still exists and its Import Class entry
    // point is present (contextual authorization happens on click).
    expect(
      mount.querySelector("[data-testid=settings-classroom-heading]")!.textContent,
    ).toBe("Google Classroom");
    expect(
      mount.querySelector("[data-testid=settings-import-class]"),
    ).not.toBeNull();
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
