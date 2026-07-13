const mockSetCustomUserClaims = jest.fn();
const mockGetApps = jest.fn(() => [{}]);
const mockInitializeApp = jest.fn();

jest.mock("firebase-admin/app", () => ({
  getApps: () => mockGetApps(),
  initializeApp: () => mockInitializeApp(),
}));

jest.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ setCustomUserClaims: mockSetCustomUserClaims }),
}));

import { PlatformError } from "../errors/platform-error";
import { writeCustomClaims } from "./claims";

function validInput(overrides: Partial<Parameters<typeof writeCustomClaims>[0]> = {}) {
  return {
    uid: "uid-abc",
    status: "active" as const,
    role: "student" as const,
    schoolId: "school-123",
    districtId: "district-abc",
    ...overrides,
  };
}

describe("writeCustomClaims", () => {
  beforeEach(() => {
    mockSetCustomUserClaims.mockReset();
    mockGetApps.mockClear();
    mockInitializeApp.mockClear();
  });

  it("writes the canonical { role, schoolId, districtId } shape and returns it", async () => {
    mockSetCustomUserClaims.mockResolvedValueOnce(undefined);

    const result = await writeCustomClaims(validInput());

    expect(mockSetCustomUserClaims).toHaveBeenCalledTimes(1);
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith("uid-abc", {
      role: "student",
      schoolId: "school-123",
      districtId: "district-abc",
    });
    expect(result).toEqual({
      role: "student",
      schoolId: "school-123",
      districtId: "district-abc",
    });
  });

  it("writes claims for each canonical role value", async () => {
    mockSetCustomUserClaims.mockResolvedValue(undefined);

    for (const role of ["teacher", "student", "platformAdministrator"] as const) {
      await writeCustomClaims(validInput({ role }));
    }

    expect(mockSetCustomUserClaims).toHaveBeenCalledTimes(3);
    const roles = mockSetCustomUserClaims.mock.calls.map((call) => call[1].role);
    expect(roles).toEqual(["teacher", "student", "platformAdministrator"]);
  });

  it("overwrites prior claims by passing exactly { role, schoolId, districtId } (no extras)", async () => {
    mockSetCustomUserClaims.mockResolvedValueOnce(undefined);

    await writeCustomClaims(validInput());

    const claimsWritten = mockSetCustomUserClaims.mock.calls[0][1];
    expect(Object.keys(claimsWritten).sort()).toEqual([
      "districtId",
      "role",
      "schoolId",
    ]);
  });

  it("ignores extraneous fields on the input and writes only the canonical shape", async () => {
    mockSetCustomUserClaims.mockResolvedValueOnce(undefined);

    const extraneous = {
      ...validInput(),
      unrecognized: "should-not-leak",
      isAdmin: true,
    } as unknown as Parameters<typeof writeCustomClaims>[0];
    await writeCustomClaims(extraneous);

    const claimsWritten = mockSetCustomUserClaims.mock.calls[0][1];
    expect(claimsWritten).toEqual({
      role: "student",
      schoolId: "school-123",
      districtId: "district-abc",
    });
  });

  it.each([
    ["provisioned"],
    ["pendingVerification"],
    ["suspended"],
    ["archived"],
  ] as const)("rejects status %s with claims.notActive and does not write", async (status) => {
    await expect(
      writeCustomClaims(validInput({ status })),
    ).rejects.toMatchObject({
      name: "PlatformError",
      code: "claims.notActive",
    });
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  it("rejects an empty uid with claims.invalidUid", async () => {
    await expect(writeCustomClaims(validInput({ uid: "" }))).rejects.toBeInstanceOf(
      PlatformError,
    );
    await expect(writeCustomClaims(validInput({ uid: "   " }))).rejects.toMatchObject({
      code: "claims.invalidUid",
    });
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  it("rejects an empty schoolId with claims.invalidSchoolId", async () => {
    await expect(
      writeCustomClaims(validInput({ schoolId: "" })),
    ).rejects.toMatchObject({
      code: "claims.invalidSchoolId",
    });
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  it("rejects a missing districtId with claims.invalidDistrictId", async () => {
    const { districtId: _omitted, ...withoutDistrict } = validInput();
    void _omitted;
    await expect(
      writeCustomClaims(
        withoutDistrict as unknown as Parameters<typeof writeCustomClaims>[0],
      ),
    ).rejects.toMatchObject({ code: "claims.invalidDistrictId" });
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  it("rejects an empty districtId with claims.invalidDistrictId", async () => {
    await expect(
      writeCustomClaims(validInput({ districtId: "" })),
    ).rejects.toMatchObject({
      code: "claims.invalidDistrictId",
    });
    await expect(
      writeCustomClaims(validInput({ districtId: "   " })),
    ).rejects.toMatchObject({
      code: "claims.invalidDistrictId",
    });
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  it("rejects an invalid role with claims.invalidRole", async () => {
    await expect(
      writeCustomClaims(
        // @ts-expect-error - deliberately invalid Role value
        validInput({ role: "parent" }),
      ),
    ).rejects.toMatchObject({ code: "claims.invalidRole" });
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  it("wraps a downstream setCustomUserClaims failure as claims.writeFailed and preserves the cause", async () => {
    const downstream = new Error("network down");
    mockSetCustomUserClaims.mockRejectedValueOnce(downstream);

    let thrown: unknown;
    try {
      await writeCustomClaims(validInput());
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(PlatformError);
    expect(thrown).toMatchObject({
      code: "claims.writeFailed",
    });
    expect((thrown as PlatformError).cause).toBe(downstream);
  });

  it("overwrite semantics: a second call replaces the prior write with the new canonical shape", async () => {
    mockSetCustomUserClaims.mockResolvedValue(undefined);

    await writeCustomClaims(
      validInput({ role: "student", schoolId: "school-1", districtId: "district-1" }),
    );
    await writeCustomClaims(
      validInput({ role: "teacher", schoolId: "school-2", districtId: "district-2" }),
    );

    expect(mockSetCustomUserClaims).toHaveBeenNthCalledWith(1, "uid-abc", {
      role: "student",
      schoolId: "school-1",
      districtId: "district-1",
    });
    expect(mockSetCustomUserClaims).toHaveBeenNthCalledWith(2, "uid-abc", {
      role: "teacher",
      schoolId: "school-2",
      districtId: "district-2",
    });
  });
});
