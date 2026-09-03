// F5.2 §3.6/§4 Op C - unit tests for the real port adapter: launch-grant
// record minting (id, 6-hour TTL, binding fields, pair invariant, collision
// retry) and current-index evaluation trust (active/retired/absent/malformed).

const mockCreate = jest.fn();
const mockLaunchGrantCreationDocRef = jest.fn(() => ({ create: mockCreate }));

const mockIndexGet = jest.fn();
const mockPresentationVariantIndexDocRef = jest.fn(() => ({ get: mockIndexGet }));

const mockAccommodationGet = jest.fn();
const mockStudentAccommodationDocRef = jest.fn(() => ({ get: mockAccommodationGet }));

const mockIsDeliveryEnabled = jest.fn();
const mockGenerateGrantId = jest.fn();

jest.mock("firebase-admin/firestore", () => ({
  Timestamp: {
    fromMillis: (ms: number) => ({ __ts: ms, toMillis: () => ms }),
  },
}));

jest.mock("../firestore/typed-ref", () => ({
  launchGrantCreationDocRef: mockLaunchGrantCreationDocRef,
  presentationVariantIndexDocRef: mockPresentationVariantIndexDocRef,
  studentAccommodationDocRef: mockStudentAccommodationDocRef,
}));

jest.mock("../config/differentiated-delivery-flag", () => ({
  isDifferentiatedDeliveryEnabled: mockIsDeliveryEnabled,
}));

jest.mock("./launch-grant-id", () => ({
  generateGrantId: mockGenerateGrantId,
}));

jest.mock("../logging/logger", () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { LAUNCH_GRANT_TTL_MS } from "../types/launch-grant";
import { buildLaunchPresentationResolverPorts } from "./launch-presentation-deps";

const LESSON_SLUG = "earths-layers";
const VARIANT_KEY = "reading-adapted";
const SHA = "a".repeat(64);
const REVISION_ID = `pr${SHA}`;
const PATH = `app/lessons/variants/lesson_${LESSON_SLUG}__${REVISION_ID}.html`;
const NOW_MS = 1_700_000_000_000;

function activeIndexSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      lessonSlug: LESSON_SLUG,
      variantKey: VARIANT_KEY,
      currentPresentationRevisionId: REVISION_ID,
      currentPath: PATH,
      contentSha256: SHA,
      status: "active",
      ...overrides,
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGenerateGrantId.mockReturnValue("0123456789abcdef0123456789abcdef");
  mockCreate.mockResolvedValue(undefined);
});

