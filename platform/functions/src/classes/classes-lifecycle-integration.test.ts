import type { CallableRequest } from "firebase-functions/v2/https";

// Sprint 24B Phase 2B.3 lifecycle integration test.
//
// Composes the two new dark server seams end-to-end and proves the
// approved lifecycle invariants documented in the Phase 2B Spec:
//   1. classesLmsCreate writes a `needsSetup` record with no grade,
//      block, or joinCode.
//   2. A needsSetup class rejects every instruction-facing operation
//      through the shared eligibility helper.
//   3. classesActivate atomically writes grade + block + joinCode +
//      status: "active".
//   4. Post-activation the class satisfies the same eligibility
//      predicates that any pre-existing active class satisfies.
//
// This is not an emulator test: it composes the handlers against a
// shared in-memory Firestore fake so the transaction, class read, and
// idempotent replay paths all exercise the real callable code.

const store = new Map<string, Record<string, unknown>>();
const auditEvents: Array<Record<string, unknown>> = [];

const mockClassGet = jest.fn(() => {
  const record = store.get("class-1");
  return Promise.resolve(
    record
      ? { exists: true, data: () => record }
      : { exists: false, data: () => undefined },
  );
});
const mockClassSet = jest.fn((payload: Record<string, unknown>) => {
  store.set("class-1", { ...payload });
  return Promise.resolve();
});
const mockClassActivationUpdate = jest.fn();

const mockClassDocRef = jest.fn(() => ({ get: mockClassGet }));
const mockClassLmsCreationDocRef = jest.fn(() => ({ set: mockClassSet }));
const mockClassActivationDocRef = jest.fn(() => ({}));

const mockCollectionQuery = {
  where: jest.fn(),
  limit: jest.fn(),
  get: jest.fn(() => Promise.resolve({ empty: true, docs: [] })),
};
mockCollectionQuery.where.mockImplementation(() => mockCollectionQuery);
mockCollectionQuery.limit.mockImplementation(() => mockCollectionQuery);
const mockClassesCollectionRef = jest.fn(() => mockCollectionQuery);

const mockRequireDistrictContext = jest.fn();
const mockWriteAuditEvent = jest.fn(
  (input: Record<string, unknown>) => {
    auditEvents.push(input);
    return Promise.resolve({ eventId: `evt-${auditEvents.length}`, record: {} });
  },
);

const mockRunFirestoreTransaction = jest.fn(
  (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      get: () => {
        const record = store.get("class-1");
        return Promise.resolve(
          record
            ? { exists: true, data: () => record }
            : { exists: false, data: () => undefined },
        );
      },
      update: (
        _ref: unknown,
        write: Record<string, unknown>,
      ) => {
        mockClassActivationUpdate(_ref, write);
        const existing = store.get("class-1") ?? {};
        store.set("class-1", { ...existing, ...write });
      },
    };
    return fn(tx);
  },
);

const SERVER_TIMESTAMP_SENTINEL = Symbol("serverTimestamp");

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
  },
}));

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

