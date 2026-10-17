'use strict';
// A3-6 S4 provider observer tests. SYNTHETIC fixtures only (O5); no real provider request is made.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const A1 = require('../hosting-release/backend-state.cjs');
const O = require('./provider-observation.cjs');
const { templateOf, SYNTHETIC, NOW, buildProvider, planFor, synthesizeSource, defaultFiles } = require('./fixtures/synthetic-provider.cjs');
const V = require('../../platform/functions/lib/teacherUnits/a3-validation.js');
const { inventoryRuntimeArtifact } = require('../../platform/functions/lib/teacherUnits/a3-runtime-artifact.js');

const STAGING = 'lyfelabz-staging';
const ID = 'teacherUnitsGet';
async function observe(options = {}) {
  const f = buildProvider(options);
  try { return { f, observation: await O.observeA3Backend({ project: options.target || f.state.project, get: f.get, now: f.now }) }; }
  finally { f.cleanup(); }
}
async function refused(options, pattern) {
  await assert.rejects(observe(options), error => { assert.match(error.message, /REFUSED/); assert.match(error.message, pattern); return true; });
}
const edit = fn => ({ mutate: state => fn(state, state.endpoints[ID]) });

test('fixtures are labelled synthetic, never provider-verified', () => {
  assert.equal(SYNTHETIC, 'synthetic, not provider-verified');
  assert.match(fs.readFileSync(path.join(__dirname, 'fixtures/synthetic-provider.cjs'), 'utf8'), /SYNTHETIC FIXTURE - NOT PROVIDER-VERIFIED/);
});

