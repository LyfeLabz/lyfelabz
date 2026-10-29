/**
 * Performance Operation 1: entry-point wiring regression pins.
 *
 * `app/src/index.ts` runs on import (it boots Firebase), so like the other
 * entry-point pins in this repository these read its source. They fail if
 * the teacher bootstrap goes back to awaiting assignment enumeration before
 * mounting the workspace, or if a registry write bypasses the controller.
 */
import * as fs from "fs";
import * as path from "path";

const source = fs.readFileSync(path.resolve(__dirname, "../../index.ts"), "utf8");

const teacherBranch = (): string => {
  const start = source.indexOf('if (session.kind === "activeTeacher") {');
  const end = source.indexOf('} else if (session.kind === "activeStudent") {');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe("teacher startup does not wait for assignment enumeration", () => {
  test("the teacher branch's only await is the Functions import, followed directly by the live token check", () => {
    const branch = teacherBranch();
    const code = branch.replace(/\/\/.*$/gm, "");
    // The caller's own continuation reads the LIVE token as its very first
    // statement after resuming; no snapshot taken before resumption is
    // trusted (session/teacherBootstrapHandoff.test.ts reproduces why).
    expect(code).toMatch(
      /^\s*if \(session\.kind === "activeTeacher"\) \{\s*const \{ getFunctions, connectFunctionsEmulator \} =\s*await import\("firebase\/functions"\);\s*if \(runToken !== currentRunToken\) return;/,
    );
    expect(code.match(/\bawait\b/g)).toHaveLength(1);
    expect(source).not.toMatch(/awaitBootstrapStep|session\/bootstrapStep/);
    // Nothing is installed before the guard.
    const guard = code.indexOf("if (runToken !== currentRunToken) return;");
    for (const install of [
      "getFunctions(",
      "integrations = ",
      "assignments = ",
      "teacherUnits = ",
      "installGradeImprovementsSeam(",
      "importFromClassroom = ",
      "assignmentHydration.start(",
      "lastActiveTeacher = session;",
    ]) {
      expect(code.indexOf(install)).toBeGreaterThan(guard);
    }
  });

  test("hydration is started, never awaited", () => {
    const branch = teacherBranch();
    expect(branch).toMatch(/assignmentHydration\.start\(/);
    expect(branch).not.toMatch(/await\s+hydrateAssignmentDetailRegistry/);
    expect(branch).not.toMatch(/await\s+assignmentHydration/);
    expect(source).not.toMatch(/hydrateAssignmentDetailRegistry\(/);
  });

  test("hydration is bound to this run's uid, school, and generation", () => {
    expect(teacherBranch()).toMatch(
      /assignmentHydration\.start\(\s*\{\s*uid: session\.uid,\s*schoolId: session\.schoolId,\s*generation: runToken,\s*isCurrent: \(\) => runToken === currentRunToken,\s*\}/,
    );
  });

  test("the active teacher is installed with no await between hydration start and dispatch", () => {
    const branch = teacherBranch();
    const afterStart = branch.slice(branch.indexOf("assignmentHydration.start("));
    expect(afterStart).toMatch(/lastActiveTeacher = session;/);
    expect(afterStart).not.toMatch(/\bawait\b/);
  });

  test("every non-teacher bootstrap resets the controller (supersede + clear)", () => {
    expect(source.match(/assignmentHydration\.reset\(\);/g)).toHaveLength(2);
    expect(source).not.toMatch(/assignmentDetailRegistry\.clear\(\)/);
  });

  test("lifecycle writes go through context-bound writers, never the raw registry", () => {
    expect(source).not.toMatch(/assignmentDetailRegistry\.register\(/);
    // Detail binds its writer when it opens, before any lifecycle work.
    expect(source).toMatch(
      /const writeLifecycle = assignmentHydration\.writer\(\);[\s\S]*onStatusChange: \(metadata\) => \{[\s\S]*?if \(!writeLifecycle\(metadata\)\) return;/,
    );
    // The surface seam is rebuilt per generation with its own writer, and
    // its `open` refuses once a newer seam replaced it.
    expect(source).toMatch(/const register = assignmentHydration\.writer\(\);/);
    expect(source).toMatch(/if \(assignmentDetailSeam !== seam\) return;/);
  });

  test("every bootstrap rebuilds the seam after starting or resetting the controller", () => {
    // The in-`rerun` rebuild (the `let` declaration builds the initial one).
    const rebuild = source.indexOf("\n    assignmentDetailSeam = createAssignmentDetailSeam();");
    expect(rebuild).toBeGreaterThan(-1);
    expect(rebuild).toBeGreaterThan(source.indexOf("assignmentHydration.start("));
    expect(rebuild).toBeGreaterThan(source.lastIndexOf("assignmentHydration.reset();"));
    expect(rebuild).toBeLessThan(source.indexOf("dispatch(session, table, mount, window.history);\n  };"));
    expect(source).toMatch(/assignmentDetail: \(\) => assignmentDetailSeam,/);
  });

  test("Detail metadata and surfaces receive the registry readiness", () => {
    expect(source).toMatch(
      /createAssignmentDetailMetadataReader\(\s*assignmentDetailRegistry,\s*assignmentHydration\.readiness,\s*\)/,
    );
    expect(source).toMatch(/registryStatus: assignmentHydration\.readiness,/);
  });
});
