type DocFixture = {
  present: boolean;
  data: Record<string, unknown> | null;
};

const enrollmentFixtures = new Map<string, DocFixture>();
const userFixtures = new Map<string, DocFixture>();
const enrollmentReadCounts = new Map<string, number>();
const userReadCounts = new Map<string, number>();

function makeDocRef(
  fixtures: Map<string, DocFixture>,
  counts: Map<string, number>,
  id: string,
): { get: () => Promise<{ exists: boolean; data: () => unknown }> } {
  return {
    get: () => {
      counts.set(id, (counts.get(id) ?? 0) + 1);
      const f = fixtures.get(id);
      if (!f) {
        return Promise.resolve({ exists: false, data: () => undefined });
      }
      return Promise.resolve({ exists: f.present, data: () => f.data });
    },
  };
}

const mockEnrollmentDocRef = jest.fn((id: string) =>
  makeDocRef(enrollmentFixtures, enrollmentReadCounts, id),
);
const mockUserRecordDocRef = jest.fn((uid: string) =>
  makeDocRef(userFixtures, userReadCounts, uid),
);

jest.mock("../shared", () => ({
  enrollmentDocRef: (id: string) => mockEnrollmentDocRef(id),
  userRecordDocRef: (uid: string) => mockUserRecordDocRef(uid),
}));

import {
  createRosterDisplayNameResolver,
  FALLBACK_ROSTER_DISPLAY_NAME,
  normalizeDisplayName,
  resolveRosterDisplayName,
  type RosterDisplayNameScope,
} from "./resolve-roster-display-name";

const CLASS_ID = "class-abc";
const OTHER_CLASS_ID = "class-xyz";
const SCHOOL_ID = "school-a";
const OTHER_SCHOOL_ID = "school-b";
const DISTRICT_ID = "district-1";
const STUDENT_A = "student-a";
const STUDENT_B = "student-b";

const SCOPE: RosterDisplayNameScope = Object.freeze({
  classId: CLASS_ID,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
});

function enrollmentIdFor(classId: string, studentId: string): string {
  return `${classId}__${studentId}`;
}

function seedEnrollment(
  studentId: string,
  overrides: Record<string, unknown> = {},
  classId: string = CLASS_ID,
  schoolId: string = SCHOOL_ID,
): void {
  const id = enrollmentIdFor(classId, studentId);
  enrollmentFixtures.set(id, {
    present: true,
    data: {
      studentId,
      classId,
      schoolId,
      status: "active",
      enrolledAt: { toMillis: () => 1_600_000_000_000 },
      ...overrides,
    },
  });
}

function seedUser(uid: string, overrides: Record<string, unknown> = {}): void {
  userFixtures.set(uid, {
    present: true,
    data: {
      authUid: uid,
      status: "active",
      createdAt: { toMillis: () => 1_600_000_000_000 },
      role: "student",
      schoolId: SCHOOL_ID,
      ...overrides,
    },
  });
}

describe("normalizeDisplayName", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeDisplayName("  Alex  ")).toBe("Alex");
  });

  it("collapses internal whitespace runs to a single space", () => {
    expect(normalizeDisplayName("Alex\t\tRivera")).toBe("Alex Rivera");
    expect(normalizeDisplayName("Alex   Rivera")).toBe("Alex Rivera");
  });

  it("returns null for empty, whitespace-only, or non-string values", () => {
    expect(normalizeDisplayName("")).toBeNull();
    expect(normalizeDisplayName("   ")).toBeNull();
    expect(normalizeDisplayName("\t \n")).toBeNull();
    expect(normalizeDisplayName(undefined)).toBeNull();
    expect(normalizeDisplayName(null)).toBeNull();
    expect(normalizeDisplayName(42)).toBeNull();
    expect(normalizeDisplayName({})).toBeNull();
  });

  it("preserves punctuation, diacritics, and internal single spaces", () => {
    expect(normalizeDisplayName("María José O'Neil-Smith")).toBe(
      "María José O'Neil-Smith",
    );
    expect(normalizeDisplayName(" 王 小明 ")).toBe("王 小明");
  });

  it("is idempotent under repeated application", () => {
    const once = normalizeDisplayName("  Alex   Rivera  ");
    expect(normalizeDisplayName(once)).toBe(once);
  });
});

