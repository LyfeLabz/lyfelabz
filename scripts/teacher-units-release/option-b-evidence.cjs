'use strict';
// Offline supplied-artifact inspection only. No provider API, credentials,
// approval, availability check, archive rewrite or legacy-to-active fallback.
const path = require('node:path');
const HISTORICAL_FORMAT = 'teacher-units-a3-runtime-build-v1';
const OPTION_B_FORMAT = 'teacher-units-option-b-runtime-build-v2';
const LIB = path.resolve(__dirname, '../../platform/functions/lib/teacherUnits');

/** Dependency injection is for local tests of the same source without a full
 * Functions build. Readers are trusted code, never selected from input data. */
function createEvidenceInspector({ activeBuild, legacyBuild, canonical }) {
  return function inspectEvidence(request) {
    const d = Object.getOwnPropertyDescriptors(request ?? {});
    if (Object.getPrototypeOf(request ?? {}) !== Object.prototype || Reflect.ownKeys(d).length !== 2 ||
        !d.format || !d.artifactRoot || Object.values(d).some(v => !v.enumerable || !Object.hasOwn(v, 'value'))) {
      throw new Error('REFUSED: exact format and artifactRoot required');
    }
    const { format, artifactRoot } = request;
    if (![OPTION_B_FORMAT, HISTORICAL_FORMAT].includes(format)) throw new Error('REFUSED: unknown explicit evidence format');
    if (typeof artifactRoot !== 'string' || !path.isAbsolute(artifactRoot)) throw new Error('REFUSED: explicit absolute local artifactRoot required');
    // No sniffing, catch-and-retry, widening or conversion of historical data.
    const inspected = format === OPTION_B_FORMAT
      ? activeBuild.inspectAvailabilityRuntimeArtifact(artifactRoot)
      : legacyBuild.inspectRuntimeArtifact(artifactRoot);
    const result = { schemaVersion: 1, kind: format === OPTION_B_FORMAT
      ? 'teacher-units-option-b-build-evidence-v1' : 'teacher-units-historical-build-inspection-v1', format,
    scope: format === OPTION_B_FORMAT ? 'application-content-consistency-only' : 'historical-inspection-only',
    authority: 'none', operationalVerification: 'unverified',
    build: inspected.build, runtimeFiles: inspected.runtimeFiles,
    runtimePayloadFingerprint: inspected.runtimePayloadFingerprint,
    functionsArtifactFingerprint: inspected.functionsArtifactFingerprint, placementFingerprint: inspected.placementFingerprint };
    // Return independent data in the unchanged canonical encoding. No outcome
    // field is named eligible/authorized/certified and no policy is evaluated.
    return JSON.parse(canonical.canonicalJSON(result));
  };
}
function inspectEvidence(request) {
  // Lazy imports keep the historical reader usable before the B writer cutover.
  const format = Object.getOwnPropertyDescriptor(request ?? {}, 'format')?.value;
  if (![OPTION_B_FORMAT, HISTORICAL_FORMAT].includes(format)) throw new Error('REFUSED: unknown explicit evidence format');
  return createEvidenceInspector({
    activeBuild: format === OPTION_B_FORMAT ? require(path.join(LIB, 'availability-runtime-build.js')) : null,
    legacyBuild: format === HISTORICAL_FORMAT ? require(path.join(LIB, 'a3-runtime-artifact.js')) : null,
    canonical: require(path.join(LIB, 'a3-canonical.js')),
  })(request);
}
module.exports = { HISTORICAL_FORMAT, OPTION_B_FORMAT, createEvidenceInspector, inspectEvidence };
