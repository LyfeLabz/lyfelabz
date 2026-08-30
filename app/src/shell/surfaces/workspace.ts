import type { Session } from "../../session/types";
import type { ListClasses } from "../../classes/listClasses";
import type { CreateClass } from "../../classes/createClass";
import type { ActivateClass } from "../../classes/activateClass";
import type { SyncRoster } from "../../classes/syncRoster";
import type { ImportFromClassroomDeps } from "../../classes/importFromClassroom";
import type {
  AssignmentsCallables,
  IntegrationsDeps,
} from "../../settings/integrations/types";
import type { WorkspaceSurfaceKey } from "../navigation";
import {
  renderCurriculumSurface,
  type CurriculumAssignmentDetailSeam,
} from "./curriculum";
import {
  renderClassesSurface,
  type ClassManagementIntent,
  type ClassWorkspaceReturn,
} from "./classes";
import { renderSettingsSurface } from "./settings";
import type { SnapshotPreview } from "./snapshot";
import type {
  AssignmentSummaryCallable,
  LessonSummaryCallable,
} from "../../assignments/summary/types";

// Typed contract for a Teacher Workspace surface.
//
// A workspace surface is a self-contained region rendered inside the
// single shell outlet. It reads only fields already present on the
// activeTeacher Session Object or data retrieved through injected
// fetchers wired at the client entry point. It performs no Firestore
// reads and opens no listeners directly. See
// SPRINT_6A_SPECIFICATION.md, SPRINT_6B_COMPLETION_REPORT.md, and
// SPRINT_6C_SPECIFICATION.md.

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

// Present Mode launch is an injected side effect. The shell tree must
// not import browser storage or navigation APIs directly (see
// shell.test.ts data-and-callable-posture invariant). The entry point
// wires the real implementation from src/presentMode/launchContext;
// unit tests inject a spy.
//
// Sprint 28.6D: Present Mode leaves the primary navigation (Blueprint
// §8), so no active workspace surface reads this seam. The type and the
// `onLaunchPresentMode` dep field are retained as dormant plumbing (not
// deleted) alongside the dormant `presentMode.ts` surface and
// `app/src/presentMode/*`, so a future genuine classroom-presentation
// tool can restore the destination without re-threading the wiring.
export type LaunchPresentMode = () => void;

export type WorkspaceDeps = {
  readonly listClasses: ListClasses;
  readonly onLaunchPresentMode: LaunchPresentMode;
  // Sprint 7B: development-safe static Snapshot preview payload. When
  // null (production default), the Snapshot surface renders the
  // certified no-data state. When present, the static representative
  // preview groupings are rendered. Preview data is
  // implementation-local, never persisted, and never sourced from
  // Firestore or Cloud Functions. See snapshot.ts.
  readonly snapshotPreview?: SnapshotPreview | null;
  // Sprint 8C: injected Teacher Integrations dependencies. When null the
  // Settings surface renders without an Integrations entry point and
  // Connected Services remains a preview category. See
  // LMS_EXPERIENCE.md §3, LMS_INTEGRATION_ARCHITECTURE.md, and PDR-020c.
  readonly integrations?: IntegrationsDeps | null;
  // Sprint 8D.1: injected authoritative assignment lifecycle callables.
  // When null the Assign Experience runs UI-only session state (test
  // harness path). The entry point wires the real seam.
  readonly assignments?: AssignmentsCallables | null;
  // Sprint 13B remediation: entry-point seam that lets the Curriculum
  // surface register published assignment metadata and open the
  // certified Assignment Detail surface via the entry-point opener.
  readonly assignmentDetail?: CurriculumAssignmentDetailSeam | null;
  // Sprint 15: certified summary callable consumed by the Curriculum
  // Active Assignments dashboard for per-card progress counts.
  readonly assignmentSummary?: AssignmentSummaryCallable | null;
  // Sprint 28.6E: certified lesson-level summary callable consumed by the
  // Curriculum lesson-card View Summary surface (cross-assignment
  // aggregate analytics). Null in harnesses that do not exercise it.
  readonly lessonSummary?: LessonSummaryCallable | null;
  // Sprint 20 internal beta: injected create-class callable seam.
  // Wired at the entry point; null in unit tests that do not exercise
  // creation. See src/classes/createClass.ts.
  readonly createClass?: CreateClass | null;
  // Sprint 24B Phase 2: injected dependencies for the primary Import
  // Class from Google Classroom flow on the Classes surface. Null in
  // tests that do not exercise the flow. Per
  // SPRINT_24B_ARCHITECTURAL_BLUEPRINT.md §4.2, this seam bundles the
  // certified callables already wired at the entry point.
  readonly importFromClassroom?: ImportFromClassroomDeps | null;
  // Sprint 24B Phase 2B.4: certified `classesActivate` seam consumed
  // by the imported-class setup form on the Classes surface. Null in
  // test harnesses that do not exercise activation.
  readonly activateClass?: ActivateClass | null;
  // Sprint 24B Phase 2B.8: certified `lmsClassesSyncRoster` seam
  // consumed by the LMS class workspace for the automatic initial sync
  // after activation and for the manual "Sync roster" affordance. Null
  // in test harnesses that do not exercise roster sync.
  readonly syncRoster?: SyncRoster | null;
  // Sprint 28.6C: bounded intra-shell navigation seam wired by the shell.
  // The Classes surface uses it to route the empty Assignments state to
  // Curriculum and to return to the Classes surface after Assignment Detail.
  // Absent in harnesses that do not exercise those paths.
  readonly navigateToSurface?: ((surface: WorkspaceSurfaceKey) => void) | null;
  // Sprint 28.6C: shell-owned class-workspace return-location seam. The
  // Classes surface reads it once on mount to re-land in a class's
  // Assignments section after returning from Assignment Detail, and writes it
  // just before opening Detail. Absent in harnesses that do not exercise it.
  readonly getClassesReturn?: (() => ClassWorkspaceReturn | null) | null;
  readonly setClassesReturn?: ((loc: ClassWorkspaceReturn | null) => void) | null;
  // Sprint 28.6F: the single class-management opener. Settings' "Classes &
  // Google Classroom" section calls it to open the shared Import / Create
  // workflow that lives on the Classes surface (one implementation, two
  // entry points). Absent in harnesses that do not exercise it.
  readonly openClassManagement?:
    | ((intent: ClassManagementIntent | null) => void)
    | null;
  // Sprint 28.6F: class-management intent one-shot, written by the opener and
  // consumed once by the next Classes mount to auto-open the chosen control.
  readonly getClassManagementIntent?:
    | (() => ClassManagementIntent | null)
    | null;
  readonly setClassManagementIntent?:
    | ((intent: ClassManagementIntent | null) => void)
    | null;
};

