/** Inert pre-read identity foundation; never authorizes Teacher Units. */
import { getApp } from "firebase-admin/app";
import { Firestore } from "@google-cloud/firestore";
import { GrpcClient, fallback, grpc } from "google-gax";
import firestorePackage from "@google-cloud/firestore/package.json";
import gaxPackage from "google-gax/package.json";
import { getAdminFirestore } from "../shared/firestore/admin";
import type { ExpectedEnvironment } from "./a3-contracts";
import { canonicalJSON, parseStrictJSON } from "./a3-canonical";
import { digest, literal, object, pattern, plainRecord, text } from "./a3-protocol";
import { readRuntimeMetadata } from "./a3-runtime-metadata";
export type RuntimeIdentity = Readonly<ExpectedEnvironment & {
  region: "us-central1"; databaseId: "(default)";
  source: "execution-metadata" | "explicit-local-profile";
  serviceAccountEmail: string | null; service: string | null; revision: string | null;
}>;
export type RuntimeIdentityResult = { ok: true; identity: RuntimeIdentity; available: false } |
  { ok: false; reason: "runtime-identity-unavailable"; available: false };
type Options = Record<string | symbol, unknown>;
type StubConstructor = new (address: string, credentials: grpc.ChannelCredentials, options: Record<string, unknown>) => object;
type Transport = {
  createStub: (stub: unknown, options: Options, customServicePath: boolean) => Promise<unknown>;
  auth: unknown; grpc?: unknown; grpcVersion: string;
  _getCredentials?: unknown; _detectClientCertificate?: unknown;
};
type Auxiliary = {
  _opts: Options; _providedCustomServicePath: boolean; gaxGrpc: Transport;
  locationsStub?: Promise<{ close: () => void }>; _terminated: boolean;
  initialize: () => Promise<unknown>; close: () => Promise<void>;
};
type Gapic = {
  _opts: Options; _providedCustomServicePath: boolean; _gaxGrpc: Transport;
  _terminated: boolean; firestoreStub?: Promise<unknown>; locationsClient: Auxiliary;
  initialize: () => Promise<unknown>; close: () => Promise<void>;
};
type Pool = {
  activeClients: Map<Gapic, unknown>; terminated: boolean;
  clientFactory: (requiresGrpc: boolean) => Gapic;
  acquire: (requestTag: string, requiresGrpc: boolean) => Gapic;
};
type DestinationAdapter = { _settings: Options; _settingsFrozen: boolean; _clientPool: Pool };
type ClientBinding = {
  options: Options; transport: Transport; createStub: Transport["createStub"];
  auth: unknown; grpc: unknown; grpcVersion: string; getCredentials: unknown; detectCertificate: unknown;
  initialize: Gapic["initialize"]; auxiliary: Auxiliary; auxiliaryOptions: Options;
  auxiliaryInitialize: Auxiliary["initialize"]; auxiliaryClose: Auxiliary["close"]; stubs: WeakSet<object>;
};
type DestinationBinding = {
  db: Firestore; adapter: DestinationAdapter; pool: Pool; activeClients: Pool["activeClients"];
  settings: Options; settingsSnapshot: Options; marker: symbol; markerValue: object; pins: Options;
  projectId: string | null; databaseId: string | null;
  factory: Pool["clientFactory"]; acquire: Pool["acquire"]; clients: WeakMap<Gapic, ClientBinding>; invalid: boolean;
};
const verified = new WeakMap<object, DestinationBinding>();
const destinations = new WeakMap<Firestore, DestinationBinding>();
export function isResolvedRuntimeIdentity(value: RuntimeIdentity): boolean {
  const binding = verified.get(value);
  if (!binding) return false;
  try {
    assertBinding(binding);
    const sdk = binding.db as unknown as { projectId: unknown; databaseId: unknown };
    if (getAdminFirestore() !== binding.db || sdk.projectId !== value.projectId || sdk.databaseId !== value.databaseId) invalidate(binding);
    return true;
  } catch { binding.invalid = true; return false; }
}
const fail = (): never => { throw new Error("Runtime identity unavailable"); };
function agrees(value: unknown, expected: string | number | boolean): void { if (value !== undefined && value !== expected) fail(); }
function required(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) return fail(); return value;
}
function loopback(value: string, origin: boolean): void {
  const url = new URL(origin ? value : `http://${value}`);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      (origin ? url.origin !== value : url.host !== value)) fail();
}
function lock(target: object, key: string | symbol, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: false, configurable: false });
}
function invalidate(binding: DestinationBinding): never { binding.invalid = true; return fail(); }
function sameOptions(actual: Options, expected: Options, mutableHeaders = false): boolean {
  const keys = Reflect.ownKeys(actual);
  return keys.length === Reflect.ownKeys(expected).length && keys.every(key =>
    Object.hasOwn(expected, key) && ((mutableHeaders && key === "customHeaders") || actual[key] === expected[key]));
}
function assertClient(binding: DestinationBinding, client: Gapic): void {
  const proof = binding.clients.get(client);
  if (!proof || client._terminated || client._opts !== proof.options ||
      client._providedCustomServicePath !== true || client._gaxGrpc !== proof.transport ||
      proof.transport.createStub !== proof.createStub || proof.transport.auth !== proof.auth || proof.transport.grpc !== proof.grpc || proof.transport.grpcVersion !== proof.grpcVersion ||
      proof.transport._getCredentials !== proof.getCredentials || proof.transport._detectClientCertificate !== proof.detectCertificate ||
      client.initialize !== proof.initialize || client.locationsClient !== proof.auxiliary ||
      proof.auxiliary._opts !== proof.auxiliaryOptions || proof.auxiliary.gaxGrpc !== proof.transport ||
      proof.auxiliary._providedCustomServicePath !== true || proof.auxiliary.initialize !== proof.auxiliaryInitialize ||
      proof.auxiliary.close !== proof.auxiliaryClose ||
      (client.firestoreStub !== undefined && !proof.stubs.has(client.firestoreStub)) ||
      (proof.auxiliary.locationsStub !== undefined && !proof.stubs.has(proof.auxiliary.locationsStub))) invalidate(binding);
}
function assertBinding(binding: DestinationBinding): void {
  if (firestorePackage.version !== "7.11.6" || gaxPackage.version !== "4.6.1" || binding.invalid || binding.adapter._settings !== binding.settings || binding.adapter._clientPool !== binding.pool ||
      binding.pool.clientFactory !== binding.factory || binding.pool.acquire !== binding.acquire || binding.pool.terminated || binding.pool.activeClients !== binding.activeClients ||
      !sameOptions(binding.settings, binding.settingsSnapshot, true)) invalidate(binding);
  if (binding.projectId !== null) {
    const sdk = binding.db as unknown as { projectId: unknown; databaseId: unknown };
    if (sdk.projectId !== binding.projectId || sdk.databaseId !== binding.databaseId) invalidate(binding);
  }
  for (const client of binding.activeClients.keys()) assertClient(binding, client);
}
// Closed configuration: no auth/transport implementations, certificate selectors,
// fallback overrides, GAPIC config, or arbitrary gRPC/GAX namespaces are forwarded.
const settingsKeys = new Set(["projectId", "databaseId", "credentials", "keyFilename", "host", "port", "ssl",
  "maxIdleChannels", "useBigInt", "ignoreUndefinedProperties", "preferRest", "openTelemetry",
  "firebaseVersion", "firebaseAdminVersion", "libName", "libVersion", "toJSON", "customHeaders",
  "servicePath", "apiEndpoint", "universeDomain", "universe_domain", "protocol"]);
