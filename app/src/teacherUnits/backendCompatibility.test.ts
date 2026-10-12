import type { Auth, User } from "firebase/auth";
import type { Functions } from "firebase/functions";
import { TextEncoder } from "node:util";
import { webcrypto } from "node:crypto";
let listener: ((user: User | null) => void) | null = null;
const unsubscribe = jest.fn();
const callable = jest.fn();
jest.mock("firebase/auth", () => ({ onIdTokenChanged: (_auth: unknown, callback: (user: User | null) => void) => { listener = callback; return unsubscribe; } }));
jest.mock("firebase/functions", () => ({ httpsCallable: () => callable }));
jest.mock("./placeableResources", () => ({ getPlaceableResources: () => [{ id: "one" }] }));
import { assertTeacherUnitsTransport, createTeacherUnitsMutationVerifier, REQUIRED_OPERATIONS, TeacherUnitsCompatibilityError, trustedTeacherUnitsEnvironment, validateTeacherUnitsCapability } from "./backendCompatibility";
const expected = { projectId: "lyfelabz-prod", environment: "emulator", region: "us-central1" };
const caller = { uid: "t", schoolId: "s", districtId: "d" };
const response = (nonce = "nonce", placementFingerprint = "fingerprint") => ({ schemaVersion: 1, nonce, backend: expected, teacherUnits: { apiContractVersion: "teacher-units-v1", acceptedClientContractVersions: ["teacher-units-v1"], supportedOperations: [...REQUIRED_OPERATIONS], placementFingerprint }, caller: { ...caller, role: "teacher" } });
const parse = (raw: unknown) => validateTeacherUnitsCapability(raw, expected, "nonce", caller, "fingerprint");
test("strict valid response", () => { expect(() => parse(response())).not.toThrow(); });
test.each([null, {}, { ...response(), extra: true }, { ...response(), schemaVersion: 2 }, { ...response(), nonce: "stale" }, ...["projectId", "environment", "region"].map(k => ({ ...response(), backend: { ...expected, [k]: "wrong" } })), ...["uid", "role", "schoolId", "districtId"].map(k => ({ ...response(), caller: { ...caller, role: "teacher", [k]: "wrong" } })), ...["apiContractVersion", "placementFingerprint"].map(k => ({ ...response(), teacherUnits: { ...response().teacherUnits, [k]: "wrong" } })), { ...response(), teacherUnits: { ...response().teacherUnits, supportedOperations: ["create"] } }, { ...response(), teacherUnits: { ...response().teacherUnits, acceptedClientContractVersions: ["v2"] } }])("malformed/incompatible response refuses %p", raw => { expect(() => parse(raw)).toThrow(TeacherUnitsCompatibilityError); });
test("origins are pinned independently of injected config", () => {
  expect(trustedTeacherUnitsEnvironment("https://app.lyfelabz.com").environment).toBe("production");
  expect(trustedTeacherUnitsEnvironment("https://lyfelabz-staging.web.app").projectId).toBe("lyfelabz-staging");
  for (const origin of ["https://preview.example", "http://app.lyfelabz.com", "http://0.0.0.0", "https://localhost"])
    expect(() => trustedTeacherUnitsEnvironment(origin)).toThrow();
});
let session: {
  uid: string;
  schoolId: string;
  generation: number;
} | null;
let user: User;
let auth: Auth;
let functions: Functions;
let token: {
  token: string;
  claims: {
    role: string;
    schoolId: string;
    districtId: string;
  };
};
beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  listener = null;
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
  Object.defineProperty(globalThis, "TextEncoder", { configurable: true, value: TextEncoder });
  session = { uid: "t", schoolId: "s", generation: 1 };
  token = { token: "token", claims: { role: "teacher", schoolId: "s", districtId: "d" } };
  user = { uid: "t", getIdTokenResult: jest.fn(async () => token) } as unknown as User;
  const app = { options: { projectId: "lyfelabz-prod" } };
  auth = { app, currentUser: user, emulatorConfig: { host: "127.0.0.1", port: 9099, protocol: "http" } } as unknown as Auth;
  functions = { app, region: "us-central1", customDomain: null, emulatorOrigin: "http://127.0.0.1:5001" } as unknown as Functions;
  callable.mockImplementation(async (req: {
    nonce: string;
  }) => {
    const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(["one"])));
    return { data: response(req.nonce, Buffer.from(digest).toString("hex")) };
  });
});
const verifier = () => createTeacherUnitsMutationVerifier(functions, auth, () => session);
test("fresh request per verification; permit rechecks session and app", async () => {
  const verify = verifier();
  (await verify())();
  (await verify())();
  expect(callable).toHaveBeenCalledTimes(2);
  expect(unsubscribe).toHaveBeenCalledTimes(2);
  const permit = await verify();
  session = null;
  expect(permit).toThrow();
});
test.each(["app", "project", "region", "custom", "emulator", "authEmulator"])("wrong transport %s refuses", async (kind) => {
  const f = functions as unknown as Record<string, unknown>;
  const a = auth as unknown as Record<string, unknown>;
  if (kind === "app")
    a.app = { options: { projectId: "lyfelabz-prod" } };
  if (kind === "project")
    functions.app.options.projectId = "lyfelabz-staging";
  if (kind === "region")
    f.region = "europe-west1";
  if (kind === "custom")
    f.customDomain = "https://evil.example";
  if (kind === "emulator")
    f.emulatorOrigin = null;
  if (kind === "authEmulator")
    a.emulatorConfig = null;
  await expect(verifier()()).rejects.toBeInstanceOf(TeacherUnitsCompatibilityError);
  expect(callable).not.toHaveBeenCalled();
});
test("production refuses emulator transport", () => { expect(() => assertTeacherUnitsTransport(functions, auth, { ...expected, environment: "production" })).toThrow(); });
test.each(["missing endpoint", "offline"])("%s blocks", async (reason) => { callable.mockRejectedValue(new Error(reason)); await expect(verifier()()).rejects.toBeInstanceOf(TeacherUnitsCompatibilityError); });
test.each(["sameUid", "school", "district", "dispose", "token"])("late response cannot authorize changed %s", async (kind) => {
  const previous = callable.getMockImplementation()!;
  callable.mockImplementation(async (req: unknown) => {
    if (kind === "sameUid") {
      listener?.(null);
      listener?.(user);
    }
    if (kind === "school")
      session = { ...session!, schoolId: "other" };
    if (kind === "district")
      token = { ...token, claims: { ...token.claims, districtId: "other" }, token: "new" };
    if (kind === "dispose")
      session = null;
    if (kind === "token") {
      listener?.(user);
      listener?.(user);
    }
    return previous(req);
  });
  await expect(verifier()()).rejects.toBeInstanceOf(TeacherUnitsCompatibilityError);
  expect(unsubscribe).toHaveBeenCalled();
});
test("bounded deadline rejects a delayed capability and never authorizes it later", async () => {
  jest.useFakeTimers();
  callable.mockImplementation(() => new Promise(() => { }));
  const pending = verifier()();
  const assertion = expect(pending).rejects.toBeInstanceOf(TeacherUnitsCompatibilityError);
  await jest.advanceTimersByTimeAsync(10001);
  await assertion;
  expect(unsubscribe).toHaveBeenCalled();
  jest.useRealTimers();
});
test("compatible capability is a declaration, not attestation of mutation revisions", () => { expect(() => parse(response())).not.toThrow(); /* No mutation revision exists in this response; A3 must enforce it. */ });

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
