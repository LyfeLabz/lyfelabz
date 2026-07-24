import { bootstrapSession } from "./bootstrap";
import type {
  BootstrapAuthInput,
  BootstrapAuthUser,
  BootstrapEnv,
  BootstrapFirestoreInput,
} from "./types";

type ClaimShape = Readonly<Record<string, unknown>>;

const makeUser = (
  uid: string,
  claimsFn: (forceRefresh: boolean) => ClaimShape,
  email: string | null = null,
): BootstrapAuthUser => {
  return {
    uid,
    email,
    getIdTokenResult: async (forceRefresh?: boolean) => ({
      claims: claimsFn(forceRefresh === true),
    }),
  };
};

const makeAuth = (user: BootstrapAuthUser | null): BootstrapAuthInput => ({
  waitForAuthState: async () => user,
});

const throwingAuth = (): BootstrapAuthInput => ({
  waitForAuthState: async () => {
    throw new Error("auth init failed");
  },
});

const makeDb = (docs: Record<string, unknown | undefined>): BootstrapFirestoreInput => ({
  getUser: async (uid) => {
    if (!(uid in docs)) {
      return { exists: false, data: () => undefined };
    }
    const data = docs[uid];
    if (data === undefined) {
      return { exists: false, data: () => undefined };
    }
    return { exists: true, data: () => data };
  },
});

const throwingDb = (): BootstrapFirestoreInput => ({
  getUser: async () => {
    throw new Error("read failed");
  },
});

// Stubbed delay so the userRecordMissing bounded retry does not add
// real wall-clock time to the suite. Retries still execute; they are
// just resolved synchronously on the microtask queue.
const zeroDelay = (): Promise<void> => Promise.resolve();
const onlineEnv: BootstrapEnv = { isOnline: () => true, delay: zeroDelay };
const offlineEnv: BootstrapEnv = { isOnline: () => false, delay: zeroDelay };

describe("bootstrapSession — unauthenticated", () => {
  test("resolves to unauthenticated when onAuthStateChanged returns null", async () => {
    const session = await bootstrapSession(makeAuth(null), makeDb({}), onlineEnv);
    expect(session).toEqual({ kind: "unauthenticated" });
    expect(Object.isFrozen(session)).toBe(true);
  });
});

describe("bootstrapSession — auth init failure", () => {
  test("resolves to error(authInitFailed) when waitForAuthState throws", async () => {
    const session = await bootstrapSession(throwingAuth(), makeDb({}), onlineEnv);
    expect(session).toEqual({ kind: "error", reason: "authInitFailed" });
  });

  test("resolves to error(authInitFailed) when getIdTokenResult throws", async () => {
    const user: BootstrapAuthUser = {
      uid: "u1",
      email: null,
      getIdTokenResult: async () => {
        throw new Error("no token");
      },
    };
    const db = makeDb({ u1: { status: "provisioned" } });
    const session = await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(session).toEqual({ kind: "error", reason: "authInitFailed" });
  });
});

describe("bootstrapSession — provisioned", () => {
  test("resolves to provisioned on a well-shaped provisioned record", async () => {
    const user = makeUser("u1", () => ({}));
    const db = makeDb({ u1: { status: "provisioned" } });
    const session = await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(session).toEqual({ kind: "provisioned", uid: "u1" });
    expect(Object.isFrozen(session)).toBe(true);
  });

  test("passes email through to the provisioned session when Auth carries it", async () => {
    const user = makeUser("u1", () => ({}), "a@example.com");
    const db = makeDb({ u1: { status: "provisioned", email: "a@example.com" } });
    const session = await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(session).toEqual({
      kind: "provisioned",
      uid: "u1",
      email: "a@example.com",
    });
  });
});

describe("bootstrapSession — pendingVerification", () => {
  test("resolves to pendingVerification on a well-shaped pending record with absent claims", async () => {
    const user = makeUser("u1", () => ({}));
    const db = makeDb({
      u1: {
        status: "pendingVerification",
        role: "teacher",
        schoolId: "s1",
        displayName: "Ada",
      },
    });
    const session = await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(session).toEqual({
      kind: "pendingVerification",
      uid: "u1",
      schoolId: "s1",
      displayName: "Ada",
    });
  });

  test("refuses teacher shell when record still says pending but claims already assert teacher (token ahead of record)", async () => {
    const user = makeUser("u1", () => ({ role: "teacher", schoolId: "s1" }));
    const db = makeDb({
      u1: {
        status: "pendingVerification",
        role: "teacher",
        schoolId: "s1",
        displayName: "Ada",
      },
    });
    const session = await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(session.kind).toBe("pendingVerification");
  });
});

