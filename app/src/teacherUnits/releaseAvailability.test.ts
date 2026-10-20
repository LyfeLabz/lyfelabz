import { createTeacherUnitsMutationVerifier } from "./backendCompatibility";
jest.unmock("./releaseAvailability");
jest.mock("firebase/functions", () => ({ httpsCallable: jest.fn() }));
import { teacherUnitsAvailable, requireTeacherUnitsAvailable } from "./releaseAvailability";
import { teacherUnitsReleaseBoundary } from "./releaseBoundary";
import { createTeacherUnitsController, createTeacherUnitsSurfaceSeam } from "./unitsController";
import { createTeacherUnitCreateAttemptStore } from "./createAttemptStore";
import { createFirebaseTeacherUnitsCallables } from "./wire";
import { renderTeacherUnitsPanel, teacherUnitsSurfaceEnabled } from "../shell/surfaces/teacherUnitsPanel";
import { renderCurriculumSurface } from "../shell/surfaces/curriculum";
import { renderMyUnitsSurface } from "../shell/surfaces/myUnits";
import { mountTeacherShell } from "../shell/shell";
import type { Session } from "../session/types";

// These test the real closed module, rather than the historical enabled U2 fixture.
test("production availability is closed and the lazy gateway has no effects", () => {
  expect(teacherUnitsAvailable()).toBe(false);
  expect(requireTeacherUnitsAvailable).toThrow("unavailable");
  const factory = jest.fn();
  expect(teacherUnitsReleaseBoundary(factory)).toBeNull();
  expect(factory).not.toHaveBeenCalled();
});
test("inverted caller condition cannot open the shared boundary", () => {
  const factory = jest.fn();
  if (!teacherUnitsAvailable()) expect(teacherUnitsReleaseBoundary(factory)).toBeNull();
  expect(factory).not.toHaveBeenCalled();
});
test("all alternate exported constructors refuse before dependency, DOM or storage access", () => {
  // A proxy makes any dependency access fail: refusal must precede every effect.
  const dependency = new Proxy({}, { get() { throw new Error("dependency touched"); } });
  expect(() => createTeacherUnitsMutationVerifier(dependency as never, dependency as never, dependency as never)).toThrow("unavailable");
  expect(() => createTeacherUnitsController(dependency as never)).toThrow("unavailable");
  expect(() => createTeacherUnitsSurfaceSeam(dependency as never)).toThrow("unavailable");
  expect(() => createFirebaseTeacherUnitsCallables(dependency as never, dependency as never)).toThrow("unavailable");
  expect(() => createTeacherUnitCreateAttemptStore(dependency as never)).toThrow("unavailable");
  expect(() => renderTeacherUnitsPanel(dependency as never, dependency as never)).toThrow("unavailable");
});
test("injected seam cannot add My Units to a closed release", () => {
  const createController = jest.fn();
  const seam = { createController };
  const session: Extract<Session, { kind: "activeTeacher" }> = Object.freeze({
    kind: "activeTeacher", uid: "teacher", schoolId: "school", displayName: "Teacher",
  });
  // The shared surface gate stays closed even with a seam.
  expect(teacherUnitsSurfaceEnabled(seam)).toBe(false);
  // Curriculum has no My Units switch of any kind.
  const curriculum = document.createElement("div");
  renderCurriculumSurface(curriculum, session, { listClasses: jest.fn().mockResolvedValue([]) });
  expect(curriculum.querySelector('[data-testid="curriculum-view-switch"]')).toBeNull();
  expect(curriculum.textContent).not.toContain("My Units");
  // The My Units surface renders nothing and creates no controller.
  const units = document.createElement("div");
  renderMyUnitsSurface(units, session, { teacherUnits: seam });
  expect(units.childElementCount).toBe(0);
  // The shell offers no My Units navigation and refuses it as a destination.
  const shellMount = document.createElement("div");
  document.body.appendChild(shellMount);
  mountTeacherShell(session, shellMount, {
    onSignOut: jest.fn(),
    listClasses: jest.fn().mockResolvedValue([]),
    onLaunchPresentMode: jest.fn(),
    teacherUnits: seam,
    // Milestone 1A: a fresh-load #units deep link is refused too.
    initialState: { kind: "shell-units-archived", surface: "units" },
  });
  expect(shellMount.querySelector('[data-testid="workspace-outlet"]')?.getAttribute("data-active-surface")).toBe("classes");
  expect(shellMount.querySelector('[data-testid="nav-units"]')).toBeNull();
  expect(shellMount.textContent).not.toContain("My Units");
  window.dispatchEvent(new PopStateEvent("popstate", { state: { kind: "shell-surface", surface: "units" } }));
  window.dispatchEvent(new PopStateEvent("popstate", { state: { kind: "shell-units-archived", surface: "units" } }));
  expect(shellMount.querySelector('[data-testid="workspace-outlet"]')?.getAttribute("data-active-surface")).toBe("classes");
  expect(createController).not.toHaveBeenCalled();
  shellMount.remove();
});
