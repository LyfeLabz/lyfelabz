/** Inert runtime consistency check. Success is never approval or deployment eligibility. */
import type { EndpointName } from "./a3-contracts";
import { validateDeploymentBinding, validateReleaseReference } from "./a3-bindings";
import { inspectRuntimeArtifact } from "./a3-runtime-artifact";
import { isResolvedRuntimeIdentity } from "./a3-runtime-identity";
import type { RuntimeIdentity } from "./a3-runtime-identity";
export type RuntimeProvenanceResult = Readonly<{
  runtimeConsistency: "matched" | "unverified"; available: false;
  approvalVerification: "unverified"; deploymentVerification: "unverified";
  releaseId: string | null;
}>;
/** Server-only inputs. identity must originate from the execution resolver in this process.
 * root is an explicit local tooling/test seam; live dispatch does not import this module. */
export function verifyRuntimeProvenance(identity: RuntimeIdentity, endpointName: EndpointName,
  releaseRef: unknown, release: unknown, deploymentApproval: unknown, root?: string): RuntimeProvenanceResult {
  const result = (matched: boolean, releaseId: string | null): RuntimeProvenanceResult => Object.freeze({
    runtimeConsistency: matched ? "matched" : "unverified", available: false, approvalVerification: "unverified",
    deploymentVerification: "unverified", releaseId });
  try {
    if (!isResolvedRuntimeIdentity(identity)) return result(false, null);
    const checked = validateReleaseReference(releaseRef, release, identity);
    if (!checked.ok || !validateDeploymentBinding(release, deploymentApproval, identity).ok) return result(false, null);
    const artifact = inspectRuntimeArtifact(root), manifest = checked.value.manifest;
    if (artifact.build.deploymentMode !== "policy-controlled" || artifact.build.sourceDirty) return result(false, null);
    for (const key of ["sourceSha", "sourceTree", "runtimePayloadFingerprint", "placementFingerprint", "enforcementVersion", "deploymentMode"] as const)
      if (artifact.build[key] !== manifest[key]) return result(false, null);
    if (artifact.functionsArtifactFingerprint !== manifest.functionsArtifactFingerprint ||
        artifact.build.supportedClientContractVersions[0] !== manifest.supportedClientContractVersions[0]) return result(false, null);
    const endpoint = manifest.endpoints.find(item => item.endpointName === endpointName);
    if (!endpoint) return result(false, null);
    if (endpoint.kind === "google-cloud") {
      const base = `projects/${identity.projectId}/locations/${identity.region}`;
      if (identity.source !== "execution-metadata" || endpoint.serviceResource !== `${base}/services/${identity.service}` ||
          endpoint.revisionResource !== `${base}/services/${identity.service}/revisions/${identity.revision}` ||
          endpoint.execution.serviceAccountEmail !== identity.serviceAccountEmail) return result(false, null);
    } else if (identity.source !== "explicit-local-profile") return result(false, null);
    return result(true, typeof releaseRef === "string" ? releaseRef.slice("teacherUnitsBackendReleases/".length) : null);
  } catch { return result(false, null); }
}
