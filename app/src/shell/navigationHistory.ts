import type { WorkspaceSurfaceKey } from "./navigation";

// Browser Back/Forward support. The smallest serializable history-state
// shape needed to restore meaningful teacher-shell navigation. Never
// carries DOM nodes, Session objects, callables, or display text - only
// stable identifiers already used elsewhere in the shell
// (WorkspaceSurfaceKey, classId, studentId) - so a value delivered
// through `popstate.state` can always be independently re-validated
// before anything acts on it. `event.state` reflects whatever an
// earlier `pushState`/`replaceState` call in this origin supplied, but
// is still treated as untrusted input here: a stale, foreign, or
// hand-crafted entry must fail closed, never throw or restore an
// unauthorized surface.
//
// Teacher navigation graph covered (every nested page a teacher reaches by
// a meaningful drill-down, not ephemeral UI like dialogs or disclosures):
//   Classes list                      shell-surface(classes)
//   class workspace, per section      shell-classes-workspace(classId, section)
//   Assignment Summary (from a class) shell-assignment-detail(classId, assignmentId)
//   Student Detail (from Students)    shell-student-detail(classId, studentId)
//   Curriculum                        shell-surface(curriculum)
//   Lesson Summary (View summary)     shell-lesson-summary(lessonSlug)
//   Curriculum resource-type tab      shell-curriculum-tab(tab)
//   My Units (gated)                  shell-surface(units)
//   My Units archived view (gated)    shell-units-archived
//   Unit Results (gated)              shell-unit-results(unitId, grade)
//   Settings                          shell-surface(settings)
//   Settings > Manage connection      shell-settings-integrations
export type ClassWorkspaceSection = "assignments" | "roster" | "setup";

// The non-Lesson Curriculum tabs, in display order. Lessons is the ordinary
// Curriculum landing (`shell-surface(curriculum)`, `#curriculum`), so it has
// no tab entry of its own. Which of these tabs actually render is decided by
// the resource-type policy (see curriculumResourceTabs.ts); this list is only
// the closed set a history entry may name.
export const CURRICULUM_RESOURCE_TABS = [
  "investigations",
  "simulations",
  "extensions",
  "challenges",
] as const;

export type CurriculumResourceTab = (typeof CURRICULUM_RESOURCE_TABS)[number];

export type CurriculumTab = "lessons" | CurriculumResourceTab;

export function isCurriculumResourceTab(
  value: unknown,
): value is CurriculumResourceTab {
  return (
    typeof value === "string" &&
    (CURRICULUM_RESOURCE_TABS as ReadonlyArray<string>).includes(value)
  );
}

export type ShellHistoryState =
  | { readonly kind: "shell-surface"; readonly surface: WorkspaceSurfaceKey }
  | {
      readonly kind: "shell-classes-workspace";
      readonly surface: "classes";
      readonly classId: string;
      readonly section: ClassWorkspaceSection;
    }
  | {
      readonly kind: "shell-student-detail";
      readonly surface: "classes";
      readonly classId: string;
      readonly studentId: string;
    }
  | {
      readonly kind: "shell-assignment-detail";
      readonly surface: "classes";
      readonly classId: string;
      readonly assignmentId: string;
    }
  | {
      readonly kind: "shell-lesson-summary";
      readonly surface: "curriculum";
      readonly lessonSlug: string;
      // Results opened from My Units (a unit row, or Unit Results): where its
      // in-app Back returns, kept across Back/Forward. Absent: Curriculum.
      readonly from?: UnitsReturnState;
    }
  | {
      readonly kind: "shell-curriculum-tab";
      readonly surface: "curriculum";
      readonly tab: CurriculumResourceTab;
    }
  // Legacy (U2.2): My Units was a Curriculum tab. Entries created before
  // My Units became a top-level surface still parse; the shell restores
  // them as My Units (or leaves Curriculum showing when it is not enabled).
  | { readonly kind: "shell-curriculum-units"; readonly surface: "curriculum" }
  | { readonly kind: "shell-units-archived"; readonly surface: "units" }
  | {
      readonly kind: "shell-unit-results";
      readonly surface: "units";
      readonly unitId: string;
      readonly grade: UnitsHistoryGrade;
    }
  | { readonly kind: "shell-settings-integrations"; readonly surface: "settings" };

// Teacher unit grades, as history may name them (validated on parse).
export type UnitsHistoryGrade = "6" | "7" | "8";
const UNIT_GRADES: ReadonlySet<string> = new Set(["6", "7", "8"]);
// Opaque server unit ids (20 characters, [A-Za-z0-9]); anything else fails closed.
const UNIT_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/;

export type UnitsReturnState = {
  readonly unitId: string;
  readonly grade: UnitsHistoryGrade;
  readonly view?: "results";
};

function parseUnitsReturn(value: unknown): UnitsReturnState | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.unitId !== "string" || !UNIT_ID_PATTERN.test(v.unitId)) return null;
  if (typeof v.grade !== "string" || !UNIT_GRADES.has(v.grade)) return null;
  if (v.view !== undefined && v.view !== "results") return null;
  return {
    unitId: v.unitId,
    grade: v.grade as UnitsHistoryGrade,
    ...(v.view === "results" ? { view: "results" as const } : {}),
  };
}