// Deterministic join code generator.
jest.mock("node:crypto", () => ({
  randomBytes: (n: number) => Buffer.alloc(n, 0xf0),
}));

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  const { assertClassSupports } = jest.requireActual(
    "../shared/classes/eligibility",
  );
  return {
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    assertClassSupports,
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    classDocRef: mockClassDocRef,
    classLmsCreationDocRef: mockClassLmsCreationDocRef,
    classActivationDocRef: mockClassActivationDocRef,
    classesCollectionRef: mockClassesCollectionRef,
    requireDistrictContext: mockRequireDistrictContext,
    runFirestoreTransaction: mockRunFirestoreTransaction,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { assertClassSupports } from "../shared/classes/eligibility";
import type { ClassRecord } from "../shared/types/class";
import { __classesLmsCreateHandler } from "./classes-lms-create";
import { __classesActivateHandler } from "./classes-activate";

const TEACHER_UID = "teacher-1";
const SCHOOL_ID = "school-a";
const DISTRICT_ID = "district-1";

function req(data: unknown): CallableRequest<unknown> {
  return {
    data,
    auth: { uid: TEACHER_UID, token: {} } as never,
    rawRequest: {} as never,
  };
}

function currentRecord(): ClassRecord {
  return store.get("class-1") as unknown as ClassRecord;
}

describe("classes lifecycle (Phase 2B.3 dark seams)", () => {
  beforeEach(() => {
    store.clear();
    auditEvents.length = 0;
    mockClassGet.mockClear();
    mockClassSet.mockClear();
    mockClassActivationUpdate.mockClear();
    mockCollectionQuery.get.mockClear();
    mockCollectionQuery.where.mockClear();
    mockCollectionQuery.limit.mockClear();
    mockRunFirestoreTransaction.mockClear();
    mockWriteAuditEvent.mockClear();
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValue({
      uid: TEACHER_UID,
      role: "teacher",
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
    });
    mockCollectionQuery.get.mockImplementation(() =>
      Promise.resolve({ empty: true, docs: [] }),
    );
  });

  it("creates needsSetup, rejects instruction ops, activates, and satisfies eligibility", async () => {
    // 1. Create via classesLmsCreate.
    const created = await __classesLmsCreateHandler(
      req({ classId: "class-1", title: "Upstream Course" }),
    );
    expect(created).toEqual({
      classId: "class-1",
      status: "needsSetup",
      alreadyCreated: false,
    });

    // 2. Record is needsSetup with no grade / block / joinCode.
    const beforeActivation = currentRecord();
    expect(beforeActivation.status).toBe("needsSetup");
    expect(beforeActivation).not.toHaveProperty("grade");
    expect(beforeActivation).not.toHaveProperty("block");
    expect(beforeActivation).not.toHaveProperty("joinCode");

    // 3. Assignment eligibility rejects needsSetup.
    expect(() =>
      assertClassSupports("assignDraft", beforeActivation),
    ).toThrow(PlatformError);

    // 4. Student join rejects needsSetup.
    expect(() =>
      assertClassSupports("studentJoin", beforeActivation),
    ).toThrow(PlatformError);

    // 5. Roster sync rejects needsSetup.
    expect(() =>
      assertClassSupports("rosterSync", beforeActivation),
    ).toThrow(PlatformError);

    // 6. Teacher-add enrollment rejects needsSetup.
    expect(() =>
      assertClassSupports("teacherAddEnrollment", beforeActivation),
    ).toThrow(PlatformError);

    // 7. Metadata edit rejects needsSetup (metadata flows through activation).
    expect(() =>
      assertClassSupports("editMetadata", beforeActivation),
    ).toThrow(PlatformError);

    // 8. LMS link permits needsSetup (existing lmsClassesImport composition).
    expect(() =>
      assertClassSupports("lmsLink", beforeActivation),
    ).not.toThrow();

    // 9. Archive permits needsSetup (orphan recovery path).
    expect(() =>
      assertClassSupports("archive", beforeActivation),
    ).not.toThrow();

    // 10. Activate.
    const activated = await __classesActivateHandler(
      req({ classId: "class-1", grade: "7", block: "C" }),
    );
    expect(activated.status).toBe("active");
    expect(activated.joinCode).toMatch(/^[A-F0-9]{8}$/);
    expect(activated.alreadyActive).toBe(false);

    // 11. Class now has all four fields observable atomically.
    const afterActivation = currentRecord();
    expect(afterActivation.status).toBe("active");
    expect(afterActivation).toMatchObject({
      grade: "7",
      block: "C",
      joinCode: activated.joinCode,
    });

    // 12. Assignment eligibility now permits.
    expect(() =>
      assertClassSupports("assignDraft", afterActivation),
    ).not.toThrow();

    // 13. Student join now permits.
    expect(() =>
      assertClassSupports("studentJoin", afterActivation),
    ).not.toThrow();

    // 14. Roster sync now permits.
    expect(() =>
      assertClassSupports("rosterSync", afterActivation),
    ).not.toThrow();

    // 15. Idempotent re-activation returns the same join code without a
    // new audit event.
    const auditCountBefore = auditEvents.length;
    const reactivated = await __classesActivateHandler(
      req({ classId: "class-1", grade: "7", block: "C" }),
    );
    expect(reactivated.alreadyActive).toBe(true);
    expect(reactivated.joinCode).toBe(activated.joinCode);
    expect(auditEvents.length).toBe(auditCountBefore);

    // 16. Existing active-class shape unchanged: no rotation on retry.
    const finalRecord = currentRecord();
    if (finalRecord.status !== "active") {
      throw new Error("expected active status after activation");
    }
    expect(finalRecord.joinCode).toBe(activated.joinCode);
  });

  it("classesLmsCreate is idempotent on replay and does not emit a second audit", async () => {
    await __classesLmsCreateHandler(
      req({ classId: "class-1", title: "Upstream Course" }),
    );
    const auditsBefore = auditEvents.length;
    const replay = await __classesLmsCreateHandler(
      req({ classId: "class-1", title: "Upstream Course" }),
    );
    expect(replay).toEqual({
      classId: "class-1",
      status: "needsSetup",
      alreadyCreated: true,
    });
    expect(auditEvents.length).toBe(auditsBefore);
  });
});
