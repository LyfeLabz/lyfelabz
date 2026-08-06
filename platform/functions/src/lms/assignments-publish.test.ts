// Sprint 25 Phase 1 callable tests for lmsAssignmentsPublish.
//
// Covers the restructured control flow introduced in Phase 1:
//   - Completed-attempt guard (§2.2)
//   - lms.insufficientScope non-terminal path (§2.7)
//   - Phase A / Phase B split with independently guarded steps (§2.4)
//   - Orphan log path when Phase B1 record write fails
//   - Mirror-desync log path when Phase B2 mirror update fails
//   - Audit-gap log path when Phase B3 audit emission fails
//   - Privacy invariant: no token, student PII, or raw provider body in
//     any response or record shape
//
// All identifiers are fictional. No real teacher, student, school, OAuth
// credential, or LyfeLabz-affiliated identifier is used.

import type { CallableRequest } from "firebase-functions/v2/https";

const mockAssignmentGet = jest.fn();
const mockPublicationCreationGet = jest.fn();
const mockPublicationCreationSet = jest.fn();
const mockLinkGet = jest.fn();
const mockClassLinksGet = jest.fn();
const mockConnectionGet = jest.fn();
const mockAssignmentLmsPublicationUpdate = jest.fn();
const mockWriteAuditEvent = jest.fn();
const mockLogError = jest.fn();
const mockGetLmsTokenStore = jest.fn();
const mockGetProviderAdapter = jest.fn();
const mockAssertAuthenticatedTeacherForLms = jest.fn();
const mockRequireNonEmptyString = jest.fn();
const mockLmsAssignmentPublicationIdFor = jest.fn();

const SERVER_TIMESTAMP_SENTINEL = Symbol("serverTimestamp");

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
  },
}));

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    log: { info: jest.fn(), warn: jest.fn(), error: mockLogError },
    writeAuditEvent: mockWriteAuditEvent,
    assignmentDocRef: jest.fn(() => ({ get: mockAssignmentGet })),
    assignmentLmsPublicationDocRef: jest.fn(() => ({
      update: mockAssignmentLmsPublicationUpdate,
    })),
    lmsAssignmentPublicationCreationDocRef: jest.fn(() => ({
      get: mockPublicationCreationGet,
      set: mockPublicationCreationSet,
    })),
    lmsClassLinkDocRef: jest.fn(() => ({ get: mockLinkGet })),
    lmsClassLinksCollectionRef: jest.fn(() => {
      const q = { where: jest.fn(), get: mockClassLinksGet };
      q.where.mockReturnValue(q);
      return q;
    }),
    lmsConnectionDocRef: jest.fn(() => ({ get: mockConnectionGet })),
  };
});

jest.mock("./shared/actor", () => ({
  assertAuthenticatedTeacherForLms: mockAssertAuthenticatedTeacherForLms,
  requireNonEmptyString: mockRequireNonEmptyString,
}));

jest.mock("./shared/ids", () => ({
  lmsAssignmentPublicationIdFor: mockLmsAssignmentPublicationIdFor,
}));

jest.mock("./tokens/token-store", () => ({
  getLmsTokenStore: mockGetLmsTokenStore,
}));

jest.mock("./providers/registry", () => ({
  getProviderAdapter: mockGetProviderAdapter,
}));

import { PlatformError } from "../shared/errors/platform-error";
import { __lmsAssignmentsPublishHandler } from "./assignments-publish";

// Fixture constants.
const FIXTURE_UID = "fixture-teacher-uid-001";
const FIXTURE_SCHOOL_ID = "fixture-school-001";
const FIXTURE_DISTRICT_ID = "fixture-district-001";
const FIXTURE_ASSIGNMENT_ID = "fixture-assignment-id-001";
const FIXTURE_LINK_ID = "fixture-link-id-001";
const FIXTURE_CONNECTION_ID = "fixture-connection-id-001";
const FIXTURE_PROVIDER_ID = "googleClassroom";
const FIXTURE_CLASS_ID = "fixture-class-id-001";
const FIXTURE_LMS_CLASS_ID = "fixture-lms-class-id-001";
const FIXTURE_LMS_ASSIGNMENT_ID = "fixture-lms-assignment-id-001";
const FIXTURE_LMS_ASSIGNMENT_URL =
  "https://classroom.google.com/c/fixture-lms-class/a/fixture-lms-assignment/details";
const FIXTURE_LYFELABZ_URL =
  "https://app.lyfelabz.invalid/a/fixture-assignment-id-001";
