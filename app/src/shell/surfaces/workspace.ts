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
import { renderClassesSurface } from "./classes";
import { renderPresentModeSurface } from "./presentMode";
import { renderSettingsSurface } from "./settings";
import type { SnapshotPreview } from "./snapshot";
import type { AssignmentSummaryCallable } from "../../assignments/summary/types";
import type {
  TeacherDefaultGrade,
  UpdateTeacherDefaultGrade,
} from "../../teacherPreferences/types";

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
  // Sprint 24B Phase 2B.2: resolved teacher `defaultGrade` preference
  // (null when no preference or read failure). Consumed by the Classes
  // surface to prefill Manual Create, and by the Settings surface to
  // display the current value.
  readonly defaultGrade?: TeacherDefaultGrade | null;
  // Sprint 24B Phase 2B.2: best-effort preference-update seam. Consumed
  // by Classes (post-create) and by Settings (explicit set / clear).
  readonly updateDefaultGrade?: UpdateTeacherDefaultGrade | null;
  // Sprint 24B Phase 2B.4: certified `classesActivate` seam consumed
  // by the imported-class setup form on the Classes surface. Null in
  // test harnesses that do not exercise activation.
  readonly activateClass?: ActivateClass | null;
  // Sprint 24B Phase 2B.8: certified `lmsClassesSyncRoster` seam
  // consumed by the LMS class workspace for the automatic initial sync
  // after activation and for the manual "Sync roster" affordance. Null
  // in test harnesses that do not exercise roster sync.
  readonly syncRoster?: SyncRoster | null;
};

export type WorkspaceSurface = {
  readonly key: WorkspaceSurfaceKey;
  readonly render: (
    mount: HTMLElement,
    session: ActiveTeacher,
    deps: WorkspaceDeps,
  ) => void;
};

// Curriculum, Classes, Present Mode, and Settings are the active
// workspace surfaces after Sprint 6H. Every canonical workspace-surface
// key now renders a real teacher-facing destination.
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
        defaultGrade: deps.defaultGrade ?? null,
        updateDefaultGrade: deps.updateDefaultGrade ?? null,
        activateClass: deps.activateClass ?? null,
        syncRoster: deps.syncRoster ?? null,
      }),
  }),
  "present-mode": Object.freeze({
    key: "present-mode" as const,
    render: (
      mount: HTMLElement,
      session: ActiveTeacher,
      deps: WorkspaceDeps,
    ) =>
      renderPresentModeSurface(mount, session, {
        onLaunchPresentMode: deps.onLaunchPresentMode,
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
        defaultGrade: deps.defaultGrade ?? null,
        updateDefaultGrade: deps.updateDefaultGrade ?? null,
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
