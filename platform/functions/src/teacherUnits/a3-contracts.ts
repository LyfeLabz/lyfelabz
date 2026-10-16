/** Approved A3 contracts. Types express structure, never operational trust. */
import type { Timestamp } from "firebase-admin/firestore";
export type Digest = string;
export type GitObjectId = string;
export type UUIDv4 = string;
export type PositiveDecimal = string;
export type Generation = number;
export type Instant = string;
export type EvidenceRef = string;
export type EnvironmentBinding =
  | { environment: "production"; projectId: "lyfelabz-prod"; projectNumber: "182791689935" }
  | { environment: "staging"; projectId: "lyfelabz-staging"; projectNumber: "293337283840" }
  | { environment: "emulator"; projectId: string; projectNumber: "0" };
export type EndpointName = "teacherUnitsArchive" | "teacherUnitsCapabilities" | "teacherUnitsCreate" |
  "teacherUnitsGet" | "teacherUnitsList" | "teacherUnitsReorder" | "teacherUnitsRestore" |
  "teacherUnitsSetResources" | "teacherUnitsUpdate";
export type ContentObjectV1 = { bucket: string; object: string; generation: PositiveDecimal; sha256: Digest };
export type TeacherUnitsAvailabilityPolicyV1 = EnvironmentBinding & {
  schemaVersion: 1; policyInstanceId: UUIDv4; region: "us-central1"; databaseId: "(default)";
  mode: "closed" | "enabled"; generation: Generation;
  backendReleaseEligibility: { releaseId: Digest } | null;
  acceptedClientContractVersions: ["teacher-units-v2"]; placementFingerprint: Digest;
  activationEvidenceRef: EvidenceRef | null; updatedAt: Timestamp;
};
export type PlainEnvironmentVariableV1 = { name: string; value: string };
export type SecretEnvironmentBindingV1 = { name: string; secretResource: string; version: PositiveDecimal };
export type SecretVolumeBindingV1 = {
  volumeName: string; mountPath: string; secretResource: string; defaultMode: number;
  items: Array<{ path: string; version: PositiveDecimal; mode: number | null }>;
};
export type NetworkV1 =
  | { kind: "none" }
  | { kind: "connector"; connectorResource: string; egress: "private-ranges-only" | "all-traffic" }
  | { kind: "direct-vpc"; networkResource: string; subnetworkResource: string; networkTags: string[];
      egress: "private-ranges-only" | "all-traffic" };
export type IamConditionV1 = { expression: string; title: string; description: string };
export type IamAllowPolicyV1 = { version: 1 | 3; bindings: Array<{ role: string; members: string[]; condition: IamConditionV1 | null }> };
export type InvocationAccessV1 = {
  invokerIamDisabled: boolean; defaultUriDisabled: boolean; iapEnabled: boolean; customAudiences: string[];
  functionAllowPolicy: IamAllowPolicyV1; serviceAllowPolicy: IamAllowPolicyV1; accessReviewReceipt: ContentObjectV1;
};
export type RuntimeUpdatePolicyV1 =
  | { kind: "automatic"; baseImageUri: string | null }
  | { kind: "on-deploy"; runtimeVersion: string; baseImageUri: null };
