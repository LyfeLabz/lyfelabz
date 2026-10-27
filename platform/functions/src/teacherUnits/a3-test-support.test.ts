/* eslint-disable @typescript-eslint/no-explicit-any */
// A3-3 TEST-ONLY support. Never imported by production code; `*.test.ts` is
// excluded from the Functions build (tsconfig.build.json), so nothing here can
// reach the compiled lib or a release artifact. It builds a synthetic,
// internally coherent enabled policy chain from the shared A3-1 fixtures and
// provides injected test verifiers. Synthetic records and test verdicts have no
// operational authority; production wiring never sees them.
import { generateKeyPairSync, sign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Timestamp } from "firebase-admin/firestore";

import type { ExpectedEnvironment } from "./a3-contracts";
import { createAuthorityRegistry, ed25519KeyId } from "./a3-authority-registry";
import type { AuthorityAction, AuthorityRegistry } from "./a3-authority-registry";
import * as B from "./a3-bindings";
import { approvalSigningBytes, contentDigest, evidenceRef } from "./a3-canonical";
import { deriveBackendBuildId } from "./availability-runtime-build";
import type { AvailabilityRuntimeBuild } from "./availability-runtime-build";
import type { AvailabilityPolicy } from "./availability-policy";
import type { MutationCompatibilityV2 } from "./availability-protocol";
import type { TeacherUnitsEnforcement } from "./a3-enforcement";
import type { MutationCompatibilityV1 } from "./a3-protocol";
import type { ReleaseAuthorityVerdict, ReleaseAuthorityVerifier } from "./a3-release-authority";
import { createRevocationList } from "./a3-revocation-list";
import type { RevocationList } from "./a3-revocation-list";
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

// ---------- A3-6 S3 signed chains (TEST-ONLY keys) ----------

export type TestSigningKey = { privateKey: KeyObject; publicKeyBase64: string; keyId: string };
export type ChainSigningKeys = Readonly<Record<"deploy" | "certify" | "activate", TestSigningKey>>;
const ACTIONS: Readonly<Record<keyof ChainSigningKeys, AuthorityAction>> =
  { deploy: "deploy-backend", certify: "certify-release", activate: "activate-teacher-units" };

/** Fresh synthetic Ed25519 key generated in this test process; never persisted. */
export function testSigningKey(): TestSigningKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12);
  return { privateKey, publicKeyBase64: raw.toString("base64"), keyId: ed25519KeyId(raw) };
}
export function chainSigningKeys(): ChainSigningKeys {
  return { deploy: testSigningKey(), certify: testSigningKey(), activate: testSigningKey() };
}

/** Registry with one entry per action for `expected`, matching the fixture authority. */
export function testAuthorityRegistry(expected: ExpectedEnvironment, keys: ChainSigningKeys,
  overrides: Partial<Record<keyof ChainSigningKeys, Record<string, unknown>>> = {}): AuthorityRegistry {
  const entries = (Object.keys(ACTIONS) as Array<keyof ChainSigningKeys>).map(name => ({
    schemaVersion: 1, environment: expected.environment, projectId: expected.projectId, projectNumber: expected.projectNumber,
    keyId: keys[name].keyId, publicKeyBase64: keys[name].publicKeyBase64, action: ACTIONS[name],
    authorityId: "test-authority", approverSubject: "test-human", approvalSystemId: "test-system", ...overrides[name],
  })).sort((a, b) => (a.keyId < b.keyId ? -1 : 1));
  const result = createAuthorityRegistry(entries);
  if (!result.ok) throw new Error(`test registry: ${result.issue.path} ${result.issue.reason}`);
  return result.value;
}

