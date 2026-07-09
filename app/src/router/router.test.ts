/**
 * @jest-environment jsdom
 */
import { dispatch, ROUTE_FOR_KIND, routeForSession } from "./router";
import { createRouteTable } from "./routes";
import type { Session } from "../session/types";

const freeze = <T>(v: T): T => Object.freeze(v) as T;

const noop = () => undefined;

describe("routeForSession", () => {
  const cases: Array<[Session, string]> = [
    [freeze<Session>({ kind: "unauthenticated" }), "/app/signin"],
    [freeze<Session>({ kind: "provisioned", uid: "u1" }), "/app/onboarding"],
    [
      freeze<Session>({
        kind: "pendingVerification",
        uid: "u1",
        schoolId: "s1",
        displayName: "Ada",
      }),
      "/app/pending",
    ],
    [
      freeze<Session>({
        kind: "activeTeacher",
        uid: "u1",
        schoolId: "s1",
        displayName: "Ada",
      }),
      "/app/teacher",
    ],
    [
      freeze<Session>({
        kind: "activeStudent",
        uid: "u1",
        schoolId: "s1",
        displayName: "Ben",
      }),
      "/app/student",
    ],
    [
      freeze<Session>({
        kind: "activeAdministrator",
        uid: "u1",
        schoolId: "s1",
        displayName: "Chris",
      }),
      "/app/signin",
    ],
    [freeze<Session>({ kind: "suspendedUser", uid: "u1" }), "/app/signin"],
    [freeze<Session>({ kind: "archivedUser", uid: "u1" }), "/app/signin"],
    [
      freeze<Session>({ kind: "error", reason: "userRecordMissing" }),
      "/app/signin",
    ],
  ];

  test.each(cases)("routes %j to %s", (session, expected) => {
    expect(routeForSession(session)).toBe(expected);
  });

  test("ROUTE_FOR_KIND covers every Session kind", () => {
    const kinds = new Set(Object.keys(ROUTE_FOR_KIND));
    for (const [session] of cases) kinds.delete(session.kind);
    expect(Array.from(kinds)).toEqual([]);
  });
});

describe("dispatch — renders the correct surface into the mount", () => {
  const mkMount = (): HTMLElement => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    return div;
  };

  const fakeHistory = () => {
    const calls: Array<{ url: string }> = [];
    return {
      replaceState: ((_state: unknown, _title: string, url?: string | null) => {
        calls.push({ url: String(url) });
      }) as History["replaceState"],
      calls,
    };
  };

  test("renders the sign-in stub for unauthenticated", () => {
    const mount = mkMount();
    const hist = fakeHistory();
    dispatch(
      freeze<Session>({ kind: "unauthenticated" }),
      createRouteTable(noop),
      mount,
      hist,
    );
    expect(mount.querySelector("h1")?.textContent).toBe("Sign in");
    expect(mount.querySelector("[data-testid=sign-out]")).toBeNull();
    expect(hist.calls[0].url).toBe("/app/signin");
  });

  test("renders the onboarding stub with a sign-out control for provisioned", () => {
    const mount = mkMount();
    const hist = fakeHistory();
    dispatch(
      freeze<Session>({ kind: "provisioned", uid: "u1" }),
      createRouteTable(noop),
      mount,
      hist,
    );
    expect(mount.querySelector("h1")?.textContent).toBe("Welcome to LyfeLabz");
    expect(mount.querySelector("[data-testid=sign-out]")).not.toBeNull();
    expect(hist.calls[0].url).toBe("/app/onboarding");
  });

  test("renders the teacher stub with displayName and schoolId", () => {
    const mount = mkMount();
    const hist = fakeHistory();
    dispatch(
      freeze<Session>({
        kind: "activeTeacher",
        uid: "u1",
        schoolId: "s1",
        displayName: "Ada",
      }),
      createRouteTable(noop),
      mount,
      hist,
    );
    expect(mount.querySelector("h1")?.textContent).toBe("Teacher");
    const lines = Array.from(mount.querySelectorAll("p")).map((p) => p.textContent);
    expect(lines).toEqual(["Ada", "s1"]);
    expect(hist.calls[0].url).toBe("/app/teacher");
  });

  test("renders the pending stub with the caller displayName", () => {
    const mount = mkMount();
    const hist = fakeHistory();
    dispatch(
      freeze<Session>({
        kind: "pendingVerification",
        uid: "u1",
        schoolId: "s1",
        displayName: "Ada",
      }),
      createRouteTable(noop),
      mount,
      hist,
    );
    expect(mount.querySelector("h1")?.textContent).toBe("Awaiting verification");
    expect(mount.querySelector("p")?.textContent).toBe("Ada");
    expect(hist.calls[0].url).toBe("/app/pending");
  });

  test("falls back to the sign-in surface for suspended, archived, and administrator kinds (no approved landing route)", () => {
    const mount = mkMount();
    const hist = fakeHistory();
    dispatch(
      freeze<Session>({ kind: "suspendedUser", uid: "u1" }),
      createRouteTable(noop),
      mount,
      hist,
    );
    expect(mount.querySelector("h1")?.textContent).toBe("Sign in");
    expect(mount.querySelector("[data-testid=error-banner]")).toBeNull();
    expect(mount.querySelector("[data-testid=sign-out]")).toBeNull();
    expect(hist.calls[0].url).toBe("/app/signin");

    const mount2 = mkMount();
    dispatch(
      freeze<Session>({ kind: "archivedUser", uid: "u1" }),
      createRouteTable(noop),
      mount2,
      hist,
    );
    expect(mount2.querySelector("h1")?.textContent).toBe("Sign in");

    const mount3 = mkMount();
    dispatch(
      freeze<Session>({
        kind: "activeAdministrator",
        uid: "u1",
        schoolId: "s1",
        displayName: "Chris",
      }),
      createRouteTable(noop),
      mount3,
      hist,
    );
    expect(mount3.querySelector("h1")?.textContent).toBe("Sign in");
  });

  test("renders the sign-in stub with an error banner for error sessions", () => {
    const mount = mkMount();
    const hist = fakeHistory();
    dispatch(
      freeze<Session>({ kind: "error", reason: "userRecordUnreadable" }),
      createRouteTable(noop),
      mount,
      hist,
    );
    expect(mount.querySelector("h1")?.textContent).toBe("Sign in");
    expect(mount.querySelector("[data-testid=error-banner]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=sign-out]")).toBeNull();
    expect(hist.calls[0].url).toBe("/app/signin");
  });

  test("invokes the sign-out handler when the sign-out control is clicked", () => {
    const mount = mkMount();
    let calls = 0;
    dispatch(
      freeze<Session>({ kind: "provisioned", uid: "u1" }),
      createRouteTable(() => {
        calls += 1;
      }),
      mount,
      fakeHistory(),
    );
    const btn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=sign-out]",
    );
    btn?.click();
    expect(calls).toBe(1);
  });

  test("clears the previous surface before rendering the next", () => {
    const mount = mkMount();
    const hist = fakeHistory();
    dispatch(
      freeze<Session>({ kind: "provisioned", uid: "u1" }),
      createRouteTable(noop),
      mount,
      hist,
    );
    dispatch(
      freeze<Session>({
        kind: "activeTeacher",
        uid: "u1",
        schoolId: "s1",
        displayName: "Ada",
      }),
      createRouteTable(noop),
      mount,
      hist,
    );
    expect(mount.querySelectorAll("h1")).toHaveLength(1);
    expect(mount.querySelector("h1")?.textContent).toBe("Teacher");
  });
});
