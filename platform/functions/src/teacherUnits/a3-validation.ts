/** Pure contracts: no provider calls, authorization or trusted signature verification. */
import { Timestamp } from "firebase-admin/firestore";
import type * as C from "./a3-contracts";
import { canonicalJSON, contentDigest, parseStrictJSON } from "./a3-canonical";
import { array, digest, generation, integer, literal, nullable, object, pattern, plainRecord,
  refuse, stringRule, text, tuple, uuid, validate } from "./a3-protocol";
import type { Rule, StructuralResult } from "./a3-protocol";
export const ENDPOINTS: readonly C.EndpointName[] = Object.freeze([
  "teacherUnitsArchive", "teacherUnitsCapabilities", "teacherUnitsCreate", "teacherUnitsGet", "teacherUnitsList",
  "teacherUnitsReorder", "teacherUnitsRestore", "teacherUnitsSetResources", "teacherUnitsUpdate",
]);
const bool = literal(true, false), contract = literal("teacher-units-v2"), decimal = pattern(/^[1-9][0-9]*$/);
// Storage generation is a signed long; Run instance counts are int32.
const signedLongMaximum = 9223372036854775807n, int32Maximum = 2147483647;
const boundedDecimal = (maximum: bigint): Rule => (v, p) => {
  decimal(v, p);
  if (BigInt(v as string) > maximum) refuse(p, "provider integer out of range");
};
const projectName = pattern(/^[a-z][a-z0-9-]*$/), sha = pattern(/^[a-f0-9]{40}$/), endpointName = literal(...ENDPOINTS);
export const evidenceReferenceRule = pattern(/^teacherUnitsReleaseEvidence\/[a-f0-9]{64}$/);
const identityFields = { environment: literal("production", "staging", "emulator"), projectId: projectName, projectNumber: pattern(/^(?:0|[1-9][0-9]*)$/) };
const order = (key: string) => (v: unknown): string => String(plainRecord(v, "$")[key]);
const sortedText = array(text, v => v as string);
const resource = (suffix: string): Rule => pattern(new RegExp(`^projects/[a-z][a-z0-9-]*/${suffix}$`));
const accountEmail = pattern(/^[A-Za-z0-9_.-]+@[a-z0-9.-]+\.gserviceaccount\.com$/);
const relative: Rule = (v, p) => { text(v, p); const s = v as string;
  if (s.startsWith("/") || s.includes("\\") || s.split("/").some(x => !x || x === "." || x === "..")) refuse(p, "unsafe relative path"); };
