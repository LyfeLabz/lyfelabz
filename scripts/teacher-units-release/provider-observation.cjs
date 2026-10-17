'use strict';

// A3-6 S4: separate nine-endpoint provider observer (D10, D15). Read-only: the
// only I/O is the injected GET transport. It produces a private observation
// record, never an A3-1 release, approval or availability document, and it
// confers no authority. The A1 eight-endpoint observer is unchanged; its GET
// helpers and archive fingerprinting are reused, not copied.
//
// Provider field names follow the Cloud Functions v2 and Cloud Run v2 message
// definitions shipped in the Google Cloud SDK (generated_clients/apis/
// cloudfunctions/v2 and run/v2, SDK 583.0.0). A field outside those lists is
// unknown and refuses. A documented field whose meaning cannot be established
// without a live observation refuses when present (gates G1, G2, G4).
const path = require('node:path');
const { PROJECT_NUMBERS, MAX_AGE_MS, LIMITS, canonical, fingerprint, list, normalizeRemoteIndexes, archiveRuntime,
  resource, onlyKeys } = require('../hosting-release/backend-state.cjs');
const { sha256 } = require('../hosting-release/contract.cjs');

const LIB = path.resolve(__dirname, '../../platform/functions/lib/teacherUnits');
function compiled(name) {
  try { return require(path.join(LIB, name)); }
  catch { return refuse(`compiled A3 module ${name} unavailable; run npm --prefix platform/functions run build`); }
}
const P = compiled('a3-protocol.js');
const V = compiled('a3-validation.js');
const K = compiled('a3-canonical.js');

const OBSERVATION_KIND = 'lyfelabz.teacherUnitsA3ProviderObservation';
const PLAN_KIND = 'lyfelabz.teacherUnitsA3DeploymentPlan';
const REGION = 'us-central1';
const ENDPOINTS = Object.freeze([...V.ENDPOINTS]);
const ENVIRONMENTS = Object.freeze({ 'lyfelabz-prod': 'production', 'lyfelabz-staging': 'staging' });
const RUNTIME_BUILD_PATH = 'lib/teacherUnits/a3-runtime-build.json';
const SOURCES = Object.freeze(['Firebase Management GET', 'Firestore Admin database/index/field GET',
  'Cloud Functions v2 LIST/GET', 'Cloud Run v2 service/revision GET', 'generation-pinned Cloud Storage GET', 'Firebase Rules release/ruleset GET']);

function refuse(message) { throw new Error(`[a3-provider-observation] REFUSED: ${message}`); }

// Documented field sets (SDK 583.0.0 generated messages).
const FIELDS = Object.freeze({
  function: ['buildConfig', 'buildpackStack', 'createTime', 'description', 'environment', 'eventTrigger', 'kmsKeyName', 'labels',
    'name', 'satisfiesPzi', 'satisfiesPzs', 'serviceConfig', 'state', 'stateMessages', 'updateTime', 'upgradeInfo', 'url'],
  buildConfig: ['automaticUpdatePolicy', 'build', 'dockerRegistry', 'dockerRepository', 'entryPoint', 'environmentVariables',
    'onDeployUpdatePolicy', 'runtime', 'serviceAccount', 'source', 'sourceProvenance', 'sourceToken', 'workerPool'],
  serviceConfig: ['allTrafficOnLatestRevision', 'availableCpu', 'availableMemory', 'binaryAuthorizationPolicy', 'directVpcEgress',
    'directVpcNetworkInterface', 'environmentVariables', 'ingressSettings', 'maxInstanceCount', 'maxInstanceRequestConcurrency',
    'minInstanceCount', 'revision', 'secretEnvironmentVariables', 'secretVolumes', 'securityLevel', 'service', 'serviceAccountEmail',
    'timeoutSeconds', 'uri', 'vpcConnector', 'vpcConnectorEgressSettings'],
  source: ['gitUri', 'repoSource', 'storageSource'],
  sourceProvenance: ['gitUri', 'resolvedRepoSource', 'resolvedStorageSource'],
  storageSource: ['bucket', 'generation', 'object', 'sourceUploadUrl'],
  service: ['annotations', 'binaryAuthorization', 'buildConfig', 'client', 'clientVersion', 'conditions', 'createTime', 'creator',
    'customAudiences', 'defaultUriDisabled', 'deleteTime', 'description', 'durableExecution', 'etag', 'expireTime', 'generation',
    'iapEnabled', 'ingress', 'invokerIamDisabled', 'labels', 'lastModifier', 'latestCreatedRevision', 'latestReadyRevision',
    'launchStage', 'multiRegionSettings', 'name', 'observedGeneration', 'reconciling', 'satisfiesPzs', 'scaling', 'sshEnabled',
    'template', 'terminalCondition', 'threatDetectionEnabled', 'traffic', 'trafficStatuses', 'uid', 'updateTime', 'uri', 'urls'],
  revision: ['annotations', 'client', 'clientVersion', 'conditions', 'containers', 'createTime', 'creator', 'deleteTime',
    'encryptionKey', 'encryptionKeyRevocationAction', 'encryptionKeyShutdownDuration', 'etag', 'executionEnvironment', 'expireTime',
    'generation', 'gpuZonalRedundancyDisabled', 'labels', 'launchStage', 'logUri', 'maxInstanceRequestConcurrency', 'name',
    'nodeSelector', 'observedGeneration', 'reconciling', 'sandboxes', 'satisfiesPzs', 'scaling', 'scalingStatus', 'service',
    'serviceAccount', 'serviceMesh', 'sessionAffinity', 'terminationGracePeriod', 'timeout', 'uid', 'updateTime', 'volumes', 'vpcAccess'],
  revisionTemplate: ['annotations', 'client', 'clientVersion', 'containers', 'encryptionKey', 'encryptionKeyRevocationAction',
    'encryptionKeyShutdownDuration', 'executionEnvironment', 'gpuZonalRedundancyDisabled', 'healthCheckDisabled', 'labels',
    'maxInstanceRequestConcurrency', 'nodeSelector', 'revision', 'sandboxes', 'scaling', 'serviceAccount', 'serviceMesh',
    'sessionAffinity', 'terminationGracePeriod', 'timeout', 'volumes', 'vpcAccess'],
  // Firebase Rules v1 and Firestore Admin v1 messages (same SDK).
  rulesRelease: ['createTime', 'disabled', 'name', 'rulesetName', 'updateTime'],
  ruleset: ['attachmentPoint', 'createTime', 'metadata', 'name', 'source'],
  rulesSource: ['files', 'language'],
  rulesFile: ['content', 'fingerprint', 'name'],
  database: ['appEngineIntegrationMode', 'cmekConfig', 'concurrencyMode', 'createTime', 'databaseEdition', 'deleteProtectionState',
    'deleteTime', 'earliestVersionTime', 'etag', 'firestoreDataAccessMode', 'freeTier', 'freeTierLimited', 'keyPrefix', 'locationId',
    'mongodbCompatibleDataAccessMode', 'name', 'pointInTimeRecoveryEnablement', 'previousId', 'realtimeUpdatesMode', 'sourceInfo',
    'tags', 'type', 'uid', 'updateTime', 'versionRetentionPeriod'],
  container: ['args', 'baseImageUri', 'buildConfig', 'buildInfo', 'command', 'dependsOn', 'env', 'image', 'livenessProbe', 'name',
    'ports', 'readinessProbe', 'resources', 'sandboxLauncher', 'sourceCode', 'startupProbe', 'volumeMounts', 'workingDir'],
  condition: ['buildReason', 'executionReason', 'instanceReason', 'lastTransitionTime', 'message', 'reason', 'revisionReason',
    'severity', 'state', 'type'],
  traffic: ['percent', 'revision', 'tag', 'type'],
  trafficStatus: ['percent', 'revision', 'tag', 'type', 'uri'],
  envVar: ['name', 'value', 'valueSource'],
  envVarSource: ['secretKeyRef'],
  secretKeySelector: ['secret', 'version'],
  resources: ['cpuIdle', 'limits', 'startupCpuBoost'],
  revisionScaling: ['concurrencyUtilization', 'cpuUtilization', 'maxInstanceCount', 'minInstanceCount'],
  serviceScaling: ['manualInstanceCount', 'maxInstanceCount', 'minInstanceCount', 'scalingMode'],
  volume: ['cloudSqlInstance', 'emptyDir', 'gcs', 'name', 'nfs', 'secret'],
  secretVolume: ['defaultMode', 'items', 'secret'],
  versionToPath: ['mode', 'path', 'version'],
  volumeMount: ['mountPath', 'name', 'subPath'],
  vpcAccess: ['connector', 'egress', 'networkInterfaces'],
  networkInterface: ['network', 'subnetwork', 'tags'],
});

