import type { Firestore, QueryDocumentSnapshot } from "firebase/firestore";
import { createFirestoreListClasses } from "./listClasses";

// Stateful test double: `getDocs` returns whatever docs the current test
// stashed on the mock, since the real Firestore query builders are all
// stubbed to opaque objects.
let currentDocs: ReadonlyArray<FakeDoc> = [];

// Sprint 24B Phase 2B.1 unit coverage for the client-side parser at
// `listClasses.ts`. The extension is additive: `needsSetup` documents
// must round-trip through `toSummary`, and unknown lifecycle values
// must continue to drop the row (defense in depth against a future
// server-first lifecycle extension). See
// docs/platform/SPRINT_24B_PHASE_2B_READER_AUDIT.md §5 C1 and §9 test 10.

type FakeDoc = {
  readonly id: string;
  readonly data: () => Readonly<Record<string, unknown>>;
};

function setDocs(docs: ReadonlyArray<FakeDoc>): Firestore {
  currentDocs = docs;
  return {} as unknown as Firestore;
}

jest.mock("firebase/firestore", () => ({
  collection: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
  where: jest.fn(() => ({})),
  getDocs: jest.fn(async () => ({
    forEach: (cb: (d: QueryDocumentSnapshot) => void): void => {
      for (const d of currentDocs) cb(d as unknown as QueryDocumentSnapshot);
    },
  })),
}));

describe("createFirestoreListClasses parser", () => {
  it("returns a summary for an active document with all ready-arm fields", async () => {
    const db = setDocs([
      {
        id: "c-active",
        data: () => ({
          title: "Period 1",
          status: "active",
          grade: "7",
          block: "A",
          joinCode: "AAAABBBB",
        }),
      },
    ]);
    const rows = await createFirestoreListClasses(db)("teacher-uid");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.status).toBe("active");
    expect(row.id).toBe("c-active");
    if (row.status !== "needsSetup") {
      expect(row.grade).toBe("7");
      expect(row.block).toBe("A");
      expect(row.joinCode).toBe("AAAABBBB");
    }
  });

  it("returns a summary for an archived document", async () => {
    const db = setDocs([
      {
        id: "c-archived",
        data: () => ({
          title: "Archived Period",
          status: "archived",
          grade: "8",
        }),
      },
    ]);
    const rows = await createFirestoreListClasses(db)("teacher-uid");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("archived");
  });

  it("returns a summary for a needsSetup document with grade/block/joinCode absent", async () => {
    const db = setDocs([
      {
        id: "c-setup",
        data: () => ({
          title: "Imported Period 4",
          status: "needsSetup",
        }),
      },
    ]);
    const rows = await createFirestoreListClasses(db)("teacher-uid");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.status).toBe("needsSetup");
    expect(row.id).toBe("c-setup");
    expect(row.title).toBe("Imported Period 4");
    // A discriminated needsSetup arm must not carry grade/block/joinCode.
    expect((row as Record<string, unknown>).grade).toBeUndefined();
    expect((row as Record<string, unknown>).block).toBeUndefined();
    expect((row as Record<string, unknown>).joinCode).toBeUndefined();
  });

  it("drops a document whose status is outside the known union", async () => {
    const db = setDocs([
      {
        id: "c-unknown",
        data: () => ({
          title: "Future lifecycle",
          status: "suspended",
          grade: "7",
        }),
      },
    ]);
    const rows = await createFirestoreListClasses(db)("teacher-uid");
    expect(rows).toHaveLength(0);
  });

  it("drops an active document that lacks a grade", async () => {
    const db = setDocs([
      {
        id: "c-malformed",
        data: () => ({ title: "Missing grade", status: "active" }),
      },
    ]);
    const rows = await createFirestoreListClasses(db)("teacher-uid");
    expect(rows).toHaveLength(0);
  });
});
