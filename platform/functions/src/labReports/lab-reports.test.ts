import type { CallableRequest } from "firebase-functions/v2/https";

// labReportsGet / labReportsSave unit tests. Firestore and identity are
// mocked at the `../shared` boundary (the established callable test
// pattern); Rules isolation is covered by
// platform/firebase/tests/student-lab-reports.rules.test.ts.

const SERVER_TIMESTAMP = Symbol("serverTimestamp");

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => SERVER_TIMESTAMP },
}));

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

type Ref = { readonly kind: string; readonly studentId: string; readonly reportId: string };
type Stored = Record<string, unknown> | undefined;

let stored: Stored;
const mockDocGet = jest.fn(() => Promise.resolve({ exists: stored !== undefined, data: () => stored }));
const mockDocRef = jest.fn((studentId: string, reportId: string) => ({
  kind: "read", studentId, reportId, get: mockDocGet,
}));
const mockCreationRef = jest.fn((studentId: string, reportId: string): Ref => ({ kind: "create", studentId, reportId }));
const mockUpdateRef = jest.fn((studentId: string, reportId: string): Ref => ({ kind: "update", studentId, reportId }));
const mockTxGet = jest.fn(() => Promise.resolve({ exists: stored !== undefined, data: () => stored }));
const mockTxCreate = jest.fn();
const mockTxUpdate = jest.fn();
const mockRunTransaction = jest.fn((fn: (tx: unknown) => unknown) =>
  Promise.resolve(fn({ get: mockTxGet, create: mockTxCreate, update: mockTxUpdate })),
);
const mockRequireDistrictContext = jest.fn();
const mockLogInfo = jest.fn();

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual("../shared/errors/platform-error");
  const types = jest.requireActual("../shared/types/student-lab-report");
  return {
    PlatformError,
    ACTIVE_LAB_REPORT_ID: types.ACTIVE_LAB_REPORT_ID,
    LAB_REPORT_FORMAT_VERSION: types.LAB_REPORT_FORMAT_VERSION,
    STUDENT_LAB_REPORT_SCHEMA_VERSION: types.STUDENT_LAB_REPORT_SCHEMA_VERSION,
    platformCallable: (handler: unknown) => handler,
    log: { info: mockLogInfo, warn: jest.fn(), error: jest.fn() },
    requireDistrictContext: mockRequireDistrictContext,
    runFirestoreTransaction: mockRunTransaction,
    studentLabReportDocRef: mockDocRef,
    studentLabReportCreationDocRef: mockCreationRef,
    studentLabReportUpdateDocRef: mockUpdateRef,
  };
});

import { __labReportsGetHandler as getHandler } from "./lab-reports-get";
import { __labReportsSaveHandler as saveHandler } from "./lab-reports-save";
import { normalizeLabReport, serializeLabReport } from "./lab-report-validation";

const STUDENT = { uid: "student-a", role: "student", schoolId: "school-1", districtId: "district-1" };
const SECRET = "SECRET STUDENT HYPOTHESIS";

const report = (responses: Record<string, string> = { hypothesis: SECRET }) => ({
  version: 1, checkSchema: 2, responses, checks: {}, quantitativeTable: null, activeSection: "question", settings: {},
});
const blankReport = () => report({ hypothesis: "" });
const json = (value: unknown) => serializeLabReport(normalizeLabReport(value)).json;

function storedRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1, reportId: "active", scope: "personal",
    studentId: STUDENT.uid, schoolId: STUDENT.schoolId, districtId: STUDENT.districtId,
    reportFormatVersion: 1, reportJson: json(report()), reportBytes: 10,
    revision: 3, lastSaveId: "save-prev-0001",
    createdAt: { toMillis: () => 1000 }, updatedAt: { toMillis: () => 2000 },
    ...overrides,
  };
}

const request = (data: unknown, auth: unknown = { uid: STUDENT.uid, token: {} }) =>
  ({ data, auth } as unknown as CallableRequest<unknown>);

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

beforeEach(() => {
  jest.clearAllMocks();
  stored = undefined;
  mockRequireDistrictContext.mockResolvedValue(STUDENT);
});

