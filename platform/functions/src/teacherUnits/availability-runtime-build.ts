/** Option B schema 2 only. Application-content consistency, never provenance,
 * deployment eligibility, fleet certification or owner authorization. Unwired. */
import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { contentDigest, parseStrictJSON } from "./a3-canonical";
import { inventoryRuntimeArtifact, RUNTIME_BUILD_PATH } from "./a3-runtime-artifact";
import { digest, literal, object, pattern, refuse, tuple, validate } from "./availability-protocol";
import type { StructuralResult } from "./availability-protocol";
export { RUNTIME_BUILD_PATH };
export type AvailabilityRuntimeBuild = Readonly<{
  schemaVersion: 2;
  enforcementVersion: "teacher-units-option-b-v1";
  deploymentMode: "closed-only" | "policy-controlled";
  sourceSha: string;
  sourceTree: string;
  sourceDirty: boolean;
  runtimePayloadFingerprint: string;
  placementFingerprint: string;
  supportedClientContractVersions: readonly ["teacher-units-v3"];
  backendBuildId: string;
}>;
const sha = pattern(/^[a-f0-9]{40}$/);
const buildFields = {
  schemaVersion: literal(2), enforcementVersion: literal("teacher-units-option-b-v1"),
  deploymentMode: literal("closed-only", "policy-controlled"), sourceSha: sha, sourceTree: sha,
  sourceDirty: literal(true, false), runtimePayloadFingerprint: digest, placementFingerprint: digest,
  supportedClientContractVersions: tuple(literal("teacher-units-v3")),
};
type BuildInputs = Omit<AvailabilityRuntimeBuild, "backendBuildId">;
/** Exact D3 digest projection. Does not include the record, dirty flag, tuple
 * field name or any provider/base-image/dependency-authenticity assertion. */
function idFor(r: BuildInputs): string {
  return contentDigest({ schemaVersion: 1, sourceSha: r.sourceSha, sourceTree: r.sourceTree,
    deploymentMode: r.deploymentMode, enforcementVersion: r.enforcementVersion,
    clientContractVersion: "teacher-units-v3", placementFingerprint: r.placementFingerprint,
    runtimePayloadFingerprint: r.runtimePayloadFingerprint });
}
function cleanControlled(r: BuildInputs): void {
  if (r.deploymentMode === "policy-controlled" && r.sourceDirty) refuse("$.sourceDirty", "dirty controlled build");
}
/** Derivation accepts exact validated schema 2 inputs only, no environment or
 * legacy record fallback. A calculated ID does not authorize a build. */
export function deriveBackendBuildId(value: unknown): StructuralResult<string> {
  const parsed = validate<BuildInputs>((v, p) => { object(buildFields)(v, p); cleanControlled(v as BuildInputs); }, value);
  if (!parsed.ok) return parsed;
  return validate(digest, idFor(parsed.value));
}
export function validateAvailabilityRuntimeBuild(value: unknown): StructuralResult<AvailabilityRuntimeBuild> {
  return validate((v, p) => {
    object({ ...buildFields, backendBuildId: digest })(v, p);
    const record = v as AvailabilityRuntimeBuild;
    cleanControlled(record);
    if (record.backendBuildId !== idFor(record)) refuse("$.backendBuildId", "derived build identity mismatch");
  }, value);
}
/** Keep the unchanged raw inventory and two passes. Never invoke its legacy
 * build parser. No cache or supplied environment-variable build identity. */
export function inspectAvailabilityRuntimeArtifact(root = resolve(__dirname, "../..")) {
  const before = inventoryRuntimeArtifact(root);
  const recordPath = join(root, RUNTIME_BUILD_PATH);
  if (!lstatSync(recordPath).isFile()) throw new Error("Regular build record required");
  const parsed = validateAvailabilityRuntimeBuild(parseStrictJSON(readFileSync(recordPath, "utf8")));
  if (!parsed.ok) throw new Error(`Invalid Option B runtime build: ${parsed.issue.reason}`);
  if (parsed.value.runtimePayloadFingerprint !== before.runtimePayloadFingerprint ||
      parsed.value.placementFingerprint !== before.placementFingerprint) throw new Error("Runtime build content mismatch");
  const after = inventoryRuntimeArtifact(root);
  if (before.functionsArtifactFingerprint !== after.functionsArtifactFingerprint) throw new Error("Artifact changed during inspection");
  return Object.freeze({ ...after, build: parsed.value, scope: "application-content-consistency-only" as const,
    operationalVerification: "unverified" as const });
}
