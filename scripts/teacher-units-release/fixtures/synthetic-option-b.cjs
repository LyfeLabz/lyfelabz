'use strict';
// SYNTHETIC FIXTURE - NOT PROVIDER-VERIFIED. Invented local application bytes,
// never a real deployment, release approval, certification or availability.
const SYNTHETIC = 'synthetic, not provider-verified';
const BUILD_PATH = 'lib/teacherUnits/a3-runtime-build.json';
const defaultFiles = Object.freeze({
  'lib/index.js': '// synthetic Option B application\n',
  'lib/teacherUnits/unit-placeable-resources.json': '{"resourceIds":["one","two"]}',
  'package.json': '{"name":"synthetic-option-b"}', 'package-lock.json': '{"lockfileVersion":3}',
});
/** Helpers are explicit trusted modules from the source under test. Does not
 * mutate the archived synthetic-capture fixture or write any artifact. */
function buildFixture({ build, canonical, mode = 'closed-only', dirty = false, files = defaultFiles } = {}) {
  const payload = { ...files }; delete payload[BUILD_PATH];
  const hashes = Object.fromEntries(Object.entries(payload).map(([name, body]) => [name, canonical.sha256Bytes(body)]));
  const placement = canonical.parseStrictJSON(payload['lib/teacherUnits/unit-placeable-resources.json']);
  const input = { schemaVersion: 2, enforcementVersion: 'teacher-units-option-b-v1', deploymentMode: mode,
    sourceSha: 'a'.repeat(40), sourceTree: 'b'.repeat(40), sourceDirty: dirty,
    runtimePayloadFingerprint: canonical.contentDigest(hashes), placementFingerprint: canonical.contentDigest(placement.resourceIds),
    supportedClientContractVersions: ['teacher-units-v3'] };
  const derived = build.deriveBackendBuildId(input);
  if (!derived.ok) throw new Error(`Invalid synthetic build inputs: ${derived.issue.reason}`);
  const record = { ...input, backendBuildId: derived.value };
  return { provenance: SYNTHETIC, record, files: { ...payload, [BUILD_PATH]: `${canonical.canonicalJSON(record)}\n` } };
}
function protocolFixture() {
  const compatibility = { schemaVersion: 2, clientContractVersion: 'teacher-units-v3',
    policyInstanceId: '00000000-0000-4000-8000-000000000001', policyGeneration: 3,
    backendReleaseId: 'a'.repeat(64), placementFingerprint: 'b'.repeat(64) };
  const capabilityRequest = { schemaVersion: 3, nonce: 'synthetic_nonce_123', clientContractVersion: 'teacher-units-v3' };
  const capabilityResponse = { schemaVersion: 3, nonce: capabilityRequest.nonce,
    backend: { projectId: 'lyfelabz-staging', environment: 'staging', region: 'us-central1',
      enforcementVersion: 'teacher-units-option-b-v1', backendBuildId: compatibility.backendReleaseId },
    teacherUnits: { apiContractVersion: 'teacher-units-v3',
      supportedOperations: ['create', 'list', 'get', 'update', 'archive', 'restore', 'setResources', 'reorder'],
      supportedClientContractVersions: ['teacher-units-v3'], acceptedClientContractVersions: ['teacher-units-v3'],
      placementFingerprint: compatibility.placementFingerprint,
      availability: { state: 'enabled', policyInstanceId: compatibility.policyInstanceId,
        policyGeneration: compatibility.policyGeneration, backendReleaseId: compatibility.backendReleaseId, deploymentEligible: true } },
    caller: { uid: 'synthetic-teacher', role: 'teacher', schoolId: 'synthetic-school', districtId: 'synthetic-district' } };
  return { provenance: SYNTHETIC, compatibility, capabilityRequest, capabilityResponse };
}
module.exports = { SYNTHETIC, BUILD_PATH, defaultFiles, buildFixture, protocolFixture };