test('valid nine-endpoint observation, including teacherUnitsCapabilities', async () => {
  const { observation } = await observe();
  assert.equal(observation.kind, O.OBSERVATION_KIND);
  assert.deepEqual(observation.endpoints.map(e => e.configuration.endpointName), [...V.ENDPOINTS]);
  assert.equal(observation.endpoints.length, 9);
  assert.ok(observation.endpoints.some(e => e.configuration.endpointName === 'teacherUnitsCapabilities'));
  assert.equal(observation.rules.rulesetResource, `projects/${STAGING}/rulesets/ruleset-synthetic`);
  assert.equal(observation.readyIndexesConfigurationHash, A1.fingerprint({ indexes: [], fieldOverrides: [] }));
  assert.ok(!('invocation' in observation.endpoints[0].configuration), 'S5 owns invocation (O1)');
  // Project-number resource names are bound to the pinned project ID.
  assert.match(observation.endpoints[0].configuration.buildResource, /^projects\/lyfelabz-staging\//);
});

test('observed configuration is exactly the A3-1 cloud endpoint shape without invocation', async () => {
  const { observation } = await observe();
  const invocation = { invokerIamDisabled: false, defaultUriDisabled: false, iapEnabled: false, customAudiences: [],
    functionAllowPolicy: { version: 1, bindings: [] }, serviceAllowPolicy: { version: 1, bindings: [] },
    accessReviewReceipt: { bucket: 'synthetic-test-only', object: 'r', generation: '1', sha256: 'c'.repeat(64) } };
  for (const { configuration } of observation.endpoints) {
    const result = V.validateEndpoint({ ...configuration, invocation });
    assert.equal(result.ok, true, JSON.stringify(result.issue));
    assert.equal(V.validateEndpoint(configuration).ok, false, 'incomplete without the S5 invocation block');
  }
});

test('an A1 eight-endpoint observation is rejected', async () => {
  const { observation } = await observe();
  const eight = { ...observation, endpoints: observation.endpoints.filter(e => e.configuration.endpointName !== 'teacherUnitsCapabilities') };
  assert.throws(() => O.assertA3Observation(eight, STAGING, observation.observedAt), /nine sorted A3 endpoints/);
  const a1 = { kind: 'lyfelabz.backendObservation', schemaVersion: 1, project: STAGING, functions: [] };
  assert.throws(() => O.assertA3Observation(a1, STAGING, NOW), /not an A3 provider observation/);
  // The S4 provider without teacherUnitsCapabilities (A1's inventory) refuses at observation.
  await refused({ mutate: s => { delete s.endpoints.teacherUnitsCapabilities; } }, /missing or ambiguous Teacher Units endpoint: teacherUnitsCapabilities/);
  assert.equal(A1.REQUIRED_FUNCTIONS.length, 8, 'A1 inventory unchanged');
});

test('wrong project, project number or unsupported target', async () => {
  await refused({ mutate: s => { s.firebaseProject.projectNumber = '1'; } }, /wrong-project Firebase identity/);
  await refused({ mutate: s => { s.firebaseProject.projectId = 'lyfelabz-prod'; } }, /wrong-project Firebase identity/);
  await assert.rejects(O.observeA3Backend({ project: 'demo-x', get: async () => ({}) }), /explicit supported --project/);
  await assert.rejects(O.observeA3Backend({ get: async () => ({}) }), /explicit supported --project/);
  await assert.rejects(O.observeA3Backend({ project: STAGING }), /explicit GET transport/);
  await refused(edit((s, e) => { e.fn.name = e.fn.name.replace(STAGING, 'other-project'); }), /wrong-project|missing or ambiguous/);
  await refused(edit((s, e) => { e.revision.serviceAccount = 'x@other.iam.gserviceaccount.com'; }), /service account differs/);
});

test('wrong environment or region', async () => {
  const { observation } = await observe();
  assert.throws(() => O.assertA3Observation({ ...observation, environment: 'production' }, STAGING, observation.observedAt), /wrong-project or wrong-environment/);
  assert.throws(() => O.assertA3Observation(observation, 'lyfelabz-prod', observation.observedAt), /wrong-project or wrong-environment/);
  await refused(edit((s, e) => { e.fn.name = e.fn.name.replace('us-central1', 'europe-west1'); }), /not in us-central1/);
  await refused(edit((s, e) => {
    for (const k of ['latestReadyRevision', 'latestCreatedRevision']) e.service[k] = e.service[k].replace('us-central1', 'us-east1');
  }), /revision mismatch/);
  await refused(edit((s, e) => { e.fn.serviceConfig.service = e.fn.serviceConfig.service.replace('us-central1', 'us-east1'); }), /region mismatch|identity mismatch/);
});

test('missing, duplicate or extra endpoints', async () => {
  await refused({ mutate: s => { delete s.endpoints.teacherUnitsList; } }, /missing or ambiguous Teacher Units endpoint: teacherUnitsList/);
  await refused({ mutate: s => { s.extraFunctions.push({ ...s.endpoints[ID].fn, name: s.endpoints[ID].fn.name.replace('us-central1', 'us-east1') }); } }, /missing or ambiguous Teacher Units endpoint: teacherUnitsGet/);
  await refused({ mutate: s => { s.extraFunctions.push({ name: `projects/${STAGING}/locations/us-central1/functions/teacherUnitsDelete` }); } }, /unknown Teacher Units endpoint deployed: teacherUnitsDelete/);
});

test('incorrect generation, runtime, state or entry point', async () => {
  await refused(edit((s, e) => { e.fn.environment = 'GEN_1'; }), /GEN_2 ACTIVE/);
  await refused(edit((s, e) => { e.fn.state = 'DEPLOYING'; }), /GEN_2 ACTIVE/);
  await refused(edit((s, e) => { e.fn.buildConfig.runtime = 'nodejs20'; }), /runtime or entry point/);
  await refused(edit((s, e) => { e.fn.buildConfig.entryPoint = 'teacherUnitsList'; }), /runtime or entry point/);
  await refused(edit((s, e) => { e.fn.eventTrigger = { eventType: 'x' }; }), /eventTrigger is present/);
  await refused(edit((s, e) => { e.revision.containers.push({ ...e.revision.containers[0], name: 'sidecar' }); }), /exactly one application container/);
  await refused(edit((s, e) => { e.revision.containers[0].sourceCode = {}; }), /sourceCode is present/);
  await refused(edit((s, e) => { e.service.sshEnabled = true; }), /sshEnabled/);
  await refused(edit((s, e) => { e.service.reconciling = true; }), /reconciling/);
  await refused(edit((s, e) => { e.service.terminalCondition.state = 'CONDITION_FAILED'; }), /not ready/);
  await refused(edit((s, e) => { e.revision.conditions = []; }), /readiness unobserved/);
});

test('traffic splits, tagged routes and revision mismatch', async () => {
  await refused(edit((s, e) => { e.fn.serviceConfig.allTrafficOnLatestRevision = false; }), /not on the latest revision/);
  await refused(edit((s, e) => { e.service.trafficStatuses[0].percent = 90; e.service.trafficStatuses.push({ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: 'old', percent: 10 }); }), /traffic split/);
  await refused(edit((s, e) => { e.service.traffic.push({ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: 'old', percent: 0, tag: 'canary' }); }), /traffic split or tagged route/);
  await refused(edit((s, e) => { e.service.trafficStatuses[0].tag = 'blue'; }), /tagged route/);
  await refused(edit((s, e) => { e.service.trafficStatuses[0].revision = 'other-00002-xyz'; }), /serving revision mismatch/);
  await refused(edit((s, e) => { e.service.latestReadyRevision += 'x'; }), /revision mismatch/);
  await refused(edit((s, e) => { e.revision.name += 'x'; }), /revision identity mismatch/);
  await refused(edit((s, e) => { e.service.traffic[0].type = 'TRAFFIC_TARGET_ALLOCATION_TYPE_UNSPECIFIED'; }), /unknown traffic allocation/);
});

test('image digest and source archive mismatch', async () => {
  await refused(edit((s, e) => { e.revision.containers[0].image = 'us-central1-docker.pkg.dev/x/y/z:latest'; }), /not pinned by digest/);
  await refused(edit((s, e) => { e.fn.buildConfig.sourceProvenance.resolvedStorageSource.object = 'other.zip'; }), /resolved source differs/);
  await refused(edit((s, e) => { delete e.fn.buildConfig.sourceProvenance.resolvedStorageSource.generation; }), /source generation/);
  await refused({ mutate: s => { s.archive = Buffer.from('not a zip'); } }, /archive unverifiable/);
  // Different application payload on one endpoint.
  const other = synthesizeSource({ ...defaultFiles, 'lib/index.js': 'exports.other = true;\n' });
  try {
    await refused(edit((s, e) => {
      e.fn.buildConfig.sourceProvenance.resolvedStorageSource.object = 'other.zip';
      e.fn.buildConfig.source.storageSource.object = 'other.zip';
      s.onGet = (url) => url.includes('/o/other.zip') ? other.bytes : undefined;
    }), /different application payloads/);
  } finally { fs.rmSync(other.root, { recursive: true, force: true }); }
});

test('Rules and index mismatch against the plan', async () => {
  const { observation } = await observe();
  const now = observation.observedAt;
  const rules = planFor(observation, { rules: { sourceHash: 'd'.repeat(64) } });
  assert.throws(() => O.compareObservationToPlan(observation, rules.object, rules.bytes, STAGING, now), /rules\.sourceHash/);
  const indexes = planFor(observation, { readyIndexesConfigurationHash: 'e'.repeat(64) });
  assert.throws(() => O.compareObservationToPlan(observation, indexes.object, indexes.bytes, STAGING, now), /readyIndexesConfigurationHash/);
  await refused({ mutate: s => { s.rulesRelease.name = 'projects/other/releases/cloud.firestore'; } }, /wrong-project Rules release/);
  await refused({ mutate: s => { s.ruleset.source.files.push({ name: 'b', content: '' }); } }, /Rules source identity uncertain/);
  await refused({ mutate: s => { s.indexes = [{ name: `projects/${STAGING}/databases/(default)/collectionGroups/c/indexes/i`, state: 'CREATING',
    queryScope: 'COLLECTION', fields: [{ fieldPath: 'a', order: 'ASCENDING' }, { fieldPath: 'b', order: 'ASCENDING' }] }]; } }, /index not READY/);
});

test('unknown or unclassified environment variables fail closed (G1, O4)', async () => {
  const { observation } = await observe({ mutate: s => { for (const id of O.ENDPOINTS) s.endpoints[id].revision.containers[0].env.push({ name: 'UNLISTED', value: 'secret-looking-value' }); } });
  const plan = planFor(await (await observe()).observation);
  // Plan written for the baseline, observation carries an extra variable: refuses, and never echoes the value.
  assert.throws(() => O.compareObservationToPlan(observation, plan.object, plan.bytes, STAGING, observation.observedAt), error => {
    assert.match(error.message, /teacherUnitsArchive\.execution/); assert.doesNotMatch(error.message, /secret-looking-value/); return true; });
  await refused(edit((s, e) => { e.revision.containers[0].env.push({ name: 'FIREBASE_CONFIG', value: '{}' }); }), /duplicate or colliding/);
  await refused(edit((s, e) => { e.revision.containers[0].env[0].value = JSON.stringify({ projectId: 'lyfelabz-prod' }); }), /FIREBASE_CONFIG project mismatch/);
});

test('secret alias, latest or missing version is refused; values are never read', async () => {
  const secretRef = version => edit((s, e) => { e.revision.containers[0].env.push({ name: 'API', valueSource: { secretKeyRef: { secret: 'api', ...(version ? { version } : {}) } } }); });
  await refused(secretRef('latest'), /explicit numeric secret version/);
  await refused(secretRef('stable'), /explicit numeric secret version/);
  await refused(secretRef(undefined), /explicit numeric secret version/);
  const { observation } = await observe(secretRef('3'));
  const get = observation.endpoints.find(e => e.configuration.endpointName === ID).configuration.execution;
  assert.deepEqual(get.secretEnvironmentBindings, [{ name: 'API', secretResource: `projects/${STAGING}/secrets/api`, version: '3' }]);
  const volume = edit((s, e) => {
    e.revision.volumes = [{ name: 'cfg', secret: { secret: 'cfg', defaultMode: 292, items: [{ path: 'c.json', version: 'latest' }] } }];
    e.revision.containers[0].volumeMounts = [{ name: 'cfg', mountPath: '/etc/cfg' }];
  });
  await refused(volume, /explicit numeric secret version/);
  await refused(edit((s, e) => { e.revision.volumes = [{ name: 'tmp', emptyDir: {} }]; }), /emptyDir is present/);
});

test('unknown update policy is refused (G2)', async () => {
  await refused(edit((s, e) => { delete e.fn.buildConfig.automaticUpdatePolicy; }), /ambiguous or unobserved \(G2\)/);
  await refused(edit((s, e) => { e.fn.buildConfig.onDeployUpdatePolicy = { runtimeVersion: 'nodejs22_20261001' }; }), /ambiguous or unobserved/);
  await refused(edit((s, e) => { e.fn.buildConfig.automaticUpdatePolicy = { mode: 'x' }; }), /automatic update policy is unknown/);
  const { observation } = await observe(edit((s, e) => { delete e.fn.buildConfig.automaticUpdatePolicy; delete e.revision.containers[0].baseImageUri;
    e.fn.buildConfig.onDeployUpdatePolicy = { runtimeVersion: 'nodejs22_20261001' }; }));
  assert.deepEqual(observation.endpoints.find(e => e.configuration.endpointName === ID).configuration.build.runtimeUpdatePolicy,
    { kind: 'on-deploy', runtimeVersion: 'nodejs22_20261001', baseImageUri: null });
});

test('missing or unverifiable CPU, memory or execution environment', async () => {
  await refused(edit((s, e) => { delete e.revision.containers[0].resources.limits.cpu; }), /CPU is missing or unverifiable/);
  await refused(edit((s, e) => { delete e.revision.containers[0].resources.limits.memory; }), /memory is missing or unverifiable/);
  await refused(edit((s, e) => { e.revision.containers[0].resources.limits.memory = '256Xi'; }), /memory is missing or unverifiable/);
  await refused(edit((s, e) => { e.revision.containers[0].resources.limits.cpu = '0'; }), /CPU is missing/);
  await refused(edit((s, e) => { e.revision.containers[0].resources.limits['nvidia.com/gpu'] = '1'; }), /resource limits are unknown/);
  await refused(edit((s, e) => { delete e.revision.executionEnvironment; }), /admissibility unverifiable/);
  assert.equal(O.memoryBytes('1Gi', 'x'), '1073741824');
  assert.equal(O.memoryBytes('512M', 'x'), '512000000');
  assert.equal(O.cpuMilli('500m', 'x'), 500);
  assert.equal(O.cpuMilli('0.25', 'x'), 250);
  assert.equal(O.durationNanos('3.5s', 'x'), '3500000000');
  const { observation } = await observe();
  const plan = planFor(observation);
  plan.plan.endpoints[0].execution.cpuMilli = 2000;
  const changed = planFor(observation, { endpoints: plan.plan.endpoints });
  assert.throws(() => O.compareObservationToPlan(observation, changed.object, changed.bytes, STAGING, observation.observedAt), /teacherUnitsArchive\.execution/);
  plan.plan.endpoints[0].execution.cpuMilli = 1000; plan.plan.endpoints[0].runtimeProfile.revision.executionEnvironment = 'gen1';
  const env = planFor(observation, { endpoints: plan.plan.endpoints });
  assert.throws(() => O.compareObservationToPlan(observation, env.object, env.bytes, STAGING, observation.observedAt), /teacherUnitsArchive\.runtimeProfile/);
});

test('unknown provider fields are refused, not discarded', async () => {
  await refused(edit((s, e) => { e.fn.newSecurityKnob = true; }), /unknown provider field/);
  await refused(edit((s, e) => { e.service.futureField = 1; }), /unknown provider field/);
  await refused(edit((s, e) => { e.revision.containers[0].futureField = 1; }), /unknown provider field/);
  await refused(edit((s, e) => { e.revision.encryptionKey = 'k'; }), /encryptionKey is present/);
  await refused(edit((s, e) => { e.fn.serviceConfig.binaryAuthorizationPolicy = 'p'; }), /binaryAuthorizationPolicy/);
  await refused(edit((s, e) => { e.service.scaling = { manualInstanceCount: 3, scalingMode: 'MANUAL' }; }), /service-level scaling/);
  await refused(edit((s, e) => { e.fn.buildConfig.workerPool = 'p'; }), /workerPool is present/);
  await refused(edit((s, e) => { delete e.fn.buildConfig.serviceAccount; }), /build service account is unresolved/);
  await refused(edit((s, e) => { delete e.fn.buildConfig.dockerRepository; }), /docker repository is unresolved/);
});

test('provider permission errors and unreachable resources', async () => {
  const forbidden = A1.readApi({ token: 't', fetchImpl: async () => ({ ok: false, status: 403, headers: new Map() }) });
  await assert.rejects(O.observeA3Backend({ project: STAGING, get: forbidden, now: () => NOW }), /HTTP 403 \(credentials or read permission missing\)/);
  const offline = A1.readApi({ token: 't', fetchImpl: async () => { throw new Error('ENOTFOUND'); } });
  await assert.rejects(O.observeA3Backend({ project: STAGING, get: offline, now: () => NOW }), /deployment API unavailable/);
  await refused({ mutate: s => { s.onGet = url => url.endsWith('/locations/-/functions') ? { functions: [], unreachable: ['us-east1'] } : undefined; } }, /unreachable locations/);
});

test('incomplete or changing provider snapshots', async () => {
  await refused(edit((s, e) => { s.onGet = (url, count) => (url.includes('run.googleapis.com') && url.includes('/revisions/') && url.includes('teacherunitsget') && count === 2)
    ? { ...e.revision, timeout: '30s' } : undefined; }), /changed during observation: teacherUnitsGet/);
  await refused({ mutate: s => { s.onGet = (url, count) => url.endsWith('/releases/cloud.firestore') && count === 2 ? { ...s.rulesRelease, rulesetName: `projects/${STAGING}/rulesets/new` } : undefined; } }, /Rules changed/);
  let lists = 0;
  await refused({ mutate: s => { s.onGet = url => url.endsWith('/locations/-/functions') && ++lists === 2 ? { functions: [...s.other, ...O.ENDPOINTS.map(id => s.endpoints[id].fn),
    { name: `projects/${STAGING}/locations/us-central1/functions/late`, environment: 'GEN_2', state: 'ACTIVE' }] } : undefined; } }, /inventory changed/);
  await refused(edit((s, e) => { delete e.fn.serviceConfig.revision; }), /service or revision unavailable/);
});

test('stale or future observations', async () => {
  const { observation } = await observe();
  const later = new Date(Date.parse(observation.startedAt) + A1.MAX_AGE_MS + 1).toISOString();
  assert.throws(() => O.assertA3Observation(observation, STAGING, later), /stale or future/);
  const earlier = new Date(Date.parse(observation.observedAt) - 1000).toISOString();
  assert.throws(() => O.assertA3Observation(observation, STAGING, earlier), /stale or future/);
  let t = Date.parse(NOW);
  await refused({ clock: () => new Date(t += 60000).toISOString() }, /observation deadline exceeded/);
  await refused(edit((s, e) => { e.fn.updateTime = '2027-01-01T00:00:00.000Z'; }), /function updateTime is in the future/);
});

test('local candidate evidence is never deployed evidence', async () => {
  const { observation } = await observe();
  const local = A1.normalizeLocalIndexes({ indexes: [], fieldOverrides: [] });
  assert.throws(() => O.assertA3Observation(local, STAGING, NOW), /not an A3 provider observation/);
  const candidate = { kind: O.PLAN_KIND, ...planFor(observation).plan };
  assert.throws(() => O.assertA3Observation(candidate, STAGING, NOW), /not an A3 provider observation/);
  assert.throws(() => O.assertA3Observation({ ...observation, sources: ['local firebase.json'] }, STAGING, observation.observedAt), /provider GET sources/);
  const code = fs.readFileSync(path.join(__dirname, 'provider-observation.cjs'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /firebaserc|firebase\.json|firestore\.rules|firestore\.indexes|readFileSync|execFileSync|tokenFromGcloud|process\.env|node:fs/);
});

test('plan contract: content address, canonical bytes, exact command and nine endpoints', async () => {
  const { observation } = await observe();
  const now = observation.observedAt;
  const ok = planFor(observation);
  assert.deepEqual(O.compareObservationToPlan(observation, ok.object, ok.bytes, STAGING, now), { policy: 'a3-s4-plan-comparison-v1', matched: true, planSha256: ok.object.sha256 });
  assert.throws(() => O.compareObservationToPlan(observation, { ...ok.object, sha256: 'f'.repeat(64) }, ok.bytes, STAGING, now), /content object hash/);
  const pretty = Buffer.from(JSON.stringify(ok.plan, null, 1));
  assert.throws(() => O.compareObservationToPlan(observation, { ...ok.object, sha256: require('node:crypto').createHash('sha256').update(pretty).digest('hex') }, pretty, STAGING, now), /not canonical JSON/);
  const cmd = planFor(observation, { deployCommand: ['firebase', 'deploy', '--only', 'functions', '--project', STAGING] });
  assert.throws(() => O.compareObservationToPlan(observation, cmd.object, cmd.bytes, STAGING, now), /exact nine-endpoint deploy command/);
  const eight = planFor(observation, { endpoints: ok.plan.endpoints.slice(1) });
  assert.throws(() => O.compareObservationToPlan(observation, eight.object, eight.bytes, STAGING, now), /exactly the nine/);
  const prod = planFor(observation, { projectId: 'lyfelabz-prod' });
  assert.throws(() => O.compareObservationToPlan(observation, prod.object, prod.bytes, STAGING, now), /environment identity mismatch/);
  const missing = JSON.parse(JSON.stringify(ok.plan)); delete missing.endpoints[0].execution.memoryBytes;
  const m = planFor(observation, { endpoints: missing.endpoints });
  assert.throws(() => O.compareObservationToPlan(observation, m.object, m.bytes, STAGING, now), /structure invalid/);
  const extra = JSON.parse(JSON.stringify(ok.plan)); extra.endpoints[0].build.unknown = true;
  const x = planFor(observation, { endpoints: extra.endpoints });
  assert.throws(() => O.compareObservationToPlan(observation, x.object, x.bytes, STAGING, now), /structure invalid/);
  const sa = JSON.parse(JSON.stringify(ok.plan)); sa.endpoints[3].execution.serviceAccountEmail = 'teacher-units@lyfelabz-staging.iam.gserviceaccount.com';
  const s = planFor(observation, { endpoints: sa.endpoints });
  assert.throws(() => O.compareObservationToPlan(observation, s.object, s.bytes, STAGING, now), /teacherUnitsGet\.execution/);
  const payload = planFor(observation, { candidate: { ...ok.plan.candidate, runtimePayloadFingerprint: 'a'.repeat(64) } });
  assert.throws(() => O.compareObservationToPlan(observation, payload.object, payload.bytes, STAGING, now), /candidate/);
});

test('deterministic output for the same provider state and clock', async () => {
  const a = (await observe()).observation, b = (await observe()).observation;
  assert.equal(A1.canonical(a), A1.canonical(b));
});

test('GET-only transport through the reused A1 reader', async () => {
  const f = buildProvider();
  const methods = [];
  const fetchImpl = async (url, init) => {
    methods.push({ method: init.method, redirect: init.redirect, auth: init.headers.Authorization });
    const body = await f.get(url, url.includes('storage.googleapis.com'));
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    return { ok: true, status: 200, headers: new Map(), body: (async function* () { yield bytes; })() };
  };
  try {
    await O.observeA3Backend({ project: STAGING, get: A1.readApi({ token: 'synthetic-token', fetchImpl }), now: f.now });
  } finally { f.cleanup(); }
  assert.ok(methods.length > 40);
  assert.ok(methods.every(m => m.method === 'GET' && m.redirect === 'error'));
  assert.ok(f.calls.every(c => /^https:\/\/(firebase|firestore|cloudfunctions|run|storage|firebaserules)\.googleapis\.com\//.test(c.url)));
});

test('A1 and S4 runtime fingerprints equal the A3-2 runtime inventory', () => {
  const { root, bytes } = synthesizeSource(defaultFiles);
  try {
    const a1 = A1.archiveRuntime(bytes);
    const a32 = inventoryRuntimeArtifact(root);
    assert.equal(O.payloadSummary(a1.runtimeFiles), a32.runtimePayloadFingerprint);
    assert.equal(a1.artifactFingerprint, a32.functionsArtifactFingerprint);
    assert.equal(a1.placementFingerprint, a32.placementFingerprint);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('A1 and S4 fingerprints agree on the real compiled Functions artifact', () => {
  const functions = path.resolve(__dirname, '../../platform/functions');
  const zip = path.join(require('node:os').tmpdir(), `lyfelabz-s4-real-${process.pid}.zip`);
  try {
    execFileSync('zip', ['-X', '-q', '-r', zip, 'lib', 'package.json', 'package-lock.json'], { cwd: functions });
    const a1 = A1.archiveRuntime(fs.readFileSync(zip));
    const a32 = inventoryRuntimeArtifact(functions);
    assert.equal(O.payloadSummary(a1.runtimeFiles), a32.runtimePayloadFingerprint);
    assert.equal(a1.artifactFingerprint, a32.functionsArtifactFingerprint);
  } finally { fs.rmSync(zip, { force: true }); }
});

// ---------------------------------------------------------------------------
// F1-F4 permanent regressions (independent certification counterexamples).
// ---------------------------------------------------------------------------
// Observe a mutated provider and compare it with a plan approved for the baseline.
async function againstBaseline(mutate) {
  const base = (await observe()).observation;
  const plan = planFor(base);
  const { observation } = await observe({ mutate });
  return () => O.compareObservationToPlan(observation, plan.object, plan.bytes, STAGING, observation.observedAt);
}
const revisionAndTemplate = fn => (s, e) => { fn(e.revision); };

test('F1: each demonstrated configuration difference no longer matches', async () => {
  const cases = {
    cpuIdle: r => { r.containers[0].resources.cpuIdle = false; },
    startupCpuBoost: r => { r.containers[0].resources.startupCpuBoost = true; },
    concurrencyUtilization: r => { r.scaling.concurrencyUtilization = 0.5; },
    cpuUtilization: r => { r.scaling.cpuUtilization = 0.9; },
    sessionAffinity: r => { r.sessionAffinity = true; },
    terminationGracePeriod: r => { r.terminationGracePeriod = '30s'; },
    containerPort: r => { r.containers[0].ports[0].containerPort = 9090; },
    startupProbe: r => { r.containers[0].startupProbe = { tcpSocket: { port: 8080 }, periodSeconds: 240 }; },
    annotations: r => { r.annotations = { 'run.googleapis.com/startup-cpu-boost': 'true' }; },
  };
  for (const [name, change] of Object.entries(cases)) {
    const compare = await againstBaseline(edit(revisionAndTemplate(change)).mutate);
    assert.throws(compare, /teacherUnitsGet\.runtimeProfile/, name);
  }
});

test('F1: unknown nested fields inside accepted parents are refused', async () => {
  await refused(edit((s, e) => { e.revision.containers[0].startupProbe = { tcpSocket: { port: 8080, injected: true } }; }), /unknown provider field/);
  await refused(edit((s, e) => { e.revision.containers[0].startupProbe = { exec: { command: ['sh'] } }; }), /unknown provider field/);
  await refused(edit((s, e) => { e.revision.containers[0].ports[0].hostPort = 1; }), /unknown provider field/);
  await refused(edit((s, e) => { e.revision.scaling.surprise = 1; }), /unknown provider field/);
  await refused(edit((s, e) => { e.revision.conditions[0].extra = 1; }), /unknown provider field/);
  await refused(edit((s, e) => { e.service.terminalCondition.extra = 1; }), /unknown provider field/);
  await refused(edit((s, e) => { e.fn.serviceConfig.secretVolumes = [{ mountPath: '/s', secret: 'x', versions: [{ path: 'p', version: '1', extra: 1 }] }]; }), /unknown provider field/);
  await refused(edit((s, e) => { e.fn.serviceConfig.secretEnvironmentVariables = [{ key: 'K', secret: 's', version: 'latest' }]; }), /explicit numeric secret version/);
  await refused(edit((s, e) => { e.revision.containers[0].buildInfo = { sourceLocation: 'gs://elsewhere/src.zip' }; }), /sourceLocation is an unreviewed code source/);
  await refused(edit((s, e) => { e.revision.containers[0].resources.cpuIdle = 'yes'; }), /must be a boolean/);
});

test('F1: Functions service configuration and service fields are compared', async () => {
  const cases = {
    availableMemory: (s, e) => { e.fn.serviceConfig.availableMemory = '512Mi'; },
    timeoutSeconds: (s, e) => { e.fn.serviceConfig.timeoutSeconds = 540; },
    securityLevel: (s, e) => { e.fn.serviceConfig.securityLevel = 'SECURE_OPTIONAL'; },
    functionsEnv: (s, e) => { e.fn.serviceConfig.environmentVariables = { EXTRA: '1' }; },
    buildpackStack: (s, e) => { e.fn.buildpackStack = 'google-22'; },
    threatDetection: (s, e) => { e.service.threatDetectionEnabled = true; },
    serviceAnnotation: (s, e) => { e.service.annotations = { 'run.googleapis.com/x': 'y' }; },
    launchStage: (s, e) => { e.service.launchStage = 'BETA'; },
  };
  for (const [name, change] of Object.entries(cases)) assert.throws(await againstBaseline(edit(change).mutate), /teacherUnitsGet\.runtimeProfile/, name);
});

test('F1: service template must describe the serving revision', async () => {
  await refused(edit((s, e) => { e.service.template = { ...templateOf(e.revision), timeout: '30s' }; }), /template differs from the serving revision/);
  await refused(edit((s, e) => { e.service.template = { ...templateOf(e.revision), healthCheckDisabled: true }; }), /healthCheckDisabled/);
  await refused(edit((s, e) => { e.service.template = { ...templateOf(e.revision), revision: 'other-00009-zzz' }; }), /different revision/);
  await refused(edit((s, e) => { e.service.template = { ...templateOf(e.revision), unknown: 1 }; }), /unknown provider field/);
});

function changeOnRead(match, count, change) {
  return { mutate: s => { const reads = new Map(); s.onGet = url => {
    if (!url.includes(match)) return undefined;
    const n = (reads.get(url) || 0) + 1; reads.set(url, n);
    return n >= count ? change(s, url) : undefined;
  }; } };
}
const routed = (s, url) => {
  const id = O.ENDPOINTS.find(e => url.includes(`/services/${e.toLowerCase()}`) || url.endsWith(`/functions/${e}`));
  const e = s.endpoints[id];
  return url.includes('/revisions/') ? e.revision : url.includes('run.googleapis.com') ? { ...e.service, template: templateOf(e.revision) } : e.fn;
};

test('F2: an early endpoint changing after its initial reads is refused', async () => {
  // Sol: teacherUnitsArchive traffic changes on its third read (after the bracket).
  await refused(changeOnRead('run.googleapis.com/v2/projects/lyfelabz-staging/locations/us-central1/services/teacherunitsarchive', 3, (s, url) => {
    const v = routed(s, url);
    if (url.includes('/revisions/')) return v;
    return { ...v, traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: 'old', percent: 50 }, { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 50 }] };
  }), /changed before the observation completed: teacherUnitsArchive/);
});

test('F2: a later endpoint, revision identity, disappearance and failed reads are refused', async () => {
  await refused(changeOnRead('/functions/teacherUnitsUpdate', 3, (s, url) => ({ ...routed(s, url), updateTime: '2026-10-16T11:30:00.000Z' })), /changed before the observation completed: teacherUnitsUpdate/);
  await refused(changeOnRead('/functions/teacherUnitsCreate', 3, (s, url) => ({ ...routed(s, url), serviceConfig: { ...routed(s, url).serviceConfig, revision: 'teacherunitscreate-00002-new' } })), /changed before the observation completed|unavailable/);
  await refused(changeOnRead('/functions/teacherUnitsList', 3, () => ({})), /teacherUnitsList service or revision unavailable/);
  await refused(changeOnRead('/services/teacherunitsreorder/revisions/', 3, () => { throw new Error('[backend-state] REFUSED release readiness: deployment API run.googleapis.com HTTP 404'); }), /HTTP 404/);
  await refused(changeOnRead('/services/teacherunitsrestore', 3, (s, url) => url.includes('/revisions/') ? routed(s, url)
    : { ...routed(s, url), latestReadyRevision: `${routed(s, url).name}/revisions/teacherunitsrestore-00002-new` }), /changed before the observation completed: teacherUnitsRestore/);
});

test('F3: declared source generation must equal the resolved generation', async () => {
  // Sol: storageSource.generation 999 with resolved generation 1760000000000001 was accepted.
  await refused(edit((s, e) => { e.fn.buildConfig.source.storageSource.generation = '999'; }), /declared source generation differs/);
  await refused(edit((s, e) => { e.fn.buildConfig.source.storageSource.generation = 'abc'; }), /declared source generation is not a valid int64/);
  await refused(edit((s, e) => { delete e.fn.buildConfig.sourceProvenance.resolvedStorageSource.generation; }), /source generation/);
  await refused(edit((s, e) => { e.fn.buildConfig.sourceProvenance.resolvedStorageSource.generation = '01'; }), /source generation is not a valid int64/);
  await refused(edit((s, e) => { e.fn.buildConfig.source.storageSource.bucket = ''; e.fn.buildConfig.sourceProvenance.resolvedStorageSource.bucket = ''; }), /source/);
  const { observation } = await observe(edit((s, e) => { e.fn.buildConfig.source.storageSource.generation = '1760000000000001'; }));
  assert.equal(observation.endpoints.find(e => e.configuration.endpointName === ID).configuration.build.source.generation, '1760000000000001');
});

test('F4: strict provider timestamps', async () => {
  const bad = ['2026-02-30T00:00:00Z', '2026-10-16T11:00:00+00:00', '2026-10-16T24:00:00Z', '2026-10-16T11:60:00Z', '2026-10-16T11:00:60Z',
    '2026-10-16T11:00:00.1234Z', '2026-10-16T11:00:00.Z', '2026-10-16 11:00:00Z', '2026-10-16T11:00:00z', '2026-13-01T00:00:00Z', 'not a time'];
  for (const value of bad) {
    await refused(edit((s, e) => { e.fn.updateTime = value; }), /teacherUnitsGet function updateTime timestamp/);
    await refused(edit((s, e) => { e.service.updateTime = value; }), /teacherUnitsGet Cloud Run service updateTime timestamp/);
    await refused(edit((s, e) => { e.revision.createTime = value; }), /teacherUnitsGet revision createTime timestamp/);
  }
  await refused(edit((s, e) => { e.revision.conditions[0].lastTransitionTime = '2026-02-29T00:00:00Z'; }), /timestamp is not a valid calendar instant/);
  await refused(edit((s, e) => { e.fn.createTime = '2026-10-16T11:30:00Z'; }), /createTime is after updateTime/);
  await refused(edit((s, e) => { e.service.createTime = '2027-01-01T00:00:00Z'; }), /in the future/);
  await refused({ mutate: s => { s.rulesRelease.updateTime = '2026-04-31T00:00:00Z'; } }, /Rules release updateTime timestamp/);
  for (const ok of ['2024-02-29T00:00:00Z', '2026-10-16T11:00:00.123456Z', '2026-10-16T11:00:00.123456789Z']) {
    await observe(edit((s, e) => { e.fn.updateTime = ok; }));
  }
  assert.throws(() => O.instant('2026-10-16T12:00:00.000000000+01:00', 'x'), /not canonical/);
  const { observation } = await observe();
  assert.throws(() => O.assertA3Observation({ ...observation, observedAt: '2026-10-16T12:00:00.000+00:00' }, STAGING, observation.observedAt), /not canonical/);
});

test('source archive hash is recorded separately and enforced only when the plan binds it', async () => {
  const { observation } = await observe();
  const sha = observation.endpoints[0].configuration.build.source.sha256;
  assert.deepEqual(observation.sourceArchiveHashes, [sha]);
  assert.notEqual(sha, observation.runtimePayloadFingerprint);
  const exact = planFor(observation, { sourceArchive: { policy: 'exact', sha256: sha } });
  assert.equal(O.compareObservationToPlan(observation, exact.object, exact.bytes, STAGING, observation.observedAt).matched, true);
  const other = planFor(observation, { sourceArchive: { policy: 'exact', sha256: 'a'.repeat(64) } });
  assert.throws(() => O.compareObservationToPlan(observation, other.object, other.bytes, STAGING, observation.observedAt), /sourceArchive/);
  const unknown = planFor(observation, { sourceArchive: { policy: 'reproducible' } });
  assert.throws(() => O.compareObservationToPlan(observation, unknown.object, unknown.bytes, STAGING, observation.observedAt), /structure invalid/);
  // Same runtime payload in different archive bytes (an extra non-runtime file) is not refused for that reason alone.
  const alt = synthesizeSource({ ...defaultFiles, 'README.txt': 'docs only\n' });
  try {
    const { observation: second } = await observe({ mutate: s => { s.archive = alt.bytes; } });
    assert.equal(second.runtimePayloadFingerprint, observation.runtimePayloadFingerprint);
    assert.notDeepEqual(second.sourceArchiveHashes, observation.sourceArchiveHashes);
    const unbound = planFor(observation);
    assert.equal(O.compareObservationToPlan(second, unbound.object, unbound.bytes, STAGING, second.observedAt).matched, true);
    assert.throws(() => O.compareObservationToPlan(second, exact.object, exact.bytes, STAGING, second.observedAt), /sourceArchive/);
  } finally { fs.rmSync(alt.root, { recursive: true, force: true }); }
  assert.throws(() => O.assertA3Observation({ ...observation, sourceArchiveHashes: [] }, STAGING, observation.observedAt), /source archive hashes/);
});

// ---------------------------------------------------------------------------
// Second focused remediation (findings A to D) and the bounded field review.
// ---------------------------------------------------------------------------
test('A: a template base image differing from the serving revision is refused', async () => {
  // Counterexample: only service.template.containers[0].baseImageUri changed, previously matched: true.
  await refused(edit((s, e) => { const t = templateOf(e.revision); t.containers[0].baseImageUri = 'us-central1-docker.pkg.dev/attacker/base/nodejs22'; e.service.template = t; }),
    /template differs from the serving revision/);
  // A changed serving base image (revision and template together) no longer matches the approved plan.
  const compare = await againstBaseline(edit((s, e) => { e.revision.containers[0].baseImageUri = 'us-central1-docker.pkg.dev/other/base/nodejs22'; }).mutate);
  assert.throws(compare, /teacherUnitsGet\.(runtimeProfile|build)/);
  const { observation } = await observe();
  assert.equal(observation.endpoints[0].runtimeProfile.revision.container.baseImageUri, 'us-central1-docker.pkg.dev/serverless-runtimes/google-22/runtimes/nodejs22');
});

test('B: update policies require the documented object shape', async () => {
  for (const value of [[], null, 0, '', 'auto', true, { mode: 'x' }, [{}]]) {
    await refused(edit((s, e) => { e.fn.buildConfig.automaticUpdatePolicy = value; }), /automatic update policy is unknown/);
  }
  // The transport is injectable, so non-JSON shapes (an array carrying the field) must refuse too.
  const arrayPolicy = Object.assign([], { runtimeVersion: 'nodejs22_20261001' });
  for (const value of [[], null, 'nodejs22', { runtimeVersion: '' }, { runtimeVersion: 22 }, { runtimeVersion: 'n', extra: 1 }, ['nodejs22'], arrayPolicy]) {
    await refused(edit((s, e) => { delete e.fn.buildConfig.automaticUpdatePolicy; delete e.revision.containers[0].baseImageUri; e.fn.buildConfig.onDeployUpdatePolicy = value; }),
      /on-deploy update policy is unknown/);
  }
  assert.equal((await observe()).observation.endpoints[0].configuration.build.runtimeUpdatePolicy.kind, 'automatic');
  const { observation } = await observe(edit((s, e) => { delete e.fn.buildConfig.automaticUpdatePolicy; delete e.revision.containers[0].baseImageUri;
    e.fn.buildConfig.onDeployUpdatePolicy = { runtimeVersion: 'nodejs22_20261001' }; }));
  assert.equal(observation.endpoints.find(e => e.configuration.endpointName === ID).configuration.build.runtimeUpdatePolicy.kind, 'on-deploy');
});

test('C: Rules release and ruleset creation timestamps are strict and ordered', async () => {
  await refused({ mutate: s => { s.rulesRelease.createTime = '2026-02-30T00:00:00Z'; } }, /Rules release createTime timestamp/);
  await refused({ mutate: s => { s.ruleset.createTime = '2026-10-16 09:00:00Z'; } }, /Rules ruleset createTime timestamp/);
  await refused({ mutate: s => { s.rulesRelease.createTime = '2027-01-01T00:00:00Z'; } }, /Rules release createTime is in the future/);
  await refused({ mutate: s => { s.ruleset.createTime = '2027-01-01T00:00:00Z'; } }, /Rules ruleset createTime is in the future/);
  await refused({ mutate: s => { s.rulesRelease.createTime = '2026-10-16T10:30:00Z'; } }, /Rules release createTime is after updateTime/);
  const { observation } = await observe({ mutate: s => { s.rulesRelease.createTime = '2026-10-01T00:00:00Z'; s.ruleset.createTime = '2026-10-16T09:59:00.000Z'; } });
  assert.equal(observation.rules.updateTime, '2026-10-16T10:00:00.000Z');
});

test('D: a disabled Rules release is refused; an enabled release stays eligible', async () => {
  await refused({ mutate: s => { s.rulesRelease.disabled = true; } }, /Rules release is disabled/);
  await refused({ mutate: s => { s.rulesRelease.disabled = 'false'; } }, /disabled flag is malformed/);
  await refused({ mutate: s => { s.onGet = (url, count) => url.endsWith('/releases/cloud.firestore') && count === 2 ? { ...s.rulesRelease, disabled: true } : undefined; } }, /Rules changed during observation/);
  for (const disabled of [false, undefined]) {
    const { observation } = await observe({ mutate: s => { if (disabled !== undefined) s.rulesRelease.disabled = disabled; } });
    const plan = planFor(observation);
    assert.equal(O.compareObservationToPlan(observation, plan.object, plan.bytes, STAGING, observation.observedAt).matched, true);
  }
});

test('field review: Rules, ruleset and database eligibility fields', async () => {
  await refused({ mutate: s => { s.rulesRelease.extra = 1; } }, /unknown provider field/);
  await refused({ mutate: s => { s.ruleset.attachmentPoint = 'firestore.googleapis.com/databases/other'; } }, /attachmentPoint is present/);
  await refused({ mutate: s => { s.ruleset.source.language = 'EVENT_FLOW_TRIGGERS'; } }, /not FIREBASE_RULES/);
  await refused({ mutate: s => { s.ruleset.source.files[0].extra = 1; } }, /unknown provider field/);
  await refused({ mutate: s => { s.ruleset.metadata = { services: ['cloud.firestore'], extra: 1 }; } }, /unknown provider field/);
  await refused({ mutate: s => { s.database.deleteTime = '2026-10-16T09:00:00Z'; } }, /deleteTime is present/);
  await refused({ mutate: s => { s.database.firestoreDataAccessMode = 'DATA_ACCESS_MODE_DISABLED'; } }, /native data access is disabled/);
  await refused({ mutate: s => { s.database.updateTime = '2026-02-30T00:00:00Z'; } }, /Firestore database updateTime timestamp/);
  await refused({ mutate: s => { s.database.unknownMode = 'x'; } }, /unknown provider field/);
  await observe({ mutate: s => { s.ruleset.source.language = 'FIREBASE_RULES'; s.ruleset.metadata = { services: ['cloud.firestore'] }; s.database.firestoreDataAccessMode = 'DATA_ACCESS_MODE_ENABLED'; } });
});
