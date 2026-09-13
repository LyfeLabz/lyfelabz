/* eslint-disable @typescript-eslint/require-await */
// Phase 8G.12 / 8G.12A - First Platform Administrator Bootstrap core test
// matrix.
//
// The core is exercised entirely through injected fake ports, so every
// prerequisite gate, the canonical-first ordering, single-audit guarantee,
// durable-lineage requirement, idempotent/repair replay behavior, safe
// rollback, change-ticket validation, canonical-shape validation, and data
// preservation are proven without Firebase Auth, Firestore, or the emulator.
// Real-Firestore transaction and concurrency semantics are additionally
// proven by the emulator-backed suite
// (bootstrap-platform-administrator.emulator.test.ts).
//
// The fake ports implement an async port interface with in-memory data, so
// several methods satisfy `Promise`-returning signatures without awaiting;
// the require-await rule is disabled for this fake-ports harness only.

import { Timestamp } from "firebase-admin/firestore";

import { PlatformError } from "../../shared/errors/platform-error";
import { PLATFORM_ADMIN_BOOTSTRAP_VERSION } from "../../shared/types/platform-admin-bootstrap";
import type { PlatformAdminBootstrapRecord } from "../../shared/types/platform-admin-bootstrap";
import type { Role } from "../../shared/types/user";
import {
  runBootstrap,
  APPLY_ACKNOWLEDGEMENT,
  BOOTSTRAP_ACTOR_ID,
  INITIAL_BOOTSTRAP_REASON,
  PRODUCTION_ACKNOWLEDGEMENT,
  ROLLBACK_ACKNOWLEDGEMENT,
  ROLLBACK_REASON,
  type BootstrapAuthIdentity,
  type BootstrapCanonicalUser,
  type BootstrapClaimsView,
  type BootstrapOptions,
  type BootstrapPorts,
  type BootstrapTransaction,
  type CreateBootstrapLineageInput,
  type RoleChangedAuditInput,
} from "./bootstrap-platform-administrator-core";

// A real firebase-admin Firestore Timestamp instance - the only value the
// strict canonical timestamp validator accepts.
const TS = Timestamp.fromMillis(1_726_000_000_000);

const PROJECT = "proj-under-test";
const UID = "uid-target";
const EMAIL = "target@example.org";
const SCHOOL_ID = "school-1";
const DISTRICT_ID = "district-1";
const TICKET = "CHANGE-1234";

type FakeState = {
  configuredProject: string | undefined;
  authByUid: Map<string, BootstrapAuthIdentity>;
  authByEmail: Map<string, BootstrapAuthIdentity>;
  claims: Map<string, BootstrapClaimsView>;
  users: Map<string, Record<string, unknown>>;
  schools: Map<string, { districtId?: string }>;
  lineage: PlatformAdminBootstrapRecord | null;
};

type Recorder = {
  auditWrites: RoleChangedAuditInput[];
  roleSets: Array<{ uid: string; role: Role }>;
  lineageCreates: CreateBootstrapLineageInput[];
  lineageRollbacks: Array<{ rollbackCorrelationId: string }>;
  claimsReplacements: Array<{
    uid: string;
    role: Role;
    schoolId: string;
    districtId: string;
  }>;
  revokes: string[];
};

type FakePortsHandle = {
  ports: BootstrapPorts;
  state: FakeState;
  rec: Recorder;
};

function baseUser(role: Role): Record<string, unknown> {
  return {
    authUid: UID,
    status: "active",
    role,
    schoolId: SCHOOL_ID,
    displayName: "Target Teacher",
    email: EMAIL,
    createdAt: TS,
    teacherProfile: { pilot: true },
  };
}

function baseState(): FakeState {
  const auth: BootstrapAuthIdentity = { uid: UID, email: EMAIL, disabled: false };
  return {
    configuredProject: PROJECT,
    authByUid: new Map([[UID, auth]]),
    authByEmail: new Map([[EMAIL, auth]]),
    claims: new Map(),
    users: new Map([[UID, baseUser("teacher")]]),
    schools: new Map([[SCHOOL_ID, { districtId: DISTRICT_ID }]]),
    lineage: null,
  };
}

function makePorts(
  state: FakeState,
  faults: {
    replaceCustomClaims?: () => never;
    revokeRefreshTokens?: () => never;
  } = {},
): FakePortsHandle {
  const rec: Recorder = {
    auditWrites: [],
    roleSets: [],
    lineageCreates: [],
    lineageRollbacks: [],
    claimsReplacements: [],
    revokes: [],
  };

  const ports: BootstrapPorts = {
    getConfiguredProjectId: () => state.configuredProject,
    getAuthUserByUid: async (uid) => state.authByUid.get(uid) ?? null,
    getAuthUserByEmail: async (email) =>
      state.authByEmail.get(email.toLowerCase()) ?? null,
    readCurrentClaims: async (uid) => state.claims.get(uid) ?? {},
    runTransaction: async (fn) => {
      const tx: BootstrapTransaction = {
        getUser: async (uid) =>
          (state.users.get(uid) as BootstrapCanonicalUser | undefined) ?? null,
        getSchoolDistrictId: async (schoolId) =>
          state.schools.get(schoolId)?.districtId ?? null,
        getBootstrapRecord: async () => state.lineage,
        getActiveAdministratorUids: async () =>
          [...state.users.entries()]
            .filter(
              ([, u]) =>
                u.role === "platformAdministrator" && u.status === "active",
            )
            .map(([id]) => id),
        setUserRole: (uid, role) => {
          rec.roleSets.push({ uid, role });
          const existing = state.users.get(uid);
          if (existing) state.users.set(uid, { ...existing, role });
        },
        createBootstrapRecord: (input) => {
          // Model tx.create: refuse if the singleton already exists.
          if (state.lineage !== null) {
            throw new PlatformError(
              "bootstrap.lineageCreateConflict",
              "lineage already exists",
            );
          }
          rec.lineageCreates.push(input);
          state.lineage = {
            targetUid: input.targetUid,
            previousRole: input.previousRole,
            newRole: input.newRole,
            schoolId: input.schoolId,
            districtId: input.districtId,
            correlationId: input.correlationId,
            reason: input.reason,
            state: "active",
            version: PLATFORM_ADMIN_BOOTSTRAP_VERSION,
            createdAt: TS,
          };
        },
        updateBootstrapRecordToRolledBack: (input) => {
          rec.lineageRollbacks.push(input);
          if (state.lineage) {
            state.lineage = {
              ...state.lineage,
              state: "rolledBack",
              rolledBackAt: TS,
              rollbackCorrelationId: input.rollbackCorrelationId,
            };
          }
        },
        writeRoleChangedAudit: (input) => {
          rec.auditWrites.push(input);
        },
      };
      return fn(tx);
    },
    replaceCustomClaims: async (input) => {
      if (faults.replaceCustomClaims) faults.replaceCustomClaims();
      rec.claimsReplacements.push({ ...input });
      state.claims.set(input.uid, {
        role: input.role,
        schoolId: input.schoolId,
        districtId: input.districtId,
      });
    },
    revokeRefreshTokens: async (uid) => {
      if (faults.revokeRefreshTokens) faults.revokeRefreshTokens();
      rec.revokes.push(uid);
    },
  };

  return { ports, state, rec };
}

