import type { Session } from "../../session/types";
import type { IntegrationsDeps } from "../../settings/integrations/types";
import { renderIntegrationsSurface } from "../../settings/integrations/integrations";
import type { ClassManagementIntent } from "./classes";
import { compactGradeBlock } from "./classes";
import type { ListClasses } from "../../classes/listClasses";
import type { ClassSummary } from "../../classes/types";
import type {
  AccommodationsListStudentsCallable,
  AccommodationsGetCallable,
  AccommodationsSetCallable,
  ReadingAccessibilityConfig,
  StudentAccommodationSummary,
} from "../../accommodations/wire";

// Sprint 29G.5K-2: the teacher-facing manual "Sync roster" affordance is
// removed. Google Classroom-backed classes now capture their roster
// automatically as part of the one Import Class workflow, and students are
// enrolled on their own first Google sign-in - so no teacher roster
// synchronization is exposed as normal class administration. The backend
// roster primitives remain for internal recovery/support; this surface no
// longer renders them.

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
  // uses). Optional so test harnesses that do not exercise class management
  // can omit it.
  //
  // Sprint 29G.5K-2: the roster-sync callable is no longer a Settings dep -
  // the manual teacher sync action has been removed from this surface.
  readonly listClasses?: ListClasses | null;
  // Slice 7: Student Services accommodation seams. All three are optional;
  // absent in harnesses that do not exercise the Student Services panel.
  // G19: wired at the entry point only after Slices 2-6 are production-verified.
  readonly listStudents?: AccommodationsListStudentsCallable | null;
  readonly getAccommodation?: AccommodationsGetCallable | null;
  readonly setAccommodation?: AccommodationsSetCallable | null;
};

