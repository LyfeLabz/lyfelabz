/**
 * @jest-environment-options {"url": "https://app.lyfelabz.com/"}
 */
import type { Auth, User } from "firebase/auth";
import type { Functions } from "firebase/functions";
import { TextEncoder } from "node:util";
import { createHash, webcrypto } from "node:crypto";
let listener: ((user: User | null) => void) | null = null;
const unsubscribe = jest.fn();
const callables: Record<string, jest.Mock> = {};
const callableFor = (name: string) => (callables[name] ??= jest.fn());
jest.mock("firebase/auth", () => ({ onIdTokenChanged: (_auth: unknown, callback: (user: User | null) => void) => { listener = callback; return unsubscribe; } }));
jest.mock("firebase/functions", () => ({ httpsCallable: (_functions: unknown, name: string) => callableFor(name) }));
jest.mock("./placeableResources", () => ({ getPlaceableResources: () => [{ id: "one" }] }));
import { assertTeacherUnitsTransport, createTeacherUnitsMutationVerifier, evaluateTeacherUnitsCapability, TeacherUnitsCompatibilityError, trustedTeacherUnitsEnvironment, type CompatibilityExpected } from "./backendCompatibility";
import { createFirebaseTeacherUnitsCallables } from "./wire";
import { normalizeTeacherUnitError } from "./errors";
import { isUncertainMutationFailure } from "./mutationReconciliation";

const OPERATIONS = ["create", "list", "get", "update", "archive", "restore", "setResources", "reorder"];
const POLICY = "123e4567-e89b-4abc-8def-1234567890ab";
const RELEASE = "a".repeat(64);
const expected: CompatibilityExpected = { projectId: "lyfelabz-prod", environment: "production", region: "us-central1" };
const caller = { uid: "t", schoolId: "s", districtId: "d" };
// Synchronous, so tables built at collection time see the real fingerprint.
const FINGERPRINT = createHash("sha256").update(JSON.stringify(["one"])).digest("hex");
type Availability = { state: string; policyInstanceId: string | null; policyGeneration: number | null; backendReleaseId: string | null; deploymentEligible: boolean };
const ENABLED: Availability = { state: "enabled", policyInstanceId: POLICY, policyGeneration: 7, backendReleaseId: RELEASE, deploymentEligible: true };
const response = (nonce = "n".repeat(48), availability: Availability = ENABLED, placementFingerprint = FINGERPRINT) => ({
  schemaVersion: 2,
  nonce,
  backend: { projectId: "lyfelabz-prod", environment: "production", region: "us-central1", enforcementVersion: "teacher-units-a3-v1" },
  teacherUnits: {
    apiContractVersion: "teacher-units-v2",
    supportedOperations: [...OPERATIONS],
    supportedClientContractVersions: ["teacher-units-v2"],
    acceptedClientContractVersions: availability.state === "enabled" ? ["teacher-units-v2"] : [],
    placementFingerprint,
    availability: { ...availability },
  },
  caller: { ...caller, role: "teacher" },
});
const evaluate = (raw: unknown) => evaluateTeacherUnitsCapability(raw, expected, "n".repeat(48), caller, FINGERPRINT);
const withTU = (patch: Record<string, unknown>) => { const r = response(); return { ...r, teacherUnits: { ...r.teacherUnits, ...patch } }; };