// --- small pure helpers -----------------------------------------------------
function record(value, fields, description) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse(`${description} missing or not an object`);
  onlyKeys(value, fields, `${description} field (unknown provider field)`);
  return value;
}
function absent(value, key, description) {
  if (value[key] !== undefined) refuse(`${description}.${key} is present; unreviewed configuration`);
}
function falsy(value, key, description) {
  if (value[key] !== undefined && value[key] !== false) refuse(`${description}.${key} must be absent or false`);
}
function stringMap(value, description) {
  if (value === undefined) return [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse(`${description} must be a string map`);
  return Object.keys(value).sort().map(name => {
    if (typeof value[name] !== 'string') refuse(`${description} has a non-string value for ${name}`);
    return { name, value: value[name] };
  });
}
function arrayOf(value, description) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) refuse(`${description} must be an array`);
  return value;
}
// Proto3 JSON omits zero-valued scalars; int32 is a JSON number, int64 a decimal string.
function int32(value, description, fallback = 0) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647) refuse(`${description} is not a valid int32`);
  return value;
}
function int64(value, description) {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(text)) refuse(`${description} is not a valid int64`);
  return text;
}
// Cloud Run returns project IDs or numbers in resource names; bind both to the pinned ID.
function projectResource(name, project, suffix, description) {
  if (typeof name !== 'string') refuse(`${description} missing`);
  resource(name, project, suffix);
  const numbered = `projects/${PROJECT_NUMBERS[project]}/`;
  return name.startsWith(numbered) ? `projects/${project}/${name.slice(numbered.length)}` : name;
}
function memoryBytes(quantity, description) {
  const m = typeof quantity === 'string' && /^([1-9][0-9]*)(Ki|Mi|Gi|Ti|k|M|G|T)?$/.exec(quantity);
  if (!m) refuse(`${description} memory is missing or unverifiable`);
  const scale = { Ki: 1024n, Mi: 1024n ** 2n, Gi: 1024n ** 3n, Ti: 1024n ** 4n, k: 1000n, M: 1000n ** 2n, G: 1000n ** 3n, T: 1000n ** 4n }[m[2]] || 1n;
  return String(BigInt(m[1]) * scale);
}
function cpuMilli(quantity, description) {
  let milli;
  const m = typeof quantity === 'string' && /^(?:([1-9][0-9]*)m|([0-9]+)(?:\.([0-9]{1,3}))?)$/.exec(quantity);
  if (m) milli = m[1] !== undefined ? Number(m[1]) : Number(m[2]) * 1000 + Number((m[3] || '').padEnd(3, '0') || 0);
  if (!m || !Number.isSafeInteger(milli) || milli <= 0) refuse(`${description} CPU is missing or unverifiable`);
  return milli;
}
function durationNanos(value, description) {
  const m = typeof value === 'string' && /^([0-9]+)(?:\.([0-9]{1,9}))?s$/.exec(value);
  if (!m) refuse(`${description} timeout is missing or unverifiable`);
  const nanos = BigInt(m[1]) * 1000000000n + BigInt((m[2] || '').padEnd(9, '0') || '0');
  if (nanos <= 0n) refuse(`${description} timeout must be positive`);
  return String(nanos);
}