describe("bootstrapSession — active teacher", () => {
  test("resolves to activeTeacher when claims match record with no force-refresh needed", async () => {
    let forceRefreshCalls = 0;
    const user = makeUser("u1", (force) => {
      if (force) forceRefreshCalls += 1;
      return { role: "teacher", schoolId: "s1" };
    });
    const db = makeDb({
      u1: {
        status: "active",
        role: "teacher",
        schoolId: "s1",
        displayName: "Ada",
      },
    });
    const session = await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(session).toEqual({
      kind: "activeTeacher",
      uid: "u1",
      schoolId: "s1",
      displayName: "Ada",
    });
    expect(forceRefreshCalls).toBe(0);
  });

  test("force-refreshes exactly once and resolves to activeTeacher when the fresh token matches the record", async () => {
    let calls = 0;
    const user = makeUser("u1", (force) => {
      calls += 1;
      if (!force) return {}; // stale token, no claims yet
      return { role: "teacher", schoolId: "s1" };
    });
    const db = makeDb({
      u1: {
        status: "active",
        role: "teacher",
        schoolId: "s1",
        displayName: "Ada",
      },
    });
    const session = await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(session.kind).toBe("activeTeacher");
    expect(calls).toBe(2);
  });

  test("degrades to pendingVerification when even the refreshed token still does not match", async () => {
    let refreshCalls = 0;
    const user = makeUser("u1", (force) => {
      if (force) refreshCalls += 1;
      return {}; // never gets claims
    });
    const db = makeDb({
      u1: {
        status: "active",
        role: "teacher",
        schoolId: "s1",
        displayName: "Ada",
      },
    });
    const session = await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(session).toEqual({
      kind: "pendingVerification",
      uid: "u1",
      schoolId: "s1",
      displayName: "Ada",
    });
    expect(refreshCalls).toBe(1);
  });

  test("force-refresh is bounded to a single call even under persistent drift", async () => {
    let forceCalls = 0;
    const user = makeUser("u1", (force) => {
      if (force) forceCalls += 1;
      return {};
    });
    const db = makeDb({
      u1: {
        status: "active",
        role: "teacher",
        schoolId: "s1",
        displayName: "Ada",
      },
    });
    await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(forceCalls).toBe(1);
  });
});

describe("bootstrapSession — active student and administrator", () => {
  test("resolves to activeStudent on a well-shaped active student record", async () => {
    const user = makeUser("u1", () => ({ role: "student", schoolId: "s1" }));
    const db = makeDb({
      u1: {
        status: "active",
        role: "student",
        schoolId: "s1",
        displayName: "Ben",
      },
    });
    const session = await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(session).toEqual({
      kind: "activeStudent",
      uid: "u1",
      schoolId: "s1",
      displayName: "Ben",
    });
  });

  test("resolves to activeAdministrator on a well-shaped platformAdministrator record", async () => {
    const user = makeUser("u1", () => ({
      role: "platformAdministrator",
      schoolId: "s1",
    }));
    const db = makeDb({
      u1: {
        status: "active",
        role: "platformAdministrator",
        schoolId: "s1",
        displayName: "Chris",
      },
    });
    const session = await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(session).toEqual({
      kind: "activeAdministrator",
      uid: "u1",
      schoolId: "s1",
      displayName: "Chris",
    });
  });
});

describe("bootstrapSession — reserved lifecycle states", () => {
  test("resolves to suspendedUser on a suspended record", async () => {
    const user = makeUser("u1", () => ({}));
    const db = makeDb({ u1: { status: "suspended" } });
    const session = await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(session).toEqual({ kind: "suspendedUser", uid: "u1" });
  });

  test("resolves to archivedUser on an archived record", async () => {
    const user = makeUser("u1", () => ({}));
    const db = makeDb({ u1: { status: "archived" } });
    const session = await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(session).toEqual({ kind: "archivedUser", uid: "u1" });
  });
});

