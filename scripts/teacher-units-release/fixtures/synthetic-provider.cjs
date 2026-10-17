'use strict';

// SYNTHETIC FIXTURE - NOT PROVIDER-VERIFIED (A3-6 S4, owner decision O5).
// Response shapes follow the Cloud Functions v2 / Cloud Run v2 message
// definitions in Google Cloud SDK 583.0.0. Values are invented. No response
// here was recorded from a real project; gates G1, G2 and G4 stay open until a
// separately authorized staging observation replaces these fixtures.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PROJECT_NUMBERS } = require('../../hosting-release/backend-state.cjs');
const { ENDPOINTS, PLAN_KIND, deployCommand } = require('../provider-observation.cjs');
const K = require('../../../platform/functions/lib/teacherUnits/a3-canonical.js');

const SYNTHETIC = 'synthetic, not provider-verified';
const NOW = '2026-10-16T12:00:00.000Z';
const DIGEST = 'b'.repeat(64);

// Writes an application tree and zips it the way an uploaded Functions source is shaped.
function synthesizeSource(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lyfelabz-s4-src-'));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), body);
  }
  const archive = path.join(root, '..', `${path.basename(root)}.zip`);
  execFileSync('zip', ['-X', '-q', '-r', archive, '.'], { cwd: root });
  const bytes = fs.readFileSync(archive);
  fs.rmSync(archive, { force: true });
  return { root, bytes };
}
const defaultFiles = {
  'lib/index.js': 'exports.synthetic = true;\n',
  'lib/teacherUnits/unit-placeable-resources.json': JSON.stringify({ resourceIds: ['lesson_synthetic'] }),
  'lib/teacherUnits/a3-runtime-build.json': '{"synthetic":true}\n',
  'package.json': '{"name":"synthetic","main":"lib/index.js"}\n',
  'package-lock.json': '{}\n',
  'src/ignored.ts': 'not runtime\n',
};

function serviceName(project, id) { return `projects/${project}/locations/us-central1/services/${id.toLowerCase()}`; }
function endpointResponses(project, id) {
  const service = serviceName(project, id), revision = `${id.toLowerCase()}-00001-abc`;
  const sa = `${PROJECT_NUMBERS[project]}-compute@developer.gserviceaccount.com`;
  const fn = {
    name: `projects/${project}/locations/us-central1/functions/${id}`, environment: 'GEN_2', state: 'ACTIVE',
    updateTime: '2026-10-16T11:00:00.000Z', url: `https://us-central1-${project}.cloudfunctions.net/${id}`,
    labels: { 'deployment-tool': 'synthetic' },
    buildConfig: {
      runtime: 'nodejs22', entryPoint: id, build: `projects/${PROJECT_NUMBERS[project]}/locations/us-central1/builds/build-${id.toLowerCase()}`,
      dockerRegistry: 'ARTIFACT_REGISTRY', dockerRepository: `projects/${project}/locations/us-central1/repositories/gcf-artifacts`,
      serviceAccount: `projects/${project}/serviceAccounts/${sa}`,
      source: { storageSource: { bucket: 'gcf-v2-sources-synthetic-us-central1', object: 'source.zip' } },
      sourceProvenance: { resolvedStorageSource: { bucket: 'gcf-v2-sources-synthetic-us-central1', object: 'source.zip', generation: '1760000000000001' } },
      automaticUpdatePolicy: {},
    },
    serviceConfig: { service, revision, allTrafficOnLatestRevision: true, serviceAccountEmail: sa, availableMemory: '256Mi', availableCpu: '1',
      timeoutSeconds: 60, maxInstanceRequestConcurrency: 80, maxInstanceCount: 10, ingressSettings: 'ALLOW_ALL', uri: `https://${id.toLowerCase()}.a.run.app` },
  };
  const run = {
    name: service, generation: '1', observedGeneration: '1', ingress: 'INGRESS_TRAFFIC_ALL', launchStage: 'GA',
    latestReadyRevision: `${service}/revisions/${revision}`, latestCreatedRevision: `${service}/revisions/${revision}`,
    terminalCondition: { type: 'Ready', state: 'CONDITION_SUCCEEDED' },
    traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }],
    trafficStatuses: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision, percent: 100 }],
    uri: `https://${id.toLowerCase()}.a.run.app`,
  };
  const rev = {
    name: `${service}/revisions/${revision}`, service, generation: '1', serviceAccount: sa, timeout: '60s', maxInstanceRequestConcurrency: 80,
    executionEnvironment: 'EXECUTION_ENVIRONMENT_GEN2', scaling: { maxInstanceCount: 10 },
    conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }],
    containers: [{ name: 'worker', image: `us-central1-docker.pkg.dev/${project}/gcf-artifacts/${id.toLowerCase()}@sha256:${DIGEST}`,
      baseImageUri: 'us-central1-docker.pkg.dev/serverless-runtimes/google-22/runtimes/nodejs22',
      env: [{ name: 'FIREBASE_CONFIG', value: JSON.stringify({ projectId: project }) }, { name: 'LOG_EXECUTION_ID', value: 'true' }],
      resources: { limits: { cpu: '1', memory: '256Mi' }, cpuIdle: true }, ports: [{ name: 'http1', containerPort: 8080 }] }],
  };
  return { fn, service: run, revision: rev };
}

