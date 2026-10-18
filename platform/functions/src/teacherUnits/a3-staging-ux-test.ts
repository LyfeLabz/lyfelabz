/** Staging UX test mode (docs/platform/TEACHER_UNITS_STAGING_UX_TEST_DESIGN.md).
 *
 * Owner-approved (2026-10-18) for STAGING human UX testing only. An enabled
 * availability policy whose release id and activation evidence reference equal
 * the fixed markers below is eligible only in the exact `lyfelabz-staging`
 * cloud runtime identity, without release evidence, provenance or a
 * release-authority verdict. It is UNCERTIFIED. In every other environment a
 * marker policy is ineligible (fail closed), and every non-marker policy keeps
 * the unchanged certified chain with the UNCONFIGURED verifier.
 *
 * Pure: no reads, no writes, no environment variables. The marker evidence
 * document is never created; the reference is a label only. */
import { createHash } from "node:crypto";

import type * as C from "./a3-contracts";
import type { RuntimeIdentity } from "./a3-runtime-identity";

const marker = (label: string): string =>
  createHash("sha256").update(`lyfelabz.teacherUnits.stagingUxTest.v1:${label}`, "utf8").digest("hex");

export const STAGING_UX_TEST_RELEASE_ID: string = marker("release");
export const STAGING_UX_TEST_EVIDENCE_REF: string = `teacherUnitsReleaseEvidence/${marker("evidence")}`;

const STAGING = Object.freeze({ projectId: "lyfelabz-staging", projectNumber: "293337283840" });

/** True when the policy names BOTH markers. One marker alone is not a test policy
 * (and cannot pass the certified chain either). */
export function isStagingUxTestPolicy(policy: C.TeacherUnitsAvailabilityPolicyV1): boolean {
  return policy.backendReleaseEligibility?.releaseId === STAGING_UX_TEST_RELEASE_ID &&
    policy.activationEvidenceRef === STAGING_UX_TEST_EVIDENCE_REF;
}

/** Eligible only for the exact staging cloud identity, an enabled marker policy
 * bound to staging, and the runtime placement. Anything else is false. */
export function stagingUxTestEligible(identity: RuntimeIdentity, policy: C.TeacherUnitsAvailabilityPolicyV1,
  runtimePlacementFingerprint: string): boolean {
  try {
    return identity.environment === "staging" && identity.projectId === STAGING.projectId &&
      identity.projectNumber === STAGING.projectNumber && identity.source === "execution-metadata" &&
      identity.region === "us-central1" && identity.databaseId === "(default)" &&
      policy.environment === "staging" && policy.projectId === STAGING.projectId &&
      policy.projectNumber === STAGING.projectNumber && policy.mode === "enabled" &&
      isStagingUxTestPolicy(policy) && policy.placementFingerprint === runtimePlacementFingerprint;
  } catch {
    return false;
  }
}