export type CloudEndpointConfigurationV1 = EnvironmentBinding & {
  schemaVersion: 1; kind: "google-cloud"; environment: "production" | "staging";
  endpointName: EndpointName; region: "us-central1"; functionGeneration: "GEN_2";
  runtime: "nodejs22"; entryPoint: EndpointName;
  functionResource: string; buildResource: string; serviceResource: string; revisionResource: string;
  traffic: [{ revisionResource: string; percent: 100; tag: null }]; invocation: InvocationAccessV1;
  execution: {
    serviceAccountEmail: string; timeoutNanoseconds: PositiveDecimal; concurrency: number;
    memoryBytes: PositiveDecimal; cpuMilli: number; minimumInstances: number; maximumInstances: number | null;
    command: string[]; args: string[]; workingDirectory: string | null;
    environmentVariables: PlainEnvironmentVariableV1[]; secretEnvironmentBindings: SecretEnvironmentBindingV1[];
    secretVolumeBindings: SecretVolumeBindingV1[];
    ingress: "all" | "internal" | "internal-and-load-balancing"; network: NetworkV1;
  };
  build: { serviceAccountResource: string; environmentVariables: PlainEnvironmentVariableV1[];
    dockerRepositoryResource: string; source: ContentObjectV1; runtimeUpdatePolicy: RuntimeUpdatePolicyV1 };
  observedImage: { repository: string; digest: Digest };
};
export type EmulatorEndpointConfigurationV1 = {
  schemaVersion: 1; kind: "emulator"; endpointName: EndpointName; entryPoint: EndpointName;
  projectId: string; projectNumber: "0"; environment: "emulator"; region: "us-central1";
  runtime: "nodejs22"; localProfileFingerprint: Digest; authOrigin: string; firestoreHost: string; functionsOrigin: string;
};
export type EndpointConfigurationV1 = CloudEndpointConfigurationV1 | EmulatorEndpointConfigurationV1;
export type BackendReleaseManifestV1 = EnvironmentBinding & {
  schemaVersion: 1; enforcementVersion: "teacher-units-a3-v1"; region: "us-central1"; databaseId: "(default)";
  deploymentMode: "policy-controlled"; sourceSha: GitObjectId; sourceTree: GitObjectId;
  runtimePayloadFingerprint: Digest; functionsArtifactFingerprint: Digest; placementFingerprint: Digest;
  supportedClientContractVersions: ["teacher-units-v2"]; endpoints: EndpointConfigurationV1[];
  rules: { rulesetResource: string | null; sourceHash: Digest }; readyIndexesConfigurationHash: Digest;
  deploymentApprovalEvidenceRef: EvidenceRef;
};
export type BackendReleaseDocumentV1 = { schemaVersion: 1; manifest: BackendReleaseManifestV1 };
export type ApprovalAuthorityV1 = {
  authorityId: string; approverSubject: string; approvalSystemId: string; workflowId: string;
  workflowRunId: string; decisionId: string;
};
export type BackendCandidateBindingV1 = {
  sourceSha: GitObjectId; sourceTree: GitObjectId; runtimePayloadFingerprint: Digest;
  functionsArtifactFingerprint: Digest; placementFingerprint: Digest; enforcementVersion: "teacher-units-a3-v1";
  clientContractVersion: "teacher-units-v2"; deploymentMode: "policy-controlled"; deploymentPlan: ContentObjectV1;
};
export type DeploymentApprovalStatementV1 = EnvironmentBinding & {
  schemaVersion: 1; kind: "teacher-units-deployment-approval"; action: "deploy-backend";
  region: "us-central1"; databaseId: "(default)"; candidate: BackendCandidateBindingV1;
  authority: ApprovalAuthorityV1; issuedAt: Instant;
};
export type ApprovalSourceV1 = {
  statementObject: ContentObjectV1; signerKeyId: string; signatureAlgorithm: "ed25519"; signatureBase64: string;
};
export type DeploymentApprovalPayloadV1 = {
  schemaVersion: 1; kind: "teacher-units-deployment-approval";
  statement: DeploymentApprovalStatementV1; source: ApprovalSourceV1;
};
export type DeploymentApprovalDocumentV1 = { schemaVersion: 1; payload: DeploymentApprovalPayloadV1 };
export type ActivationPayloadV1 = EnvironmentBinding & {
  schemaVersion: 1; kind: "teacher-units-activation"; policyInstanceId: UUIDv4;
  enabledGeneration: Generation; backendReleaseId: Digest; clientContractVersion: "teacher-units-v2";
  placementFingerprint: Digest; hostingCandidateFingerprint: Digest;
  certificationEvidenceRef: EvidenceRef; authorizationEvidenceRef: EvidenceRef;
};
export type ActivationEvidenceDocumentV1 = { schemaVersion: 1; payload: ActivationPayloadV1 };
export type ActivationApprovalStatementV1 = EnvironmentBinding & {
  schemaVersion: 1; kind: "teacher-units-activation-approval"; action: "activate-teacher-units";
  policyInstanceId: UUIDv4; enabledGeneration: Generation; backendReleaseId: Digest;
  clientContractVersion: "teacher-units-v2"; placementFingerprint: Digest; hostingCandidateFingerprint: Digest;
  certificationEvidenceRef: EvidenceRef; authority: ApprovalAuthorityV1; issuedAt: Instant;
};
export type ActivationApprovalPayloadV1 = {
  schemaVersion: 1; kind: "teacher-units-activation-approval";
  statement: ActivationApprovalStatementV1; source: ApprovalSourceV1;
};
export type ActivationApprovalDocumentV1 = { schemaVersion: 1; payload: ActivationApprovalPayloadV1 };
export type ApprovalDispositionStatementV1 = EnvironmentBinding & {
  schemaVersion: 1; kind: "teacher-units-approval-disposition"; action: "revoke" | "supersede";
  targetApprovalRef: EvidenceRef; replacementApprovalRef: EvidenceRef | null;
  authority: ApprovalAuthorityV1; issuedAt: Instant;
};
export type ApprovalDispositionPayloadV1 = {
  schemaVersion: 1; kind: "teacher-units-approval-disposition";
  statement: ApprovalDispositionStatementV1; source: ApprovalSourceV1;
};
export type ApprovalDispositionDocumentV1 = { schemaVersion: 1; payload: ApprovalDispositionPayloadV1 };
/** A3-6 S2 (decision record D7). Binds one exact release; no policy instance or generation. */
export type ReleaseCertificationStatementV1 = EnvironmentBinding & {
  schemaVersion: 1; kind: "teacher-units-release-certification"; action: "certify-release";
  backendReleaseId: Digest; hostingCandidateFingerprint: Digest; placementFingerprint: Digest;
  enforcementVersion: "teacher-units-a3-v1"; clientContractVersion: "teacher-units-v2";
  certificationReport: ContentObjectV1; authority: ApprovalAuthorityV1; issuedAt: Instant;
};
export type ReleaseCertificationPayloadV1 = {
  schemaVersion: 1; kind: "teacher-units-release-certification";
  statement: ReleaseCertificationStatementV1; source: ApprovalSourceV1;
};
export type ReleaseCertificationDocumentV1 = { schemaVersion: 1; payload: ReleaseCertificationPayloadV1 };
/** A3-6 S2 (decision record D8). Audit record, never read by the runtime verifier.
 * Stored at `teacherUnitsAvailabilityHistory/{sha256(canonical document)}`.
 * `policyInstanceId` and `nextGeneration` are the next policy's own values: the
 * durable key under which several records for one generation (rollback evidence,
 * D8 fix 4) are grouped after the singleton policy has been overwritten. */
export type AvailabilityTransitionV1 = "initialize" | "prepare" | "enable" | "shutdown";
export type AvailabilityHistoryDocumentV1 = EnvironmentBinding & {
  schemaVersion: 1; kind: "teacher-units-availability-history"; transition: AvailabilityTransitionV1;
  policyInstanceId: UUIDv4; nextGeneration: Generation; previousPolicyDigest: Digest | null; nextPolicyDigest: Digest;
  evidenceRefs: string[]; operatorSubject: string; reason: string;
};
/** Caller-supplied expectations, not a validated or attested runtime identity. */
export type ExpectedEnvironment = EnvironmentBinding & { localProfile?: {
  fingerprint: Digest; authOrigin: string; firestoreHost: string; functionsOrigin: string;
} };
