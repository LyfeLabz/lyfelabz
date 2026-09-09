/**
 * @jest-environment jsdom
 *
 * Sprint 29G.5P regression guard for the PRODUCTION render path.
 *
 * The Students-tab roster must work when driven through the real workspace
 * delivery layer - `mountWorkspaceOutlet` -> `WORKSPACE_SURFACES.classes.render`
 * -> `renderClassesSurface` - not only when `renderClassesSurface` is called
 * directly. A prior gap in `workspace.ts` dropped `loadRoster` here, so the
 * Students tab silently fell back to "No students yet." even though the surface
 * and callable were correct. This test exercises `mountWorkspaceOutlet` with
 * `loadRoster` in `WorkspaceDeps` and fails if that dependency is ever dropped
 * again on the way to the Classes surface.
 */
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import type { WorkspaceDeps } from "./workspace";
import { mountWorkspaceOutlet } from "./workspace";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const teacher: Extract<Session, { kind: "activeTeacher" }> = Object.freeze({
  kind: "activeTeacher",
  uid: "teacher-1",
  schoolId: "school-abc",
  displayName: "Ada Lovelace",
});

const CLASS_ID = "roster-workspace-class";
const activeSummary: ClassSummary = Object.freeze({
  id: CLASS_ID,
  title: "Roster Science",
  status: "active" as const,
  grade: "6",
  block: "E",
  isLmsLinked: true,
});

const baseDeps = (
  loadRoster: WorkspaceDeps["loadRoster"],
): WorkspaceDeps => {
  const listClasses: ListClasses = async () =>
    Object.freeze<ClassSummary[]>([activeSummary]);
  return {
    listClasses,
    onLaunchPresentMode: () => undefined,
    loadRoster,
  };
};

const openStudentsTabViaOutlet = async (
  mount: HTMLElement,
  loadRoster: WorkspaceDeps["loadRoster"],
): Promise<void> => {
  mountWorkspaceOutlet(mount, teacher, "classes", baseDeps(loadRoster));
  await flush();
  await flush();
  mount
    .querySelector<HTMLButtonElement>(`[data-testid=class-card-${CLASS_ID}]`)!
    .click();
  await flush();
  mount
    .querySelector<HTMLButtonElement>("[data-testid=class-nav-roster]")!
    .click();
  await flush();
};

describe("Sprint 29G.5P: Students roster reaches the Classes surface through the workspace outlet", () => {
  test("loadRoster supplied via WorkspaceDeps renders the active roster (not the placeholder)", async () => {
    const mount = mkMount();
    const loadRoster = jest.fn(async (input: { classId: string }) => ({
      classId: input.classId,
      students: [
        { studentId: "s-alpha", studentDisplayName: "Alpha Student" },
        { studentId: "s-bravo", studentDisplayName: "Bravo Student" },
      ],
    }));

    await openStudentsTabViaOutlet(mount, loadRoster);
    await flush();

    // The dependency reached the Classes surface and was invoked with the
    // opened class id (this is what regressed when workspace.ts dropped it).
    expect(loadRoster).toHaveBeenCalledTimes(1);
    expect(loadRoster).toHaveBeenCalledWith({ classId: CLASS_ID });

    // The active roster renders, NOT the "No students yet." placeholder.
    expect(mount.querySelector("[data-testid=roster-list]")).not.toBeNull();
    const names = Array.from(
      mount.querySelectorAll<HTMLElement>(
        "[data-testid=roster-student] .shell-roster-student-name",
      ),
    ).map((n) => n.textContent);
    expect(names).toEqual(["Alpha Student", "Bravo Student"]);
    expect(mount.querySelector("[data-testid=roster-empty]")).toBeNull();
  });

  test("without loadRoster wired, the outlet path shows the genuine empty state", async () => {
    const mount = mkMount();
    await openStudentsTabViaOutlet(mount, null);
    await flush();
    expect(mount.querySelector("[data-testid=roster-empty]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=roster-list]")).toBeNull();
  });
});