function bootstrapOptions(
  overrides: Partial<BootstrapOptions> = {},
): BootstrapOptions {
  return {
    operation: "bootstrap",
    mode: "dryRun",
    projectId: PROJECT,
    targetUid: UID,
    targetEmail: EMAIL,
    expectedCurrentRole: "teacher",
    targetRole: "platformAdministrator",
    expectedSchoolId: SCHOOL_ID,
    changeTicket: TICKET,
    ...overrides,
  };
}

function applyOptions(
  overrides: Partial<BootstrapOptions> = {},
): BootstrapOptions {
  return bootstrapOptions({
    mode: "apply",
    productionAcknowledgement: PRODUCTION_ACKNOWLEDGEMENT,
    applyAcknowledgement: APPLY_ACKNOWLEDGEMENT,
    ...overrides,
  });
}

// Seed a fully-completed prior bootstrap: canonical admin + matching active
// lineage + consistent claims.
function seedCompletedBootstrap(state: FakeState): void {
  state.users.set(UID, baseUser("platformAdministrator"));
  state.lineage = {
    targetUid: UID,
    previousRole: "teacher",
    newRole: "platformAdministrator",
    schoolId: SCHOOL_ID,
    districtId: DISTRICT_ID,
    correlationId: TICKET,
    reason: INITIAL_BOOTSTRAP_REASON,
    state: "active",
    version: PLATFORM_ADMIN_BOOTSTRAP_VERSION,
    createdAt: TS,
  };
  state.claims.set(UID, {
    role: "platformAdministrator",
    schoolId: SCHOOL_ID,
    districtId: DISTRICT_ID,
  });
}

async function expectFailClosed(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
  await expect(promise).rejects.toBeInstanceOf(PlatformError);
}

describe("runBootstrap - dry run", () => {
  test("dry run makes no mutations", async () => {
    const { ports, rec, state } = makePorts(baseState());
    const result = await runBootstrap(bootstrapOptions(), ports);

    expect(result.outcome).toBe("dryRunOk");
    expect(result.previousRole).toBe("teacher");
    expect(result.newRole).toBe("platformAdministrator");
    expect(result.auditWritten).toBe(false);
    expect(result.lineageWritten).toBe(false);
    expect(rec.auditWrites).toHaveLength(0);
    expect(rec.roleSets).toHaveLength(0);
    expect(rec.lineageCreates).toHaveLength(0);
    expect(rec.claimsReplacements).toHaveLength(0);
    expect(rec.revokes).toHaveLength(0);
    expect(state.users.get(UID)?.role).toBe("teacher");
    expect(state.lineage).toBeNull();
  });

  test("repeated dry run makes no mutations", async () => {
    const { ports, rec, state } = makePorts(baseState());
    await runBootstrap(bootstrapOptions(), ports);
    await runBootstrap(bootstrapOptions(), ports);
    expect(rec.auditWrites).toHaveLength(0);
    expect(rec.roleSets).toHaveLength(0);
    expect(rec.lineageCreates).toHaveLength(0);
    expect(state.users.get(UID)?.role).toBe("teacher");
    expect(state.lineage).toBeNull();
  });
});

describe("runBootstrap - successful initial bootstrap", () => {
  test("transitions role, creates lineage, writes one audit, replaces claims, revokes tokens", async () => {
    const { ports, rec, state } = makePorts(baseState());
    const result = await runBootstrap(applyOptions(), ports);

    expect(result.outcome).toBe("applied");
    expect(result.auditWritten).toBe(true);
    expect(result.lineageWritten).toBe(true);
    expect(result.claimsReplaced).toBe(true);
    expect(result.refreshTokensRevoked).toBe(true);

    expect(rec.auditWrites).toHaveLength(1);
    expect(rec.auditWrites[0]).toMatchObject({
      targetUid: UID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      previousRole: "teacher",
      newRole: "platformAdministrator",
      reason: INITIAL_BOOTSTRAP_REASON,
      correlationId: TICKET,
    });

    // Durable lineage created with PII-free content and the correlation id.
    expect(rec.lineageCreates).toHaveLength(1);
    expect(rec.lineageCreates[0]).toMatchObject({
      targetUid: UID,
      previousRole: "teacher",
      newRole: "platformAdministrator",
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      correlationId: TICKET,
      reason: INITIAL_BOOTSTRAP_REASON,
    });
    expect(state.lineage?.state).toBe("active");

    expect(state.users.get(UID)?.role).toBe("platformAdministrator");
    expect(rec.claimsReplacements).toEqual([
      { uid: UID, role: "platformAdministrator", schoolId: SCHOOL_ID, districtId: DISTRICT_ID },
    ]);
    expect(rec.revokes).toEqual([UID]);
  });

  test("canonical-first ordering: transaction precedes claims and revocation", async () => {
    const state = baseState();
    const order: string[] = [];
    const { ports } = makePorts(state);
    const wrapped: BootstrapPorts = {
      ...ports,
      runTransaction: async (fn) => {
        const out = await ports.runTransaction(fn);
        order.push("transaction");
        return out;
      },
      replaceCustomClaims: async (input) => {
        order.push("claims");
        await ports.replaceCustomClaims(input);
      },
      revokeRefreshTokens: async (uid) => {
        order.push("revoke");
        await ports.revokeRefreshTokens(uid);
      },
    };
    await runBootstrap(applyOptions(), wrapped);
    expect(order).toEqual(["transaction", "claims", "revoke"]);
  });

  test("successful bootstrap cannot emit a duplicate audit on replay", async () => {
    const { ports, rec, state } = makePorts(baseState());
    await runBootstrap(applyOptions(), ports);
    expect(rec.auditWrites).toHaveLength(1);
    expect(rec.lineageCreates).toHaveLength(1);

    const second = await runBootstrap(applyOptions(), ports);
    expect(second.auditWritten).toBe(false);
    expect(rec.auditWrites).toHaveLength(1); // no duplicate
    expect(rec.lineageCreates).toHaveLength(1); // no duplicate lineage
    expect(state.users.get(UID)?.role).toBe("platformAdministrator");
  });
});

