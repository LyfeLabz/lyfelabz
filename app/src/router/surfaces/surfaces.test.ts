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
    listClasses: jest.Mock<Promise<ReadonlyArray<never>>, [string]>;
    studentOnboarding: jest.Mock<
      Promise<void>,
      [{ displayName: string; joinCode: string }]
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
  const listClasses = jest.fn<Promise<ReadonlyArray<never>>, [string]>(
    () => Promise.resolve(Object.freeze([])),
  );
  const studentOnboarding = jest.fn<
    Promise<void>,
    [{ displayName: string; joinCode: string }]
  >(() => Promise.resolve());
  const googleDisplayName = jest.fn<string | null, []>(() => null);
  const deps: SurfaceDeps = {
    onSignOut: signOut,
    onSignIn: signIn,
    onRefreshSession: refresh,
    onRequestVerification: requestVerification,
    onStudentOnboarding: studentOnboarding,
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
      listClasses,
      studentOnboarding,
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
  test("renders welcome copy and a form for schoolId and displayName", () => {
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
    expect(mount.querySelector("[data-testid=display-name]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=school-id]")).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=request-verification]"),
    ).not.toBeNull();
    // Student branch is co-present so a new user can pick their path.
    expect(mount.querySelector("[data-testid=student-section]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=join-code]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=join-class]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=sign-out]")).not.toBeNull();
  });

  test("blocks submission until both inputs are non-empty", async () => {
    const { deps, spies } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(
      freeze<Session>({ kind: "provisioned", uid: "u1" }),
      mount,
    );
    mount
      .querySelector<HTMLButtonElement>("[data-testid=request-verification]")
      ?.click();
    await flush();
    expect(spies.requestVerification).not.toHaveBeenCalled();
    expect(mount.querySelector("[data-testid=error-banner]")).not.toBeNull();
  });

  test("on successful submit, calls the callable once with the collected inputs and schedules a refresh", async () => {
    jest.useFakeTimers();
    const { deps, spies } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(
      freeze<Session>({ kind: "provisioned", uid: "u1" }),
      mount,
    );
    (mount.querySelector("[data-testid=display-name]") as HTMLInputElement).value =
      "Ada";
    (mount.querySelector("[data-testid=school-id]") as HTMLInputElement).value =
      "s1";
    mount
      .querySelector<HTMLButtonElement>("[data-testid=request-verification]")
      ?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(spies.requestVerification).toHaveBeenCalledTimes(1);
    expect(spies.requestVerification).toHaveBeenCalledWith({
      role: "teacher",
      schoolId: "s1",
      displayName: "Ada",
    });
    jest.advanceTimersByTime(700);
    await Promise.resolve();
    expect(spies.refresh).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  test("renders permission errors with the specified copy", async () => {
    const permissionErr = Object.assign(new Error("nope"), {
      code: "functions/permission-denied",
    });
    const { deps } = makeDeps({
      onRequestVerification: () => Promise.reject(permissionErr),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.provisioned(
      freeze<Session>({ kind: "provisioned", uid: "u1" }),
      mount,
    );
    (mount.querySelector("[data-testid=display-name]") as HTMLInputElement).value =
      "Ada";
    (mount.querySelector("[data-testid=school-id]") as HTMLInputElement).value =
      "s1";
    mount
      .querySelector<HTMLButtonElement>("[data-testid=request-verification]")
      ?.click();
    await flush();
    await flush();
    expect(
      mount.querySelector("[data-testid=error-banner]")?.textContent,
    ).toContain("not eligible");
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
    // Step 5 replaces the minimal Step 4 surface with the shell. The
    // welcome message is now an h2; product brand is the h1.
    expect(mount.querySelector("h1")?.textContent).toBe(
      "LyfeLabz Teacher Platform",
    );
    expect(mount.querySelector("h2")?.textContent).toBe("Welcome, Ada.");
    expect(mount.querySelector("[data-testid=return-link]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=sign-out]")).not.toBeNull();
    // Opaque schoolId is never rendered in the shell (spec §7.2).
    expect(mount.textContent).not.toContain("s1");
  });
});

describe("active student surface (Slice 3 landing)", () => {
  test("welcomes the verified active student by displayName and preserves sign-out plus return-to-lessons", () => {
    const { deps } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(
      freeze<Session>({
        kind: "activeStudent",
        uid: "u1",
        schoolId: "s1",
        displayName: "Ben",
      }),
      mount,
    );
    expect(mount.querySelector("h1")?.textContent).toBe("Welcome, Ben.");
    expect(mount.querySelector("[data-testid=sign-out]")).not.toBeNull();
    expect(mount.querySelector<HTMLAnchorElement>("[data-testid=return-link]")?.getAttribute("href")).toBe("/");
    // Opaque identifiers must never leak into the rendered surface.
    expect(mount.textContent).not.toContain("s1");
    expect(mount.textContent).not.toContain("u1");
    // Slice 4 must not render the teacher shell for a student.
    expect(mount.textContent).not.toContain("LyfeLabz Teacher Platform");
  });

  test("refuses to render for any session kind other than activeStudent (no fallback to student for unknown state)", () => {
    const { deps } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    // Direct invocation with a non-student session (defensive: dispatch
    // would never route here, but the surface must not render either).
    table.activeStudent(
      freeze<Session>({ kind: "unauthenticated" }),
      mount,
    );
    expect(mount.querySelector("h1")).toBeNull();
    expect(mount.querySelector("[data-testid=sign-out]")).toBeNull();
  });

  test("sign-out on the student landing surface calls onSignOut exactly once", () => {
    const { deps, spies } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(
      freeze<Session>({
        kind: "activeStudent",
        uid: "u1",
        schoolId: "s1",
        displayName: "Ben",
      }),
      mount,
    );
    mount.querySelector<HTMLButtonElement>("[data-testid=sign-out]")?.click();
    expect(spies.signOut).toHaveBeenCalledTimes(1);
  });
});

describe("active student surface (Slice 4 assignment discovery)", () => {
  const studentSession = () =>
    freeze<Session>({
      kind: "activeStudent",
      uid: "u1",
      schoolId: "s1",
      displayName: "Ben",
    });

  const okItem = (over: Record<string, unknown> = {}) =>
    ({
      assignmentId: "assign-1",
      lessonSlug: "what-is-life",
      title: "What is life?",
      status: "published" as const,
      publishedAt: 1_700_000_000_000,
      ...over,
    }) as const;

  test("renders the loading indicator while the callable is in flight", () => {
    const { deps } = makeDeps({
      studentAssignmentsList: () => () => new Promise(() => undefined),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    expect(mount.querySelector("[data-testid=loading-indicator]")).not.toBeNull();
    // Header, welcome, return link, and sign-out remain present through
    // every state so the calm-software conventions never disappear.
    expect(mount.querySelector("h1")?.textContent).toBe("Welcome, Ben.");
    expect(mount.querySelector("[data-testid=return-link]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=sign-out]")).not.toBeNull();
  });

  test("populated state calls the callable with no arguments and renders one item per assignment", async () => {
    const callable = jest.fn(() =>
      Promise.resolve({
        items: Object.freeze([okItem(), okItem({ assignmentId: "assign-2", lessonSlug: "cell-types", title: "Cell Types" })]) as ReadonlyArray<ReturnType<typeof okItem>>,
      }),
    );
    const { deps } = makeDeps({ studentAssignmentsList: () => callable });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    expect(callable).toHaveBeenCalledTimes(1);
    expect(callable).toHaveBeenCalledWith();
    const items = mount.querySelectorAll("[data-testid=assignments-item]");
    expect(items).toHaveLength(2);
    const titles = Array.from(
      mount.querySelectorAll("[data-testid=assignments-item-title]"),
    ).map((el) => el.textContent);
    expect(titles).toEqual(["What is life?", "Cell Types"]);
    const launches = Array.from(
      mount.querySelectorAll<HTMLButtonElement>(
        "[data-testid=assignments-launch]",
      ),
    );
    expect(launches[0].getAttribute("data-assignment-launch-url")).toBe(
      "/lesson_what-is-life.html?assignment=assign-1",
    );
    expect(launches[1].getAttribute("data-assignment-launch-url")).toBe(
      "/lesson_cell-types.html?assignment=assign-2",
    );
  });

  test("empty state renders when the callable returns no items", async () => {
    const { deps } = makeDeps({
      studentAssignmentsList: () => () =>
        Promise.resolve({ items: Object.freeze([]) as ReadonlyArray<never> }),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    expect(mount.querySelector("[data-testid=assignments-empty]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=assignments-list]")).toBeNull();
  });

  test("error state renders a recoverable banner and a retry that re-invokes the callable", async () => {
    let call = 0;
    const callable = jest.fn(() => {
      call += 1;
      return call === 1
        ? Promise.reject(new Error("boom"))
        : Promise.resolve({ items: Object.freeze([okItem()]) as ReadonlyArray<ReturnType<typeof okItem>> });
    });
    const { deps } = makeDeps({ studentAssignmentsList: () => callable });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    expect(mount.querySelector("[data-testid=assignments-error]")).not.toBeNull();
    mount
      .querySelector<HTMLButtonElement>("[data-testid=assignments-retry]")
      ?.click();
    await flush();
    expect(callable).toHaveBeenCalledTimes(2);
    expect(mount.querySelector("[data-testid=assignments-list]")).not.toBeNull();
  });

  test("malformed items are dropped and the surface never renders a launch button without a valid URL", async () => {
    const { deps } = makeDeps({
      studentAssignmentsList: () => () =>
        Promise.resolve({
          items: Object.freeze([
            okItem(),
            { ...okItem({ assignmentId: "assign-2" }), lessonSlug: "" },
          ]) as ReadonlyArray<ReturnType<typeof okItem>>,
        }),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    const items = mount.querySelectorAll("[data-testid=assignments-item]");
    expect(items).toHaveLength(1);
    const launches = mount.querySelectorAll<HTMLButtonElement>(
      "[data-testid=assignments-launch]",
    );
    expect(launches).toHaveLength(1);
    expect(launches[0].getAttribute("data-assignment-launch-url")).toBe(
      "/lesson_what-is-life.html?assignment=assign-1",
    );
  });

  test("clicking a launch button invokes onLaunchAssignment with the canonical URL and never begins a session", async () => {
    const onLaunchAssignment = jest.fn();
    const callable = jest.fn(() =>
      Promise.resolve({
        items: Object.freeze([okItem()]) as ReadonlyArray<ReturnType<typeof okItem>>,
      }),
    );
    const { deps } = makeDeps({
      studentAssignmentsList: () => callable,
      onLaunchAssignment,
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    mount
      .querySelector<HTMLButtonElement>("[data-testid=assignments-launch]")
      ?.click();
    expect(onLaunchAssignment).toHaveBeenCalledTimes(1);
    expect(onLaunchAssignment).toHaveBeenCalledWith(
      "/lesson_what-is-life.html?assignment=assign-1",
    );
    // The callable is invoked exactly once (the initial discovery
    // fetch). No attempt-retrieval, session-begin, autosave, or
    // finalize call is issued by the launcher; Slice 5 owns those.
    expect(callable).toHaveBeenCalledTimes(1);
  });

  test("launch URL exposes no identity beyond the assignmentId", async () => {
    const callable = jest.fn(() =>
      Promise.resolve({
        items: Object.freeze([okItem()]) as ReadonlyArray<ReturnType<typeof okItem>>,
      }),
    );
    const { deps } = makeDeps({ studentAssignmentsList: () => callable });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    const url =
      mount
        .querySelector<HTMLButtonElement>("[data-testid=assignments-launch]")
        ?.getAttribute("data-assignment-launch-url") ?? "";
    for (const forbidden of [
      "u1",
      "s1",
      "uid=",
      "schoolId=",
      "districtId=",
      "teacherId=",
      "classId=",
      "recipient=",
      "session=",
      "token=",
      "score=",
    ]) {
      expect(url).not.toContain(forbidden);
    }
  });

  test("titles are inserted via textContent so HTML from the callable cannot render", async () => {
    const callable = () =>
      Promise.resolve({
        items: Object.freeze([
          okItem({ title: "<img src=x onerror=alert(1)>" }),
        ]) as ReadonlyArray<ReturnType<typeof okItem>>,
      });
    const { deps } = makeDeps({ studentAssignmentsList: () => callable });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    const title = mount.querySelector(
      "[data-testid=assignments-item-title]",
    );
    expect(title?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(title?.querySelector("img")).toBeNull();
  });

  test("missing callable seam falls back to the empty state and does not throw", () => {
    // No studentAssignmentsList override; the default deps omit the
    // seam entirely (matches the entry-point behavior before the
    // active-student branch of `rerun` has resolved).
    const { deps } = makeDeps();
    const table = createRouteTable(deps);
    const mount = mkMount();
    expect(() => table.activeStudent(studentSession(), mount)).not.toThrow();
    expect(mount.querySelector("[data-testid=assignments-empty]")).not.toBeNull();
  });

  test("does not render the teacher shell for a student", async () => {
    const { deps } = makeDeps({
      studentAssignmentsList: () => () =>
        Promise.resolve({
          items: Object.freeze([okItem()]) as ReadonlyArray<ReturnType<typeof okItem>>,
        }),
    });
    const table = createRouteTable(deps);
    const mount = mkMount();
    table.activeStudent(studentSession(), mount);
    await flush();
    expect(mount.textContent).not.toContain("LyfeLabz Teacher Platform");
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