function approvedSettings(settings: Options): void {
  for (const key of ["preferRest", "useBigInt", "ignoreUndefinedProperties"]) {
    if (settings[key] !== undefined && typeof settings[key] !== "boolean") fail();
  }
  if (settings.keyFilename !== undefined && (typeof settings.keyFilename !== "string" || !settings.keyFilename)) fail();
  for (const key of Reflect.ownKeys(settings)) {
    const descriptor = Object.getOwnPropertyDescriptor(settings, key);
    if (typeof key !== "string" || !settingsKeys.has(key) || !descriptor || !("value" in descriptor)) fail();
  }
}
function validateFactoryOptions(binding: DestinationBinding, client: Gapic, requiresGrpc: boolean): void {
  const options = client._opts;
  if (!options || client._providedCustomServicePath !== true || options[binding.marker] !== binding.markerValue ||
      options.fallback !== (binding.settings.preferRest && !requiresGrpc ? "rest" : false)) invalidate(binding);
  for (const [key, value] of Object.entries(binding.pins)) if (options[key] !== value) invalidate(binding);
  for (const key of Reflect.ownKeys(binding.settingsSnapshot)) {
    if (key !== "customHeaders" && options[key] !== binding.settingsSnapshot[key]) invalidate(binding);
  }
  const generated = new Set(["fallback", "clientConfig", "numericEnums", "scopes", "sslCreds"]);
  for (const key of Reflect.ownKeys(options)) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!descriptor || !("value" in descriptor) ||
        (key !== binding.marker && (typeof key !== "string" || (!settingsKeys.has(key) && !generated.has(key))))) invalidate(binding);
  }
  if (options.numericEnums !== true || !options.clientConfig || typeof options.clientConfig !== "object" ||
      Reflect.ownKeys(options.clientConfig).length !== 0) invalidate(binding);
  if (binding.pins.ssl) {
    if (options.sslCreds !== undefined) invalidate(binding);
  } else if (!(options.sslCreds instanceof grpc.ChannelCredentials) || options.sslCreds._isSecure()) invalidate(binding);
}
function immutableOptions(options: Options): Options {
  const scopeOptions: { scopes?: readonly string[] } = {};
  if (options.scopes !== undefined) {
    if (!Array.isArray(options.scopes)) return fail();
    const scopes: string[] = [];
    for (const value of options.scopes as unknown[]) {
      if (typeof value !== "string") return fail();
      scopes.push(value);
    }
    scopeOptions.scopes = Object.freeze(scopes);
  }
  return Object.freeze({ ...options, clientConfig: Object.freeze({}), ...scopeOptions });
}
function credentialSnapshot(value: unknown): Readonly<Record<string, string>> {
  const input = plainRecord(value, "$.credentials"), result: Record<string, string> = {};
  for (const key of Object.keys(input)) {
    const field = input[key];
    if (!["client_email", "private_key"].includes(key) || typeof field !== "string" || !field) return fail();
    result[key] = field;
  }
  return Object.freeze(result);
}
/** Guard the actual factory output and actual GAX createStub invocation. Immutable
 * options are defense in depth; the final gRPC constructor also checks the address,
 * real ChannelCredentials and channel arguments after GAX's asynchronous selection. */