export type WorkspaceSurface = {
  readonly key: WorkspaceSurfaceKey;
  readonly render: (
    mount: HTMLElement,
    session: ActiveTeacher,
    deps: WorkspaceDeps,
  ) => void;
};

// Classes, Curriculum, and Settings are the active workspace surfaces
// after Sprint 28.6D. Present Mode was removed from the primary
// navigation (Blueprint §8); its surface module stays dormant in the
// tree but is no longer registered here, so it is unreachable through
// the workspace outlet. Every remaining canonical workspace-surface key
// renders a real teacher-facing destination.
export const WORKSPACE_SURFACES: Readonly<
  Record<WorkspaceSurfaceKey, WorkspaceSurface>
> = Object.freeze({
  curriculum: Object.freeze({
    key: "curriculum" as const,
    render: (
      mount: HTMLElement,
      session: ActiveTeacher,
      deps: WorkspaceDeps,
    ) =>
      renderCurriculumSurface(mount, session, {
        listClasses: deps.listClasses,
        integrations: deps.integrations ?? null,
        assignments: deps.assignments ?? null,
        assignmentDetail: deps.assignmentDetail ?? null,
        assignmentSummary: deps.assignmentSummary ?? null,
        lessonSummary: deps.lessonSummary ?? null,
      }),
  }),
  classes: Object.freeze({
    key: "classes" as const,
    render: (
      mount: HTMLElement,
      session: ActiveTeacher,
      deps: WorkspaceDeps,
    ) =>
      renderClassesSurface(mount, session, {
        listClasses: deps.listClasses,
        snapshotPreview: deps.snapshotPreview ?? null,
        createClass: deps.createClass ?? null,
        importFromClassroom: deps.importFromClassroom ?? null,
        activateClass: deps.activateClass ?? null,
        syncRoster: deps.syncRoster ?? null,
        // Sprint 28.6C: class-scoped Assignments section reuse.
        assignmentDetail: deps.assignmentDetail ?? null,
        assignmentSummary: deps.assignmentSummary ?? null,
        navigateToSurface: deps.navigateToSurface ?? null,
        getClassesReturn: deps.getClassesReturn ?? null,
        setClassesReturn: deps.setClassesReturn ?? null,
        // Sprint 28.6F: class-management intent one-shot (Settings entry point).
        getClassManagementIntent: deps.getClassManagementIntent ?? null,
        setClassManagementIntent: deps.setClassManagementIntent ?? null,
      }),
  }),
  settings: Object.freeze({
    key: "settings" as const,
    render: (
      mount: HTMLElement,
      session: ActiveTeacher,
      deps: WorkspaceDeps,
    ) =>
      renderSettingsSurface(mount, session, {
        integrations: deps.integrations ?? null,
        // Sprint 28.6F: the shared class-management opener. Settings' Import /
        // Create controls invoke this to open the SAME workflow the Classes
        // `+ Add a class` entry uses; there is no second import/create surface.
        openClassManagement: deps.openClassManagement ?? null,
        // Import needs both the Import-from-Classroom seam and the create-class
        // seam wired (mirrors the Classes import entry point); Create needs the
        // create-class seam. In production both are wired; null only in
        // harnesses that do not exercise class management.
        canImportClasses:
          (deps.importFromClassroom ?? null) !== null &&
          (deps.createClass ?? null) !== null,
        canCreateClasses: (deps.createClass ?? null) !== null,
        // Sprint 28.6H.3 (Task C4): Settings is the administrative home for
        // roster sync. It reads the teacher's class list (one query, same shape
        // Classes uses - no per-class fan-out) and exposes the certified
        // `lmsClassesSyncRoster` action for Google Classroom-linked classes.
        listClasses: deps.listClasses,
        syncRoster: deps.syncRoster ?? null,
      }),
  }),
});

// Mounts the single workspace outlet region and renders the surface
// registered for the given active key. The outlet is the sole content
// region inside the Teacher Workspace Shell; only one surface is
// mounted at a time.
export function mountWorkspaceOutlet(
  mount: HTMLElement,
  session: ActiveTeacher,
  activeKey: WorkspaceSurfaceKey,
  deps: WorkspaceDeps,
): HTMLElement {
  const doc = mount.ownerDocument;

  const outlet = doc.createElement("section");
  outlet.id = "app-main";
  outlet.className = "shell-main";
  outlet.setAttribute("aria-labelledby", "surface-headline");
  outlet.setAttribute("data-testid", "workspace-outlet");
  outlet.setAttribute("data-active-surface", activeKey);

  mount.appendChild(outlet);
  const surface = WORKSPACE_SURFACES[activeKey];
  surface.render(outlet, session, deps);
  return outlet;
}
