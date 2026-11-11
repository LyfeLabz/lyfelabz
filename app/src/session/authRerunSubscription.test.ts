/**
 * @jest-environment node
 */
import * as fs from "fs";
import * as path from "path";

import {
  bootstrapIdentity,
  subscribeAuthRerun,
  trackResolvedIdentity,
  type AuthIdentity,
  type AuthRerunGate,
} from "./authRerunSubscription";
import type { Session } from "./types";

// A faithful fake of Firebase auth: `currentUser` changes at once, while
// `onAuthStateChanged` callbacks are queued (Firebase delivers them later)
// and run by `deliver()`. Registration queues the CURRENT user.
function fakeAuth(initial: AuthIdentity) {
  let current = initial;
  const callbacks: Array<(user: AuthIdentity) => void> = [];
  const queue: Array<() => void> = [];
  return {
    onAuthStateChanged: (callback: (user: AuthIdentity) => void) => {
      callbacks.push(callback);
      const user = current;
      queue.push(() => callback(user));
      return () => {
        const i = callbacks.indexOf(callback);
        if (i >= 0) callbacks.splice(i, 1);
      };
    },
    readCurrentUid: (): string | null => current?.uid ?? null,
    // The account changes now; its notification waits for `deliver`.
    switchTo: (user: AuthIdentity) => {
      current = user;
      for (const cb of [...callbacks]) queue.push(() => cb(user));
    },
    change: (user: AuthIdentity) => {
      current = user;
      for (const cb of [...callbacks]) queue.push(() => cb(user));
      while (queue.length > 0) queue.shift()!();
    },
    deliver: () => {
      while (queue.length > 0) queue.shift()!();
    },
  };
}

const subscribe = (auth: ReturnType<typeof fakeAuth>, rerun: () => void): AuthRerunGate =>
  subscribeAuthRerun({ onAuthStateChanged: auth.onAuthStateChanged, readCurrentUid: auth.readCurrentUid, rerun });

describe("subscribeAuthRerun (one logical bootstrap per auth state)", () => {
  test("the first notification for the user the initial bootstrap is resolving does NOT rerun", () => {
    const auth = fakeAuth({ uid: "student-1" });
    const rerun = jest.fn();
    const gate = subscribe(auth, rerun);
    auth.deliver();
    expect(gate.check("student-1")).toBe("current");
    expect(rerun).not.toHaveBeenCalled();
  });

  test("signed-out initial state: the first null notification does not rerun", () => {
    const auth = fakeAuth(null);
    const rerun = jest.fn();
    const gate = subscribe(auth, rerun);
    expect(gate.check(null)).toBe("current");
    auth.deliver();
    expect(rerun).not.toHaveBeenCalled();
  });

  test("real later changes still rerun exactly once each: sign-out, sign-in, account switch", () => {
    const auth = fakeAuth({ uid: "teacher-1" });
    const rerun = jest.fn();
    const gate = subscribe(auth, rerun);
    auth.deliver();
    gate.check("teacher-1");

    auth.change(null); // sign-out
    expect(rerun).toHaveBeenCalledTimes(1);
    auth.change(null); // repeated identical notification
    expect(rerun).toHaveBeenCalledTimes(1);
    auth.change({ uid: "teacher-1" }); // sign back in
    expect(rerun).toHaveBeenCalledTimes(2);
    auth.change({ uid: "student-9" }); // different account
    expect(rerun).toHaveBeenCalledTimes(3);
  });

  test("a same-UID rebootstrap (activation, refresh) is accepted without an extra rerun", () => {
    const auth = fakeAuth({ uid: "teacher-1" });
    const rerun = jest.fn();
    const gate = subscribe(auth, rerun);
    auth.deliver();
    expect(gate.check("teacher-1")).toBe("current");
    expect(gate.check("teacher-1")).toBe("current");
    expect(rerun).not.toHaveBeenCalled();
  });
});

