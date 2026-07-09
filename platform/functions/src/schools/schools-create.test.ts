import type { CallableRequest } from "firebase-functions/v2/https";

const mockSchoolGet = jest.fn();
const mockSchoolSet = jest.fn();
const mockSchoolDocRef = jest.fn(() => ({ get: mockSchoolGet }));
const mockSchoolCreationDocRef = jest.fn(() => ({ set: mockSchoolSet }));

const mockWriteAuditEvent = jest.fn();

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

const SERVER_TIMESTAMP_SENTINEL = Symbol("serverTimestamp");

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
  },
}));

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    schoolDocRef: mockSchoolDocRef,
    schoolCreationDocRef: mockSchoolCreationDocRef,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __schoolsCreateHandler } from "./schools-create";

type CreateData = {
  schoolId?: unknown;
  name?: unknown;
  shortName?: unknown;
  timezone?: unknown;
  district?: unknown;
  gradeLevels?: unknown;
  brandingRef?: unknown;
};

const VALID_DATA: CreateData = {
  schoolId: "school-abc",
  name: "Alpha Academy",
  shortName: "alpha",
  timezone: "America/New_York",
};

function makeRequest(
  overrides: {
    uid?: string;
    data?: unknown;
    hasAuth?: boolean;
    token?: Record<string, unknown> | null;
  } = {},
): CallableRequest<unknown> {
  const hasAuth = overrides.hasAuth ?? true;
  const uid = overrides.uid ?? "uid-admin";
  const data = overrides.data === undefined ? { ...VALID_DATA } : overrides.data;
  const token =
    overrides.token === undefined
      ? { role: "platformAdministrator" }
      : overrides.token;
  return {
    data,
    auth: hasAuth
      ? ({ uid, token: token ?? undefined } as never)
      : undefined,
    rawRequest: {} as never,
  };
}

function absentSnapshot() {
  return { exists: false, data: () => undefined };
}

function existingSnapshot(
  overrides: {
    name?: string;
    shortName?: string;
    timezone?: string;
    district?: string;
    gradeLevels?: readonly string[];
    brandingRef?: string;
  } = {},
) {
  return {
    exists: true,
    data: () => ({
      name: overrides.name ?? "Alpha Academy",
      shortName: overrides.shortName ?? "alpha",
      timezone: overrides.timezone ?? "America/New_York",
      createdAt: {} as never,
      ...(overrides.district !== undefined
        ? { district: overrides.district }
        : {}),
      ...(overrides.gradeLevels !== undefined
        ? { gradeLevels: overrides.gradeLevels }
        : {}),
      ...(overrides.brandingRef !== undefined
        ? { brandingRef: overrides.brandingRef }
        : {}),
    }),
  };
}

