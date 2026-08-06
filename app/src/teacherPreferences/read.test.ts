import type { Firestore } from "firebase/firestore";

// Sprint 24B Phase 2B.2 - client reader for
// `users/{uid}/preferences/teacher`. Verifies the fail-closed contract
// described in `./read.ts`.

let currentSnap: {
  exists: () => boolean;
  data: () => unknown;
} = {
  exists: () => false,
  data: () => undefined,
};
let getDocShouldThrow = false;

jest.mock("firebase/firestore", () => ({
  doc: jest.fn(() => ({})),
  getDoc: jest.fn(async () => {
    if (getDocShouldThrow) {
      throw new Error("permission-denied");
    }
    return currentSnap;
  }),
}));

import { createFirestoreReadTeacherDefaultGrade } from "./read";

const db = {} as unknown as Firestore;

beforeEach(() => {
  currentSnap = { exists: () => false, data: () => undefined };
  getDocShouldThrow = false;
});

describe("createFirestoreReadTeacherDefaultGrade", () => {
  it("returns null when the preference document is absent", async () => {
    const read = createFirestoreReadTeacherDefaultGrade(db, "uid");
    await expect(read()).resolves.toBeNull();
  });

  it("returns null when the document is present but defaultGrade is absent", async () => {
    currentSnap = { exists: () => true, data: () => ({ updatedAt: {} }) };
    const read = createFirestoreReadTeacherDefaultGrade(db, "uid");
    await expect(read()).resolves.toBeNull();
  });

  it("returns the persisted value when it belongs to the closed set", async () => {
    currentSnap = { exists: () => true, data: () => ({ defaultGrade: "7" }) };
    const read = createFirestoreReadTeacherDefaultGrade(db, "uid");
    await expect(read()).resolves.toBe("7");
  });

  it("returns null when the persisted value is malformed", async () => {
    currentSnap = { exists: () => true, data: () => ({ defaultGrade: "12" }) };
    const read = createFirestoreReadTeacherDefaultGrade(db, "uid");
    await expect(read()).resolves.toBeNull();
  });

  it("returns null when getDoc throws (never crashes the caller)", async () => {
    getDocShouldThrow = true;
    const read = createFirestoreReadTeacherDefaultGrade(db, "uid");
    await expect(read()).resolves.toBeNull();
  });
});
