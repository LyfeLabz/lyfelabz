// S9 regression: Teacher Units runtime identity must bind the shared Admin
// Firestore instance BEFORE any tenant read. The Student Support V2.1 teaching
// guard read Firestore first, froze the installed SDK's settings, and every
// Teacher Units callable then refused with runtimeIdentityUnavailable (503).
//
// This suite exercises the real exported callables, the real teaching guard,
// the real requireDistrictContext, the real A3 runtime identity binder and the
// real installed @google-cloud/firestore SDK (including its settings freeze in
// initializeIfNeeded). Only the network edges are replaced: the GCE metadata
// server and the Firestore RPC transport (requestStream/request).
import { readFileSync, readdirSync } from "node:fs";
import { Readable } from "node:stream";
import { Firestore } from "@google-cloud/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getAdminFirestore } from "../shared/firestore/admin";
import { readRuntimeMetadata } from "./a3-runtime-metadata";
import { teacherUnitsArchive } from "./teacher-units-archive";
import { teacherUnitsCapabilities } from "./teacher-units-capabilities";
import { teacherUnitsCreate } from "./teacher-units-create";
import { teacherUnitsGet } from "./teacher-units-get";
import { teacherUnitsList } from "./teacher-units-list";
import { teacherUnitsReorder } from "./teacher-units-reorder";
import { teacherUnitsRestore } from "./teacher-units-restore";
import { teacherUnitsSetResources } from "./teacher-units-set-resources";
import { teacherUnitsUpdate } from "./teacher-units-update";