const absolute: Rule = (v, p) => { text(v, p); if (!(v as string).startsWith("/")) refuse(p, "absolute path required"); relative((v as string).slice(1), p); };
const instant: Rule = (v, p) => {
  pattern(/^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{9}Z$/)(v, p);
  const s = v as string, date = new Date(`${s.slice(0, 19)}.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== s.slice(0, 19)) refuse(p, "invalid calendar instant");
};
export function assertIdentity(v: C.EnvironmentBinding, expected?: C.ExpectedEnvironment): void {
  if (v.environment === "emulator") {
    if (v.projectNumber !== "0" || !expected || expected.environment !== "emulator" || v.projectId !== expected.projectId) refuse("$", "explicit matching emulator identity required");
  } else {
    const pins = { production: ["lyfelabz-prod", "182791689935"], staging: ["lyfelabz-staging", "293337283840"] };
    const pin = pins[v.environment];
    if (!pin || v.projectId !== pin[0] || v.projectNumber !== pin[1]) refuse("$", "project/environment mismatch");
  }
  if (expected && (v.environment !== expected.environment || v.projectId !== expected.projectId || v.projectNumber !== expected.projectNumber)) refuse("$", "expected identity mismatch");
}
const identified = (rule: Rule, expected?: C.ExpectedEnvironment): Rule => (v, p) => { rule(v, p); assertIdentity(v as C.EnvironmentBinding, expected); };
const timestamp: Rule = (v, p) => { if (!(v instanceof Timestamp)) refuse(p, "Firestore Timestamp required");
  integer(-62135596800, 253402300799)(v.seconds, p); integer(0, 999999999)(v.nanoseconds, p); };
const policySchema = object({ ...identityFields, schemaVersion: literal(1), policyInstanceId: uuid, region: literal("us-central1"),
  databaseId: literal("(default)"), mode: literal("closed", "enabled"), generation,
  backendReleaseEligibility: nullable(object({ releaseId: digest })), acceptedClientContractVersions: tuple(contract),
  placementFingerprint: digest, activationEvidenceRef: nullable(evidenceReferenceRule), updatedAt: timestamp });
export function validatePolicy(v: unknown, expected?: C.ExpectedEnvironment): StructuralResult<C.TeacherUnitsAvailabilityPolicyV1> {
  return validate((value, p) => { identified(policySchema, expected)(value, p); const policy = value as C.TeacherUnitsAvailabilityPolicyV1;
    if (policy.mode === "enabled" && (!policy.backendReleaseEligibility || !policy.activationEvidenceRef)) refuse(p, "enabled bindings required");
    if (policy.mode === "closed" && policy.activationEvidenceRef !== null) refuse(p, "closed activation contradiction"); }, v);
}
const contentObject = object({ bucket: pattern(/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/), object: text, generation: boundedDecimal(signedLongMaximum), sha256: digest });
const envName = pattern(/^[A-Za-z_][A-Za-z0-9_]*$/), plainEnv = object({ name: envName, value: stringRule });
const secretResource = resource("secrets/[A-Za-z0-9_-]+"), secretEnv = object({ name: envName, secretResource, version: decimal });
const volume = object({ volumeName: pattern(/^[A-Za-z0-9_.-]+$/), mountPath: absolute, secretResource, defaultMode: integer(0, 511),
  items: (v, p) => { array(object({ path: relative, version: decimal, mode: nullable(integer(1, 511)) }), order("path"))(v, p);
    if ((v as unknown[]).length === 0) refuse(p, "explicit secret items required"); } });
const network: Rule = (v, p) => {
  const kind = plainRecord(v, p).kind, egress = literal("private-ranges-only", "all-traffic");
  if (kind === "none") object({ kind: literal("none") })(v, p);
  else if (kind === "connector") object({ kind: literal("connector"), connectorResource: resource("locations/[a-z0-9-]+/connectors/[a-z0-9-]+"), egress })(v, p);
  else if (kind === "direct-vpc") object({ kind: literal("direct-vpc"), networkResource: resource("global/networks/[a-z0-9-]+"),
    subnetworkResource: resource("regions/[a-z0-9-]+/subnetworks/[a-z0-9-]+"), networkTags: sortedText, egress })(v, p);
  else refuse(p, "unsupported network");
};
const iam: Rule = (v, p) => {
  object({ version: literal(1, 3), bindings: array(object({ role: pattern(/^(?:roles\/[A-Za-z0-9_.]+|projects\/[a-z][a-z0-9-]*\/roles\/[A-Za-z0-9_.]+|organizations\/[1-9][0-9]*\/roles\/[A-Za-z0-9_.]+)$/),
    members: sortedText, condition: nullable(object({ expression: text, title: stringRule, description: stringRule })) }), canonicalJSON) })(v, p);
  const policy = v as C.IamAllowPolicyV1;
  if (policy.bindings.some(b => !b.members.length || (b.condition !== null && policy.version !== 3))) refuse(p, "invalid IAM condition/version");
};
const runtimeUpdate: Rule = (v, p) => {
  const kind = plainRecord(v, p).kind;
  if (kind === "automatic") object({ kind: literal("automatic"), baseImageUri: nullable(text) })(v, p);
  else if (kind === "on-deploy") object({ kind: literal("on-deploy"), runtimeVersion: text, baseImageUri: literal(null) })(v, p);
  else refuse(p, "unsupported update policy");
};
const cloudSchema = object({ ...identityFields, schemaVersion: literal(1), kind: literal("google-cloud"), endpointName, region: literal("us-central1"),
  functionGeneration: literal("GEN_2"), runtime: literal("nodejs22"), entryPoint: endpointName,
  functionResource: resource("locations/[a-z0-9-]+/functions/[A-Za-z0-9_-]+"), buildResource: resource("locations/[a-z0-9-]+/builds/[A-Za-z0-9_-]+"),
  serviceResource: resource("locations/[a-z0-9-]+/services/[a-z0-9-]+"), revisionResource: resource("locations/[a-z0-9-]+/services/[a-z0-9-]+/revisions/[a-z0-9-]+"),
  traffic: tuple(object({ revisionResource: resource("locations/[a-z0-9-]+/services/[a-z0-9-]+/revisions/[a-z0-9-]+"), percent: literal(100), tag: literal(null) })),
  invocation: object({ invokerIamDisabled: bool, defaultUriDisabled: bool, iapEnabled: bool, customAudiences: sortedText,
    functionAllowPolicy: iam, serviceAllowPolicy: iam, accessReviewReceipt: contentObject }),
  execution: object({ serviceAccountEmail: accountEmail, timeoutNanoseconds: boundedDecimal(3600000000000n), concurrency: integer(1, 1000), memoryBytes: decimal,
    cpuMilli: integer(1), minimumInstances: integer(0, int32Maximum), maximumInstances: nullable(integer(1, int32Maximum)), command: array(stringRule), args: array(stringRule),
    workingDirectory: nullable(text), environmentVariables: array(plainEnv, order("name")), secretEnvironmentBindings: array(secretEnv, order("name")),
    secretVolumeBindings: array(volume, order("volumeName")), ingress: literal("all", "internal", "internal-and-load-balancing"), network }),
  build: object({ serviceAccountResource: resource("serviceAccounts/[A-Za-z0-9_.-]+@[a-z0-9.-]+\\.gserviceaccount\\.com"),
    environmentVariables: array(plainEnv, order("name")), dockerRepositoryResource: resource("locations/[a-z0-9-]+/repositories/[A-Za-z0-9_-]+"),
    source: contentObject, runtimeUpdatePolicy: runtimeUpdate }), observedImage: object({ repository: text, digest }) });
const emulatorSchema = object({ schemaVersion: literal(1), kind: literal("emulator"), endpointName, entryPoint: endpointName,
  projectId: projectName, projectNumber: literal("0"), environment: literal("emulator"), region: literal("us-central1"), runtime: literal("nodejs22"),
  localProfileFingerprint: digest, authOrigin: text, firestoreHost: text, functionsOrigin: text });
function loopback(origin: string, path: string, hostOnly = false): void {
  let parsed: URL; try { parsed = new URL(hostOnly ? `http://${origin}` : origin); } catch { return refuse(path, "invalid loopback destination"); }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || parsed.protocol !== "http:" || parsed.username || parsed.password ||
      parsed.pathname !== "/" || parsed.search || parsed.hash || !parsed.port || (hostOnly ? parsed.host !== origin : parsed.origin !== origin)) refuse(path, "canonical loopback destination required");
}
function endpointRule(expected?: C.ExpectedEnvironment): Rule {
  return (v, p) => {
    const kind = plainRecord(v, p).kind;
    if (kind === "google-cloud") {
      identified(cloudSchema, expected)(v, p); const e = v as C.CloudEndpointConfigurationV1;
      if (String(e.environment) === "emulator") refuse(p, "cloud cannot be emulator");
      const prefix = `projects/${e.projectId}/locations/us-central1/`;
      if (e.entryPoint !== e.endpointName || e.functionResource !== `${prefix}functions/${e.endpointName}` ||
          !e.serviceResource.startsWith(`${prefix}services/`) || !e.buildResource.startsWith(`projects/${e.projectId}/`) ||
          !e.revisionResource.startsWith(`${e.serviceResource}/revisions/`) || e.traffic[0].revisionResource !== e.revisionResource) refuse(p, "endpoint resource mismatch");
      if (e.execution.maximumInstances !== null && e.execution.minimumInstances > e.execution.maximumInstances) refuse(p, "contradictory scaling");
      if (e.execution.environmentVariables.some(a => e.execution.secretEnvironmentBindings.some(b => a.name === b.name))) refuse(p, "secret/plain collision");
      if (new Set(e.execution.secretVolumeBindings.map(b => b.mountPath)).size !== e.execution.secretVolumeBindings.length) refuse(p, "duplicate mounts");
      for (const variable of e.execution.environmentVariables) if (variable.name === "FIREBASE_CONFIG") {
        let config: unknown; try { config = parseStrictJSON(variable.value); } catch { return refuse(p, "malformed FIREBASE_CONFIG"); }
        if (plainRecord(config, p).projectId !== e.projectId) refuse(p, "FIREBASE_CONFIG project mismatch");
      }
    } else if (kind === "emulator") {
      identified(emulatorSchema, expected)(v, p); const e = v as C.EmulatorEndpointConfigurationV1, profile = expected?.localProfile;
      if (!profile || e.entryPoint !== e.endpointName || e.localProfileFingerprint !== profile.fingerprint || e.authOrigin !== profile.authOrigin ||
          e.firestoreHost !== profile.firestoreHost || e.functionsOrigin !== profile.functionsOrigin) refuse(p, "matching explicit local profile required");
      loopback(e.authOrigin, p); loopback(e.firestoreHost, p, true); loopback(e.functionsOrigin, p);
    } else refuse(p, "unsupported endpoint kind");
  };
}
export const validateEndpoint = (v: unknown, expected?: C.ExpectedEnvironment): StructuralResult<C.EndpointConfigurationV1> => validate(endpointRule(expected), v);
const candidate = object({ sourceSha: sha, sourceTree: sha, runtimePayloadFingerprint: digest, functionsArtifactFingerprint: digest, placementFingerprint: digest,
  enforcementVersion: literal("teacher-units-a3-v1"), clientContractVersion: contract, deploymentMode: literal("policy-controlled"), deploymentPlan: contentObject });
