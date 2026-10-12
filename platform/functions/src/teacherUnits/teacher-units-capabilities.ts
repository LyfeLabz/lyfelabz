import { createHash } from "node:crypto";
import { getApp } from "firebase-admin/app";
import { getAdminFirestore } from "../shared/firestore/admin";
import type { CallableRequest } from "firebase-functions/v2/https";
import { PlatformError, platformCallable, runFirestoreTransaction } from "../shared";
import { assertActiveTeacher, assertOnlyAllowedKeys, requestObject, reassertTeacherContextInTransaction } from "./teacher-unit-access";
import { UNIT_PLACEABLE_RESOURCE_ID_LIST } from "./unit-placeable-resources";
export const TEACHER_UNITS_OPERATIONS = Object.freeze([
  "create", "list", "get", "update", "archive", "restore", "setResources", "reorder",
]);
const REGION = "us-central1";
const VERSION = "teacher-units-v1";
const fail = (): never => { throw new PlatformError("teacherUnits.capabilityIdentityUnavailable", "Backend identity could not be verified."); };
// All supplied identities must agree. Labels do not attest other deployed endpoints.
export function capabilityRuntimeIdentity(env: NodeJS.ProcessEnv, adminProject: unknown, databaseProject?: unknown) {
  let configProject: unknown;
  if (env.FIREBASE_CONFIG !== undefined) {
    try {
      configProject = (JSON.parse(env.FIREBASE_CONFIG) as {
        projectId?: unknown;
      }).projectId;
    }
    catch {
      return fail();
    }
    if (typeof configProject !== "string" || !configProject)
      return fail();
  }
  const projects = [env.GCLOUD_PROJECT, env.GOOGLE_CLOUD_PROJECT, configProject, adminProject, databaseProject].filter(v => v !== undefined);
  if (!projects.length || projects.some(v => typeof v !== "string" || !v || v !== projects[0]))
    return fail();
  if (env.FUNCTION_REGION !== undefined && env.FUNCTION_REGION !== REGION)
    return fail();
  if (env.FUNCTIONS_EMULATOR !== undefined && env.FUNCTIONS_EMULATOR !== "true" && env.FUNCTIONS_EMULATOR !== "false")
    return fail();
  const projectId = projects[0] as string;
  const emulator = env.FUNCTIONS_EMULATOR === "true";
  if (emulator && (projectId === "lyfelabz-prod" || projectId === "demo-bootstrap"))
    return { projectId, environment: "emulator" as const, region: REGION };
  if (!emulator && projectId === "lyfelabz-prod")
    return { projectId, environment: "production" as const, region: REGION };
  if (!emulator && projectId === "lyfelabz-staging")
    return { projectId, environment: "staging" as const, region: REGION };
  return fail();
}
// Firestore 7 exposes this resolved getter at runtime but omits it from public
// typings. Read only after canonical reads initialize it; unknown SDK shapes refuse.
function resolvedFirestoreProject(): string {
  const project: unknown = (getAdminFirestore() as unknown as { projectId?: unknown }).projectId;
  if (typeof project !== "string" || !project) return fail();
  return project;
}

export async function __teacherUnitsCapabilitiesHandler(request: CallableRequest<unknown>) {
  const actor = await assertActiveTeacher(request);
  const payload = requestObject(request.data);
  assertOnlyAllowedKeys(payload, ["schemaVersion", "nonce", "clientContractVersion"]);
  if (payload.schemaVersion !== 1 || payload.clientContractVersion !== VERSION || typeof payload.nonce !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(payload.nonce)) {
    throw new PlatformError("teacherUnits.invalidRequest", "Unsupported capability request.");
  }
  const caller = await runFirestoreTransaction(tx => reassertTeacherContextInTransaction(tx, actor));
  const backend = capabilityRuntimeIdentity(process.env, getApp().options.projectId, resolvedFirestoreProject());
  return {
    schemaVersion: 1,
    nonce: payload.nonce,
    backend,
    teacherUnits: {
      apiContractVersion: VERSION,
      supportedOperations: [...TEACHER_UNITS_OPERATIONS],
      acceptedClientContractVersions: [VERSION],
      placementFingerprint: createHash("sha256").update(JSON.stringify(UNIT_PLACEABLE_RESOURCE_ID_LIST), "utf8").digest("hex"),
    },
    caller: { uid: caller.uid, role: "teacher", schoolId: caller.schoolId, districtId: caller.districtId },
  };
}
export const teacherUnitsCapabilities = platformCallable({ region: REGION }, __teacherUnitsCapabilitiesHandler);
