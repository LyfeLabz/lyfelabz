// Sprint 29G.5K callable tests for lmsClassesRefreshRoster. The capture
// engine is mocked; these tests exercise the callable's auth, request
// validation, response projection, audit shape, and privacy guarantees.
// Every identifier is fictional.

const mockRefresh = jest.fn();
const mockWriteAuditEvent = jest.fn();
const mockLogInfo = jest.fn();
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
    log: { info: mockLogInfo, warn: jest.fn(), error: jest.fn() },
    writeAuditEvent: mockWriteAuditEvent,
  };
});

jest.mock("./providers/google-classroom/config-firebase", () => ({
  ensureGoogleClassroomProductionBindings: () => mockEnsureBindings(),
  googleClassroomProductionSecrets: [] as const,
}));

jest.mock("./roster/membership-capture", () => ({
  refreshClassRosterMemberships: (input: unknown) => mockRefresh(input),
}));

import { __lmsClassesRefreshRosterHandler } from "./classes-refresh-roster";
import type { CallableRequest } from "firebase-functions/v2/https";

function makeRequest(
  overrides: { uid?: string; data?: unknown; hasAuth?: boolean } = {},
): CallableRequest<unknown> {
  const hasAuth = overrides.hasAuth ?? true;
  const uid = overrides.uid ?? "teacher-1";
  const data =
    overrides.data === undefined ? { classId: "class-1" } : overrides.data;
  return {
    data,
    auth: hasAuth
      ? ({
          uid,
          token: {
            role: "teacher",
            schoolId: "school-a",
            districtId: "district-a",
          },
        } as never)
      : undefined,
    rawRequest: {} as never,
  };
}

function baseResult(overrides: Record<string, unknown> = {}) {
  return {
    classId: "class-1",
    providerId: "googleClassroom",
    linkId: "link-1",
    membersSeen: 19,
    added: 19,
    reaffirmed: 0,
    removed: 0,
    withdrawnEnrollments: 0,
    upstreamRosterEmpty: false,
    ...overrides,
  };
}

describe("lmsClassesRefreshRoster callable (Sprint 29G.5K)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWriteAuditEvent.mockResolvedValue({ eventId: "evt-1", record: {} });
  });

  it("returns only deterministic membership counts and writes the capture audit", async () => {
    mockRefresh.mockResolvedValueOnce(baseResult());
    const response = await __lmsClassesRefreshRosterHandler(makeRequest());
    expect(response).toEqual({
      classId: "class-1",
      membersSeen: 19,
      added: 19,
      reaffirmed: 0,
      removed: 0,
      withdrawnEnrollments: 0,
      upstreamRosterEmpty: false,
    });
    // Response carries no linkId, provider account id, identity hash, uid,
    // email, or token.
    expect(Object.keys(response)).not.toContain("linkId");

    expect(mockRefresh).toHaveBeenCalledWith({
      actor: { uid: "teacher-1", schoolId: "school-a", districtId: "district-a" },
      classId: "class-1",
    });
    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    const audit = mockWriteAuditEvent.mock.calls[0][0];
    expect(audit.action).toBe("lms.rosterMembershipsCaptured");
    expect(audit.targetType).toBe("class");
    expect(audit.targetId).toBe("class-1");
    expect(audit.actorRole).toBe("teacher");
    // Payload carries only PII-free counts + provider id.
    expect(audit.payload).toEqual({
      providerId: "googleClassroom",
      membersSeen: 19,
      added: 19,
      reaffirmed: 0,
      removed: 0,
      withdrawnEnrollments: 0,
      upstreamRosterEmpty: false,
    });
    expect(JSON.stringify(audit)).not.toContain("identityHash");
  });

  it("rejects a non-object request payload", async () => {
    await expect(
      __lmsClassesRefreshRosterHandler(makeRequest({ data: 42 })),
    ).rejects.toMatchObject({ code: "lms.invalidRequest" });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("rejects a missing classId", async () => {
    await expect(
      __lmsClassesRefreshRosterHandler(makeRequest({ data: {} })),
    ).rejects.toMatchObject({ code: "lms.invalidClassId" });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("does not write an audit when the capture engine throws", async () => {
    mockRefresh.mockRejectedValueOnce(
      Object.assign(new Error("boom"), { code: "lms.classNotLinked" }),
    );
    await expect(
      __lmsClassesRefreshRosterHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "lms.classNotLinked" });
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });
});
