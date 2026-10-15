/* eslint-disable @typescript-eslint/no-explicit-any */
// A3-3 TEST-ONLY support. Never imported by production code; `*.test.ts` is
// excluded from the Functions build (tsconfig.build.json), so nothing here can
// reach the compiled lib or a release artifact. It builds a synthetic,
// internally coherent enabled policy chain from the shared A3-1 fixtures and
// provides injected test verifiers. Synthetic records and test verdicts have no
// operational authority; production wiring never sees them.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Timestamp } from "firebase-admin/firestore";

import type { ExpectedEnvironment } from "./a3-contracts";
import * as B from "./a3-bindings";
import { contentDigest, evidenceRef } from "./a3-canonical";
import type { TeacherUnitsEnforcement } from "./a3-enforcement";
import type { MutationCompatibilityV1 } from "./a3-protocol";
import type { ReleaseAuthorityVerdict, ReleaseAuthorityVerifier } from "./a3-release-authority";
import type { RuntimeIdentity } from "./a3-runtime-identity";
import type { RuntimeProvenanceResult } from "./a3-runtime-provenance";

export const A3_FIXTURE = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../fixtures/teacher-units-a3/v1.json"), "utf8"),
);
const valid = A3_FIXTURE.valid;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const A3_ENDPOINTS = [
  "teacherUnitsArchive", "teacherUnitsCapabilities", "teacherUnitsCreate", "teacherUnitsGet", "teacherUnitsList",
  "teacherUnitsReorder", "teacherUnitsRestore", "teacherUnitsSetResources", "teacherUnitsUpdate",
] as const;

export type LocalProfile = NonNullable<ExpectedEnvironment["localProfile"]>;

export function emulatorExpectation(projectId: string, profile?: Partial<LocalProfile>): ExpectedEnvironment {
  return {
    environment: "emulator", projectId, projectNumber: "0",
    localProfile: {
      fingerprint: "f".repeat(64), authOrigin: "http://127.0.0.1:9099",
      firestoreHost: "127.0.0.1:8080", functionsOrigin: "http://127.0.0.1:5001", ...profile,
    },
  };
}

/** A frozen identity-shaped stub for hermetic unit tests. It is NOT issued by the
 * A3-2 resolver, so real provenance never matches it. */
export function stubIdentity(expected: ExpectedEnvironment): RuntimeIdentity {
  const cloud = expected.environment !== "emulator";
  return Object.freeze({
    ...expected,
    region: "us-central1", databaseId: "(default)",
    source: cloud ? "execution-metadata" : "explicit-local-profile",
    serviceAccountEmail: cloud ? "svc@lyfelabz.iam.gserviceaccount.com" : null,
    service: cloud ? "teacherunits" : null, revision: cloud ? "teacherunits-00001" : null,
  });
}

export type EnabledChain = {
  readonly policy: Record<string, any>;
  readonly documents: Readonly<Record<string, Record<string, any>>>;
  readonly releaseId: string;
  readonly releaseRef: string;
  readonly deploymentApprovalRef: string;
  readonly activationEvidenceRef: string;
  readonly activationApprovalRef: string;
  readonly certificationEvidenceRef: string;
  readonly hostingCandidateFingerprint: string;
  readonly compatibility: MutationCompatibilityV1;
};

/** Coherent synthetic chain bound to `expected` and the given placement digest. */
export function buildEnabledChain(expected: ExpectedEnvironment, placementFingerprint: string,
  options: { generation?: number; hostingCandidateFingerprint?: string } = {}): EnabledChain {
  const env = { environment: expected.environment, projectId: expected.projectId, projectNumber: expected.projectNumber };
  const generation = options.generation ?? 3;
  const hosting = options.hostingCandidateFingerprint ?? "c".repeat(64);
  const certificationEvidenceRef = `teacherUnitsReleaseEvidence/${"d".repeat(64)}`;

  const approval = clone(valid.deploymentApproval);
  approval.payload.statement = { ...approval.payload.statement, ...env,
    candidate: { ...approval.payload.statement.candidate, placementFingerprint } };
  approval.payload.source.statementObject.sha256 = contentDigest(approval.payload.statement);
  const deploymentApprovalRef = evidenceRef(approval.payload);

  const manifest = { ...clone(valid.backendRelease.manifest), ...env, placementFingerprint, deploymentApprovalEvidenceRef: deploymentApprovalRef };
  if (expected.environment === "emulator") {
    const profile = expected.localProfile as LocalProfile;
    manifest.endpoints = A3_ENDPOINTS.map(name => ({ ...clone(valid.emulatorEndpoint), ...env, endpointName: name, entryPoint: name,
      localProfileFingerprint: profile.fingerprint, authOrigin: profile.authOrigin,
      firestoreHost: profile.firestoreHost, functionsOrigin: profile.functionsOrigin }));
    manifest.rules = { ...manifest.rules, rulesetResource: null };
  } else {
    manifest.endpoints = manifest.endpoints.map((endpoint: Record<string, any>) => ({ ...endpoint, ...env }));
  }
  const release = { schemaVersion: 1, manifest };
  const releaseId = contentDigest(manifest);

  const policyInstanceId = valid.enabledPolicy.policyInstanceId as string;
  const activationApproval = clone(valid.activationApproval);
  activationApproval.payload.statement = { ...activationApproval.payload.statement, ...env, policyInstanceId,
    enabledGeneration: generation, backendReleaseId: releaseId, placementFingerprint,
    hostingCandidateFingerprint: hosting, certificationEvidenceRef };
  activationApproval.payload.source.statementObject.sha256 = contentDigest(activationApproval.payload.statement);
  const activationApprovalRef = evidenceRef(activationApproval.payload);

  const activationEvidence = clone(valid.activationEvidence);
  activationEvidence.payload = { ...activationEvidence.payload, ...env, policyInstanceId, enabledGeneration: generation,
    backendReleaseId: releaseId, placementFingerprint, hostingCandidateFingerprint: hosting,
    certificationEvidenceRef, authorizationEvidenceRef: activationApprovalRef };
  const activationEvidenceRef = evidenceRef(activationEvidence.payload);

  const policy = { ...clone(valid.enabledPolicy), ...env, generation, placementFingerprint,
    backendReleaseEligibility: { releaseId }, activationEvidenceRef, updatedAt: new Timestamp(1767323046, 0) };
  return {
    policy,
    documents: {
      [`teacherUnitsBackendReleases/${releaseId}`]: release,
      [deploymentApprovalRef]: approval,
      [activationEvidenceRef]: activationEvidence,
      [activationApprovalRef]: activationApproval,
    },
    releaseId, releaseRef: `teacherUnitsBackendReleases/${releaseId}`,
    deploymentApprovalRef, activationEvidenceRef, activationApprovalRef, certificationEvidenceRef,
    hostingCandidateFingerprint: hosting,
    compatibility: { schemaVersion: 1, clientContractVersion: "teacher-units-v2", policyInstanceId,
      policyGeneration: generation, backendReleaseId: releaseId, placementFingerprint },
  };
}

