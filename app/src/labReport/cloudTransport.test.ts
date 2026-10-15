const mockCallables: Record<string, jest.Mock> = {};
jest.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => {
    mockCallables[name] = mockCallables[name] ?? jest.fn();
    return (data: unknown) => mockCallables[name](data);
  },
}));
const mockSignInWithPopup = jest.fn();
const mockSignInWithRedirect = jest.fn();
const mockSetCustomParameters = jest.fn();
jest.mock("firebase/auth", () => ({
  GoogleAuthProvider: function GoogleAuthProvider(this: { setCustomParameters: unknown }) {
    this.setCustomParameters = mockSetCustomParameters;
  },
  onAuthStateChanged: jest.fn(),
  signInWithPopup: (...args: unknown[]) => mockSignInWithPopup(...args),
  signInWithRedirect: (...args: unknown[]) => mockSignInWithRedirect(...args),
  signOut: jest.fn(),
}));

import { classifyCallableError, classifyTokenError, createLabReportCloudTransport } from "./cloudTransport";

// Firebase callable errors carry `code` ("functions/<httpsCode>") and the
// platform's translated `details.code` (platform/functions/src/shared/errors/
// https-callable.ts). The sync engine acts only on the classified kind.
const callableError = (code: string, platformCode?: string) => ({
  code: `functions/${code}`,
  details: platformCode ? { code: platformCode } : undefined,
});

describe("classifyCallableError", () => {
  it.each([
    [callableError("already-exists", "labReports.writeConflict"), "conflict"],
    [callableError("failed-precondition", "labReports.blankOverwriteRefused"), "blankRefused"],
    [callableError("failed-precondition", "labReports.reportTooLarge"), "tooLarge"],
    [callableError("failed-precondition", "labReports.unsupportedVersion"), "unsupported"],
    [callableError("failed-precondition", "labReports.invalidReport"), "invalid"],
    [callableError("invalid-argument", "labReports.invalidRequest"), "invalid"],
    [callableError("permission-denied", "role-forbidden"), "notStudent"],
    [callableError("permission-denied", "account-inactive"), "notActive"],
    [callableError("permission-denied", "claim-state-mismatch"), "notActive"],
    [callableError("unauthenticated", "unauthenticated"), "auth"],
    [callableError("unauthenticated", "claim-stale"), "auth"],
    [callableError("unauthenticated"), "auth"],
    [callableError("unavailable"), "network"],
    [callableError("deadline-exceeded"), "network"],
    [callableError("internal"), "network"],
    [callableError("not-found"), "network"],
    [new TypeError("Failed to fetch"), "network"],
    [undefined, "network"],
  ])("classifies %j as %s", (err, kind) => {
    expect(classifyCallableError(err).kind).toBe(kind);
  });

  it("carries only the error code, never a message", () => {
    const classified = classifyCallableError({ code: "functions/internal", message: "student text", details: { code: "x" } });
    expect(classified).toEqual({ kind: "network", code: "x" });
  });
});

describe("classifyTokenError", () => {
  it.each([
    [{ code: "auth/network-request-failed" }, "network"],
    [{ code: "auth/internal-error" }, "network"],
    [{ code: "auth/too-many-requests" }, "network"],
    [new TypeError("Failed to fetch"), "network"],
    [undefined, "network"],
    [{ code: "auth/user-token-expired" }, "auth"],
    [{ code: "auth/invalid-user-token" }, "auth"],
    [{ code: "auth/user-disabled" }, "auth"],
    [{ code: "auth/user-not-found" }, "auth"],
  ])("classifies a token failure %j as %s", (err, kind) => {
    expect(classifyTokenError(err).kind).toBe(kind);
  });
});

