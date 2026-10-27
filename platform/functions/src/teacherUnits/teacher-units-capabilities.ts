import type { CallableRequest } from "firebase-functions/v2/https";
import { PlatformError, platformCallable, runFirestoreTransaction } from "../shared";
import {
  PRODUCTION_TEACHER_UNITS_ENFORCEMENT,
  RUNTIME_PLACEMENT_FINGERPRINT,
  TEACHER_UNITS_CLIENT_CONTRACT,
  TEACHER_UNITS_ENFORCEMENT_VERSION,
  type TeacherUnitsEnforcement,
  a3Refusal,
  assertScopeIdentity,
  declareAvailability,
  evaluateAvailabilityInTransaction,
  requireRuntimeIdentity,
} from "./a3-enforcement";
import { type CapabilityRequestV3, type CapabilityResponseV3, validateCapabilityRequest, validateCapabilityResponse } from "./availability-protocol";
import { assertActiveTeacher, reassertTeacherContextInTransaction, requestObject } from "./teacher-unit-access";

// teacherUnitsCapabilities - Option B schema 3 discovery (approved decision record,
// Decision 1). Order: runtime identity before any tenant read; canonical
// authentication; strict request parsing; then one read-only transaction that
// reauthorizes the caller and evaluates the uncached availability policy.
// Legacy discovery schemas 1/2 and v1/v2 contracts are refused with
// `teacherUnits.contractUnsupported`; there is no historical response or fallback. Closed discovery remains available under canonical
// authentication: closed, missing and unverifiable policies are declared, and
// only invalid or unreadable policies refuse.
export const TEACHER_UNITS_OPERATIONS = Object.freeze([
  "create", "list", "get", "update", "archive", "restore", "setResources", "reorder",
]);
const REQUEST_KEYS = ["clientContractVersion", "nonce", "schemaVersion"];

function invalidRequest(): PlatformError {
  return new PlatformError("teacherUnits.invalidRequest", "Unsupported capability request.");
}

export function readCapabilityRequest(data: unknown): CapabilityRequestV3 {
  const payload = requestObject(data);
  const keys = Object.keys(payload).sort();
  if (keys.length !== REQUEST_KEYS.length || keys.some((key, i) => key !== REQUEST_KEYS[i])) throw invalidRequest();
  if (payload.schemaVersion !== 3 || payload.clientContractVersion !== TEACHER_UNITS_CLIENT_CONTRACT) {
    throw a3Refusal("teacherUnits.contractUnsupported");
  }
  const parsed = validateCapabilityRequest(payload);
  if (!parsed.ok) throw invalidRequest();
  return parsed.value;
}

// Handler factory. Exported callables bind PRODUCTION_TEACHER_UNITS_ENFORCEMENT;
// other wiring exists only for server-side tests.
export function createTeacherUnitsCapabilitiesHandler(enforcement: TeacherUnitsEnforcement) {
  return async function teacherUnitsCapabilitiesHandler(
    request: CallableRequest<unknown>,
  ): Promise<CapabilityResponseV3> {
    const identity = await requireRuntimeIdentity(enforcement, "teacherUnitsCapabilities");
    const actor = await assertActiveTeacher(request);
    const capabilityRequest = readCapabilityRequest(request.data);
    const scope = { identity, enforcement, endpoint: "teacherUnitsCapabilities" } as const;
    const { caller, availability, backendBuildId } = await runFirestoreTransaction(async (tx) => {
      assertScopeIdentity(scope);
      const verified = await reassertTeacherContextInTransaction(tx, actor);
      const evaluation = await evaluateAvailabilityInTransaction(tx, scope);
      if (evaluation.backendBuildId === null) throw a3Refusal("teacherUnits.deploymentIneligible");
      return { caller: verified, availability: declareAvailability(evaluation), backendBuildId: evaluation.backendBuildId };
    });
    const response = {
      schemaVersion: 3,
      nonce: capabilityRequest.nonce,
      backend: {
        projectId: identity.projectId,
        environment: identity.environment,
        region: "us-central1",
        enforcementVersion: TEACHER_UNITS_ENFORCEMENT_VERSION,
        backendBuildId,
      },
      teacherUnits: {
        apiContractVersion: TEACHER_UNITS_CLIENT_CONTRACT,
        supportedOperations: [...TEACHER_UNITS_OPERATIONS],
        supportedClientContractVersions: [TEACHER_UNITS_CLIENT_CONTRACT],
        acceptedClientContractVersions: availability.state === "enabled" ? [TEACHER_UNITS_CLIENT_CONTRACT] : [],
        placementFingerprint: RUNTIME_PLACEMENT_FINGERPRINT,
        availability: { ...availability },
      },
      caller: { uid: caller.uid, role: "teacher", schoolId: caller.schoolId, districtId: caller.districtId },
    };
    // The server never emits a declaration the Option B client contract would refuse.
    const checked = validateCapabilityResponse(response, identity.environment === "emulator" ? identity.projectId : undefined);
    if (!checked.ok) throw a3Refusal("teacherUnits.policyInvalid");
    return checked.value;
  };
}

const teacherUnitsCapabilitiesHandler = createTeacherUnitsCapabilitiesHandler(PRODUCTION_TEACHER_UNITS_ENFORCEMENT);

export const teacherUnitsCapabilities = platformCallable({ region: "us-central1" }, teacherUnitsCapabilitiesHandler);

// Exported for direct testing without the callable wrapper.
export const __teacherUnitsCapabilitiesHandler = teacherUnitsCapabilitiesHandler;
