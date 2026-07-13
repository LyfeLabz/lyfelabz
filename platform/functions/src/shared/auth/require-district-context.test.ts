import type { CallableRequest } from "firebase-functions/v2/https";

const mockUserGet = jest.fn();
const mockSchoolGet = jest.fn();
const mockUserRecordDocRef: jest.Mock = jest.fn(() => ({ get: mockUserGet }));
const mockSchoolDocRef: jest.Mock = jest.fn(() => ({ get: mockSchoolGet }));

jest.mock("../firestore/typed-ref", () => ({
  userRecordDocRef: (uid: string) => mockUserRecordDocRef(uid),
  schoolDocRef: (schoolId: string) => mockSchoolDocRef(schoolId),
}));

import { PlatformError } from "../errors/platform-error";
import {
  DISTRICT_ERROR_IDS,
  isDistrictErrorId,
  type DistrictErrorId,
} from "../errors/district-errors";
import { requireDistrictContext } from "./require-district-context";

type TokenOverrides = Partial<{
  role: unknown;
  schoolId: unknown;
  districtId: unknown;
}>;

const CANONICAL_TOKEN: TokenOverrides = {
  role: "teacher",
  schoolId: "school-123",
  districtId: "district-abc",
};

function makeRequest(
  overrides: {
    uid?: string | null;
    hasAuth?: boolean;
    token?: TokenOverrides | null;
  } = {},
): CallableRequest<unknown> {
  const hasAuth = overrides.hasAuth ?? true;
  const uid = overrides.uid ?? "uid-caller";
  const token =
    overrides.token === null
      ? undefined
      : ({ ...CANONICAL_TOKEN, ...overrides.token } as Record<string, unknown>);
  return {
    data: {},
    auth: hasAuth
      ? ({ uid, token } as never)
      : undefined,
    rawRequest: {} as never,
  };
}

function userSnapshot(
  overrides: {
    exists?: boolean;
    role?: unknown;
    schoolId?: unknown;
    status?: unknown;
  } = {},
) {
  const exists = overrides.exists ?? true;
  if (!exists) {
    return { exists: false, data: () => undefined };
  }
  const data: Record<string, unknown> = {
    authUid: "uid-caller",
    status: "status" in overrides ? overrides.status : "active",
    createdAt: {},
    role: "role" in overrides ? overrides.role : "teacher",
    schoolId: "schoolId" in overrides ? overrides.schoolId : "school-123",
    displayName: "Test User",
  };
  return { exists: true, data: () => data };
}

function schoolSnapshot(
  overrides: { exists?: boolean; districtId?: unknown } = {},
) {
  const exists = overrides.exists ?? true;
  if (!exists) {
    return { exists: false, data: () => undefined };
  }
  const data: Record<string, unknown> = {
    name: "Test School",
    shortName: "Test",
    timezone: "America/New_York",
    createdAt: {},
    districtId:
      "districtId" in overrides ? overrides.districtId : "district-abc",
  };
  return { exists: true, data: () => data };
}