/** Closed policy for the same environment (generation 1, no release or evidence). */
export function closedPolicy(expected: ExpectedEnvironment, placementFingerprint: string): Record<string, any> {
  return { ...clone(valid.closedPolicy), environment: expected.environment, projectId: expected.projectId,
    projectNumber: expected.projectNumber, placementFingerprint, updatedAt: new Timestamp(1767323046, 0) };
}

/** TEST-ONLY verifier returning a verdict consistent with `chain`. */
export function testVerifier(chain: EnabledChain, override: Partial<Record<string, unknown>> = {}): ReleaseAuthorityVerifier & { calls: number } {
  const verifier = {
    calls: 0,
    verify(): Promise<ReleaseAuthorityVerdict> {
      verifier.calls += 1;
      return Promise.resolve({ verdict: "verified", releaseId: chain.releaseId, deploymentApprovalRef: chain.deploymentApprovalRef,
        activationEvidenceRef: chain.activationEvidenceRef, activationApprovalRef: chain.activationApprovalRef,
        certificationEvidenceRef: chain.certificationEvidenceRef, hostingCandidateFingerprint: chain.hostingCandidateFingerprint,
        policyInstanceId: chain.compatibility.policyInstanceId, enabledGeneration: chain.compatibility.policyGeneration,
        ...override } as ReleaseAuthorityVerdict);
    },
  };
  return verifier;
}

export function matchedProvenance(releaseId: string): RuntimeProvenanceResult {
  return Object.freeze({ runtimeConsistency: "matched", available: false, approvalVerification: "unverified",
    deploymentVerification: "unverified", releaseId });
}

/** TEST-ONLY enforcement. */
export function testEnforcement(identity: RuntimeIdentity, chain: EnabledChain | null,
  overrides: Partial<TeacherUnitsEnforcement> = {}): TeacherUnitsEnforcement {
  return {
    resolveIdentity: () => Promise.resolve(identity),
    isIdentityCurrent: (value) => value === identity,
    provenance: () => chain ? matchedProvenance(chain.releaseId) : matchedProvenance("0".repeat(64)),
    verifier: chain ? testVerifier(chain) : { verify: () => Promise.resolve({ verdict: "unverified", reason: "verifierUnconfigured" }) },
    ...overrides,
  };
}

// Self-check registered only when this file is the running suite.
if ((expect.getState().testPath ?? "").endsWith("a3-test-support.test.ts")) {
  test("synthetic chains are coherent under the unchanged A3-1 binding validators", () => {
    for (const expected of [emulatorExpectation("demo-a3-test"), { environment: "staging", projectId: "lyfelabz-staging", projectNumber: "293337283840" } as ExpectedEnvironment]) {
      const chain = buildEnabledChain(expected, "b".repeat(64));
      const docs = chain.documents;
      expect(B.validateReleaseReference(chain.releaseRef, docs[chain.releaseRef], expected).ok).toBe(true);
      expect(B.validateDeploymentBinding(docs[chain.releaseRef], docs[chain.deploymentApprovalRef], expected).ok).toBe(true);
      expect(B.validateActivationBinding(chain.policy, docs[chain.releaseRef], docs[chain.activationEvidenceRef],
        docs[chain.activationApprovalRef], chain.hostingCandidateFingerprint, expected).ok).toBe(true);
      expect(B.validateMutationBinding(chain.policy, chain.compatibility, expected).ok).toBe(true);
      // Synthetic zero-byte signatures pass structure only; they carry no authority.
      expect(B.validateActivationBinding(chain.policy, docs[chain.releaseRef], docs[chain.activationEvidenceRef],
        docs[chain.activationApprovalRef], "0".repeat(64), expected).ok).toBe(false);
    }
  });
}