describe("bootstrapSession — error kinds", () => {
  test("error(userRecordMissing) when snapshot does not exist after bounded retries", async () => {
    const user = makeUser("u1", () => ({}));
    let calls = 0;
    const db: BootstrapFirestoreInput = {
      getUser: async () => {
        calls++;
        return { exists: false, data: () => undefined };
      },
    };
    const session = await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(session).toEqual({ kind: "error", reason: "userRecordMissing" });
    // At least one retry attempted (initial read + >= 1 retry).
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  test("recovers from authOnUserCreate race: missing on first read, present on retry", async () => {
    // Regression for lyfelabz-prod: a brand-new Google sign-in reads
    // users/{uid} before the async authOnUserCreate trigger has landed
    // the provisioned record. The bounded retry gives the trigger a
    // calm window to complete before we surface a permanent
    // missing-record error.
    const user = makeUser("u1", () => ({}), "new@example.com");
    let calls = 0;
    const db: BootstrapFirestoreInput = {
      getUser: async () => {
        calls++;
        if (calls < 3) {
          return { exists: false, data: () => undefined };
        }
        return {
          exists: true,
          data: () => ({ status: "provisioned", email: "new@example.com" }),
        };
      },
    };
    const session = await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(session).toEqual({
      kind: "provisioned",
      uid: "u1",
      email: "new@example.com",
    });
    expect(calls).toBe(3);
  });

  test("bounded retry does not exceed the configured attempt count", async () => {
    const user = makeUser("u1", () => ({}));
    let calls = 0;
    const db: BootstrapFirestoreInput = {
      getUser: async () => {
        calls++;
        return { exists: false, data: () => undefined };
      },
    };
    const session = await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(session).toEqual({ kind: "error", reason: "userRecordMissing" });
    // 1 initial read + 6 retries = 7 total. Never unbounded.
    expect(calls).toBeLessThanOrEqual(7);
  });

  test("error(userRecordUnreadable) when the read rejects", async () => {
    const user = makeUser("u1", () => ({}));
    const session = await bootstrapSession(makeAuth(user), throwingDb(), onlineEnv);
    expect(session).toEqual({ kind: "error", reason: "userRecordUnreadable" });
  });

  test("error(networkUnavailable) when the browser reports offline", async () => {
    const user = makeUser("u1", () => ({}));
    const db = makeDb({ u1: { status: "provisioned" } });
    const session = await bootstrapSession(makeAuth(user), db, offlineEnv);
    expect(session).toEqual({ kind: "error", reason: "networkUnavailable" });
  });

  test("error(recordShapeInvalid) when status is missing", async () => {
    const user = makeUser("u1", () => ({}));
    const db = makeDb({ u1: { role: "teacher" } });
    const session = await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(session).toEqual({ kind: "error", reason: "recordShapeInvalid" });
  });

  test("error(recordShapeInvalid) when status is not in the closed enum", async () => {
    const user = makeUser("u1", () => ({}));
    const db = makeDb({ u1: { status: "banned" } });
    const session = await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(session).toEqual({ kind: "error", reason: "recordShapeInvalid" });
  });

  test("error(recordShapeInvalid) when active record is missing role", async () => {
    const user = makeUser("u1", () => ({}));
    const db = makeDb({
      u1: { status: "active", schoolId: "s1", displayName: "Ada" },
    });
    const session = await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(session).toEqual({ kind: "error", reason: "recordShapeInvalid" });
  });

  test("error(recordShapeInvalid) when active record is missing schoolId", async () => {
    const user = makeUser("u1", () => ({}));
    const db = makeDb({
      u1: { status: "active", role: "teacher", displayName: "Ada" },
    });
    const session = await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(session).toEqual({ kind: "error", reason: "recordShapeInvalid" });
  });

  test("error(recordShapeInvalid) when active record is missing displayName", async () => {
    const user = makeUser("u1", () => ({}));
    const db = makeDb({
      u1: { status: "active", role: "teacher", schoolId: "s1" },
    });
    const session = await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(session).toEqual({ kind: "error", reason: "recordShapeInvalid" });
  });

  test("error(recordShapeInvalid) when role is not canonical", async () => {
    const user = makeUser("u1", () => ({}));
    const db = makeDb({
      u1: {
        status: "active",
        role: "parent",
        schoolId: "s1",
        displayName: "Ada",
      },
    });
    const session = await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(session).toEqual({ kind: "error", reason: "recordShapeInvalid" });
  });
});

describe("bootstrapSession — immutability", () => {
  test("every constructed Session is frozen", async () => {
    const user = makeUser("u1", () => ({ role: "teacher", schoolId: "s1" }));
    const db = makeDb({
      u1: {
        status: "active",
        role: "teacher",
        schoolId: "s1",
        displayName: "Ada",
      },
    });
    const session = await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(Object.isFrozen(session)).toBe(true);
  });

  test("running the bootstrap twice returns two distinct Session objects", async () => {
    const user = makeUser("u1", () => ({}));
    const db = makeDb({ u1: { status: "provisioned" } });
    const a = await bootstrapSession(makeAuth(user), db, onlineEnv);
    const b = await bootstrapSession(makeAuth(user), db, onlineEnv);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