describe("launch-presentation-deps: mintGrant (§3.6)", () => {
  it("mints a differentiated grant with the exact binding + 6h TTL", async () => {
    const ports = buildLaunchPresentationResolverPorts(() => NOW_MS);
    const grantId = await ports.mintGrant({
      outcomeAtIssuance: "differentiated",
      studentId: "student-uid",
      assignmentId: "assign-1",
      lessonSlug: LESSON_SLUG,
      variantKey: VARIANT_KEY,
      presentationRevisionId: REVISION_ID,
    });
    expect(grantId).toBe("0123456789abcdef0123456789abcdef");
    expect(mockLaunchGrantCreationDocRef).toHaveBeenCalledWith(
      "0123456789abcdef0123456789abcdef",
    );
    const written = mockCreate.mock.calls[0][0];
    expect(written).toMatchObject({
      grantId: "0123456789abcdef0123456789abcdef",
      studentId: "student-uid",
      assignmentId: "assign-1",
      lessonSlug: LESSON_SLUG,
      outcomeAtIssuance: "differentiated",
      variantKey: VARIANT_KEY,
      presentationRevisionId: REVISION_ID,
    });
    // Server-derived timestamps, expiresAt = issuedAt + 6h.
    expect(written.issuedAt.toMillis()).toBe(NOW_MS);
    expect(written.expiresAt.toMillis()).toBe(NOW_MS + LAUNCH_GRANT_TTL_MS);
  });

  it("mints a canonicalFallback grant with NO presentation pair", async () => {
    const ports = buildLaunchPresentationResolverPorts(() => NOW_MS);
    await ports.mintGrant({
      outcomeAtIssuance: "canonicalFallback",
      studentId: "student-uid",
      assignmentId: "assign-1",
      lessonSlug: LESSON_SLUG,
    });
    const written = mockCreate.mock.calls[0][0];
    expect(written.outcomeAtIssuance).toBe("canonicalFallback");
    expect(written).not.toHaveProperty("variantKey");
    expect(written).not.toHaveProperty("presentationRevisionId");
  });

  it("retries with a fresh id on an already-exists collision", async () => {
    mockGenerateGrantId
      .mockReturnValueOnce("a".repeat(32))
      .mockReturnValueOnce("b".repeat(32));
    mockCreate
      .mockRejectedValueOnce({ code: "already-exists" })
      .mockResolvedValueOnce(undefined);
    const ports = buildLaunchPresentationResolverPorts(() => NOW_MS);
    const grantId = await ports.mintGrant({
      outcomeAtIssuance: "canonicalFallback",
      studentId: "s",
      assignmentId: "a",
      lessonSlug: LESSON_SLUG,
    });
    expect(grantId).toBe("b".repeat(32));
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("propagates a non-collision write error (surfaced as internal failure upstream)", async () => {
    mockCreate.mockRejectedValue(new Error("permission denied"));
    const ports = buildLaunchPresentationResolverPorts(() => NOW_MS);
    await expect(
      ports.mintGrant({
        outcomeAtIssuance: "canonicalFallback",
        studentId: "s",
        assignmentId: "a",
        lessonSlug: LESSON_SLUG,
      }),
    ).rejects.toThrow("permission denied");
  });
});

describe("launch-presentation-deps: readVariantIndex trust (§5.3/index trust)", () => {
  it("returns active for an internally-consistent active index", async () => {
    mockIndexGet.mockResolvedValue(activeIndexSnapshot());
    const ports = buildLaunchPresentationResolverPorts(() => NOW_MS);
    const res = await ports.readVariantIndex(LESSON_SLUG, VARIANT_KEY);
    expect(res).toEqual({
      kind: "active",
      variantKey: VARIANT_KEY,
      presentationRevisionId: REVISION_ID,
      path: PATH,
    });
  });

  it("returns absent when the index doc does not exist", async () => {
    mockIndexGet.mockResolvedValue({ exists: false, data: () => undefined });
    const ports = buildLaunchPresentationResolverPorts(() => NOW_MS);
    expect(await ports.readVariantIndex(LESSON_SLUG, VARIANT_KEY)).toEqual({
      kind: "absent",
    });
  });

  it("returns absent (coverage gap, no throw) for a non-charset lessonSlug", async () => {
    const ports = buildLaunchPresentationResolverPorts(() => NOW_MS);
    // A legacy underscore slug can never have a variant index doc (§5.1/M3):
    // it must resolve to a clean coverage gap, not an internal error, and must
    // not even attempt a Firestore read.
    expect(
      await ports.readVariantIndex("lesson_g7_earths-layers", VARIANT_KEY),
    ).toEqual({ kind: "absent" });
    expect(mockIndexGet).not.toHaveBeenCalled();
  });

  it("returns retired for a retired index", async () => {
    mockIndexGet.mockResolvedValue(activeIndexSnapshot({ status: "retired" }));
    const ports = buildLaunchPresentationResolverPorts(() => NOW_MS);
    expect(await ports.readVariantIndex(LESSON_SLUG, VARIANT_KEY)).toEqual({
      kind: "retired",
    });
  });

  it("returns malformed when the stored path disagrees with the identity formula", async () => {
    mockIndexGet.mockResolvedValue(
      activeIndexSnapshot({ currentPath: "app/lessons/variants/tampered.html" }),
    );
    const ports = buildLaunchPresentationResolverPorts(() => NOW_MS);
    expect(await ports.readVariantIndex(LESSON_SLUG, VARIANT_KEY)).toEqual({
      kind: "malformed",
    });
  });

  it("returns malformed when the revision id and content hash disagree", async () => {
    mockIndexGet.mockResolvedValue(
      activeIndexSnapshot({ currentPresentationRevisionId: `pr${"b".repeat(64)}` }),
    );
    const ports = buildLaunchPresentationResolverPorts(() => NOW_MS);
    expect(await ports.readVariantIndex(LESSON_SLUG, VARIANT_KEY)).toEqual({
      kind: "malformed",
    });
  });

  it("returns malformed when the doc's lessonSlug/variantKey do not match the query", async () => {
    mockIndexGet.mockResolvedValue(activeIndexSnapshot({ lessonSlug: "other" }));
    const ports = buildLaunchPresentationResolverPorts(() => NOW_MS);
    expect(await ports.readVariantIndex(LESSON_SLUG, VARIANT_KEY)).toEqual({
      kind: "malformed",
    });
  });

  it("returns malformed for an unknown status value", async () => {
    mockIndexGet.mockResolvedValue(activeIndexSnapshot({ status: "weird" }));
    const ports = buildLaunchPresentationResolverPorts(() => NOW_MS);
    expect(await ports.readVariantIndex(LESSON_SLUG, VARIANT_KEY)).toEqual({
      kind: "malformed",
    });
  });
});

describe("launch-presentation-deps: readReading (§3.1)", () => {
  it("resolves an active reading accommodation to its level", async () => {
    mockAccommodationGet.mockResolvedValue({
      exists: true,
      data: () => ({ readingAccessibility: { status: "active", level: "adapted" } }),
    });
    const ports = buildLaunchPresentationResolverPorts(() => NOW_MS);
    expect(await ports.readReading("student-uid")).toEqual({
      active: true,
      level: "adapted",
    });
  });

  it("resolves an inactive record to {active:false}", async () => {
    mockAccommodationGet.mockResolvedValue({
      exists: true,
      data: () => ({ readingAccessibility: { status: "inactive" } }),
    });
    const ports = buildLaunchPresentationResolverPorts(() => NOW_MS);
    expect(await ports.readReading("student-uid")).toEqual({ active: false });
  });

  it("resolves an absent record to {active:false}", async () => {
    mockAccommodationGet.mockResolvedValue({ exists: false, data: () => undefined });
    const ports = buildLaunchPresentationResolverPorts(() => NOW_MS);
    expect(await ports.readReading("student-uid")).toEqual({ active: false });
  });
});