describe("runBootstrap - repair replay (lineage-gated)", () => {
  test("replay after claims failure repairs claims without a second audit or lineage", async () => {
    const state = baseState();
    const failing = makePorts(state, {
      replaceCustomClaims: () => {
        throw new PlatformError("claims.writeFailed", "boom");
      },
    });
    await expect(runBootstrap(applyOptions(), failing.ports)).rejects.toMatchObject({
      code: "claims.writeFailed",
    });
    expect(state.users.get(UID)?.role).toBe("platformAdministrator");
    expect(failing.rec.auditWrites).toHaveLength(1);
    expect(failing.rec.lineageCreates).toHaveLength(1);
    expect(state.claims.get(UID)).toBeUndefined();

    const healthy = makePorts(state);
    const result = await runBootstrap(applyOptions(), healthy.ports);
    expect(result.outcome).toBe("repairedAuth");
    expect(result.auditWritten).toBe(false);
    expect(healthy.rec.auditWrites).toHaveLength(0);
    expect(healthy.rec.lineageCreates).toHaveLength(0);
    expect(healthy.rec.claimsReplacements).toHaveLength(1);
    expect(healthy.rec.revokes).toEqual([UID]);
  });

  test("replay after refresh-token failure retries revocation without a second audit", async () => {
    const state = baseState();
    const failing = makePorts(state, {
      revokeRefreshTokens: () => {
        throw new PlatformError("auth.revokeRefreshTokensFailed", "boom");
      },
    });
    await expect(runBootstrap(applyOptions(), failing.ports)).rejects.toMatchObject({
      code: "auth.revokeRefreshTokensFailed",
    });
    expect(state.users.get(UID)?.role).toBe("platformAdministrator");
    expect(failing.rec.auditWrites).toHaveLength(1);
    expect(state.claims.get(UID)).toEqual({
      role: "platformAdministrator",
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
    });

    const healthy = makePorts(state);
    const result = await runBootstrap(applyOptions(), healthy.ports);
    expect(result.auditWritten).toBe(false);
    expect(healthy.rec.auditWrites).toHaveLength(0);
    expect(healthy.rec.revokes).toEqual([UID]); // retried
  });

  test("already-complete state reports idempotent completion (no audit, no lineage)", async () => {
    const state = baseState();
    seedCompletedBootstrap(state);
    const { ports, rec } = makePorts(state);
    const result = await runBootstrap(applyOptions(), ports);
    expect(result.outcome).toBe("alreadyComplete");
    expect(result.auditWritten).toBe(false);
    expect(rec.auditWrites).toHaveLength(0);
    expect(rec.lineageCreates).toHaveLength(0);
    expect(rec.claimsReplacements).toHaveLength(0);
  });

  test("canonical admin with MISSING lineage fails closed (never adopts manual admin state)", async () => {
    const state = baseState();
    state.users.set(UID, baseUser("platformAdministrator"));
    state.lineage = null;
    const { ports, rec } = makePorts(state);
    await expectFailClosed(
      runBootstrap(applyOptions(), ports),
      "bootstrap.lineageMissing",
    );
    expect(rec.claimsReplacements).toHaveLength(0);
    expect(rec.revokes).toHaveLength(0);
  });

  test("canonical admin with CONFLICTING lineage (different correlation) fails closed", async () => {
    const state = baseState();
    seedCompletedBootstrap(state);
    state.lineage = { ...(state.lineage as PlatformAdminBootstrapRecord), correlationId: "OTHER-999" };
    const { ports, rec } = makePorts(state);
    await expectFailClosed(
      runBootstrap(applyOptions(), ports),
      "bootstrap.lineageConflict",
    );
    expect(rec.claimsReplacements).toHaveLength(0);
  });
});

