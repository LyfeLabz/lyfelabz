/**
 * @jest-environment node
 */
import * as fs from "fs";
import * as path from "path";

import {
  subscribeAuthRerun,
  type AuthIdentity,
  type AuthRerunGate,
} from "./authRerunSubscription";

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
    const firstCheck = rerun.indexOf("if (!bootstrapIsSignedIn(session)) return;");
    expect(firstCheck).toBeGreaterThan(rerun.indexOf("await bootstrapSession("));
    expect(firstCheck).toBeLessThan(rerun.indexOf('if (session.kind === "activeTeacher")'));
    const afterImport = rerun.slice(rerun.indexOf('await import("firebase/functions")'));
    expect(afterImport.indexOf("if (!bootstrapIsSignedIn(session)) return;"))
      .toBeLessThan(afterImport.indexOf("integrations = createIntegrationsDeps("));
  });

  test("no raw onAuthStateChanged(auth, ...) listener reruns unconditionally", () => {
    expect(source).not.toMatch(/onAuthStateChanged\(auth,\s*\(\)\s*=>\s*\{\s*void rerun\(\)/);
  });
});
