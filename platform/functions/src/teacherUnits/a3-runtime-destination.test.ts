import { Firestore } from "@google-cloud/firestore";
import { grpc } from "google-gax";
import { OAuth2Client } from "google-auth-library";
import firestorePackage from "@google-cloud/firestore/package.json";
import gaxPackage from "google-gax/package.json";
import { getApp } from "firebase-admin/app";
import { getAdminFirestore } from "../shared/firestore/admin";
import { readRuntimeMetadata } from "./a3-runtime-metadata";
import { isResolvedRuntimeIdentity, resolveRuntimeIdentity } from "./a3-runtime-identity";
import type { ExpectedEnvironment } from "./a3-contracts";

jest.mock("firebase-admin/app", () => ({ getApp: jest.fn() }));
jest.mock("../shared/firestore/admin", () => ({ getAdminFirestore: jest.fn() }));
jest.mock("./a3-runtime-metadata", () => ({ readRuntimeMetadata: jest.fn() }));
const original = process.env;
let db: Firestore;
function cloud(projectId = "lyfelabz-staging", projectNumber = "293337283840", settings = {}) {
  process.env.K_SERVICE = "teacherunitscreate"; process.env.K_REVISION = "teacherunitscreate-00001-test";
  db = new Firestore({ projectId, ...settings });
  jest.mocked(getAdminFirestore).mockReturnValue(db);
  jest.mocked(getApp).mockReturnValue({ options: { projectId } } as any);
  jest.mocked(readRuntimeMetadata).mockImplementation(p => Promise.resolve({
    "project/project-id": projectId, "project/numeric-project-id": projectNumber,
    "instance/region": `projects/${projectNumber}/regions/us-central1`,
    "instance/service-accounts/default/email": `runtime@${projectId}.iam.gserviceaccount.com`,
  }[p]));
}
beforeEach(() => { process.env = {}; });
afterEach(async () => { if (db) await db.terminate(); process.env = original; jest.restoreAllMocks(); jest.clearAllMocks(); });
async function expectDestination(host: string, port: number, ssl: boolean) {
  const sdk = db as any;
  // The actual pool factory is used, not a parallel imitation of its options.
  for (const requiresGrpc of [false, true]) {
    const client = sdk._clientPool.clientFactory(requiresGrpc);
    try {
      expect(client._opts).toMatchObject({ servicePath: host, apiEndpoint: host, port, ssl,
        universeDomain: "googleapis.com", universe_domain: "googleapis.com", protocol: ssl ? "https" : "http" });
      expect(client._providedCustomServicePath).toBe(true);
      if (!client._opts.fallback) {
        const gax = client._gaxGrpc;
        // Execute installed GAX address/credential selection with local auth lookup
        // and a socket constructor seam. No RPC or token is requested.
        jest.spyOn(gax.auth, "getUniverseDomain").mockResolvedValue("googleapis.com");
        jest.spyOn(gax.auth, "getClient").mockResolvedValue(new OAuth2Client());
        const addresses: string[] = [];
        class Socket {
          constructor(address: string, credentials: grpc.ChannelCredentials, options: object) {
            addresses.push(address); expect(credentials._isSecure()).toBe(ssl);
            expect(options).toEqual({ "grpc.max_receive_message_length": -1, "grpc.max_send_message_length": -1, "grpc.initial_reconnect_backoff_ms": 1000 });
          }
        }
        await gax.createStub(Socket, client._opts, client._providedCustomServicePath);
        expect(addresses).toEqual([`${host}:${port}`]);
      }
    } finally { await client.close(); }
  }
}
test.each([["lyfelabz-prod", "182791689935"], ["lyfelabz-staging", "293337283840"]])("approved %s pins actual clients and repeated resolution", async (project, number) => {
  cloud(project, number);
  expect(await resolveRuntimeIdentity()).toMatchObject({ ok: true, available: false });
  await expectDestination("firestore.googleapis.com", 443, true);
  expect(await resolveRuntimeIdentity()).toMatchObject({ ok: true, available: false });
});
test.each(["before-construction", "before-resolution"])("original P2 universe substitution %s refuses", async when => {
  if (when === "before-construction") process.env.GOOGLE_CLOUD_UNIVERSE_DOMAIN = "attacker.invalid";
  cloud(); process.env.GOOGLE_CLOUD_UNIVERSE_DOMAIN = "attacker.invalid";
  const factory = jest.spyOn((db as any)._clientPool, "clientFactory");
  expect(await resolveRuntimeIdentity()).toEqual({ ok: false, reason: "runtime-identity-unavailable", available: false });
  expect(factory).not.toHaveBeenCalled();
});
test.each([undefined, "googleapis.com"])("missing or approved universe %s resolves", async universe => {
  if (universe !== undefined) process.env.GOOGLE_CLOUD_UNIVERSE_DOMAIN = universe;
  cloud(); expect((await resolveRuntimeIdentity()).ok).toBe(true);
  await expectDestination("firestore.googleapis.com", 443, true);
});
test.each(["", "GOOGLEAPIS.COM", "https://googleapis.com", "googleapis.com.", " googleapis.com", "null"])("malformed universe environment %s refuses", async universe => {
  process.env.GOOGLE_CLOUD_UNIVERSE_DOMAIN = universe; cloud();
  expect(await resolveRuntimeIdentity()).toMatchObject({ ok: false, available: false });
});
test.each(["universeDomain", "universe_domain"])("SDK option %s cannot substitute the universe", async key => {
  cloud("lyfelabz-staging", "293337283840", { [key]: "attacker.invalid" });
  expect(await resolveRuntimeIdentity()).toMatchObject({ ok: false, available: false });
});
test.each([null, "", 0, false])("malformed SDK universe %p refuses", async value => {
  cloud("lyfelabz-staging", "293337283840", { universeDomain: value });
  expect((await resolveRuntimeIdentity()).ok).toBe(false);
});
test("conflicting universe aliases refuse", async () => {
  cloud("lyfelabz-staging", "293337283840", { universeDomain: "googleapis.com", universe_domain: "attacker.invalid" });
  expect((await resolveRuntimeIdentity()).ok).toBe(false);
});
test.each([false, true])("late environment drift cannot redirect actual clients (preferRest=%s)", async preferRest => {
  cloud("lyfelabz-staging", "293337283840", { preferRest });
  const issued = await resolveRuntimeIdentity(); expect(issued).toMatchObject({ ok: true, available: false });
  process.env.GOOGLE_CLOUD_UNIVERSE_DOMAIN = "attacker.invalid";
  process.env.FIRESTORE_EMULATOR_HOST = "attacker.invalid:8080";
  process.env.GOOGLE_API_USE_MTLS_ENDPOINT = "always";
  await expectDestination("firestore.googleapis.com", 443, true);
  expect(() => db.settings({ host: "attacker.invalid:443" })).toThrow();
  expect(() => { (db as any)._settings.servicePath = "attacker.invalid"; }).toThrow();
  expect(() => { (db as any)._settings.universeDomain = "attacker.invalid"; }).toThrow();
  expect(() => { (db as any)._settings = {}; }).toThrow();
  expect(issued.available).toBe(false);
  expect((await resolveRuntimeIdentity()).ok).toBe(false);
});
test.each([{ host: "attacker.invalid:443" }, { servicePath: "attacker.invalid" },
  { apiEndpoint: "attacker.invalid" }, { servicePath: "firestore.googleapis.com", apiEndpoint: "attacker.invalid" },
  { port: 8080 }, { ssl: false }, { protocol: "http" }, { sslCreds: {} }, { grpc: {} }])("conflicting/unsupported transport %p refuses", async settings => {
  cloud("lyfelabz-staging", "293337283840", settings);
  expect(await resolveRuntimeIdentity()).toMatchObject({ ok: false, available: false });
});
test("an initialized unbound SDK refuses retrofit", async () => {
  cloud(); await (db as any).initializeIfNeeded("preexisting");
  expect((await resolveRuntimeIdentity()).ok).toBe(false);
});
test("unexpected pool shape cannot establish destination", async () => {
  cloud(); (db as any)._clientPool.activeClients = {};
  expect((await resolveRuntimeIdentity()).ok).toBe(false);
  (db as any)._clientPool.activeClients = new Map();
});
test.each(["127.0.0.1", "localhost", "[::1]", "127.1", "127.0.0.2", "[::ffff:127.0.0.1]"])("explicit emulator loopback %s", async host => {
  process.env = { FUNCTIONS_EMULATOR: "true", FIRESTORE_EMULATOR_HOST: `${host}:8080`, FIREBASE_AUTH_EMULATOR_HOST: `${host}:9099` };
  db = new Firestore({ projectId: "demo-bootstrap", preferRest: true });
  jest.mocked(getAdminFirestore).mockReturnValue(db);
  jest.mocked(getApp).mockReturnValue({ options: { projectId: "demo-bootstrap" } } as any);
  const profile: ExpectedEnvironment = { environment: "emulator", projectId: "demo-bootstrap", projectNumber: "0",
    localProfile: { fingerprint: "a".repeat(64), authOrigin: `http://${host}:9099`, firestoreHost: `${host}:8080`, functionsOrigin: `http://${host}:5001` } };
  const approved = ["127.0.0.1", "localhost", "[::1]"].includes(host);
  expect(await resolveRuntimeIdentity(profile)).toMatchObject({ ok: approved, available: false });
  if (approved) {
    process.env.GOOGLE_CLOUD_UNIVERSE_DOMAIN = "attacker.invalid";
    process.env.FIRESTORE_EMULATOR_HOST = "attacker.invalid:8080";
    await expectDestination(host, 8080, false);
  }
  expect(readRuntimeMetadata).not.toHaveBeenCalled();
});