async function expectDistrictError(
  promise: Promise<unknown>,
  code: DistrictErrorId,
): Promise<PlatformError> {
  let thrown: unknown;
  try {
    await promise;
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(PlatformError);
  const err = thrown as PlatformError;
  expect(err.code).toBe(code);
  expect(isDistrictErrorId(err.code)).toBe(true);
  return err;
}

describe("requireDistrictContext", () => {
  beforeEach(() => {
    mockUserGet.mockReset();
    mockSchoolGet.mockReset();
    mockUserRecordDocRef.mockClear();
    mockSchoolDocRef.mockClear();
  });

  describe("closed-set error identifier module", () => {
    it("exposes every certified PDR-025 §17 identifier as a closed union", () => {
      expect(DISTRICT_ERROR_IDS).toEqual([
        "unauthenticated",
        "account-inactive",
        "role-forbidden",
        "district-unassigned",
        "district-mismatch",
        "school-district-mismatch",
        "cross-district-reference",
        "claim-stale",
        "claim-state-mismatch",
        "server-only-field",
        "transfer-not-supported",
      ]);
    });

    it("recognizes every certified identifier via isDistrictErrorId", () => {
      for (const id of DISTRICT_ERROR_IDS) {
        expect(isDistrictErrorId(id)).toBe(true);
      }
    });

    it("refuses non-canonical identifiers via isDistrictErrorId", () => {
      expect(isDistrictErrorId("districtMismatch")).toBe(false);
      expect(isDistrictErrorId("")).toBe(false);
      expect(isDistrictErrorId(undefined)).toBe(false);
      expect(isDistrictErrorId(42)).toBe(false);
    });
  });

  describe("happy path", () => {
    it("returns the verified district context when caller, record, and claims agree", async () => {
      mockUserGet.mockResolvedValueOnce(userSnapshot());
      mockSchoolGet.mockResolvedValueOnce(schoolSnapshot());

      const context = await requireDistrictContext(makeRequest());

      expect(context).toEqual({
        uid: "uid-caller",
        role: "teacher",
        schoolId: "school-123",
        districtId: "district-abc",
      });
      expect(mockUserRecordDocRef).toHaveBeenCalledWith("uid-caller");
      expect(mockSchoolDocRef).toHaveBeenCalledWith("school-123");
    });

    it("returns context for a student role when every field agrees", async () => {
      mockUserGet.mockResolvedValueOnce(
        userSnapshot({ role: "student" }),
      );
      mockSchoolGet.mockResolvedValueOnce(schoolSnapshot());

      const context = await requireDistrictContext(
        makeRequest({ token: { role: "student" } }),
      );

      expect(context.role).toBe("student");
      expect(context.districtId).toBe("district-abc");
    });
  });

  describe("authentication and account lifecycle", () => {
    it("throws unauthenticated when request.auth is absent", async () => {
      await expectDistrictError(
        requireDistrictContext(makeRequest({ hasAuth: false })),
        "unauthenticated",
      );
      expect(mockUserGet).not.toHaveBeenCalled();
    });

    it("throws unauthenticated when request.auth.uid is empty", async () => {
      await expectDistrictError(
        requireDistrictContext(makeRequest({ uid: "" })),
        "unauthenticated",
      );
      expect(mockUserGet).not.toHaveBeenCalled();
    });

    it("throws unauthenticated when request.auth.uid is whitespace only", async () => {
      await expectDistrictError(
        requireDistrictContext(makeRequest({ uid: "   " })),
        "unauthenticated",
      );
    });

    it("throws account-inactive when the user document does not exist", async () => {
      mockUserGet.mockResolvedValueOnce(userSnapshot({ exists: false }));

      await expectDistrictError(
        requireDistrictContext(makeRequest()),
        "account-inactive",
      );
      expect(mockSchoolGet).not.toHaveBeenCalled();
    });

    it.each(["provisioned", "pendingVerification", "suspended", "archived"])(
      "throws account-inactive when user status is %s",
      async (status) => {
        mockUserGet.mockResolvedValueOnce(userSnapshot({ status }));

        await expectDistrictError(
          requireDistrictContext(makeRequest()),
          "account-inactive",
        );
      },
    );
  });

  describe("canonical record integrity", () => {
    it("throws claim-state-mismatch when the record has no schoolId", async () => {
      mockUserGet.mockResolvedValueOnce(userSnapshot({ schoolId: undefined }));

      await expectDistrictError(
        requireDistrictContext(makeRequest()),
        "claim-state-mismatch",
      );
    });

    it("throws claim-state-mismatch when the record schoolId is whitespace only", async () => {
      mockUserGet.mockResolvedValueOnce(userSnapshot({ schoolId: "   " }));

      await expectDistrictError(
        requireDistrictContext(makeRequest()),
        "claim-state-mismatch",
      );
    });

    it("throws claim-state-mismatch when the record has no valid role", async () => {
      mockUserGet.mockResolvedValueOnce(userSnapshot({ role: undefined }));

      await expectDistrictError(
        requireDistrictContext(makeRequest()),
        "claim-state-mismatch",
      );
    });

    it("throws claim-state-mismatch when the record role is not in the canonical union", async () => {
      mockUserGet.mockResolvedValueOnce(userSnapshot({ role: "parent" }));

      await expectDistrictError(
        requireDistrictContext(makeRequest()),
        "claim-state-mismatch",
      );
    });
  });

  describe("school and district resolution", () => {
    it("throws school-district-mismatch when the school document is missing", async () => {
      mockUserGet.mockResolvedValueOnce(userSnapshot());
      mockSchoolGet.mockResolvedValueOnce(schoolSnapshot({ exists: false }));

      await expectDistrictError(
        requireDistrictContext(makeRequest()),
        "school-district-mismatch",
      );
    });

    it("throws district-unassigned when the school record has no districtId", async () => {
      mockUserGet.mockResolvedValueOnce(userSnapshot());
      mockSchoolGet.mockResolvedValueOnce(
        schoolSnapshot({ districtId: undefined }),
      );

      await expectDistrictError(
        requireDistrictContext(makeRequest()),
        "district-unassigned",
      );
    });

    it("throws district-unassigned when the school districtId is empty", async () => {
      mockUserGet.mockResolvedValueOnce(userSnapshot());
      mockSchoolGet.mockResolvedValueOnce(schoolSnapshot({ districtId: "" }));

      await expectDistrictError(
        requireDistrictContext(makeRequest()),
        "district-unassigned",
      );
    });

    it("throws district-unassigned when the school districtId is whitespace only", async () => {
      mockUserGet.mockResolvedValueOnce(userSnapshot());
      mockSchoolGet.mockResolvedValueOnce(schoolSnapshot({ districtId: "   " }));

      await expectDistrictError(
        requireDistrictContext(makeRequest()),
        "district-unassigned",
      );
    });

    it("throws district-unassigned when the school districtId is not a string", async () => {
      mockUserGet.mockResolvedValueOnce(userSnapshot());
      mockSchoolGet.mockResolvedValueOnce(schoolSnapshot({ districtId: 42 }));

      await expectDistrictError(
        requireDistrictContext(makeRequest()),
        "district-unassigned",
      );
    });
  });

  describe("claim vs record reconciliation", () => {
    it("throws claim-stale when the token has no districtId claim", async () => {
      mockUserGet.mockResolvedValueOnce(userSnapshot());
      mockSchoolGet.mockResolvedValueOnce(schoolSnapshot());

      await expectDistrictError(
        requireDistrictContext(
          makeRequest({ token: { districtId: undefined } }),
        ),
        "claim-stale",
      );
    });

    it("throws claim-stale when the token districtId is an empty string", async () => {
      mockUserGet.mockResolvedValueOnce(userSnapshot());
      mockSchoolGet.mockResolvedValueOnce(schoolSnapshot());

      await expectDistrictError(
        requireDistrictContext(makeRequest({ token: { districtId: "" } })),
        "claim-stale",
      );
    });

    it("throws claim-stale when the token has no role claim", async () => {
      mockUserGet.mockResolvedValueOnce(userSnapshot());
      mockSchoolGet.mockResolvedValueOnce(schoolSnapshot());

      await expectDistrictError(
        requireDistrictContext(makeRequest({ token: { role: undefined } })),
        "claim-stale",
      );
    });

    it("throws claim-stale when the token has no schoolId claim", async () => {
      mockUserGet.mockResolvedValueOnce(userSnapshot());
      mockSchoolGet.mockResolvedValueOnce(schoolSnapshot());

      await expectDistrictError(
        requireDistrictContext(makeRequest({ token: { schoolId: undefined } })),
        "claim-stale",
      );
    });

    it("throws claim-state-mismatch when token role disagrees with the record", async () => {
      mockUserGet.mockResolvedValueOnce(userSnapshot({ role: "teacher" }));
      mockSchoolGet.mockResolvedValueOnce(schoolSnapshot());

      await expectDistrictError(
        requireDistrictContext(makeRequest({ token: { role: "student" } })),
        "claim-state-mismatch",
      );
    });

    it("throws claim-state-mismatch when token schoolId disagrees with the record", async () => {
      mockUserGet.mockResolvedValueOnce(userSnapshot({ schoolId: "school-123" }));
      mockSchoolGet.mockResolvedValueOnce(schoolSnapshot());

      await expectDistrictError(
        requireDistrictContext(
          makeRequest({ token: { schoolId: "school-999" } }),
        ),
        "claim-state-mismatch",
      );
    });

    it("throws district-mismatch when token districtId disagrees with the resolved school district", async () => {
      mockUserGet.mockResolvedValueOnce(userSnapshot());
      mockSchoolGet.mockResolvedValueOnce(
        schoolSnapshot({ districtId: "district-abc" }),
      );

      await expectDistrictError(
        requireDistrictContext(
          makeRequest({ token: { districtId: "district-xyz" } }),
        ),
        "district-mismatch",
      );
    });

    it("district-mismatch error message does not leak the other district identifier", async () => {
      mockUserGet.mockResolvedValueOnce(userSnapshot());
      mockSchoolGet.mockResolvedValueOnce(
        schoolSnapshot({ districtId: "district-abc-canonical" }),
      );

      const err = await expectDistrictError(
        requireDistrictContext(
          makeRequest({ token: { districtId: "district-xyz-claimed" } }),
        ),
        "district-mismatch",
      );

      expect(err.message).not.toContain("district-abc-canonical");
      expect(err.message).not.toContain("district-xyz-claimed");
    });
  });

  describe("malformed data", () => {
    it("throws account-inactive when the user snapshot data is undefined", async () => {
      mockUserGet.mockResolvedValueOnce({ exists: true, data: () => undefined });

      await expectDistrictError(
        requireDistrictContext(makeRequest()),
        "account-inactive",
      );
    });

    it("throws school-district-mismatch when the school snapshot data is undefined", async () => {
      mockUserGet.mockResolvedValueOnce(userSnapshot());
      mockSchoolGet.mockResolvedValueOnce({
        exists: true,
        data: () => undefined,
      });

      await expectDistrictError(
        requireDistrictContext(makeRequest()),
        "school-district-mismatch",
      );
    });

    it("throws claim-stale when the token role is a non-string value", async () => {
      mockUserGet.mockResolvedValueOnce(userSnapshot());
      mockSchoolGet.mockResolvedValueOnce(schoolSnapshot());

      await expectDistrictError(
        requireDistrictContext(makeRequest({ token: { role: 42 } })),
        "claim-stale",
      );
    });

    it("throws claim-stale when the token districtId is a non-string value", async () => {
      mockUserGet.mockResolvedValueOnce(userSnapshot());
      mockSchoolGet.mockResolvedValueOnce(schoolSnapshot());

      await expectDistrictError(
        requireDistrictContext(makeRequest({ token: { districtId: 42 } })),
        "claim-stale",
      );
    });
  });
});