function guardClient(binding: DestinationBinding, client: Gapic, requiresGrpc: boolean): Gapic {
  validateFactoryOptions(binding, client, requiresGrpc);
  const transport = client._gaxGrpc;
  const rest = client._opts.fallback === "rest";
  if (!(transport instanceof (rest ? fallback.GrpcClient : GrpcClient)) ||
      transport.grpcVersion !== (rest ? "4.6.1" : "1.14.4") || (!rest && transport.grpc !== grpc)) invalidate(binding);
  const auxiliary = client.locationsClient;
  if (!auxiliary || auxiliary.gaxGrpc !== transport) invalidate(binding);
  validateFactoryOptions(binding, { ...client, _opts: auxiliary._opts, _providedCustomServicePath: auxiliary._providedCustomServicePath }, requiresGrpc);
  const options = immutableOptions(client._opts);
  const auxiliaryOptions = immutableOptions(auxiliary._opts);
  const stubs = new WeakSet<object>();
  // Approved cloud TLS uses default channel credentials. Do not let late
  // environment-driven certificate discovery introduce a new mTLS profile.
  if (!rest) lock(transport, "_detectClientCertificate", () => Promise.resolve([undefined, undefined]));
  const create = transport.createStub.bind(transport);
  const guarded: Transport["createStub"] = (stub, supplied, custom) => {
    const pending = (async () => {
      try {
        assertBinding(binding); assertClient(binding, client);
        if ((supplied !== options && supplied !== auxiliaryOptions) || custom !== true) invalidate(binding);
        if (rest) {
          // Fallback closes over protocol/host/port from this immutable options object.
          const result = await create(stub, supplied, true);
          assertBinding(binding); assertClient(binding, client);
          return result;
        }
        if (typeof stub !== "function") invalidate(binding);
        const Constructor = stub as StubConstructor;
        class GuardedStub {
          constructor(address: string, credentials: grpc.ChannelCredentials, channelOptions: Record<string, unknown>) {
            assertBinding(binding); assertClient(binding, client);
            const defaults: Record<string, unknown> = { "grpc.max_receive_message_length": -1,
              "grpc.max_send_message_length": -1, "grpc.initial_reconnect_backoff_ms": 1000 };
            if (address !== `${String(binding.pins.servicePath)}:${String(binding.pins.port)}` ||
                !(credentials instanceof grpc.ChannelCredentials) || credentials._isSecure() !== binding.pins.ssl ||
                !sameOptions(channelOptions, defaults)) invalidate(binding);
            return new Constructor(address, credentials, channelOptions);
          }
        }
        return await create(GuardedStub, supplied, true);
      } catch (error) {
        // An ordinary auth/stub failure can be retried. Integrity failures revoke
        // the binding through assertBinding/assertClient/invalidate instead.
        assertBinding(binding); assertClient(binding, client); throw error;
      }
    })();
    stubs.add(pending); return pending;
  };
  const initialize = client.initialize.bind(client), auxiliaryInit = auxiliary.initialize.bind(auxiliary);
  const guardedInitialize = () => { assertBinding(binding); assertClient(binding, client); return initialize(); };
  const guardedAuxiliaryInitialize = () => { assertBinding(binding); assertClient(binding, client); return auxiliaryInit(); };
  // Installed LocationsClient.close() otherwise initializes an unused auxiliary
  // channel, even after its parent has closed. Close existing stubs only; there
  // is nothing to clean up when no stub has been created.
  const auxiliaryClose = (): Promise<void> => auxiliary.locationsStub && !auxiliary._terminated ? auxiliary.locationsStub.then(stub => {
    auxiliary._terminated = true; stub.close();
  }) : Promise.resolve();
  lock(auxiliary, "_opts", auxiliaryOptions); lock(auxiliary, "_providedCustomServicePath", true);
  lock(auxiliary, "gaxGrpc", transport); lock(auxiliary, "initialize", guardedAuxiliaryInitialize);
  lock(auxiliary, "close", auxiliaryClose); lock(client, "locationsClient", auxiliary);
  lock(client, "initialize", guardedInitialize);
  lock(client, "_opts", options); lock(client, "_providedCustomServicePath", true); lock(client, "_gaxGrpc", transport);
  lock(transport, "createStub", guarded);
  binding.clients.set(client, { options, transport, createStub: guarded, auth: transport.auth, grpc: transport.grpc, grpcVersion: transport.grpcVersion,
    getCredentials: transport._getCredentials, detectCertificate: transport._detectClientCertificate,
    initialize: guardedInitialize, auxiliary, auxiliaryOptions, auxiliaryInitialize: guardedAuxiliaryInitialize,
    auxiliaryClose, stubs });
  return client;
}
/** Installed SDK adapter. The unique settings marker proves that the original
 * factory captures this Firestore object, including when a donor pool was substituted
 * before binding. No channel/credential/RPC initialization occurs during issuance. */
