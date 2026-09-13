import type { CallableRequest } from "firebase-functions/v2/https";

// Phase 8G.12 Part 2 - authoritative Platform Administrator guard.
//
// Proves a stale administrator token cannot retain administrative authority
// after canonical demotion, suspension, archival, or authUid divergence,
// while a legitimate active canonical administrator continues to succeed.

const users = new Map<string, Record<string, unknown> | undefined>();
const schools = new Map<string, Record<string, unknown> | undefined>();

function snapshot(data: Record<string, unknown> | undefined) {
  return { exists: data !== undefined, data: () => data };
}

jest.mock("../firestore/typed-ref", () => ({
  // Each ref carries a token (__uid / __schoolId) so the same ref works for
  // the non-transactional path (`.get()`) and the transactional path
  // (`tx.get(ref)`), which reads the token.
  userRecordDocRef: (uid: string) => ({
    __uid: uid,
    get: () => Promise.resolve(snapshot(users.get(uid))),
  }),
  schoolDocRef: (schoolId: string) => ({
    __schoolId: schoolId,
    get: () => Promise.resolve(snapshot(schools.get(schoolId))),
  }),
}));

import { PlatformError } from "../errors/platform-error";
import {
  assertActivePlatformAdministratorInTransaction,
  requireActivePlatformAdministrator,
} from "./require-active-platform-administrator";

// Fake transaction whose get() resolves from the same in-memory maps by the
// ref token.
function fakeTx() {
  return {
    get: (ref: { __uid?: string; __schoolId?: string }) => {
      if (ref.__schoolId !== undefined) return Promise.resolve(snapshot(schools.get(ref.__schoolId)));
      return Promise.resolve(snapshot(users.get(ref.__uid as string)));
    },
  } as never;
}

const ADMIN_UID = "uid-admin";
const SCHOOL_ID = "school-1";
const DISTRICT_ID = "district-1";

function makeRequest(
  overrides: {
    uid?: string;
    hasAuth?: boolean;
    token?: Record<string, unknown> | null;
  } = {},
): CallableRequest<unknown> {
  const hasAuth = overrides.hasAuth ?? true;
  const uid = overrides.uid ?? ADMIN_UID;
  const token =
    overrides.token === undefined
      ? { role: "platformAdministrator" }
      : overrides.token;
  return {
    data: {},
    auth: hasAuth ? ({ uid, token: token ?? undefined } as never) : undefined,
    rawRequest: {} as never,
  };
}

function seedActiveAdmin() {
  users.set(ADMIN_UID, {
    authUid: ADMIN_UID,
    status: "active",
    role: "platformAdministrator",
    schoolId: SCHOOL_ID,
    createdAt: {},
  });
  schools.set(SCHOOL_ID, { name: "S", districtId: DISTRICT_ID });
}