// Revision fields that a RevisionTemplate shares with a Revision.
const TEMPLATE_KEYS = ['annotations', 'containers', 'executionEnvironment', 'maxInstanceRequestConcurrency', 'scaling', 'serviceAccount',
  'sessionAffinity', 'terminationGracePeriod', 'timeout', 'volumes', 'vpcAccess'];
function templateOf(revision) {
  return JSON.parse(JSON.stringify(Object.fromEntries(TEMPLATE_KEYS.filter(k => revision[k] !== undefined).map(k => [k, revision[k]]))));
}

function buildProvider({ project = 'lyfelabz-staging', files = defaultFiles, mutate = () => {}, clock } = {}) {
  const { root, bytes } = synthesizeSource(files);
  const state = { project, archive: bytes, endpoints: {}, extraFunctions: [], other: [{ name: `projects/${project}/locations/us-central1/functions/assignmentsPublish`, environment: 'GEN_2', state: 'ACTIVE' }] };
  for (const id of ENDPOINTS) state.endpoints[id] = endpointResponses(project, id);
  state.firebaseProject = { projectId: project, projectNumber: PROJECT_NUMBERS[project], state: 'ACTIVE', name: `projects/${project}` };
  state.database = { name: `projects/${project}/databases/(default)`, type: 'FIRESTORE_NATIVE' };
  state.rulesRelease = { name: `projects/${project}/releases/cloud.firestore`, rulesetName: `projects/${project}/rulesets/ruleset-synthetic`, updateTime: '2026-10-16T10:00:00.000Z' };
  state.ruleset = { name: state.rulesRelease.rulesetName, source: { files: [{ name: 'firestore.rules', content: 'rules_version = "2";\n' }] } };
  state.indexes = []; state.fields = [];
  mutate(state);
  const calls = [];
  let tick = 0;
  const now = clock || (() => new Date(Date.parse(NOW) + tick++).toISOString());
  const reads = new Map();
  const get = async (url, binary = false) => {
    calls.push({ url, binary });
    const count = (reads.get(url) || 0) + 1; reads.set(url, count);
    if (state.onGet) { const replaced = state.onGet(url, count, state); if (replaced !== undefined) return replaced; }
    const u = new URL(url);
    if (u.host === 'firebase.googleapis.com') return state.firebaseProject;
    if (u.host === 'storage.googleapis.com') return state.archive;
    if (u.host === 'firebaserules.googleapis.com') return u.pathname.includes('/releases/') ? state.rulesRelease : state.ruleset;
    if (u.host === 'firestore.googleapis.com') {
      if (u.pathname.endsWith('/indexes')) return { indexes: state.indexes };
      if (u.pathname.endsWith('/fields')) return { fields: state.fields };
      return state.database;
    }
    if (u.host === 'cloudfunctions.googleapis.com') {
      if (u.pathname.endsWith('/locations/-/functions')) return { functions: [...state.other, ...state.extraFunctions,
        ...ENDPOINTS.filter(id => state.endpoints[id]).map(id => state.endpoints[id].fn)] };
      const id = u.pathname.split('/').pop();
      return state.endpoints[id].fn;
    }
    if (u.host === 'run.googleapis.com') {
      const id = ENDPOINTS.find(e => u.pathname.includes(`/services/${e.toLowerCase()}`));
      const e = state.endpoints[id];
      if (u.pathname.includes('/revisions/')) return e.revision;
      // By default the service template describes the serving revision.
      return e.service.template === undefined ? { ...e.service, template: templateOf(e.revision) } : e.service;
    }
    throw new Error(`synthetic provider has no route for ${url}`);
  };
  return { state, get, calls, now, root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function planFor(observation, overrides = {}) {
  const plan = {
    schemaVersion: 1, kind: PLAN_KIND, environment: observation.environment, projectId: observation.projectId, projectNumber: observation.projectNumber,
    region: 'us-central1', databaseId: '(default)', deployCommand: deployCommand(observation.projectId),
    candidate: { runtimePayloadFingerprint: observation.runtimePayloadFingerprint, functionsArtifactFingerprint: observation.functionsArtifactFingerprint,
      placementFingerprint: observation.placementFingerprint },
    rules: { sourceHash: observation.rules.sourceHash }, readyIndexesConfigurationHash: observation.readyIndexesConfigurationHash,
    sourceArchive: { policy: 'unbound' },
    endpoints: observation.endpoints.map(({ configuration, runtimeProfile }) => {
      const { source, ...build } = configuration.build;
      return { endpointName: configuration.endpointName, execution: configuration.execution, build, runtimeProfile };
    }),
  };
  const final = JSON.parse(JSON.stringify({ ...plan, ...overrides }));
  const bytes = Buffer.from(K.canonicalJSON(final), 'utf8');
  return { plan: final, bytes, object: { bucket: 'lyfelabz-evidence-synthetic', object: 'plans/synthetic.json', generation: '1', sha256: K.sha256Bytes(bytes) } };
}

module.exports = { templateOf, SYNTHETIC, NOW, DIGEST, defaultFiles, buildProvider, planFor, synthesizeSource };
