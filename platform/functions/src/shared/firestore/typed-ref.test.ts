const mockDoc = jest.fn();
const mockCollection = jest.fn(() => ({ doc: mockDoc }));
const mockGetAdminFirestore = jest.fn(() => ({ collection: mockCollection }));

jest.mock("./admin", () => ({
  getAdminFirestore: mockGetAdminFirestore,
}));

import { schoolDocRef, userDocRef } from "./typed-ref";
import { SCHOOLS_COLLECTION } from "../types/school";
import { USERS_COLLECTION } from "../types/user";

describe("typed-ref", () => {
  beforeEach(() => {
    mockDoc.mockReset();
    mockCollection.mockClear();
    mockGetAdminFirestore.mockClear();
  });

  describe("userDocRef", () => {
    it("resolves to users/{uid} on the admin Firestore instance", () => {
      const sentinelRef = { __ref: "users/uid-abc" };
      mockDoc.mockReturnValueOnce(sentinelRef);

      const ref = userDocRef("uid-abc");

      expect(mockGetAdminFirestore).toHaveBeenCalledTimes(1);
      expect(mockCollection).toHaveBeenCalledWith(USERS_COLLECTION);
      expect(mockDoc).toHaveBeenCalledWith("uid-abc");
      expect(ref).toBe(sentinelRef);
    });
  });

  describe("schoolDocRef", () => {
    it("resolves to schools/{schoolId} on the admin Firestore instance", () => {
      const sentinelRef = { __ref: "schools/school-123" };
      mockDoc.mockReturnValueOnce(sentinelRef);

      const ref = schoolDocRef("school-123");

      expect(mockGetAdminFirestore).toHaveBeenCalledTimes(1);
      expect(mockCollection).toHaveBeenCalledWith(SCHOOLS_COLLECTION);
      expect(mockDoc).toHaveBeenCalledWith("school-123");
      expect(ref).toBe(sentinelRef);
    });

    it("targets the canonical 'schools' collection identifier", () => {
      mockDoc.mockReturnValueOnce({});

      schoolDocRef("any-id");

      expect(mockCollection).toHaveBeenCalledWith("schools");
    });
  });
});