describe("requireActivePlatformAdministrator", () => {
  beforeEach(() => {
    users.clear();
    schools.clear();
    seedActiveAdmin();
  });

  test("legitimate active canonical administrator succeeds with canonical tenant context", async () => {
    const ctx = await requireActivePlatformAdministrator(makeRequest());
    expect(ctx).toEqual({
      uid: ADMIN_UID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
    });
  });

  test("unauthenticated caller is rejected", async () => {
    await expect(
      requireActivePlatformAdministrator(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({ code: "admin.unauthenticated" });
  });

  test("caller without the administrator claim is rejected", async () => {
    await expect(
      requireActivePlatformAdministrator(
        makeRequest({ token: { role: "teacher" } }),
      ),
    ).rejects.toMatchObject({ code: "admin.unauthorized" });
  });

  test("stale admin token whose canonical record was DEMOTED to teacher is denied", async () => {
    users.set(ADMIN_UID, {
      authUid: ADMIN_UID,
      status: "active",
      role: "teacher",
      schoolId: SCHOOL_ID,
      createdAt: {},
    });
    await expect(
      requireActivePlatformAdministrator(makeRequest()),
    ).rejects.toMatchObject({ code: "admin.unauthorized" });
  });

  test("stale admin token whose canonical record was SUSPENDED is denied", async () => {
    users.set(ADMIN_UID, {
      authUid: ADMIN_UID,
      status: "suspended",
      role: "platformAdministrator",
      schoolId: SCHOOL_ID,
      createdAt: {},
    });
    await expect(
      requireActivePlatformAdministrator(makeRequest()),
    ).rejects.toMatchObject({ code: "admin.unauthorized" });
  });

  test("stale admin token whose canonical record was ARCHIVED is denied", async () => {
    users.set(ADMIN_UID, {
      authUid: ADMIN_UID,
      status: "archived",
      role: "platformAdministrator",
      schoolId: SCHOOL_ID,
      createdAt: {},
    });
    await expect(
      requireActivePlatformAdministrator(makeRequest()),
    ).rejects.toMatchObject({ code: "admin.unauthorized" });
  });

  test("authUid divergence between token UID and canonical record is denied", async () => {
    users.set(ADMIN_UID, {
      authUid: "someone-else",
      status: "active",
      role: "platformAdministrator",
      schoolId: SCHOOL_ID,
      createdAt: {},
    });
    await expect(
      requireActivePlatformAdministrator(makeRequest()),
    ).rejects.toMatchObject({ code: "admin.unauthorized" });
  });

  test("missing canonical record is denied", async () => {
    users.delete(ADMIN_UID);
    await expect(
      requireActivePlatformAdministrator(makeRequest()),
    ).rejects.toMatchObject({ code: "admin.unauthorized" });
  });

  test("administrator record without a schoolId is denied", async () => {
    users.set(ADMIN_UID, {
      authUid: ADMIN_UID,
      status: "active",
      role: "platformAdministrator",
      createdAt: {},
    });
    await expect(
      requireActivePlatformAdministrator(makeRequest()),
    ).rejects.toMatchObject({ code: "admin.unauthorized" });
  });

  test("administrator school without a district is denied", async () => {
    schools.set(SCHOOL_ID, { name: "S" });
    await expect(
      requireActivePlatformAdministrator(makeRequest()),
    ).rejects.toMatchObject({ code: "admin.unauthorized" });
  });

  test("custom error id namespace is honored", async () => {
    users.delete(ADMIN_UID);
    await expect(
      requireActivePlatformAdministrator(makeRequest(), {
        unauthorizedCode: "schools.unauthorized",
      }),
    ).rejects.toMatchObject({ code: "schools.unauthorized" });
  });

  test("thrown errors are PlatformError instances", async () => {
    users.delete(ADMIN_UID);
    await expect(
      requireActivePlatformAdministrator(makeRequest()),
    ).rejects.toBeInstanceOf(PlatformError);
  });
});

describe("assertActivePlatformAdministratorInTransaction", () => {
  beforeEach(() => {
    users.clear();
    schools.clear();
    seedActiveAdmin();
  });

  test("active canonical administrator succeeds with canonical tenant context", async () => {
    const ctx = await assertActivePlatformAdministratorInTransaction(fakeTx(), ADMIN_UID);
    expect(ctx).toEqual({ uid: ADMIN_UID, schoolId: SCHOOL_ID, districtId: DISTRICT_ID });
  });

  test.each([
    ["demoted to teacher", { role: "teacher" }],
    ["suspended", { status: "suspended" }],
    ["archived", { status: "archived" }],
    ["authUid divergence", { authUid: "someone-else" }],
  ])("denies a stale admin whose canonical record is %s", async (_label, patch) => {
    users.set(ADMIN_UID, {
      authUid: ADMIN_UID,
      status: "active",
      role: "platformAdministrator",
      schoolId: SCHOOL_ID,
      createdAt: {},
      ...patch,
    });
    await expect(
      assertActivePlatformAdministratorInTransaction(fakeTx(), ADMIN_UID),
    ).rejects.toMatchObject({ code: "admin.unauthorized" });
  });

  test("missing canonical record is denied", async () => {
    users.delete(ADMIN_UID);
    await expect(
      assertActivePlatformAdministratorInTransaction(fakeTx(), ADMIN_UID),
    ).rejects.toMatchObject({ code: "admin.unauthorized" });
  });

  test("administrator school without a district is denied", async () => {
    schools.set(SCHOOL_ID, { name: "S" });
    await expect(
      assertActivePlatformAdministratorInTransaction(fakeTx(), ADMIN_UID),
    ).rejects.toMatchObject({ code: "admin.unauthorized" });
  });

  test("custom error id namespace is honored", async () => {
    users.delete(ADMIN_UID);
    await expect(
      assertActivePlatformAdministratorInTransaction(fakeTx(), ADMIN_UID, {
        unauthorizedCode: "teachers.unauthorized",
      }),
    ).rejects.toMatchObject({ code: "teachers.unauthorized" });
  });

  test("empty caller uid is denied", async () => {
    await expect(
      assertActivePlatformAdministratorInTransaction(fakeTx(), ""),
    ).rejects.toBeInstanceOf(PlatformError);
  });
});