jest.mock("firebase-admin/app", () => ({ ...jest.requireActual("firebase-admin/app"), getApp: jest.fn() }));
jest.mock("../shared/firestore/admin", () => ({ getAdminFirestore: jest.fn() }));
jest.mock("./a3-runtime-metadata", () => ({ readRuntimeMetadata: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getApp } = require("firebase-admin/app") as { getApp: jest.Mock };

const PROJECT = "lyfelabz-staging";
const NUMBER = "293337283840";
const ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const TX = Buffer.from("fake-transaction");
const TIME = { seconds: 1_800_000_000, nanos: 0 };

type Fields = Record<string, { stringValue: string } | { booleanValue: boolean }>;
type Store = Map<string, Fields>;
type Callable = { run: (request: CallableRequest<unknown>) => Promise<unknown> };

const ENDPOINTS: ReadonlyArray<[string, Callable]> = [
  ["teacherUnitsCreate", teacherUnitsCreate as unknown as Callable],
  ["teacherUnitsList", teacherUnitsList as unknown as Callable],
  ["teacherUnitsGet", teacherUnitsGet as unknown as Callable],
  ["teacherUnitsUpdate", teacherUnitsUpdate as unknown as Callable],
  ["teacherUnitsArchive", teacherUnitsArchive as unknown as Callable],
  ["teacherUnitsRestore", teacherUnitsRestore as unknown as Callable],
  ["teacherUnitsSetResources", teacherUnitsSetResources as unknown as Callable],
  ["teacherUnitsReorder", teacherUnitsReorder as unknown as Callable],
  ["teacherUnitsCapabilities", teacherUnitsCapabilities as unknown as Callable],
];

const fields = (record: Record<string, string>): Fields =>
  Object.fromEntries(Object.entries(record).map(([key, value]) => [key, { stringValue: value }]));
const proto = (name: string, data: Fields) => ({ name, fields: data, createTime: TIME, updateTime: TIME });

function seededStore(): Store {
  return new Map<string, Fields>([
    [`${ROOT}/users/teacher-1`, fields({ status: "active", role: "teacher", schoolId: "school-1" })],
    [`${ROOT}/users/teacher-2`, fields({ status: "active", role: "teacher", schoolId: "school-2" })],
    [`${ROOT}/users/student-1`, fields({ status: "active", role: "student", schoolId: "school-1" })],
    [`${ROOT}/schools/school-1`, fields({ districtId: "district-1" })],
    [`${ROOT}/schools/school-2`, fields({ districtId: "district-2" })],
    // Owned class: the real Student Support teaching guard admits the caller.
    [`${ROOT}/classes/class-1`, fields({ teacherId: "teacher-1" })],
  ]);
}

type Event = { kind: "identity-initialize" | "tenant-initialize" | "rpc"; detail: string };
let db: Firestore;
let events: Event[];
let databases: Firestore[];

/** Real installed SDK with only the RPC transport replaced by an in-memory store. */
function realSdk(store: Store): Firestore {
  const sdk = new Firestore({ projectId: PROJECT });
  databases.push(sdk);
  const adapter = sdk as unknown as { initializeIfNeeded: (tag: string) => Promise<void> };
  const initialize = adapter.initializeIfNeeded.bind(sdk);
  jest.spyOn(adapter, "initializeIfNeeded").mockImplementation((tag: string) => {
    events.push({ kind: tag === "teacher-units-a3-runtime-identity" ? "identity-initialize" : "tenant-initialize", detail: tag });
    return initialize(tag);
  });
  const transport = sdk as unknown as {
    requestStream: (method: string, bidi: boolean, request: Record<string, unknown>) => Promise<Readable>;
    request: (method: string, request: Record<string, unknown>) => Promise<unknown>;
  };
  jest.spyOn(transport, "requestStream").mockImplementation((method, _bidi, request) => Promise.resolve().then(() => {
    events.push({ kind: "rpc", detail: method });
    const transaction = request.newTransaction !== undefined ? { transaction: TX } : {};
    if (method === "batchGetDocuments") {
      const names = request.documents as string[];
      return Readable.from(names.map((name, index) => {
        const data = store.get(name);
        return { ...(index === 0 ? transaction : {}), readTime: TIME, ...(data ? { found: proto(name, data) } : { missing: name }) };
      }));
    }
    if (method === "runQuery") {
      const query = request.structuredQuery as { from: Array<{ collectionId: string }> };
      const collection = `${String(request.parent)}/${query.from[0].collectionId}/`;
      const where = JSON.stringify(query);
      const matches = [...store.entries()].filter(([name, data]) =>
        name.startsWith(collection) && Object.values(data).some(v => "stringValue" in v && where.includes(JSON.stringify(v.stringValue))));
      if (matches.length === 0) return Readable.from([{ ...transaction, readTime: TIME }]);
      return Readable.from(matches.map(([name, data], index) => ({ ...(index === 0 ? transaction : {}), readTime: TIME, document: proto(name, data) })));
    }
    throw new Error(`fake transport: unsupported stream ${method}`);
  }));
  jest.spyOn(transport, "request").mockImplementation(method => Promise.resolve().then(() => {
    events.push({ kind: "rpc", detail: method });
    if (method === "commit") return { commitTime: TIME, writeResults: [] };
    if (method === "rollback") return {};
    throw new Error(`fake transport: unsupported unary ${method}`);
  }));
  return sdk;
}

function deployedAs(endpoint: string): void {
  const service = endpoint.toLowerCase();
  process.env = { K_SERVICE: service, K_REVISION: `${service}-00001-abc` };
  jest.mocked(readRuntimeMetadata).mockImplementation(path => Promise.resolve({
    "project/project-id": PROJECT, "project/numeric-project-id": NUMBER,
    "instance/region": `projects/${NUMBER}/regions/us-central1`,
    "instance/service-accounts/default/email": `runtime@${PROJECT}.iam.gserviceaccount.com`,
  }[path]));
}

function call(uid: string | null, token: Record<string, string> = {}): CallableRequest<unknown> {
  return { data: {}, rawRequest: {} as never, acceptsStreaming: false,
    ...(uid === null ? {} : { auth: { uid, token: token as never, rawToken: "raw" } }) } as CallableRequest<unknown>;
}
const teacher = () => call("teacher-1", { role: "teacher", schoolId: "school-1", districtId: "district-1" });

const original = process.env;
beforeEach(() => {
  events = []; databases = [];
  db = realSdk(seededStore());
  jest.mocked(getAdminFirestore).mockReturnValue(db);
  getApp.mockReturnValue({ options: { projectId: PROJECT } });
});
afterEach(async () => {
  await Promise.all(databases.map(d => d.terminate()));
  process.env = original;
  jest.clearAllMocks();
});

async function refusal(promise: unknown): Promise<{ code?: string; details?: { code?: string } }> {
  try { await promise; } catch (err) { return err as { code?: string; details?: { code?: string } }; }
  throw new Error("expected the callable to refuse");
}

describe("Teacher Units callable initialization ordering (real Firestore SDK)", () => {
  test.each(ENDPOINTS)("%s binds runtime identity before any Firestore use", async (endpoint, callable) => {
    deployedAs(endpoint);
    const err = await refusal(callable.run(teacher()));
    // The callable proceeds past identity and canonical teacher authorization;
    // the in-memory store has no availability policy, so a later Option B
    // refusal (never the identity refusal) ends the request.
    // Root-cause assertion first: the identity binder must initialize the shared
    // SDK before any tenant read initializes (and freezes) it.
    expect(events[0].kind).toBe("identity-initialize");
    const firstTenant = events.findIndex(e => e.kind !== "identity-initialize");
    expect(firstTenant).toBeGreaterThan(0);
    expect(events.some(e => e.kind === "rpc" && e.detail === "batchGetDocuments")).toBe(true);
    expect(err.details?.code).not.toBe("teacherUnits.runtimeIdentityUnavailable");
    expect(err.code).not.toBe("unavailable");
  });

  test("valid teacher request reaches Option B enforcement (policy missing in the store)", async () => {
    deployedAs("teacherUnitsList");
    const err = await refusal(teacherUnitsList.run(teacher()));
    expect(err.details?.code).toBe("teacherUnits.policyMissing");
  });

  test("a warm instance keeps working across requests (binding reused, not refused)", async () => {
    deployedAs("teacherUnitsList");
    for (let i = 0; i < 2; i += 1) {
      const err = await refusal(teacherUnitsList.run(teacher()));
      expect(err.details?.code).toBe("teacherUnits.policyMissing");
    }
  });
});

describe("Teacher Units callable security (real guard, real district context)", () => {
  test("unauthenticated callers are denied without a tenant read", async () => {
    deployedAs("teacherUnitsList");
    const err = await refusal(teacherUnitsList.run(call(null)));
    expect(err.code).toBe("unauthenticated");
    expect(events.filter(e => e.kind === "rpc")).toEqual([]);
  });

  test("students are denied by the existing teacher-role check", async () => {
    deployedAs("teacherUnitsList");
    const err = await refusal(teacherUnitsList.run(call("student-1", { role: "student", schoolId: "school-1", districtId: "district-1" })));
    expect(err.code).toBe("permission-denied");
    expect(err.details?.code).not.toBe("teacherUnits.runtimeIdentityUnavailable");
  });

  test("a token claiming another tenant is denied by canonical district context", async () => {
    deployedAs("teacherUnitsList");
    const err = await refusal(teacherUnitsList.run(call("teacher-1", { role: "teacher", schoolId: "school-2", districtId: "district-2" })));
    expect(err.details?.code).toBe("claim-state-mismatch");
  });

  test("a district claim that disagrees with the canonical school is denied", async () => {
    deployedAs("teacherUnitsList");
    const err = await refusal(teacherUnitsList.run(call("teacher-1", { role: "teacher", schoolId: "school-1", districtId: "district-2" })));
    expect(err.details?.code).toBe("district-mismatch");
  });

  test("a support-restricted teacher remains denied by the Student Support teaching guard", async () => {
    const store = seededStore();
    store.delete(`${ROOT}/classes/class-1`);
    store.set(`${ROOT}/supportAccountBoundaries/teacher-1`, { restricted: { booleanValue: true }, ...fields({ emailHash: "hash", googleIdentity: "google" }) });
    db = realSdk(store);
    jest.mocked(getAdminFirestore).mockReturnValue(db);
    deployedAs("teacherUnitsList");
    const err = await refusal(teacherUnitsList.run(teacher()));
    expect(err.code).toBe("permission-denied");
    expect(err.details?.code).toBe("supportAccess.forbidden");
  });

  test("an unaccepted runtime identity still refuses before any tenant read", async () => {
    deployedAs("teacherUnitsList");
    process.env.K_SERVICE = "someotherservice"; process.env.K_REVISION = "someotherservice-00001-abc";
    const err = await refusal(teacherUnitsList.run(teacher()));
    expect(err.details?.code).toBe("teacherUnits.runtimeIdentityUnavailable");
    expect(events.filter(e => e.kind !== "identity-initialize")).toEqual([]);
  });
});

describe("Teacher Units callable wiring", () => {
  const sources = readdirSync(__dirname)
    .filter(file => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map(file => ({ file, source: readFileSync(`${__dirname}/${file}`, "utf8") }));

  test("exactly the nine endpoints are exported through teacherUnitsCallable with their own endpoint", () => {
    const wired = sources.flatMap(({ source }) =>
      [...source.matchAll(/export const (\w+) = teacherUnitsCallable\(\{[^}]*\}, "(\w+)", (\w+)Handler\);/g)]
        .map(([, name, endpoint, handler]) => ({ name, endpoint, handler })));
    expect(wired.map(w => w.name).sort()).toEqual(ENDPOINTS.map(([name]) => name).sort());
    for (const w of wired) expect(w).toEqual({ name: w.name, endpoint: w.name, handler: w.name });
  });

  test("no Teacher Units source bypasses the identity-first wrapper", () => {
    for (const { file, source } of sources) {
      if (file === "teacher-units-callable.ts") continue;
      expect({ file, bypass: /\b(teachingCallable|guardedTeachingCallable|platformCallable|onCall)\(/.test(source) })
        .toEqual({ file, bypass: false });
    }
  });
});
