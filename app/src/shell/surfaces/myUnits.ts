import type { Session } from "../../session/types";
import type { TeacherUnitsSurfaceSeam } from "../../teacherUnits/unitsController";
import type { TeacherUnit, TeacherUnitGrade } from "../../teacherUnits/types";
import type { ListClasses } from "../../classes/listClasses";
import type { ClassSummary } from "../../classes/types";
import type { AssignmentsCallables, IntegrationsDeps } from "../../settings/integrations/types";
import type { LessonResultsCallable } from "../../assignments/summary/lessonResults";
import { getSurfaceableLessons } from "../../curriculum/curriculumManifest";
import type { NestedPageHistorySeam, UnitsHistoryController } from "../navigationHistory";
import {
  applyLessonAssignState,
  isLessonAssigned,
  openLessonAssignDialog,
  readCurriculumGradeFilter,
  type CurriculumAssignmentDetailSeam,
  type LessonResultsIntent,
} from "./curriculum";
import {
  renderTeacherUnitsPanel,
  teacherUnitsSurfaceEnabled,
  type UnitLessonActions,
  type UnitResultsResource,
} from "./teacherUnitsPanel";
import { renderUnitResultsSurface } from "./unitResults";

// Teacher Units UX Milestone 1: My Units as a top-level Teacher Workspace
// surface (docs/platform/TEACHER_UNITS.md "Teacher Units UX Milestone 1").
// It hosts the existing U2.2-U2.5 panel and controller unchanged in
// authority: every list, create, and membership change still goes through
// the controller and the `teacherUnits*` callables.
//
// The shell offers this surface only when it holds a Teacher Units seam and
// the release availability boundary is open (`teacherUnitsSurfaceEnabled`);
// a closed release has no seam, so it never mounts. The surface re-checks the
// same gate and renders nothing teacher-unit related when it is closed.
//
// Lifetime: a controller is created on every mount and disposed by the panel
// once the outlet is torn down, as before. Durable create attempts and the
// seam-owned unconfirmed-change registry survive leaving and returning.
//
// Automatic synchronization: entering My Units (from the nav, browser
// history, or a Curriculum unit-name pill) mounts this surface, and the new
// controller's first act is one authoritative list read through the
// existing `teacherUnitsList` contract. Reselecting My Units while it is
// showing does not remount (shell.ts `navigateTo`), and panel rerenders
// never read, so there is no redundant read and no polling. That read is
// evidence like any other: it never cancels, resends, or overwrites an
// in-flight or unconfirmed change (unitsController.ts evidence ordering).

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

export type MyUnitsSurfaceDeps = {
  readonly teacherUnits: TeacherUnitsSurfaceSeam | null;
  readonly unitsHistory?: NestedPageHistorySeam<UnitsHistoryController> | null;
  // One-shot from Settings > Units: open on the archived view.
  readonly consumeArchivedIntent?: (() => boolean) | null;
  // Milestone 2A one-shot from Curriculum's "View unit": open on this unit's
  // grade with the unit expanded and focused.
  readonly consumeOpenUnitIntent?: (() => MyUnitsOpenUnitIntent | null) | null;
  // Lesson rows mirror Curriculum: the shared assignment state, the EXISTING
  // Curriculum assignment dialog (opened over My Units), and the lesson's
  // existing Results page (in Curriculum). Absent seams degrade exactly as
  // Curriculum does.
  readonly listClasses?: ListClasses | null;
  readonly assignments?: AssignmentsCallables | null;
  readonly integrations?: IntegrationsDeps | null;
  readonly assignmentDetail?: CurriculumAssignmentDetailSeam | null;
  readonly lessonSummary?: LessonResultsCallable | null;
  readonly openLessonResults?: ((intent: LessonResultsIntent) => void) | null;
};

export type MyUnitsOpenUnitIntent = {
  readonly unitId: string;
  readonly grade: TeacherUnitGrade;
  // Reopen this unit's Unit Results (returning from a lesson's Results that
  // was opened from Unit Results).
  readonly view?: "results";
};

