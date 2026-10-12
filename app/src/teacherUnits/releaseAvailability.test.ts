import { createTeacherUnitsMutationVerifier } from "./backendCompatibility";
jest.unmock("./releaseAvailability");
jest.mock("firebase/functions", () => ({ httpsCallable: jest.fn() }));
import { teacherUnitsAvailable, requireTeacherUnitsAvailable } from "./releaseAvailability";
import { teacherUnitsReleaseBoundary } from "./releaseBoundary";
import { createTeacherUnitsController, createTeacherUnitsSurfaceSeam } from "./unitsController";
import { createTeacherUnitCreateAttemptStore } from "./createAttemptStore";
import { createFirebaseTeacherUnitsCallables } from "./wire";
import { renderTeacherUnitsPanel } from "../shell/surfaces/teacherUnitsPanel";
import { renderCurriculumSurface } from "../shell/surfaces/curriculum";
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
test("injected seam cannot add My Units to closed Curriculum", () => {
  const mount = document.createElement("div");
  const createController = jest.fn();
  const session: Extract<Session, { kind: "activeTeacher" }> = Object.freeze({
    kind: "activeTeacher", uid: "teacher", schoolId: "school", displayName: "Teacher",
  });
  renderCurriculumSurface(mount, session, { teacherUnits:{ createController }, listClasses:jest.fn().mockResolvedValue([]) });
  expect(mount.querySelector('[data-testid="curriculum-view-switch"]')).toBeNull();
  expect(mount.textContent).not.toContain("My Units");
  expect(createController).not.toHaveBeenCalled();
});