/** Pinned deny list bound to `expected` (any order in; canonical order out). */
export function testRevocationList(expected: ExpectedEnvironment, refs: string[]): RevocationList {
  const identity = { environment: expected.environment, projectId: expected.projectId, projectNumber: expected.projectNumber };
  const result = createRevocationList([...refs].sort().map(revokedEvidenceRef => ({ schemaVersion: 1, ...identity, revokedEvidenceRef })), identity);
  if (!result.ok) throw new Error(`test revocation list: ${result.issue.path} ${result.issue.reason}`);
  return result.value;
}

/** Recomputes the statement digest and signs the statement in place. */
export function signDocument(document: Record<string, any>, key: TestSigningKey): Record<string, any> {
  const { statement, source } = document.payload;
  source.statementObject.sha256 = contentDigest(statement);
  source.signerKeyId = key.keyId;
  source.signatureBase64 = sign(null, approvalSigningBytes(statement), key.privateKey).toString("base64");
  return document;
}

export type SignedEnabledChain = EnabledChain & { readonly certification: Record<string, any>; readonly keys: ChainSigningKeys };

/** Coherent chain whose deployment approval, certification and activation approval are
 * really signed with `keys`, and whose certification document exists. */
export type SignedChainOptions = {
  generation?: number; hostingCandidateFingerprint?: string;
  /** Edits a statement before it is signed (the signature stays valid). */
  edit?: Partial<Record<keyof ChainSigningKeys, (statement: Record<string, any>) => void>>;
  /** Alters a signed document before its content address is taken (refs stay coherent). */
  tamper?: Partial<Record<keyof ChainSigningKeys, (document: Record<string, any>) => void>>;
};
export function buildSignedEnabledChain(expected: ExpectedEnvironment, placementFingerprint: string, keys: ChainSigningKeys,
  options: SignedChainOptions = {}): SignedEnabledChain {
  const prepare = (name: keyof ChainSigningKeys, document: Record<string, any>): void => {
    options.edit?.[name]?.(document.payload.statement);
    signDocument(document, keys[name]);
    options.tamper?.[name]?.(document);
  };
  const env = { environment: expected.environment, projectId: expected.projectId, projectNumber: expected.projectNumber };
  const generation = options.generation ?? 3;
  const hosting = options.hostingCandidateFingerprint ?? "c".repeat(64);

  const approval = clone(valid.deploymentApproval);
  approval.payload.statement = { ...approval.payload.statement, ...env,
    candidate: { ...approval.payload.statement.candidate, placementFingerprint } };
  prepare("deploy", approval);
  const deploymentApprovalRef = evidenceRef(approval.payload);

  const base = buildEnabledChain(expected, placementFingerprint, { generation, hostingCandidateFingerprint: hosting });
  // The shared fixture's cloud resources name the staging project; a production chain
  // renames them so the unchanged A3-1 endpoint resource checks bind to production.
  let baseManifest = clone(base.documents[base.releaseRef].manifest);
  if (expected.environment === "production") {
    baseManifest = JSON.parse(JSON.stringify(baseManifest).replace(/lyfelabz-staging/g, expected.projectId)
      .replace(/293337283840/g, expected.projectNumber));
  }
  const manifest = { ...baseManifest, deploymentApprovalEvidenceRef: deploymentApprovalRef };
  const release = { schemaVersion: 1, manifest };
  const releaseId = contentDigest(manifest);
  const releaseRef = `teacherUnitsBackendReleases/${releaseId}`;

  const certification = clone(valid.releaseCertification);
  certification.payload.statement = { ...certification.payload.statement, ...env, backendReleaseId: releaseId,
    hostingCandidateFingerprint: hosting, placementFingerprint };
  prepare("certify", certification);
  const certificationEvidenceRef = evidenceRef(certification.payload);

  const policyInstanceId = valid.enabledPolicy.policyInstanceId as string;
  const activationApproval = clone(valid.activationApproval);
  activationApproval.payload.statement = { ...activationApproval.payload.statement, ...env, policyInstanceId,
    enabledGeneration: generation, backendReleaseId: releaseId, placementFingerprint,
    hostingCandidateFingerprint: hosting, certificationEvidenceRef };
  prepare("activate", activationApproval);
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
      [releaseRef]: release,
      [deploymentApprovalRef]: approval,
      [certificationEvidenceRef]: certification,
      [activationEvidenceRef]: activationEvidence,
      [activationApprovalRef]: activationApproval,
    },
    certification, keys,
    releaseId, releaseRef, deploymentApprovalRef, activationEvidenceRef, activationApprovalRef, certificationEvidenceRef,
    hostingCandidateFingerprint: hosting,
    compatibility: { schemaVersion: 1, clientContractVersion: "teacher-units-v2", policyInstanceId,
      policyGeneration: generation, backendReleaseId: releaseId, placementFingerprint },
  };
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

