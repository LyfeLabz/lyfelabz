import type { Session } from "../../session/types";
import type { IntegrationsDeps } from "../../settings/integrations/types";
import type { ClassManagementIntent } from "./classes";
import {
  compactGradeBlock,
  renderRosterSyncPanel,
  type RosterSyncViewEntry,
} from "./classes";
import type { ListClasses } from "../../classes/listClasses";
import type { ClassSummary } from "../../classes/types";
import type {
  SyncRoster,
  SyncRosterCounters,
  SyncRosterError,
} from "../../classes/syncRoster";

// Settings workspace surface.
//
// Sprint 28.6H.3 (Task C) made Settings the administrative home for all
// infrequent class / integration administration ("How are my classes and
// integrations configured?"). Sprint 28.6H.4 (Part E) reshaped it into a
// SCALABLE TABBED surface so future categories (e.g. Accommodations) can be
// added cleanly. Only ONE real category exists today - Class Management - so
// exactly one tab renders (no dead placeholder tabs). The Class Management
// panel owns everything, presented compactly:
//
//   [ Class Management ]  (the single tab)
//
//   ## Google Classroom
//     - concise connection state ("Connected" / "Not connected"), read from
//       the existing Integrations seam
//     - Manage connection (connect / reconnect / disconnect stay in the
//       existing Integrations experience)
//
//   Import Class (primary) · Create Class (secondary) - shortened openers that
//   invoke the SAME certified class-creation / import workflow that lives on
//   the Classes surface (one implementation, two entry points, via the shared
//   one-shot class-management intent). No second create/import implementation
//   is introduced here.
//
//   ## Classes
//     - compact administrative ROWS for every active class (name + a
//       `G6 · Block B · Google Classroom` / `G6 · Block A · LyfeLabz` meta
//       line), NOT oversized management cards. Google Classroom-linked classes
//       expose the certified `lmsClassesSyncRoster` action via the shared
//       roster-sync panel (reused verbatim); manual LyfeLabz classes never
//       expose Classroom sync. Opening Settings never triggers a sync; a sync
//       runs only on an explicit Sync roster click.
//
// The Settings surface holds no OAuth token, opens no Firestore listener,
// imports no firebase/* module, and invokes no callable directly. Its reads
// (the Google Classroom connection state, the teacher class list) go through
// injected seams wired at the client entry point; the class list is a single
// query (the same shape the Classes surface issues), never a per-class
// fan-out.

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

export type SettingsDeps = {
  readonly integrations: IntegrationsDeps | null;
  // Sprint 28.6F/28.6H.3: the shared class-management opener. Settings' Import
  // / Create controls invoke it to open the certified workflow hosted by the
  // Classes surface (one implementation, two entry points). Absent in
  // harnesses that do not exercise class management.
  readonly openClassManagement?:
    | ((intent: ClassManagementIntent | null) => void)
    | null;
  readonly canImportClasses?: boolean;
  readonly canCreateClasses?: boolean;
  // Sprint 28.6H.3 (Task C4): the teacher class list reader (same seam Classes
  // uses) and the certified roster-sync callable. Roster sync administration
  // lives here. Both optional so test harnesses that do not exercise class
  // management can omit them.
  readonly listClasses?: ListClasses | null;
  readonly syncRoster?: SyncRoster | null;
};

