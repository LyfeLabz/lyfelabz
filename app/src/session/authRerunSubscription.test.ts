/**
 * @jest-environment node
 */
import * as fs from "fs";
import * as path from "path";

import {
  subscribeAuthRerun,
  type AuthIdentity,
} from "./authRerunSubscription";

// A faithful fake of Firebase `onAuthStateChanged`: it invokes the callback
// immediately (synchronously here; Firebase does so on the next tick) with
// the CURRENT user, then again on every later sign-in / sign-out.
function fakeAuth(initial: AuthIdentity) {
  let current = initial;
  const callbacks: Array<(user: AuthIdentity) => void> = [];
  return {
    onAuthStateChanged: (callback: (user: AuthIdentity) => void) => {
      callbacks.push(callback);
      callback(current);
      return () => {
        const i = callbacks.indexOf(callback);
        if (i >= 0) callbacks.splice(i, 1);
      };
    },
    change: (user: AuthIdentity) => {
      current = user;
      for (const cb of [...callbacks]) cb(user);
    },
  };
}

describe("subscribeAuthRerun (one logical bootstrap per auth state)", () => {
  test("the immediate initial notification for the already-bootstrapped user does NOT rerun", () => {
    const auth = fakeAuth({ uid: "student-1" });
    const rerun = jest.fn();
    subscribeAuthRerun({
      bootstrappedUid: "student-1",
      onAuthStateChanged: auth.onAuthStateChanged,
      rerun,
    });
    expect(rerun).not.toHaveBeenCalled();
  });

  test("signed-out initial state: the immediate null notification does not rerun", () => {
    const auth = fakeAuth(null);
    const rerun = jest.fn();
    subscribeAuthRerun({ bootstrappedUid: null, onAuthStateChanged: auth.onAuthStateChanged, rerun });
    expect(rerun).not.toHaveBeenCalled();
  });

  test("real later changes still rerun exactly once each: sign-out, sign-in, account switch", () => {
    const auth = fakeAuth({ uid: "teacher-1" });
    const rerun = jest.fn();
    subscribeAuthRerun({ bootstrappedUid: "teacher-1", onAuthStateChanged: auth.onAuthStateChanged, rerun });

    auth.change(null); // sign-out
    expect(rerun).toHaveBeenCalledTimes(1);
    auth.change(null); // repeated identical notification
    expect(rerun).toHaveBeenCalledTimes(1);
    auth.change({ uid: "teacher-1" }); // sign back in
    expect(rerun).toHaveBeenCalledTimes(2);
    auth.change({ uid: "student-9" }); // different account
    expect(rerun).toHaveBeenCalledTimes(3);
  });

  test("if auth resolved a different user than the bootstrap saw, the first notification does rerun", () => {
    const auth = fakeAuth({ uid: "student-2" });
    const rerun = jest.fn();
    subscribeAuthRerun({ bootstrappedUid: null, onAuthStateChanged: auth.onAuthStateChanged, rerun });
    expect(rerun).toHaveBeenCalledTimes(1);
  });
});

describe("entry point wiring (regression pin)", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../index.ts"), "utf8");

  test("the entry point subscribes through subscribeAuthRerun, seeded with the bootstrapped uid", () => {
    expect(source).toMatch(/subscribeAuthRerun\(\{\s*bootstrappedUid: auth\.currentUser\?\.uid \?\? null/);
  });

  test("no raw onAuthStateChanged(auth, ...) listener reruns unconditionally", () => {
    expect(source).not.toMatch(/onAuthStateChanged\(auth,\s*\(\)\s*=>\s*\{\s*void rerun\(\)/);
  });
});