describe("runBootstrap - fail closed", () => {
  test("wrong project fails closed", async () => {
    const state = baseState();
    state.configuredProject = "some-other-project";
    const { ports } = makePorts(state);
    await expectFailClosed(runBootstrap(applyOptions(), ports), "bootstrap.projectMismatch");
  });

  test("missing configured project fails closed", async () => {
    const state = baseState();
    state.configuredProject = undefined;
    const { ports } = makePorts(state);
    await expectFailClosed(runBootstrap(applyOptions(), ports), "bootstrap.projectMismatch");
  });

  test("missing Auth identity fails closed", async () => {
    const state = baseState();
    state.authByUid.clear();
    const { ports } = makePorts(state);
    await expectFailClosed(runBootstrap(applyOptions(), ports), "bootstrap.missingAuthIdentity");
  });

  test("disabled Auth identity fails closed", async () => {
    const state = baseState();
    state.authByUid.set(UID, { uid: UID, email: EMAIL, disabled: true });
    const { ports } = makePorts(state);
    await expectFailClosed(runBootstrap(applyOptions(), ports), "bootstrap.authIdentityDisabled");
  });

  test("auth email mismatch fails closed", async () => {
    const state = baseState();
    state.authByUid.set(UID, { uid: UID, email: "other@example.org", disabled: false });
    const { ports } = makePorts(state);
    await expectFailClosed(runBootstrap(applyOptions(), ports), "bootstrap.authEmailMismatch");
  });

  test("email resolves to a different UID fails closed", async () => {
    const state = baseState();
    state.authByEmail.set(EMAIL, { uid: "uid-other", email: EMAIL, disabled: false });
    const { ports } = makePorts(state);
    await expectFailClosed(runBootstrap(applyOptions(), ports), "bootstrap.authUidMismatch");
  });

  test("missing canonical user fails closed", async () => {
    const state = baseState();
    state.users.clear();
    const { ports } = makePorts(state);
    await expectFailClosed(runBootstrap(applyOptions(), ports), "bootstrap.missingCanonicalUser");
  });

  test.each([
    ["authUid", { authUid: "different" }],
    ["status", { status: "suspended" }],
    ["missing displayName", { displayName: undefined }],
    ["missing createdAt", { createdAt: undefined }],
    ["missing email", { email: undefined }],
  ])("malformed canonical user (%s) fails closed", async (_label, patch) => {
    const state = baseState();
    state.users.set(UID, { ...baseUser("teacher"), ...patch });
    const { ports } = makePorts(state);
    await expect(runBootstrap(applyOptions(), ports)).rejects.toMatchObject({
      code: expect.stringMatching(/^bootstrap\.(malformedCanonicalUser|authEmailMismatch)$/),
    });
  });

  test("canonical email mismatched with Auth identity fails closed", async () => {
    const state = baseState();
    state.users.set(UID, { ...baseUser("teacher"), email: "someone-else@example.org" });
    const { ports } = makePorts(state);
    await expectFailClosed(runBootstrap(applyOptions(), ports), "bootstrap.authEmailMismatch");
  });

  test("wrong expected role fails closed", async () => {
    const state = baseState();
    state.users.set(UID, baseUser("student"));
    const { ports } = makePorts(state);
    await expectFailClosed(
      runBootstrap(applyOptions({ expectedCurrentRole: "teacher" }), ports),
      "bootstrap.roleMismatch",
    );
  });

  test("wrong school acknowledgement fails closed", async () => {
    const { ports } = makePorts(baseState());
    await expectFailClosed(
      runBootstrap(applyOptions({ expectedSchoolId: "school-wrong" }), ports),
      "bootstrap.schoolMismatch",
    );
  });

  test("unresolved district fails closed", async () => {
    const state = baseState();
    state.schools.set(SCHOOL_ID, {});
    const { ports } = makePorts(state);
    await expectFailClosed(runBootstrap(applyOptions(), ports), "bootstrap.districtUnresolved");
  });

  test("conflicting existing administrator fails closed", async () => {
    const state = baseState();
    state.users.set("uid-other-admin", {
      authUid: "uid-other-admin",
      status: "active",
      role: "platformAdministrator",
      schoolId: SCHOOL_ID,
    });
    const { ports, rec } = makePorts(state);
    await expectFailClosed(runBootstrap(applyOptions(), ports), "bootstrap.administratorExists");
    expect(rec.auditWrites).toHaveLength(0);
    expect(rec.lineageCreates).toHaveLength(0);
    expect(state.users.get(UID)?.role).toBe("teacher");
  });

  test("lineage present while target not yet admin fails closed", async () => {
    const state = baseState();
    seedCompletedBootstrap(state); // lineage present
    state.users.set(UID, baseUser("teacher")); // but user is still a teacher
    const { ports } = makePorts(state);
    await expectFailClosed(runBootstrap(applyOptions(), ports), "bootstrap.lineageConflict");
  });

  test("unexpected privileged target (admin claim without admin role) fails closed", async () => {
    const state = baseState();
    state.claims.set(UID, {
      role: "platformAdministrator",
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
    });
    const { ports } = makePorts(state);
    await expectFailClosed(
      runBootstrap(applyOptions(), ports),
      "bootstrap.unexpectedPrivilegedTarget",
    );
  });

  test("apply without acknowledgements fails closed", async () => {
    const { ports } = makePorts(baseState());
    await expectFailClosed(
      runBootstrap(bootstrapOptions({ mode: "apply" }), ports),
      "bootstrap.acknowledgementMissing",
    );
  });

  test("apply with wrong production acknowledgement fails closed", async () => {
    const { ports } = makePorts(baseState());
    await expectFailClosed(
      runBootstrap(
        bootstrapOptions({
          mode: "apply",
          productionAcknowledgement: "nope",
          applyAcknowledgement: APPLY_ACKNOWLEDGEMENT,
        }),
        ports,
      ),
      "bootstrap.acknowledgementMissing",
    );
  });

  test("invalid options (bootstrap targetRole must be admin) fails closed", async () => {
    const { ports } = makePorts(baseState());
    await expectFailClosed(
      runBootstrap(applyOptions({ targetRole: "student" }), ports),
      "bootstrap.invalidOptions",
    );
  });

  test.each([
    ["whitespace", "has space"],
    ["newline", "line1\nline2"],
    ["email-like", "ops@example.org"],
    ["too long", "x".repeat(65)],
    ["empty", ""],
  ])("invalid change ticket (%s) fails closed", async (_label, ticket) => {
    const { ports } = makePorts(baseState());
    const opts = applyOptions({ changeTicket: ticket });
    await expect(runBootstrap(opts, ports)).rejects.toMatchObject({
      code: expect.stringMatching(/^bootstrap\.(invalidChangeTicket|invalidOptions)$/),
    });
  });

  test.each([["CHANGE-1"], ["JIRA_OPS-42"], ["a.b:c-d_1"]])(
    "valid change ticket (%s) is accepted",
    async (ticket) => {
      const { ports } = makePorts(baseState());
      const result = await runBootstrap(bootstrapOptions({ changeTicket: ticket }), ports);
      expect(result.outcome).toBe("dryRunOk");
    },
  );
});