const CLASS_WORKSPACE_SECTIONS: ReadonlySet<string> = new Set([
  "assignments",
  "roster",
  "setup",
]);

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

const WORKSPACE_SURFACE_KEYS: ReadonlySet<string> = new Set([
  "classes",
  "curriculum",
  "units",
  "settings",
]);

export function isWorkspaceSurfaceKey(
  value: unknown,
): value is WorkspaceSurfaceKey {
  return typeof value === "string" && WORKSPACE_SURFACE_KEYS.has(value);
}

// Strict, defensive parse of an arbitrary `popstate.state` value. This is
// the single choke point new history-state shapes must pass through, so
// a malformed, foreign, or pre-feature history entry is always ignored
// rather than guessed at.
export function parseShellHistoryState(
  value: unknown,
): ShellHistoryState | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.kind === "shell-surface" && isWorkspaceSurfaceKey(v.surface)) {
    return { kind: "shell-surface", surface: v.surface };
  }
  if (
    v.kind === "shell-classes-workspace" &&
    v.surface === "classes" &&
    typeof v.classId === "string" &&
    v.classId.length > 0
  ) {
    // An entry without `section` predates per-section history, when only
    // the Students (roster) section was tracked; it keeps that meaning.
    if (v.section !== undefined && !CLASS_WORKSPACE_SECTIONS.has(String(v.section))) {
      return null;
    }
    const section = (v.section ?? "roster") as ClassWorkspaceSection;
    return { kind: "shell-classes-workspace", surface: "classes", classId: v.classId, section };
  }
  if (
    v.kind === "shell-assignment-detail" &&
    v.surface === "classes" &&
    isNonEmptyString(v.classId) &&
    isNonEmptyString(v.assignmentId)
  ) {
    return {
      kind: "shell-assignment-detail",
      surface: "classes",
      classId: v.classId,
      assignmentId: v.assignmentId,
    };
  }
  if (
    v.kind === "shell-lesson-summary" &&
    v.surface === "curriculum" &&
    isNonEmptyString(v.lessonSlug)
  ) {
    // A malformed origin is dropped (Results then returns to Curriculum),
    // never guessed at.
    const from = v.from === undefined ? null : parseUnitsReturn(v.from);
    return {
      kind: "shell-lesson-summary",
      surface: "curriculum",
      lessonSlug: v.lessonSlug,
      ...(from !== null ? { from } : {}),
    };
  }
  if (
    v.kind === "shell-curriculum-tab" &&
    v.surface === "curriculum" &&
    isCurriculumResourceTab(v.tab)
  ) {
    return { kind: "shell-curriculum-tab", surface: "curriculum", tab: v.tab };
  }
  if (v.kind === "shell-curriculum-units" && v.surface === "curriculum") {
    return { kind: "shell-curriculum-units", surface: "curriculum" };
  }
  if (v.kind === "shell-units-archived" && v.surface === "units") {
    return { kind: "shell-units-archived", surface: "units" };
  }
  if (v.kind === "shell-unit-results" && v.surface === "units") {
    const target = parseUnitsReturn({ unitId: v.unitId, grade: v.grade });
    return target === null
      ? null
      : { kind: "shell-unit-results", surface: "units", unitId: target.unitId, grade: target.grade };
  }
  if (v.kind === "shell-settings-integrations" && v.surface === "settings") {
    return { kind: "shell-settings-integrations", surface: "settings" };
  }
  if (
    v.kind === "shell-student-detail" &&
    v.surface === "classes" &&
    typeof v.classId === "string" &&
    v.classId.length > 0 &&
    typeof v.studentId === "string" &&
    v.studentId.length > 0
  ) {
    return {
      kind: "shell-student-detail",
      surface: "classes",
      classId: v.classId,
      studentId: v.studentId,
    };
  }
  return null;
}

// Minimal URL representation. Firebase Hosting rewrites `/app/teacher`
// (and the other session-kind paths router.ts writes) to
// `/app/index.html`; a hash fragment is never sent to the server, so
// appending one here needs no new rewrite rule and cannot 404 on
// refresh or direct entry. Only stable opaque identifiers appear here -
// never a student's name or other display text.
export function hashForSurface(surface: WorkspaceSurfaceKey): string {
  return `#${surface}`;
}

export function hashForClassesWorkspace(
  classId: string,
  section: ClassWorkspaceSection = "roster",
): string {
  return `#classes/${section}/${encodeURIComponent(classId)}`;
}

export function hashForStudentDetail(
  classId: string,
  studentId: string,
): string {
  return `#classes/student/${encodeURIComponent(classId)}/${encodeURIComponent(studentId)}`;
}

