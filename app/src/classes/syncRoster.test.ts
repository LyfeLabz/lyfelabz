// Sprint 24B Phase 2B.8: unit tests for the `lmsClassesSyncRoster`
// client wrapper. Uses the same jest.mock over firebase/functions
// pattern established by activateClass.test.ts and lmsCreateClass.test.ts.

const callableSpy = jest.fn();
let lastCallableName: string | null = null;

jest.mock("firebase/functions", () => ({
  httpsCallable:
    (
      _functions: unknown,
      name: string,
    ): ((data: unknown) => Promise<{ data: unknown }>) => {
      lastCallableName = name;
      return async (data: unknown) => {
        const result = await callableSpy(data);
        return { data: result };
      };
    },
}));

import {
  createFirebaseSyncRoster,
  SyncRosterError,
} from "./syncRoster";

const functionsStub = {} as never;

describe("createFirebaseSyncRoster", () => {
  beforeEach(() => {
    callableSpy.mockReset();
    lastCallableName = null;
  });

  it("targets the lmsClassesSyncRoster callable and passes only classId", async () => {
    callableSpy.mockResolvedValueOnce({
      classId: "cid-1",
      added: 0,
      reactivated: 0,
      unchanged: 0,
      withdrawn: 0,
      unresolved: 3,
      skipped: 0,
      upstreamRosterEmpty: false,
    });
    const sync = createFirebaseSyncRoster(functionsStub);
    const result = await sync({ classId: "cid-1" });

    expect(lastCallableName).toBe("lmsClassesSyncRoster");
    expect(callableSpy).toHaveBeenCalledTimes(1);
    expect(callableSpy).toHaveBeenCalledWith({ classId: "cid-1" });
    expect(result).toEqual({
      classId: "cid-1",
      added: 0,
      reactivated: 0,
      unchanged: 0,
      withdrawn: 0,
      unresolved: 3,
      skipped: 0,
      upstreamRosterEmpty: false,
    });
  });

  it("validates the returned shape defensively and coerces malformed counters to 0", async () => {
    callableSpy.mockResolvedValueOnce({
      classId: "cid-1",
      added: "not a number",
      unchanged: -5,
      withdrawn: 2.5,
      unresolved: null,
      // Missing reactivated + skipped + upstreamRosterEmpty entirely.
    });
    const sync = createFirebaseSyncRoster(functionsStub);
    const result = await sync({ classId: "cid-1" });

    expect(result).toEqual({
      classId: "cid-1",
      added: 0,
      reactivated: 0,
      unchanged: 0,
      withdrawn: 0,
      unresolved: 0,
      skipped: 0,
      upstreamRosterEmpty: false,
    });
  });

  it("Path Z Pass A shape: added=0, unchanged=0, withdrawn=0, unresolved=3 passes through unchanged", async () => {
    callableSpy.mockResolvedValueOnce({
      classId: "cid-cert",
      added: 0,
      reactivated: 0,
      unchanged: 0,
      withdrawn: 0,
      unresolved: 3,
      skipped: 0,
      upstreamRosterEmpty: false,
    });
    const sync = createFirebaseSyncRoster(functionsStub);
    const result = await sync({ classId: "cid-cert" });
    expect(result.added).toBe(0);
    expect(result.unchanged).toBe(0);
    expect(result.withdrawn).toBe(0);
    expect(result.unresolved).toBe(3);
  });

  it("classifies upstreamAuthorizationFailed as reconnectRequired", async () => {
    callableSpy.mockRejectedValueOnce(
      Object.assign(new Error("HttpsError"), {
        details: { code: "lms.upstreamAuthorizationFailed" },
      }),
    );
    const sync = createFirebaseSyncRoster(functionsStub);
    let caught: unknown = null;
    try {
      await sync({ classId: "cid" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SyncRosterError);
    expect((caught as SyncRosterError).kind).toBe("reconnectRequired");
    expect((caught as SyncRosterError).serverCode).toBe(
      "lms.upstreamAuthorizationFailed",
    );
  });

  it("classifies connectionNotActive as reconnectRequired", async () => {
    callableSpy.mockRejectedValueOnce(
      Object.assign(new Error("HttpsError"), {
        details: { code: "lms.connectionNotActive" },
      }),
    );
    const sync = createFirebaseSyncRoster(functionsStub);
    await expect(sync({ classId: "cid" })).rejects.toMatchObject({
      kind: "reconnectRequired",
    });
  });

  it("classifies upstreamResourceNotFound as linkBroken", async () => {
    callableSpy.mockRejectedValueOnce(
      Object.assign(new Error("HttpsError"), {
        details: { code: "lms.upstreamResourceNotFound" },
      }),
    );
    const sync = createFirebaseSyncRoster(functionsStub);
    await expect(sync({ classId: "cid" })).rejects.toMatchObject({
      kind: "linkBroken",
    });
  });

  it("classifies classNotActive distinctly", async () => {
    callableSpy.mockRejectedValueOnce(
      Object.assign(new Error("HttpsError"), {
        details: { code: "lms.classNotActive" },
      }),
    );
    const sync = createFirebaseSyncRoster(functionsStub);
    await expect(sync({ classId: "cid" })).rejects.toMatchObject({
      kind: "classNotActive",
    });
  });

  it("classifies upstreamCallFailed as transient", async () => {
    callableSpy.mockRejectedValueOnce(
      Object.assign(new Error("HttpsError"), {
        details: { code: "lms.upstreamCallFailed" },
      }),
    );
    const sync = createFirebaseSyncRoster(functionsStub);
    await expect(sync({ classId: "cid" })).rejects.toMatchObject({
      kind: "transient",
    });
  });

  it("classifies a Firebase transport unavailable code as transient", async () => {
    callableSpy.mockRejectedValueOnce(
      Object.assign(new Error("network"), { code: "unavailable" }),
    );
    const sync = createFirebaseSyncRoster(functionsStub);
    await expect(sync({ classId: "cid" })).rejects.toMatchObject({
      kind: "transient",
    });
  });

  it("classifies an unrecognized code as unknown", async () => {
    callableSpy.mockRejectedValueOnce(
      Object.assign(new Error("weird"), {
        details: { code: "lms.somethingBrandNew" },
      }),
    );
    const sync = createFirebaseSyncRoster(functionsStub);
    await expect(sync({ classId: "cid" })).rejects.toMatchObject({
      kind: "unknown",
      serverCode: "lms.somethingBrandNew",
    });
  });

  it("classifies a fully opaque throwable as unknown with serverCode null", async () => {
    callableSpy.mockRejectedValueOnce("plain string throw");
    const sync = createFirebaseSyncRoster(functionsStub);
    await expect(sync({ classId: "cid" })).rejects.toMatchObject({
      kind: "unknown",
      serverCode: null,
    });
  });
});