describe("runBootstrap - concurrency-shaped serialization (deterministic)", () => {
  test("after one admin exists, a fresh bootstrap for a DIFFERENT target refuses (lineage present)", async () => {
    const state = baseState();
    const { ports } = makePorts(state);
    await runBootstrap(applyOptions(), ports); // UID becomes admin, lineage created

    // A second, different candidate exists as a teacher.
    const UID2 = "uid-target-2";
    const EMAIL2 = "target2@example.org";
    state.authByUid.set(UID2, { uid: UID2, email: EMAIL2, disabled: false });
    state.authByEmail.set(EMAIL2, { uid: UID2, email: EMAIL2, disabled: false });
    state.users.set(UID2, {
      authUid: UID2,
      status: "active",
      role: "teacher",
      schoolId: SCHOOL_ID,
      displayName: "Second Teacher",
      email: EMAIL2,
      createdAt: TS,
    });

    await expectFailClosed(
      runBootstrap(
        applyOptions({ targetUid: UID2, targetEmail: EMAIL2, changeTicket: "CHANGE-2" }),
        ports,
      ),
      // Fresh path sees an existing lineage (and an existing admin) -> refuse.
      "bootstrap.lineageConflict",
    );
    expect(state.users.get(UID2)?.role).toBe("teacher");
  });
});

describe("runBootstrap - data preservation (Part 11)", () => {
  test("apply mutates ONLY the role field on the user; every other field preserved", async () => {
    const state = baseState();
    const before = { ...(state.users.get(UID) as Record<string, unknown>) };
    const { ports, rec } = makePorts(state);
    await runBootstrap(applyOptions(), ports);

    const after = state.users.get(UID) as Record<string, unknown>;
    expect(after).toEqual({ ...before, role: "platformAdministrator" });
    expect(after.authUid).toBe(before.authUid);
    expect(after.status).toBe("active");
    expect(after.schoolId).toBe(SCHOOL_ID);
    expect(after.displayName).toBe(before.displayName);
    expect(after.email).toBe(before.email);
    expect(after.teacherProfile).toEqual(before.teacherProfile);
    expect(rec.roleSets).toEqual([{ uid: UID, role: "platformAdministrator" }]);
  });
});

describe("runBootstrap - rollback", () => {
  function seedActiveBootstrap(state: FakeState): void {
    state.users.set(UID, baseUser("platformAdministrator"));
    state.lineage = {
      targetUid: UID,
      previousRole: "teacher",
      newRole: "platformAdministrator",
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      correlationId: TICKET,
      reason: INITIAL_BOOTSTRAP_REASON,
      state: "active",
      version: PLATFORM_ADMIN_BOOTSTRAP_VERSION,
      createdAt: TS,
    };
    state.claims.set(UID, {
      role: "platformAdministrator",
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
    });
  }

  function rollbackApply(
    overrides: Partial<BootstrapOptions> = {},
  ): BootstrapOptions {
    return bootstrapOptions({
      operation: "rollback",
      mode: "apply",
      expectedCurrentRole: "platformAdministrator",
      targetRole: "teacher",
      changeTicket: "ROLLBACK-1",
      productionAcknowledgement: PRODUCTION_ACKNOWLEDGEMENT,
      rollbackAcknowledgement: ROLLBACK_ACKNOWLEDGEMENT,
      ...overrides,
    });
  }

  test("rollback restores the lineage-recorded prior role, writes rollback audit, updates lineage, replaces claims, revokes", async () => {
    const state = baseState();
    seedActiveBootstrap(state);
    const { ports, rec } = makePorts(state);
    const result = await runBootstrap(rollbackApply(), ports);

    expect(result.outcome).toBe("applied");
    expect(result.reason).toBe(ROLLBACK_REASON);
    expect(state.users.get(UID)?.role).toBe("teacher");
    expect(rec.auditWrites).toHaveLength(1);
    expect(rec.auditWrites[0]).toMatchObject({
      previousRole: "platformAdministrator",
      newRole: "teacher",
      reason: ROLLBACK_REASON,
      correlationId: "ROLLBACK-1",
    });
    expect(rec.lineageRollbacks).toEqual([{ rollbackCorrelationId: "ROLLBACK-1" }]);
    expect(state.lineage?.state).toBe("rolledBack");
    expect(rec.claimsReplacements).toEqual([
      { uid: UID, role: "teacher", schoolId: SCHOOL_ID, districtId: DISTRICT_ID },
    ]);
    expect(rec.revokes).toEqual([UID]);
  });

  test("rollback requires the rollback acknowledgement", async () => {
    const state = baseState();
    seedActiveBootstrap(state);
    const { ports } = makePorts(state);
    await expectFailClosed(
      runBootstrap(rollbackApply({ rollbackAcknowledgement: undefined }), ports),
      "bootstrap.acknowledgementMissing",
    );
  });

  test("rollback with no lineage fails closed", async () => {
    const state = baseState();
    state.users.set(UID, baseUser("platformAdministrator"));
    state.lineage = null;
    const { ports } = makePorts(state);
    await expectFailClosed(runBootstrap(rollbackApply(), ports), "bootstrap.lineageMissing");
  });

  test("rollback wrong target (UID not in lineage) fails closed", async () => {
    const state = baseState();
    seedActiveBootstrap(state);
    state.authByUid.set("uid-x", { uid: "uid-x", email: "x@example.org", disabled: false });
    state.authByEmail.set("x@example.org", { uid: "uid-x", email: "x@example.org", disabled: false });
    const { ports } = makePorts(state);
    await expectFailClosed(
      runBootstrap(rollbackApply({ targetUid: "uid-x", targetEmail: "x@example.org" }), ports),
      "bootstrap.rollbackTargetMismatch",
    );
  });

  test("rollback with an arbitrary/unsupported destination role is impossible", async () => {
    const state = baseState();
    seedActiveBootstrap(state); // lineage previousRole === "teacher"
    const { ports } = makePorts(state);
    // "student" is not a supported bootstrap source role, so it is rejected at
    // option validation - the operator can never pick an arbitrary destination.
    await expectFailClosed(
      runBootstrap(rollbackApply({ targetRole: "student" }), ports),
      "bootstrap.invalidOptions",
    );
    expect(state.users.get(UID)?.role).toBe("platformAdministrator");
  });

  test("rollback on drifted canonical state (not an administrator) fails closed", async () => {
    const state = baseState();
    seedActiveBootstrap(state);
    state.users.set(UID, { ...baseUser("student") });
    const { ports } = makePorts(state);
    await expectFailClosed(runBootstrap(rollbackApply(), ports), "bootstrap.rollbackDrift");
  });

  test("rollback claims-failure replay repairs claims without a second audit", async () => {
    const state = baseState();
    seedActiveBootstrap(state);
    const failing = makePorts(state, {
      replaceCustomClaims: () => {
        throw new PlatformError("claims.writeFailed", "boom");
      },
    });
    await expect(runBootstrap(rollbackApply(), failing.ports)).rejects.toMatchObject({
      code: "claims.writeFailed",
    });
    // Canonical role restored, lineage rolledBack, one rollback audit.
    expect(state.users.get(UID)?.role).toBe("teacher");
    expect(state.lineage?.state).toBe("rolledBack");
    expect(failing.rec.auditWrites).toHaveLength(1);

    const healthy = makePorts(state);
    const result = await runBootstrap(rollbackApply(), healthy.ports);
    expect(result.outcome).toBe("repairedAuth");
    expect(healthy.rec.auditWrites).toHaveLength(0); // no duplicate rollback audit
    expect(healthy.rec.claimsReplacements).toHaveLength(1);
    expect(healthy.rec.revokes).toEqual([UID]);
  });

  test("rollback token-revocation-failure replay retries revoke without a second audit", async () => {
    const state = baseState();
    seedActiveBootstrap(state);
    const failing = makePorts(state, {
      revokeRefreshTokens: () => {
        throw new PlatformError("auth.revokeRefreshTokensFailed", "boom");
      },
    });
    await expect(runBootstrap(rollbackApply(), failing.ports)).rejects.toMatchObject({
      code: "auth.revokeRefreshTokensFailed",
    });
    expect(state.users.get(UID)?.role).toBe("teacher");
    expect(failing.rec.auditWrites).toHaveLength(1);

    const healthy = makePorts(state);
    const result = await runBootstrap(rollbackApply(), healthy.ports);
    expect(result.auditWritten).toBe(false);
    expect(healthy.rec.auditWrites).toHaveLength(0);
    expect(healthy.rec.revokes).toEqual([UID]);
  });

  test("audit actor is the stable non-PII bootstrap actor id (documented invariant)", () => {
    expect(BOOTSTRAP_ACTOR_ID).toBe("system-bootstrap-platform-administrator");
    expect(BOOTSTRAP_ACTOR_ID).not.toContain("@");
  });
});