/** TEST-ONLY B vectors. Historical A3 builders above remain unchanged. */
export function buildOptionBChain(expected: ExpectedEnvironment, placementFingerprint: string,
  options: { generation?: number; deploymentMode?: "closed-only" | "policy-controlled" } = {}) {
  const inputs = { schemaVersion: 2 as const, enforcementVersion: "teacher-units-option-b-v1" as const,
    deploymentMode: options.deploymentMode ?? "policy-controlled", sourceSha: "a".repeat(40), sourceTree: "b".repeat(40), sourceDirty: false,
    runtimePayloadFingerprint: "c".repeat(64), placementFingerprint,
    supportedClientContractVersions: ["teacher-units-v3"] as const };
  const id = deriveBackendBuildId(inputs); if (!id.ok) throw new Error("invalid synthetic B build");
  const build: AvailabilityRuntimeBuild = { ...inputs, backendBuildId: id.value };
  const policy: AvailabilityPolicy = { schemaVersion: 2, enforcementVersion: "teacher-units-option-b-v1",
    environment: expected.environment, projectId: expected.projectId, projectNumber: expected.projectNumber,
    region: "us-central1", databaseId: "(default)", policyInstanceId: "123e4567-e89b-42d3-a456-426614174000",
    generation: options.generation ?? 3, mode: "enabled", approvedBackendBuildId: id.value,
    acceptedClientContractVersions: ["teacher-units-v3"], placementFingerprint,
    createdAt: new Timestamp(1, 0), updatedAt: new Timestamp(2, 0), lastClosedAt: new Timestamp(1, 0), lastEnabledAt: new Timestamp(2, 0),
    updatedBy: { principalSubject: "synthetic-owner", credentialSubject: "synthetic-credential", delegationSubject: null },
    transitionId: "123e4567-e89b-42d3-a456-426614174001", reason: "Synthetic Option B test", approvalRef: "synthetic-owner-decision" };
  const compatibility: MutationCompatibilityV2 = { schemaVersion: 2, clientContractVersion: "teacher-units-v3",
    policyInstanceId: policy.policyInstanceId, policyGeneration: policy.generation, backendReleaseId: id.value, placementFingerprint };
  return { build, policy, compatibility, releaseId: id.value, documents: {} as Record<string, Record<string, unknown>> };
}
export function closedOptionBPolicy(expected: ExpectedEnvironment, placement: string): AvailabilityPolicy {
  const p = buildOptionBChain(expected, placement).policy;
  return { ...p, generation: 1, mode: "closed", approvedBackendBuildId: null, acceptedClientContractVersions: [],
    lastEnabledAt: null, lastClosedAt: p.createdAt, updatedAt: p.createdAt, approvalRef: null };
}
export function testEnforcement(identity: RuntimeIdentity, chain: ReturnType<typeof buildOptionBChain> | null,
  overrides: Partial<TeacherUnitsEnforcement> = {}): TeacherUnitsEnforcement {
  return { resolveIdentity: () => Promise.resolve(identity), isIdentityCurrent: value => value === identity,
    inspectBuild: () => chain?.build ?? null, ...overrides };
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
