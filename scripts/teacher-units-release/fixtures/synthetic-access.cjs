'use strict';

// SYNTHETIC FIXTURE - NOT PROVIDER-VERIFIED (A3-6 S5).
// IAM policy shapes follow the Cloud Functions v2 Policy and Cloud Run v2
// GoogleIamV1Policy messages in Google Cloud SDK 583.0.0. Values are invented. No
// policy or URL here was recorded from a real project: these fixtures prove S5
// code behavior only and are never evidence of deployed IAM (gate G3 stays open).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PROJECT_NUMBERS } = require('../../hosting-release/backend-state.cjs');
const O = require('../provider-observation.cjs');
const R = require('../access-review.cjs');
const K = require('../../../platform/functions/lib/teacherUnits/a3-canonical.js');
const { buildProvider, planFor } = require('./synthetic-provider.cjs');

const SYNTHETIC = 'synthetic, not provider-verified';
const LOCAL_HOSTING = { hosting: [{ target: 'app', public: 'dist/app-hosting', rewrites: [{ source: '/app/a/**', destination: '/app/index.html' }] }] };
// Canonical Base64 of nonempty bytes, as IAM returns etags.
const ETAGS = Object.freeze({ run: Buffer.from('synthetic-run-etag').toString('base64'), fn: Buffer.from('synthetic-fn-etag').toString('base64') });

function defaultPolicies() {
  return {
    service: { version: 1, etag: ETAGS.run, bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }] },
    function: { etag: ETAGS.fn },
  };
}
// The documented default URL forms, bound to the synthetic project.
function urlsFor(project, id) {
  const service = id.toLowerCase();
  return { functionUrl: `https://us-central1-${project}.cloudfunctions.net/${id}`, legacy: `https://${service}-synth0001-uc.a.run.app`,
    deterministic: `https://${service}-${PROJECT_NUMBERS[project]}.us-central1.run.app` };
}

/**
 * Runs the S4 synthetic observation, then serves S5 reads from the same state.
 * `mutate(state)` edits S4 provider state before observation; `mutateAccess`
 * edits the IAM policies (and may edit S4 state after observation, which models
 * persistent drift); `onAccessGet(url, count)` can replace any S5 response.
 */
async function buildAccess({ project = 'lyfelabz-staging', mutate = () => {}, mutateAccess = () => {}, clock } = {}) {
  const f = buildProvider({ project, clock, mutate: state => {
    for (const id of O.ENDPOINTS) {
      const e = state.endpoints[id], u = urlsFor(project, id);
      e.fn.url = u.functionUrl; e.fn.serviceConfig.uri = u.legacy;
      e.service.uri = u.legacy; e.service.urls = [u.deterministic, u.legacy];
    }
    mutate(state);
  } });
  let observation;
  try { observation = await O.observeA3Backend({ project, get: f.get, now: f.now }); }
  finally { f.cleanup(); }
  const policies = {};
  for (const id of O.ENDPOINTS) policies[id] = defaultPolicies();
  const access = { policies, onAccessGet: null };
  mutateAccess(access, f.state);
  const calls = [], reads = new Map();
  const get = async (url, binary = false) => {
    calls.push({ url, binary });
    const count = (reads.get(url) || 0) + 1; reads.set(url, count);
    if (access.onAccessGet) { const replaced = access.onAccessGet(url, count, access, f.state); if (replaced !== undefined) return replaced; }
    const u = new URL(url);
    if (u.pathname.endsWith(':getIamPolicy')) {
      if (u.searchParams.get('options.requestedPolicyVersion') !== '3') throw new Error('synthetic provider expects requestedPolicyVersion=3');
      if (u.host === 'cloudfunctions.googleapis.com') return access.policies[u.pathname.split('/').pop().replace(':getIamPolicy', '')].function;
      if (u.host === 'run.googleapis.com') return access.policies[O.ENDPOINTS.find(e => u.pathname.endsWith(`/services/${e.toLowerCase()}:getIamPolicy`))].service;
    }
    return f.get(url, binary);
  };
  return { observation, deploymentPlan: planFor(observation), state: f.state, access, get, calls, now: f.now };
}

/** Expected-access plan matching the default synthetic posture, with overrides per endpoint. */
function expectedFor(observation, { endpoint = () => {}, top = {} } = {}) {
  const plan = {
    schemaVersion: 1, kind: R.EXPECTED_KIND, environment: observation.environment, projectId: observation.projectId,
    projectNumber: PROJECT_NUMBERS[observation.projectId], region: 'us-central1',
    endpoints: observation.endpoints.map(({ configuration }) => {
      const e = { endpointName: configuration.endpointName, runtimeServiceAccountEmail: configuration.execution.serviceAccountEmail,
        ingress: configuration.execution.ingress, invokerIamDisabled: false, iapEnabled: false, defaultUriDisabled: false, customAudiences: [],
        functionAllowPolicy: { version: 1, bindings: [] },
        serviceAllowPolicy: { version: 1, bindings: [{ role: 'roles/run.invoker', members: ['allUsers'], condition: null }] } };
      endpoint(e);
      return e;
    }),
    ...top,
  };
  const bytes = Buffer.from(K.canonicalJSON(plan), 'utf8');
  return { plan, bytes, object: { bucket: 'lyfelabz-evidence-synthetic', object: 'access/expected.json', generation: '1', sha256: K.sha256Bytes(bytes) } };
}

/** A scratch repository root holding one Hosting config under its environment's file name. */
function hostingRoot(project, config = LOCAL_HOSTING, raw) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lyfelabz-s5-hosting-'));
  fs.writeFileSync(path.join(root, R.HOSTING_CONFIG[project]), raw === undefined ? JSON.stringify(config) : raw);
  return root;
}
const RECEIPT_LOCATION = Object.freeze({ bucket: 'lyfelabz-evidence-synthetic', object: 'access/receipt.json', generation: '1' });

module.exports = { SYNTHETIC, LOCAL_HOSTING, ETAGS, RECEIPT_LOCATION, defaultPolicies, urlsFor, buildAccess, expectedFor, hostingRoot };
