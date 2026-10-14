/** Application bytes only: excludes dependencies, base image and fleet state. */
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { contentDigest, parseStrictJSON, sha256Bytes } from "./a3-canonical";
import { digest, literal, object, pattern, tuple, validate } from "./a3-protocol";
import type { StructuralResult } from "./a3-protocol";
export const RUNTIME_BUILD_PATH = "lib/teacherUnits/a3-runtime-build.json";
/** Private build-record format, not an A3-1 release/evidence schema. */
export type RuntimeBuildRecord = {
  schemaVersion: 1; enforcementVersion: "teacher-units-a3-v1";
  deploymentMode: "closed-only" | "policy-controlled";
  sourceSha: string; sourceTree: string; sourceDirty: boolean;
  runtimePayloadFingerprint: string; placementFingerprint: string;
  supportedClientContractVersions: ["teacher-units-v2"];
};
const sha = pattern(/^[a-f0-9]{40}$/);
export function validateRuntimeBuild(value: unknown): StructuralResult<RuntimeBuildRecord> {
  return validate((v, p) => {
    object({ schemaVersion: literal(1), enforcementVersion: literal("teacher-units-a3-v1"),
      deploymentMode: literal("closed-only", "policy-controlled"), sourceSha: sha, sourceTree: sha,
      sourceDirty: literal(true, false), runtimePayloadFingerprint: digest, placementFingerprint: digest,
      supportedClientContractVersions: tuple(literal("teacher-units-v2")) })(v, p);
    const record = v as RuntimeBuildRecord;
    if (record.deploymentMode === "policy-controlled" && record.sourceDirty) throw new Error("Dirty controlled build");
  }, value);
}
function regular(path: string): Buffer {
  if (!lstatSync(path).isFile()) throw new Error("Regular artifact file required");
  return readFileSync(path);
}
export function inventoryRuntimeArtifact(root: string): {
  runtimeFiles: Readonly<Record<string, string>>; runtimePayloadFingerprint: string;
  functionsArtifactFingerprint: string; placementFingerprint: string;
} {
  if (!lstatSync(root).isDirectory()) throw new Error("Artifact root directory required");
  const files: Record<string, string> = {};
  const walk = (relative: string): void => {
    const path = join(root, relative), stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error("Artifact symlink refused");
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) walk(`${relative}/${name}`);
    } else if (!stat.isFile()) throw new Error("Unsupported artifact entry");
    else if (/^lib\/.*\.(js|json)$/.test(relative)) files[relative] = sha256Bytes(regular(path));
  };
  walk("lib");
  for (const path of ["package.json", "package-lock.json"]) files[path] = sha256Bytes(regular(join(root, path)));
  if (!files["lib/index.js"] || !files["lib/teacherUnits/unit-placeable-resources.json"]) throw new Error("Incomplete application inventory");
  const placement = parseStrictJSON(regular(join(root, "lib/teacherUnits/unit-placeable-resources.json")).toString("utf8")) as { resourceIds?: unknown };
  if (!placement || !Array.isArray(placement.resourceIds) || !placement.resourceIds.length ||
      placement.resourceIds.some(id => typeof id !== "string" || !id) || new Set(placement.resourceIds).size !== placement.resourceIds.length) throw new Error("Malformed placement inventory");
  const payload = { ...files }; delete payload[RUNTIME_BUILD_PATH];
  return { runtimeFiles: Object.freeze(files), runtimePayloadFingerprint: contentDigest(payload),
    functionsArtifactFingerprint: contentDigest(files), placementFingerprint: contentDigest(placement.resourceIds) };
}
/** Unknown buildpack layout has no fallback. Default root is relative to compiled module. */
export function inspectRuntimeArtifact(root = resolve(__dirname, "../..")) {
  const before = inventoryRuntimeArtifact(root);
  const build = validateRuntimeBuild(parseStrictJSON(regular(join(root, RUNTIME_BUILD_PATH)).toString("utf8")));
  if (!build.ok) throw new Error("Invalid runtime build record");
  if (build.value.runtimePayloadFingerprint !== before.runtimePayloadFingerprint || build.value.placementFingerprint !== before.placementFingerprint) throw new Error("Runtime build content mismatch");
  const after = inventoryRuntimeArtifact(root);
  if (before.functionsArtifactFingerprint !== after.functionsArtifactFingerprint) throw new Error("Artifact changed during inspection");
  const record: RuntimeBuildRecord = Object.freeze({ ...build.value,
    supportedClientContractVersions: Object.freeze([...build.value.supportedClientContractVersions]) as unknown as ["teacher-units-v2"] });
  return Object.freeze({ ...after, build: record });
}