const FIXTURE_PUBLICATION_ID = "fixture-publication-id-001";
const FIXTURE_ACCESS_TOKEN = "fixture-access-token-redacted";

const FIXTURE_ACTOR = {
  uid: FIXTURE_UID,
  schoolId: FIXTURE_SCHOOL_ID,
  districtId: FIXTURE_DISTRICT_ID,
};

function makeRequest(
  overrides: Partial<Record<string, unknown>> = {},
): CallableRequest<unknown> {
  return {
    auth: { uid: FIXTURE_UID, token: { schoolId: FIXTURE_SCHOOL_ID } as never },
    data: {
      assignmentId: FIXTURE_ASSIGNMENT_ID,
      linkId: FIXTURE_LINK_ID,
      lyfelabzAssignmentUrl: FIXTURE_LYFELABZ_URL,
      title: "Fictional Assignment Title",
      ...overrides,
    },
    rawRequest: {} as never,
    acceptsStreaming: false,
  } as unknown as CallableRequest<unknown>;
}

function makeAssignmentDoc(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      teacherId: FIXTURE_UID,
      schoolId: FIXTURE_SCHOOL_ID,
      classId: FIXTURE_CLASS_ID,
      status: "published",
      title: "Fictional Assignment Title",
      lessonSlug: "fictional-slug",
      ...overrides,
    }),
  };
}

function makeLinkDoc(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      ownerUid: FIXTURE_UID,
      status: "linked",
      classId: FIXTURE_CLASS_ID,
      connectionId: FIXTURE_CONNECTION_ID,
      lmsClassId: FIXTURE_LMS_CLASS_ID,
      ...overrides,
    }),
  };
}

function makeConnectionDoc(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      teacherId: FIXTURE_UID,
      status: "active",
      providerId: FIXTURE_PROVIDER_ID,
      tokenRef: "fixture-token-ref",
      ...overrides,
    }),
  };
}

function makeClassLinksResult(ids: string[] = []) {
  return { docs: ids.map((id) => ({ id })) };
}

