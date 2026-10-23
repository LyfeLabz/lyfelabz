import type { Session } from "../../session/types";
import type { TeacherUnitsSurfaceSeam } from "../../teacherUnits/unitsController";
import type { TeacherUnitGrade } from "../../teacherUnits/types";
import type { NestedPageHistorySeam, UnitsHistoryController } from "../navigationHistory";
import { readCurriculumGradeFilter } from "./curriculum";
import { renderTeacherUnitsPanel, teacherUnitsSurfaceEnabled } from "./teacherUnitsPanel";

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

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

export type MyUnitsSurfaceDeps = {
  readonly teacherUnits: TeacherUnitsSurfaceSeam | null;
  readonly unitsHistory?: NestedPageHistorySeam<UnitsHistoryController> | null;
  // One-shot from Settings > Units: open on the archived view.
  readonly consumeArchivedIntent?: (() => boolean) | null;
  // Milestone 2A one-shot from Curriculum's "View unit": open on this unit's
  // grade with the unit expanded and focused.
  readonly consumeOpenUnitIntent?: (() => MyUnitsOpenUnitIntent | null) | null;
};

export type MyUnitsOpenUnitIntent = {
  readonly unitId: string;
  readonly grade: TeacherUnitGrade;
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

export function _resetMyUnitsSurfaceStateForTest(): void {
  lastGrade = null;
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

  const history = deps.unitsHistory ?? null;
  // The panel's own heading is this surface's headline.
  mount.setAttribute("aria-labelledby", "units-heading");
  renderTeacherUnitsPanel(mount, controller, {
    onArchivedViewExit: () => history?.push({ kind: "shell-surface", surface: "units" }),
    focusUnitId: openUnit?.unitId ?? null,
  });
  history?.registerController({
    restoreArchived: (show) => {
      if (controller.getState().showArchived === show) return false;
      controller.setShowArchived(show);
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
