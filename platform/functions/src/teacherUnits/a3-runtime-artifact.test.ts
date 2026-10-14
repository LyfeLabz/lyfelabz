import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJSON, contentDigest, sha256Bytes } from "./a3-canonical";
import { inspectRuntimeArtifact, inventoryRuntimeArtifact, RUNTIME_BUILD_PATH, validateRuntimeBuild } from "./a3-runtime-artifact";
let root: string;
const put = (path: string, value: string) => writeFileSync(join(root, path), value);
function build(mode = "closed-only", dirty = false) {
  const inventory = inventoryRuntimeArtifact(root);
  const record = { schemaVersion: 1, enforcementVersion: "teacher-units-a3-v1", deploymentMode: mode,
    sourceSha: "a".repeat(40), sourceTree: "b".repeat(40), sourceDirty: dirty,
    runtimePayloadFingerprint: inventory.runtimePayloadFingerprint, placementFingerprint: inventory.placementFingerprint,
    supportedClientContractVersions: ["teacher-units-v2"] };
  put(RUNTIME_BUILD_PATH, canonicalJSON(record)); return record;
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "a3-artifact-")); mkdirSync(join(root, "lib/teacherUnits"), { recursive: true });
  put("lib/index.js", "compiled"); put("lib/index.js.map", "map"); put("lib/index.d.ts", "declaration");
  put("lib/teacherUnits/unit-placeable-resources.json", '{"resourceIds":["one","two"]}');
  put("package.json", "{}"); put("package-lock.json", "{}");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
test("exact canonical path/hash map with build file excluded only from payload", () => {
  const before = inventoryRuntimeArtifact(root); build(); const result = inspectRuntimeArtifact(root);
  expect(result.runtimePayloadFingerprint).toBe(before.functionsArtifactFingerprint);
  expect(Object.keys(result.runtimeFiles).sort()).toEqual([RUNTIME_BUILD_PATH, "lib/index.js", "lib/teacherUnits/unit-placeable-resources.json", "package-lock.json", "package.json"].sort());
  expect(result.functionsArtifactFingerprint).toBe(contentDigest(result.runtimeFiles));
  expect(result.functionsArtifactFingerprint).not.toBe(result.runtimePayloadFingerprint);
  expect(result.runtimeFiles["lib/index.js"]).toBe(sha256Bytes(Buffer.from("compiled")));
  expect(result.build.deploymentMode).toBe("closed-only");
  put(RUNTIME_BUILD_PATH, canonicalJSON({ ...result.build, sourceSha: "c".repeat(40) }));
  expect(inspectRuntimeArtifact(root).runtimePayloadFingerprint).toBe(result.runtimePayloadFingerprint);
  expect(inspectRuntimeArtifact(root).functionsArtifactFingerprint).not.toBe(result.functionsArtifactFingerprint);
});
test.each(["lib/index.js", "package.json", "package-lock.json", "lib/teacherUnits/unit-placeable-resources.json"])("changed payload %s refused", path => {
  build(); put(path, "{\"changed\":true}"); expect(() => inspectRuntimeArtifact(root)).toThrow();
});
test("added js/json participates; maps and declarations do not", () => {
  build(); put("lib/extra.json", "{}"); expect(() => inspectRuntimeArtifact(root)).toThrow();
  rmSync(join(root, "lib/extra.json")); put("lib/index.js.map", "different"); put("lib/index.d.ts", "different");
  expect(inspectRuntimeArtifact(root).build.deploymentMode).toBe("closed-only");
});
test.each(["lib/index.js", "package.json", "package-lock.json", RUNTIME_BUILD_PATH])("missing %s refused", path => {
  build(); rmSync(join(root, path)); expect(() => inspectRuntimeArtifact(root)).toThrow();
});
test("symlink files, directories and root refused", () => {
  const alias = `${root}-link`; symlinkSync(root, alias);
  try { expect(() => inventoryRuntimeArtifact(alias)).toThrow(); } finally { rmSync(alias); }
  build(); symlinkSync(join(root, "package.json"), join(root, "lib/link.js")); expect(() => inspectRuntimeArtifact(root)).toThrow();
  rmSync(join(root, "lib/link.js")); symlinkSync(join(root, "lib/teacherUnits"), join(root, "lib/link")); expect(() => inventoryRuntimeArtifact(root)).toThrow();
});
test("malformed, duplicate-key, unsupported and accessor build records refused", () => {
  const valid = build();
  for (const value of [null, {}, { ...valid, extra: true }, { ...valid, schemaVersion: 2 }, { ...valid, deploymentMode: "enabled" }, { ...valid, runtimePayloadFingerprint: "bad" }, { ...valid, sourceDirty: true, deploymentMode: "policy-controlled" }, Object.defineProperty({}, "schemaVersion", { get: () => 1, enumerable: true })]) {
    expect(validateRuntimeBuild(value).ok).toBe(false);
  }
  put(RUNTIME_BUILD_PATH, '{"schemaVersion":1,"schemaVersion":1}'); expect(() => inspectRuntimeArtifact(root)).toThrow();
  put(RUNTIME_BUILD_PATH, "not-json"); expect(() => inspectRuntimeArtifact(root)).toThrow();
});
test("policy-controlled record shape is structure-only", () => {
  const record = build("policy-controlled");
  expect(validateRuntimeBuild(record)).toMatchObject({ ok: true, scope: "structure-only", operationalVerification: "unverified" });
});
