import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJSON, contentDigest } from "./a3-canonical";
import * as canonical from "./a3-canonical";
import * as build from "./availability-runtime-build";
import * as rawInventory from "./a3-runtime-artifact";
import { inspectRuntimeArtifact, inventoryRuntimeArtifact, validateRuntimeBuild } from "./a3-runtime-artifact";
const { buildFixture } = jest.requireActual("../../../../scripts/teacher-units-release/fixtures/synthetic-option-b.cjs");
let root: string;
const put = (name: string, body: string) => writeFileSync(join(root, name), body);
const fixture = (mode = "closed-only", dirty = false) => buildFixture({ build, canonical, mode, dirty });
function write(mode = "closed-only", dirty = false): any {
  const f = fixture(mode, dirty);
  for (const [name, body] of Object.entries(f.files)) put(name, body as string);
  return f.record;
}
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "option-b-artifact-")); mkdirSync(join(root, "lib/teacherUnits"), { recursive: true }); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
test("exact D3 derivation and mode separation, content consistency without authority", () => {
  const r = write("policy-controlled"); const inspected = build.inspectAvailabilityRuntimeArtifact(root);
  expect(r.backendBuildId).toBe(contentDigest({ schemaVersion: 1, sourceSha: r.sourceSha, sourceTree: r.sourceTree,
    deploymentMode: r.deploymentMode, enforcementVersion: "teacher-units-option-b-v1", clientContractVersion: "teacher-units-v3",
    placementFingerprint: r.placementFingerprint, runtimePayloadFingerprint: r.runtimePayloadFingerprint }));
  expect(inspected).toMatchObject({ scope: "application-content-consistency-only", operationalVerification: "unverified", build: r });
  expect(inspected).not.toHaveProperty("authorized");
  expect(fixture().record.backendBuildId).not.toBe(r.backendBuildId);
  expect(Object.isFrozen(inspected.build)).toBe(true); expect(Object.isFrozen(inspected.build.supportedClientContractVersions)).toBe(true);
});
test("ID is independent of record bytes and dirty flag for valid closed builds", () => {
  const r = write(); const before = inventoryRuntimeArtifact(root);
  const dirty = { ...r, sourceDirty: true }; put(build.RUNTIME_BUILD_PATH, canonicalJSON(dirty));
  expect(build.inspectAvailabilityRuntimeArtifact(root).build.backendBuildId).toBe(r.backendBuildId);
  const after = inventoryRuntimeArtifact(root);
  expect(after.runtimePayloadFingerprint).toBe(before.runtimePayloadFingerprint);
  expect(after.functionsArtifactFingerprint).not.toBe(before.functionsArtifactFingerprint);
  expect(build.RUNTIME_BUILD_PATH).toBe("lib/teacherUnits/a3-runtime-build.json");
});
test.each(["sourceSha", "sourceTree", "deploymentMode", "placementFingerprint", "runtimePayloadFingerprint"])("changed %s requires new ID", field => {
  const r = write(); const value = field === "deploymentMode" ? "policy-controlled" : "c".repeat(field.startsWith("source") ? 40 : 64);
  expect(build.validateAvailabilityRuntimeBuild({ ...r, [field]: value }).ok).toBe(false);
  const { backendBuildId: _, ...inputs } = { ...r, [field]: value }; void _;
  const id = build.deriveBackendBuildId(inputs); expect(id.ok).toBe(true);
  if (id.ok) expect(id.value).not.toBe(r.backendBuildId);
});
test.each(["lib/index.js", "package.json", "package-lock.json", "lib/teacherUnits/unit-placeable-resources.json"])("payload tamper %s refuses", name => {
  write(); put(name, "{}"); expect(() => build.inspectAvailabilityRuntimeArtifact(root)).toThrow();
});
test("record itself is included only in complete artifact inventory; maps/declarations excluded", () => {
  write(); const before = build.inspectAvailabilityRuntimeArtifact(root);
  put("lib/index.js.map", "map"); put("lib/index.d.ts", "declaration");
  expect(build.inspectAvailabilityRuntimeArtifact(root).functionsArtifactFingerprint).toBe(before.functionsArtifactFingerprint);
  put("lib/extra.json", "{}"); expect(() => build.inspectAvailabilityRuntimeArtifact(root)).toThrow();
  expect(Object.keys(before.runtimeFiles).sort()).toEqual([build.RUNTIME_BUILD_PATH, "lib/index.js",
    "lib/teacherUnits/unit-placeable-resources.json", "package.json", "package-lock.json"].sort());
});
test("legacy schema 1/v2 is preserved and explicitly rejected by active parser", () => {
  const active = write(); const { backendBuildId: _, ...rest } = active; void _;
  const old = { ...rest, schemaVersion: 1, enforcementVersion: "teacher-units-a3-v1", supportedClientContractVersions: ["teacher-units-v2"] };
  expect(validateRuntimeBuild(old).ok).toBe(true); expect(build.validateAvailabilityRuntimeBuild(old).ok).toBe(false);
  expect(validateRuntimeBuild(active).ok).toBe(false);
  put(build.RUNTIME_BUILD_PATH, canonicalJSON(old)); expect(inspectRuntimeArtifact(root).build).toEqual(old);
  expect(() => build.inspectAvailabilityRuntimeArtifact(root)).toThrow();
});
test.each([
  { schemaVersion: 1 }, { schemaVersion: 3 }, { enforcementVersion: "teacher-units-a3-v1" }, { sourceSha: "A".repeat(40) },
  { sourceTree: "bad" }, { backendBuildId: "a".repeat(64) }, { supportedClientContractVersions: ["teacher-units-v2"] },
  { supportedClientContractVersions: ["teacher-units-v3", "teacher-units-v2"] }, { deploymentMode: "enabled" },
  { deploymentMode: "policy-controlled", sourceDirty: true }, { runtimePayloadFingerprint: "bad" }, { extra: true },
])("strict malformed build %# refuses", patch => {
  expect(build.validateAvailabilityRuntimeBuild({ ...write(), ...patch }).ok).toBe(false);
});
test("missing fields, accessors, symbols, hidden values, unknown classes and invalid derivation refuse", () => {
  const r = write();
  for (const key of Object.keys(r)) { const v = { ...r }; delete v[key]; expect(build.validateAvailabilityRuntimeBuild(v).ok).toBe(false); }
  const getter = jest.fn(() => 2); Object.defineProperty(r, "schemaVersion", { enumerable: true, get: getter });
  expect(build.validateAvailabilityRuntimeBuild(r).ok).toBe(false); expect(getter).not.toHaveBeenCalled();
  const hidden = write(); Object.defineProperty(hidden, "extra", { value: true });
  for (const v of [null, undefined, [], new Date(), hidden, { ...write(), [Symbol("hidden")]: true }])
    expect(build.validateAvailabilityRuntimeBuild(v).ok).toBe(false);
  for (const v of [write(), {}, { ...write(), schemaVersion: 1 }]) expect(build.deriveBackendBuildId(v).ok).toBe(false);
});
test("wrong/missing path, duplicate keys and malformed JSON fail closed", () => {
  const r = write(); rmSync(join(root, build.RUNTIME_BUILD_PATH)); put("lib/teacherUnits/other-build.json", canonicalJSON(r));
  expect(() => build.inspectAvailabilityRuntimeArtifact(root)).toThrow();
  for (const bytes of ['{"schemaVersion":2,"schemaVersion":2}', 'not-json', '{"schemaVersion":-0}']) {
    put(build.RUNTIME_BUILD_PATH, bytes); expect(() => build.inspectAvailabilityRuntimeArtifact(root)).toThrow();
  }
});
test("symlink root, payload, record and directory refused by reused inventory", () => {
  write(); const alias = `${root}-alias`; symlinkSync(root, alias);
  try { expect(() => build.inspectAvailabilityRuntimeArtifact(alias)).toThrow(); } finally { rmSync(alias); }
  for (const name of [build.RUNTIME_BUILD_PATH, "lib/index.js"]) {
    const bytes = readFileSync(join(root, name)); rmSync(join(root, name)); symlinkSync(join(root, "package.json"), join(root, name));
    expect(() => build.inspectAvailabilityRuntimeArtifact(root)).toThrow(); rmSync(join(root, name)); put(name, bytes.toString());
  }
  symlinkSync(join(root, "lib/teacherUnits"), join(root, "lib/link")); expect(() => build.inspectAvailabilityRuntimeArtifact(root)).toThrow();
});
test("valid ID alone cannot override placement mismatch", () => {
  const r = write(); const { backendBuildId: _, ...fields } = { ...r, placementFingerprint: "c".repeat(64) }; void _;
  const derived = build.deriveBackendBuildId(fields); if (!derived.ok) throw new Error("fixture failed");
  put(build.RUNTIME_BUILD_PATH, canonicalJSON({ ...fields, backendBuildId: derived.value }));
  expect(build.validateAvailabilityRuntimeBuild({ ...fields, backendBuildId: derived.value }).ok).toBe(true);
  expect(() => build.inspectAvailabilityRuntimeArtifact(root)).toThrow("Runtime build content mismatch");
});

test("both inventory passes are required and inconsistent second pass refuses", () => {
  write(); const inventory = inventoryRuntimeArtifact(root);
  const spy = jest.spyOn(rawInventory, "inventoryRuntimeArtifact");
  try {
    spy.mockReturnValueOnce(inventory).mockReturnValueOnce({ ...inventory, functionsArtifactFingerprint: "f".repeat(64) });
    expect(() => build.inspectAvailabilityRuntimeArtifact(root)).toThrow("Artifact changed during inspection");
    expect(spy).toHaveBeenCalledTimes(2);
  } finally { spy.mockRestore(); }
});