describe("resolveRosterDisplayName", () => {
  beforeEach(() => {
    enrollmentFixtures.clear();
    userFixtures.clear();
    enrollmentReadCounts.clear();
    userReadCounts.clear();
    mockEnrollmentDocRef.mockClear();
    mockUserRecordDocRef.mockClear();
  });

  it("uses the enrollment override when present (precedence 1)", async () => {
    seedEnrollment(STUDENT_A, { displayNameOverride: "Ali" });
    seedUser(STUDENT_A, { displayName: "Alex Rivera" });
    const result = await resolveRosterDisplayName(SCOPE, STUDENT_A);
    expect(result).toEqual({
      studentId: STUDENT_A,
      displayName: "Ali",
      source: "enrollmentOverride",
    });
  });

  it("uses the user profile display name when no override exists (precedence 2)", async () => {
    seedEnrollment(STUDENT_A);
    seedUser(STUDENT_A, { displayName: "Alex Rivera" });
    const result = await resolveRosterDisplayName(SCOPE, STUDENT_A);
    expect(result).toEqual({
      studentId: STUDENT_A,
      displayName: "Alex Rivera",
      source: "userProfile",
    });
  });

  it("uses the safe fallback when neither source is available (precedence 3)", async () => {
    const result = await resolveRosterDisplayName(SCOPE, STUDENT_A);
    expect(result.displayName).toBe(FALLBACK_ROSTER_DISPLAY_NAME);
    expect(result.source).toBe("fallback");
  });

  it("does not replace a valid profile name with a blank override", async () => {
    seedEnrollment(STUDENT_A, { displayNameOverride: "   " });
    seedUser(STUDENT_A, { displayName: "Alex Rivera" });
    const result = await resolveRosterDisplayName(SCOPE, STUDENT_A);
    expect(result.displayName).toBe("Alex Rivera");
    expect(result.source).toBe("userProfile");
  });

  it("falls through to the fallback when the profile name is whitespace only", async () => {
    seedUser(STUDENT_A, { displayName: "   " });
    const result = await resolveRosterDisplayName(SCOPE, STUDENT_A);
    expect(result.source).toBe("fallback");
    expect(result.displayName).toBe(FALLBACK_ROSTER_DISPLAY_NAME);
  });

  it("trims and collapses whitespace on the resolved value", async () => {
    seedEnrollment(STUDENT_A, { displayNameOverride: "  Ali   R  " });
    const result = await resolveRosterDisplayName(SCOPE, STUDENT_A);
    expect(result.displayName).toBe("Ali R");
  });

  it("ignores an enrollment override from a different class", async () => {
    seedEnrollment(STUDENT_A, { displayNameOverride: "Ali" }, OTHER_CLASS_ID);
    seedUser(STUDENT_A, { displayName: "Alex Rivera" });
    const result = await resolveRosterDisplayName(SCOPE, STUDENT_A);
    expect(result.source).toBe("userProfile");
    expect(result.displayName).toBe("Alex Rivera");
  });

  it("ignores an enrollment whose schoolId disagrees with the trusted scope", async () => {
    seedEnrollment(
      STUDENT_A,
      { displayNameOverride: "Ali", schoolId: OTHER_SCHOOL_ID },
      CLASS_ID,
      OTHER_SCHOOL_ID,
    );
    seedUser(STUDENT_A, { displayName: "Alex Rivera" });
    const result = await resolveRosterDisplayName(SCOPE, STUDENT_A);
    expect(result.source).toBe("userProfile");
  });

  it("ignores an enrollment whose stored studentId disagrees", async () => {
    const id = enrollmentIdFor(CLASS_ID, STUDENT_A);
    enrollmentFixtures.set(id, {
      present: true,
      data: {
        studentId: STUDENT_B,
        classId: CLASS_ID,
        schoolId: SCHOOL_ID,
        status: "active",
        enrolledAt: { toMillis: () => 1 },
        displayNameOverride: "Not Yours",
      },
    });
    seedUser(STUDENT_A, { displayName: "Alex Rivera" });
    const result = await resolveRosterDisplayName(SCOPE, STUDENT_A);
    expect(result.source).toBe("userProfile");
    expect(result.displayName).toBe("Alex Rivera");
  });

  it("ignores a user record for a different studentId", async () => {
    userFixtures.set(STUDENT_A, {
      present: true,
      data: {
        authUid: STUDENT_B,
        status: "active",
        createdAt: { toMillis: () => 1 },
        role: "student",
        schoolId: SCHOOL_ID,
        displayName: "Someone Else",
      },
    });
    const result = await resolveRosterDisplayName(SCOPE, STUDENT_A);
    expect(result.source).toBe("fallback");
    expect(result.displayName).toBe(FALLBACK_ROSTER_DISPLAY_NAME);
  });

  it("ignores a user record whose schoolId disagrees with the trusted scope", async () => {
    seedUser(STUDENT_A, {
      displayName: "Alex Rivera",
      schoolId: OTHER_SCHOOL_ID,
    });
    const result = await resolveRosterDisplayName(SCOPE, STUDENT_A);
    expect(result.source).toBe("fallback");
  });

  it("honors historical override even when the enrollment status is withdrawn", async () => {
    seedEnrollment(STUDENT_A, {
      displayNameOverride: "Ali",
      status: "withdrawn",
    });
    seedUser(STUDENT_A, { displayName: "Alex Rivera" });
    const result = await resolveRosterDisplayName(SCOPE, STUDENT_A);
    expect(result.source).toBe("enrollmentOverride");
    expect(result.displayName).toBe("Ali");
  });

  it("falls back cleanly when the enrollment document is missing", async () => {
    seedUser(STUDENT_A, { displayName: "Alex Rivera" });
    const result = await resolveRosterDisplayName(SCOPE, STUDENT_A);
    expect(result.source).toBe("userProfile");
  });

  it("falls back cleanly when the user document is missing", async () => {
    seedEnrollment(STUDENT_A);
    const result = await resolveRosterDisplayName(SCOPE, STUDENT_A);
    expect(result.source).toBe("fallback");
  });

  it("always returns a non-empty string", async () => {
    const missing = await resolveRosterDisplayName(SCOPE, STUDENT_A);
    expect(typeof missing.displayName).toBe("string");
    expect(missing.displayName.length).toBeGreaterThan(0);

    seedUser(STUDENT_A, { displayName: "Alex" });
    const present = await resolveRosterDisplayName(SCOPE, STUDENT_A);
    expect(present.displayName.length).toBeGreaterThan(0);
  });

  it("never returns an email address as a fallback", async () => {
    seedUser(STUDENT_A, { email: "alex@example.com", displayName: "  " });
    seedEnrollment(STUDENT_A);
    const result = await resolveRosterDisplayName(SCOPE, STUDENT_A);
    expect(result.displayName).not.toContain("@");
    expect(result.source).toBe("fallback");
  });

  it("produces the same fallback for the same student across calls", async () => {
    const a = await resolveRosterDisplayName(SCOPE, STUDENT_A);
    const b = await resolveRosterDisplayName(SCOPE, STUDENT_A);
    expect(a.displayName).toBe(b.displayName);
  });

  it("does not expose raw user or enrollment records", async () => {
    seedEnrollment(STUDENT_A, { displayNameOverride: "Ali" });
    seedUser(STUDENT_A, { displayName: "Alex", email: "alex@example.com" });
    const result = await resolveRosterDisplayName(SCOPE, STUDENT_A);
    expect(Object.keys(result).sort()).toEqual(
      ["displayName", "source", "studentId"].sort(),
    );
  });

  it("preserves legitimate punctuation and diacritics", async () => {
    seedUser(STUDENT_A, { displayName: "María José O'Neil-Smith" });
    const result = await resolveRosterDisplayName(SCOPE, STUDENT_A);
    expect(result.displayName).toBe("María José O'Neil-Smith");
  });

  it("falls back for a blank student identifier without querying Firestore", async () => {
    const result = await resolveRosterDisplayName(SCOPE, "   ");
    expect(result.source).toBe("fallback");
    expect(mockEnrollmentDocRef).not.toHaveBeenCalled();
    expect(mockUserRecordDocRef).not.toHaveBeenCalled();
  });

  it("falls back for an untrimmed student identifier without querying Firestore", async () => {
    const result = await resolveRosterDisplayName(SCOPE, " student-a ");
    expect(result.source).toBe("fallback");
    expect(mockEnrollmentDocRef).not.toHaveBeenCalled();
  });

  it("falls back for a scope missing the classId", async () => {
    const result = await resolveRosterDisplayName(
      { ...SCOPE, classId: "" },
      STUDENT_A,
    );
    expect(result.source).toBe("fallback");
    expect(mockEnrollmentDocRef).not.toHaveBeenCalled();
  });
});