describe("runBootstrap - canonical createdAt / email validation (Corrections 8, 9 / 8G.12C)", () => {
  // Only a REAL Firestore Timestamp instance is accepted. Every structural
  // lookalike, Date, primitive, and toDate-bearing object is rejected.
  test.each<[string, unknown, boolean]>([
    ["real Firestore Timestamp", Timestamp.fromMillis(1_726_000_000_000), true],
    ["Date instance", new Date(), false],
    ["toDate-bearing object", { toDate: () => new Date() }, false],
    ["Timestamp-method mimic", { toDate: () => new Date(), toMillis: () => 1, seconds: 1, nanoseconds: 0 }, false],
    ["structural {seconds,nanoseconds} map", { seconds: 1, nanoseconds: 0 }, false],
    ["invalid nanoseconds (negative)", { seconds: 1, nanoseconds: -1 }, false],
    ["invalid nanoseconds (>= 1e9)", { seconds: 1, nanoseconds: 1_000_000_000 }, false],
    ["ISO string", "2026-09-12T00:00:00Z", false],
    ["numeric epoch", 1_726_000_000, false],
    ["null", null, false],
    ["undefined", undefined, false],
    ["arbitrary object", { foo: "bar" }, false],
  ])("createdAt %s -> accepted=%s", async (_label, createdAt, ok) => {
    const state = baseState();
    state.users.set(UID, { ...baseUser("teacher"), createdAt });
    const { ports } = makePorts(state);
    if (ok) {
      const r = await runBootstrap(bootstrapOptions(), ports);
      expect(r.outcome).toBe("dryRunOk");
    } else {
      await expectFailClosed(runBootstrap(bootstrapOptions(), ports), "bootstrap.malformedCanonicalUser");
    }
  });

  test("canonical email with surrounding whitespace fails closed as malformed", async () => {
    const state = baseState();
    state.users.set(UID, { ...baseUser("teacher"), email: `  ${EMAIL}  ` });
    const { ports } = makePorts(state);
    await expectFailClosed(runBootstrap(applyOptions(), ports), "bootstrap.malformedCanonicalUser");
  });

  test("canonical email case difference is tolerated (matches Auth identity)", async () => {
    const state = baseState();
    state.users.set(UID, { ...baseUser("teacher"), email: EMAIL.toUpperCase() });
    const { ports } = makePorts(state);
    const r = await runBootstrap(applyOptions(), ports);
    expect(r.outcome).toBe("applied");
  });

  test("bootstrap source role must be a supported role (student rejected at options)", async () => {
    const { ports } = makePorts(baseState());
    await expectFailClosed(
      runBootstrap(bootstrapOptions({ expectedCurrentRole: "student" }), ports),
      "bootstrap.invalidOptions",
    );
  });
});

