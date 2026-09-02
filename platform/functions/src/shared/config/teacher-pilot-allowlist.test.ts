const mockDocGet = jest.fn();
const mockDoc = jest.fn(() => ({ get: mockDocGet }));
const mockCollection = jest.fn(() => ({ doc: mockDoc }));
const mockGetAdminFirestore = jest.fn(() => ({ collection: mockCollection }));

jest.mock("../firestore/admin", () => ({
  getAdminFirestore: mockGetAdminFirestore,
}));

import {
  PLATFORM_CONFIG_COLLECTION,
  TEACHER_PILOT_ALLOWLIST_DOC_ID,
  assertTeacherPilotAllowlisted,
  normalizeEmail,
  resolvePilotSchoolId,
} from "./teacher-pilot-allowlist";

function allowlistSnapshot(
  overrides: { exists?: boolean; data?: unknown } = {},
) {
  const exists = overrides.exists ?? true;
  return {
    exists,
    data: () =>
      exists
        ? "data" in overrides
          ? overrides.data
          : { emails: ["pilot.teacher@example.org"] }
        : undefined,
  };
}

describe("teacher-pilot-allowlist", () => {
  beforeEach(() => {
    mockDocGet.mockReset();
    mockDoc.mockClear();
    mockCollection.mockClear();
    mockGetAdminFirestore.mockClear();
  });

  describe("normalizeEmail", () => {
    it("lowercases and trims a well-formed email", () => {
      expect(normalizeEmail("  Pilot.Teacher@Example.ORG  ")).toBe(
        "pilot.teacher@example.org",
      );
    });

    it("returns undefined for non-string or empty values", () => {
      expect(normalizeEmail(undefined)).toBeUndefined();
      expect(normalizeEmail(null)).toBeUndefined();
      expect(normalizeEmail(42)).toBeUndefined();
      expect(normalizeEmail("")).toBeUndefined();
      expect(normalizeEmail("   ")).toBeUndefined();
    });
  });

  describe("assertTeacherPilotAllowlisted", () => {
    it("resolves for a member, reading the canonical config document", async () => {
      mockDocGet.mockResolvedValueOnce(allowlistSnapshot());

      await expect(
        assertTeacherPilotAllowlisted("pilot.teacher@example.org"),
      ).resolves.toBeUndefined();

      expect(mockCollection).toHaveBeenCalledWith(PLATFORM_CONFIG_COLLECTION);
      expect(mockDoc).toHaveBeenCalledWith(TEACHER_PILOT_ALLOWLIST_DOC_ID);
    });

    it("matches case-insensitively and tolerates surrounding whitespace on both sides", async () => {
      mockDocGet.mockResolvedValueOnce(
        allowlistSnapshot({ data: { emails: ["  Pilot.Teacher@Example.ORG "] } }),
      );

      await expect(
        assertTeacherPilotAllowlisted("PILOT.teacher@example.org"),
      ).resolves.toBeUndefined();
    });

    it("refuses an email that is not a member", async () => {
      mockDocGet.mockResolvedValueOnce(allowlistSnapshot());

      await expect(
        assertTeacherPilotAllowlisted("stranger@example.org"),
      ).rejects.toMatchObject({ code: "teachers.pilotNotAllowlisted" });
    });

    it("does not perform domain or fuzzy matching", async () => {
      mockDocGet.mockResolvedValueOnce(
        allowlistSnapshot({ data: { emails: ["teacher@example.org"] } }),
      );

      await expect(
        assertTeacherPilotAllowlisted("teacher@evil-example.org"),
      ).rejects.toMatchObject({ code: "teachers.pilotNotAllowlisted" });
    });

    it("fails closed when the config document does not exist", async () => {
      mockDocGet.mockResolvedValueOnce(allowlistSnapshot({ exists: false }));

      await expect(
        assertTeacherPilotAllowlisted("pilot.teacher@example.org"),
      ).rejects.toMatchObject({ code: "teachers.pilotNotAllowlisted" });
    });

    it("fails closed when emails is missing, empty, or not an array", async () => {
      mockDocGet.mockResolvedValueOnce(allowlistSnapshot({ data: {} }));
      await expect(
        assertTeacherPilotAllowlisted("pilot.teacher@example.org"),
      ).rejects.toMatchObject({ code: "teachers.pilotNotAllowlisted" });

      mockDocGet.mockResolvedValueOnce(
        allowlistSnapshot({ data: { emails: [] } }),
      );
      await expect(
        assertTeacherPilotAllowlisted("pilot.teacher@example.org"),
      ).rejects.toMatchObject({ code: "teachers.pilotNotAllowlisted" });

      mockDocGet.mockResolvedValueOnce(
        allowlistSnapshot({ data: { emails: "pilot.teacher@example.org" } }),
      );
      await expect(
        assertTeacherPilotAllowlisted("pilot.teacher@example.org"),
      ).rejects.toMatchObject({ code: "teachers.pilotNotAllowlisted" });
    });

    it("fails closed when no verified email is available, without reading Firestore", async () => {
      await expect(
        assertTeacherPilotAllowlisted(undefined),
      ).rejects.toMatchObject({ code: "teachers.pilotNotAllowlisted" });
      await expect(assertTeacherPilotAllowlisted("   ")).rejects.toMatchObject({
        code: "teachers.pilotNotAllowlisted",
      });

      expect(mockDocGet).not.toHaveBeenCalled();
    });

    it("does not name allowlist membership in the refusal message", async () => {
      mockDocGet.mockResolvedValueOnce(
        allowlistSnapshot({ data: { emails: ["secret.member@example.org"] } }),
      );

      await expect(
        assertTeacherPilotAllowlisted("stranger@example.org"),
      ).rejects.toMatchObject({
        message: "This account is not authorized for the teacher pilot.",
      });
    });
  });

  describe("resolvePilotSchoolId", () => {
    it("returns the trimmed pilotSchoolId, reading the canonical config document", async () => {
      mockDocGet.mockResolvedValueOnce(
        allowlistSnapshot({
          data: {
            emails: ["pilot.teacher@example.org"],
            pilotSchoolId: "  weston-middle  ",
          },
        }),
      );

      await expect(resolvePilotSchoolId()).resolves.toBe("weston-middle");
      expect(mockCollection).toHaveBeenCalledWith(PLATFORM_CONFIG_COLLECTION);
      expect(mockDoc).toHaveBeenCalledWith(TEACHER_PILOT_ALLOWLIST_DOC_ID);
    });

    it("fails closed when the config document is absent", async () => {
      mockDocGet.mockResolvedValueOnce(allowlistSnapshot({ exists: false }));
      await expect(resolvePilotSchoolId()).rejects.toMatchObject({
        code: "teachers.pilotSchoolUnconfigured",
      });
    });

    it("fails closed when pilotSchoolId is missing", async () => {
      mockDocGet.mockResolvedValueOnce(
        allowlistSnapshot({ data: { emails: ["pilot.teacher@example.org"] } }),
      );
      await expect(resolvePilotSchoolId()).rejects.toMatchObject({
        code: "teachers.pilotSchoolUnconfigured",
      });
    });

    it("fails closed when pilotSchoolId is malformed (non-string or empty)", async () => {
      mockDocGet.mockResolvedValueOnce(
        allowlistSnapshot({ data: { pilotSchoolId: 42 } }),
      );
      await expect(resolvePilotSchoolId()).rejects.toMatchObject({
        code: "teachers.pilotSchoolUnconfigured",
      });

      mockDocGet.mockResolvedValueOnce(
        allowlistSnapshot({ data: { pilotSchoolId: "   " } }),
      );
      await expect(resolvePilotSchoolId()).rejects.toMatchObject({
        code: "teachers.pilotSchoolUnconfigured",
      });
    });
  });
});
