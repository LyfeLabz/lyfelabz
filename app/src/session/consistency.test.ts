import {
  checkActiveConsistency,
  extractCanonicalClaims,
  isTokenAheadOfRecord,
} from "./consistency";
import type { UserRecordRead } from "./types";

describe("extractCanonicalClaims", () => {
  test("extracts canonical role and schoolId", () => {
    const claims = extractCanonicalClaims({ role: "teacher", schoolId: "s1" });
    expect(claims).toEqual({ role: "teacher", schoolId: "s1" });
  });

  test("ignores unknown extra keys", () => {
    const claims = extractCanonicalClaims({
      role: "teacher",
      schoolId: "s1",
      districtId: "d1",
      classroomIds: ["c1"],
    });
    expect(claims).toEqual({ role: "teacher", schoolId: "s1" });
  });

  test("treats non-canonical role values as absent", () => {
    const claims = extractCanonicalClaims({ role: "parent", schoolId: "s1" });
    expect(claims).toEqual({ schoolId: "s1" });
  });

  test("treats empty schoolId as absent", () => {
    const claims = extractCanonicalClaims({ role: "teacher", schoolId: "" });
    expect(claims).toEqual({ role: "teacher" });
  });

  test("returns an empty object on empty claims", () => {
    expect(extractCanonicalClaims({})).toEqual({});
  });
});

describe("checkActiveConsistency", () => {
  const activeRecord: UserRecordRead = {
    status: "active",
    role: "teacher",
    schoolId: "s1",
    displayName: "Ada",
  };

  test("matches when claims mirror record exactly", () => {
    expect(
      checkActiveConsistency(activeRecord, { role: "teacher", schoolId: "s1" }),
    ).toBe("match");
  });

  test("mismatch when claim role differs", () => {
    expect(
      checkActiveConsistency(activeRecord, { role: "student", schoolId: "s1" }),
    ).toBe("mismatch");
  });

  test("mismatch when claim schoolId differs", () => {
    expect(
      checkActiveConsistency(activeRecord, { role: "teacher", schoolId: "s2" }),
    ).toBe("mismatch");
  });

  test("mismatch when claims are absent", () => {
    expect(checkActiveConsistency(activeRecord, {})).toBe("mismatch");
  });

  test("mismatch when record status is not active", () => {
    const pending: UserRecordRead = {
      status: "pendingVerification",
      role: "teacher",
      schoolId: "s1",
      displayName: "Ada",
    };
    expect(
      checkActiveConsistency(pending, { role: "teacher", schoolId: "s1" }),
    ).toBe("mismatch");
  });
});

describe("isTokenAheadOfRecord", () => {
  test("true when record is pending and claim role is teacher", () => {
    const record: UserRecordRead = {
      status: "pendingVerification",
      role: "teacher",
      schoolId: "s1",
      displayName: "Ada",
    };
    expect(isTokenAheadOfRecord(record, { role: "teacher", schoolId: "s1" })).toBe(
      true,
    );
  });

  test("false when record is pending and no teacher claim is present", () => {
    const record: UserRecordRead = {
      status: "pendingVerification",
      role: "teacher",
      schoolId: "s1",
      displayName: "Ada",
    };
    expect(isTokenAheadOfRecord(record, {})).toBe(false);
  });

  test("false when record is active", () => {
    const record: UserRecordRead = {
      status: "active",
      role: "teacher",
      schoolId: "s1",
      displayName: "Ada",
    };
    expect(isTokenAheadOfRecord(record, { role: "teacher", schoolId: "s1" })).toBe(
      false,
    );
  });
});