async function bindDestination(db: Firestore, host: string, port: number, ssl: boolean): Promise<DestinationBinding> {
  const existing = destinations.get(db);
  try {
    agrees(process.env.GOOGLE_CLOUD_UNIVERSE_DOMAIN, "googleapis.com");
    if (firestorePackage.version !== "7.11.6" || gaxPackage.version !== "4.6.1" || !(db instanceof Firestore)) fail();
    const adapter = db as unknown as DestinationAdapter, settings = adapter._settings, pool = adapter._clientPool;
    if (existing) {
      assertBinding(existing);
      if (existing.pins.servicePath !== host || existing.pins.port !== port || existing.pins.ssl !== ssl) invalidate(existing);
      return existing;
    }
    if (!settings || !pool || !(pool.activeClients instanceof Map) || pool.terminated || typeof pool.clientFactory !== "function" || typeof pool.acquire !== "function") fail();
    approvedSettings(settings);
    for (const key of ["universeDomain", "universe_domain"]) agrees(settings[key], "googleapis.com");
    for (const key of ["host", "servicePath", "apiEndpoint"]) agrees(settings[key], host);
    agrees(settings.port, port); agrees(settings.ssl, ssl); agrees(settings.protocol, ssl ? "https" : "http");
    if (adapter._settingsFrozen !== false || pool.activeClients.size !== 0) fail();
    const pins = Object.freeze({ universeDomain: "googleapis.com", universe_domain: "googleapis.com",
      servicePath: host, apiEndpoint: host, port, ssl, protocol: ssl ? "https" : "http" });
    db.settings({ ...settings, ...pins,
      ...(settings.credentials !== undefined ? { credentials: credentialSnapshot(settings.credentials) } : {}) });
    const bound = adapter._settings;
    // Emulator initialization replaces customHeaders on every invocation.
    bound.customHeaders ??= undefined;
    const marker = Symbol("a3-destination-binding");
    const binding: DestinationBinding = { db, adapter, pool, activeClients: pool.activeClients, settings: bound,
      settingsSnapshot: {}, marker, markerValue: Object.freeze({}), pins, projectId: null, databaseId: null, factory: pool.clientFactory, acquire: pool.acquire, clients: new WeakMap(), invalid: false };
    lock(bound, marker, binding.markerValue);
    for (const [key, value] of Object.entries(pins)) {
      if (bound[key] !== value && !(key === "apiEndpoint" && bound[key] === undefined)) invalidate(binding);
      lock(bound, key, value);
    }
    // Freeze only fixed settings slots. Leave customHeaders writable for the SDK.
    for (const key of Object.keys(bound)) if (key !== "customHeaders") lock(bound, key, bound[key]);
    Object.preventExtensions(bound);
    binding.settingsSnapshot = Object.freeze({ ...bound });
    lock(db, "_settings", bound); lock(db, "_clientPool", pool);
    const originalFactory = pool.clientFactory.bind(pool);
    binding.factory = (requiresGrpc: boolean) => {
      try { assertBinding(binding); return guardClient(binding, originalFactory(requiresGrpc), requiresGrpc); }
      catch (error) { binding.invalid = true; throw error; }
    };
    lock(pool, "clientFactory", binding.factory);
    const acquire = pool.acquire.bind(pool);
    binding.acquire = (requestTag, requiresGrpc) => {
      assertBinding(binding);
      const client = acquire(requestTag, requiresGrpc);
      assertClient(binding, client); return client;
    };
    lock(pool, "acquire", binding.acquire);
    destinations.set(db, binding);
    for (const requiresGrpc of [false, true]) {
      const client = pool.clientFactory(requiresGrpc);
      try { assertClient(binding, client); } finally { await client.close(); }
    }
    assertBinding(binding);
    agrees(process.env.GOOGLE_CLOUD_UNIVERSE_DOMAIN, "googleapis.com");
    return binding;
  } catch (error) { if (existing) existing.invalid = true; throw error; }
}
/** Firestore 7.11 adapter: initialization resolves credentials/project, no tenant RPC.
 * Unknown SDK shapes refuse; installed SDK behavior is exercised in tests. */