describe("schema 2 declaration", () => {
  test("every refusal row differs from a valid declaration only in its stated way", () => {
    expect(FINGERPRINT).toMatch(/^[0-9a-f]{64}$/);
    expect(() => evaluate(response())).not.toThrow();
  });
  test("an enabled, eligible declaration yields exactly the six-field envelope", () => {
    const envelope = evaluate(response());
    expect(envelope).toEqual({ schemaVersion: 1, clientContractVersion: "teacher-units-v2", policyInstanceId: POLICY, policyGeneration: 7, backendReleaseId: RELEASE, placementFingerprint: FINGERPRINT });
    expect(Object.isFrozen(envelope)).toBe(true);
  });
  test.each([
    ["closed", { state: "closed", policyInstanceId: POLICY, policyGeneration: 7, backendReleaseId: RELEASE, deploymentEligible: false }],
    ["missing policy (unverified)", { state: "unverified", policyInstanceId: null, policyGeneration: null, backendReleaseId: null, deploymentEligible: false }],
    ["ineligible enabled policy (unverified)", { state: "unverified", policyInstanceId: POLICY, policyGeneration: 7, backendReleaseId: RELEASE, deploymentEligible: false }],
  ])("a %s declaration is valid but authorizes no mutation", (_label, availability) => {
    expect(() => evaluate(response(undefined, availability))).toThrow(TeacherUnitsCompatibilityError);
  });
  const backend = response().backend;
  test.each<[string, unknown]>([
    ["null", null],
    ["empty", {}],
    ["extra top-level field", { ...response(), extra: true }],
    ["schema 1", { ...response(), schemaVersion: 1 }],
    ["stale nonce", response("m".repeat(48))],
    ["staging backend", { ...response(), backend: { ...backend, projectId: "lyfelabz-staging", environment: "staging" } }],
    ["emulator backend", { ...response(), backend: { ...backend, projectId: "demo-bootstrap", environment: "emulator" } }],
    ["prod project as emulator", { ...response(), backend: { ...backend, environment: "emulator" } }],
    ["other region", { ...response(), backend: { ...backend, region: "europe-west1" } }],
    ["other enforcement", { ...response(), backend: { ...backend, enforcementVersion: "teacher-units-a3-v0" } }],
    ...["uid", "role", "schoolId", "districtId"].map((k): [string, unknown] => [`caller ${k}`, { ...response(), caller: { ...caller, role: "teacher", [k]: "wrong" } }]),
    ["v1 api contract", withTU({ apiContractVersion: "teacher-units-v1" })],
    ["v1 accepted", withTU({ acceptedClientContractVersions: ["teacher-units-v1"] })],
    ["enabled accepting nothing", withTU({ acceptedClientContractVersions: [] })],
    ["closed accepting v2", (() => { const r = response(undefined, { ...ENABLED, state: "closed", deploymentEligible: false }); return { ...r, teacherUnits: { ...r.teacherUnits, acceptedClientContractVersions: ["teacher-units-v2"] } }; })()],
    ["enabled not eligible", response(undefined, { ...ENABLED, deploymentEligible: false })],
    ["enabled without release", response(undefined, { ...ENABLED, backendReleaseId: null })],
    ["partial policy identity", response(undefined, { ...ENABLED, policyGeneration: null })],
    ["noncanonical policy instance", response(undefined, { ...ENABLED, policyInstanceId: POLICY.toUpperCase() })],
    ["generation zero", response(undefined, { ...ENABLED, policyGeneration: 0 })],
    ["string generation", response(undefined, { ...ENABLED, policyGeneration: "7" as unknown as number })],
    ["placement mismatch", response(undefined, ENABLED, "b".repeat(64))],
    ["missing operation", withTU({ supportedOperations: OPERATIONS.slice(1) })],
    ["reordered operations", withTU({ supportedOperations: [...OPERATIONS].reverse() })],
    ["unknown availability field", response(undefined, { ...ENABLED, extra: true } as Availability)],
  ])("refuses %s", (_label, raw) => {
    expect(() => evaluate(raw)).toThrow(TeacherUnitsCompatibilityError);
  });
  test("refuses accessor-backed declarations", () => {
    const raw = response();
    Object.defineProperty(raw.teacherUnits.availability, "policyGeneration", { enumerable: true, get: () => 7 });
    expect(() => evaluate(raw)).toThrow(TeacherUnitsCompatibilityError);
  });
});

