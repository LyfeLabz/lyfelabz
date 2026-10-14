import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getApp } from "firebase-admin/app";
import { Firestore } from "@google-cloud/firestore";
import { getAdminFirestore } from "../shared/firestore/admin";
import { contentDigest, evidenceRef, canonicalJSON } from "./a3-canonical";
import { validateDeploymentBinding } from "./a3-bindings";
import { inventoryRuntimeArtifact, RUNTIME_BUILD_PATH } from "./a3-runtime-artifact";
import { resolveRuntimeIdentity } from "./a3-runtime-identity";
import type { RuntimeIdentity } from "./a3-runtime-identity";
import { readRuntimeMetadata } from "./a3-runtime-metadata";
import { verifyRuntimeProvenance } from "./a3-runtime-provenance";
jest.mock("firebase-admin/app", () => ({ getApp: jest.fn() }));
jest.mock("../shared/firestore/admin", () => ({ getAdminFirestore: jest.fn() }));
jest.mock("./a3-runtime-metadata", () => ({ readRuntimeMetadata: jest.fn() }));
const fixture = JSON.parse(readFileSync(resolve(__dirname, "../../../../fixtures/teacher-units-a3/v1.json"), "utf8"));
let root: string, release: any, approval: any, identity: RuntimeIdentity;
let db: Firestore;
const original = process.env;
function bind() {
  for (const key of ["sourceSha", "sourceTree", "runtimePayloadFingerprint", "functionsArtifactFingerprint", "placementFingerprint", "enforcementVersion", "deploymentMode"]) approval.payload.statement.candidate[key] = release.manifest[key];
  approval.payload.source.statementObject.sha256 = contentDigest(approval.payload.statement);
  release.manifest.deploymentApprovalEvidenceRef = evidenceRef(approval.payload);
}
function verify(ref: unknown = `teacherUnitsBackendReleases/${contentDigest(release.manifest)}`) {
  return verifyRuntimeProvenance(identity, "teacherUnitsCreate", ref, release, approval, root);
}
beforeEach(async () => {
  process.env = { K_SERVICE: "teacherunitscreate", K_REVISION: "teacherunitscreate-00001-test" };
  release = JSON.parse(JSON.stringify(fixture.valid.backendRelease)); approval = JSON.parse(JSON.stringify(fixture.valid.deploymentApproval));
  const endpoint = release.manifest.endpoints.find((e: any) => e.endpointName === "teacherUnitsCreate");
  jest.mocked(getApp).mockReturnValue({ options: { projectId: "lyfelabz-staging" } } as any);
  db = new Firestore({ projectId: "lyfelabz-staging" });
  jest.mocked(getAdminFirestore).mockReturnValue(db);
  jest.mocked(readRuntimeMetadata).mockImplementation(p => Promise.resolve({
    "project/project-id": "lyfelabz-staging", "project/numeric-project-id": "293337283840",
    "instance/region": "projects/293337283840/regions/us-central1", "instance/service-accounts/default/email": endpoint.execution.serviceAccountEmail as string,
  }[p]));
  const result = await resolveRuntimeIdentity(); if (!result.ok) throw new Error("test identity"); identity = result.identity;
  root = mkdtempSync(join(tmpdir(), "a3-provenance-")); mkdirSync(join(root, "lib/teacherUnits"), { recursive: true });
  writeFileSync(join(root, "lib/index.js"), "compiled");
  writeFileSync(join(root, "lib/teacherUnits/unit-placeable-resources.json"), '{"resourceIds":["one","two"]}');
  writeFileSync(join(root, "package.json"), "{}"); writeFileSync(join(root, "package-lock.json"), "{}");
  const inventory = inventoryRuntimeArtifact(root);
  const record = { schemaVersion: 1, enforcementVersion: "teacher-units-a3-v1", deploymentMode: "policy-controlled", sourceDirty: false,
    sourceSha: release.manifest.sourceSha as string, sourceTree: release.manifest.sourceTree as string,
    runtimePayloadFingerprint: inventory.runtimePayloadFingerprint, placementFingerprint: inventory.placementFingerprint,
    supportedClientContractVersions: ["teacher-units-v2"] };
  writeFileSync(join(root, RUNTIME_BUILD_PATH), canonicalJSON(record));
  Object.assign(release.manifest, inventoryRuntimeArtifact(root)); delete release.manifest.runtimeFiles;
  bind();
});
afterEach(async () => { await db.terminate(); process.env = original; rmSync(root, { recursive: true, force: true }); jest.clearAllMocks(); });
test("exact runtime match and synthetic signature confer no operational approval", () => {
  expect(validateDeploymentBinding(release, approval)).toMatchObject({ ok: true, scope: "structure-only", operationalVerification: "unverified" });
  expect(verify()).toEqual({ runtimeConsistency: "matched", available: false, approvalVerification: "unverified", deploymentVerification: "unverified", releaseId: contentDigest(release.manifest) });
});
test.each(["sourceSha", "sourceTree", "runtimePayloadFingerprint", "functionsArtifactFingerprint", "placementFingerprint"])("coherent but wrong runtime %s refused", key => {
  release.manifest[key] = (key.startsWith("source") ? "f".repeat(40) : "f".repeat(64)); bind(); expect(verify().runtimeConsistency).toBe("unverified");
});
test("manifest path hashes manifest, not wrapper, and exact digest is mandatory", () => {
  expect(verify(`teacherUnitsBackendReleases/${contentDigest(release)}`).runtimeConsistency).toBe("unverified");
  expect(verify(`teacherUnitsBackendReleases/${"a".repeat(64)}`).runtimeConsistency).toBe("unverified");
});
test.each([null, {}, { schemaVersion: 2 }, { schemaVersion: 1, payload: { kind: "unsupported" } }])("malformed or unsupported approval %p", input => {
  approval = input; expect(verify().runtimeConsistency).toBe("unverified");
});
test("approval digest/statement/candidate mismatch refused", () => {
  approval.payload.statement.candidate.sourceSha = "f".repeat(40);
  expect(verify().runtimeConsistency).toBe("unverified");
});
test("fabricated or copied runtime identity refused", () => {
  identity = { ...identity }; expect(verify().runtimeConsistency).toBe("unverified");
});
test("self-reported closed build and missing build never match", () => {
  const path = join(root, RUNTIME_BUILD_PATH), record = JSON.parse(readFileSync(path, "utf8"));
  record.deploymentMode = "closed-only"; writeFileSync(path, canonicalJSON(record));
  release.manifest.functionsArtifactFingerprint = inventoryRuntimeArtifact(root).functionsArtifactFingerprint; bind();
  expect(verify().runtimeConsistency).toBe("unverified"); rmSync(path); expect(verify().runtimeConsistency).toBe("unverified");
});
test("SDK execution account/service/revision bind only this endpoint", () => {
  const endpoint = release.manifest.endpoints.find((e: any) => e.endpointName === "teacherUnitsCreate");
  const originalAccount = endpoint.execution.serviceAccountEmail;
  endpoint.execution.serviceAccountEmail = "other@lyfelabz-staging.iam.gserviceaccount.com";
  expect(verify().runtimeConsistency).toBe("unverified");
  endpoint.execution.serviceAccountEmail = originalAccount;
  endpoint.revisionResource = endpoint.revisionResource.replace("00001-test", "00002-test");
  endpoint.traffic[0].revisionResource = endpoint.revisionResource;
  expect(verify().runtimeConsistency).toBe("unverified");
  endpoint.serviceResource = endpoint.serviceResource.replace("teacherunitscreate", "another-service");
  endpoint.revisionResource = endpoint.revisionResource.replaceAll("teacherunitscreate", "another-service");
  endpoint.traffic[0].revisionResource = endpoint.revisionResource;
  expect(verify().runtimeConsistency).toBe("unverified");
});
test("malformed release and adversarial accessors fail closed", () => {
  release.manifest.extra = true; expect(verify().runtimeConsistency).toBe("unverified");
  const hostile = Object.defineProperty({}, "manifest", { enumerable: true, get: () => { throw new Error("hostile"); } });
  expect(verifyRuntimeProvenance(identity, "teacherUnitsCreate", "bad", hostile, approval, root).available).toBe(false);
});
test("no positive cache: changed payload is refused on subsequent invocation", () => {
  expect(verify().runtimeConsistency).toBe("matched"); writeFileSync(join(root, "lib/index.js"), "changed");
  expect(verify().runtimeConsistency).toBe("unverified");
});
test("terminated binding cannot retain matched provenance for an old identity", async () => {
  expect(verify().runtimeConsistency).toBe("matched");
  await db.terminate();
  expect(verify()).toMatchObject({ runtimeConsistency: "unverified", available: false, releaseId: null });
});
test("foreign client injected into the pool invalidates old identity provenance", async () => {
  expect(verify().runtimeConsistency).toBe("matched");
  const donor = new Firestore({ projectId: "lyfelabz-staging", host: "attacker.invalid:443" });
  const client = (donor as any)._clientPool.clientFactory(true), pool = (db as any)._clientPool;
  pool.activeClients.set(client, { grpcEnabled: true, activeRequestCount: 0 });
  expect(verify()).toMatchObject({ runtimeConsistency: "unverified", available: false });
  pool.activeClients.delete(client);
  expect(verify().runtimeConsistency).toBe("unverified");
  await client.close(); await donor.terminate();
});