// Sol P1: the initial bootstrap races an account change in another tab.
// This drives the same sequence the entry point runs: subscribe, start the
// initial bootstrap (token + identity), let auth switch while the bootstrap
// waits on the user record, then let the bootstrap resolve.
describe("initial bootstrap race against an account change", () => {
  type Mounted = { uid: string | null; token: number };
  function harness(initial: AuthIdentity) {
    const auth = fakeAuth(initial);
    let token = 0;
    const mounted: Mounted[] = [];
    const pending: Array<{ uid: string | null; token: number; finish: () => void }> = [];
    // Assigned right after the subscription that `rerun` closes over.
    const gateRef: { current: AuthRerunGate | null } = { current: null };
    // Mirrors `rerun`: read the identity, await the record read, then
    // install only if still the latest run AND still the signed-in identity.
    const rerun = (): void => {
      const runToken = ++token;
      const uid = auth.readCurrentUid();
      pending.push({ uid, token: runToken, finish: () => {
        if (runToken !== token) return;
        const result = gateRef.current!.check(uid);
        if (result === "stale") rerun();
        if (result === "current") mounted.push({ uid, token: runToken });
      } });
    };
    gateRef.current = subscribe(auth, rerun);
    rerun(); // the initial bootstrap, after subscription
    const finishAll = (): void => { while (pending.length > 0) pending.shift()!.finish(); };
    return { auth, mounted, finishAll, pending };
  }

  test("A's bootstrap completing after a switch to B installs nothing; B is installed once", () => {
    const h = harness({ uid: "A" });
    h.auth.deliver(); // first notification: A (duplicate, no rerun)
    h.auth.switchTo({ uid: "B" }); // another tab, notification still queued
    h.finishAll(); // A's record read resolves
    expect(h.mounted).toEqual([]);
    h.auth.deliver(); // B's notification reruns
    h.finishAll();
    expect(h.mounted.map((m) => m.uid)).toEqual(["B"]);
  });

  test("the switch happens before the first notification is delivered", () => {
    const h = harness({ uid: "A" });
    h.auth.switchTo({ uid: "B" });
    h.finishAll(); // A resolves: auth already settled on B, no observation yet
    h.auth.deliver(); // queued A then B notifications
    h.finishAll();
    expect(h.mounted.map((m) => m.uid)).toEqual(["B"]);
  });

  test("a switch after A installed reruns for B exactly once", () => {
    const h = harness({ uid: "A" });
    h.auth.deliver();
    h.finishAll();
    expect(h.mounted.map((m) => m.uid)).toEqual(["A"]);
    h.auth.switchTo({ uid: "B" });
    h.auth.deliver();
    h.finishAll();
    expect(h.mounted.map((m) => m.uid)).toEqual(["A", "B"]);
  });

  test("sign-out during the initial bootstrap installs the signed-out state only", () => {
    const h = harness({ uid: "A" });
    h.auth.deliver();
    h.auth.switchTo(null);
    h.finishAll();
    h.auth.deliver();
    h.finishAll();
    expect(h.mounted.map((m) => m.uid)).toEqual([null]);
  });
});

// Checkpoint 6C-2 (P3-1): a bootstrap that ends in an error (for example an
// unreadable user record) is checked against the identity it resolved, like
// any other session, so a later identity change never leaves the previous
// user's error screen up.
describe("error bootstrap and authentication changes", () => {
  type Installed = { uid: string | null; kind: "error" | "ok" };
  function harness(initial: AuthIdentity, failing: ReadonlySet<string>) {
    const auth = fakeAuth(initial);
    let token = 0;
    let bootstraps = 0;
    const installed: Installed[] = [];
    const pending: Array<() => void> = [];
    const gateRef: { current: AuthRerunGate | null } = { current: null };
    // Mirrors `rerun` + `bootstrapIsSignedIn`: the identity is resolved from
    // auth, the record read fails for uids in `failing`, and the resulting
    // session (error or not) is installed only if still signed in.
    const rerun = (): void => {
      const runToken = ++token;
      bootstraps += 1;
      const uid = auth.readCurrentUid();
      pending.push(() => {
        if (runToken !== token) return;
        const session: Session = uid !== null && failing.has(uid)
          ? { kind: "error", reason: "userRecordUnreadable" }
          : uid === null ? { kind: "unauthenticated" } : { kind: "suspendedUser", uid };
        const identity = bootstrapIdentity(session, uid);
        const result = identity === undefined ? "current" : gateRef.current!.check(identity);
        if (result === "stale") rerun();
        if (result === "current") installed.push({ uid, kind: session.kind === "error" ? "error" : "ok" });
      });
    };
    gateRef.current = subscribe(auth, rerun);
    rerun();
    const finishAll = (): void => { while (pending.length > 0) pending.shift()!(); };
    return { auth, installed, finishAll, rerun, bootstraps: () => bootstraps };
  }

  test("initial bootstrap failure, then an account switch before the first notification, reruns for B", () => {
    const h = harness({ uid: "A" }, new Set(["A"]));
    h.finishAll(); // A's error screen installed before any notification
    expect(h.installed).toEqual([{ uid: "A", kind: "error" }]);
    h.auth.switchTo({ uid: "B" });
    h.auth.deliver(); // queued A (dropped as stale) then B
    h.finishAll();
    expect(h.installed).toEqual([{ uid: "A", kind: "error" }, { uid: "B", kind: "ok" }]);
  });

  test("a failure resolved after auth already switched installs nothing and reruns for B", () => {
    const h = harness({ uid: "A" }, new Set(["A"]));
    h.auth.switchTo({ uid: "B" });
    h.finishAll(); // A's failure lands after the switch: stale
    h.auth.deliver();
    h.finishAll();
    expect(h.installed).toEqual([{ uid: "B", kind: "ok" }]);
  });

  test("sign-out during an error state installs the signed-out state, before or after the first notification", () => {
    const before = harness({ uid: "A" }, new Set(["A"]));
    before.finishAll();
    before.auth.switchTo(null);
    before.auth.deliver();
    before.finishAll();
    expect(before.installed.map((i) => i.uid)).toEqual(["A", null]);

    const after = harness({ uid: "A" }, new Set(["A"]));
    after.auth.deliver();
    after.finishAll();
    after.auth.change(null);
    after.finishAll();
    expect(after.installed.map((i) => i.uid)).toEqual(["A", null]);
  });

  test("recovery after the authentication notification: Try again and a later switch each bootstrap once", () => {
    const failing = new Set(["A"]);
    const h = harness({ uid: "A" }, failing);
    h.auth.deliver();
    h.finishAll();
    expect(h.installed).toEqual([{ uid: "A", kind: "error" }]);
    failing.delete("A");
    h.rerun(); // Try again
    h.finishAll();
    expect(h.installed[h.installed.length - 1]).toEqual({ uid: "A", kind: "ok" });
    h.auth.change({ uid: "B" });
    h.finishAll();
    expect(h.installed[h.installed.length - 1]).toEqual({ uid: "B", kind: "ok" });
    expect(h.bootstraps()).toBe(3);
  });

  test("no duplicate bootstrap for an unchanged identity after an error", () => {
    const early = harness({ uid: "A" }, new Set(["A"]));
    early.finishAll(); // error installed before the first notification
    early.auth.deliver();
    early.finishAll();
    expect(early.bootstraps()).toBe(1);

    const late = harness({ uid: "A" }, new Set(["A"]));
    late.auth.deliver();
    late.finishAll();
    late.auth.change({ uid: "A" }); // repeated identical notification
    late.finishAll();
    expect(late.bootstraps()).toBe(1);
    expect(late.installed).toEqual([{ uid: "A", kind: "error" }]);
  });

  test("bootstrapIdentity: an error belongs to the resolved identity; auth init failure has none", () => {
    expect(bootstrapIdentity({ kind: "error", reason: "userRecordUnreadable" }, "A")).toBe("A");
    expect(bootstrapIdentity({ kind: "error", reason: "authInitFailed" }, undefined)).toBeUndefined();
    expect(bootstrapIdentity({ kind: "unauthenticated" }, null)).toBeNull();
    expect(bootstrapIdentity({ kind: "suspendedUser", uid: "S" }, "S")).toBe("S");
  });

  test("trackResolvedIdentity records the uid auth resolved, null when signed out, undefined when auth failed", async () => {
    const user = { uid: "A", email: null, getIdTokenResult: async () => ({ claims: {} }) };
    const signedIn = trackResolvedIdentity({ waitForAuthState: async () => user });
    expect(signedIn.resolvedUid()).toBeUndefined();
    await expect(signedIn.input.waitForAuthState()).resolves.toBe(user);
    expect(signedIn.resolvedUid()).toBe("A");
    const signedOut = trackResolvedIdentity({ waitForAuthState: async () => null });
    await signedOut.input.waitForAuthState();
    expect(signedOut.resolvedUid()).toBeNull();
    const failed = trackResolvedIdentity({ waitForAuthState: async () => { throw new Error("init"); } });
    await expect(failed.input.waitForAuthState()).rejects.toThrow("init");
    expect(failed.resolvedUid()).toBeUndefined();
  });
});