// --- pure endpoint normalization ---------------------------------------------
function secretResource(secret, project, description) {
  if (typeof secret !== 'string' || !secret) refuse(`${description} secret missing`);
  if (/^[A-Za-z0-9_-]+$/.test(secret)) return `projects/${project}/secrets/${secret}`;
  return projectResource(secret, project, /\/secrets\/[A-Za-z0-9_-]+$/, `${description} secret`);
}
function secretVersion(version, description) {
  // latest, aliases and an absent version (which resolves to latest) are refused.
  if (typeof version !== 'string' || !/^[1-9][0-9]*$/.test(version)) refuse(`${description} requires an explicit numeric secret version; latest and aliases are refused`);
  return version;
}
function normalizeEnvironment(env, project, description) {
  const plain = [], secrets = [];
  for (const entry of arrayOf(env, `${description} env`)) {
    record(entry, FIELDS.envVar, `${description} env`);
    if (typeof entry.name !== 'string' || !entry.name) refuse(`${description} env name missing`);
    if (entry.valueSource !== undefined) {
      if (entry.value !== undefined) refuse(`${description} env ${entry.name} has both a value and a secret source`);
      record(entry.valueSource, FIELDS.envVarSource, `${description} env source`);
      const ref = record(entry.valueSource.secretKeyRef, FIELDS.secretKeySelector, `${description} secret reference`);
      secrets.push({ name: entry.name, secretResource: secretResource(ref.secret, project, `${description} env ${entry.name}`),
        version: secretVersion(ref.version, `${description} env ${entry.name}`) });
    } else {
      if (entry.value !== undefined && typeof entry.value !== 'string') refuse(`${description} env ${entry.name} value must be a string`);
      plain.push({ name: entry.name, value: entry.value ?? '' });
    }
  }
  const byName = rows => [...rows].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const names = [...plain, ...secrets].map(e => e.name);
  if (new Set(names).size !== names.length) refuse(`${description} has duplicate or colliding environment variable names`);
  return { environmentVariables: byName(plain), secretEnvironmentBindings: byName(secrets) };
}
function normalizeVolumes(volumes, mounts, project, description) {
  const byName = new Map();
  for (const volume of arrayOf(volumes, `${description} volumes`)) {
    record(volume, FIELDS.volume, `${description} volume`);
    for (const kind of ['cloudSqlInstance', 'emptyDir', 'gcs', 'nfs']) absent(volume, kind, `${description} volume`);
    if (typeof volume.name !== 'string' || !volume.name || byName.has(volume.name)) refuse(`${description} volume name missing or duplicate`);
    byName.set(volume.name, record(volume.secret, FIELDS.secretVolume, `${description} secret volume`));
  }
  const used = new Set(), result = [];
  for (const mount of arrayOf(mounts, `${description} volume mounts`)) {
    record(mount, FIELDS.volumeMount, `${description} volume mount`);
    absent(mount, 'subPath', `${description} volume mount`);
    const source = byName.get(mount.name);
    if (!source || used.has(mount.name)) refuse(`${description} volume mount has no unique matching volume`);
    used.add(mount.name);
    if (source.defaultMode === undefined) refuse(`${description} secret volume defaultMode is unresolved`);
    const items = arrayOf(source.items, `${description} secret items`).map(item => {
      record(item, FIELDS.versionToPath, `${description} secret item`);
      return { path: item.path, version: secretVersion(item.version, `${description} secret item`), mode: item.mode === undefined ? null : item.mode };
    }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    if (!items.length) refuse(`${description} secret volume requires explicit items`);
    result.push({ volumeName: mount.name, mountPath: mount.mountPath, secretResource: secretResource(source.secret, project, `${description} volume`),
      defaultMode: source.defaultMode, items });
  }
  if (used.size !== byName.size) refuse(`${description} has an unmounted volume`);
  return result.sort((a, b) => a.volumeName < b.volumeName ? -1 : a.volumeName > b.volumeName ? 1 : 0);
}
function normalizeNetwork(vpcAccess, project, description) {
  if (vpcAccess === undefined) return { kind: 'none' };
  record(vpcAccess, FIELDS.vpcAccess, `${description} VPC access`);
  const egress = { PRIVATE_RANGES_ONLY: 'private-ranges-only', ALL_TRAFFIC: 'all-traffic' }[vpcAccess.egress];
  const interfaces = arrayOf(vpcAccess.networkInterfaces, `${description} network interfaces`);
  if (vpcAccess.connector === undefined && !interfaces.length) {
    if (Object.keys(vpcAccess).length) refuse(`${description} VPC access is ambiguous`);
    return { kind: 'none' };
  }
  if (!egress) refuse(`${description} VPC egress is missing or unknown`);
  if (vpcAccess.connector !== undefined) {
    if (interfaces.length) refuse(`${description} VPC access has both a connector and network interfaces`);
    return { kind: 'connector', connectorResource: projectResource(vpcAccess.connector, project, /\/locations\/[a-z0-9-]+\/connectors\/[a-z0-9-]+$/, `${description} connector`), egress };
  }
  if (interfaces.length !== 1) refuse(`${description} requires exactly one direct VPC network interface`);
  const nic = record(interfaces[0], FIELDS.networkInterface, `${description} network interface`);
  return { kind: 'direct-vpc', networkResource: projectResource(nic.network, project, /\/global\/networks\/[a-z0-9-]+$/, `${description} network`),
    subnetworkResource: projectResource(nic.subnetwork, project, /\/regions\/[a-z0-9-]+\/subnetworks\/[a-z0-9-]+$/, `${description} subnetwork`),
    networkTags: [...new Set(arrayOf(nic.tags, `${description} network tags`))].sort(), egress };
}
// A JSON object message: not null, not an array, not a primitive.
function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function normalizeRuntimeUpdate(build, container, description) {
  const automatic = build.automaticUpdatePolicy !== undefined, onDeploy = build.onDeployUpdatePolicy !== undefined;
  if (automatic === onDeploy) refuse(`${description} runtime update policy is ambiguous or unobserved (G2)`);
  if (automatic) {
    // AutomaticUpdatePolicy is a documented empty message: exactly {}.
    if (!plainObject(build.automaticUpdatePolicy) || Object.keys(build.automaticUpdatePolicy).length) refuse(`${description} automatic update policy is unknown`);
    return { kind: 'automatic', baseImageUri: container.baseImageUri === undefined ? null : container.baseImageUri };
  }
  const policy = build.onDeployUpdatePolicy;
  if (!plainObject(policy) || Object.keys(policy).some(k => k !== 'runtimeVersion') || typeof policy.runtimeVersion !== 'string' || !policy.runtimeVersion) refuse(`${description} on-deploy update policy is unknown`);
  if (container.baseImageUri !== undefined) refuse(`${description} on-deploy policy with a base image is contradictory`);
  return { kind: 'on-deploy', runtimeVersion: policy.runtimeVersion, baseImageUri: null };
}

// --- strict nested shapes (F1) -----------------------------------------------
// Every accepted nested provider object is checked against its documented field
// set. An absent field normalizes to null, never to an inferred provider default.
const leaf = {
  str: (v, d) => typeof v === 'string' ? v : refuse(`${d} must be a string`),
  bool: (v, d) => typeof v === 'boolean' ? v : refuse(`${d} must be a boolean`),
  int32: (v, d) => int32(v, d),
  // A3 canonical JSON admits only safe integers, so fractional provider numbers
  // are carried as their exact JavaScript decimal text.
  num: (v, d) => typeof v === 'number' && Number.isFinite(v) ? String(v) : refuse(`${d} must be a finite number`),
  ts: (v, d) => { instant(v, d); return v; },
  secretVersion: (v, d) => secretVersion(v, d),
};
const enumOf = (...values) => (v, d) => values.includes(v) ? v : refuse(`${d} has an unknown value`);
const arr = item => ({ arr: item });
const MAP = { map: true };
function shape(schema, value, d) {
  if (value === undefined) return null;
  if (typeof schema === 'function') return schema(value, d);
  if (schema.arr) return arrayOf(value, d).map((item, i) => shape(schema.arr, item, `${d}[${i}]`));
  if (schema.map) return stringMap(value, d);
  record(value, Object.keys(schema.obj), d);
  return Object.fromEntries(Object.keys(schema.obj).sort().map(k => [k, shape(schema.obj[k], value[k], `${d}.${k}`)]));
}
const SHAPES = (() => {
  const { str, bool, int32: i32, num, ts, secretVersion: sv } = leaf;
  const probe = { obj: { failureThreshold: i32, grpc: { obj: { port: i32, service: str } },
    httpGet: { obj: { httpHeaders: arr({ obj: { name: str, value: str } }), path: str, port: i32 } },
    initialDelaySeconds: i32, periodSeconds: i32, tcpSocket: { obj: { port: i32 } }, timeoutSeconds: i32 } };
  return {
    probe, ports: arr({ obj: { containerPort: i32, name: str } }),
    buildInfo: { obj: { buildId: str, functionTarget: str, sourceLocation: str } },
    condition: { obj: { buildReason: str, executionReason: str, instanceReason: str, lastTransitionTime: ts, message: str,
      reason: str, revisionReason: str, severity: str, state: str, type: str } },
    scalingStatus: { obj: { desiredMinInstanceCount: i32 } },
    revisionScaling: { obj: { concurrencyUtilization: num, cpuUtilization: num, maxInstanceCount: i32, minInstanceCount: i32 } },
    serviceScaling: { obj: { manualInstanceCount: i32, maxInstanceCount: i32, minInstanceCount: i32,
      scalingMode: enumOf('SCALING_MODE_UNSPECIFIED', 'AUTOMATIC', 'MANUAL') } },
    binaryAuthorization: { obj: { breakglassJustification: str, policy: str, useDefault: bool } },
    functionsServiceConfig: { obj: {
      allTrafficOnLatestRevision: bool, availableCpu: str, availableMemory: str, binaryAuthorizationPolicy: str,
      directVpcEgress: enumOf('DIRECT_VPC_EGRESS_UNSPECIFIED', 'VPC_EGRESS_PRIVATE_RANGES_ONLY', 'VPC_EGRESS_ALL_TRAFFIC'),
      directVpcNetworkInterface: arr({ obj: { network: str, subnetwork: str, tags: arr(str) } }), environmentVariables: MAP,
      ingressSettings: enumOf('INGRESS_SETTINGS_UNSPECIFIED', 'ALLOW_ALL', 'ALLOW_INTERNAL_ONLY', 'ALLOW_INTERNAL_AND_GCLB'),
      maxInstanceCount: i32, maxInstanceRequestConcurrency: i32, minInstanceCount: i32, revision: str,
      secretEnvironmentVariables: arr({ obj: { key: str, projectId: str, secret: str, version: sv } }),
      secretVolumes: arr({ obj: { mountPath: str, projectId: str, secret: str, versions: arr({ obj: { path: str, version: sv } }) } }),
      securityLevel: enumOf('SECURITY_LEVEL_UNSPECIFIED', 'SECURE_ALWAYS', 'SECURE_OPTIONAL'), service: str, serviceAccountEmail: str,
      timeoutSeconds: i32, uri: str, vpcConnector: str,
      vpcConnectorEgressSettings: enumOf('VPC_CONNECTOR_EGRESS_SETTINGS_UNSPECIFIED', 'PRIVATE_RANGES_ONLY', 'ALL_TRAFFIC') } },
  };
})();
// Google JSON Timestamp (RFC 3339, Z-normalized, 0/3/6/9 fractional digits) to
// epoch nanoseconds. S4-local; A1's helper is unchanged (F4).
function instant(value, d) {
  const m = typeof value === 'string' && /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{3}|[0-9]{6}|[0-9]{9}))?Z$/.exec(value);
  if (!m) refuse(`${d} timestamp is missing or not canonical RFC 3339 UTC`);
  const [y, mo, da, h, mi, se] = m.slice(1, 7).map(Number);
  const ms = Date.UTC(y, mo - 1, da, h, mi, se);
  const date = new Date(ms);
  if (y < 1 || h > 23 || mi > 59 || se > 59 || date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== da) refuse(`${d} timestamp is not a valid calendar instant`);
  return BigInt(ms) * 1000000n + BigInt((m[7] || '').padEnd(9, '0') || '0');
}
// Ordering is checked only within one resource (create <= update) and against
// the observation clock (nothing the provider reports can be in the future).
function resourceTimes(value, d, at, required = []) {
  const times = {};
  for (const key of ['createTime', 'updateTime']) {
    if (value[key] === undefined) { if (required.includes(key)) refuse(`${d} ${key} missing`); continue; }
    times[key] = instant(value[key], `${d} ${key}`);
    if (times[key] > at) refuse(`${d} ${key} is in the future`);
  }
  if (times.createTime !== undefined && times.updateTime !== undefined && times.createTime > times.updateTime) refuse(`${d} createTime is after updateTime`);
}
function conditions(list, d, at) {
  return arrayOf(list, d).map(c => {
    const normalized = shape(SHAPES.condition, c, `${d} condition`);
    if (normalized.lastTransitionTime !== null && instant(normalized.lastTransitionTime, d) > at) refuse(`${d} condition transition is in the future`);
    return normalized;
  });
}
function conditionReady(c, d) {
  if (!c || c.state !== 'CONDITION_SUCCEEDED') refuse(`${d} is not ready (${c?.type || 'condition'} ${c?.state || 'missing'})`);
}
function gracePeriod(value, d) {
  if (value === undefined) return null;
  const m = typeof value === 'string' && /^([0-9]+)(?:\.([0-9]{1,9}))?s$/.exec(value);
  if (!m) refuse(`${d} termination grace period is not a duration`);
  return String(BigInt(m[1]) * 1000000000n + BigInt((m[2] || '').padEnd(9, '0') || '0'));
}

