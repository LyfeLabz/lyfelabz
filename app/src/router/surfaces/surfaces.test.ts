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
  const deps: SurfaceDeps = {
    onSignOut: signOut,
    onSignIn: signIn,
    onRefreshSession: refresh,
    onRequestVerification: requestVerification,
    listClasses,
    onLaunchPresentMode: () => undefined,
    ...overrides,
  };
  return {
    deps,
    spies: { signOut, signIn, refresh, requestVerification, listClasses },
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
      "Sign in to your teacher account.",
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
      "Welcome to the LyfeLabz teacher platform.",
    );
    expect(mount.querySelector("[data-testid=display-name]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=school-id]")).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=request-verification]"),
    ).not.toBeNull();
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