export function renderSettingsSurface(
  mount: HTMLElement,
  session: ActiveTeacher,
  deps: SettingsDeps = { integrations: null },
): void {
  // Subview routing: "root" renders the tabbed Settings surface;
  // "integrations" delegates to the existing integrations management surface
  // (connection status, Disconnect, Reconnect) with its own Back control.
  let subview: "root" | "integrations" = "root";

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
  const listStudents = deps.listStudents ?? null;
  const getAccommodation = deps.getAccommodation ?? null;
  const setAccommodation = deps.setAccommodation ?? null;

  const doc = mount.ownerDocument;
  const container = doc.createElement("div");
  container.className = "shell-settings-container";
  container.setAttribute("data-testid", "settings-container");
  mount.appendChild(container);

  // Sprint 28.6H.3 (Task C4): class list for the Class Management section.
  // The class list is loaded once per Settings mount (one query, no per-class
  // fan-out).
  //
  // Sprint 29G.5K-2: the ephemeral roster-sync state and the per-class
  // `Sync roster` action have been removed. Roster membership is captured
  // automatically at import and students self-enroll on first sign-in, so the
  // teacher never performs a manual roster synchronization here.
  type ClassesState =
    | { readonly kind: "idle" }
    | { readonly kind: "loading" }
    | { readonly kind: "error" }
    | { readonly kind: "list"; readonly classes: ReadonlyArray<ClassSummary> };
  let classesState: ClassesState = { kind: "idle" };

  // Student Services state: class picker → student list → student detail.
  // `StudentAccommodationSummary` carries only identity (studentId + displayName);
  // accommodation state is loaded via getAccommodation when a student is selected.
  type StudentsState =
    | { readonly kind: "idle" }
    | { readonly kind: "loading" }
    | { readonly kind: "error" }
    | {
        readonly kind: "loaded";
        readonly students: ReadonlyArray<StudentAccommodationSummary>;
      };
  type StudentDetailState =
    | { readonly kind: "loading-revision" }
    | {
        readonly kind: "ready";
        readonly configRevision: number;
        readonly config: ReadingAccessibilityConfig;
      }
    | {
        // Teacher clicked Deactivate; awaiting explicit confirmation.
        readonly kind: "confirm-deactivate";
        readonly configRevision: number;
        readonly config: ReadingAccessibilityConfig;
      }
    | { readonly kind: "saving" }
    | {
        readonly kind: "conflict";
        readonly freshRevision: number;
        readonly freshConfig: ReadingAccessibilityConfig;
      }
    | { readonly kind: "error" };

  let ssSelectedClassId: string | null = null;
  let studentsState: StudentsState = { kind: "idle" };
  let ssSelectedStudentId: string | null = null;
  let studentDetailState: StudentDetailState | null = null;

  const draw = (): void => {
    container.textContent = "";
    if (subview === "integrations" && deps.integrations !== null) {
      renderIntegrationsSurface(container, deps.integrations, {
        onExit: () => {
          subview = "root";
          draw();
        },
      });
      return;
    }
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

    if (deps.integrations !== null) {
      const manageBtn = doc.createElement("button");
      manageBtn.type = "button";
      manageBtn.className =
        "shell-settings-class-action shell-settings-class-action--secondary";
      manageBtn.setAttribute("data-testid", "settings-manage-connection");
      manageBtn.textContent = "Manage connection";
      manageBtn.addEventListener("click", () => {
        subview = "integrations";
        draw();
      });
      importActions.appendChild(manageBtn);
    }

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

      // Sprint 29G.5K-2: no per-class roster-sync action. Google
      // Classroom-backed classes reflect their roster automatically; the
      // teacher sees only the class identity, never a synchronization control.
      list.appendChild(li);
    }

    wrap.appendChild(list);
    return wrap;
  };

  // Slice 7: Student Services panel - Reading Accessibility activation surface.
  // Flow: class picker -> student list -> student detail (Reading Accessibility card).
  // All accommodation deps are optional; panel degrades gracefully when absent.
  const renderStudentServicesPanel = (): HTMLElement => {
    const panel = doc.createElement("div");
    panel.className = "shell-settings-panel";
    panel.id = "settings-panel-student-services";
    panel.setAttribute("data-testid", "settings-panel-student-services");
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", "settings-tab-student-services");

    if (listStudents === null || getAccommodation === null || setAccommodation === null) {
      const note = doc.createElement("p");
      note.className = "shell-settings-placeholder";
      note.setAttribute("data-testid", "settings-student-services-note");
      note.textContent =
        "Student accommodations and supports will be managed here.";
      panel.appendChild(note);
      return panel;
    }

    // Trigger class load (shared state with Class Management tab).
    if (classesState.kind === "idle") {
      if (listClasses !== null) {
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
    }

    // --- Class picker ---
    const pickerSection = doc.createElement("div");
    pickerSection.className = "shell-ss-picker";
    pickerSection.setAttribute("data-testid", "ss-class-picker");

    const pickerRow = doc.createElement("div");
    pickerRow.className = "shell-ss-picker-row";

    const pickerLabel = doc.createElement("label");
    pickerLabel.htmlFor = "ss-class-select";
    pickerLabel.className = "shell-ss-picker-label";
    pickerLabel.textContent = "Class";
    pickerRow.appendChild(pickerLabel);

    const select = doc.createElement("select");
    select.id = "ss-class-select";
    select.className = "shell-ss-class-select";
    select.setAttribute("data-testid", "ss-class-select");

    const placeholder = doc.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a class…";
    placeholder.disabled = true;
    select.appendChild(placeholder);

    if (classesState.kind === "loading") {
      const opt = doc.createElement("option");
      opt.disabled = true;
      opt.textContent = "Loading classes…";
      select.appendChild(opt);
      select.disabled = true;
    } else if (classesState.kind === "error") {
      const opt = doc.createElement("option");
      opt.disabled = true;
      opt.textContent = "Error loading classes";
      select.appendChild(opt);
      select.disabled = true;
    } else if (classesState.kind === "list") {
      const active = classesState.classes.filter((c) => c.status === "active");
      for (const cls of active) {
        const opt = doc.createElement("option");
        opt.value = cls.id;
        opt.textContent = cls.title;
        if (cls.id === ssSelectedClassId) opt.selected = true;
        select.appendChild(opt);
      }
    } else {
      // idle - no list yet but not loading either (no listClasses dep)
      select.disabled = true;
    }

    if (ssSelectedClassId === null) {
      placeholder.selected = true;
    }

    select.addEventListener("change", () => {
      const chosen = select.value;
      if (!chosen || chosen === ssSelectedClassId) return;
      ssSelectedClassId = chosen;
      ssSelectedStudentId = null;
      studentDetailState = null;
      studentsState = { kind: "idle" };
      draw();
    });

    pickerRow.appendChild(select);
    pickerSection.appendChild(pickerRow);
    panel.appendChild(pickerSection);

    // --- No class selected ---
    if (ssSelectedClassId === null) {
      return panel;
    }

    // --- Student list / detail area ---
    if (ssSelectedStudentId !== null) {
      // Detail view
      panel.appendChild(renderStudentDetail(ssSelectedClassId, ssSelectedStudentId));
      return panel;
    }

    // Student list for the selected class
    panel.appendChild(renderStudentList(ssSelectedClassId));
    return panel;
  };

  const renderStudentList = (classId: string): HTMLElement => {
    const section = doc.createElement("section");
    section.className = "shell-ss-student-list-section";
    section.setAttribute("data-testid", "ss-student-list-section");
    section.setAttribute("aria-labelledby", "ss-ra-heading");

    const heading = doc.createElement("h3");
    heading.id = "ss-ra-heading";
    heading.className = "shell-settings-section-heading";
    heading.setAttribute("data-testid", "ss-ra-heading");
    heading.textContent = "Reading Accessibility";
    section.appendChild(heading);

    const desc = doc.createElement("p");
    desc.className = "shell-ss-section-desc";
    desc.setAttribute("data-testid", "ss-ra-desc");
    desc.textContent =
      "Provides accessible reading materials for students who need additional support.";
    section.appendChild(desc);

    if (studentsState.kind === "idle") {
      studentsState = { kind: "loading" };
      void listStudents!({ classId })
        .then((res) => {
          if (!mount.isConnected) return;
          studentsState = { kind: "loaded", students: res.students };
          draw();
        })
        .catch(() => {
          if (!mount.isConnected) return;
          studentsState = { kind: "error" };
          draw();
        });
    }

    if (studentsState.kind === "loading") {
      const loading = doc.createElement("p");
      loading.className = "shell-status";
      loading.setAttribute("data-testid", "ss-students-loading");
      loading.setAttribute("role", "status");
      loading.textContent = "Loading students…";
      section.appendChild(loading);
      return section;
    }

    if (studentsState.kind === "error") {
      const err = doc.createElement("p");
      err.className = "shell-status";
      err.setAttribute("data-testid", "ss-students-error");
      err.setAttribute("role", "status");
      err.textContent = "Could not load students. Try selecting the class again.";
      section.appendChild(err);
      return section;
    }

    const students = studentsState.kind === "loaded" ? studentsState.students : [];

    if (students.length === 0) {
      const empty = doc.createElement("p");
      empty.className = "shell-status";
      empty.setAttribute("data-testid", "ss-students-empty");
      empty.setAttribute("role", "status");
      empty.textContent = "No enrolled students found in this class.";
      section.appendChild(empty);
      return section;
    }

    const list = doc.createElement("ul");
    list.className = "shell-ss-student-list";
    list.setAttribute("data-testid", "ss-student-list");
    list.setAttribute("role", "list");

    for (const student of students) {
      const li = doc.createElement("li");
      li.className = "shell-ss-student-item";
      li.setAttribute("data-testid", `ss-student-item-${student.studentId}`);
      li.setAttribute("data-student-id", student.studentId);

      const btn = doc.createElement("button");
      btn.type = "button";
      btn.className = "shell-ss-student-btn";
      btn.setAttribute("data-testid", `ss-student-btn-${student.studentId}`);

      const nameEl = doc.createElement("span");
      nameEl.className = "shell-ss-student-name";
      nameEl.textContent = student.studentDisplayName;
      btn.appendChild(nameEl);

      btn.addEventListener("click", () => {
        ssSelectedStudentId = student.studentId;
        studentDetailState = { kind: "loading-revision" };
        draw();
        void getAccommodation!({
          studentId: student.studentId,
          classId,
        })
          .then((res) => {
            if (!mount.isConnected) return;
            if (ssSelectedStudentId !== student.studentId) return;
            studentDetailState = {
              kind: "ready",
              configRevision: res.configRevision,
              config:
                res.configRevision === 0
                  ? { status: "inactive" }
                  : (res as { configRevision: number; readingAccessibility: ReadingAccessibilityConfig }).readingAccessibility,
            };
            draw();
          })
          .catch(() => {
            if (!mount.isConnected) return;
            if (ssSelectedStudentId !== student.studentId) return;
            studentDetailState = { kind: "error" };
            draw();
          });
      });

      li.appendChild(btn);
      list.appendChild(li);
    }

    section.appendChild(list);
    return section;
  };

  const renderStudentDetail = (classId: string, studentId: string): HTMLElement => {
    const container2 = doc.createElement("div");
    container2.className = "shell-ss-detail";
    container2.setAttribute("data-testid", "ss-student-detail");

    const backBtn = doc.createElement("button");
    backBtn.type = "button";
    backBtn.className = "shell-ss-back-btn";
    backBtn.setAttribute("data-testid", "ss-back-btn");
    backBtn.textContent = "← Back to student list";
    backBtn.addEventListener("click", () => {
      ssSelectedStudentId = null;
      studentDetailState = null;
      draw();
    });
    container2.appendChild(backBtn);

    // Find student display name from loaded list.
    let studentDisplayName = studentId;
    if (studentsState.kind === "loaded") {
      const found = studentsState.students.find((s) => s.studentId === studentId);
      if (found) studentDisplayName = found.studentDisplayName;
    }

    const nameEl = doc.createElement("h3");
    nameEl.className = "shell-ss-student-detail-name";
    nameEl.setAttribute("data-testid", "ss-student-detail-name");
    nameEl.textContent = studentDisplayName;
    container2.appendChild(nameEl);

    const card = doc.createElement("div");
    card.className = "shell-ss-ra-card";
    card.setAttribute("data-testid", "ss-ra-card");

    const cardHeading = doc.createElement("h4");
    cardHeading.className = "shell-ss-ra-card-heading";
    cardHeading.setAttribute("data-testid", "ss-ra-card-heading");
    cardHeading.textContent = "Reading Accessibility";
    card.appendChild(cardHeading);

    const detailState = studentDetailState;

    if (detailState === null || detailState.kind === "loading-revision") {
      const loading = doc.createElement("p");
      loading.className = "shell-status";
      loading.setAttribute("data-testid", "ss-detail-loading");
      loading.setAttribute("role", "status");
      loading.textContent = "Loading…";
      card.appendChild(loading);
      container2.appendChild(card);
      return container2;
    }

    if (detailState.kind === "error") {
      const err = doc.createElement("p");
      err.className = "shell-status";
      err.setAttribute("data-testid", "ss-detail-error");
      err.setAttribute("role", "status");
      err.textContent = "Could not load accommodation details. Go back and try again.";
      card.appendChild(err);
      container2.appendChild(card);
      return container2;
    }

    const isConfirmingDeactivate = detailState.kind === "confirm-deactivate";
    const currentConfig: ReadingAccessibilityConfig =
      detailState.kind === "conflict"
        ? detailState.freshConfig
        : detailState.kind === "ready" || detailState.kind === "confirm-deactivate"
          ? detailState.config
          : { status: "inactive" };
    const currentRevision: number =
      detailState.kind === "conflict"
        ? detailState.freshRevision
        : detailState.kind === "ready" || detailState.kind === "confirm-deactivate"
          ? detailState.configRevision
          : 0;
    const isActive = currentConfig.status === "active";

    const statusLine = doc.createElement("p");
    statusLine.className = "shell-ss-ra-status";
    statusLine.setAttribute("data-testid", "ss-ra-status");
    statusLine.textContent = isActive ? "Active" : "Inactive";
    card.appendChild(statusLine);

    if (isActive) {
      const activeDesc = doc.createElement("p");
      activeDesc.className = "shell-ss-ra-active-desc";
      activeDesc.setAttribute("data-testid", "ss-ra-active-desc");
      activeDesc.textContent =
        "This student will receive reading-accessible lesson materials when available.";
      card.appendChild(activeDesc);
    }

    const scopeNote = doc.createElement("p");
    scopeNote.className = "shell-ss-ra-scope";
    scopeNote.setAttribute("data-testid", "ss-ra-scope");
    scopeNote.textContent =
      "Student services apply to the student, not an individual assignment.";
    card.appendChild(scopeNote);

    if (detailState.kind === "conflict") {
      const conflictMsg = doc.createElement("p");
      conflictMsg.className = "shell-ss-conflict-msg";
      conflictMsg.setAttribute("data-testid", "ss-conflict-msg");
      conflictMsg.setAttribute("role", "alert");
      conflictMsg.textContent =
        "This accommodation was updated elsewhere. The current state is shown above - review and try again.";
      card.appendChild(conflictMsg);
    }

    // Deactivation confirmation dialog.
    if (isConfirmingDeactivate) {
      const confirmWrap = doc.createElement("div");
      confirmWrap.className = "shell-ss-confirm";
      confirmWrap.setAttribute("data-testid", "ss-deactivate-confirm");
      confirmWrap.setAttribute("role", "alert");

      const confirmMsg = doc.createElement("p");
      confirmMsg.className = "shell-ss-confirm-msg";
      confirmMsg.setAttribute("data-testid", "ss-deactivate-confirm-msg");
      confirmMsg.textContent =
        "Deactivating Reading Accessibility will remove reading-accessible materials for this student. Continue?";
      confirmWrap.appendChild(confirmMsg);

      const confirmBtn = doc.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "shell-ss-ra-action shell-ss-ra-action--confirm";
      confirmBtn.setAttribute("data-testid", "ss-deactivate-confirm-btn");
      confirmBtn.textContent = "Yes, deactivate";
      confirmBtn.addEventListener("click", () => {
        executeSet(studentId, classId, currentRevision, { status: "inactive" });
      });
      confirmWrap.appendChild(confirmBtn);

      const cancelBtn = doc.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "shell-ss-ra-action shell-ss-ra-action--cancel";
      cancelBtn.setAttribute("data-testid", "ss-deactivate-cancel-btn");
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => {
        studentDetailState = {
          kind: "ready",
          configRevision: detailState.configRevision,
          config: detailState.config,
        };
        draw();
      });
      confirmWrap.appendChild(cancelBtn);

      card.appendChild(confirmWrap);
      container2.appendChild(card);
      return container2;
    }

    // Primary action button (Activate / Deactivate / Saving).
    const actionBtn = doc.createElement("button");
    actionBtn.type = "button";
    actionBtn.className = "shell-ss-ra-action";
    actionBtn.setAttribute("data-testid", "ss-ra-action");

    const isSaving = detailState.kind === "saving";
    if (isSaving) {
      actionBtn.disabled = true;
      actionBtn.textContent = "Saving…";
    } else if (isActive) {
      actionBtn.textContent = "Deactivate";
      actionBtn.addEventListener("click", () => {
        // Deactivation requires a confirmation step before the write.
        studentDetailState = {
          kind: "confirm-deactivate",
          configRevision: currentRevision,
          config: currentConfig,
        };
        draw();
      });
    } else {
      actionBtn.textContent = "Activate";
      actionBtn.addEventListener("click", () => {
        executeSet(studentId, classId, currentRevision, { status: "active", level: "adapted" });
      });
    }

    card.appendChild(actionBtn);
    container2.appendChild(card);
    return container2;
  };

  // Performs the accommodationsSet call and handles the response/conflict/error.
  const executeSet = (
    studentId: string,
    classId: string,
    expectedRevision: number,
    newValue: ReadingAccessibilityConfig,
  ): void => {
    studentDetailState = { kind: "saving" };
    draw();
    void setAccommodation!({
      studentId,
      classId,
      expectedRevision,
      newValue,
    })
      .then((res) => {
        if (!mount.isConnected) return;
        if (ssSelectedStudentId !== studentId) return;
        studentDetailState = {
          kind: "ready",
          configRevision: res.configRevision,
          config: res.readingAccessibility,
        };
        draw();
      })
      .catch((err: unknown) => {
        if (!mount.isConnected) return;
        if (ssSelectedStudentId !== studentId) return;
        const isConflict =
          err !== null &&
          typeof err === "object" &&
          "code" in err &&
          typeof (err as { code: unknown }).code === "string" &&
          (err as { code: string }).code.includes("conflict");
        if (isConflict) {
          void getAccommodation!({ studentId, classId })
            .then((fresh) => {
              if (!mount.isConnected) return;
              if (ssSelectedStudentId !== studentId) return;
              const freshConfig: ReadingAccessibilityConfig =
                fresh.configRevision === 0
                  ? { status: "inactive" }
                  : (fresh as { configRevision: number; readingAccessibility: ReadingAccessibilityConfig }).readingAccessibility;
              studentDetailState = {
                kind: "conflict",
                freshRevision: fresh.configRevision,
                freshConfig,
              };
              draw();
            })
            .catch(() => {
              if (!mount.isConnected) return;
              if (ssSelectedStudentId !== studentId) return;
              studentDetailState = { kind: "error" };
              draw();
            });
        } else {
          studentDetailState = { kind: "error" };
          draw();
        }
      });
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