export async function resolveRuntimeIdentity(emulatorProfile?: ExpectedEnvironment): Promise<RuntimeIdentityResult> {
  try {
    const env = process.env;
    agrees(env.GOOGLE_CLOUD_UNIVERSE_DOMAIN, "googleapis.com");
    if (env.FUNCTIONS_EMULATOR !== undefined && !["true", "false"].includes(env.FUNCTIONS_EMULATOR)) fail();
    const local = env.FUNCTIONS_EMULATOR === "true";
    let binding: ExpectedEnvironment, account: string | null = null, service: string | null = null, revision: string | null = null;
    if (local) {
      if (!emulatorProfile) return fail();
      object({ environment: literal("emulator"), projectId: pattern(/^[a-z][a-z0-9-]*$/), projectNumber: literal("0"),
        localProfile: object({ fingerprint: digest, authOrigin: text, firestoreHost: text, functionsOrigin: text }) })(emulatorProfile, "$");
      if (env.K_SERVICE !== undefined || env.K_REVISION !== undefined) fail();
      // Clone with strict canonical ingestion so nested mutations cannot persist.
      binding = parseStrictJSON(canonicalJSON(emulatorProfile)) as ExpectedEnvironment;
      required(binding.projectId, /^[a-z][a-z0-9-]*$/);
      const profile = binding.localProfile;
      if (!profile) return fail();
      required(profile.fingerprint, /^[a-f0-9]{64}$/);
      loopback(profile.authOrigin, true); loopback(profile.firestoreHost, false); loopback(profile.functionsOrigin, true);
      if (env.FIRESTORE_EMULATOR_HOST !== profile.firestoreHost || env.FIREBASE_AUTH_EMULATOR_HOST !== new URL(profile.authOrigin).host) fail();
      Object.freeze(profile);
    } else {
      if (emulatorProfile !== undefined || env.FIRESTORE_EMULATOR_HOST !== undefined || env.FIREBASE_AUTH_EMULATOR_HOST !== undefined) fail();
      const [projectId, projectNumber, region, email] = await Promise.all([
        readRuntimeMetadata("project/project-id"), readRuntimeMetadata("project/numeric-project-id"),
        readRuntimeMetadata("instance/region"), readRuntimeMetadata("instance/service-accounts/default/email"),
      ]);
      if (projectId === "lyfelabz-prod" && projectNumber === "182791689935") binding = { environment: "production", projectId, projectNumber };
      else if (projectId === "lyfelabz-staging" && projectNumber === "293337283840") binding = { environment: "staging", projectId, projectNumber };
      else return fail();
      if (region !== `projects/${projectNumber}/regions/us-central1`) fail();
      account = required(email, /^[A-Za-z0-9_.-]+@[a-z0-9.-]+\.gserviceaccount\.com$/);
      service = required(env.K_SERVICE, /^[a-z][a-z0-9-]*$/);
      revision = required(env.K_REVISION, /^[a-z][a-z0-9-]*$/);
      if (!revision.startsWith(`${service}-`)) fail();
    }
    agrees(env.GCLOUD_PROJECT, binding.projectId); agrees(env.GOOGLE_CLOUD_PROJECT, binding.projectId);
    agrees(env.FUNCTION_REGION, "us-central1");
    if (env.FIREBASE_CONFIG !== undefined) agrees(plainRecord(parseStrictJSON(env.FIREBASE_CONFIG), "$").projectId ?? null, binding.projectId);
    const db = getAdminFirestore();
    const adapter = db as unknown as { initializeIfNeeded?: (tag: string) => Promise<void>; projectId?: unknown; databaseId?: unknown; _settings?: { servicePath?: unknown; apiEndpoint?: unknown; port?: unknown; ssl?: unknown } };
    if (typeof adapter.initializeIfNeeded !== "function") return fail();
    const destination = local ? new URL(`http://${binding.localProfile?.firestoreHost}`) : null;
    const transportBinding = await bindDestination(db, destination?.hostname ?? "firestore.googleapis.com", destination ? Number(destination.port) : 443, !local);
    await adapter.initializeIfNeeded("teacher-units-a3-runtime-identity");
    if (adapter.projectId !== binding.projectId || adapter.databaseId !== "(default)" || getApp().options.projectId !== binding.projectId) fail();
    if (local) {
      if (!destination || adapter._settings?.servicePath !== destination.hostname || adapter._settings?.port !== Number(destination.port) || adapter._settings?.ssl !== false) fail();
    } else {
      const settings = adapter._settings;
      if (!settings || settings.ssl === false || (settings.port !== undefined && settings.port !== 443) ||
          [settings.servicePath, settings.apiEndpoint].some(host => host !== undefined && host !== "firestore.googleapis.com")) fail();
    }
    const identity: RuntimeIdentity = Object.freeze({ ...binding, region: "us-central1", databaseId: "(default)",
      source: local ? "explicit-local-profile" : "execution-metadata", serviceAccountEmail: account, service, revision });
    transportBinding.projectId = binding.projectId; transportBinding.databaseId = "(default)";
    assertBinding(transportBinding);
    verified.set(identity, transportBinding);
    return { ok: true, identity, available: false };
  } catch { return { ok: false, reason: "runtime-identity-unavailable", available: false }; }
}