describe("createLabReportCloudTransport", () => {
  const signedIn = (uid: string, getIdToken: jest.Mock = jest.fn().mockResolvedValue("token")) =>
    ({ uid, displayName: "Test Student", getIdToken });
  const deps = (currentUser: unknown) =>
    ({ app: {}, auth: { currentUser }, functions: {} }) as unknown as Parameters<typeof createLabReportCloudTransport>[0];

  beforeEach(() => {
    for (const key of Object.keys(mockCallables)) delete mockCallables[key];
    jest.clearAllMocks();
  });

  it("refuses to call the cloud without a signed-in user", async () => {
    const transport = createLabReportCloudTransport(deps(null));
    await expect(transport.get()).rejects.toEqual({ kind: "auth", code: "signed-out" });
    await expect(transport.save({ expectedRevision: 0, saveId: "s1234567", report: {}, allowBlank: false })).rejects.toEqual({ kind: "auth", code: "signed-out" });
  });

  it("sends only the report id, revision, save id, report, and blank intent; never a uid", async () => {
    const transport = createLabReportCloudTransport(deps(signedIn("student-a")));
    mockCallables.labReportsSave.mockResolvedValue({ data: { revision: 2, persisted: true, updatedAtMillis: 1 } });
    mockCallables.labReportsGet.mockResolvedValue({ data: { exists: false, revision: 0 } });
    await expect(transport.get()).resolves.toEqual({ exists: false, revision: 0 });
    expect(mockCallables.labReportsGet).toHaveBeenCalledWith({ reportId: "active" });
    await transport.save({ expectedRevision: 1, saveId: "s1234567", report: { version: 1 }, allowBlank: false });
    expect(mockCallables.labReportsSave).toHaveBeenCalledWith({
      reportId: "active", expectedRevision: 1, saveId: "s1234567", report: { version: 1 }, allowBlank: false,
    });
  });

  it("classifies callable failures", async () => {
    const transport = createLabReportCloudTransport(deps(signedIn("student-a")));
    mockCallables.labReportsSave.mockRejectedValue(callableError("already-exists", "labReports.writeConflict"));
    await expect(transport.save({ expectedRevision: 0, saveId: "s1234567", report: {}, allowBlank: false })).rejects.toEqual({ kind: "conflict", code: "labReports.writeConflict" });
  });

  // Regression: the Functions SDK sends a callable without credentials when
  // it cannot get the ID token, and the server's "unauthenticated" reply was
  // shown as an expired sign-in. A token that cannot be fetched is now a
  // retryable network error, and no callable is sent without one.
  it("never sends a callable when the ID token cannot be fetched", async () => {
    const getIdToken = jest.fn().mockRejectedValue({ code: "auth/network-request-failed", message: "x" });
    const transport = createLabReportCloudTransport(deps(signedIn("student-a", getIdToken)));
    mockCallables.labReportsGet = jest.fn();
    mockCallables.labReportsSave = jest.fn();
    await expect(transport.get()).rejects.toEqual({ kind: "network", code: "auth/network-request-failed" });
    await expect(transport.save({ expectedRevision: 0, saveId: "s1234567", report: {}, allowBlank: false })).rejects.toEqual({ kind: "network", code: "auth/network-request-failed" });
    expect(mockCallables.labReportsGet).not.toHaveBeenCalled();
    expect(mockCallables.labReportsSave).not.toHaveBeenCalled();
  });

  it("treats an invalidated session as a sign-in problem", async () => {
    const getIdToken = jest.fn().mockRejectedValue({ code: "auth/user-token-expired" });
    const transport = createLabReportCloudTransport(deps(signedIn("student-a", getIdToken)));
    await expect(transport.get()).rejects.toEqual({ kind: "auth", code: "auth/user-token-expired" });
  });

  it("fetches the ID token before each call", async () => {
    const getIdToken = jest.fn().mockResolvedValue("token");
    const transport = createLabReportCloudTransport(deps(signedIn("student-a", getIdToken)));
    mockCallables.labReportsGet = jest.fn().mockResolvedValue({ data: { exists: false, revision: 0 } });
    await transport.get();
    expect(getIdToken).toHaveBeenCalledTimes(1);
    expect(getIdToken.mock.invocationCallOrder[0]).toBeLessThan(mockCallables.labReportsGet.mock.invocationCallOrder[0]);
  });

  it("returns the signed-in account after a popup sign-in", async () => {
    const transport = createLabReportCloudTransport(deps(null));
    mockSignInWithPopup.mockResolvedValue({ user: { uid: "student-a", displayName: "Test Student" } });
    await expect(transport.signIn()).resolves.toEqual({ uid: "student-a", label: "Test Student" });
  });

  it("uses the shared Google sign-in settings and falls back to redirect when popups are blocked", async () => {
    const transport = createLabReportCloudTransport(deps(null));
    mockSignInWithPopup.mockRejectedValue({ code: "auth/popup-blocked" });
    await expect(transport.signIn()).resolves.toBeNull();
    expect(mockSetCustomParameters).toHaveBeenCalledWith({ prompt: "select_account" });
    expect(mockSignInWithRedirect).toHaveBeenCalledTimes(1);
  });
});