describe("authentication and authorization", () => {
  it.each([
    ["unauthenticated", "unauthenticated"],
    ["inactive or unonboarded account", "account-inactive"],
    ["stale claims", "claim-stale"],
  ])("refuses a %s caller before any report read or write", async (_label, code) => {
    const { PlatformError } = jest.requireActual("../shared/errors/platform-error");
    mockRequireDistrictContext.mockRejectedValue(new PlatformError(code, "x"));
    expect(await codeOf(getHandler(request({})))).toBe(code);
    expect(await codeOf(saveHandler(request({ expectedRevision: 0, saveId: "save-0000001", report: report() })))).toBe(code);
    expect(mockDocGet).not.toHaveBeenCalled();
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it("refuses teachers and administrators", async () => {
    mockRequireDistrictContext.mockResolvedValue({ ...STUDENT, role: "teacher" });
    expect(await codeOf(getHandler(request({})))).toBe("role-forbidden");
    expect(await codeOf(saveHandler(request({ expectedRevision: 0, saveId: "save-0000001", report: report() })))).toBe("role-forbidden");
  });

  it("reads and writes only the verified caller's own path, never a payload uid", async () => {
    stored = storedRecord();
    await getHandler(request({ reportId: "active" }));
    expect(mockDocRef).toHaveBeenCalledWith(STUDENT.uid, "active");
    expect(await codeOf(saveHandler(request({ studentId: "student-b", expectedRevision: 3, saveId: "save-0000001", report: report() }))))
      .toBe("labReports.invalidRequest");
    await saveHandler(request({ expectedRevision: 3, saveId: "save-0000001", report: report({ hypothesis: "new" }) }));
    expect(mockUpdateRef).toHaveBeenCalledWith(STUDENT.uid, "active");
  });

  it("refuses a stored record whose ownership stamp disagrees with the caller", async () => {
    stored = storedRecord({ studentId: "student-b" });
    expect(await codeOf(getHandler(request({})))).toBe("labReports.notOwned");
    stored = storedRecord({ districtId: "district-2" });
    expect(await codeOf(getHandler(request({})))).toBe("district-mismatch");
    expect(await codeOf(saveHandler(request({ expectedRevision: 3, saveId: "save-0000001", report: report() })))).toBe("district-mismatch");
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it("supports only the single active report id", async () => {
    expect(await codeOf(getHandler(request({ reportId: "assignment_x" })))).toBe("labReports.invalidRequest");
  });
});

describe("labReportsGet", () => {
  it("returns exists:false with revision 0 when the student has no cloud report", async () => {
    expect(await getHandler(request(undefined))).toEqual({ exists: false, revision: 0 });
  });

  it("returns the report, revision, and server update time", async () => {
    stored = storedRecord();
    expect(await getHandler(request({}))).toEqual({
      exists: true, revision: 3, report: normalizeLabReport(report()), updatedAtMillis: 2000,
    });
  });

  it("fails closed on an unreadable stored record without quoting it", async () => {
    stored = storedRecord({ reportJson: `{"oops": "${SECRET}` });
    let message = "";
    try { await getHandler(request({})); } catch (err) { message = String((err as Error).message); expect((err as { code: string }).code).toBe("labReports.corruptRecord"); expect((err as { cause?: unknown }).cause).toBeUndefined(); }
    expect(message).not.toContain(SECRET);
  });
});

describe("labReportsSave", () => {
  it("creates revision 1 with a frozen ownership stamp and server timestamps", async () => {
    const result = await saveHandler(request({ expectedRevision: 0, saveId: "save-0000001", report: report() }));
    expect(result).toEqual(expect.objectContaining({ revision: 1, persisted: true }));
    expect(mockTxCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "create", studentId: STUDENT.uid }),
      expect.objectContaining({
        schemaVersion: 1, reportId: "active", scope: "personal", studentId: STUDENT.uid,
        schoolId: "school-1", districtId: "district-1", reportFormatVersion: 1,
        reportJson: json(report()), revision: 1, lastSaveId: "save-0000001",
        createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP,
      }),
    );
  });

  it("updates at the expected revision without touching the ownership stamp", async () => {
    stored = storedRecord();
    const result = await saveHandler(request({ expectedRevision: 3, saveId: "save-0000002", report: report({ hypothesis: "edited" }) }));
    expect(result).toEqual(expect.objectContaining({ revision: 4, persisted: true }));
    const write = mockTxUpdate.mock.calls[0][1];
    expect(write).toEqual({
      reportFormatVersion: 1, reportJson: json(report({ hypothesis: "edited" })),
      reportBytes: expect.any(Number), revision: 4, lastSaveId: "save-0000002", updatedAt: SERVER_TIMESTAMP,
    });
    for (const key of ["studentId", "schoolId", "districtId", "createdAt", "scope"]) expect(write).not.toHaveProperty(key);
  });

  it("rejects a stale revision (second tab, second device, restored tab) and reports only the current revision", async () => {
    stored = storedRecord({ revision: 7 });
    let details: Record<string, unknown> = {};
    try {
      await saveHandler(request({ expectedRevision: 5, saveId: "save-0000003", report: report({ hypothesis: "old tab" }) }));
    } catch (err) {
      expect((err as { code: string }).code).toBe("labReports.writeConflict");
      details = (err as { details: Record<string, unknown> }).details;
    }
    expect(details).toEqual({ revision: 7 });
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockTxCreate).not.toHaveBeenCalled();
  });

  it("rejects a first save when another tab already created the report", async () => {
    stored = storedRecord({ revision: 1 });
    expect(await codeOf(saveHandler(request({ expectedRevision: 0, saveId: "save-0000004", report: report() })))).toBe("labReports.writeConflict");
  });

  it("acknowledges a retry of a save that already landed instead of reporting a conflict", async () => {
    stored = storedRecord({ revision: 4, lastSaveId: "save-0000005" });
    expect(await saveHandler(request({ expectedRevision: 3, saveId: "save-0000005", report: report() })))
      .toEqual(expect.objectContaining({ revision: 4, persisted: false }));
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it("does not treat a matching saveId at a different distance as a replay", async () => {
    stored = storedRecord({ revision: 6, lastSaveId: "save-0000005" });
    expect(await codeOf(saveHandler(request({ expectedRevision: 3, saveId: "save-0000005", report: report() })))).toBe("labReports.writeConflict");
  });

  it("coalesces an identical report without a write", async () => {
    stored = storedRecord();
    expect(await saveHandler(request({ expectedRevision: 3, saveId: "save-0000006", report: report() })))
      .toEqual(expect.objectContaining({ revision: 3, persisted: false }));
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it("refuses a blank report over saved student work unless the student cleared it", async () => {
    stored = storedRecord();
    expect(await codeOf(saveHandler(request({ expectedRevision: 3, saveId: "save-0000007", report: blankReport() })))).toBe("labReports.blankOverwriteRefused");
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(await saveHandler(request({ expectedRevision: 3, saveId: "save-0000008", report: blankReport(), allowBlank: true })))
      .toEqual(expect.objectContaining({ revision: 4, persisted: true }));
  });

  it("allows a blank first save and a blank-over-blank save", async () => {
    expect(await saveHandler(request({ expectedRevision: 0, saveId: "save-0000009", report: blankReport() })))
      .toEqual(expect.objectContaining({ revision: 1 }));
    stored = storedRecord({ reportJson: json(blankReport()) });
    expect(await saveHandler(request({ expectedRevision: 3, saveId: "save-0000010", report: { ...blankReport(), activeSection: "data" } })))
      .toEqual(expect.objectContaining({ revision: 4 }));
  });

  it.each([
    ["missing expectedRevision", { saveId: "save-0000011", report: {} }],
    ["negative expectedRevision", { expectedRevision: -1, saveId: "save-0000011", report: {} }],
    ["fractional expectedRevision", { expectedRevision: 1.5, saveId: "save-0000011", report: {} }],
    ["short saveId", { expectedRevision: 0, saveId: "x", report: {} }],
    ["non-boolean allowBlank", { expectedRevision: 0, saveId: "save-0000011", report: {}, allowBlank: "yes" }],
    ["array payload", []],
  ])("refuses %s", async (_label, data) => {
    expect(await codeOf(saveHandler(request(data)))).toBe("labReports.invalidRequest");
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it("refuses an oversized report before opening a transaction", async () => {
    const responses: Record<string, string> = {};
    for (let i = 0; i < 20; i++) responses[`field${i}`] = "x".repeat(15_000);
    expect(await codeOf(saveHandler(request({ expectedRevision: 0, saveId: "save-0000012", report: report(responses) })))).toBe("labReports.reportTooLarge");
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });
});

describe("privacy", () => {
  it("never logs report content", async () => {
    await saveHandler(request({ expectedRevision: 0, saveId: "save-0000013", report: report() }));
    stored = storedRecord();
    await getHandler(request({}));
    expect(mockLogInfo).toHaveBeenCalled();
    expect(JSON.stringify(mockLogInfo.mock.calls)).not.toContain(SECRET);
  });
});