describe("runBootstrap - rollback lineage validation matrix (Correction 10)", () => {
  const ROLLBACK_TICKET = "ROLLBACK-7";

  function activeLineage(
    overrides: Partial<PlatformAdminBootstrapRecord> = {},
  ): PlatformAdminBootstrapRecord {
    return {
      targetUid: UID,
      previousRole: "teacher",
      newRole: "platformAdministrator",
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      correlationId: TICKET,
      reason: INITIAL_BOOTSTRAP_REASON,
      state: "active",
      version: PLATFORM_ADMIN_BOOTSTRAP_VERSION,
      createdAt: TS,
      ...overrides,
    };
  }

  function seedAdmin(state: FakeState): void {
    state.users.set(UID, baseUser("platformAdministrator"));
    state.claims.set(UID, { role: "platformAdministrator", schoolId: SCHOOL_ID, districtId: DISTRICT_ID });
  }

  function rollback(overrides: Partial<BootstrapOptions> = {}): BootstrapOptions {
    return bootstrapOptions({
      operation: "rollback",
      mode: "apply",
      expectedCurrentRole: "platformAdministrator",
      targetRole: "teacher",
      changeTicket: ROLLBACK_TICKET,
      productionAcknowledgement: PRODUCTION_ACKNOWLEDGEMENT,
      rollbackAcknowledgement: ROLLBACK_ACKNOWLEDGEMENT,
      ...overrides,
    });
  }

  test("missing lineage fails closed", async () => {
    const state = baseState();
    seedAdmin(state);
    state.lineage = null;
    const { ports } = makePorts(state);
    await expectFailClosed(runBootstrap(rollback(), ports), "bootstrap.lineageMissing");
  });

  test("unknown lineage version fails closed", async () => {
    const state = baseState();
    seedAdmin(state);
    state.lineage = activeLineage({ version: 999 });
    const { ports } = makePorts(state);
    await expectFailClosed(runBootstrap(rollback(), ports), "bootstrap.lineageVersionUnsupported");
  });

  test.each([
    ["wrong reason", { reason: "somethingElse" }],
    ["wrong newRole", { newRole: "teacher" as Role }],
    ["previousRole platformAdministrator", { previousRole: "platformAdministrator" as Role }],
    ["unsupported previousRole", { previousRole: "student" as Role }],
    ["unknown state", { state: "frozen" as never }],
    ["malformed targetUid", { targetUid: "" }],
    ["malformed correlationId", { correlationId: "has space" }],
    ["malformed createdAt", { createdAt: "nope" as never }],
  ])("lineage %s fails closed (lineageConflict)", async (_label, patch) => {
    const state = baseState();
    seedAdmin(state);
    state.lineage = activeLineage(patch);
    const { ports } = makePorts(state);
    await expectFailClosed(runBootstrap(rollback(), ports), "bootstrap.lineageConflict");
  });

  test("wrong target UID fails closed", async () => {
    const state = baseState();
    seedAdmin(state);
    state.lineage = activeLineage({ targetUid: "someone-else" });
    const { ports } = makePorts(state);
    await expectFailClosed(runBootstrap(rollback(), ports), "bootstrap.rollbackTargetMismatch");
  });

  test("school drift fails closed", async () => {
    const state = baseState();
    seedAdmin(state);
    state.users.set(UID, { ...baseUser("platformAdministrator"), schoolId: "school-drift" });
    state.lineage = activeLineage();
    const { ports } = makePorts(state);
    await expectFailClosed(runBootstrap(rollback(), ports), "bootstrap.rollbackDrift");
  });

  test("district drift fails closed", async () => {
    const state = baseState();
    seedAdmin(state);
    state.schools.set(SCHOOL_ID, { districtId: "district-drift" });
    state.lineage = activeLineage();
    const { ports } = makePorts(state);
    await expectFailClosed(runBootstrap(rollback(), ports), "bootstrap.rollbackDrift");
  });

  test("canonical role drift (already teacher while lineage active) fails closed", async () => {
    const state = baseState();
    state.users.set(UID, baseUser("teacher"));
    state.claims.set(UID, { role: "teacher", schoolId: SCHOOL_ID, districtId: DISTRICT_ID });
    state.lineage = activeLineage();
    const { ports } = makePorts(state);
    await expectFailClosed(runBootstrap(rollback(), ports), "bootstrap.rollbackDrift");
  });

  test("rolledBack lineage without rollbackCorrelationId fails closed", async () => {
    const state = baseState();
    state.users.set(UID, baseUser("teacher"));
    state.lineage = activeLineage({ state: "rolledBack", rolledBackAt: TS });
    const { ports } = makePorts(state);
    await expectFailClosed(runBootstrap(rollback(), ports), "bootstrap.lineageConflict");
  });

  test("rolledBack lineage without rolledBackAt fails closed", async () => {
    const state = baseState();
    state.users.set(UID, baseUser("teacher"));
    state.lineage = activeLineage({ state: "rolledBack", rollbackCorrelationId: ROLLBACK_TICKET });
    const { ports } = makePorts(state);
    await expectFailClosed(runBootstrap(rollback(), ports), "bootstrap.lineageConflict");
  });

  test("rolledBack lineage with malformed rollbackCorrelationId fails closed", async () => {
    const state = baseState();
    state.users.set(UID, baseUser("teacher"));
    state.lineage = activeLineage({ state: "rolledBack", rolledBackAt: TS, rollbackCorrelationId: "has space" });
    const { ports } = makePorts(state);
    await expectFailClosed(runBootstrap(rollback(), ports), "bootstrap.lineageConflict");
  });

  test("rolledBack replay with a DIFFERENT requested rollback correlation refuses before Auth", async () => {
    const state = baseState();
    state.users.set(UID, baseUser("teacher"));
    state.claims.set(UID, { role: "teacher", schoolId: SCHOOL_ID, districtId: DISTRICT_ID });
    state.lineage = activeLineage({
      state: "rolledBack",
      rolledBackAt: TS,
      rollbackCorrelationId: ROLLBACK_TICKET,
    });
    const { ports, rec } = makePorts(state);
    await expectFailClosed(
      runBootstrap(rollback({ changeTicket: "DIFFERENT-1" }), ports),
      "bootstrap.rollbackCorrelationMismatch",
    );
    expect(rec.claimsReplacements).toHaveLength(0);
    expect(rec.revokes).toHaveLength(0);
    expect(rec.auditWrites).toHaveLength(0);
  });

  test("rolledBack replay with the MATCHING rollback correlation repairs Auth idempotently (no audit)", async () => {
    const state = baseState();
    state.users.set(UID, baseUser("teacher"));
    // claims inconsistent (still admin) -> repair path
    state.claims.set(UID, { role: "platformAdministrator", schoolId: SCHOOL_ID, districtId: DISTRICT_ID });
    state.lineage = activeLineage({
      state: "rolledBack",
      rolledBackAt: TS,
      rollbackCorrelationId: ROLLBACK_TICKET,
    });
    const { ports, rec } = makePorts(state);
    const r = await runBootstrap(rollback(), ports);
    expect(r.outcome).toBe("repairedAuth");
    expect(rec.auditWrites).toHaveLength(0);
    expect(rec.claimsReplacements).toEqual([
      { uid: UID, role: "teacher", schoolId: SCHOOL_ID, districtId: DISTRICT_ID },
    ]);
    expect(rec.revokes).toEqual([UID]);
  });

  test("rolledBack replay already-consistent reports idempotent completion", async () => {
    const state = baseState();
    state.users.set(UID, baseUser("teacher"));
    state.claims.set(UID, { role: "teacher", schoolId: SCHOOL_ID, districtId: DISTRICT_ID });
    state.lineage = activeLineage({
      state: "rolledBack",
      rolledBackAt: TS,
      rollbackCorrelationId: ROLLBACK_TICKET,
    });
    const { ports, rec } = makePorts(state);
    const r = await runBootstrap(rollback(), ports);
    expect(r.outcome).toBe("alreadyComplete");
    expect(rec.auditWrites).toHaveLength(0);
    expect(rec.claimsReplacements).toHaveLength(0);
  });
});

