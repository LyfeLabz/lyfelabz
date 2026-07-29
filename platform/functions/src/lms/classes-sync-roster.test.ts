// Sprint 23C callable tests for lmsClassesSyncRoster. The engine is
// mocked; these tests exercise the callable's auth, request
// validation, response projection, audit shape, and privacy
// guarantees. Every identifier is fictional.

const mockSynchronize = jest.fn();
const mockWriteAuditEvent = jest.fn();
const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();
const mockEnsureBindings = jest.fn();

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(_options: unknown, handler: T) => handler,
}));

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    platformCallable: (_options: unknown, handler: unknown) =>
      typeof _options === "function" ? _options : handler,
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    writeAuditEvent: mockWriteAuditEvent,
  };
});

jest.mock("./providers/google-classroom/config-firebase", () => ({
  ensureGoogleClassroomProductionBindings: () => mockEnsureBindings(),
  googleClassroomProductionSecrets: [] as const,
}));

jest.mock("./roster/sync-engine", () => ({
  synchronizeClassRoster: (input: unknown) => mockSynchronize(input),
}));

import { __lmsClassesSyncRosterHandler } from "./classes-sync-roster";
import type { CallableRequest } from "firebase-functions/v2/https";

function makeRequest(
  overrides: {
    uid?: string;
    data?: unknown;
    hasAuth?: boolean;
    token?: Record<string, unknown> | null;
  } = {},
): CallableRequest<unknown> {
  const hasAuth = overrides.hasAuth ?? true;
  const uid = overrides.uid ?? "teacher-1";
  const data = overrides.data === undefined ? { classId: "class-1" } : overrides.data;
  const token =
    overrides.token === undefined
      ? { role: "teacher", schoolId: "school-a", districtId: "district-a" }
      : overrides.token;
  return {
    data,
    auth: hasAuth
      ? ({ uid, token: token ?? undefined } as never)
      : undefined,
    rawRequest: {} as never,
  };
}

function baseSummary(overrides: Record<string, unknown> = {}) {
  return {
    classId: "class-1",
    providerId: "googleClassroom",
    linkId: "link-1",
    added: 0,
    reactivated: 0,
    unchanged: 0,
    withdrawn: 0,
    unresolved: 0,
    skipped: 0,
    upstreamRosterEmpty: false,
    ...overrides,
  };
}

describe("lmsClassesSyncRoster callable (Sprint 23C)", () => {
  beforeEach(() => {
    [
      mockSynchronize,
      mockWriteAuditEvent,
      mockLogInfo,
      mockLogWarn,
      mockLogError,
      mockEnsureBindings,
    ].forEach((m) => m.mockReset());
    mockWriteAuditEvent.mockResolvedValue({ eventId: "e1", record: {} });
    mockEnsureBindings.mockReturnValue(undefined);
  });

  it("rejects an unauthenticated caller", async () => {
    await expect(
      __lmsClassesSyncRosterHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({ code: "lms.unauthenticated" });
    expect(mockSynchronize).not.toHaveBeenCalled();
  });

  it("rejects a caller without the teacher role", async () => {
    await expect(
      __lmsClassesSyncRosterHandler(
        makeRequest({ token: { role: "student", schoolId: "school-a" } }),
      ),
    ).rejects.toMatchObject({ code: "lms.unauthorized" });
    expect(mockSynchronize).not.toHaveBeenCalled();
  });

  it("rejects a request payload that is not an object", async () => {
    await expect(
      __lmsClassesSyncRosterHandler(makeRequest({ data: null })),
    ).rejects.toMatchObject({ code: "lms.invalidRequest" });
  });

  it("rejects when classId is missing", async () => {
    await expect(
      __lmsClassesSyncRosterHandler(makeRequest({ data: {} })),
    ).rejects.toMatchObject({ code: "lms.invalidClassId" });
  });

  it("returns a safe deterministic-count response and emits one audit event", async () => {
    mockSynchronize.mockResolvedValueOnce(
      baseSummary({
        added: 3,
        unchanged: 2,
        withdrawn: 1,
        unresolved: 4,
        skipped: 1,
        upstreamRosterEmpty: false,
      }),
    );

    const response = await __lmsClassesSyncRosterHandler(makeRequest());

    expect(response).toEqual({
      classId: "class-1",
      added: 3,
      reactivated: 0,
      unchanged: 2,
      withdrawn: 1,
      unresolved: 4,
      skipped: 1,
      upstreamRosterEmpty: false,
    });
    // Response contains only safe counts. Assert nothing PII-shaped
    // leaked into the object.
    const responseJson = JSON.stringify(response);
    expect(responseJson).not.toMatch(/providerAccountId|accessToken|refreshToken|externalIdentityId|email|@/);

    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    const auditCall = mockWriteAuditEvent.mock.calls[0][0] as {
      readonly action: string;
      readonly targetType: string;
      readonly targetId: string;
      readonly schoolId: string;
      readonly districtId?: string;
      readonly actorUserId: string;
      readonly actorRole: string;
      readonly payload: Record<string, unknown>;
    };
    expect(auditCall.action).toBe("lms.rosterSynchronized");
    expect(auditCall.targetType).toBe("class");
    expect(auditCall.targetId).toBe("class-1");
    expect(auditCall.schoolId).toBe("school-a");
    expect(auditCall.districtId).toBe("district-a");
    expect(auditCall.actorUserId).toBe("teacher-1");
    expect(auditCall.actorRole).toBe("teacher");
    expect(auditCall.payload.providerId).toBe("googleClassroom");
    expect(auditCall.payload.added).toBe(3);
    expect(auditCall.payload.unresolvedPresent).toBe(true);
    // No provider account identifier or upstream PII in the audit
    // payload.
    const payloadJson = JSON.stringify(auditCall.payload);
    expect(payloadJson).not.toMatch(/providerAccountId|accessToken|refreshToken|externalIdentityId|email|@/);
  });

  it("propagates a PlatformError from the engine without writing an audit event", async () => {
    const { PlatformError } = jest.requireActual(
      "../shared/errors/platform-error",
    );
    mockSynchronize.mockRejectedValueOnce(
      new PlatformError("lms.upstreamAuthorizationFailed", "boom"),
    );

    await expect(
      __lmsClassesSyncRosterHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "lms.upstreamAuthorizationFailed" });
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("passes the authenticated actor (uid, schoolId, districtId) into the engine", async () => {
    mockSynchronize.mockResolvedValueOnce(baseSummary());
    await __lmsClassesSyncRosterHandler(makeRequest());
    expect(mockSynchronize).toHaveBeenCalledWith({
      actor: { uid: "teacher-1", schoolId: "school-a", districtId: "district-a" },
      classId: "class-1",
    });
  });

  it("does not require a districtId claim (Sprint 11D I-5 backwards-compat)", async () => {
    mockSynchronize.mockResolvedValueOnce(baseSummary());
    await __lmsClassesSyncRosterHandler(
      makeRequest({ token: { role: "teacher", schoolId: "school-a" } }),
    );
    expect(mockSynchronize).toHaveBeenCalledWith({
      actor: { uid: "teacher-1", schoolId: "school-a" },
      classId: "class-1",
    });
    const auditCall = mockWriteAuditEvent.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(auditCall.districtId).toBeUndefined();
  });
});
