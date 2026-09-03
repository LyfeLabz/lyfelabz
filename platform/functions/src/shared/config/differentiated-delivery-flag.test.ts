const mockDocGet = jest.fn();
const mockDoc = jest.fn(() => ({ get: mockDocGet }));
const mockCollection = jest.fn(() => ({ doc: mockDoc }));
const mockGetAdminFirestore = jest.fn(() => ({ collection: mockCollection }));

jest.mock("../firestore/admin", () => ({
  getAdminFirestore: mockGetAdminFirestore,
}));

import {
  DIFFERENTIATED_DELIVERY_CONFIG_DOC_ID,
  isDifferentiatedDeliveryEnabled,
} from "./differentiated-delivery-flag";
import { PLATFORM_CONFIG_COLLECTION } from "./teacher-pilot-allowlist";

// F5.2 §8.6/§11 - the server-owned operational differentiated-delivery flag,
// FAIL-CLOSED per the Slice 4 human-review rollout correction. Differentiated
// delivery is ENABLED only on an explicit boolean `enabled === true`; every
// other state (absent document, missing field, malformed value, explicit
// false, or a read failure) resolves to NOT enabled, so inability to prove an
// explicit enable can never authorize differentiated delivery.

function snapshot(overrides: { exists?: boolean; data?: unknown } = {}) {
  const exists = overrides.exists ?? true;
  return {
    exists,
    data: () => (exists ? overrides.data : undefined),
  };
}

describe("isDifferentiatedDeliveryEnabled (§8.6, fail-closed)", () => {
  beforeEach(() => {
    mockDocGet.mockReset();
    mockDoc.mockClear();
    mockCollection.mockClear();
    mockGetAdminFirestore.mockClear();
  });

  it("reads platformConfig/differentiatedDelivery", async () => {
    mockDocGet.mockResolvedValue(snapshot({ exists: false }));
    await isDifferentiatedDeliveryEnabled();
    expect(mockCollection).toHaveBeenCalledWith(PLATFORM_CONFIG_COLLECTION);
    expect(mockDoc).toHaveBeenCalledWith(DIFFERENTIATED_DELIVERY_CONFIG_DOC_ID);
  });

  it("returns true ONLY when enabled is explicitly the boolean true", async () => {
    mockDocGet.mockResolvedValue(snapshot({ data: { enabled: true } }));
    expect(await isDifferentiatedDeliveryEnabled()).toBe(true);
  });

  it("returns false (DISABLED) when the config document is absent", async () => {
    mockDocGet.mockResolvedValue(snapshot({ exists: false }));
    expect(await isDifferentiatedDeliveryEnabled()).toBe(false);
  });

  it("returns false when enabled is absent from the document", async () => {
    mockDocGet.mockResolvedValue(snapshot({ data: {} }));
    expect(await isDifferentiatedDeliveryEnabled()).toBe(false);
  });

  it("returns false when enabled is explicitly false", async () => {
    mockDocGet.mockResolvedValue(snapshot({ data: { enabled: false } }));
    expect(await isDifferentiatedDeliveryEnabled()).toBe(false);
  });

  it("returns false for any non-boolean (malformed) enabled value", async () => {
    for (const bad of ["true", "false", 1, 0, null, {}, [], "yes"]) {
      mockDocGet.mockResolvedValue(snapshot({ data: { enabled: bad } }));
      expect(await isDifferentiatedDeliveryEnabled()).toBe(false);
    }
  });

  it("does not swallow a read failure (propagates so the resolver fails closed)", async () => {
    mockDocGet.mockRejectedValue(new Error("firestore unavailable"));
    await expect(isDifferentiatedDeliveryEnabled()).rejects.toThrow(
      "firestore unavailable",
    );
  });
});