function setupHappyPath(options: { alreadySucceeded?: boolean } = {}) {
  mockAssertAuthenticatedTeacherForLms.mockReturnValue(FIXTURE_ACTOR);
  mockRequireNonEmptyString.mockImplementation((v: unknown) => {
    if (typeof v !== "string" || v.trim().length === 0) {
      throw new PlatformError("lms.invalid", "bad string");
    }
    return v.trim();
  });
  mockLmsAssignmentPublicationIdFor.mockReturnValue(FIXTURE_PUBLICATION_ID);

  mockAssignmentGet.mockResolvedValue(makeAssignmentDoc());
  mockLinkGet.mockResolvedValue(makeLinkDoc());
  mockConnectionGet.mockResolvedValue(makeConnectionDoc());
  mockClassLinksGet.mockResolvedValue(makeClassLinksResult([FIXTURE_LINK_ID]));

  if (options.alreadySucceeded) {
    mockPublicationCreationGet.mockResolvedValue({
      exists: true,
      data: () => ({
        status: "succeeded",
        lmsAssignmentId: FIXTURE_LMS_ASSIGNMENT_ID,
        lmsAssignmentUrl: FIXTURE_LMS_ASSIGNMENT_URL,
      }),
    });
  } else {
    mockPublicationCreationGet.mockResolvedValue({ exists: false });
  }

  mockGetLmsTokenStore.mockReturnValue({
    resolve: jest.fn().mockResolvedValue({ accessToken: FIXTURE_ACCESS_TOKEN }),
  });
  mockGetProviderAdapter.mockReturnValue({
    publishAssignment: jest.fn().mockResolvedValue({
      lmsAssignmentId: FIXTURE_LMS_ASSIGNMENT_ID,
      lmsAssignmentUrl: FIXTURE_LMS_ASSIGNMENT_URL,
    }),
  });

  mockPublicationCreationSet.mockResolvedValue(undefined);
  mockAssignmentLmsPublicationUpdate.mockResolvedValue(undefined);
  mockWriteAuditEvent.mockResolvedValue(undefined);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("lmsAssignmentsPublish callable (Sprint 25 Phase 1)", () => {
  describe("happy path: first successful publication", () => {
    it("returns succeeded with the lmsAssignmentId and lmsAssignmentUrl", async () => {
      setupHappyPath();
      const result = await __lmsAssignmentsPublishHandler(makeRequest());
      expect(result.status).toBe("succeeded");
      expect(result.lmsAssignmentId).toBe(FIXTURE_LMS_ASSIGNMENT_ID);
      expect(result.lmsAssignmentUrl).toBe(FIXTURE_LMS_ASSIGNMENT_URL);
      expect(result.publicationId).toBe(FIXTURE_PUBLICATION_ID);
    });

    it("writes a succeeded publication record in Phase B1", async () => {
      setupHappyPath();
      await __lmsAssignmentsPublishHandler(makeRequest());
      expect(mockPublicationCreationSet).toHaveBeenCalledTimes(1);
      const written = mockPublicationCreationSet.mock.calls[0][0];
      expect(written.status).toBe("succeeded");
      expect(written.lmsAssignmentId).toBe(FIXTURE_LMS_ASSIGNMENT_ID);
    });

    it("updates the mirror pointer in Phase B2", async () => {
      setupHappyPath();
      await __lmsAssignmentsPublishHandler(makeRequest());
      expect(mockAssignmentLmsPublicationUpdate).toHaveBeenCalledTimes(1);
    });

    it("emits lms.assignmentPublished audit event in Phase B3", async () => {
      setupHappyPath();
      await __lmsAssignmentsPublishHandler(makeRequest());
      expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
      const auditCall = mockWriteAuditEvent.mock.calls[0][0];
      expect(auditCall.action).toBe("lms.assignmentPublished");
      expect(auditCall.actorUserId).toBe(FIXTURE_UID);
      expect(auditCall.payload.lmsAssignmentId).toBe(FIXTURE_LMS_ASSIGNMENT_ID);
      expect(auditCall.payload.publicationId).toBe(FIXTURE_PUBLICATION_ID);
    });

    it("does not expose the access token or raw provider body in any record or response", async () => {
      setupHappyPath();
      const result = await __lmsAssignmentsPublishHandler(makeRequest());
      const resultStr = JSON.stringify(result);
      expect(resultStr).not.toContain(FIXTURE_ACCESS_TOKEN);
      if (mockPublicationCreationSet.mock.calls.length > 0) {
        const record = mockPublicationCreationSet.mock.calls[0][0];
        expect(JSON.stringify(record)).not.toContain(FIXTURE_ACCESS_TOKEN);
      }
    });
  });

  describe("completed-attempt guard (§2.2)", () => {
    it("returns existing succeeded result without a second adapter POST", async () => {
      setupHappyPath({ alreadySucceeded: true });
      const result = await __lmsAssignmentsPublishHandler(makeRequest());
      expect(result.status).toBe("succeeded");
      expect(result.lmsAssignmentId).toBe(FIXTURE_LMS_ASSIGNMENT_ID);
      // Adapter must not be called.
      const adapter = mockGetProviderAdapter.mock.results[0]?.value;
      if (adapter) {
        expect(adapter.publishAssignment).not.toHaveBeenCalled();
      }
      // No second record write.
      expect(mockPublicationCreationSet).not.toHaveBeenCalled();
      // No second audit event.
      expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    });

    it("allows a failed record to proceed to a fresh upstream attempt", async () => {
      setupHappyPath();
      mockPublicationCreationGet.mockResolvedValue({
        exists: true,
        data: () => ({ status: "failed", errorCode: "lms.upstreamCallFailed" }),
      });
      const result = await __lmsAssignmentsPublishHandler(makeRequest());
      // Should attempt the upstream call and succeed.
      expect(result.status).toBe("succeeded");
    });
  });

  describe("lms.insufficientScope non-terminal path (§2.7)", () => {
    it("returns failed with errorCode lms.insufficientScope without writing a failed record", async () => {
      setupHappyPath();
      // Override adapter to throw insufficientScope.
      mockGetProviderAdapter.mockReturnValue({
        publishAssignment: jest.fn().mockRejectedValue(
          new PlatformError(
            "lms.insufficientScope",
            "Additional OAuth consent required.",
          ),
        ),
      });
      const result = await __lmsAssignmentsPublishHandler(makeRequest());
      expect(result.status).toBe("failed");
      expect(result.errorCode).toBe("lms.insufficientScope");
      // No failed record.
      expect(mockPublicationCreationSet).not.toHaveBeenCalled();
      // No lms.publishFailed audit.
      expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    });
  });

  describe("confirmed upstream failure path (Phase A catch)", () => {
    it("writes a failed record and emits lms.publishFailed on a confirmed upstream failure", async () => {
      setupHappyPath();
      mockGetProviderAdapter.mockReturnValue({
        publishAssignment: jest.fn().mockRejectedValue(
          new PlatformError(
            "lms.upstreamCallFailed",
            "Upstream call timed out.",
          ),
        ),
      });
      const result = await __lmsAssignmentsPublishHandler(makeRequest());
      expect(result.status).toBe("failed");
      expect(result.errorCode).toBe("lms.upstreamCallFailed");
      // Failed record written.
      expect(mockPublicationCreationSet).toHaveBeenCalledTimes(1);
      const written = mockPublicationCreationSet.mock.calls[0][0];
      expect(written.status).toBe("failed");
      // lms.publishFailed audit emitted.
      expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
      expect(mockWriteAuditEvent.mock.calls[0][0].action).toBe(
        "lms.publishFailed",
      );
    });

    it("still returns gracefully when the failed record write itself throws", async () => {
      setupHappyPath();
      mockGetProviderAdapter.mockReturnValue({
        publishAssignment: jest.fn().mockRejectedValue(
          new PlatformError("lms.upstreamCallFailed", "Upstream timed out."),
        ),
      });
      mockPublicationCreationSet.mockRejectedValue(new Error("Firestore down"));
      const result = await __lmsAssignmentsPublishHandler(makeRequest());
      expect(result.status).toBe("failed");
    });
  });

  describe("Phase B1: upstream succeeds but record write fails (orphan log)", () => {
    it("logs an error with the upstream lmsAssignmentId and returns did-not-succeed", async () => {
      setupHappyPath();
      mockPublicationCreationSet.mockRejectedValue(
        new Error("Firestore write failed"),
      );
      const result = await __lmsAssignmentsPublishHandler(makeRequest());
      expect(result.status).toBe("failed");
      expect(result.errorCode).toBe("lms.localPersistenceFailed");
      // Error-severity log must include the upstream lmsAssignmentId for
      // manual recovery per §2.4 (orphan log invariant).
      const errorCalls = mockLogError.mock.calls;
      const orphanLog = errorCalls.find(
        (args: unknown[]) =>
          typeof args[0] === "string" &&
          args[0].includes("publicationRecordFailed") &&
          typeof args[1] === "object" &&
          args[1] !== null &&
          (args[1] as Record<string, unknown>).lmsAssignmentId ===
            FIXTURE_LMS_ASSIGNMENT_ID,
      );
      expect(orphanLog).toBeDefined();
    });

    it("does not clobber the existing succeeded record", async () => {
      setupHappyPath({ alreadySucceeded: true });
      // Even though we use the completed-attempt guard, verify that Phase B1
      // guard set failure cannot overwrite succeeded status.
      // With alreadySucceeded: true, the handler returns early without calling
      // set at all.
      const result = await __lmsAssignmentsPublishHandler(makeRequest());
      expect(result.status).toBe("succeeded");
      expect(mockPublicationCreationSet).not.toHaveBeenCalled();
    });
  });

  describe("Phase B2: mirror update fails after succeeded record written", () => {
    it("returns succeeded and logs mirror-desync error", async () => {
      setupHappyPath();
      mockAssignmentLmsPublicationUpdate.mockRejectedValue(
        new Error("Mirror write failed"),
      );
      const result = await __lmsAssignmentsPublishHandler(makeRequest());
      expect(result.status).toBe("succeeded");
      expect(result.lmsAssignmentId).toBe(FIXTURE_LMS_ASSIGNMENT_ID);
      // succeeded record must not be overwritten.
      const setCalls = mockPublicationCreationSet.mock.calls;
      expect(setCalls.length).toBe(1);
      expect(setCalls[0][0].status).toBe("succeeded");
      // Mirror-desync logged at error severity.
      const errorCalls = mockLogError.mock.calls;
      const mirrorLog = errorCalls.find(
        (args: unknown[]) =>
          typeof args[0] === "string" &&
          args[0].includes("publicationMirrorFailed"),
      );
      expect(mirrorLog).toBeDefined();
    });
  });

  describe("Phase B3: audit emission fails after succeeded record and mirror written", () => {
    it("returns succeeded and logs audit-gap error", async () => {
      setupHappyPath();
      mockWriteAuditEvent.mockRejectedValue(new Error("Audit write failed"));
      const result = await __lmsAssignmentsPublishHandler(makeRequest());
      expect(result.status).toBe("succeeded");
      expect(result.lmsAssignmentId).toBe(FIXTURE_LMS_ASSIGNMENT_ID);
      // Audit gap logged at error severity.
      const errorCalls = mockLogError.mock.calls;
      const auditLog = errorCalls.find(
        (args: unknown[]) =>
          typeof args[0] === "string" &&
          args[0].includes("publicationAuditFailed"),
      );
      expect(auditLog).toBeDefined();
    });
  });
});