async function issuedIdentity() {
  const result = await resolveRuntimeIdentity();
  if (!result.ok) throw new Error("identity unavailable");
  return result.identity;
}
async function selectedChannel(client: any) {
  const transport = client._gaxGrpc;
  transport.auth.getUniverseDomain = () => Promise.resolve("googleapis.com");
  transport.auth.getClient = () => Promise.resolve(new OAuth2Client());
  let observed: any;
  class Socket {
    constructor(address: string, credentials: grpc.ChannelCredentials, options: object) {
      observed = { address, secure: credentials._isSecure(), options };
    }
  }
  await transport.createStub(Socket, client._opts, true);
  return observed;
}
test.each(["before", "after"])("real donor pool replacement %s issuance refuses or is prevented", async timing => {
  cloud();
  const sdk = db as any, originalPool = sdk._clientPool;
  const identity = timing === "after" ? await issuedIdentity() : null;
  const donor = new Firestore({ projectId: "lyfelabz-staging", host: "attacker.invalid:443" });
  try {
    const changed = Reflect.set(sdk, "_clientPool", (donor as any)._clientPool);
    expect(changed).toBe(timing === "before");
    if (timing === "before") {
      expect((await resolveRuntimeIdentity()).ok).toBe(false);
      // No identity is issued even if the parent settings subsequently look approved.
      expect(sdk._settings.servicePath).toBe("firestore.googleapis.com");
    } else {
      expect(sdk._clientPool).toBe(originalPool);
      expect(isResolvedRuntimeIdentity(identity!)).toBe(true);
      expect((await resolveRuntimeIdentity()).ok).toBe(true);
      await expectDestination("firestore.googleapis.com", 443, true);
    }
  } finally { await donor.terminate(); }
});
test("approved-endpoint donor pool is still rejected before issuance", async () => {
  cloud();
  const donor = new Firestore({ projectId: "lyfelabz-staging", servicePath: "firestore.googleapis.com",
    apiEndpoint: "firestore.googleapis.com", port: 443, ssl: true, protocol: "https",
    universeDomain: "googleapis.com", universe_domain: "googleapis.com" });
  (db as any)._clientPool = (donor as any)._clientPool;
  expect((await resolveRuntimeIdentity()).ok).toBe(false);
  await donor.terminate();
});
test("factory references are protected and actual outputs remain bound", async () => {
  cloud(); await issuedIdentity();
  const pool = (db as any)._clientPool, factory = pool.clientFactory;
  expect(Reflect.set(pool, "clientFactory", () => { throw new Error("substituted"); })).toBe(false);
  expect(Reflect.deleteProperty(pool, "clientFactory")).toBe(false);
  expect(pool.clientFactory).toBe(factory);
  const client = factory(true);
  try { expect(await selectedChannel(client)).toMatchObject({ address: "firestore.googleapis.com:443", secure: true }); }
  finally { await client.close(); }
});
test.each(["sslCreds", "grpc", "grpc.ssl_target_name_override", "grpc.default_authority",
  "grpc.channelFactoryOverride", "grpc.grpc.ssl_target_name_override", "grpc-node.tls_enable_trace",
  "auth", "cert", "key", "fallback", "httpRules", "clientConfig"])("late %s settings injection is prevented", async key => {
  cloud(); const identity = await issuedIdentity();
  expect(Reflect.set((db as any)._settings, key, key === "sslCreds" ? grpc.credentials.createInsecure() : "attacker.invalid")).toBe(false);
  expect(isResolvedRuntimeIdentity(identity)).toBe(true);
  const client = (db as any)._clientPool.clientFactory(true);
  try { expect(await selectedChannel(client)).toMatchObject({ address: "firestore.googleapis.com:443", secure: true }); }
  finally { await client.close(); }
});
test.each(["servicePath", "port", "protocol", "universeDomain", "sslCreds", "grpc.ssl_target_name_override", "grpc.default_authority"])("%s mutation after GAPIC construction cannot change actual lazy creation", async key => {
  cloud(); await issuedIdentity();
  const client = (db as any)._clientPool.clientFactory(true);
  try {
    expect(Reflect.set(client._opts, key, key === "sslCreds" ? grpc.credentials.createInsecure() : "attacker.invalid")).toBe(false);
    expect(Reflect.set(client, "_opts", { servicePath: "attacker.invalid" })).toBe(false);
    expect(Reflect.set(client, "_providedCustomServicePath", false)).toBe(false);
    expect(Reflect.set(client._gaxGrpc, "createStub", () => Promise.resolve({}))).toBe(false);
    expect(await selectedChannel(client)).toMatchObject({ address: "firestore.googleapis.com:443", secure: true });
  } finally { await client.close(); }
});
test("unverifiable GAX credential selection refuses before socket creation and invalidates identity", async () => {
  cloud(); const identity = await issuedIdentity();
  const client = (db as any)._clientPool.clientFactory(true);
  const transport = client._gaxGrpc;
  const insecureSelected = jest.fn();
  // Change during GAX's await, after the initial integrity check. The actual
  // GAX selector returns real insecure credentials; the final boundary refuses.
  transport.auth.getUniverseDomain = () => {
    transport._getCredentials = () => {
      const credentials = grpc.credentials.createInsecure();
      insecureSelected(credentials._isSecure()); return Promise.resolve(credentials);
    };
    return Promise.resolve("googleapis.com");
  };
  const socket = jest.fn();
  await expect(transport.createStub(socket, client._opts, true)).rejects.toThrow();
  expect(socket).not.toHaveBeenCalled();
  expect(insecureSelected).toHaveBeenCalledWith(false);
  expect(isResolvedRuntimeIdentity(identity)).toBe(false);
  expect((await resolveRuntimeIdentity()).ok).toBe(false);
  expect(() => (db as any)._clientPool.clientFactory(true)).toThrow();
  await client.close();
});
test("foreign pooled GAPIC invalidates old identity and refuses further creation", async () => {
  cloud(); const identity = await issuedIdentity();
  const donor = new Firestore({ projectId: "lyfelabz-staging", host: "attacker.invalid:443" });
  const client = (donor as any)._clientPool.clientFactory(true), pool = (db as any)._clientPool;
  pool.activeClients.set(client, { grpcEnabled: true, activeRequestCount: 0 });
  expect(isResolvedRuntimeIdentity(identity)).toBe(false);
  expect((await resolveRuntimeIdentity()).ok).toBe(false);
  expect(() => pool.clientFactory(true)).toThrow();
  pool.activeClients.delete(client);
  expect(isResolvedRuntimeIdentity(identity)).toBe(false); // invalidation is permanent
  await client.close(); await donor.terminate();
});
test.each([false, true])("pool churn and REST-to-gRPC transition keep real factory enforcement (preferRest=%s)", async preferRest => {
  cloud("lyfelabz-staging", "293337283840", { preferRest, maxIdleChannels: 0 });
  const identity = await issuedIdentity(), pool = (db as any)._clientPool, factory = pool.clientFactory;
  const transports: unknown[] = [];
  for (const required of [false, true, false]) {
    await pool.run("local-only", required, async (client: any) => {
      transports.push(client._opts.fallback);
      if (!client._opts.fallback) expect(await selectedChannel(client)).toMatchObject({ secure: true, address: "firestore.googleapis.com:443" });
      return null;
    });
    expect(pool.activeClients.size).toBe(0);
    expect(pool.clientFactory).toBe(factory);
    expect(isResolvedRuntimeIdentity(identity)).toBe(true);
  }
  expect(transports).toEqual([preferRest ? "rest" : false, false, false]);
});
test.each(["127.0.0.1", "[::1]"])("%s emulator supports repeated initialization and actual REST/gRPC creation", async host => {
  process.env = { FUNCTIONS_EMULATOR: "true", FIRESTORE_EMULATOR_HOST: `${host}:8080`, FIREBASE_AUTH_EMULATOR_HOST: `${host}:9099` };
  db = new Firestore({ projectId: "demo-bootstrap", preferRest: true });
  jest.mocked(getAdminFirestore).mockReturnValue(db);
  jest.mocked(getApp).mockReturnValue({ options: { projectId: "demo-bootstrap" } } as any);
  const profile: ExpectedEnvironment = { environment: "emulator", projectId: "demo-bootstrap", projectNumber: "0",
    localProfile: { fingerprint: "a".repeat(64), authOrigin: `http://${host}:9099`, firestoreHost: `${host}:8080`, functionsOrigin: `http://${host}:5001` } };
  for (let count = 0; count < 3; count++) {
    expect((await resolveRuntimeIdentity(profile)).ok).toBe(true);
    expect((db as any)._settings.customHeaders.Authorization).toBe("Bearer owner");
    await expectDestination(host, 8080, false);
    const rest = (db as any)._clientPool.clientFactory(false);
    rest._gaxGrpc.auth.getClient = () => Promise.resolve(new OAuth2Client());
    try { expect(await rest.initialize()).toHaveProperty("getDocument"); }
    finally { await rest.close(); }
  }
});
test.each([firestorePackage, gaxPackage])("unsupported SDK version refuses", async pkg => {
  cloud(); const originalVersion = pkg.version;
  try { pkg.version = "unsupported"; expect((await resolveRuntimeIdentity()).ok).toBe(false); }
  finally { pkg.version = originalVersion; }
});
test.each([["lyfelabz-prod", "182791689935"], ["lyfelabz-staging", "293337283840"]])("actual lazy gRPC initialize and cached reuse for %s", async (project, number) => {
  cloud(project, number); const identity = await issuedIdentity();
  const pool = (db as any)._clientPool, client = pool.acquire("local-only", true);
  client._gaxGrpc.auth.getUniverseDomain = () => Promise.resolve("googleapis.com");
  client._gaxGrpc.auth.getClient = () => Promise.resolve(new OAuth2Client());
  const selected = jest.fn();
  class NoSocket {
    close = jest.fn();
    constructor(address: string, credentials: grpc.ChannelCredentials, options: object) {
      selected({ address, secure: credentials._isSecure(), options });
      for (const method of Object.keys(client._defaults)) (this as any)[method] = jest.fn();
    }
  }
  // Replace only the socket constructor; the real GAPIC initialize and GAX
  // option/credential selection execute unchanged without document methods.
  client._protos.google.firestore.v1.Firestore = NoSocket;
  const pending = client.initialize(); await pending;
  expect(client.initialize()).toBe(pending);
  expect(selected).toHaveBeenCalledTimes(1);
  expect(selected).toHaveBeenCalledWith(expect.objectContaining({ address: "firestore.googleapis.com:443", secure: true }));
  expect(isResolvedRuntimeIdentity(identity)).toBe(true);
  await pool.release("local-only", client);
  const reused = pool.acquire("reuse", true); expect(reused).toBe(client);
  expect(reused.initialize()).toBe(pending);
  const originalStub = client.firestoreStub;
  client.firestoreStub = Promise.resolve({ close: jest.fn() });
  expect(isResolvedRuntimeIdentity(identity)).toBe(false);
  expect(() => pool.acquire("foreign-stub", true)).toThrow();
  expect(() => client.initialize()).toThrow();
  client.firestoreStub = originalStub;
  await pool.release("reuse", client);
});
test("ordinary transient credential failure can retry without binding revocation", async () => {
  cloud(); const identity = await issuedIdentity(), client = (db as any)._clientPool.clientFactory(true);
  client._gaxGrpc.auth.getUniverseDomain = () => Promise.resolve("googleapis.com");
  client._gaxGrpc.auth.getClient = () => Promise.reject(new Error("local transient failure"));
  await expect(client._gaxGrpc.createStub(jest.fn(), client._opts, true)).rejects.toThrow("local transient failure");
  expect(isResolvedRuntimeIdentity(identity)).toBe(true);
  expect(await selectedChannel(client)).toMatchObject({ address: "firestore.googleapis.com:443", secure: true });
  await client.close();
});
test("nested credential settings are copied and immutable", async () => {
  const credentials = { client_email: "test@lyfelabz-staging.iam.gserviceaccount.com", private_key: "synthetic-not-used" };
  cloud("lyfelabz-staging", "293337283840", { credentials }); await issuedIdentity();
  credentials.client_email = "different@example.invalid";
  expect((db as any)._settings.credentials.client_email).toBe("test@lyfelabz-staging.iam.gserviceaccount.com");
  expect(Reflect.set((db as any)._settings.credentials, "private_key", "changed")).toBe(false);
});
test("actual GAX destination rewriting is checked at the final constructor", async () => {
  cloud(); const identity = await issuedIdentity(), client = (db as any)._clientPool.clientFactory(true);
  client._gaxGrpc.auth.getUniverseDomain = () => Promise.resolve("googleapis.com");
  client._gaxGrpc.auth.getClient = () => Promise.resolve(new OAuth2Client());
  client._gaxGrpc._mtlsServicePath = () => "attacker.invalid";
  const socket = jest.fn();
  await expect(client._gaxGrpc.createStub(socket, client._opts, true)).rejects.toThrow();
  expect(socket).not.toHaveBeenCalled();
  expect(isResolvedRuntimeIdentity(identity)).toBe(false);
  await client.close();
});
test("unsupported transitive gRPC version refuses actual factory output", async () => {
  cloud();
  const original = (db as any)._clientPool.clientFactory;
  (db as any)._clientPool.clientFactory = (forced: boolean) => {
    const client = original(forced); client._gaxGrpc.grpcVersion = "unsupported"; return client;
  };
  expect((await resolveRuntimeIdentity()).ok).toBe(false);
});
test("late certificate-discovery environment cannot change the TLS profile", async () => {
  cloud(); await issuedIdentity();
  process.env.GOOGLE_API_USE_CLIENT_CERTIFICATE = "true";
  process.env.GOOGLE_API_USE_MTLS_ENDPOINT = "always";
  const client = (db as any)._clientPool.clientFactory(true);
  expect(await client._gaxGrpc._detectClientCertificate(client._opts, "googleapis.com")).toEqual([undefined, undefined]);
  expect(Reflect.set(client._gaxGrpc, "_detectClientCertificate", () => Promise.resolve(["cert", "key"]))).toBe(false);
  expect(await selectedChannel(client)).toMatchObject({ address: "firestore.googleapis.com:443", secure: true });
  await client.close();
});
test.each([{ preferRest: "true" }, { keyFilename: 7 }])("unsupported connection setting type %p refuses", async settings => {
  cloud("lyfelabz-staging", "293337283840", settings);
  expect((await resolveRuntimeIdentity()).ok).toBe(false);
});