test("origins are pinned independently of injected config; local origins fail closed", () => {
  expect(trustedTeacherUnitsEnvironment("https://app.lyfelabz.com")).toEqual(expected);
  expect(trustedTeacherUnitsEnvironment("https://lyfelabz-staging.web.app")).toEqual({ projectId: "lyfelabz-staging", environment: "staging", region: "us-central1" });
  for (const origin of ["http://localhost:5173", "http://127.0.0.1:5000", "http://localhost", "https://localhost", "https://preview.example", "http://app.lyfelabz.com", "https://lyfelabz-prod.web.app", "http://0.0.0.0", "null", ""])
    expect(() => trustedTeacherUnitsEnvironment(origin)).toThrow(TeacherUnitsCompatibilityError);
});

let session: { uid: string; schoolId: string; generation: number } | null;
let user: User;
let auth: Auth;
let functions: Functions;
let token: { token: string; claims: { role: string; schoolId: string; districtId: string } };
let declared: Availability;
const capability = () => callableFor("teacherUnitsCapabilities");
beforeEach(() => {
  jest.useRealTimers();
  for (const c of Object.values(callables)) c.mockReset();
  unsubscribe.mockClear();
  listener = null;
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
  Object.defineProperty(globalThis, "TextEncoder", { configurable: true, value: TextEncoder });
  session = { uid: "t", schoolId: "s", generation: 1 };
  token = { token: "token", claims: { role: "teacher", schoolId: "s", districtId: "d" } };
  user = { uid: "t", getIdTokenResult: jest.fn(async () => token) } as unknown as User;
  const app = { options: { projectId: "lyfelabz-prod" } };
  auth = { app, currentUser: user, emulatorConfig: null } as unknown as Auth;
  functions = { app, region: "us-central1", customDomain: null, emulatorOrigin: null } as unknown as Functions;
  declared = ENABLED;
  capability().mockImplementation(async (req: { nonce: string }) => ({ data: response(req.nonce, declared) }));
});
const verifier = () => createTeacherUnitsMutationVerifier(functions, auth, () => session);