// --- pure endpoint normalization ---------------------------------------------
// Shared by the serving revision and the service template, so the template
// (the configuration of the next revision) must equal what is running.
const SPEC_REFUSED = ['encryptionKey', 'encryptionKeyRevocationAction', 'encryptionKeyShutdownDuration', 'sandboxes', 'serviceMesh', 'nodeSelector'];
function normalizeSpec(spec, project, d) {
  for (const key of SPEC_REFUSED) absent(spec, key, d);
  for (const key of ['gpuZonalRedundancyDisabled', 'healthCheckDisabled']) falsy(spec, key, d);
  const executionEnvironment = { EXECUTION_ENVIRONMENT_GEN1: 'gen1', EXECUTION_ENVIRONMENT_GEN2: 'gen2' }[spec.executionEnvironment];
  if (!executionEnvironment) refuse(`${d} execution environment is unobserved; CPU and memory admissibility unverifiable`);
  if (typeof spec.serviceAccount !== 'string') refuse(`${d} runtime service account unobserved`);
  const containers = arrayOf(spec.containers, `${d} containers`);
  if (containers.length !== 1) refuse(`${d} requires exactly one application container`);
  const c = record(containers[0], FIELDS.container, `${d} container`);
  for (const key of ['sourceCode', 'buildConfig']) absent(c, key, `${d} container`);
  falsy(c, 'sandboxLauncher', `${d} container`);
  if (arrayOf(c.dependsOn, `${d} container dependsOn`).length) refuse(`${d} container dependencies are unreviewed`);
  const image = typeof c.image === 'string' && /^([^@\s]+)@sha256:([a-f0-9]{64})$/.exec(c.image);
  if (!image) refuse(`${d} image is not pinned by digest`);
  if (c.baseImageUri !== undefined) leaf.str(c.baseImageUri, `${d} base image`);
  if (c.name !== undefined) leaf.str(c.name, `${d} container name`);
  const res = record(c.resources, FIELDS.resources, `${d} container resources`);
  const limits = res.limits;
  if (!limits || typeof limits !== 'object' || Array.isArray(limits) || Object.keys(limits).some(k => !['cpu', 'memory'].includes(k))) refuse(`${d} resource limits are unknown`);
  const scaling = shape(SHAPES.revisionScaling, spec.scaling, `${d} scaling`) || {};
  const buildInfo = shape(SHAPES.buildInfo, c.buildInfo, `${d} build info`);
  if (buildInfo && buildInfo.sourceLocation !== null) refuse(`${d} container buildInfo.sourceLocation is an unreviewed code source`);
  const concurrency = int32(spec.maxInstanceRequestConcurrency, `${d} concurrency`, undefined);
  if (concurrency === undefined) refuse(`${d} concurrency is unobserved`);
  return {
    execution: {
      serviceAccountEmail: spec.serviceAccount, timeoutNanoseconds: durationNanos(spec.timeout, d), concurrency,
      memoryBytes: memoryBytes(limits.memory, d), cpuMilli: cpuMilli(limits.cpu, d),
      minimumInstances: scaling.minInstanceCount ?? 0, maximumInstances: scaling.maxInstanceCount ?? null,
      command: shape(arr(leaf.str), c.command, `${d} command`) || [], args: shape(arr(leaf.str), c.args, `${d} args`) || [],
      workingDirectory: c.workingDir === undefined ? null : leaf.str(c.workingDir, `${d} working directory`),
      ...normalizeEnvironment(c.env, project, d), secretVolumeBindings: normalizeVolumes(spec.volumes, c.volumeMounts, project, d),
      network: normalizeNetwork(spec.vpcAccess, project, d),
    },
    observedImage: { repository: image[1], digest: image[2] }, container: c,
    profile: {
      executionEnvironment, sessionAffinity: shape(leaf.bool, spec.sessionAffinity, `${d} session affinity`),
      terminationGracePeriodNanoseconds: gracePeriod(spec.terminationGracePeriod, d),
      annotations: shape(MAP, spec.annotations, `${d} annotations`),
      scaling: { concurrencyUtilization: scaling.concurrencyUtilization ?? null, cpuUtilization: scaling.cpuUtilization ?? null },
      container: {
        cpuIdle: shape(leaf.bool, res.cpuIdle, `${d} cpuIdle`), startupCpuBoost: shape(leaf.bool, res.startupCpuBoost, `${d} startupCpuBoost`),
        ports: shape(SHAPES.ports, c.ports, `${d} ports`), startupProbe: shape(SHAPES.probe, c.startupProbe, `${d} startupProbe`),
        livenessProbe: shape(SHAPES.probe, c.livenessProbe, `${d} livenessProbe`), readinessProbe: shape(SHAPES.probe, c.readinessProbe, `${d} readinessProbe`),
        functionTarget: buildInfo ? buildInfo.functionTarget : null,
        // Compared so the template cannot name a different base image (finding A).
        baseImageUri: c.baseImageUri === undefined ? null : c.baseImageUri,
      },
    },
    metadata: { buildId: buildInfo ? buildInfo.buildId : null },
  };
}

/**
 * Pure: normalizes one endpoint's provider responses into the A3-1
 * CloudEndpointConfigurationV1 shape without `invocation` (S5 owns it), a
 * `runtimeProfile` of every other security-relevant field (compared against the
 * plan), and a private provider block of metadata. `at` is the observation
 * clock in epoch nanoseconds.
 */