const authority = object(Object.fromEntries(["authorityId", "approverSubject", "approvalSystemId", "workflowId", "workflowRunId", "decisionId"].map(k => [k, text])));
const activationFields = { ...identityFields, policyInstanceId: uuid, enabledGeneration: generation, backendReleaseId: digest, clientContractVersion: contract,
  placementFingerprint: digest, hostingCandidateFingerprint: digest, certificationEvidenceRef: evidenceReferenceRule };
const activationSchema = object({ ...activationFields, schemaVersion: literal(1), kind: literal("teacher-units-activation"), authorizationEvidenceRef: evidenceReferenceRule });
const deploymentStatement = object({ ...identityFields, schemaVersion: literal(1), kind: literal("teacher-units-deployment-approval"), action: literal("deploy-backend"),
  region: literal("us-central1"), databaseId: literal("(default)"), candidate, authority, issuedAt: instant });
const activationStatement = object({ ...activationFields, schemaVersion: literal(1), kind: literal("teacher-units-activation-approval"), action: literal("activate-teacher-units"), authority, issuedAt: instant });
const dispositionStatement: Rule = (v, p) => {
  object({ ...identityFields, schemaVersion: literal(1), kind: literal("teacher-units-approval-disposition"), action: literal("revoke", "supersede"),
    targetApprovalRef: evidenceReferenceRule, replacementApprovalRef: nullable(evidenceReferenceRule), authority, issuedAt: instant })(v, p);
  const s = v as C.ApprovalDispositionStatementV1;
  if ((s.action === "revoke" && s.replacementApprovalRef !== null) || (s.action === "supersede" && (!s.replacementApprovalRef || s.replacementApprovalRef === s.targetApprovalRef))) refuse(p, "contradictory disposition");
};
const signature: Rule = (v, p) => { pattern(/^[A-Za-z0-9+/]{86}==$/)(v, p); const bytes = Buffer.from(v as string, "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== v) refuse(p, "noncanonical signature encoding"); };
const source = object({ statementObject: contentObject, signerKeyId: text, signatureAlgorithm: literal("ed25519"), signatureBase64: signature });
function approvalRule(kind: string, statement: Rule, expected?: C.ExpectedEnvironment): Rule {
  return object({ schemaVersion: literal(1), payload: (v, p) => {
    object({ schemaVersion: literal(1), kind: literal(kind), statement: identified(statement, expected), source })(v, p);
    const payload = v as C.DeploymentApprovalPayloadV1;
    if (payload.source.statementObject.sha256 !== contentDigest(payload.statement)) refuse(p, "statement digest mismatch");
  } });
}
export const validateDeploymentApproval = (v: unknown, expected?: C.ExpectedEnvironment): StructuralResult<C.DeploymentApprovalDocumentV1> => validate(approvalRule("teacher-units-deployment-approval", deploymentStatement, expected), v);
export const validateActivationApproval = (v: unknown, expected?: C.ExpectedEnvironment): StructuralResult<C.ActivationApprovalDocumentV1> => validate(approvalRule("teacher-units-activation-approval", activationStatement, expected), v);
export const validateApprovalDisposition = (v: unknown, expected?: C.ExpectedEnvironment): StructuralResult<C.ApprovalDispositionDocumentV1> => validate(approvalRule("teacher-units-approval-disposition", dispositionStatement, expected), v);
export const validateActivationEvidence = (v: unknown, expected?: C.ExpectedEnvironment): StructuralResult<C.ActivationEvidenceDocumentV1> => validate(object({ schemaVersion: literal(1), payload: identified(activationSchema, expected) }), v);
function releaseRule(expected?: C.ExpectedEnvironment): Rule {
  return object({ schemaVersion: literal(1), manifest: (v, p) => {
    identified(object({ ...identityFields, schemaVersion: literal(1), enforcementVersion: literal("teacher-units-a3-v1"), region: literal("us-central1"), databaseId: literal("(default)"),
      deploymentMode: literal("policy-controlled"), sourceSha: sha, sourceTree: sha, runtimePayloadFingerprint: digest, functionsArtifactFingerprint: digest, placementFingerprint: digest,
      supportedClientContractVersions: tuple(contract), endpoints: array(endpointRule(expected), order("endpointName")),
      rules: object({ rulesetResource: nullable(resource("rulesets/[A-Za-z0-9_-]+")), sourceHash: digest }), readyIndexesConfigurationHash: digest, deploymentApprovalEvidenceRef: evidenceReferenceRule }), expected)(v, p);
    const m = v as C.BackendReleaseManifestV1;
    if (m.endpoints.length !== ENDPOINTS.length || m.endpoints.some((e, i) => e.endpointName !== ENDPOINTS[i] || e.environment !== m.environment || e.projectId !== m.projectId || e.projectNumber !== m.projectNumber)) refuse(p, "exact matching nine required");
    if (m.environment === "emulator" ? m.rules.rulesetResource !== null : !m.rules.rulesetResource?.startsWith(`projects/${m.projectId}/rulesets/`)) refuse(p, "Rules environment mismatch");
    if (m.environment !== "emulator") for (const key of ["functionResource", "serviceResource", "revisionResource"] as const) {
      const entries = m.endpoints as C.CloudEndpointConfigurationV1[];
      if (new Set(entries.map(e => e[key])).size !== entries.length) refuse(p, "duplicate resources");
    }
  } });
}
export const validateBackendRelease = (v: unknown, expected?: C.ExpectedEnvironment): StructuralResult<C.BackendReleaseDocumentV1> => validate(releaseRule(expected), v);
export const validateEnvironment = (v: unknown, expected?: C.ExpectedEnvironment): StructuralResult<C.EnvironmentBinding> => validate(identified(object(identityFields), expected), v);
export const validateGeneration = (v: unknown): StructuralResult<number> => validate(generation, v);
export const validatePlacementFingerprint = (v: unknown): StructuralResult<string> => validate(digest, v);
export const validateDeploymentApprovalStatement = (v: unknown, expected?: C.ExpectedEnvironment): StructuralResult<C.DeploymentApprovalStatementV1> => validate(identified(deploymentStatement, expected), v);
export const validateActivationApprovalStatement = (v: unknown, expected?: C.ExpectedEnvironment): StructuralResult<C.ActivationApprovalStatementV1> => validate(identified(activationStatement, expected), v);
export const validateApprovalDispositionStatement = (v: unknown, expected?: C.ExpectedEnvironment): StructuralResult<C.ApprovalDispositionStatementV1> => validate(identified(dispositionStatement, expected), v);
