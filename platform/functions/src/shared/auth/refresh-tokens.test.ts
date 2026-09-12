const mockRevokeRefreshTokens = jest.fn();
const mockGetApps = jest.fn(() => [{}]);
const mockInitializeApp = jest.fn();

jest.mock("firebase-admin/app", () => ({
  getApps: () => mockGetApps(),
  initializeApp: () => mockInitializeApp(),
}));

jest.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    revokeRefreshTokens: mockRevokeRefreshTokens,
  }),
}));

import { PlatformError } from "../errors/platform-error";
import { revokeUserRefreshTokens } from "./refresh-tokens";

describe("revokeUserRefreshTokens", () => {
  beforeEach(() => {
    mockRevokeRefreshTokens.mockReset();
  });

  it("revokes refresh tokens for the given uid", async () => {
    mockRevokeRefreshTokens.mockResolvedValueOnce(undefined);
    await expect(revokeUserRefreshTokens("uid-abc")).resolves.toBeUndefined();
    expect(mockRevokeRefreshTokens).toHaveBeenCalledWith("uid-abc");
  });

  it("is idempotent: a second revoke calls through again without error", async () => {
    mockRevokeRefreshTokens.mockResolvedValue(undefined);
    await revokeUserRefreshTokens("uid-abc");
    await revokeUserRefreshTokens("uid-abc");
    expect(mockRevokeRefreshTokens).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty uid with auth.invalidUid and does not call the SDK", async () => {
    await expect(revokeUserRefreshTokens("  ")).rejects.toMatchObject({
      name: "PlatformError",
      code: "auth.invalidUid",
    });
    expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
  });

  it("wraps a downstream failure as auth.revokeRefreshTokensFailed with the cause", async () => {
    const downstream = new Error("auth down");
    mockRevokeRefreshTokens.mockRejectedValueOnce(downstream);
    let thrown: unknown;
    try {
      await revokeUserRefreshTokens("uid-abc");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PlatformError);
    expect(thrown).toMatchObject({ code: "auth.revokeRefreshTokensFailed" });
    expect((thrown as PlatformError).cause).toBe(downstream);
  });
});
