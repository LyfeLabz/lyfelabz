/**
 * @jest-environment jsdom
 *
 * Sprint 28.5D (D2A): the shell-preserving Assignment Detail mount.
 *
 * Before 28.5D the entry-point opener cleared `#app-root` and rendered
 * Assignment Detail as a shell-less, centered page, destroying the teacher
 * header and navigation. The fix has the persistent Teacher Workspace shell
 * register a bounded outlet controller with the opener so Detail renders into
 * the shell's own content outlet (`.shell-outlet-host`) while the header,
 * navigation, and footer stay mounted and Curriculum remains the active
 * navigation context.
 *
 * These tests exercise the real shell/outlet seam (not the detail renderer,
 * whose container independence is already covered): they prove the shell is
 * not destroyed when Detail opens, that Detail lands in the outlet, and that
 * global navigation cleanly leaves Detail.
 */
import { mountTeacherShell, type ShellDeps } from "./shell";
import type {
  CurriculumAssignmentDetailSeam,
  TeacherShellOutletController,
} from "./surfaces/curriculum";
import type { Session } from "../session/types";

const emptyListClasses = () => Promise.resolve(Object.freeze([]));

const teacherSession = (): Extract<Session, { kind: "activeTeacher" }> =>
  Object.freeze({
    kind: "activeTeacher",
    uid: "u1",
    schoolId: "school-abc",
    displayName: "Ada Lovelace",
  }) as Extract<Session, { kind: "activeTeacher" }>;

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  div.id = "app-root";
  document.body.appendChild(div);
  return div;
};

// A capturing assignment-detail seam: records the outlet controller the
// shell registers so a test can drive it exactly as the entry-point opener
// does.
const makeSeam = (): {
  seam: CurriculumAssignmentDetailSeam;
  getController: () => TeacherShellOutletController | null;
} => {
  let controller: TeacherShellOutletController | null = null;
  const seam: CurriculumAssignmentDetailSeam = {
    register: () => undefined,
    open: () => undefined,
    setOutletController: (c) => {
      controller = c;
    },
  };
  return { seam, getController: () => controller };
};

const makeDeps = (
  seam: CurriculumAssignmentDetailSeam,
  overrides: Partial<ShellDeps> = {},
): ShellDeps => ({
  onSignOut: () => undefined,
  listClasses: emptyListClasses,
  onLaunchPresentMode: () => undefined,
  assignmentDetail: seam,
  ...overrides,
});

// Render a distinguishable Assignment-Detail stand-in into a host, the way
// the entry-point opener renders the real surface into the outlet.
const renderDetailStub = (host: HTMLElement): void => {
  const el = host.ownerDocument.createElement("section");
  el.setAttribute("data-testid", "detail-stub");
  el.textContent = "Assignment Detail";
  host.appendChild(el);
};

describe("Sprint 28.5D D2A - shell registers an outlet controller", () => {
  test("mountTeacherShell registers a controller through the seam", () => {
    const mount = mkMount();
    const { seam, getController } = makeSeam();
    mountTeacherShell(teacherSession(), mount, makeDeps(seam));
    expect(getController()).not.toBeNull();
    expect(typeof getController()?.show).toBe("function");
  });

  test("a shell built without the seam mounts without error", () => {
    const mount = mkMount();
    // No assignmentDetail seam wired: the guarded call must be a no-op.
    expect(() =>
      mountTeacherShell(teacherSession(), mount, {
        onSignOut: () => undefined,
        listClasses: emptyListClasses,
        onLaunchPresentMode: () => undefined,
      }),
    ).not.toThrow();
    expect(mount.querySelector('[data-testid=shell-header]')).not.toBeNull();
  });
});

describe("Sprint 28.5D D2A - opening Detail preserves the shell", () => {
  test("controller.show renders Detail into the outlet without destroying header/nav/footer", () => {
    const mount = mkMount();
    const { seam, getController } = makeSeam();
    mountTeacherShell(teacherSession(), mount, makeDeps(seam));

    // The default surface (Curriculum) is mounted in the outlet.
    expect(mount.querySelector("[data-testid=workspace-outlet]")).not.toBeNull();

    getController()!.show(renderDetailStub);

    // Shell chrome survives.
    expect(mount.querySelector("[data-testid=shell-header]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=shell-nav]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=shell-footer]")).not.toBeNull();

    // Detail rendered inside the shell's outlet host.
    const outlet = mount.querySelector(".shell-outlet-host");
    const detail = mount.querySelector("[data-testid=detail-stub]");
    expect(detail).not.toBeNull();
    expect(outlet?.contains(detail)).toBe(true);

    // The previous surface content was cleared from the outlet (Detail
    // replaces it; the workspace-outlet section is gone).
    expect(mount.querySelector("[data-testid=workspace-outlet]")).toBeNull();
  });

  test("Curriculum stays the active navigation item while Detail is shown", () => {
    const mount = mkMount();
    const { seam, getController } = makeSeam();
    mountTeacherShell(teacherSession(), mount, makeDeps(seam));

    getController()!.show(renderDetailStub);

    const curriculumNav = mount.querySelector("[data-testid=nav-curriculum]");
    expect(curriculumNav?.getAttribute("aria-current")).toBe("page");
    expect(curriculumNav?.classList.contains("shell-nav-active")).toBe(true);
  });
});

describe("Sprint 28.5D D2A - global navigation leaves Detail cleanly", () => {
  test("selecting Classes from Detail removes Detail and mounts Classes with shell intact", () => {
    const mount = mkMount();
    const { seam, getController } = makeSeam();
    mountTeacherShell(teacherSession(), mount, makeDeps(seam));

    getController()!.show(renderDetailStub);
    expect(mount.querySelector("[data-testid=detail-stub]")).not.toBeNull();

    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-classes]")
      ?.click();

    // Detail is gone; a fresh workspace surface (Classes) is mounted.
    expect(mount.querySelector("[data-testid=detail-stub]")).toBeNull();
    const outlet = mount.querySelector("[data-testid=workspace-outlet]");
    expect(outlet).not.toBeNull();
    expect(outlet?.getAttribute("data-active-surface")).toBe("classes");

    // Shell chrome remained mounted throughout.
    expect(mount.querySelector("[data-testid=shell-header]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=shell-nav]")).not.toBeNull();
    // Active nav moved to Classes.
    expect(
      mount
        .querySelector("[data-testid=nav-classes]")
        ?.getAttribute("aria-current"),
    ).toBe("page");
  });

  test("re-selecting the active Curriculum item from Detail re-mounts Curriculum", () => {
    const mount = mkMount();
    const { seam, getController } = makeSeam();
    mountTeacherShell(teacherSession(), mount, makeDeps(seam));

    getController()!.show(renderDetailStub);
    expect(mount.querySelector("[data-testid=detail-stub]")).not.toBeNull();

    // Curriculum is already the active key; clicking it while Detail is shown
    // must still leave Detail (the normal same-key early-return is suspended).
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-curriculum]")
      ?.click();

    expect(mount.querySelector("[data-testid=detail-stub]")).toBeNull();
    const outlet = mount.querySelector("[data-testid=workspace-outlet]");
    expect(outlet?.getAttribute("data-active-surface")).toBe("curriculum");
  });
});