describe("runBootstrap - malformed timestamps fail closed before any mutation (Corrections 3, 4)", () => {
  function rollbackOpts(overrides: Partial<BootstrapOptions> = {}): BootstrapOptions {
    return bootstrapOptions({
      operation: "rollback",
      mode: "apply",
      expectedCurrentRole: "platformAdministrator",
      targetRole: "teacher",
      changeTicket: "ROLLBACK-9",
      productionAcknowledgement: PRODUCTION_ACKNOWLEDGEMENT,
      rollbackAcknowledgement: ROLLBACK_ACKNOWLEDGEMENT,
      ...overrides,
    });
  }

  function expectNoMutation(rec: {
    roleSets: unknown[];
    lineageCreates: unknown[];
    lineageRollbacks: unknown[];
    auditWrites: unknown[];
    claimsReplacements: unknown[];
    revokes: unknown[];
  }): void {
    expect(rec.roleSets).toHaveLength(0);
    expect(rec.lineageCreates).toHaveLength(0);
    expect(rec.lineageRollbacks).toHaveLength(0);
    expect(rec.auditWrites).toHaveLength(0);
    expect(rec.claimsReplacements).toHaveLength(0);
    expect(rec.revokes).toHaveLength(0);
  }

  const MALFORMED_TS: unknown[] = [
    new Date(),
    { seconds: 1, nanoseconds: 0 },
    { toDate: () => new Date() },
    "2026-09-12T00:00:00Z",
    1_726_000_000,
    null,
  ];

  test.each(MALFORMED_TS.map((v, i) => [String(i), v] as [string, unknown]))(
    "A. active-lineage fresh rollback with malformed lineage.createdAt (#%s) refuses before Auth/audit",
    async (_i, badTs) => {
      const state = baseState();
      state.users.set(UID, baseUser("platformAdministrator"));
      state.claims.set(UID, { role: "platformAdministrator", schoolId: SCHOOL_ID, districtId: DISTRICT_ID });
      state.lineage = {
        targetUid: UID,
        previousRole: "teacher",
        newRole: "platformAdministrator",
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
        correlationId: TICKET,
        reason: INITIAL_BOOTSTRAP_REASON,
        state: "active",
        version: PLATFORM_ADMIN_BOOTSTRAP_VERSION,
        createdAt: badTs as never,
      };
      const { ports, rec } = makePorts(state);
      await expectFailClosed(runBootstrap(rollbackOpts(), ports), "bootstrap.lineageConflict");
      expectNoMutation(rec);
    },
  );

  test.each(MALFORMED_TS.map((v, i) => [String(i), v] as [string, unknown]))(
    "B. rolledBack-lineage repair replay with malformed lineage.rolledBackAt (#%s) refuses before Auth/audit",
    async (_i, badTs) => {
      const state = baseState();
      state.users.set(UID, baseUser("teacher"));
      state.claims.set(UID, { role: "platformAdministrator", schoolId: SCHOOL_ID, districtId: DISTRICT_ID });
      state.lineage = {
        targetUid: UID,
        previousRole: "teacher",
        newRole: "platformAdministrator",
        schoolId: SCHOOL_ID,
        districtId: DISTRICT_ID,
        correlationId: TICKET,
        reason: INITIAL_BOOTSTRAP_REASON,
        state: "rolledBack",
        version: PLATFORM_ADMIN_BOOTSTRAP_VERSION,
        createdAt: TS,
        rolledBackAt: badTs as never,
        rollbackCorrelationId: "ROLLBACK-9",
      };
      const { ports, rec } = makePorts(state);
      await expectFailClosed(runBootstrap(rollbackOpts(), ports), "bootstrap.lineageConflict");
      expectNoMutation(rec);
    },
  );

  test.each([
    ["Date", new Date()],
    ["structural map", { seconds: 1, nanoseconds: 0 }],
    ["toDate object", { toDate: () => new Date() }],
  ])("canonical user createdAt %s fails closed with NO mutation (bootstrap.malformedCanonicalUser)", async (_label, badTs) => {
    const state = baseState();
    state.users.set(UID, { ...baseUser("teacher"), createdAt: badTs });
    const { ports, rec } = makePorts(state);
    await expectFailClosed(runBootstrap(applyOptions(), ports), "bootstrap.malformedCanonicalUser");
    expectNoMutation(rec);
  });

  test("canonical user with a real Firestore Timestamp createdAt applies", async () => {
    const state = baseState();
    state.users.set(UID, { ...baseUser("teacher"), createdAt: Timestamp.now() });
    const { ports } = makePorts(state);
    const r = await runBootstrap(applyOptions(), ports);
    expect(r.outcome).toBe("applied");
  });
});
