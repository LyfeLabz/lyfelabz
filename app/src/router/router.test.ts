/**
 * @jest-environment jsdom
 */
import { dispatch, ROUTE_FOR_KIND, routeForSession } from "./router";
import { createSignOutOnlyRouteTable } from "./routes";
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

  test("renders the signed-out surface for unauthenticated (no sign-out control)", () => {
    const mount = mkMount();
    const hist = fakeHistory();
    dispatch(
      freeze<Session>({ kind: "unauthenticated" }),
      createSignOutOnlyRouteTable(noop),
      mount,
      hist,
    );
    expect(mount.querySelector("h1")?.textContent).toBe(
      "Sign in to LyfeLabz.",
    );
    expect(mount.querySelector("[data-testid=sign-out]")).toBeNull();
    expect(hist.calls[0].url).toBe("/app/signin");
  });

  test("renders the active student landing surface with sign-out and return-to-lessons", () => {
    const mount = mkMount();
    const hist = fakeHistory();
    dispatch(
      freeze<Session>({
        kind: "activeStudent",
        uid: "u1",
        schoolId: "s1",
        displayName: "Ben",
      }),
      createSignOutOnlyRouteTable(noop),
      mount,
      hist,
    );
    expect(mount.querySelector("h1")?.textContent).toBe("Welcome, Ben.");
    expect(mount.querySelector("[data-testid=sign-out]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=return-link]")).not.toBeNull();
    // Opaque identifiers must never render on the student surface.
    expect(mount.textContent).not.toContain("s1");
    expect(mount.textContent).not.toContain("u1");
    expect(hist.calls[0].url).toBe("/app/student");
  });

  test("renders the provisioned surface with a sign-out control", () => {
    const mount = mkMount();
    const hist = fakeHistory();
    dispatch(
      freeze<Session>({ kind: "provisioned", uid: "u1" }),
      createSignOutOnlyRouteTable(noop),
      mount,
      hist,
    );
    expect(mount.querySelector("h1")?.textContent).toBe(
      "Welcome to the LyfeLabz teacher platform.",
    );
    expect(mount.querySelector("[data-testid=sign-out]")).not.toBeNull();
    expect(hist.calls[0].url).toBe("/app/onboarding");
  });

  test("renders the active teacher shell with the welcome message and product brand", () => {
    const mount = mkMount();
    const hist = fakeHistory();
    dispatch(
      freeze<Session>({
        kind: "activeTeacher",
        uid: "u1",
        schoolId: "s1",
        displayName: "Ada",
      }),
      createSignOutOnlyRouteTable(noop),
      mount,
      hist,
    );
    // Product mark is the h1 per shell spec §8.1.
    expect(mount.querySelector("h1")?.textContent).toBe(
      "LyfeLabz Teacher Platform",
    );
    // Welcome message is an h2 inside the Home surface.
    expect(mount.querySelector("h2")?.textContent).toBe("Welcome, Ada.");
    // Opaque schoolId must never render in the shell (spec §7.2).
    expect(mount.textContent).not.toContain("s1");
    expect(hist.calls[0].url).toBe("/app/teacher");
  });

  test("renders the pending surface with a check-status button", () => {
    const mount = mkMount();
    const hist = fakeHistory();
    dispatch(
      freeze<Session>({
        kind: "pendingVerification",
        uid: "u1",
        schoolId: "s1",
        displayName: "Ada",
      }),
      createSignOutOnlyRouteTable(noop),
      mount,
      hist,
    );
    expect(mount.querySelector("h1")?.textContent).toBe(
      "Your verification is pending.",
    );
    expect(mount.querySelector("[data-testid=check-status]")).not.toBeNull();
    expect(hist.calls[0].url).toBe("/app/pending");
  });

  test("renders distinct surfaces for suspended, archived, administrator", () => {
    const s = mkMount();
    const hist = fakeHistory();
    dispatch(
      freeze<Session>({ kind: "suspendedUser", uid: "u1" }),
      createSignOutOnlyRouteTable(noop),
      s,
      hist,
    );
    expect(s.querySelector("h1")?.textContent).toBe(
      "Your account is not available right now.",
    );
    expect(s.querySelector("[data-testid=sign-out]")).not.toBeNull();
    expect(hist.calls.at(-1)?.url).toBe("/app/signin");

    const a = mkMount();
    dispatch(
      freeze<Session>({ kind: "archivedUser", uid: "u1" }),
      createSignOutOnlyRouteTable(noop),
      a,
      hist,
    );
    expect(a.querySelector("h1")?.textContent).toBe(
      "This account has been archived.",
    );
    expect(hist.calls.at(-1)?.url).toBe("/app/signin");

    const ad = mkMount();
    dispatch(
      freeze<Session>({
        kind: "activeAdministrator",
        uid: "u1",
        schoolId: "s1",
        displayName: "Chris",
      }),
      createSignOutOnlyRouteTable(noop),
      ad,
      hist,
    );
    expect(ad.querySelector("h1")?.textContent).toBe(
      "You are signed in as a platform administrator.",
    );
    expect(hist.calls.at(-1)?.url).toBe("/app/signin");
  });

  test("renders the error surface with the specified copy per reason", () => {
    const mount = mkMount();
    const hist = fakeHistory();
    dispatch(
      freeze<Session>({ kind: "error", reason: "userRecordUnreadable" }),
      createSignOutOnlyRouteTable(noop),
      mount,
      hist,
    );
    expect(mount.querySelector("h1")?.textContent).toBe(
      "We could not load your account.",
    );
    expect(mount.querySelector("[data-testid=retry]")).not.toBeNull();
    expect(hist.calls[0].url).toBe("/app/signin");
  });

  test("invokes the sign-out handler when the sign-out control is clicked", () => {
    const mount = mkMount();
    let calls = 0;
    dispatch(
      freeze<Session>({ kind: "provisioned", uid: "u1" }),
      createSignOutOnlyRouteTable(() => {
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
      createSignOutOnlyRouteTable(noop),
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
      createSignOutOnlyRouteTable(noop),
      mount,
      hist,
    );
    // After switching to the teacher shell the mount contains exactly
    // one h1 (product mark) and one h2 (welcome message).
    expect(mount.querySelectorAll("h1")).toHaveLength(1);
    expect(mount.querySelector("h1")?.textContent).toBe(
      "LyfeLabz Teacher Platform",
    );
    expect(mount.querySelector("h2")?.textContent).toBe("Welcome, Ada.");
  });
});
