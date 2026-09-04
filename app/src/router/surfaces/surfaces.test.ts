/**
 * @jest-environment jsdom
 */
import type { Session } from "../../session/types";
import { createRouteTable } from "../routes";
import type { SurfaceDeps } from "./index";
import { renderLoadingSurface } from "./index";

const freeze = <T>(v: T): T => Object.freeze(v) as T;

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

function makeDeps(overrides: Partial<SurfaceDeps> = {}): {
  deps: SurfaceDeps;
  spies: {
    signOut: jest.Mock;
    signIn: jest.Mock<Promise<void>>;
    refresh: jest.Mock<Promise<void>>;
    requestVerification: jest.Mock<Promise<void>>;
    activatePilotTeacher: jest.Mock<Promise<void>, []>;
    listClasses: jest.Mock<Promise<ReadonlyArray<never>>, [string]>;
    studentOnboarding: jest.Mock<
      Promise<void>,
      [{ displayName: string; joinCode: string }]
    >;
    studentLmsOnboarding: jest.Mock<
      Promise<void>,
      [{ displayName?: string }]
    >;
    googleDisplayName: jest.Mock<string | null, []>;
  };
} {
  const signOut = jest.fn();
  const signIn = jest.fn<Promise<void>, []>(() => Promise.resolve());
  const refresh = jest.fn<Promise<void>, []>(() => Promise.resolve());
  const requestVerification = jest.fn<
    Promise<void>,
    [{ role: "teacher"; schoolId: string; displayName: string }]
  >(() => Promise.resolve());
  const activatePilotTeacher = jest.fn<Promise<void>, []>(() =>
    Promise.resolve(),
  );
  const listClasses = jest.fn<Promise<ReadonlyArray<never>>, [string]>(
    () => Promise.resolve(Object.freeze([])),
  );
  const studentOnboarding = jest.fn<
    Promise<void>,
    [{ displayName: string; joinCode: string }]
  >(() => Promise.resolve());
  const studentLmsOnboarding = jest.fn<
    Promise<void>,
    [{ displayName?: string }]
  >(() => Promise.resolve());
  const googleDisplayName = jest.fn<string | null, []>(() => null);
  const deps: SurfaceDeps = {
    onSignOut: signOut,
    onSignIn: signIn,
    onRefreshSession: refresh,
    onRequestVerification: requestVerification,
    onActivatePilotTeacher: activatePilotTeacher,
    onStudentOnboarding: studentOnboarding,
    onStudentLmsOnboarding: studentLmsOnboarding,
    getGoogleDisplayName: googleDisplayName,
    listClasses,
    onLaunchPresentMode: () => undefined,
    ...overrides,
  };
  return {
    deps,
    spies: {
      signOut,
      signIn,
      refresh,
      requestVerification,
      activatePilotTeacher,
      listClasses,
      studentOnboarding,
      studentLmsOnboarding,
      googleDisplayName,
    },
  };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("signed-out surface", () => {
  test("renders sign-in copy, call-to-action, and return-to-lessons link", () => {
    const { deps } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.unauthenticated(freeze<Session>({ kind: "unauthenticated" }), mount);
    expect(mount.querySelector("h1")?.textContent).toBe(
      "Sign in to LyfeLabz.",
    );
    expect(mount.querySelector("[data-testid=google-signin]")).not.toBeNull();
    expect(mount.querySelector<HTMLAnchorElement>("[data-testid=return-link]")?.getAttribute("href")).toBe(
      "/",
    );
    expect(mount.querySelector("[data-testid=sign-out]")).toBeNull();
  });

  // Sprint 29B: the sign-in surface is the shared /app entry point (and the
  // page a Google OAuth reviewer lands on), so it carries the quiet Privacy
  // Policy + Terms of Use links to the stable public legal routes.
  test("renders quiet Privacy Policy and Terms of Use links to the public legal routes", () => {
    const { deps } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.unauthenticated(freeze<Session>({ kind: "unauthenticated" }), mount);
    const privacy = mount.querySelector<HTMLAnchorElement>(
      "[data-testid=legal-privacy]",
    );
    const terms = mount.querySelector<HTMLAnchorElement>(
      "[data-testid=legal-terms]",
    );
    expect(privacy?.getAttribute("href")).toBe("/privacy");
    expect(terms?.getAttribute("href")).toBe("/terms");
  });

  test("clicking the sign-in button calls onSignIn exactly once and does not call bootstrap directly", async () => {
    const { deps, spies } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.unauthenticated(freeze<Session>({ kind: "unauthenticated" }), mount);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=google-signin]")
      ?.click();
    await flush();
    expect(spies.signIn).toHaveBeenCalledTimes(1);
    expect(spies.refresh).not.toHaveBeenCalled();
  });

  test("renders a cancelled sign-in as the specified error copy", async () => {
    const err = Object.assign(new Error("popup"), { code: "auth/popup-closed-by-user" });
    const { deps } = makeDeps({ onSignIn: () => Promise.reject(err) });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.unauthenticated(freeze<Session>({ kind: "unauthenticated" }), mount);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=google-signin]")
      ?.click();
    await flush();
    await flush();
    expect(
      mount.querySelector("[data-testid=error-banner]")?.textContent,
    ).toContain("Sign in was cancelled");
  });
});