function normalizeEndpoint({ project, endpointName, fn, service, revision, archive, at }) {
  const environment = ENVIRONMENTS[project];
  if (!environment) refuse(`unsupported project ${project}`);
  if (!ENDPOINTS.includes(endpointName)) refuse(`unknown endpoint ${endpointName}`);
  if (typeof at !== 'bigint') refuse('observation clock required');
  const d = endpointName;
  record(fn, FIELDS.function, `${d} function`);
  const functionResource = projectResource(fn.name, project, /\/locations\/[^/]+\/functions\/[^/]+$/, `${d} function`);
  if (functionResource !== `projects/${project}/locations/${REGION}/functions/${d}`) refuse(`${d} function is not in ${REGION} or has the wrong name`);
  if (fn.environment !== 'GEN_2' || fn.state !== 'ACTIVE') refuse(`${d} function generation or state is not GEN_2 ACTIVE`);
  for (const key of ['eventTrigger', 'kmsKeyName', 'upgradeInfo']) absent(fn, key, `${d} function`);
  if (arrayOf(fn.stateMessages, `${d} state messages`).length) refuse(`${d} function reports state messages`);
  resourceTimes(fn, `${d} function`, at, ['updateTime']);
  const functionLabels = shape(MAP, fn.labels, `${d} function labels`);
  for (const key of ['description', 'url', 'buildpackStack']) if (fn[key] !== undefined) leaf.str(fn[key], `${d} function ${key}`);
  for (const key of ['satisfiesPzi', 'satisfiesPzs']) if (fn[key] !== undefined) leaf.bool(fn[key], `${d} function ${key}`);

  const build = record(fn.buildConfig, FIELDS.buildConfig, `${d} buildConfig`);
  if (build.runtime !== 'nodejs22' || build.entryPoint !== d) refuse(`${d} runtime or entry point mismatch`);
  absent(build, 'workerPool', `${d} buildConfig`);
  if (build.dockerRegistry !== undefined && build.dockerRegistry !== 'ARTIFACT_REGISTRY') refuse(`${d} docker registry is not Artifact Registry`);
  if (build.sourceToken !== undefined) leaf.str(build.sourceToken, `${d} source token`);
  const buildResource = projectResource(build.build, project, /\/locations\/[a-z0-9-]+\/builds\/[A-Za-z0-9_-]+$/, `${d} build`);
  if (typeof build.dockerRepository !== 'string') refuse(`${d} docker repository is unresolved`);
  const dockerRepositoryResource = projectResource(build.dockerRepository, project, /\/locations\/[a-z0-9-]+\/repositories\/[A-Za-z0-9_-]+$/, `${d} docker repository`);
  if (typeof build.serviceAccount !== 'string') refuse(`${d} build service account is unresolved`);
  const serviceAccountResource = projectResource(build.serviceAccount, project, /\/serviceAccounts\/[A-Za-z0-9_.-]+@[a-z0-9.-]+\.gserviceaccount\.com$/, `${d} build service account`);
  const declared = record(build.source, FIELDS.source, `${d} build source`);
  absent(declared, 'gitUri', `${d} build source`); absent(declared, 'repoSource', `${d} build source`);
  const provenance = record(build.sourceProvenance, FIELDS.sourceProvenance, `${d} source provenance`);
  absent(provenance, 'gitUri', `${d} source provenance`); absent(provenance, 'resolvedRepoSource', `${d} source provenance`);
  const resolved = record(provenance.resolvedStorageSource, FIELDS.storageSource, `${d} resolved source`);
  const requested = record(declared.storageSource, FIELDS.storageSource, `${d} declared source`);
  for (const source of [resolved, requested]) if (typeof source.bucket !== 'string' || !source.bucket || typeof source.object !== 'string' || !source.object) refuse(`${d} source identity is ambiguous`);
  if (resolved.bucket !== requested.bucket || resolved.object !== requested.object) refuse(`${d} resolved source differs from the declared source`);
  if (resolved.generation === undefined) refuse(`${d} resolved source generation missing`);
  const generation = int64(resolved.generation, `${d} source generation`);
  if (generation === '0') refuse(`${d} immutable source generation unavailable`);
  // F3: an explicitly declared generation must be the one provenance resolved.
  if (requested.generation !== undefined && int64(requested.generation, `${d} declared source generation`) !== generation) refuse(`${d} declared source generation differs from the resolved generation`);
  if (!archive || archive.source?.bucket !== resolved.bucket || archive.source?.object !== resolved.object || archive.source?.generation !== generation) refuse(`${d} source archive does not match the generation-pinned source`);

  const sc = record(fn.serviceConfig, FIELDS.serviceConfig, `${d} serviceConfig`);
  absent(sc, 'binaryAuthorizationPolicy', `${d} serviceConfig`);
  const declaredService = shape(SHAPES.functionsServiceConfig, sc, `${d} serviceConfig`);
  if (sc.allTrafficOnLatestRevision !== true) refuse(`${d} traffic is not on the latest revision`);
  const serviceResource = projectResource(sc.service, project, /\/locations\/[a-z0-9-]+\/services\/[a-z0-9-]+$/, `${d} service`);
  if (!serviceResource.startsWith(`projects/${project}/locations/${REGION}/services/`)) refuse(`${d} service region mismatch`);
  if (typeof sc.revision !== 'string' || !/^[a-z0-9-]+$/.test(sc.revision)) refuse(`${d} revision unavailable`);
  const revisionResource = `${serviceResource}/revisions/${sc.revision}`;

  record(service, FIELDS.service, `${d} Cloud Run service`);
  if (projectResource(service.name, project, /\/services\/[a-z0-9-]+$/, `${d} Cloud Run service`) !== serviceResource) refuse(`${d} Cloud Run service identity mismatch`);
  for (const key of ['buildConfig', 'multiRegionSettings', 'deleteTime', 'expireTime']) absent(service, key, `${d} Cloud Run service`);
  for (const key of ['reconciling', 'sshEnabled', 'durableExecution']) falsy(service, key, `${d} Cloud Run service`);
  resourceTimes(service, `${d} Cloud Run service`, at);
  const binaryAuthorization = shape(SHAPES.binaryAuthorization, service.binaryAuthorization, `${d} binary authorization`);
  if (binaryAuthorization && Object.values(binaryAuthorization).some(v => v !== null)) refuse(`${d} binary authorization is unreviewed`);
  const serviceScaling = shape(SHAPES.serviceScaling, service.scaling, `${d} service scaling`);
  if (serviceScaling && (serviceScaling.manualInstanceCount !== null || serviceScaling.maxInstanceCount !== null || serviceScaling.minInstanceCount !== null ||
      ![null, 'AUTOMATIC'].includes(serviceScaling.scalingMode))) refuse(`${d} service-level scaling overrides are unreviewed`);
  if (int64(service.observedGeneration ?? 0, `${d} observed generation`) !== int64(service.generation ?? 0, `${d} generation`)) refuse(`${d} service has unobserved changes`);
  conditions(service.conditions, `${d} Cloud Run service`, at);
  conditionReady(conditions([service.terminalCondition ?? null].filter(Boolean), `${d} Cloud Run service`, at)[0], `${d} Cloud Run service`);
  const latest = [service.latestReadyRevision, service.latestCreatedRevision].map(r => projectResource(r, project, /\/revisions\/[a-z0-9-]+$/, `${d} latest revision`));
  if (latest.some(r => r !== revisionResource)) refuse(`${d} revision mismatch between Functions and Cloud Run`);
  // Every route is kept: an extra (including a zero-percent tagged) route refuses.
  const traffic = arrayOf(service.traffic, `${d} traffic`), statuses = arrayOf(service.trafficStatuses, `${d} traffic statuses`);
  if (traffic.length !== 1 || statuses.length !== 1) refuse(`${d} traffic split or tagged route present`);
  record(traffic[0], FIELDS.traffic, `${d} traffic`); record(statuses[0], FIELDS.trafficStatus, `${d} traffic status`);
  for (const route of [traffic[0], statuses[0]]) {
    if (route.percent !== 100 || route.tag !== undefined) refuse(`${d} traffic split or tagged route present`);
    if (!['TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION'].includes(route.type)) refuse(`${d} unknown traffic allocation type`);
  }
  if (statuses[0].revision !== sc.revision || (traffic[0].type === 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION' && traffic[0].revision !== sc.revision)) refuse(`${d} serving revision mismatch`);
  const ingress = { INGRESS_TRAFFIC_ALL: 'all', INGRESS_TRAFFIC_INTERNAL_ONLY: 'internal', INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER: 'internal-and-load-balancing' }[service.ingress];
  if (!ingress) refuse(`${d} ingress is missing or unknown`);
  for (const key of ['launchStage', 'description', 'uri', 'client', 'clientVersion', 'creator', 'lastModifier', 'etag', 'uid']) if (service[key] !== undefined) leaf.str(service[key], `${d} Cloud Run service ${key}`);
  const serviceLabels = shape(MAP, service.labels, `${d} Cloud Run service labels`);

  record(revision, FIELDS.revision, `${d} revision`);
  if (projectResource(revision.name, project, /\/revisions\/[a-z0-9-]+$/, `${d} revision`) !== revisionResource ||
      projectResource(revision.service, project, /\/services\/[a-z0-9-]+$/, `${d} revision service`) !== serviceResource) refuse(`${d} revision identity mismatch`);
  for (const key of ['deleteTime', 'expireTime']) absent(revision, key, `${d} revision`);
  falsy(revision, 'reconciling', `${d} revision`);
  resourceTimes(revision, `${d} revision`, at);
  const ready = conditions(revision.conditions, `${d} revision`, at).filter(c => c.type === 'Ready');
  if (ready.length !== 1) refuse(`${d} revision readiness unobserved`);
  conditionReady(ready[0], `${d} revision`);
  shape(SHAPES.scalingStatus, revision.scalingStatus, `${d} scaling status`);
  for (const key of ['launchStage', 'logUri', 'client', 'clientVersion', 'creator', 'etag', 'uid']) if (revision[key] !== undefined) leaf.str(revision[key], `${d} revision ${key}`);
  const revisionLabels = shape(MAP, revision.labels, `${d} revision labels`);
  const running = normalizeSpec(revision, project, `${d} revision`);
  if (running.execution.serviceAccountEmail !== sc.serviceAccountEmail) refuse(`${d} runtime service account differs between Functions and Cloud Run`);
  // The template is the desired next revision; it must describe the serving one.
  const template = record(service.template, FIELDS.revisionTemplate, `${d} Cloud Run service template`);
  if (template.revision !== undefined && leaf.str(template.revision, `${d} template revision`) !== sc.revision) refuse(`${d} service template names a different revision`);
  for (const key of ['client', 'clientVersion']) if (template[key] !== undefined) leaf.str(template[key], `${d} template ${key}`);
  shape(MAP, template.labels, `${d} template labels`);
  const desired = normalizeSpec(template, project, `${d} Cloud Run service template`);
  if (canonical({ e: desired.execution, i: desired.observedImage, p: desired.profile }) !== canonical({ e: running.execution, i: running.observedImage, p: running.profile })) refuse(`${d} service template differs from the serving revision`);

  const configuration = {
    schemaVersion: 1, kind: 'google-cloud', environment, projectId: project, projectNumber: PROJECT_NUMBERS[project],
    endpointName: d, region: REGION, functionGeneration: 'GEN_2', runtime: 'nodejs22', entryPoint: d,
    functionResource, buildResource, serviceResource, revisionResource,
    traffic: [{ revisionResource, percent: 100, tag: null }],
    execution: { ...running.execution, ingress },
    build: { serviceAccountResource, environmentVariables: stringMap(build.environmentVariables, `${d} build environment`), dockerRepositoryResource,
      source: { bucket: resolved.bucket, object: resolved.object, generation, sha256: archive.archiveHash },
      runtimeUpdatePolicy: normalizeRuntimeUpdate(build, running.container, d) },
    observedImage: running.observedImage,
  };
  // Restore A3-1 key order for execution (ingress before network).
  const { network, ...rest } = configuration.execution;
  configuration.execution = { ...rest, ingress, network };
  assertEndpointConfiguration(configuration, project);
  // F1: every other security-relevant field is compared against the plan.
  const { service: _s, revision: _r, uri: _u, ...functionsServiceConfig } = declaredService;
  const runtimeProfile = {
    revision: { ...running.profile, launchStage: revision.launchStage ?? null },
    service: { launchStage: service.launchStage ?? null, threatDetectionEnabled: shape(leaf.bool, service.threatDetectionEnabled, `${d} threat detection`),
      annotations: shape(MAP, service.annotations, `${d} Cloud Run service annotations`), scaling: serviceScaling },
    function: { buildpackStack: fn.buildpackStack ?? null, dockerRegistry: build.dockerRegistry ?? null, serviceConfig: functionsServiceConfig },
  };
  // Observed, not compared: S5 reviews the access flags (O1); the rest is metadata.
  const provider = {
    accessForS5: { invokerIamDisabled: shape(leaf.bool, service.invokerIamDisabled, `${d} invokerIamDisabled`),
      defaultUriDisabled: shape(leaf.bool, service.defaultUriDisabled, `${d} defaultUriDisabled`),
      iapEnabled: shape(leaf.bool, service.iapEnabled, `${d} iapEnabled`),
      customAudiences: [...(shape(arr(leaf.str), service.customAudiences, `${d} audiences`) || [])].sort() },
    metadata: { functionUpdateTime: fn.updateTime, functionLabels, serviceLabels, revisionLabels, buildId: running.metadata.buildId },
  };
  return { configuration, runtimeProfile, provider, artifact: { runtimePayloadFingerprint: archive.runtimePayloadFingerprint,
    functionsArtifactFingerprint: archive.artifactFingerprint, placementFingerprint: archive.placementFingerprint } };
}

// --- A3-1 structure (CloudEndpointConfigurationV1 without invocation) ---------
// Built from the compiled A3 protocol primitives; tests prove that adding a
// valid invocation block makes the result pass the canonical validateEndpoint.
const S = (() => {
  const decimal = P.pattern(/^[1-9][0-9]*$/);
  const bounded = maximum => (v, p) => { decimal(v, p); if (BigInt(v) > maximum) P.refuse(p, 'provider integer out of range'); };
  const relative = (v, p) => { P.text(v, p);
    if (v.startsWith('/') || v.includes('\\') || v.split('/').some(x => !x || x === '.' || x === '..')) P.refuse(p, 'unsafe relative path'); };
  const absolute = (v, p) => { P.text(v, p); if (!v.startsWith('/')) P.refuse(p, 'absolute path required'); relative(v.slice(1), p); };
  const envName = P.pattern(/^[A-Za-z_][A-Za-z0-9_]*$/);
  const byName = key => v => String(P.plainRecord(v, '$')[key]);
  const res = suffix => P.pattern(new RegExp(`^projects/[a-z][a-z0-9-]*/${suffix}$`));
  const secretRes = res('secrets/[A-Za-z0-9_-]+');
  const plainEnv = P.object({ name: envName, value: P.stringRule });
  const secretEnv = P.object({ name: envName, secretResource: secretRes, version: decimal });
  const volume = P.object({ volumeName: P.pattern(/^[A-Za-z0-9_.-]+$/), mountPath: absolute, secretResource: secretRes, defaultMode: P.integer(0, 511),
    items: P.array(P.object({ path: relative, version: decimal, mode: P.nullable(P.integer(1, 511)) }), byName('path')) });
  const egress = P.literal('private-ranges-only', 'all-traffic');
  const network = (v, p) => {
    const kind = P.plainRecord(v, p).kind;
    if (kind === 'none') P.object({ kind: P.literal('none') })(v, p);
    else if (kind === 'connector') P.object({ kind: P.literal('connector'), connectorResource: res('locations/[a-z0-9-]+/connectors/[a-z0-9-]+'), egress })(v, p);
    else if (kind === 'direct-vpc') P.object({ kind: P.literal('direct-vpc'), networkResource: res('global/networks/[a-z0-9-]+'),
      subnetworkResource: res('regions/[a-z0-9-]+/subnetworks/[a-z0-9-]+'), networkTags: P.array(P.text, v2 => v2), egress })(v, p);
    else P.refuse(p, 'unsupported network');
  };
  const runtimeUpdate = (v, p) => {
    const kind = P.plainRecord(v, p).kind;
    if (kind === 'automatic') P.object({ kind: P.literal('automatic'), baseImageUri: P.nullable(P.text) })(v, p);
    else if (kind === 'on-deploy') P.object({ kind: P.literal('on-deploy'), runtimeVersion: P.text, baseImageUri: P.literal(null) })(v, p);
    else P.refuse(p, 'unsupported update policy');
  };
  const execution = P.object({ serviceAccountEmail: P.pattern(/^[A-Za-z0-9_.-]+@[a-z0-9.-]+\.gserviceaccount\.com$/), timeoutNanoseconds: bounded(3600000000000n),
    concurrency: P.integer(1, 1000), memoryBytes: decimal, cpuMilli: P.integer(1), minimumInstances: P.integer(0, 2147483647),
    maximumInstances: P.nullable(P.integer(1, 2147483647)), command: P.array(P.stringRule), args: P.array(P.stringRule), workingDirectory: P.nullable(P.text),
    environmentVariables: P.array(plainEnv, byName('name')), secretEnvironmentBindings: P.array(secretEnv, byName('name')),
    secretVolumeBindings: P.array(volume, byName('volumeName')), ingress: P.literal('all', 'internal', 'internal-and-load-balancing'), network });
  const plannedBuild = { serviceAccountResource: res('serviceAccounts/[A-Za-z0-9_.-]+@[a-z0-9.-]+\\.gserviceaccount\\.com'),
    environmentVariables: P.array(plainEnv, byName('name')), dockerRepositoryResource: res('locations/[a-z0-9-]+/repositories/[A-Za-z0-9_-]+'), runtimeUpdatePolicy: runtimeUpdate };
  const contentObject = P.object({ bucket: P.pattern(/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/), object: P.text, generation: bounded(9223372036854775807n), sha256: P.digest });
  const revisionRes = res('locations/[a-z0-9-]+/services/[a-z0-9-]+/revisions/[a-z0-9-]+');
  const endpoint = P.object({ environment: P.literal('production', 'staging'), projectId: P.pattern(/^[a-z][a-z0-9-]*$/), projectNumber: P.pattern(/^[1-9][0-9]*$/),
    schemaVersion: P.literal(1), kind: P.literal('google-cloud'), endpointName: P.literal(...ENDPOINTS), region: P.literal(REGION),
    functionGeneration: P.literal('GEN_2'), runtime: P.literal('nodejs22'), entryPoint: P.literal(...ENDPOINTS),
    functionResource: res('locations/[a-z0-9-]+/functions/[A-Za-z0-9_-]+'), buildResource: res('locations/[a-z0-9-]+/builds/[A-Za-z0-9_-]+'),
    serviceResource: res('locations/[a-z0-9-]+/services/[a-z0-9-]+'), revisionResource: revisionRes,
    traffic: P.tuple(P.object({ revisionResource: revisionRes, percent: P.literal(100), tag: P.literal(null) })), execution,
    build: P.object({ ...plannedBuild, source: contentObject }), observedImage: P.object({ repository: P.text, digest: P.digest }) });
  return { execution, plannedBuild: P.object(plannedBuild), endpoint, contentObject };
})();
function structural(rule, value, description) {
  const result = P.validate(rule, value);
  if (!result.ok) refuse(`${description} structure invalid at ${result.issue.path}: ${result.issue.reason}`);
}
function assertEndpointConfiguration(configuration, project) {
  structural(S.endpoint, configuration, `${configuration?.endpointName || 'endpoint'} configuration`);
  if (configuration.projectId !== project || configuration.environment !== ENVIRONMENTS[project] || configuration.projectNumber !== PROJECT_NUMBERS[project]) refuse('endpoint environment identity mismatch');
  if (configuration.entryPoint !== configuration.endpointName || !configuration.revisionResource.startsWith(`${configuration.serviceResource}/revisions/`)) refuse('endpoint resource mismatch');
  const e = configuration.execution;
  if (e.maximumInstances !== null && e.minimumInstances > e.maximumInstances) refuse('contradictory scaling');
  if (new Set(e.secretVolumeBindings.map(b => b.mountPath)).size !== e.secretVolumeBindings.length) refuse('duplicate secret mount paths');
  for (const variable of e.environmentVariables) if (variable.name === 'FIREBASE_CONFIG') {
    let config; try { config = K.parseStrictJSON(variable.value); } catch { refuse('malformed FIREBASE_CONFIG'); }
    if (!config || config.projectId !== project) refuse('FIREBASE_CONFIG project mismatch');
  }
}

// --- provider observation (injected GET only) --------------------------------
function payloadSummary(runtimeFiles) {
  const payload = { ...runtimeFiles }; delete payload[RUNTIME_BUILD_PATH];
  return K.contentDigest(payload);
}
async function observeA3Backend({ project, get, unpack = archiveRuntime, now = () => new Date().toISOString() } = {}) {
  // Explicit project only; .firebaserc and ambient credentials are never consulted.
  if (!Object.hasOwn(ENVIRONMENTS, project)) refuse('an explicit supported --project is required (lyfelabz-staging or lyfelabz-prod)');
  if (typeof get !== 'function') refuse('an explicit GET transport is required; S4 holds no credentials');
  const deadline = BigInt(MAX_AGE_MS) * 1000000n;
  const startedAt = now(), start = instant(startedAt, 'observation start');
  const clock = () => instant(now(), 'observation clock');
  const read = async (url, binary = false) => {
    if (clock() - start > deadline) refuse('stale provider retrieval; observation deadline exceeded');
    return get(url, binary);
  };
  const remote = await read(`https://firebase.googleapis.com/v1beta1/projects/${project}`);
  if (remote?.projectId !== project || String(remote.projectNumber) !== PROJECT_NUMBERS[project] || remote.state !== 'ACTIVE' || remote.name !== `projects/${project}`) refuse('wrong-project Firebase identity');
  const db = await read(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)`);
  resource(db?.name, project, /\/databases\/\(default\)$/);
  if (db.type !== 'FIRESTORE_NATIVE') refuse('unknown Firestore database identity/type');
  record(db, FIELDS.database, 'Firestore database');
  absent(db, 'deleteTime', 'Firestore database');
  if (db.firestoreDataAccessMode === 'DATA_ACCESS_MODE_DISABLED') refuse('Firestore database native data access is disabled');
  resourceTimes(db, 'Firestore database', clock());

  const functionsUrl = `https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/-/functions`;
  const inventoryOf = async () => {
    const rows = await list(read, functionsUrl, 'functions');
    for (const fn of rows) resource(fn?.name, project, /\/locations\/[^/]+\/functions\/[^/]+$/);
    return rows.map(f => ({ name: f.name, environment: f.environment || 'UNKNOWN', state: f.state || 'UNKNOWN', updateTime: f.updateTime || null }))
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  };
  const inventory = await inventoryOf();
  const unitsFunctions = inventory.filter(f => /^teacherUnits/.test(f.name.split('/').pop()));
  const extra = unitsFunctions.filter(f => !ENDPOINTS.includes(f.name.split('/').pop()));
  if (extra.length) refuse(`unknown Teacher Units endpoint deployed: ${extra.map(f => f.name.split('/').pop()).join(', ')}`);
  const endpoints = [], archives = new Map(), captured = [];
  for (const id of ENDPOINTS) {
    const matches = unitsFunctions.filter(f => f.name.split('/').pop() === id);
    if (matches.length !== 1) refuse(`missing or ambiguous Teacher Units endpoint: ${id}`);
    const fnUrl = `https://cloudfunctions.googleapis.com/v2/${matches[0].name}`;
    const snapshot = async () => {
      const fn = await read(fnUrl);
      const serviceName = fn?.serviceConfig?.service, revisionName = fn?.serviceConfig?.revision;
      if (typeof serviceName !== 'string' || typeof revisionName !== 'string' || !/^[a-z0-9-]+$/.test(revisionName)) refuse(`${id} service or revision unavailable`);
      resource(serviceName, project, /\/locations\/[a-z0-9-]+\/services\/[a-z0-9-]+$/);
      const service = await read(`https://run.googleapis.com/v2/${serviceName}`);
      const revision = await read(`https://run.googleapis.com/v2/${serviceName}/revisions/${revisionName}`);
      return { fn, service, revision };
    };
    const first = await snapshot();
    const source = first.fn.buildConfig?.sourceProvenance?.resolvedStorageSource;
    if (!source || typeof source.bucket !== 'string' || typeof source.object !== 'string') refuse(`${id} immutable source unavailable`);
    const generation = int64(source.generation, `${id} source generation`);
    const storageUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(source.bucket)}/o/${encodeURIComponent(source.object)}?alt=media&generation=${generation}`;
    if (!archives.has(storageUrl)) {
      const unpacked = unpack(await read(storageUrl, true));
      archives.set(storageUrl, { ...unpacked, runtimePayloadFingerprint: payloadSummary(unpacked.runtimeFiles), source: { bucket: source.bucket, object: source.object, generation } });
    }
    // Bracket: endpoint metadata must be unchanged across source retrieval.
    if (canonical(first) !== canonical(await snapshot())) refuse(`provider state changed during observation: ${id}`);
    endpoints.push(normalizeEndpoint({ project, endpointName: id, ...first, archive: archives.get(storageUrl), at: clock() }));
    captured.push({ id, snapshot, first });
  }
  const artifacts = new Set(endpoints.map(e => canonical(e.artifact)));
  if (artifacts.size !== 1) refuse('Teacher Units endpoints run different application payloads');

  const releaseUrl = `https://firebaserules.googleapis.com/v1/projects/${project}/releases/cloud.firestore`;
  const release = await read(releaseUrl);
  if (release?.name !== `projects/${project}/releases/cloud.firestore`) refuse('wrong-project Rules release');
  record(release, FIELDS.rulesRelease, 'Rules release');
  // A disabled release does not serve its ruleset (finding D).
  if (release.disabled !== undefined && typeof release.disabled !== 'boolean') refuse('Rules release disabled flag is malformed');
  if (release.disabled === true) refuse('Rules release is disabled; it is not evidence of served Rules');
  const rulesetResource = projectResource(release.rulesetName, project, /\/rulesets\/[^/]+$/, 'Rules ruleset');
  resourceTimes(release, 'Rules release', clock(), ['updateTime']);
  const ruleset = await read(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
  if (ruleset?.name !== release.rulesetName || !Array.isArray(ruleset.source?.files) || ruleset.source.files.length !== 1 || typeof ruleset.source.files[0]?.content !== 'string') refuse('Rules source identity uncertain');
  record(ruleset, FIELDS.ruleset, 'Rules ruleset');
  absent(ruleset, 'attachmentPoint', 'Rules ruleset');
  resourceTimes(ruleset, 'Rules ruleset', clock());
  record(ruleset.source, FIELDS.rulesSource, 'Rules source');
  if (ruleset.source.language !== undefined && ruleset.source.language !== 'FIREBASE_RULES') refuse('Rules source language is not FIREBASE_RULES');
  record(ruleset.source.files[0], FIELDS.rulesFile, 'Rules source file');
  for (const key of ['name', 'fingerprint']) if (ruleset.source.files[0][key] !== undefined) leaf.str(ruleset.source.files[0][key], `Rules source file ${key}`);
  shape({ obj: { services: arr(leaf.str) } }, ruleset.metadata, 'Rules ruleset metadata');
  if (canonical(release) !== canonical(await read(releaseUrl))) refuse('Rules changed during observation');

  const indexesUrl = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/collectionGroups/-/indexes`;
  const fieldsUrl = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/collectionGroups/-/fields`;
  const indexSnapshot = async () => {
    const indexes = await list(read, indexesUrl, 'indexes');
    const fields = [...await list(read, `${fieldsUrl}?filter=indexConfig.usesAncestorConfig%3Dfalse`, 'fields'),
      ...await list(read, `${fieldsUrl}?filter=ttlConfig%3A*`, 'fields')];
    const byName = new Map();
    for (const f of fields) {
      onlyKeys(f, ['name', 'indexConfig', 'ttlConfig'], 'remote field');
      resource(f.name, project, /\/databases\/\(default\)\/collectionGroups\/[^/]+\/fields\/[^/]+$/);
      if (byName.has(f.name) && canonical(byName.get(f.name)) !== canonical(f)) refuse('field identity changed during observation');
      byName.set(f.name, f);
    }
    return normalizeRemoteIndexes(indexes, [...byName.values()], project);
  };
  const indexes = await indexSnapshot();
  if (canonical(indexes) !== canonical(await indexSnapshot())) refuse('indexes changed during observation');
  if (canonical(inventory) !== canonical(await inventoryOf())) refuse('Functions inventory changed during observation');
  // F2: final revalidation of all nine endpoints against their captured
  // snapshots. Provider APIs offer no global transactional snapshot, so this
  // narrows but cannot eliminate time-of-check/time-of-use races: a change after
  // this pass, or one reverted between reads, is not detected.
  for (const { id, snapshot, first } of captured) {
    if (canonical(first) !== canonical(await snapshot())) refuse(`provider state changed before the observation completed: ${id}`);
  }

  const artifact = endpoints[0].artifact;
  const observation = {
    kind: OBSERVATION_KIND, schemaVersion: 1,
    authority: 'provider observation only; not a release, approval, certification or availability document',
    environment: ENVIRONMENTS[project], projectId: project, projectNumber: PROJECT_NUMBERS[project], region: REGION, databaseId: '(default)',
    startedAt, observedAt: now(), ...artifact,
    // Exact uploaded bytes; distinct from the runtime payload fingerprint (G4 open).
    sourceArchiveHashes: [...new Set(endpoints.map(e => e.configuration.build.source.sha256))].sort(),
    endpoints: endpoints.map(({ configuration, runtimeProfile, provider }) => ({ configuration, runtimeProfile, provider })),
    rules: { rulesetResource, sourceHash: sha256(ruleset.source.files[0].content), release: release.name, updateTime: release.updateTime },
    readyIndexesConfigurationHash: fingerprint(indexes), indexes,
    inventory, sources: [...SOURCES],
  };
  assertA3Observation(observation, project, now());
  return observation;
}

// --- private record checks ----------------------------------------------------
function assertA3Observation(observation, project, now = new Date().toISOString()) {
  if (observation?.kind !== OBSERVATION_KIND || observation.schemaVersion !== 1) refuse('not an A3 provider observation (local candidates and A1 observations are not deployed A3 evidence)');
  if (!Object.hasOwn(ENVIRONMENTS, project) || observation.projectId !== project || observation.environment !== ENVIRONMENTS[project] ||
      observation.projectNumber !== PROJECT_NUMBERS[project] || observation.region !== REGION || observation.databaseId !== '(default)') refuse('wrong-project or wrong-environment observation');
  if (canonical(observation.sources) !== canonical(SOURCES)) refuse('observation sources are not the provider GET sources');
  const start = instant(observation.startedAt, 'observation start'), end = instant(observation.observedAt, 'observation end'), current = instant(now, 'current');
  if (start > end || end > current || current - start > BigInt(MAX_AGE_MS) * 1000000n) refuse('stale or future observation; observe the provider again');
  for (const key of ['runtimePayloadFingerprint', 'functionsArtifactFingerprint', 'placementFingerprint', 'readyIndexesConfigurationHash']) if (!/^[a-f0-9]{64}$/.test(observation[key] || '')) refuse(`observation ${key} missing`);
  if (!/^[a-f0-9]{64}$/.test(observation.rules?.sourceHash || '')) refuse('observation Rules source hash missing');
  projectResource(observation.rules.rulesetResource, project, /\/rulesets\/[^/]+$/, 'observation ruleset');
  if (fingerprint(observation.indexes) !== observation.readyIndexesConfigurationHash) refuse('observation index hash does not match its configuration');
  if (!Array.isArray(observation.endpoints) || canonical(observation.endpoints.map(e => e?.configuration?.endpointName)) !== canonical(ENDPOINTS)) refuse('observation requires exactly the nine sorted A3 endpoints (an A1 eight-endpoint observation never satisfies A3)');
  for (const e of observation.endpoints) {
    assertEndpointConfiguration(e.configuration, project);
    structural(JSON_RECORD, e.runtimeProfile, `${e.configuration.endpointName} runtime profile`);
  }
  if (!Array.isArray(observation.sourceArchiveHashes) || !observation.sourceArchiveHashes.length ||
      canonical(observation.sourceArchiveHashes) !== canonical([...new Set(observation.endpoints.map(e => e.configuration.build.source.sha256))].sort())) refuse('observation source archive hashes are inconsistent');
  return true;
}

// --- deployment plan contract (O7) and pure comparison ------------------------
// Plain JSON data only; compared exactly, so an extra or missing key differs.
const JSON_RECORD = (v, p) => { P.plainRecord(v, p); try { K.canonicalJSON(v); } catch { P.refuse(p, 'plain JSON data required'); } };
const PLAN_ENDPOINT = P.object({ endpointName: P.literal(...ENDPOINTS), execution: S.execution, build: S.plannedBuild, runtimeProfile: JSON_RECORD });
// The uploaded archive is built at deploy time, so its bytes are usually not
// known in advance: `unbound` records the observed hash without approving it;
// `exact` approves one archive hash for every endpoint. Runtime-payload equality
// never implies archive reproducibility (G4).
const SOURCE_ARCHIVE = (v, p) => {
  const policy = P.plainRecord(v, p).policy;
  if (policy === 'unbound') P.object({ policy: P.literal('unbound') })(v, p);
  else if (policy === 'exact') P.object({ policy: P.literal('exact'), sha256: P.digest })(v, p);
  else P.refuse(p, 'unsupported source archive policy');
};
const PLAN = P.object({ schemaVersion: P.literal(1), kind: P.literal(PLAN_KIND), environment: P.literal('production', 'staging'),
  projectId: P.text, projectNumber: P.text, region: P.literal(REGION), databaseId: P.literal('(default)'),
  deployCommand: P.array(P.text), candidate: P.object({ runtimePayloadFingerprint: P.digest, functionsArtifactFingerprint: P.digest, placementFingerprint: P.digest }),
  rules: P.object({ sourceHash: P.digest }), readyIndexesConfigurationHash: P.digest, sourceArchive: SOURCE_ARCHIVE,
  endpoints: P.array(PLAN_ENDPOINT, v => String(P.plainRecord(v, '$').endpointName)) });
function deployCommand(project) {
  return ['firebase', 'deploy', '--only', ENDPOINTS.map(e => `functions:${e}`).join(','), '--project', project];
}
/** Verifies the plan attachment bytes at its ContentObjectV1 address and returns the plan. */
function readPlan(planObject, planBytes, project) {
  structural(S.contentObject, planObject, 'deployment plan content object');
  if (!Buffer.isBuffer(planBytes) || planBytes.length > LIMITS.jsonBytes) refuse('deployment plan bytes required');
  if (K.sha256Bytes(planBytes) !== planObject.sha256) refuse('deployment plan bytes do not match the content object hash');
  let plan; try { plan = K.parseStrictJSON(planBytes.toString('utf8')); } catch { refuse('deployment plan is not strict JSON'); }
  if (K.canonicalJSON(plan) !== planBytes.toString('utf8')) refuse('deployment plan bytes are not canonical JSON');
  structural(PLAN, plan, 'deployment plan');
  if (plan.projectId !== project || plan.environment !== ENVIRONMENTS[project] || plan.projectNumber !== PROJECT_NUMBERS[project]) refuse('deployment plan environment identity mismatch');
  if (canonical(plan.deployCommand) !== canonical(deployCommand(project))) refuse('deployment plan command is not the exact nine-endpoint deploy command');
  if (canonical(plan.endpoints.map(e => e.endpointName)) !== canonical(ENDPOINTS)) refuse('deployment plan requires exactly the nine A3 endpoints');
  return plan;
}
/** Pure: every planned dimension must equal the observation exactly. */
function compareObservationToPlan(observation, planObject, planBytes, project, now) {
  assertA3Observation(observation, project, now);
  const plan = readPlan(planObject, planBytes, project);
  const differences = [];
  const same = (a, b, where) => { if (canonical(a) !== canonical(b)) differences.push(where); };
  same(plan.candidate, { runtimePayloadFingerprint: observation.runtimePayloadFingerprint, functionsArtifactFingerprint: observation.functionsArtifactFingerprint,
    placementFingerprint: observation.placementFingerprint }, 'candidate');
  same(plan.rules.sourceHash, observation.rules.sourceHash, 'rules.sourceHash');
  same(plan.readyIndexesConfigurationHash, observation.readyIndexesConfigurationHash, 'readyIndexesConfigurationHash');
  if (plan.sourceArchive.policy === 'exact') same([plan.sourceArchive.sha256], observation.sourceArchiveHashes, 'sourceArchive');
  plan.endpoints.forEach((planned, i) => {
    const observed = observation.endpoints[i];
    same(planned.runtimeProfile, observed.runtimeProfile, `${planned.endpointName}.runtimeProfile`);
    same(planned.execution, observed.configuration.execution, `${planned.endpointName}.execution`);
    const { source, ...build } = observed.configuration.build;
    same(planned.build, build, `${planned.endpointName}.build`);
  });
  if (differences.length) refuse(`observed deployment differs from the approved plan: ${differences.join(', ')}`);
  return { policy: 'a3-s4-plan-comparison-v1', matched: true, planSha256: planObject.sha256 };
}

module.exports = { OBSERVATION_KIND, PLAN_KIND, ENDPOINTS, FIELDS, normalizeEndpoint, observeA3Backend, assertA3Observation,
  readPlan, compareObservationToPlan, deployCommand, payloadSummary, memoryBytes, cpuMilli, durationNanos, instant };
