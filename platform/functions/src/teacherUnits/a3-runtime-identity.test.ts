import { Firestore } from "@google-cloud/firestore";
import { getApp } from "firebase-admin/app";
import { getAdminFirestore } from "../shared/firestore/admin";
import { readRuntimeMetadata } from "./a3-runtime-metadata";
import { isResolvedRuntimeIdentity, resolveRuntimeIdentity } from "./a3-runtime-identity";
import type { ExpectedEnvironment } from "./a3-contracts";
jest.mock("firebase-admin/app", () => ({ getApp: jest.fn() }));
jest.mock("../shared/firestore/admin", () => ({ getAdminFirestore: jest.fn() }));
jest.mock("./a3-runtime-metadata", () => ({ readRuntimeMetadata: jest.fn() }));
const original = process.env;
const profile: ExpectedEnvironment = { environment: "emulator", projectId: "demo-bootstrap", projectNumber: "0",
  localProfile: { fingerprint: "a".repeat(64), authOrigin: "http://127.0.0.1:9099", firestoreHost: "127.0.0.1:8080", functionsOrigin: "http://127.0.0.1:5001" } };
let sdk: any;
let databases: Firestore[];
function cloud(project = "lyfelabz-prod", number = "182791689935") {
  process.env.K_SERVICE = "teacherunitscreate"; process.env.K_REVISION = "teacherunitscreate-00001-abc";
  sdk = new Firestore({ projectId: project }); databases.push(sdk);
  jest.spyOn(sdk, "initializeIfNeeded");
  jest.mocked(getAdminFirestore).mockReturnValue(sdk);
  jest.mocked(getApp).mockReturnValue({ options: { projectId: project } } as any);
  jest.mocked(readRuntimeMetadata).mockImplementation(path => Promise.resolve({
    "project/project-id": project, "project/numeric-project-id": number,
    "instance/region": `projects/${number}/regions/us-central1`, "instance/service-accounts/default/email": `runtime@${project}.iam.gserviceaccount.com`,
  }[path]));
}
beforeEach(() => {
  process.env = {};
  databases = []; cloud();
});
afterEach(async () => { await Promise.all(databases.map(db => db.terminate())); process.env = original; jest.clearAllMocks(); });
test.each([["lyfelabz-prod", "182791689935", "production"], ["lyfelabz-staging", "293337283840", "staging"]])("metadata-backed %s identity", async (project, number, environment) => {
  cloud(project, number);
  const result = await resolveRuntimeIdentity();
  expect(result).toMatchObject({ ok: true, available: false, identity: { environment, projectId: project, projectNumber: number } });
  if (result.ok) { expect(isResolvedRuntimeIdentity(result.identity)).toBe(true); expect(isResolvedRuntimeIdentity({ ...result.identity })).toBe(false); }
  expect(sdk.initializeIfNeeded).toHaveBeenCalledTimes(1);
});
test("explicit emulator and real installed SDK resolve before document reads", async () => {
  process.env = { FUNCTIONS_EMULATOR: "true", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" };
  const db = new Firestore({ projectId: "demo-bootstrap", databaseId: "(default)" });
  const get = jest.spyOn(db, "getAll");
  const doc = jest.spyOn(db, "doc");
  jest.mocked(getAdminFirestore).mockReturnValue(db);
  jest.mocked(getApp).mockReturnValue({ options: { projectId: "demo-bootstrap" } } as any);
  expect(await resolveRuntimeIdentity(profile)).toMatchObject({ ok: true, identity: { environment: "emulator", projectNumber: "0" }, available: false });
  expect(get).not.toHaveBeenCalled(); expect(doc).not.toHaveBeenCalled(); expect(readRuntimeMetadata).not.toHaveBeenCalled();
  await db.terminate();
});
test("installed cloud SDK can initialize an explicit project without tenant RPC", async () => {
  const db = new Firestore({ projectId: "lyfelabz-prod" });
  jest.mocked(getAdminFirestore).mockReturnValue(db);
  expect(await resolveRuntimeIdentity()).toMatchObject({ ok: true });
  await db.terminate();
});
test.each(["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT", "FUNCTION_REGION", "FUNCTIONS_EMULATOR", "FIREBASE_CONFIG", "FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "K_SERVICE", "K_REVISION"])("contradictory or malformed %s", async key => {
  process.env[key] = "spoofed";
  expect(await resolveRuntimeIdentity()).toMatchObject({ ok: false, available: false });
});
test.each(["project/project-id", "project/numeric-project-id", "instance/region", "instance/service-accounts/default/email"] as const)("missing or wrong metadata %s", async path => {
  const good = jest.mocked(readRuntimeMetadata).getMockImplementation()!;
  jest.mocked(readRuntimeMetadata).mockImplementation(p => p === path ? Promise.resolve("") : good(p));
  expect(await resolveRuntimeIdentity()).toMatchObject({ ok: false });
});
test.each([["wrong-project", "182791689935"], ["lyfelabz-prod", "293337283840"], ["lyfelabz-staging", "0"]])("wrong metadata pairing %s/%s", async (project, number) => {
  cloud(project, number); expect(await resolveRuntimeIdentity()).toMatchObject({ ok: false });
});
test.each(["projectId", "databaseId", "initializeIfNeeded"])("missing SDK identity field %s", async key => {
  Object.defineProperty(sdk, key, { value: undefined }); expect(await resolveRuntimeIdentity()).toMatchObject({ ok: false });
});
test("wrong database, SDK project, Admin project and region refuse", async () => {
  sdk._databaseId = "other"; expect((await resolveRuntimeIdentity()).ok).toBe(false);
  sdk._databaseId = "(default)"; sdk._projectId = "lyfelabz-staging"; expect((await resolveRuntimeIdentity()).ok).toBe(false);
  sdk._projectId = "lyfelabz-prod"; jest.mocked(getApp).mockReturnValue({ options: { projectId: "other" } } as any);
  expect((await resolveRuntimeIdentity()).ok).toBe(false);
});
test("environment labels alone cannot establish identity, and cloud cannot use local profile", async () => {
  process.env.GCLOUD_PROJECT = "lyfelabz-prod";
  jest.mocked(readRuntimeMetadata).mockRejectedValue(new Error("offline"));
  expect((await resolveRuntimeIdentity()).ok).toBe(false);
  expect((await resolveRuntimeIdentity(profile)).ok).toBe(false);
});
test("emulator flag alone and cloud execution labels in emulator refuse", async () => {
  process.env.FUNCTIONS_EMULATOR = "true";
  expect((await resolveRuntimeIdentity()).ok).toBe(false);
  expect((await resolveRuntimeIdentity(profile)).ok).toBe(false);
});
test("remote emulator destination and unknown SDK transport refuse", async () => {
  process.env = { FUNCTIONS_EMULATOR: "true", FIRESTORE_EMULATOR_HOST: "remote.example:8080", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" };
  expect((await resolveRuntimeIdentity({ ...profile, localProfile: { ...profile.localProfile!, firestoreHost: "remote.example:8080" } })).ok).toBe(false);
  process.env = {}; cloud(); sdk._settings = { host: "remote.example", ssl: false };
  expect((await resolveRuntimeIdentity()).ok).toBe(false);
  for (const settings of [{ servicePath: "remote.example" }, { port: 8080 }, { apiEndpoint: "remote.example" }]) {
    sdk._settings = settings; expect((await resolveRuntimeIdentity()).ok).toBe(false);
  }
});
test("wrong metadata region and region project number refuse", async () => {
  const good = jest.mocked(readRuntimeMetadata).getMockImplementation()!;
  for (const region of ["projects/293337283840/regions/us-central1", "projects/182791689935/regions/europe-west1"]) {
    jest.mocked(readRuntimeMetadata).mockImplementation(p => p === "instance/region" ? Promise.resolve(region) : good(p));
    expect((await resolveRuntimeIdentity()).ok).toBe(false);
  }
});
test("SDK initialization failure refuses before any identity is issued", async () => {
  sdk.initializeIfNeeded.mockRejectedValue(new Error("credentials unavailable"));
  expect(await resolveRuntimeIdentity()).toEqual({ ok: false, reason: "runtime-identity-unavailable", available: false });
});
test("explicit local profile rejects client fields and accessors without invoking them", async () => {
  process.env = { FUNCTIONS_EMULATOR: "true", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" };
  expect((await resolveRuntimeIdentity({ ...profile, clientApproved: true } as any)).ok).toBe(false);
  const getter = jest.fn(() => "emulator");
  const input = Object.defineProperty({ ...profile }, "environment", { enumerable: true, get: getter });
  expect((await resolveRuntimeIdentity(input)).ok).toBe(false); expect(getter).not.toHaveBeenCalled();
});
test("termination invalidates issued identity permanently", async () => {
  const result = await resolveRuntimeIdentity(); if (!result.ok) throw new Error("identity unavailable");
  expect(isResolvedRuntimeIdentity(result.identity)).toBe(true);
  await sdk.terminate();
  expect(isResolvedRuntimeIdentity(result.identity)).toBe(false);
  expect((await resolveRuntimeIdentity()).ok).toBe(false);
});
test("identity cannot be relied on with a different current Admin client", async () => {
  const result = await resolveRuntimeIdentity(); if (!result.ok) throw new Error("identity unavailable");
  const other = new Firestore({ projectId: "lyfelabz-prod" }); databases.push(other);
  jest.mocked(getAdminFirestore).mockReturnValue(other);
  expect(isResolvedRuntimeIdentity(result.identity)).toBe(false);
  jest.mocked(getAdminFirestore).mockReturnValue(sdk);
  expect(isResolvedRuntimeIdentity(result.identity)).toBe(false);
});