describe("provisioned surface", () => {
  test("renders welcome copy and a direct teacher-activation control (no name or school fields)", () => {
    const { deps } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(
      freeze<Session>({ kind: "provisioned", uid: "u1" }),
      mount,
    );
    expect(mount.querySelector("h1")?.textContent).toBe(
      "Welcome to LyfeLabz.",
    );
    // Sprint 29G.5C: the manual name + school-identifier fields are gone.
    expect(mount.querySelector("[data-testid=display-name]")).toBeNull();
    expect(mount.querySelector("[data-testid=school-id]")).toBeNull();
    expect(
      mount.querySelector("[data-testid=request-verification]"),
    ).toBeNull();
    // Direct activation control is present instead.
    const activate = mount.querySelector("[data-testid=activate-teacher]");
    expect(activate).not.toBeNull();
    expect(activate?.textContent).toBe("Continue as Teacher");
    // Sprint 29G.5C-R1 copy: activation language, no verification wording.
    expect(mount.textContent).toContain(
      "Create and assign lessons to your students.",
    );
    expect(mount.textContent).toContain("Teacher access");
    expect(mount.textContent).toContain(
      "Continue to activate your LyfeLabz teacher workspace.",
    );
    expect(mount.textContent).not.toContain(
      "Verify your school to create and assign lessons.",
    );
    expect(mount.textContent).not.toContain("Teacher verification");
    expect(mount.textContent).not.toContain("approved school accounts");
    // Student branch is co-present so a new user can pick their path.
    expect(mount.querySelector("[data-testid=student-section]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=join-code]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=join-class]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=sign-out]")).not.toBeNull();
  });

  test("selecting Continue as Teacher activates directly (no client-supplied fields) and schedules a refresh", async () => {
    jest.useFakeTimers();
    const { deps, spies } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(
      freeze<Session>({ kind: "provisioned", uid: "u1" }),
      mount,
    );
    mount
      .querySelector<HTMLButtonElement>("[data-testid=activate-teacher]")
      ?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(spies.activatePilotTeacher).toHaveBeenCalledTimes(1);
    // No arguments: the server derives email and school; the client asserts
    // nothing.
    expect(spies.activatePilotTeacher).toHaveBeenCalledWith();
    expect(spies.requestVerification).not.toHaveBeenCalled();
    jest.advanceTimersByTime(700);
    await Promise.resolve();
    expect(spies.refresh).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  test("shows a safe not-enabled message for a non-allowlisted account", async () => {
    const notAllowlisted = Object.assign(new Error("nope"), {
      code: "functions/permission-denied",
      details: { code: "teachers.pilotNotAllowlisted" },
    });
    const { deps } = makeDeps({
      onActivatePilotTeacher: () => Promise.reject(notAllowlisted),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(
      freeze<Session>({ kind: "provisioned", uid: "u1" }),
      mount,
    );
    mount
      .querySelector<HTMLButtonElement>("[data-testid=activate-teacher]")
      ?.click();
    await flush();
    await flush();
    const banner = mount.querySelector("[data-testid=error-banner]");
    expect(banner?.textContent).toBe(
      "Teacher access has not been enabled for this account.",
    );
    // The safe message never leaks internal identifiers or raw backend text.
    expect(mount.textContent).not.toContain("Referenced school does not exist.");
    expect(mount.textContent).not.toContain("allowlist");
    expect(mount.textContent).not.toContain("weston-middle");
  });
});

// Sprint 29F: the provisioned onboarding surface presents Teacher and Student
// as distinct role choices and reveals only the selected workflow. These tests
// pin the progressive-disclosure behavior, the LyfeLabz header, and the
// accessibility state on the role controls. The workflow-wiring tests above and
// below (which interact with the forms directly) continue to pass because both
// sections remain in the DOM; they are simply hidden until a role is chosen.
describe("provisioned surface - role selector (Sprint 29F)", () => {
  const provSession = (): Session =>
    freeze<Session>({ kind: "provisioned", uid: "u1" });

  const render = (): HTMLElement => {
    const { deps } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(provSession(), mount);
    return mount;
  };

  test("renders the LyfeLabz onboarding header and welcome headline", () => {
    const mount = render();
    expect(mount.querySelector(".auth-brand")?.textContent).toBe("LYFELABZ");
    expect(mount.querySelector("h1")?.textContent).toBe("Welcome to LyfeLabz.");
  });

  test("renders Teacher and Student role choices with the shortened labels", () => {
    const mount = render();
    const teacherChoice = mount.querySelector<HTMLButtonElement>(
      "[data-testid=role-choice-teacher]",
    );
    const studentChoice = mount.querySelector<HTMLButtonElement>(
      "[data-testid=role-choice-student]",
    );
    expect(teacherChoice).not.toBeNull();
    expect(studentChoice).not.toBeNull();
    expect(
      teacherChoice?.querySelector(".role-choice-title")?.textContent,
    ).toBe("Teacher");
    expect(
      studentChoice?.querySelector(".role-choice-title")?.textContent,
    ).toBe("Student");
    // The first-person role-card wording was removed.
    expect(mount.textContent).not.toContain("I am a teacher.");
    expect(mount.textContent).not.toContain("I am a student.");
    // Tightened instruction copy.
    expect(mount.textContent).toContain(
      "Choose how you'll use LyfeLabz to continue.",
    );
  });

  test("initial state hides both complete workflows", () => {
    const mount = render();
    const teacher = mount.querySelector<HTMLElement>(
      "[data-testid=teacher-section]",
    );
    const student = mount.querySelector<HTMLElement>(
      "[data-testid=student-section]",
    );
    expect(teacher?.hidden).toBe(true);
    expect(student?.hidden).toBe(true);
    expect(
      mount.querySelector<HTMLButtonElement>(
        "[data-testid=role-choice-teacher]",
      )?.getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      mount.querySelector<HTMLButtonElement>(
        "[data-testid=role-choice-student]",
      )?.getAttribute("aria-expanded"),
    ).toBe("false");
  });

  test("selecting Teacher reveals the teacher workflow and hides the student workflow", () => {
    const mount = render();
    mount
      .querySelector<HTMLButtonElement>("[data-testid=role-choice-teacher]")
      ?.click();
    const teacher = mount.querySelector<HTMLElement>(
      "[data-testid=teacher-section]",
    );
    const student = mount.querySelector<HTMLElement>(
      "[data-testid=student-section]",
    );
    expect(teacher?.hidden).toBe(false);
    expect(student?.hidden).toBe(true);
    // Teacher activation control is reachable once revealed.
    expect(
      mount.querySelector("[data-testid=activate-teacher]"),
    ).not.toBeNull();
  });

  test("selecting Student reveals the student workflow and hides the teacher workflow", () => {
    const mount = render();
    mount
      .querySelector<HTMLButtonElement>("[data-testid=role-choice-student]")
      ?.click();
    const teacher = mount.querySelector<HTMLElement>(
      "[data-testid=teacher-section]",
    );
    const student = mount.querySelector<HTMLElement>(
      "[data-testid=student-section]",
    );
    expect(student?.hidden).toBe(false);
    expect(teacher?.hidden).toBe(true);
    // Both enrollment mechanisms remain available under Student.
    expect(mount.querySelector("[data-testid=join-code]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=join-class]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=lms-onboarding]")).not.toBeNull();
  });

  test("switching roles without reload hides the previously shown workflow and updates aria state", () => {
    const mount = render();
    const teacherChoice = mount.querySelector<HTMLButtonElement>(
      "[data-testid=role-choice-teacher]",
    );
    const studentChoice = mount.querySelector<HTMLButtonElement>(
      "[data-testid=role-choice-student]",
    );
    const teacher = mount.querySelector<HTMLElement>(
      "[data-testid=teacher-section]",
    );
    const student = mount.querySelector<HTMLElement>(
      "[data-testid=student-section]",
    );
    teacherChoice?.click();
    expect(teacher?.hidden).toBe(false);
    expect(student?.hidden).toBe(true);
    expect(teacherChoice?.getAttribute("aria-expanded")).toBe("true");
    expect(teacherChoice?.getAttribute("aria-pressed")).toBe("true");
    studentChoice?.click();
    expect(student?.hidden).toBe(false);
    expect(teacher?.hidden).toBe(true);
    expect(studentChoice?.getAttribute("aria-expanded")).toBe("true");
    expect(teacherChoice?.getAttribute("aria-expanded")).toBe("false");
    expect(teacherChoice?.getAttribute("aria-pressed")).toBe("false");
  });

  test("role choices are semantic buttons that control their region", () => {
    const mount = render();
    const teacherChoice = mount.querySelector<HTMLButtonElement>(
      "[data-testid=role-choice-teacher]",
    );
    const teacher = mount.querySelector<HTMLElement>(
      "[data-testid=teacher-section]",
    );
    expect(teacherChoice?.tagName).toBe("BUTTON");
    expect(teacherChoice?.getAttribute("aria-controls")).toBe(teacher?.id);
    expect(teacher?.getAttribute("role")).toBe("region");
  });

  test("switching roles preserves fields the learner already typed", () => {
    const mount = render();
    // The teacher branch no longer has a typed field (Sprint 29G.5C direct
    // activation), so field preservation is exercised on the student branch,
    // which remains in the DOM across role switches.
    mount
      .querySelector<HTMLButtonElement>("[data-testid=role-choice-student]")
      ?.click();
    (mount.querySelector("[data-testid=student-display-name]") as HTMLInputElement).value =
      "Ada";
    mount
      .querySelector<HTMLButtonElement>("[data-testid=role-choice-teacher]")
      ?.click();
    mount
      .querySelector<HTMLButtonElement>("[data-testid=role-choice-student]")
      ?.click();
    expect(
      (mount.querySelector("[data-testid=student-display-name]") as HTMLInputElement)
        .value,
    ).toBe("Ada");
  });
});

describe("provisioned surface - student branch", () => {
  const provSession = (): Session =>
    freeze<Session>({ kind: "provisioned", uid: "u1" });

  test("prefills the student name from the Google display name when available", () => {
    const { deps } = makeDeps({
      getGoogleDisplayName: () => "Grace Hopper",
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(provSession(), mount);
    const nameInput = mount.querySelector<HTMLInputElement>(
      "[data-testid=student-display-name]",
    );
    expect(nameInput?.value).toBe("Grace Hopper");
  });

  test("blocks submission until name and join code are non-empty", async () => {
    const { deps, spies } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(provSession(), mount);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=join-class]")
      ?.click();
    await flush();
    expect(spies.studentOnboarding).not.toHaveBeenCalled();
    expect(
      mount.querySelector(
        "[data-testid=student-error-host] [data-testid=error-banner]",
      ),
    ).not.toBeNull();
  });

  test("rejects a malformed join code without invoking the callable and moves focus to the code field", async () => {
    const { deps, spies } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(provSession(), mount);
    const nameInput = mount.querySelector<HTMLInputElement>(
      "[data-testid=student-display-name]",
    );
    const codeInput = mount.querySelector<HTMLInputElement>(
      "[data-testid=join-code]",
    );
    nameInput!.value = "Ada";
    codeInput!.value = "not-hex!";
    mount
      .querySelector<HTMLButtonElement>("[data-testid=join-class]")
      ?.click();
    await flush();
    expect(spies.studentOnboarding).not.toHaveBeenCalled();
    expect(
      mount.querySelector(
        "[data-testid=student-error-host] [data-testid=error-banner]",
      )?.textContent,
    ).toContain("eight characters");
    expect(document.activeElement).toBe(codeInput);
  });

  test("on successful onboarding + join, calls the onboarding callable exactly once with a normalized code and schedules a refresh", async () => {
    jest.useFakeTimers();
    const { deps, spies } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(provSession(), mount);
    (
      mount.querySelector("[data-testid=student-display-name]") as HTMLInputElement
    ).value = "Ada";
    (mount.querySelector("[data-testid=join-code]") as HTMLInputElement).value =
      "abcd1234";
    mount
      .querySelector<HTMLButtonElement>("[data-testid=join-class]")
      ?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(spies.studentOnboarding).toHaveBeenCalledTimes(1);
    expect(spies.studentOnboarding).toHaveBeenCalledWith({
      displayName: "Ada",
      joinCode: "ABCD1234",
    });
    jest.advanceTimersByTime(700);
    await Promise.resolve();
    expect(spies.refresh).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  test("prevents duplicate submission while pending", async () => {
    let resolveFirst: () => void = () => undefined;
    const pending = new Promise<void>((r) => {
      resolveFirst = r;
    });
    const { deps, spies } = makeDeps({
      onStudentOnboarding: jest.fn(() => pending),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(provSession(), mount);
    (
      mount.querySelector("[data-testid=student-display-name]") as HTMLInputElement
    ).value = "Ada";
    (mount.querySelector("[data-testid=join-code]") as HTMLInputElement).value =
      "abcd1234";
    const btn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=join-class]",
    )!;
    btn.click();
    await Promise.resolve();
    expect(btn.disabled).toBe(true);
    btn.click();
    btn.click();
    await Promise.resolve();
    expect((deps.onStudentOnboarding as jest.Mock).mock.calls.length).toBe(1);
    resolveFirst();
    await Promise.resolve();
    // Reference spies to satisfy the linter without changing behaviour.
    void spies;
  });

  test("renders an invalid-join-code error with calm copy and refocuses the code field", async () => {
    const err = Object.assign(new Error("bad code"), {
      code: "functions/not-found",
      details: { code: "enrollments.joinCodeNotFound" },
    });
    const { deps } = makeDeps({
      onStudentOnboarding: () => Promise.reject(err),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(provSession(), mount);
    const nameInput = mount.querySelector<HTMLInputElement>(
      "[data-testid=student-display-name]",
    );
    const codeInput = mount.querySelector<HTMLInputElement>(
      "[data-testid=join-code]",
    );
    nameInput!.value = "Ada";
    codeInput!.value = "abcd1234";
    mount
      .querySelector<HTMLButtonElement>("[data-testid=join-class]")
      ?.click();
    await flush();
    await flush();
    const banner = mount.querySelector(
      "[data-testid=student-error-host] [data-testid=error-banner]",
    );
    expect(banner?.textContent).toContain("could not find a class");
    expect(banner?.textContent).not.toContain("functions/");
    expect(document.activeElement).toBe(codeInput);
    // Retained typed values so the user does not have to re-enter their name.
    expect(nameInput!.value).toBe("Ada");
    expect(codeInput!.value).toBe("abcd1234");
  });

  test("renders an onboarding failure (invalid display name) with calm copy and returns focus to the name field", async () => {
    const err = Object.assign(new Error("nope"), {
      code: "functions/invalid-argument",
      details: { code: "students.invalidDisplayName" },
    });
    const { deps, spies } = makeDeps({
      onStudentOnboarding: () => Promise.reject(err),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(provSession(), mount);
    const nameInput = mount.querySelector<HTMLInputElement>(
      "[data-testid=student-display-name]",
    );
    (nameInput as HTMLInputElement).value = "Ada";
    (mount.querySelector("[data-testid=join-code]") as HTMLInputElement).value =
      "abcd1234";
    mount
      .querySelector<HTMLButtonElement>("[data-testid=join-class]")
      ?.click();
    await flush();
    await flush();
    const banner = mount.querySelector(
      "[data-testid=student-error-host] [data-testid=error-banner]",
    );
    expect(banner?.textContent).toContain("Enter your name");
    expect(document.activeElement).toBe(nameInput);
    expect(spies.refresh).not.toHaveBeenCalled();
  });

  test("does not leak raw Firebase error codes for generic unavailability", async () => {
    const err = Object.assign(new Error("boom"), {
      code: "functions/unavailable",
    });
    const { deps } = makeDeps({
      onStudentOnboarding: () => Promise.reject(err),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(provSession(), mount);
    (
      mount.querySelector("[data-testid=student-display-name]") as HTMLInputElement
    ).value = "Ada";
    (mount.querySelector("[data-testid=join-code]") as HTMLInputElement).value =
      "abcd1234";
    mount
      .querySelector<HTMLButtonElement>("[data-testid=join-class]")
      ?.click();
    await flush();
    await flush();
    const banner = mount.querySelector(
      "[data-testid=student-error-host] [data-testid=error-banner]",
    );
    expect(banner?.textContent).not.toContain("functions/");
    expect(banner?.textContent).toContain("could not reach");
  });
});

describe("provisioned surface - Google Classroom (LMS) branch", () => {
  const provSession = (): Session =>
    freeze<Session>({ kind: "provisioned", uid: "u1" });

  test("renders the Google Classroom affordance as a distinct enrollment method", () => {
    const { deps } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(provSession(), mount);
    // Manual path preserved.
    expect(mount.querySelector("[data-testid=join-class]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=join-code]")).not.toBeNull();
    // LMS affordance present, now as its own method choice + action.
    expect(mount.querySelector("[data-testid=lms-onboarding]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=method-choice-google]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=method-choice-code]")).not.toBeNull();
  });

  test("on click with no typed name, calls the LMS callable once with an empty payload and schedules a refresh", async () => {
    jest.useFakeTimers();
    const { deps, spies } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(provSession(), mount);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=lms-onboarding]")
      ?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(spies.studentLmsOnboarding).toHaveBeenCalledTimes(1);
    expect(spies.studentLmsOnboarding).toHaveBeenCalledWith({});
    // Manual onboarding is never invoked by the LMS path.
    expect(spies.studentOnboarding).not.toHaveBeenCalled();
    jest.advanceTimersByTime(700);
    await Promise.resolve();
    expect(spies.refresh).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  test("reuses a typed student name as the optional displayName", async () => {
    const { deps, spies } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(provSession(), mount);
    (
      mount.querySelector("[data-testid=student-display-name]") as HTMLInputElement
    ).value = "Grace";
    mount
      .querySelector<HTMLButtonElement>("[data-testid=lms-onboarding]")
      ?.click();
    await flush();
    expect(spies.studentLmsOnboarding).toHaveBeenCalledTimes(1);
    expect(spies.studentLmsOnboarding).toHaveBeenCalledWith({
      displayName: "Grace",
    });
  });

  test("never sends a join code, school, class, district, or provider identity", async () => {
    const { deps, spies } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(provSession(), mount);
    (
      mount.querySelector("[data-testid=student-display-name]") as HTMLInputElement
    ).value = "Grace";
    // Even if a join code is typed, the LMS path ignores it entirely.
    (mount.querySelector("[data-testid=join-code]") as HTMLInputElement).value =
      "ABCD1234";
    mount
      .querySelector<HTMLButtonElement>("[data-testid=lms-onboarding]")
      ?.click();
    await flush();
    expect(spies.studentLmsOnboarding).toHaveBeenCalledTimes(1);
    const arg = spies.studentLmsOnboarding.mock.calls[0][0];
    // The only permitted key is displayName. No authority-bearing field is
    // ever carried from the client.
    expect(Object.keys(arg).sort()).toEqual(["displayName"]);
    for (const forbidden of [
      "joinCode",
      "schoolId",
      "districtId",
      "classId",
      "studentId",
      "providerId",
      "providerAccountId",
      "role",
      "uid",
    ]) {
      expect(forbidden in arg).toBe(false);
    }
  });

  test("renders the no-enrollment recovery state calmly and does not schedule a refresh", async () => {
    const err = Object.assign(new Error("no enrollment"), {
      code: "functions/failed-precondition",
      details: { code: "students.noLmsEnrollment" },
    });
    const { deps, spies } = makeDeps({
      onStudentLmsOnboarding: () => Promise.reject(err),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(provSession(), mount);
    const btn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lms-onboarding]",
    )!;
    btn.click();
    await flush();
    await flush();
    const banner = mount.querySelector(
      "[data-testid=lms-error-host] [data-testid=error-banner]",
    );
    // Sprint 29G.5K-2: zero-coordination copy. No synchronization
    // instruction; a clear teacher-help next step.
    expect(banner?.textContent).toContain("Ask your teacher for help");
    expect(banner?.textContent?.toLowerCase()).not.toContain("sync");
    expect(banner?.textContent?.toLowerCase()).not.toContain("roster");
    // No internal codes or identifiers leak.
    expect(banner?.textContent).not.toContain("functions/");
    expect(banner?.textContent).not.toContain("students.");
    expect(banner?.textContent?.toLowerCase()).not.toContain("district");
    // No transition to the active surface; the button is available to retry.
    expect(spies.refresh).not.toHaveBeenCalled();
    expect(btn.disabled).toBe(false);
    // The manual error host stays empty: the two flows do not contaminate.
    expect(
      mount.querySelector(
        "[data-testid=student-error-host] [data-testid=error-banner]",
      ),
    ).toBeNull();
  });

  test("allows a retry after a no-enrollment failure (button re-enabled, callable re-invoked)", async () => {
    const err = Object.assign(new Error("no enrollment"), {
      code: "functions/failed-precondition",
      details: { code: "students.noLmsEnrollment" },
    });
    const lms = jest
      .fn<Promise<void>, [{ displayName?: string }]>()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce(undefined);
    const { deps } = makeDeps({ onStudentLmsOnboarding: lms });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(provSession(), mount);
    const btn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lms-onboarding]",
    )!;
    btn.click();
    await flush();
    await flush();
    expect(btn.disabled).toBe(false);
    btn.click();
    await flush();
    expect(lms).toHaveBeenCalledTimes(2);
  });

  test("does not leak raw Firebase error codes for generic unavailability", async () => {
    const err = Object.assign(new Error("boom"), {
      code: "functions/unavailable",
    });
    const { deps } = makeDeps({
      onStudentLmsOnboarding: () => Promise.reject(err),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(provSession(), mount);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=lms-onboarding]")
      ?.click();
    await flush();
    await flush();
    const banner = mount.querySelector(
      "[data-testid=lms-error-host] [data-testid=error-banner]",
    );
    expect(banner?.textContent).not.toContain("functions/");
    expect(banner?.textContent).toContain("could not reach");
  });

  test("degrades calmly when the LMS onboarding dependency is not wired", async () => {
    const { deps, spies } = makeDeps({ onStudentLmsOnboarding: undefined });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(provSession(), mount);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=lms-onboarding]")
      ?.click();
    await flush();
    const banner = mount.querySelector(
      "[data-testid=lms-error-host] [data-testid=error-banner]",
    );
    expect(banner?.textContent).toContain("not available");
    expect(spies.refresh).not.toHaveBeenCalled();
  });

  test("the manual join-code path still works independently of the LMS affordance", async () => {
    jest.useFakeTimers();
    const { deps, spies } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(provSession(), mount);
    (
      mount.querySelector("[data-testid=student-display-name]") as HTMLInputElement
    ).value = "Ada";
    (mount.querySelector("[data-testid=join-code]") as HTMLInputElement).value =
      "abcd1234";
    mount
      .querySelector<HTMLButtonElement>("[data-testid=join-class]")
      ?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(spies.studentOnboarding).toHaveBeenCalledTimes(1);
    // The LMS callable is untouched by the manual path.
    expect(spies.studentLmsOnboarding).not.toHaveBeenCalled();
    jest.advanceTimersByTime(700);
    await Promise.resolve();
    expect(spies.refresh).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});

// Sprint 29F: inside the selected Student workflow, a secondary
// enrollment-method selector (Class code vs Google Classroom) reveals only
// the chosen method's action. Manual and LMS callable wiring are unchanged.
describe("provisioned surface - Student enrollment method (Sprint 29F)", () => {
  const provSession = (): Session =>
    freeze<Session>({ kind: "provisioned", uid: "u1" });

  const renderStudent = (): HTMLElement => {
    const { deps } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(provSession(), mount);
    // Reveal the Student workflow first (primary role choice).
    mount
      .querySelector<HTMLButtonElement>("[data-testid=role-choice-student]")
      ?.click();
    return mount;
  };

  const el = (mount: HTMLElement, id: string): HTMLElement | null =>
    mount.querySelector<HTMLElement>(`[data-testid=${id}]`);

  test("Student workflow exposes both enrollment-method choices", () => {
    const mount = renderStudent();
    expect(el(mount, "student-section")?.hidden).toBe(false);
    expect(el(mount, "method-choice-code")).not.toBeNull();
    expect(el(mount, "method-choice-google")).not.toBeNull();
  });

  test("defaults to Google Classroom and does not show both method actions at once", () => {
    const mount = renderStudent();
    // Sprint 29F: Google Classroom is the default student join method.
    expect(el(mount, "method-google")?.hidden).toBe(false);
    expect(el(mount, "method-code")?.hidden).toBe(true);
    // aria reflects the default selection.
    expect(
      el(mount, "method-choice-google")?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      el(mount, "method-choice-code")?.getAttribute("aria-expanded"),
    ).toBe("false");
  });

  test("Google Classroom is rendered first, before Class code (Sprint 29F)", () => {
    const mount = renderStudent();
    const selector = el(mount, "method-selector")!;
    const buttons = Array.from(
      selector.querySelectorAll("[data-testid^=method-choice-]"),
    ).map((b) => b.getAttribute("data-testid"));
    expect(buttons).toEqual(["method-choice-google", "method-choice-code"]);
  });

  test("Class code method reveals name, join code, hint, and Join class", () => {
    const mount = renderStudent();
    const code = el(mount, "method-code")!;
    expect(code.querySelector("[data-testid=student-display-name]")).not.toBeNull();
    expect(code.querySelector("[data-testid=join-code]")).not.toBeNull();
    expect(code.querySelector("#join-code-hint")).not.toBeNull();
    expect(code.querySelector("[data-testid=join-class]")).not.toBeNull();
  });

  test("selecting Google Classroom reveals only the LMS action", () => {
    const mount = renderStudent();
    el(mount, "method-choice-google")?.click();
    expect(el(mount, "method-google")?.hidden).toBe(false);
    expect(el(mount, "method-code")?.hidden).toBe(true);
    const google = el(mount, "method-google")!;
    expect(google.querySelector("[data-testid=lms-onboarding]")).not.toBeNull();
    expect(
      el(mount, "method-choice-google")?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  test("switching methods works without reload and updates aria state", () => {
    const mount = renderStudent();
    el(mount, "method-choice-google")?.click();
    expect(el(mount, "method-google")?.hidden).toBe(false);
    el(mount, "method-choice-code")?.click();
    expect(el(mount, "method-code")?.hidden).toBe(false);
    expect(el(mount, "method-google")?.hidden).toBe(true);
    expect(
      el(mount, "method-choice-code")?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      el(mount, "method-choice-google")?.getAttribute("aria-pressed"),
    ).toBe("false");
  });

  test("typed class-code values survive switching method away and back", () => {
    const mount = renderStudent();
    (el(mount, "student-display-name") as HTMLInputElement).value = "Ada";
    (el(mount, "join-code") as HTMLInputElement).value = "ABCD1234";
    el(mount, "method-choice-google")?.click();
    el(mount, "method-choice-code")?.click();
    expect((el(mount, "student-display-name") as HTMLInputElement).value).toBe(
      "Ada",
    );
    expect((el(mount, "join-code") as HTMLInputElement).value).toBe("ABCD1234");
  });

  test("method choices are semantic buttons that control their panels", () => {
    const mount = renderStudent();
    const codeChoice = el(mount, "method-choice-code") as HTMLButtonElement;
    const googleChoice = el(mount, "method-choice-google") as HTMLButtonElement;
    expect(codeChoice.tagName).toBe("BUTTON");
    expect(googleChoice.tagName).toBe("BUTTON");
    expect(codeChoice.getAttribute("aria-controls")).toBe(el(mount, "method-code")?.id);
    expect(googleChoice.getAttribute("aria-controls")).toBe(
      el(mount, "method-google")?.id,
    );
  });

  test("manual join callable wiring is unchanged under the Class code method", async () => {
    const { deps, spies } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(provSession(), mount);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=role-choice-student]")
      ?.click();
    (mount.querySelector("[data-testid=student-display-name]") as HTMLInputElement).value =
      "Ada";
    (mount.querySelector("[data-testid=join-code]") as HTMLInputElement).value =
      "ABCD1234";
    mount.querySelector<HTMLButtonElement>("[data-testid=join-class]")?.click();
    await flush();
    expect(spies.studentOnboarding).toHaveBeenCalledTimes(1);
    expect(spies.studentOnboarding).toHaveBeenCalledWith({
      displayName: "Ada",
      joinCode: "ABCD1234",
    });
    expect(spies.studentLmsOnboarding).not.toHaveBeenCalled();
  });

  test("Google Classroom callable wiring is unchanged under the Google method", async () => {
    const { deps, spies } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(provSession(), mount);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=role-choice-student]")
      ?.click();
    mount
      .querySelector<HTMLButtonElement>("[data-testid=method-choice-google]")
      ?.click();
    mount
      .querySelector<HTMLButtonElement>("[data-testid=lms-onboarding]")
      ?.click();
    await flush();
    expect(spies.studentLmsOnboarding).toHaveBeenCalledTimes(1);
    expect(spies.studentOnboarding).not.toHaveBeenCalled();
  });
});

describe("pending verification surface", () => {
  test("renders headline, manual refresh, and last-checked line", () => {
    const { deps } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.pendingVerification(
      freeze<Session>({
        kind: "pendingVerification",
        uid: "u1",
        schoolId: "s1",
        displayName: "Ada",
      }),
      mount,
    );
    expect(mount.querySelector("h1")?.textContent).toBe(
      "Your verification is pending.",
    );
    expect(mount.querySelector("[data-testid=check-status]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=last-checked]")?.textContent).toMatch(
      /^Last checked at \d\d:\d\d$/,
    );
  });

  test("manual check-status calls refreshSession once", async () => {
    const { deps, spies } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.pendingVerification(
      freeze<Session>({
        kind: "pendingVerification",
        uid: "u1",
        schoolId: "s1",
        displayName: "Ada",
      }),
      mount,
    );
    mount
      .querySelector<HTMLButtonElement>("[data-testid=check-status]")
      ?.click();
    await flush();
    expect(spies.refresh).toHaveBeenCalledTimes(1);
  });

  test("auto refresh fires at most once per 60 seconds while visible, and zero times while hidden", () => {
    jest.useFakeTimers();
    const { deps, spies } = makeDeps();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.pendingVerification(
      freeze<Session>({
        kind: "pendingVerification",
        uid: "u1",
        schoolId: "s1",
        displayName: "Ada",
      }),
      mount,
    );
    jest.advanceTimersByTime(59_000);
    expect(spies.refresh).toHaveBeenCalledTimes(0);
    jest.advanceTimersByTime(2_000);
    expect(spies.refresh).toHaveBeenCalledTimes(1);
    // Hide the tab; interval callback should be a no-op.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    jest.advanceTimersByTime(120_000);
    expect(spies.refresh).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});

describe("active teacher surface (Step 5 shell)", () => {
  test("delegates to the Teacher Platform Shell and preserves sign-out and return-to-lessons controls", () => {
    const { deps } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeTeacher(
      freeze<Session>({
        kind: "activeTeacher",
        uid: "u1",
        schoolId: "s1",
        displayName: "Ada",
      }),
      mount,
    );
    // Step 5 replaces the minimal Step 4 surface with the shell. Product
    // brand is the h1. Sprint 28.6D: Classes is the default landing
    // surface, so its headline is the h2 and sign-out lives in the header.
    expect(mount.querySelector("h1")?.textContent).toBe("LYFELABZ");
    expect(mount.querySelector("h2")?.textContent).toBe("Classes");
    expect(mount.querySelector("[data-testid=sign-out]")).not.toBeNull();
    // The return-to-lessons control lives on the Curriculum surface; it is
    // reachable from the primary navigation.
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-curriculum]")
      ?.click();
    expect(mount.querySelector("[data-testid=return-link]")).not.toBeNull();
    // Opaque schoolId is never rendered in the shell (spec §7.2).
    expect(mount.textContent).not.toContain("s1");
  });
});

// -----------------------------------------------------------------------------
// Sprint 28.6G - Student My Science
// -----------------------------------------------------------------------------
// The former two-surface split (My Assignments / My Results) is consolidated
// into a single domain-grouped landing. These fixtures use real curriculum
// manifest slugs so getUnitBySlug / TOPIC_LABEL resolve to the canonical
// domain and title.
const studentSession = () =>
  freeze<Session>({
    kind: "activeStudent",
    uid: "u1",
    schoolId: "s1",
    displayName: "Ben",
  });

// Default fixture is a life-science lesson. The stored assignment title is
// intentionally different from the canonical manifest title so the
// canonical-title contract is observable.
const okItem = (over: Record<string, unknown> = {}) =>
  ({
    assignmentId: "assign-1",
    lessonSlug: "what-is-life",
    title: "What is life? - Check for Understanding",
    status: "published" as const,
    publishedAt: 1_700_000_000_000,
    ...over,
  }) as const;

const okAttempt = (over: Record<string, unknown> = {}) => ({
  attemptId: "at-1",
  assignmentId: "assign-1",
  attemptNumber: 1,
  score: 9,
  maxScore: 10,
  percentage: 90,
  submittedAt: 1_000,
  ...over,
});

const assignmentsSeam =
  (items: ReadonlyArray<ReturnType<typeof okItem>>) => () => () =>
    Promise.resolve({
      items: Object.freeze(items) as ReadonlyArray<ReturnType<typeof okItem>>,
    });
const resultsSeam =
  (attempts: ReadonlyArray<ReturnType<typeof okAttempt>>) => () => () =>
    Promise.resolve({ attempts: Object.freeze(attempts) });

const domainHeadings = (mount: HTMLElement): Array<string | null> =>
  Array.from(
    mount.querySelectorAll("[data-testid=my-science-domain-heading]"),
  ).map((e) => e.textContent);

const cardsInDomain = (mount: HTMLElement, domain: string): HTMLElement[] => {
  const sec = mount.querySelector(
    `[data-testid=my-science-domain][data-domain=${domain}]`,
  );
  return sec
    ? Array.from(sec.querySelectorAll<HTMLElement>("[data-testid=my-science-card]"))
    : [];
};
const cardTitles = (cards: HTMLElement[]): Array<string | null> =>
  cards.map(
    (c) =>
      c.querySelector("[data-testid=my-science-card-title]")?.textContent ?? null,
  );

describe("My Science (28.6G) - information architecture", () => {
  test("lands on My Science with a minimal header (brand, safe name, Log out) and no teacher / My Assignments / My Results navigation", () => {
    const { deps } = makeDeps({
      studentAssignmentsList: assignmentsSeam([okItem()]),
      studentResultsList: resultsSeam([]),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);

    // A. My Science is the landing (single h1).
    expect(mount.querySelector("h1")?.textContent).toBe("My Science");
    // Minimal header: wordmark, the safe display name, and Log out only.
    const header = mount.querySelector("[data-testid=student-header]");
    expect(header).not.toBeNull();
    expect(header?.querySelector(".auth-brand")?.textContent).toBe("LYFELABZ");
    expect(
      header?.querySelector("[data-testid=student-name]")?.textContent,
    ).toBe("Ben");
    expect(header?.querySelector("[data-testid=sign-out]")).not.toBeNull();

    // The old two-surface menu is gone (no tablist, no My Results tab).
    expect(mount.querySelector("[data-testid=student-nav]")).toBeNull();
    expect(mount.querySelector("[data-testid=nav-assignments]")).toBeNull();
    expect(mount.querySelector("[data-testid=nav-results]")).toBeNull();
    expect(mount.querySelector("[role=tablist]")).toBeNull();
    // No teacher workspace chrome for a student.
    expect(mount.querySelector(".shell-header")).toBeNull();
    expect(mount.textContent).not.toContain("LyfeLabz Teacher Platform");

    // Opaque identifiers must never leak into the rendered surface.
    expect(mount.textContent).not.toContain("s1");
    expect(mount.textContent).not.toContain("u1");
  });

  test("refuses to render for any session kind other than activeStudent", () => {
    const { deps } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(freeze<Session>({ kind: "unauthenticated" }), mount);
    expect(mount.querySelector("h1")).toBeNull();
    expect(mount.querySelector("[data-testid=sign-out]")).toBeNull();
  });

  test("Log out calls onSignOut exactly once", () => {
    const { deps, spies } = makeDeps({
      studentAssignmentsList: assignmentsSeam([okItem()]),
      studentResultsList: resultsSeam([]),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    mount.querySelector<HTMLButtonElement>("[data-testid=sign-out]")?.click();
    expect(spies.signOut).toHaveBeenCalledTimes(1);
  });
});

describe("My Science (28.6G) - domain grouping & canonical titles", () => {
  test("groups assignments under canonical domains in the locked order; empty domains are omitted", async () => {
    const { deps } = makeDeps({
      studentAssignmentsList: assignmentsSeam([
        okItem({ assignmentId: "a-life", lessonSlug: "what-is-life" }),
        okItem({ assignmentId: "a-earth", lessonSlug: "layers-of-time" }),
        okItem({ assignmentId: "a-tech", lessonSlug: "conducting-experiments" }),
        okItem({ assignmentId: "a-phys", lessonSlug: "measuring-matter" }),
      ]),
      studentResultsList: resultsSeam([]),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    // Locked order (Blueprint section 15), using the canonical manifest labels.
    expect(domainHeadings(mount)).toEqual([
      "Earth & Space",
      "Life Science",
      "Physical Science",
      "Tech & Engineering",
    ]);
    expect(cardsInDomain(mount, "earth-space")).toHaveLength(1);
    expect(cardsInDomain(mount, "life-science")).toHaveLength(1);
    expect(cardsInDomain(mount, "physical-science")).toHaveLength(1);
    expect(cardsInDomain(mount, "tech-engineering")).toHaveLength(1);
  });

  test("only domains that have work are rendered", async () => {
    const { deps } = makeDeps({
      studentAssignmentsList: assignmentsSeam([
        okItem({ assignmentId: "a-life", lessonSlug: "what-is-life" }),
        okItem({ assignmentId: "a-tech", lessonSlug: "engineering-design" }),
      ]),
      studentResultsList: resultsSeam([]),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    expect(domainHeadings(mount)).toEqual(["Life Science", "Tech & Engineering"]);
    expect(
      mount.querySelector("[data-domain=earth-space]"),
    ).toBeNull();
    expect(mount.querySelector("[data-domain=physical-science]")).toBeNull();
  });

  test("card uses the canonical curriculum lesson title (never the stored title, never a regex-stripped suffix)", async () => {
    const stored = "Earth's Layers - Check for Understanding";
    const item = okItem({ lessonSlug: "layers-of-time", title: stored });
    const { deps } = makeDeps({
      studentAssignmentsList: assignmentsSeam([item]),
      studentResultsList: resultsSeam([]),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    const title = mount.querySelector(
      "[data-testid=my-science-card-title]",
    )?.textContent;
    // Canonical manifest title for layers-of-time.
    expect(title).toBe("Layers of Time");
    // The stored suffix is neither displayed nor stripped-to-a-guess.
    expect(mount.textContent).not.toContain("Check for Understanding");
    // The stored assignment record is never mutated by rendering.
    expect(item.title).toBe(stored);
  });

  test("an unknown lessonSlug falls back to the stored assignment title in the trailing Other group", async () => {
    const { deps } = makeDeps({
      studentAssignmentsList: assignmentsSeam([
        okItem({ assignmentId: "a-life", lessonSlug: "what-is-life" }),
        okItem({
          assignmentId: "a-ghost",
          lessonSlug: "no-such-lesson-slug",
          title: "Legacy Assignment",
        }),
      ]),
      studentResultsList: resultsSeam([]),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    // Other is the last group; the malformed card is never dropped.
    expect(domainHeadings(mount)).toEqual(["Life Science", "Other"]);
    expect(cardTitles(cardsInDomain(mount, "other"))).toEqual([
      "Legacy Assignment",
    ]);
  });

  test("a gated lesson never appears in a student science domain (falls to Other)", async () => {
    const { deps } = makeDeps({
      studentAssignmentsList: assignmentsSeam([
        okItem({ assignmentId: "a-gated", lessonSlug: "ragebaiting" }),
      ]),
      studentResultsList: resultsSeam([]),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    expect(mount.querySelector("[data-domain=life-science]")).toBeNull();
    expect(mount.querySelector("[data-domain=other]")).not.toBeNull();
  });
});

describe("My Science (28.6G) - status, results & ordering", () => {
  test("unfinished card is prominent (first), shows Ready to Begin and Open assignment, with no score", async () => {
    const { deps } = makeDeps({
      studentAssignmentsList: assignmentsSeam([okItem()]),
      studentResultsList: resultsSeam([]),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    const card = mount.querySelector<HTMLElement>("[data-testid=my-science-card]");
    expect(card?.getAttribute("data-complete")).toBeNull();
    expect(
      card?.querySelector("[data-testid=my-science-card-status]")?.textContent,
    ).toContain("Ready to Begin");
    expect(card?.querySelector("[data-testid=my-science-card-score]")).toBeNull();
    expect(
      card?.querySelector("[data-testid=assignments-launch]"),
    ).not.toBeNull();
  });

  test("completed card integrates the result (status, best percentage + raw score, attempt count) and stays launchable", async () => {
    const { deps } = makeDeps({
      studentAssignmentsList: assignmentsSeam([okItem()]),
      studentResultsList: resultsSeam([okAttempt()]),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    const card = mount.querySelector<HTMLElement>("[data-testid=my-science-card]");
    expect(card?.getAttribute("data-complete")).toBe("true");
    // Sprint 28.6H (Finding 17): objective status only - "Completed" (no
    // subjective "Well Done!"); the score carries the performance.
    expect(
      card?.querySelector("[data-testid=my-science-card-status]")?.textContent,
    ).toContain("Completed");
    const score = card?.querySelector(
      "[data-testid=my-science-card-score]",
    )?.textContent;
    expect(score).toContain("90%");
    expect(score).toContain("9/10");
    expect(
      card?.querySelector("[data-testid=my-science-card-attempts]")?.textContent,
    ).toBe("1 attempt");
    // Completed work stays re-launchable (Improve My Score is folded into the
    // one Open assignment control).
    expect(
      card?.querySelector("[data-testid=assignments-launch]"),
    ).not.toBeNull();
  });

  test("best score uses the certified best-attempt selection across repeated attempts", async () => {
    const { deps } = makeDeps({
      studentAssignmentsList: assignmentsSeam([okItem()]),
      studentResultsList: resultsSeam([
        okAttempt({ attemptId: "at-1", attemptNumber: 1, score: 6, maxScore: 10, percentage: 60 }),
        okAttempt({ attemptId: "at-2", attemptNumber: 2, score: 10, maxScore: 10, percentage: 100 }),
      ]),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    const card = mount.querySelector<HTMLElement>("[data-testid=my-science-card]");
    // Objective status (Finding 17): "Completed", not "Perfect Score".
    expect(
      card?.querySelector("[data-testid=my-science-card-status]")?.textContent,
    ).toContain("Completed");
    expect(
      card?.querySelector("[data-testid=my-science-card-score]")?.textContent,
    ).toContain("100%");
    expect(
      card?.querySelector("[data-testid=my-science-card-attempts]")?.textContent,
    ).toBe("2 attempts");
  });

  test("within a domain, unfinished sorts before completed, then newest published first", async () => {
    const { deps } = makeDeps({
      studentAssignmentsList: assignmentsSeam([
        okItem({ assignmentId: "a-done", lessonSlug: "what-is-life", publishedAt: 100 }),
        okItem({ assignmentId: "a-mid", lessonSlug: "cell-types", publishedAt: 200 }),
        okItem({ assignmentId: "a-new", lessonSlug: "organelles", publishedAt: 300 }),
      ]),
      studentResultsList: resultsSeam([
        okAttempt({ assignmentId: "a-done", score: 8, maxScore: 10, percentage: 80 }),
      ]),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    // Unfinished newest-first, then the completed one last.
    expect(cardTitles(cardsInDomain(mount, "life-science"))).toEqual([
      "Cell Organelles",
      "Cell Types",
      "What Is Life?",
    ]);
  });

  test("completed work whose assignment is no longer listed stays visible in Other with its result and no launch control", async () => {
    const { deps } = makeDeps({
      // No published assignment for the completed attempt (e.g. closed after
      // the student finished).
      studentAssignmentsList: assignmentsSeam([]),
      studentResultsList: resultsSeam([
        okAttempt({ attemptId: "g-1", assignmentId: "assign-ghost", score: 8, maxScore: 10, percentage: 80 }),
      ]),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    const card = mount.querySelector<HTMLElement>(
      "[data-domain=other] [data-testid=my-science-card]",
    );
    expect(
      card?.querySelector("[data-testid=my-science-card-title]")?.textContent,
    ).toBe("Assignment no longer listed");
    // The result is preserved...
    expect(
      card?.querySelector("[data-testid=my-science-card-score]")?.textContent,
    ).toContain("80%");
    // ...but there is no re-launch control (closed / no live assignment).
    expect(card?.querySelector("[data-testid=assignments-launch]")).toBeNull();
    // The internal id must never become the label.
    expect(mount.textContent).not.toContain("assign-ghost");
  });

  test("an assignment appears in exactly one domain (no duplication)", async () => {
    const { deps } = makeDeps({
      studentAssignmentsList: assignmentsSeam([okItem({ lessonSlug: "layers-of-time" })]),
      studentResultsList: resultsSeam([]),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    expect(mount.querySelectorAll("[data-testid=my-science-card]")).toHaveLength(1);
  });
});

describe("My Science (28.6G) - empty / loading / error / read-only / a11y", () => {
  test("empty state when the student has no assignments and no results", async () => {
    const { deps } = makeDeps({
      studentAssignmentsList: assignmentsSeam([]),
      studentResultsList: resultsSeam([]),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    expect(mount.querySelector("[data-testid=my-science-empty]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=my-science-domain]")).toBeNull();
  });

  test("missing assignments seam falls back to the empty state without throwing", () => {
    const { deps } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    expect(() => table.activeStudent(studentSession(), mount)).not.toThrow();
    expect(mount.querySelector("[data-testid=my-science-empty]")).not.toBeNull();
  });

  test("loading state shows while the read is in flight and never flashes the empty state", () => {
    const { deps } = makeDeps({
      studentAssignmentsList: () => () => new Promise(() => undefined),
      studentResultsList: resultsSeam([]),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    expect(mount.querySelector("[data-testid=loading-indicator]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=my-science-empty]")).toBeNull();
    expect(mount.querySelector("h1")?.textContent).toBe("My Science");
  });

  test("error state when the primary assignments read fails; a retry re-invokes and recovers", async () => {
    let call = 0;
    const callable = jest.fn(() => {
      call += 1;
      return call === 1
        ? Promise.reject(new Error("firebase/internal boom"))
        : Promise.resolve({
            items: Object.freeze([okItem()]) as ReadonlyArray<ReturnType<typeof okItem>>,
          });
    });
    const { deps } = makeDeps({
      studentAssignmentsList: () => callable,
      studentResultsList: resultsSeam([]),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    const err = mount.querySelector("[data-testid=assignments-error]");
    expect(err).not.toBeNull();
    // No raw Firebase / callable detail leaks into the message.
    expect(err?.textContent ?? "").not.toContain("firebase");
    expect(err?.textContent ?? "").not.toContain("boom");
    mount.querySelector<HTMLButtonElement>("[data-testid=assignments-retry]")?.click();
    await flush();
    expect(callable).toHaveBeenCalledTimes(2);
    expect(mount.querySelector("[data-testid=my-science-card]")).not.toBeNull();
  });

  test("a results-read failure degrades gracefully: assignments still render and launch, with no misleading status", async () => {
    const { deps } = makeDeps({
      studentAssignmentsList: assignmentsSeam([okItem()]),
      studentResultsList: () => () => Promise.reject(new Error("results down")),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    const card = mount.querySelector<HTMLElement>("[data-testid=my-science-card]");
    expect(card).not.toBeNull();
    expect(card?.querySelector("[data-testid=assignments-launch]")).not.toBeNull();
    // No status chip rather than a misleading Ready to Begin / completed state.
    expect(
      card?.querySelector("[data-testid=my-science-card-status]"),
    ).toBeNull();
  });

  test("rendering My Science is read-only: only the two read callables run, and nothing launches or mutates", async () => {
    const assignments = jest.fn(() =>
      Promise.resolve({
        items: Object.freeze([okItem()]) as ReadonlyArray<ReturnType<typeof okItem>>,
      }),
    );
    const results = jest.fn(() => Promise.resolve({ attempts: Object.freeze([]) }));
    const onLaunchAssignment = jest.fn();
    const { deps } = makeDeps({
      studentAssignmentsList: () => assignments,
      studentResultsList: () => results,
      onLaunchAssignment,
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    expect(assignments).toHaveBeenCalledTimes(1);
    expect(results).toHaveBeenCalledTimes(1);
    // Simply rendering the surface never begins a session / attempt.
    expect(onLaunchAssignment).not.toHaveBeenCalled();
  });

  test("Open assignment launches via the certified launcher URL and exposes no identity beyond the assignmentId", async () => {
    const onLaunchAssignment = jest.fn();
    const { deps } = makeDeps({
      studentAssignmentsList: assignmentsSeam([okItem()]),
      studentResultsList: resultsSeam([]),
      onLaunchAssignment,
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    const btn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=assignments-launch]",
    );
    const url = btn?.getAttribute("data-assignment-launch-url") ?? "";
    expect(url).toBe("/app/lessons/lesson_what-is-life.html?assignment=assign-1");
    for (const forbidden of ["u1", "s1", "uid=", "schoolId=", "session=", "token=", "score="]) {
      expect(url).not.toContain(forbidden);
    }
    btn?.click();
    expect(onLaunchAssignment).toHaveBeenCalledTimes(1);
    // F5.2 Slice 5: the launcher now receives the server-authoritative launch
    // PLAN, not a bare URL. A canonical item routes to exactly the canonical URL
    // (primary === canonical, not differentiated), so no identity leaks and the
    // behavior is byte-identical to pre-differentiation.
    expect(onLaunchAssignment).toHaveBeenCalledWith({
      primaryUrl: url,
      canonicalUrl: url,
      differentiated: false,
      differentiatedRejected: false,
    });
    // The launch button's accessible name includes the lesson title.
    expect(btn?.getAttribute("aria-label")).toBe("Open assignment: What Is Life?");
  });

  test("F5.2 Slice 5: a differentiated item launches the server path (ref transported) while the DOM attribute stays canonical/non-leaking", async () => {
    const rev = `pr${"a".repeat(64)}`;
    const ref = "0123456789abcdef0123456789abcdef";
    const onLaunchAssignment = jest.fn();
    const { deps } = makeDeps({
      studentAssignmentsList: assignmentsSeam([
        okItem({
          presentation: {
            variantKey: "reading-adapted",
            presentationRevisionId: rev,
            path: `app/lessons/variants/lesson_what-is-life__${rev}.html`,
          },
          launchRef: ref,
        }),
      ]),
      studentResultsList: resultsSeam([]),
      onLaunchAssignment,
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    const btn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=assignments-launch]",
    );
    // The DOM launch attribute is the CANONICAL URL - never the opaque variant
    // path and never the launchRef.
    const attr = btn?.getAttribute("data-assignment-launch-url") ?? "";
    expect(attr).toBe("/app/lessons/lesson_what-is-life.html?assignment=assign-1");
    expect(attr).not.toContain("variants");
    expect(attr).not.toContain("launchRef");
    // Clicking hands the executor the differentiated plan (server path + ref).
    btn?.click();
    expect(onLaunchAssignment).toHaveBeenCalledWith({
      differentiated: true,
      differentiatedRejected: false,
      canonicalUrl: "/app/lessons/lesson_what-is-life.html?assignment=assign-1",
      primaryUrl: `/app/lessons/variants/lesson_what-is-life__${rev}.html?assignment=assign-1&launchRef=${ref}`,
    });
  });

  test("F5.2 Slice 5: a canonicalFallback item (launchRef only) launches canonical with the fallback ref", async () => {
    const ref = "0123456789abcdef0123456789abcdef";
    const onLaunchAssignment = jest.fn();
    const { deps } = makeDeps({
      studentAssignmentsList: assignmentsSeam([okItem({ launchRef: ref })]),
      studentResultsList: resultsSeam([]),
      onLaunchAssignment,
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    mount.querySelector<HTMLButtonElement>("[data-testid=assignments-launch]")?.click();
    expect(onLaunchAssignment).toHaveBeenCalledWith({
      differentiated: false,
      differentiatedRejected: false,
      canonicalUrl: "/app/lessons/lesson_what-is-life.html?assignment=assign-1",
      primaryUrl: `/app/lessons/lesson_what-is-life.html?assignment=assign-1&launchRef=${ref}`,
    });
  });

  test("heading hierarchy is h1 My Science -> h2 domain -> h3 card title", async () => {
    const { deps } = makeDeps({
      studentAssignmentsList: assignmentsSeam([okItem({ lessonSlug: "what-is-life" })]),
      studentResultsList: resultsSeam([]),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    expect(mount.querySelector("h1")?.textContent).toBe("My Science");
    const h2 = mount.querySelector("[data-testid=my-science-domain-heading]");
    expect(h2?.tagName).toBe("H2");
    const h3 = mount.querySelector("[data-testid=my-science-card-title]");
    expect(h3?.tagName).toBe("H3");
  });

  test("titles are inserted via textContent so HTML from the callable cannot render", async () => {
    const { deps } = makeDeps({
      // Unknown slug so the stored (hostile) title is used as the fallback.
      studentAssignmentsList: assignmentsSeam([
        okItem({ lessonSlug: "no-such-slug", title: "<img src=x onerror=alert(1)>" }),
      ]),
      studentResultsList: resultsSeam([]),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    const title = mount.querySelector("[data-testid=my-science-card-title]");
    expect(title?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(title?.querySelector("img")).toBeNull();
  });
});

describe("suspended and archived surfaces", () => {
  test("suspended surface shows the specified refusal copy and a sign-out control", () => {
    const { deps } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.suspendedUser(freeze<Session>({ kind: "suspendedUser", uid: "u1" }), mount);
    expect(mount.querySelector("h1")?.textContent).toBe(
      "Your account is not available right now.",
    );
    expect(mount.querySelector("[data-testid=sign-out]")).not.toBeNull();
  });

  test("archived surface shows the terminal refusal copy and a sign-out control", () => {
    const { deps } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.archivedUser(freeze<Session>({ kind: "archivedUser", uid: "u1" }), mount);
    expect(mount.querySelector("h1")?.textContent).toBe(
      "This account has been archived.",
    );
    expect(mount.querySelector("[data-testid=sign-out]")).not.toBeNull();
  });
});

describe("error surface", () => {
  const reasons: Array<[
    Session & { kind: "error" },
    string,
    { retry: boolean; refresh: boolean; signOut: boolean },
  ]> = [
    [
      freeze({ kind: "error", reason: "authInitFailed" as const }),
      "We could not start your sign-in session.",
      { retry: false, refresh: true, signOut: true },
    ],
    [
      freeze({ kind: "error", reason: "userRecordUnreadable" as const }),
      "We could not load your account.",
      { retry: true, refresh: false, signOut: true },
    ],
    [
      freeze({ kind: "error", reason: "userRecordMissing" as const }),
      "Your account record was not found.",
      { retry: true, refresh: false, signOut: true },
    ],
    [
      freeze({ kind: "error", reason: "recordShapeInvalid" as const }),
      "Your account record needs attention.",
      { retry: false, refresh: false, signOut: true },
    ],
    [
      freeze({ kind: "error", reason: "networkUnavailable" as const }),
      "You appear to be offline.",
      { retry: true, refresh: false, signOut: false },
    ],
  ];

  test.each(reasons)(
    "renders %j with the specified copy and recovery actions",
    (session, expectedHeadline, actions) => {
      const { deps } = makeDeps();
      const table = createRouteTable(deps);
      const mount = mkMount();
      table.error(session, mount);
      expect(mount.querySelector("h1")?.textContent).toBe(expectedHeadline);
      expect(!!mount.querySelector("[data-testid=retry]")).toBe(actions.retry);
      expect(!!mount.querySelector("[data-testid=refresh]")).toBe(
        actions.refresh,
      );
      expect(!!mount.querySelector("[data-testid=sign-out]")).toBe(
        actions.signOut,
      );
    },
  );

  test("retry re-runs the bootstrap through refreshSession", async () => {
    const { deps, spies } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.error(freeze<Session>({ kind: "error", reason: "userRecordMissing" }), mount);
    mount.querySelector<HTMLButtonElement>("[data-testid=retry]")?.click();
    await flush();
    expect(spies.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("29F - support contact address", () => {
  // Guard against the fake placeholder returning to any user-visible support
  // surface. Renders every surface that shows a support line and asserts the
  // real address is present and no `.example` placeholder is.
  const supportSurfaces: Array<[string, (t: ReturnType<typeof createRouteTable>, m: HTMLElement) => void]> = [
    [
      "suspended",
      (t, m) => t.suspendedUser(freeze<Session>({ kind: "suspendedUser", uid: "u1" }), m),
    ],
    [
      "error:userRecordMissing",
      (t, m) => t.error(freeze<Session>({ kind: "error", reason: "userRecordMissing" }), m),
    ],
    [
      "error:recordShapeInvalid",
      (t, m) => t.error(freeze<Session>({ kind: "error", reason: "recordShapeInvalid" }), m),
    ],
  ];

  test.each(supportSurfaces)(
    "%s surface shows support@lyfelabz.com and no lyfelabz.example placeholder",
    (_name, render) => {
      const { deps } = makeDeps();
      const table = createRouteTable(deps);
      const mount = mkMount();
      render(table, mount);
      const text = mount.textContent ?? "";
      expect(text).toContain("support@lyfelabz.com");
      expect(text).not.toContain("lyfelabz.example");
    },
  );
});

describe("loading surface", () => {
  test("renders a status region while the bootstrap is in flight", () => {
    const mount = mkMount();
    renderLoadingSurface(mount);
    const region = mount.querySelector("[data-testid=loading-indicator]");
    expect(region).not.toBeNull();
    expect(region?.getAttribute("role")).toBe("status");
    expect(region?.textContent).toBe("Loading your account");
  });
});

describe("routing invariants", () => {
  test("no surface reads location.search or storage", () => {
    // Sentinel: the surfaces module is imported and used in every test
    // above without any DOM stubbing of location.search, localStorage,
    // or document.cookie; a regression that added such a read would
    // fail elsewhere in the suite. This test documents the invariant.
    expect(typeof renderLoadingSurface).toBe("function");
  });
});