export function renderSettingsSurface(
  mount: HTMLElement,
  session: ActiveTeacher,
  deps: SettingsDeps = { integrations: null },
): void {
  // Sprint 28.6H.5 (Part E): Settings now has two tab categories. Class
  // Management is the default; Student Services is a deliberate, inert
  // architecture placeholder for future student-support configuration. Tab
  // state is local/in-memory (no routing change, no persistence), reusing the
  // H.4 tab architecture. `pendingTabFocus` moves focus onto the selected tab
  // after a redraw so keyboard selection lands where the user expects.
  type SettingsTab = "class-management" | "student-services";
  let settingsTab: SettingsTab = "class-management";
  let pendingTabFocus: SettingsTab | null = null;

  const openClassManagement = deps.openClassManagement ?? null;
  const canImportClasses = deps.canImportClasses === true;
  const canCreateClasses = deps.canCreateClasses === true;
  const listClasses = deps.listClasses ?? null;
  const syncRoster = deps.syncRoster ?? null;

  const doc = mount.ownerDocument;
  const container = doc.createElement("div");
  container.className = "shell-settings-container";
  container.setAttribute("data-testid", "settings-container");
  mount.appendChild(container);

  // Sprint 28.6H.3 (Task C4): class list + ephemeral roster-sync state for the
  // Class Management section. The class list is loaded once per Settings mount
  // (one query, no per-class fan-out). Roster-sync state is keyed by classId
  // and is never persisted; duplicate concurrent clicks are suppressed by the
  // in-flight status. Opening Settings never triggers a sync.
  type ClassesState =
    | { readonly kind: "idle" }
    | { readonly kind: "loading" }
    | { readonly kind: "error" }
    | { readonly kind: "list"; readonly classes: ReadonlyArray<ClassSummary> };
  let classesState: ClassesState = { kind: "idle" };
  const rosterSyncByClass = new Map<string, RosterSyncViewEntry>();

  const getRosterEntry = (classId: string): RosterSyncViewEntry =>
    rosterSyncByClass.get(classId) ?? { status: "idle" };

  const runRosterSync = (classId: string): void => {
    if (syncRoster === null) return;
    if (getRosterEntry(classId).status === "syncing") return;
    rosterSyncByClass.set(classId, { status: "syncing" });
    draw();
    void syncRoster({ classId })
      .then((result) => {
        if (!mount.isConnected) return;
        const counters: SyncRosterCounters = {
          added: result.added,
          reactivated: result.reactivated,
          unchanged: result.unchanged,
          withdrawn: result.withdrawn,
          unresolved: result.unresolved,
          skipped: result.skipped,
          upstreamRosterEmpty: result.upstreamRosterEmpty,
        };
        rosterSyncByClass.set(classId, {
          status: "ok",
          counters,
          at: Date.now(),
        });
        draw();
      })
      .catch((err: unknown) => {
        if (!mount.isConnected) return;
        const kind: SyncRosterError["kind"] =
          err && typeof err === "object" && "kind" in err &&
          typeof (err as { kind?: unknown }).kind === "string"
            ? (err as { kind: SyncRosterError["kind"] }).kind
            : "unknown";
        rosterSyncByClass.set(classId, { status: "error", kind, at: Date.now() });
        draw();
      });
  };

  // Sprint 28.6H.7 (Part C/E): Settings no longer renders a proactive Google
  // Classroom connection subview or a connection-status line. `draw()` always
  // renders the root decision surface; Google Classroom authorization is
  // handled contextually by the certified Import flow on the Classes surface.
  const draw = (): void => {
    container.textContent = "";
    drawRoot();
  };

  const renderGoogleClassroomSection = (): HTMLElement => {
    const section = doc.createElement("section");
    section.className = "shell-settings-classroom";
    section.setAttribute("data-testid", "settings-classroom-section");
    section.setAttribute("aria-labelledby", "settings-classroom-heading");

    const heading = doc.createElement("h3");
    heading.id = "settings-classroom-heading";
    heading.className = "shell-settings-section-heading";
    heading.setAttribute("data-testid", "settings-classroom-heading");
    heading.textContent = "Google Classroom";
    section.appendChild(heading);

    // Sprint 28.6H.7 (Part C/E): the permanent "Connected / Not connected /
    // Manage connection" presentation is removed from this primary Class
    // Management decision surface - it exposed the OAuth/connection model as a
    // proactive management task. Google Classroom authorization is now handled
    // CONTEXTUALLY by Import Class: the certified import flow (Classes surface)
    // checks for a usable active connection and runs the existing OAuth /
    // reconsent only when required, then continues into course discovery. The
    // underlying connection/OAuth implementation is unchanged and preserved;
    // only this surface's proactive connection-management UI is removed.
    // Import Class is the teacher-facing entry point (primary), under the
    // Google Classroom heading (which establishes the source); the manual
    // creation action lives in the separate LyfeLabz Classes section (Part E2).
    const importActions = doc.createElement("div");
    importActions.className = "shell-settings-class-actions";

    const importBtn = doc.createElement("button");
    importBtn.type = "button";
    importBtn.className =
      "shell-settings-class-action shell-settings-class-action--primary";
    importBtn.setAttribute("data-testid", "settings-import-class");
    importBtn.textContent = "Import Class";
    const importReady = openClassManagement !== null && canImportClasses;
    importBtn.disabled = !importReady;
    if (!importReady) importBtn.setAttribute("aria-disabled", "true");
    importBtn.addEventListener("click", () => {
      if (!importReady) return;
      openClassManagement?.("import");
    });
    importActions.appendChild(importBtn);
    section.appendChild(importActions);

    return section;
  };

  // Sprint 28.6H.6 (Part E2): the separate manual-class source. A simple
  // heading + a single Create LyfeLabz Class action (secondary hierarchy) - no
  // Google Classroom action here, so the teacher never confuses manual creation
  // with a Google Classroom operation.
  const renderLyfeLabzClassesSection = (): HTMLElement => {
    const section = doc.createElement("section");
    section.className = "shell-settings-lyfelabz";
    section.setAttribute("data-testid", "settings-lyfelabz-section");
    section.setAttribute("aria-labelledby", "settings-lyfelabz-heading");

    const heading = doc.createElement("h3");
    heading.id = "settings-lyfelabz-heading";
    heading.className = "shell-settings-section-heading";
    heading.setAttribute("data-testid", "settings-lyfelabz-heading");
    heading.textContent = "LyfeLabz Classes";
    section.appendChild(heading);

    const actions = doc.createElement("div");
    actions.className = "shell-settings-class-actions";

    const createBtn = doc.createElement("button");
    createBtn.type = "button";
    createBtn.className =
      "shell-settings-class-action shell-settings-class-action--secondary";
    createBtn.setAttribute("data-testid", "settings-create-class");
    // The action names the source explicitly (the heading is "LyfeLabz
    // Classes"); the focused create TASK form later submits with the shorter
    // "Create Class" (Part F4).
    createBtn.textContent = "Create LyfeLabz Class";
    const createReady = openClassManagement !== null && canCreateClasses;
    createBtn.disabled = !createReady;
    if (!createReady) createBtn.setAttribute("aria-disabled", "true");
    createBtn.addEventListener("click", () => {
      if (!createReady) return;
      openClassManagement?.("create");
    });
    actions.appendChild(createBtn);
    section.appendChild(actions);

    return section;
  };

  // Sprint 28.6H.4 (Task E5): the compact administrative "Classes" list. Each
  // class is a compact row (name on top; a `G6 · Block B · Google Classroom` /
  // `G6 · Block A · LyfeLabz` meta line beneath) rather than an oversized
  // bordered management card. Google Classroom-linked ACTIVE classes expose the
  // certified Sync roster action (reused verbatim from the Classes surface);
  // manual LyfeLabz classes never expose Classroom sync. The class list is
  // loaded lazily on first draw of the root (one query, no per-class fan-out);
  // opening Settings never triggers a sync.
  const renderClassesList = (): HTMLElement => {
    const wrap = doc.createElement("div");
    wrap.className = "shell-settings-rostersync";
    wrap.setAttribute("data-testid", "settings-rostersync");

    // No class list wired -> nothing to administer here.
    if (listClasses === null) return wrap;

    const subheading = doc.createElement("h3");
    subheading.id = "settings-classes-heading";
    subheading.className = "shell-settings-section-heading";
    subheading.setAttribute("data-testid", "settings-classes-heading");
    subheading.textContent = "Classes";
    wrap.appendChild(subheading);

    if (classesState.kind === "idle") {
      classesState = { kind: "loading" };
      void listClasses(session.uid)
        .then((classes) => {
          if (!mount.isConnected) return;
          classesState = { kind: "list", classes };
          draw();
        })
        .catch(() => {
          if (!mount.isConnected) return;
          classesState = { kind: "error" };
          draw();
        });
    }

    if (classesState.kind === "loading") {
      const loading = doc.createElement("p");
      loading.className = "shell-status";
      loading.setAttribute("data-testid", "settings-rostersync-loading");
      loading.setAttribute("role", "status");
      loading.textContent = "Loading your classes…";
      wrap.appendChild(loading);
      return wrap;
    }

    if (classesState.kind === "error") {
      const err = doc.createElement("p");
      err.className = "shell-status";
      err.setAttribute("data-testid", "settings-rostersync-error");
      err.setAttribute("role", "status");
      err.textContent = "We could not load your classes. Reload to try again.";
      wrap.appendChild(err);
      return wrap;
    }

    const active = classesState.classes.filter((c) => c.status === "active");

    if (active.length === 0) {
      const empty = doc.createElement("p");
      empty.className = "shell-status";
      empty.setAttribute("data-testid", "settings-rostersync-empty");
      empty.setAttribute("role", "status");
      empty.textContent = "No classes yet. Import or create a class to begin.";
      wrap.appendChild(empty);
      return wrap;
    }

    const list = doc.createElement("ul");
    list.className = "shell-settings-rostersync-list";
    list.setAttribute("data-testid", "settings-rostersync-list");
    list.setAttribute("role", "list");

    for (const summary of active) {
      const linked = summary.isLmsLinked === true;
      const li = doc.createElement("li");
      li.className = "shell-settings-rostersync-item";
      li.setAttribute("data-testid", `settings-class-item-${summary.id}`);
      li.setAttribute("data-class-id", summary.id);
      li.setAttribute("data-lms-linked", linked ? "true" : "false");

      const identity = doc.createElement("div");
      identity.className = "shell-settings-rostersync-identity";

      const name = doc.createElement("p");
      name.className = "shell-settings-rostersync-name";
      name.textContent = summary.title;
      identity.appendChild(name);

      // Meta line: `G6 · Block B · Google Classroom` (linked) or
      // `G6 · Block A · LyfeLabz` (manual). The source suffix lets the teacher
      // scan which classes are Google Classroom-managed at a glance.
      const source = linked ? "Google Classroom" : "LyfeLabz";
      const gradeBlock = compactGradeBlock(summary);
      const metaText =
        gradeBlock !== null ? `${gradeBlock} · ${source}` : source;
      const metaEl = doc.createElement("p");
      metaEl.className = "shell-settings-rostersync-meta";
      metaEl.textContent = metaText;
      identity.appendChild(metaEl);

      li.appendChild(identity);

      // Sync roster only for Google Classroom-linked classes with the sync
      // callable wired. Manual classes show no sync action.
      if (linked && syncRoster !== null) {
        li.appendChild(
          renderRosterSyncPanel(doc, {
            available: true,
            entry: getRosterEntry(summary.id),
            onSyncClick: () => runRosterSync(summary.id),
          }),
        );
      }
      list.appendChild(li);
    }

    wrap.appendChild(list);
    return wrap;
  };

  // Sprint 28.6H.5 (Part E, Task E1/E2): Student Services is a deliberate,
  // inert placeholder for where student accommodations/supports will live. It
  // contains NO accommodation controls, NO disabled toggles, and NO implication
  // that accommodations are functional - only a restrained informational line.
  // No persistence, no callable, no backend.
  const renderStudentServicesPanel = (): HTMLElement => {
    const panel = doc.createElement("div");
    panel.className = "shell-settings-panel";
    panel.id = "settings-panel-student-services";
    panel.setAttribute("data-testid", "settings-panel-student-services");
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", "settings-tab-student-services");

    const note = doc.createElement("p");
    note.className = "shell-settings-placeholder";
    note.setAttribute("data-testid", "settings-student-services-note");
    note.textContent =
      "Student accommodations and supports will be managed here.";
    panel.appendChild(note);

    return panel;
  };

  const renderClassManagementPanel = (): HTMLElement => {
    const panel = doc.createElement("div");
    panel.className = "shell-settings-panel";
    panel.id = "settings-panel-class-management";
    panel.setAttribute("data-testid", "settings-panel-class-management");
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", "settings-tab-class-management");

    // Sprint 28.6H.6 (Part D/E): the Class Management panel is a DECISION
    // surface with two clearly distinct class-source areas - Google Classroom
    // (connection + Import Class) and LyfeLabz Classes (Create LyfeLabz Class) -
    // followed by the compact managed-class list. Import / Create no longer sit
    // together as an ambiguous pair.
    panel.appendChild(renderGoogleClassroomSection());
    panel.appendChild(renderLyfeLabzClassesSection());
    panel.appendChild(renderClassesList());
    return panel;
  };

  const drawRoot = (): void => {
    const headline = doc.createElement("h2");
    headline.id = "surface-headline";
    headline.className = "shell-welcome";
    headline.tabIndex = -1;
    headline.setAttribute("data-testid", "surface-headline");
    headline.textContent = "Settings";
    container.appendChild(headline);
    if (pendingTabFocus === null) {
      try {
        headline.focus({ preventScroll: true });
      } catch {
        // ignored
      }
    }

    // Sprint 28.6H.5 (Part E): Settings is a scalable TABBED surface with TWO
    // categories - Class Management (default) and Student Services. Proper
    // WAI-ARIA tab semantics: role=tablist / role=tab (aria-selected) /
    // role=tabpanel (aria-labelledby). Selecting a tab swaps the panel in place
    // (in-memory state, no routing, no reload). Both tabs are always present;
    // exactly one panel is rendered so no aria-controls reference dangles.
    const tablist = doc.createElement("div");
    tablist.className = "shell-settings-tabs";
    tablist.setAttribute("data-testid", "settings-tabs");
    tablist.setAttribute("role", "tablist");
    tablist.setAttribute("aria-label", "Settings categories");

    const makeTab = (
      tab: SettingsTab,
      testid: string,
      panelId: string,
      label: string,
    ): HTMLButtonElement => {
      const btn = doc.createElement("button");
      btn.type = "button";
      btn.id = `settings-tab-${tab}`;
      const selected = settingsTab === tab;
      btn.className = selected
        ? "shell-settings-tab shell-settings-tab-active"
        : "shell-settings-tab";
      btn.setAttribute("data-testid", testid);
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", selected ? "true" : "false");
      // Only the active panel is in the DOM, so both tabs point their
      // aria-controls at the rendered panel's id (a single-panel tab swap).
      btn.setAttribute("aria-controls", panelId);
      btn.tabIndex = selected ? 0 : -1;
      btn.textContent = label;
      btn.addEventListener("click", () => {
        if (settingsTab === tab) return;
        settingsTab = tab;
        pendingTabFocus = tab;
        draw();
      });
      return btn;
    };

    const activePanelId =
      settingsTab === "class-management"
        ? "settings-panel-class-management"
        : "settings-panel-student-services";

    tablist.appendChild(
      makeTab(
        "class-management",
        "settings-tab-class-management",
        activePanelId,
        "Class Management",
      ),
    );
    tablist.appendChild(
      makeTab(
        "student-services",
        "settings-tab-student-services",
        activePanelId,
        "Student Services",
      ),
    );
    container.appendChild(tablist);

    const panel =
      settingsTab === "student-services"
        ? renderStudentServicesPanel()
        : renderClassManagementPanel();
    container.appendChild(panel);

    if (pendingTabFocus !== null) {
      const focusTarget = container.querySelector<HTMLElement>(
        `#settings-tab-${pendingTabFocus}`,
      );
      pendingTabFocus = null;
      try {
        focusTarget?.focus({ preventScroll: true });
      } catch {
        // ignored
      }
    }
  };

  draw();
}