describe("entry point wiring (regression pin)", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../index.ts"), "utf8");
  const runTail = source.slice(source.lastIndexOf("authGate = subscribeAuthRerun({"));

  test("the entry point subscribes BEFORE the initial bootstrap", () => {
    expect(runTail.indexOf("authGate = subscribeAuthRerun({")).toBe(0);
    expect(runTail.indexOf("await rerun();")).toBeGreaterThan(0);
    expect(runTail).toMatch(/readCurrentUid: \(\) => auth\.currentUser\?\.uid \?\? null/);
  });

  test("a resolved bootstrap is checked against the signed-in identity before teacher dependencies", () => {
    const rerun = source.slice(source.indexOf("const rerun = async"));
    const CHECK = "if (!bootstrapIsSignedIn(session, resolvedAuth.resolvedUid())) return;";
    const firstCheck = rerun.indexOf(CHECK);
    expect(firstCheck).toBeGreaterThan(rerun.indexOf("await bootstrapSession("));
    expect(firstCheck).toBeLessThan(rerun.indexOf('if (session.kind === "activeTeacher")'));
    const afterImport = rerun.slice(rerun.indexOf('await import("firebase/functions")'));
    expect(afterImport.indexOf(CHECK))
      .toBeLessThan(afterImport.indexOf("integrations = createIntegrationsDeps("));
  });

  test("error sessions are not exempt: the bootstrap reads auth through the identity tracker", () => {
    const rerun = source.slice(source.indexOf("const rerun = async"));
    expect(rerun.indexOf("trackResolvedIdentity(createAuthInput(auth))"))
      .toBeLessThan(rerun.indexOf("await bootstrapSession("));
    expect(rerun).toMatch(/bootstrapSession\(\s*resolvedAuth\.input,/);
    const gate = source.slice(source.indexOf("const bootstrapIsSignedIn"), source.indexOf("const rerun = async"));
    expect(gate).not.toMatch(/session\.kind === "error"\) return true/);
    expect(gate).toContain("bootstrapIdentity(session, resolvedUid)");
  });

  test("no raw onAuthStateChanged(auth, ...) listener reruns unconditionally", () => {
    expect(source).not.toMatch(/onAuthStateChanged\(auth,\s*\(\)\s*=>\s*\{\s*void rerun\(\)/);
  });
});