test("sends exactly the schema 2 request with a fresh nonce per verification", async () => {
  const verify = verifier();
  expect((await verify())()).toEqual(evaluate(response()));
  (await verify())();
  expect(capability()).toHaveBeenCalledTimes(2);
  const [first, second] = capability().mock.calls.map(([req]) => req as Record<string, unknown>);
  expect(Object.keys(first).sort()).toEqual(["clientContractVersion", "nonce", "schemaVersion"]);
  expect(first).toMatchObject({ schemaVersion: 2, clientContractVersion: "teacher-units-v2" });
  expect(first.nonce).toMatch(/^[0-9a-f]{48}$/);
  expect(second.nonce).not.toBe(first.nonce);
  expect(unsubscribe).toHaveBeenCalledTimes(2);
});
test.each(["closed", "unverified"])("a %s backend blocks every mutation before dispatch", async (state) => {
  declared = { state, policyInstanceId: POLICY, policyGeneration: 7, backendReleaseId: RELEASE, deploymentEligible: false };
  await expect(verifier()()).rejects.toBeInstanceOf(TeacherUnitsCompatibilityError);
  expect(capability()).toHaveBeenCalledTimes(1);
  expect(unsubscribe).toHaveBeenCalled();
});
test("the server's legacy refusal of a v1 request is not reachable: v2 is always sent", async () => {
  capability().mockRejectedValue(Object.assign(new Error("x"), { details: { code: "teacherUnits.contractUnsupported" } }));
  await expect(verifier()()).rejects.toBeInstanceOf(TeacherUnitsCompatibilityError);
  expect(capability().mock.calls[0][0]).toMatchObject({ schemaVersion: 2 });
});
test("a local origin cannot construct the verifier", () => {
  const original = window.location;
  Object.defineProperty(window, "location", { configurable: true, value: { origin: "http://localhost:5173" } });
  try {
    expect(() => verifier()).toThrow(TeacherUnitsCompatibilityError);
  } finally {
    Object.defineProperty(window, "location", { configurable: true, value: original });
  }
});
test.each(["app", "project", "region", "custom", "emulator", "authEmulator"])("wrong transport %s refuses before discovery", async (kind) => {
  const f = functions as unknown as Record<string, unknown>;
  const a = auth as unknown as Record<string, unknown>;
  if (kind === "app") a.app = { options: { projectId: "lyfelabz-prod" } };
  if (kind === "project") functions.app.options.projectId = "lyfelabz-staging";
  if (kind === "region") f.region = "europe-west1";
  if (kind === "custom") f.customDomain = "https://evil.example";
  if (kind === "emulator") f.emulatorOrigin = "http://127.0.0.1:5001";
  if (kind === "authEmulator") a.emulatorConfig = { host: "127.0.0.1", port: 9099, protocol: "http" };
  await expect(verifier()()).rejects.toBeInstanceOf(TeacherUnitsCompatibilityError);
  expect(capability()).not.toHaveBeenCalled();
});
test("a missing emulatorOrigin field (SDK shape change) refuses", () => {
  delete (functions as unknown as Record<string, unknown>).emulatorOrigin;
  expect(() => assertTeacherUnitsTransport(functions, auth, expected)).toThrow(TeacherUnitsCompatibilityError);
});
test.each(["missing endpoint", "offline"])("%s blocks", async (reason) => {
  capability().mockRejectedValue(new Error(reason));
  await expect(verifier()()).rejects.toBeInstanceOf(TeacherUnitsCompatibilityError);
});
test("a signed-in user other than the session's teacher refuses before discovery", async () => {
  (auth as unknown as Record<string, unknown>).currentUser = { ...user, uid: "other" };
  await expect(verifier()()).rejects.toBeInstanceOf(TeacherUnitsCompatibilityError);
  expect(capability()).not.toHaveBeenCalled();
});
test("a staging origin accepts only a staging declaration", () => {
  const staging = trustedTeacherUnitsEnvironment("https://lyfelabz-staging.web.app");
  const r = response();
  const raw = { ...r, backend: { ...r.backend, projectId: "lyfelabz-staging", environment: "staging" } };
  expect(evaluateTeacherUnitsCapability(raw, staging, "n".repeat(48), caller, FINGERPRINT).policyGeneration).toBe(7);
  expect(() => evaluateTeacherUnitsCapability(response(), staging, "n".repeat(48), caller, FINGERPRINT)).toThrow(TeacherUnitsCompatibilityError);
});
test.each(["role", "school", "district"])("token claim %s mismatch refuses before discovery", async (kind) => {
  if (kind === "role") token = { ...token, claims: { ...token.claims, role: "student" } };
  if (kind === "school") token = { ...token, claims: { ...token.claims, schoolId: "other" } };
  if (kind === "district") token = { ...token, claims: { ...token.claims, districtId: " " } };
  await expect(verifier()()).rejects.toBeInstanceOf(TeacherUnitsCompatibilityError);
  expect(capability()).not.toHaveBeenCalled();
});
test.each(["sameUid", "school", "district", "dispose", "token", "policy"])("late response cannot authorize changed %s", async (kind) => {
  capability().mockImplementation(async (req: { nonce: string }) => {
    if (kind === "sameUid") { listener?.(null); listener?.(user); }
    if (kind === "school") session = { ...session!, schoolId: "other" };
    if (kind === "district") token = { ...token, claims: { ...token.claims, districtId: "other" }, token: "new" };
    if (kind === "dispose") session = null;
    if (kind === "token") { listener?.(user); listener?.(user); }
    return { data: response(req.nonce, kind === "policy" ? { ...ENABLED, state: "closed", deploymentEligible: false } : declared) };
  });
  await expect(verifier()()).rejects.toBeInstanceOf(TeacherUnitsCompatibilityError);
  expect(unsubscribe).toHaveBeenCalled();
});
test("the permit rechecks session and transport at consumption", async () => {
  const permit = await verifier()();
  session = { ...session!, generation: 2 };
  expect(permit).toThrow(TeacherUnitsCompatibilityError);
  const next = await verifier()();
  (functions as unknown as Record<string, unknown>).emulatorOrigin = "http://127.0.0.1:5001";
  expect(next).toThrow(TeacherUnitsCompatibilityError);
});
test("bounded deadline rejects a delayed capability and never authorizes it later", async () => {
  jest.useFakeTimers();
  capability().mockImplementation(() => new Promise(() => { }));
  const pending = verifier()();
  const assertion = expect(pending).rejects.toBeInstanceOf(TeacherUnitsCompatibilityError);
  await jest.advanceTimersByTimeAsync(10001);
  await assertion;
  expect(unsubscribe).toHaveBeenCalled();
  jest.useRealTimers();
});
test("verification permits cannot be reused as a positive cache", async () => {
  const permit = await verifier()();
  permit();
  expect(permit).toThrow(TeacherUnitsCompatibilityError);
});
test("unused permits expire and release their auth observer", async () => {
  const permit = await verifier()();
  jest.useFakeTimers();
  // The production deadline is already running; consume this permit for cleanup.
  permit();
  const next = verifier()();
  await jest.advanceTimersByTimeAsync(1);
  const unused = await next;
  await jest.advanceTimersByTimeAsync(10001);
  expect(unused).toThrow(TeacherUnitsCompatibilityError);
  expect(unsubscribe).toHaveBeenCalledTimes(2);
  jest.useRealTimers();
});