// My Units opens on the active Curriculum grade filter. "All" has no single
// grade; the teacher-level saved default grade was removed in Sprint 28.6F
// (teacherPreferences/types.ts), so the fallback is the first grade.
export function initialTeacherUnitsGrade(filter: string): TeacherUnitGrade {
  return filter === "6" || filter === "7" || filter === "8" ? filter : "6";
}

// The grade last chosen in My Units this page session, per teacher, so
// leaving and returning keeps it. In memory only.
let lastGrade: { readonly uid: string; readonly grade: TeacherUnitGrade } | null = null;
// The units left open in My Units this page session, per teacher, so
// returning reopens them. In memory only; display state, never evidence.
let lastExpanded: { readonly uid: string; readonly ids: Set<string> } | null = null;
// The Unit Results class filter last chosen per unit this page session, per
// teacher, so Back/Forward and returning from a lesson's Results keep it.
let lastClassFilter: { readonly uid: string; readonly byUnit: Map<string, string> } | null = null;

export function _resetMyUnitsSurfaceStateForTest(): void {
  lastGrade = null;
  lastExpanded = null;
  lastClassFilter = null;
}

export function renderMyUnitsSurface(
  mount: HTMLElement,
  session: ActiveTeacher,
  deps: MyUnitsSurfaceDeps,
): void {
  const seam = deps.teacherUnits;
  if (seam === null || !teacherUnitsSurfaceEnabled(seam)) return;

  const openUnit = deps.consumeOpenUnitIntent?.() ?? null;
  const initialGrade =
    openUnit !== null
      ? openUnit.grade
      : lastGrade !== null && lastGrade.uid === session.uid
        ? lastGrade.grade
        : initialTeacherUnitsGrade(readCurriculumGradeFilter(session.uid));
  const controller = seam.createController({
    uid: session.uid,
    schoolId: session.schoolId,
    initialGrade,
  });
  if (deps.consumeArchivedIntent?.() === true) controller.setShowArchived(true);
  controller.subscribe(() => {
    const grade = controller.getState().grade;
    if (lastGrade?.uid !== session.uid || lastGrade.grade !== grade) {
      lastGrade = Object.freeze({ uid: session.uid, grade });
    }
  });

  if (lastExpanded?.uid !== session.uid) lastExpanded = { uid: session.uid, ids: new Set() };
  const expanded = lastExpanded.ids;

  const history = deps.unitsHistory ?? null;
  const doc = mount.ownerDocument;
  const assignmentDetail = deps.assignmentDetail ?? null;
  const lessonSummary = deps.lessonSummary ?? null;
  const openLessonResults = deps.openLessonResults ?? null;
  const listClasses = deps.listClasses ?? null;

  // Outcome line for an assignment made from My Units (the dialog's own
  // confirmation copy), in a polite region beneath the page heading.
  const outcome = doc.createElement("p");
  outcome.className = "shell-curriculum-success";
  outcome.setAttribute("data-testid", "units-assign-status");
  outcome.setAttribute("role", "status");
  outcome.setAttribute("aria-live", "polite");
  outcome.hidden = true;

  const lessonsBySlug = new Map(getSurfaceableLessons().map((l) => [l.slug, l]));
  const resultsAvailable = lessonSummary !== null && openLessonResults !== null;
  const lessonListeners = new Set<() => void>();
  const lessonActions: UnitLessonActions | null =
    listClasses === null
      ? null
      : {
          supports: (slug) => lessonsBySlug.has(slug),
          apply: (control, slug) => {
            const lesson = lessonsBySlug.get(slug);
            if (lesson === undefined) return;
            applyLessonAssignState(
              control,
              lesson,
              isLessonAssigned(session.uid, assignmentDetail, slug),
              resultsAvailable,
            );
          },
          activate: (control, slug, unit) => {
            const lesson = lessonsBySlug.get(slug);
            if (lesson === undefined) return;
            if (control.getAttribute("data-action") === "results" && openLessonResults !== null) {
              openLessonResults({
                lessonSlug: slug,
                returnTo: { kind: "units", unit: { unitId: unit.unitId, grade: unit.grade } },
                restore: false,
              });
              return;
            }
            openLessonAssignDialog({
              doc,
              lesson,
              session,
              listClasses,
              integrations: deps.integrations ?? null,
              assignments: deps.assignments ?? null,
              assignmentDetail,
              onConfirm: (summary) => {
                outcome.textContent = summary;
                outcome.hidden = false;
                outcome.classList.add("shell-curriculum-success-visible");
              },
              // Only confirmed saves re-derive Assign vs Results.
              onLifecycleComplete: (assignmentIds) => {
                if (assignmentIds.length === 0) return;
                for (const l of Array.from(lessonListeners)) l();
              },
            });
          },
          subscribe: (listener) => {
            lessonListeners.add(listener);
            return () => lessonListeners.delete(listener);
          },
        };

  // Unit Results: shown in place of the unit list (which stays mounted and
  // keeps its state); Back restores the list and focuses the unit's pill.
  let classRows: ReadonlyArray<ClassSummary> = [];
  const classesReady: Promise<unknown> | null =
    listClasses === null
      ? null
      : listClasses(session.uid).then(
          (rows) => {
            classRows = rows;
          },
          () => undefined,
        );
  const describeClass = (classId: string): { name: string; order: number } | null => {
    const index = classRows.findIndex((c) => c.id === classId);
    const row = classRows[index];
    if (row !== undefined) return { name: row.title, order: index };
    try {
      const entry = (assignmentDetail?.list?.() ?? []).find(
        (e) => e.classId === classId && typeof e.className === "string" && e.className.length > 0,
      );
      if (entry !== undefined) return { name: entry.className, order: Number.MAX_SAFE_INTEGER };
    } catch {
      // ignored
    }
    return null;
  };
  const resultsHost = doc.createElement("div");
  resultsHost.className = "shell-unit-results-host";
  resultsHost.setAttribute("data-testid", "unit-results-host");
  const batch = lessonSummary?.batch ?? null;
  if (lastClassFilter?.uid !== session.uid) lastClassFilter = { uid: session.uid, byUnit: new Map() };
  const classFilters = lastClassFilter.byUnit;
  // Unit Results is a real drill-down with its own history entry
  // (`shell-unit-results`); a restore (Back/Forward, returning from a
  // lesson's Results) shows it without pushing another.
  let restoring = false;
  let openResultsUnitId: string | null = null;
  const panelRootOf = (): HTMLElement | null => mount.querySelector<HTMLElement>("[data-testid=units-panel]");
  const closeUnitResults = (): boolean => {
    if (openResultsUnitId === null) return false;
    openResultsUnitId = null;
    resultsHost.textContent = "";
    const panelRoot = panelRootOf();
    if (panelRoot !== null) panelRoot.hidden = false;
    return true;
  };
  const openUnitResults =
    batch === null
      ? null
      : (unit: TeacherUnit, resources: ReadonlyArray<UnitResultsResource>): void => {
          const panelRoot = mount.querySelector<HTMLElement>("[data-testid=units-panel]");
          const lessons: Array<{ slug: string; title: string }> = [];
          let otherResources = 0;
          for (const entry of resources) {
            const lesson = entry.status === "available" ? lessonsBySlug.get(entry.id) : undefined;
            if (entry.status === "available" && entry.type === "lesson" && lesson !== undefined) {
              lessons.push({ slug: lesson.slug, title: lesson.title });
            } else {
              otherResources += 1;
            }
          }
          if (panelRoot !== null) panelRoot.hidden = true;
          if (!restoring && openResultsUnitId !== unit.unitId) {
            history?.push({ kind: "shell-unit-results", surface: "units", unitId: unit.unitId, grade: unit.grade });
          }
          openResultsUnitId = unit.unitId;
          const savedClass = classFilters.get(unit.unitId);
          renderUnitResultsSurface(resultsHost, {
            doc,
            unit,
            lessons,
            otherResources,
            batch,
            classes: { ...(classesReady !== null ? { ready: classesReady } : {}), describe: describeClass },
            ...(savedClass !== undefined ? { initialClassId: savedClass } : {}),
            onClassChange: (classId) => {
              classFilters.set(unit.unitId, classId);
            },
            onLessonResults: (slug) => {
              openLessonResults?.({
                lessonSlug: slug,
                returnTo: {
                  kind: "units",
                  unit: { unitId: unit.unitId, grade: unit.grade, view: "results" },
                },
                restore: false,
              });
            },
            // In-app Back REPLACES the Unit Results entry with My Units (the
            // certified replace-never-back() pattern).
            onBack: () => {
              closeUnitResults();
              history?.replace({ kind: "shell-surface", surface: "units" });
              const pill = mount.querySelector<HTMLElement>(`[data-testid="units-results-${unit.unitId}"]`);
              try {
                pill?.focus({ preventScroll: true });
              } catch {
                // ignored
              }
            },
          });
        };

  // The panel's own heading is this surface's headline.
  mount.setAttribute("aria-labelledby", "units-heading");
  renderTeacherUnitsPanel(mount, controller, {
    lessonActions,
    onUnitResults: openUnitResults,
    onArchivedViewExit: () => history?.push({ kind: "shell-surface", surface: "units" }),
    focusUnitId: openUnit?.unitId ?? null,
    expandedUnitIds: new Set(expanded),
    onExpandedChange: (unitId, open) => {
      if (open) expanded.add(unitId);
      else expanded.delete(unitId);
    },
  });
  mount.appendChild(resultsHost);
  mount.querySelector("#units-heading")?.insertAdjacentElement("afterend", outcome);

  // Restoring a Unit Results view (Back/Forward, a deep link, or returning
  // from a lesson's Results): shown once the authoritative list for the
  // unit's grade confirms the unit, through the unit's own Unit Results pill
  // so the panel resolves its current resources exactly as for a click. A
  // unit no longer listed fails closed onto the units.
  let pendingResults: string | null = null;
  const tryOpenPending = (): void => {
    if (pendingResults === null) return;
    const state = controller.getState();
    if (state.list.kind !== "ready") return;
    const unitId = pendingResults;
    pendingResults = null;
    const pill = mount.querySelector<HTMLButtonElement>(`[data-testid="units-results-${unitId}"]`);
    if (pill === null) return;
    restoring = true;
    try {
      pill.click();
    } finally {
      restoring = false;
    }
  };
  controller.subscribe(tryOpenPending);
  if (openUnit?.view === "results" && openUnitResults !== null) {
    pendingResults = openUnit.unitId;
    tryOpenPending();
  }

  history?.registerController({
    restoreArchived: (show) => {
      const closed = !show && closeUnitResults();
      if (controller.getState().showArchived === show) return closed;
      controller.setShowArchived(show);
      return true;
    },
    restoreTop: () => {
      const closed = closeUnitResults();
      if (!controller.getState().showArchived) return closed;
      controller.setShowArchived(false);
      return true;
    },
    restoreUnitResults: (unitId, grade) => {
      if (openUnitResults === null) return false;
      if (openResultsUnitId === unitId) return true;
      closeUnitResults();
      pendingResults = unitId;
      if (controller.getState().grade !== grade) controller.setGrade(grade);
      else tryOpenPending();
      return true;
    },
  });

  // Page-entry focus, like every other surface headline. U2.5 keeps the
  // heading's outline on plain :focus (focus parked there after a card leaves
  // must stay visible); only this entry focus follows :focus-visible.
  const heading = mount.querySelector<HTMLElement>("#units-heading");
  if (heading !== null) {
    heading.setAttribute("data-entry-focus", "");
    heading.addEventListener("blur", () => heading.removeAttribute("data-entry-focus"), { once: true });
    try {
      heading.focus({ preventScroll: true });
    } catch {
      // ignored
    }
  }
}