describe("createRosterDisplayNameResolver", () => {
  beforeEach(() => {
    enrollmentFixtures.clear();
    userFixtures.clear();
    enrollmentReadCounts.clear();
    userReadCounts.clear();
    mockEnrollmentDocRef.mockClear();
    mockUserRecordDocRef.mockClear();
  });

  it("resolves each unique student exactly once per request", async () => {
    seedUser(STUDENT_A, { displayName: "Alex Rivera" });
    seedUser(STUDENT_B, { displayName: "Bailey" });
    const resolver = createRosterDisplayNameResolver(SCOPE);
    const r1 = await resolver(STUDENT_A);
    const r2 = await resolver(STUDENT_A);
    const r3 = await resolver(STUDENT_B);
    expect(r1.displayName).toBe("Alex Rivera");
    expect(r2.displayName).toBe("Alex Rivera");
    expect(r3.displayName).toBe("Bailey");
    expect(userReadCounts.get(STUDENT_A) ?? 0).toBe(1);
    expect(userReadCounts.get(STUDENT_B) ?? 0).toBe(1);
    expect(enrollmentReadCounts.get(enrollmentIdFor(CLASS_ID, STUDENT_A)) ?? 0)
      .toBe(1);
  });

  it("shares an in-flight promise for concurrent lookups of the same student", async () => {
    seedUser(STUDENT_A, { displayName: "Alex Rivera" });
    const resolver = createRosterDisplayNameResolver(SCOPE);
    const [a, b] = await Promise.all([
      resolver(STUDENT_A),
      resolver(STUDENT_A),
    ]);
    expect(a).toBe(b);
    expect(userReadCounts.get(STUDENT_A) ?? 0).toBe(1);
  });

  it("keeps caches request-local (new factory clears state)", async () => {
    seedUser(STUDENT_A, { displayName: "Alex Rivera" });
    const first = createRosterDisplayNameResolver(SCOPE);
    await first(STUDENT_A);
    const second = createRosterDisplayNameResolver(SCOPE);
    await second(STUDENT_A);
    expect(userReadCounts.get(STUDENT_A) ?? 0).toBe(2);
  });
});