describe("schoolsCreate", () => {
  beforeEach(() => {
    mockSchoolGet.mockReset();
    mockSchoolSet.mockReset();
    mockSchoolDocRef.mockClear();
    mockSchoolCreationDocRef.mockClear();
    mockWriteAuditEvent.mockReset();
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it("creates a canonical schools/{schoolId} document and returns the canonical response", async () => {
    mockSchoolGet.mockResolvedValueOnce(absentSnapshot());
    mockSchoolSet.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    const result = await __schoolsCreateHandler(makeRequest());

    expect(mockSchoolDocRef).toHaveBeenCalledWith("school-abc");
    expect(mockSchoolCreationDocRef).toHaveBeenCalledWith("school-abc");
    expect(mockSchoolSet).toHaveBeenCalledTimes(1);
    expect(mockSchoolSet).toHaveBeenCalledWith({
      name: "Alpha Academy",
      shortName: "alpha",
      timezone: "America/New_York",
      createdAt: SERVER_TIMESTAMP_SENTINEL,
    });
    expect(result).toEqual({ schoolId: "school-abc", alreadyCreated: false });
  });

  it("preserves optional fields in the canonical write payload", async () => {
    mockSchoolGet.mockResolvedValueOnce(absentSnapshot());
    mockSchoolSet.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    await __schoolsCreateHandler(
      makeRequest({
        data: {
          ...VALID_DATA,
          district: "District 5",
          gradeLevels: ["6", "7", "8"],
          brandingRef: "branding/alpha",
        },
      }),
    );

    expect(mockSchoolSet).toHaveBeenCalledWith({
      name: "Alpha Academy",
      shortName: "alpha",
      timezone: "America/New_York",
      createdAt: SERVER_TIMESTAMP_SENTINEL,
      district: "District 5",
      gradeLevels: ["6", "7", "8"],
      brandingRef: "branding/alpha",
    });
  });

  it("rejects an unauthenticated caller with schools.unauthenticated", async () => {
    await expect(
      __schoolsCreateHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({
      name: "PlatformError",
      code: "schools.unauthenticated",
    });
    expect(mockSchoolDocRef).not.toHaveBeenCalled();
    expect(mockSchoolCreationDocRef).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects non-administrator callers with schools.unauthorized", async () => {
    await expect(
      __schoolsCreateHandler(makeRequest({ token: { role: "teacher" } })),
    ).rejects.toMatchObject({ code: "schools.unauthorized" });
    await expect(
      __schoolsCreateHandler(makeRequest({ token: { role: "student" } })),
    ).rejects.toMatchObject({ code: "schools.unauthorized" });
    await expect(
      __schoolsCreateHandler(makeRequest({ token: {} })),
    ).rejects.toMatchObject({ code: "schools.unauthorized" });
    await expect(
      __schoolsCreateHandler(makeRequest({ token: null })),
    ).rejects.toMatchObject({ code: "schools.unauthorized" });
    expect(mockSchoolDocRef).not.toHaveBeenCalled();
    expect(mockSchoolCreationDocRef).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a non-object request payload with schools.invalidRequest", async () => {
    await expect(
      __schoolsCreateHandler(makeRequest({ data: null })),
    ).rejects.toMatchObject({ code: "schools.invalidRequest" });
    await expect(
      __schoolsCreateHandler(makeRequest({ data: "not-an-object" })),
    ).rejects.toMatchObject({ code: "schools.invalidRequest" });
    expect(mockSchoolDocRef).not.toHaveBeenCalled();
  });

  it("rejects a missing or non-URL-safe schoolId", async () => {
    await expect(
      __schoolsCreateHandler(
        makeRequest({ data: { ...VALID_DATA, schoolId: "   " } }),
      ),
    ).rejects.toMatchObject({ code: "schools.invalidSchoolId" });
    await expect(
      __schoolsCreateHandler(
        makeRequest({ data: { ...VALID_DATA, schoolId: "bad/id" } }),
      ),
    ).rejects.toMatchObject({ code: "schools.invalidSchoolId" });
    await expect(
      __schoolsCreateHandler(
        makeRequest({ data: { ...VALID_DATA, schoolId: "" } }),
      ),
    ).rejects.toMatchObject({ code: "schools.invalidSchoolId" });
    expect(mockSchoolDocRef).not.toHaveBeenCalled();
  });

  it("rejects an empty name with schools.invalidName", async () => {
    await expect(
      __schoolsCreateHandler(
        makeRequest({ data: { ...VALID_DATA, name: "   " } }),
      ),
    ).rejects.toMatchObject({ code: "schools.invalidName" });
    expect(mockSchoolDocRef).not.toHaveBeenCalled();
  });

  it("rejects a non-URL-safe shortName with schools.invalidShortName", async () => {
    await expect(
      __schoolsCreateHandler(
        makeRequest({ data: { ...VALID_DATA, shortName: "Alpha Academy" } }),
      ),
    ).rejects.toMatchObject({ code: "schools.invalidShortName" });
    await expect(
      __schoolsCreateHandler(
        makeRequest({ data: { ...VALID_DATA, shortName: "" } }),
      ),
    ).rejects.toMatchObject({ code: "schools.invalidShortName" });
    await expect(
      __schoolsCreateHandler(
        makeRequest({ data: { ...VALID_DATA, shortName: "-alpha-" } }),
      ),
    ).rejects.toMatchObject({ code: "schools.invalidShortName" });
    expect(mockSchoolDocRef).not.toHaveBeenCalled();
  });

  it("rejects an empty timezone with schools.invalidTimezone", async () => {
    await expect(
      __schoolsCreateHandler(
        makeRequest({ data: { ...VALID_DATA, timezone: "   " } }),
      ),
    ).rejects.toMatchObject({ code: "schools.invalidTimezone" });
    expect(mockSchoolDocRef).not.toHaveBeenCalled();
  });

  it("rejects a non-string district with schools.invalidDistrict", async () => {
    await expect(
      __schoolsCreateHandler(
        makeRequest({ data: { ...VALID_DATA, district: 42 } }),
      ),
    ).rejects.toMatchObject({ code: "schools.invalidDistrict" });
    await expect(
      __schoolsCreateHandler(
        makeRequest({ data: { ...VALID_DATA, district: "   " } }),
      ),
    ).rejects.toMatchObject({ code: "schools.invalidDistrict" });
    expect(mockSchoolDocRef).not.toHaveBeenCalled();
  });

  it("rejects an invalid gradeLevels with schools.invalidGradeLevels", async () => {
    await expect(
      __schoolsCreateHandler(
        makeRequest({ data: { ...VALID_DATA, gradeLevels: [] } }),
      ),
    ).rejects.toMatchObject({ code: "schools.invalidGradeLevels" });
    await expect(
      __schoolsCreateHandler(
        makeRequest({ data: { ...VALID_DATA, gradeLevels: ["6", ""] } }),
      ),
    ).rejects.toMatchObject({ code: "schools.invalidGradeLevels" });
    await expect(
      __schoolsCreateHandler(
        makeRequest({ data: { ...VALID_DATA, gradeLevels: "6,7" } }),
      ),
    ).rejects.toMatchObject({ code: "schools.invalidGradeLevels" });
    expect(mockSchoolDocRef).not.toHaveBeenCalled();
  });

  it("rejects an invalid brandingRef with schools.invalidBrandingRef", async () => {
    await expect(
      __schoolsCreateHandler(
        makeRequest({ data: { ...VALID_DATA, brandingRef: "   " } }),
      ),
    ).rejects.toMatchObject({ code: "schools.invalidBrandingRef" });
    expect(mockSchoolDocRef).not.toHaveBeenCalled();
  });

  it("is idempotent: an existing document with matching canonical fields returns alreadyCreated without re-writing", async () => {
    mockSchoolGet.mockResolvedValueOnce(existingSnapshot());

    const result = await __schoolsCreateHandler(makeRequest());

    expect(result).toEqual({ schoolId: "school-abc", alreadyCreated: true });
    expect(mockSchoolCreationDocRef).not.toHaveBeenCalled();
    expect(mockSchoolSet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("idempotent match compares optional fields (district, gradeLevels, brandingRef) exactly", async () => {
    mockSchoolGet.mockResolvedValueOnce(
      existingSnapshot({
        district: "District 5",
        gradeLevels: ["6", "7", "8"],
        brandingRef: "branding/alpha",
      }),
    );

    const result = await __schoolsCreateHandler(
      makeRequest({
        data: {
          ...VALID_DATA,
          district: "District 5",
          gradeLevels: ["6", "7", "8"],
          brandingRef: "branding/alpha",
        },
      }),
    );

    expect(result).toEqual({ schoolId: "school-abc", alreadyCreated: true });
    expect(mockSchoolSet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a conflicting existing document with schools.conflict", async () => {
    mockSchoolGet.mockResolvedValueOnce(
      existingSnapshot({ name: "Different Name" }),
    );

    await expect(
      __schoolsCreateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "schools.conflict" });

    expect(mockSchoolSet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a conflict when the existing document differs on an optional field", async () => {
    mockSchoolGet.mockResolvedValueOnce(
      existingSnapshot({ gradeLevels: ["6", "7"] }),
    );

    await expect(
      __schoolsCreateHandler(
        makeRequest({
          data: {
            ...VALID_DATA,
            gradeLevels: ["6", "7", "8"],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "schools.conflict" });
    expect(mockSchoolSet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("invokes the canonical audit helper with schools.created and the canonical target fields", async () => {
    mockSchoolGet.mockResolvedValueOnce(absentSnapshot());
    mockSchoolSet.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    await __schoolsCreateHandler(makeRequest());

    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: "uid-admin",
      actorRole: "platformAdministrator",
      action: "schools.created",
      targetType: "school",
      targetId: "school-abc",
      schoolId: "school-abc",
    });
  });

  it("orders side effects: creation write, then audit event", async () => {
    const calls: string[] = [];
    mockSchoolGet.mockResolvedValueOnce(absentSnapshot());
    mockSchoolSet.mockImplementationOnce(() => {
      calls.push("set");
      return Promise.resolve();
    });
    mockWriteAuditEvent.mockImplementationOnce(() => {
      calls.push("audit");
      return Promise.resolve({ eventId: "evt-1", record: {} });
    });

    await __schoolsCreateHandler(makeRequest());

    expect(calls).toEqual(["set", "audit"]);
  });

  it("propagates a downstream creation-write failure and does not write audit", async () => {
    mockSchoolGet.mockResolvedValueOnce(absentSnapshot());
    const setErr = new Error("firestore down");
    mockSchoolSet.mockRejectedValueOnce(setErr);

    await expect(__schoolsCreateHandler(makeRequest())).rejects.toBe(setErr);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("propagates a downstream audit helper failure", async () => {
    mockSchoolGet.mockResolvedValueOnce(absentSnapshot());
    mockSchoolSet.mockResolvedValueOnce(undefined);
    const auditErr = new PlatformError(
      "audit.writeFailed",
      "boom",
      new Error("network"),
    );
    mockWriteAuditEvent.mockRejectedValueOnce(auditErr);

    await expect(__schoolsCreateHandler(makeRequest())).rejects.toBe(auditErr);
  });

  it("trims whitespace on every scalar field before writing", async () => {
    mockSchoolGet.mockResolvedValueOnce(absentSnapshot());
    mockSchoolSet.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    await __schoolsCreateHandler(
      makeRequest({
        data: {
          schoolId: "  school-abc  ",
          name: "  Alpha Academy  ",
          shortName: "  alpha  ",
          timezone: "  America/New_York  ",
          district: "  District 5  ",
          brandingRef: "  branding/alpha  ",
        },
      }),
    );

    expect(mockSchoolDocRef).toHaveBeenCalledWith("school-abc");
    expect(mockSchoolCreationDocRef).toHaveBeenCalledWith("school-abc");
    expect(mockSchoolSet).toHaveBeenCalledWith({
      name: "Alpha Academy",
      shortName: "alpha",
      timezone: "America/New_York",
      createdAt: SERVER_TIMESTAMP_SENTINEL,
      district: "District 5",
      brandingRef: "branding/alpha",
    });
  });
});