describe("dispatch through the real adapter", () => {
  const callables = () => createFirebaseTeacherUnitsCallables(functions, verifier());
  const unit = { id: "u1", ownerUid: "t", schoolId: "s", grade: 7, title: "T", description: "", status: "active", resourceIds: [], sortOrder: 1000, revision: 4, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", archivedAt: null };
  test("each mutation carries the envelope from its own fresh discovery", async () => {
    callableFor("teacherUnitsUpdate").mockResolvedValue({ data: { unit, noop: false } });
    const c = callables();
    await c.update({ unitId: "u1", expectedRevision: 3, title: "T" }).catch(() => undefined);
    await c.update({ unitId: "u1", expectedRevision: 3, title: "T" }).catch(() => undefined);
    expect(capability()).toHaveBeenCalledTimes(2);
    const sent = callableFor("teacherUnitsUpdate").mock.calls;
    expect(sent).toHaveLength(2);
    for (const [payload] of sent)
      expect(payload).toEqual({ unitId: "u1", expectedRevision: 3, title: "T", compatibility: evaluate(response()) });
  });
  test("a closed declaration sends nothing and is a proven non-commit", async () => {
    declared = { state: "closed", policyInstanceId: POLICY, policyGeneration: 7, backendReleaseId: RELEASE, deploymentEligible: false };
    const error = await callables().archive({ unitId: "u1", expectedRevision: 3 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TeacherUnitsCompatibilityError);
    expect(callableFor("teacherUnitsArchive")).not.toHaveBeenCalled();
    const normalized = normalizeTeacherUnitError(error);
    expect(normalized.category).toBe("compatibilityBlocked");
    expect(isUncertainMutationFailure(normalized)).toBe(false);
  });
  test("reads take no discovery and no envelope", async () => {
    callableFor("teacherUnitsGet").mockResolvedValue({ data: { unit } });
    await callables().get({ unitId: "u1" }).catch(() => undefined);
    expect(capability()).not.toHaveBeenCalled();
    expect(callableFor("teacherUnitsGet").mock.calls[0][0]).toEqual({ unitId: "u1" });
  });
});