// The single URL mapping for every history state, so each push/replace in
// the shell derives its hash the same way.
export function hashForState(state: ShellHistoryState): string {
  switch (state.kind) {
    case "shell-surface":
      return hashForSurface(state.surface);
    case "shell-classes-workspace":
      return hashForClassesWorkspace(state.classId, state.section);
    case "shell-student-detail":
      return hashForStudentDetail(state.classId, state.studentId);
    case "shell-assignment-detail":
      return `#classes/assignment/${encodeURIComponent(state.classId)}/${encodeURIComponent(state.assignmentId)}`;
    case "shell-lesson-summary":
      return `#curriculum/summary/${encodeURIComponent(state.lessonSlug)}`;
    case "shell-curriculum-tab":
      return `#curriculum/${state.tab}`;
    case "shell-curriculum-units":
      return "#curriculum/units";
    case "shell-units-archived":
      return "#units/archived";
    case "shell-unit-results":
      return `#units/results/${state.grade}/${encodeURIComponent(state.unitId)}`;
    case "shell-settings-integrations":
      return "#settings/integrations";
  }
}

// Teacher Units UX Milestone 1A: fresh-load deep links. The strict inverse of
// `hashForState` for the entries a fresh load can restore synchronously; a
// class-workspace hash (whose class list loads asynchronously) restores only
// its surface, Classes. Unknown or malformed hashes return null (the default
// landing). The result is only a request: the shell still validates it
// (for example My Units against its availability gate) before using it.
export function parseShellHash(hash: string): ShellHistoryState | null {
  const clean = hash.startsWith("#") ? hash.slice(1) : hash;
  if (isWorkspaceSurfaceKey(clean)) return { kind: "shell-surface", surface: clean };
  if (clean === "units/archived") return { kind: "shell-units-archived", surface: "units" };
  if (clean.startsWith("units/results/")) {
    const [grade, unitId] = clean.slice("units/results/".length).split("/");
    const target = parseUnitsReturn({ unitId, grade });
    return target === null
      ? null
      : { kind: "shell-unit-results", surface: "units", unitId: target.unitId, grade: target.grade };
  }
  if (clean === "curriculum/units") return { kind: "shell-curriculum-units", surface: "curriculum" };
  if (clean === "settings/integrations") return { kind: "shell-settings-integrations", surface: "settings" };
  if (clean.startsWith("classes/")) return { kind: "shell-surface", surface: "classes" };
  if (clean.startsWith("curriculum/summary/")) {
    let slug: string;
    try {
      slug = decodeURIComponent(clean.slice("curriculum/summary/".length));
    } catch {
      return null;
    }
    return slug.length > 0 && !slug.includes("/")
      ? { kind: "shell-lesson-summary", surface: "curriculum", lessonSlug: slug }
      : null;
  }
  if (clean.startsWith("curriculum/")) {
    const tab = clean.slice("curriculum/".length);
    return isCurriculumResourceTab(tab) ? { kind: "shell-curriculum-tab", surface: "curriculum", tab } : null;
  }
  return null;
}

export function parseSurfaceFromHash(hash: string): WorkspaceSurfaceKey | null {
  const clean = hash.startsWith("#") ? hash.slice(1) : hash;
  return isWorkspaceSurfaceKey(clean) ? clean : null;
}

export function urlWithHash(pathname: string, hash: string): string {
  return `${pathname}${hash}`;
}

// Seam a surface with its own nested page (Curriculum's Lesson Summary,
// Settings' Manage connection) uses to keep browser history in sync without
// touching `window.history` itself (only shell.ts does): `push` on a real
// drill-down, `replace` when its own in-app Back returns one level up (never
// `history.back()`), and a restore controller the shell's popstate handler
// calls back into, registered synchronously on every mount.
export type NestedPageHistorySeam<Controller> = {
  readonly push: (state: ShellHistoryState) => void;
  readonly replace: (state: ShellHistoryState) => void;
  readonly registerController: (controller: Controller) => void;
};

export type CurriculumHistoryController = {
  // Re-open Lesson Summary for a surfaced lesson; false (no change) for an
  // unknown slug or when summaries are not wired. `from` restores a My Units
  // origin (its "Back to My Units").
  readonly restoreLessonSummary: (lessonSlug: string, from?: UnitsReturnState) => boolean;
  // Return to the Curriculum landing: close any open Lesson Summary and
  // select the Lessons tab. True when anything changed.
  readonly restoreTop: () => boolean;
  // Select a non-Lesson resource tab (closing any open Lesson Summary);
  // false (no change) when that tab is not surfaced.
  readonly restoreTab: (tab: CurriculumResourceTab) => boolean;
};

export type UnitsHistoryController = {
  // Show the archived units view (true) or the active units (false). True
  // when anything changed.
  readonly restoreArchived: (show: boolean) => boolean;
  // Close Unit Results and the archived view: the plain active units. True
  // when anything changed.
  readonly restoreTop: () => boolean;
  // Show this unit's Unit Results (without a new history entry). False when
  // the unit is not in the current list (the units stay showing).
  readonly restoreUnitResults: (unitId: string, grade: UnitsHistoryGrade) => boolean;
};

export type SettingsHistoryController = {
  // Open the Manage connection page; false when it is not available.
  readonly restoreIntegrations: () => boolean;
  // Return to the Settings root.
  readonly restoreRoot: () => void;
};
