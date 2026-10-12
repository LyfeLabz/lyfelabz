jest.mock("../shared/firestore/admin", () => ({ getAdminFirestore: () => ({ projectId: "lyfelabz-prod" }) }));
import type { CallableRequest } from "firebase-functions/v2/https";
import { createHash } from "node:crypto";
const actor = { uid: "teacher", schoolId: "school", districtId: "district" };
const authorize = jest.fn();
const reassert = jest.fn();
jest.mock("./teacher-unit-access", () => ({
  ...jest.requireActual("./teacher-unit-access"),
  assertActiveTeacher: (request: unknown) => authorize(request),
  reassertTeacherContextInTransaction: (...args: unknown[]) => reassert(...args),
}));
jest.mock("../shared", () => ({
  ...jest.requireActual("../shared"),
  runFirestoreTransaction: (fn: (tx: unknown) => unknown) => fn(Object.freeze({})),
}));
jest.mock("firebase-admin/app", () => ({ getApp: () => ({ options: { projectId: "lyfelabz-prod" } }) }));
import { __teacherUnitsCapabilitiesHandler as handler, capabilityRuntimeIdentity, TEACHER_UNITS_OPERATIONS } from "./teacher-units-capabilities";
import { UNIT_PLACEABLE_RESOURCE_ID_LIST } from "./unit-placeable-resources";
import { PlatformError } from "../shared";
const payload = { schemaVersion: 1, nonce: "0123456789abcdef", clientContractVersion: "teacher-units-v1" };
const request = (data: unknown) => ({ data }) as CallableRequest<unknown>;
const original = process.env;
beforeEach(() => { process.env = { ...original, GCLOUD_PROJECT: "lyfelabz-prod" }; delete process.env.FIREBASE_CONFIG; delete process.env.GOOGLE_CLOUD_PROJECT; delete process.env.FUNCTIONS_EMULATOR; authorize.mockResolvedValue(actor); reassert.mockResolvedValue(actor); jest.clearAllMocks(); });
afterAll(() => { process.env = original; });
test("versioned read-only response uses revalidated caller and canonical fingerprint, without availability", async () => {
  const response = await handler(request(payload));
  expect(response).toEqual({ schemaVersion: 1, nonce: payload.nonce, backend: { projectId: "lyfelabz-prod", environment: "production", region: "us-central1" }, teacherUnits: { apiContractVersion: "teacher-units-v1", supportedOperations: [...TEACHER_UNITS_OPERATIONS], acceptedClientContractVersions: ["teacher-units-v1"], placementFingerprint: createHash("sha256").update(JSON.stringify(UNIT_PLACEABLE_RESOURCE_ID_LIST)).digest("hex") }, caller: { ...actor, role: "teacher" } });
  expect(reassert).toHaveBeenCalledTimes(1);
});
test.each([null, [], { ...payload, projectId: "lyfelabz-prod" }, { ...payload, schemaVersion: 2 }, { ...payload, nonce: "short" }, { ...payload, clientContractVersion: "v2" }])("closed schema rejects %p", async (data) => { await expect(handler(request(data))).rejects.toBeInstanceOf(PlatformError); });
test.each(["unauthenticated", "role-forbidden", "account-inactive", "claim-state-mismatch", "district-mismatch"])("canonical refusal %s propagates", async (code) => { authorize.mockRejectedValue(new PlatformError(code, "Refused")); await expect(handler(request(payload))).rejects.toMatchObject({ code }); expect(reassert).not.toHaveBeenCalled(); });
test("transactional context refusal propagates", async () => { reassert.mockRejectedValue(new PlatformError("district-mismatch", "Changed")); await expect(handler(request(payload))).rejects.toMatchObject({ code: "district-mismatch" }); });
test.each([
  [{}, undefined], [{ GCLOUD_PROJECT: "unknown" }, undefined], [{ GCLOUD_PROJECT: "lyfelabz-prod", GOOGLE_CLOUD_PROJECT: "lyfelabz-staging" }, "lyfelabz-prod"], [{ GCLOUD_PROJECT: "lyfelabz-prod", FIREBASE_CONFIG: "bad" }, "lyfelabz-prod"], [{ GCLOUD_PROJECT: "lyfelabz-prod", FUNCTION_REGION: "europe-west1" }, "lyfelabz-prod"], [{ GCLOUD_PROJECT: "lyfelabz-prod", FUNCTIONS_EMULATOR: "maybe" }, "lyfelabz-prod"], [{ GCLOUD_PROJECT: "lyfelabz-prod" }, "lyfelabz-staging"],
])("ambiguous runtime identity refuses %p", (env, admin) => { expect(() => capabilityRuntimeIdentity(env, admin)).toThrow(PlatformError); });
test("explicit staging and approved emulator identities", () => { expect(capabilityRuntimeIdentity({ GCLOUD_PROJECT: "lyfelabz-staging" }, "lyfelabz-staging").environment).toBe("staging"); expect(capabilityRuntimeIdentity({ GCLOUD_PROJECT: "demo-bootstrap", FUNCTIONS_EMULATOR: "true" }, "demo-bootstrap").environment).toBe("emulator"); });
test("resolved database project must agree with runtime identity", () => { expect(() => capabilityRuntimeIdentity({ GCLOUD_PROJECT: "lyfelabz-prod" }, undefined, "lyfelabz-staging")).toThrow(PlatformError); });
