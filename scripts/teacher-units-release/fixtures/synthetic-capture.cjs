'use strict';

// SYNTHETIC FIXTURE - NOT PROVIDER-VERIFIED (A3-6 S6c).
// A synthetic exchange that serves the S4 provider, the S5 IAM policies and the
// S6c surfaces (Hosting channels, Cloud Run domain mappings, Compute serverless
// NEGs and backend services) as raw HTTP status and bytes. Shapes follow the
// documented Firebase Hosting v1beta1, Cloud Run v1 and Compute v1 messages as
// understood without a live observation; values are invented. Nothing here was
// recorded from a real project, and no capture built from it is provider
// evidence.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const O = require('../provider-observation.cjs');
const { buildProvider, planFor, defaultFiles, NOW } = require('./synthetic-provider.cjs');
const { defaultPolicies, urlsFor, expectedFor, hostingRoot } = require('./synthetic-access.cjs');
const K = require('../../../platform/functions/lib/teacherUnits/a3-canonical.js');
const RA = require('../../../platform/functions/lib/teacherUnits/a3-runtime-artifact.js');

const SYNTHETIC = 'synthetic, not provider-verified';
const SITES = { 'lyfelabz-prod': ['lyfelabz-marketing', 'lyfelabz-prod'], 'lyfelabz-staging': ['lyfelabz-staging', 'lyfelabz-staging-marketing'] };
class Http { constructor(status, body = { error: { code: status, status: 'SYNTHETIC' } }) { this.status = status; this.body = body; } }
const http = (status, body) => new Http(status, body);

/** A closed-only build record matching the synthetic runtime files, as write-a3-runtime-build.cjs would write it. */
function closedOnlyRecord(files, edit = r => r) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lyfelabz-s6c-inv-'));
  try {
    for (const [name, body] of Object.entries(files)) {
      if (name === RA.RUNTIME_BUILD_PATH) continue;
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      fs.writeFileSync(path.join(root, name), body);
    }
    const inventory = RA.inventoryRuntimeArtifact(root);
    return edit({ schemaVersion: 1, enforcementVersion: 'teacher-units-a3-v1', deploymentMode: 'closed-only', sourceSha: 'a'.repeat(40), sourceTree: 'b'.repeat(40),
      sourceDirty: false, runtimePayloadFingerprint: inventory.runtimePayloadFingerprint, placementFingerprint: inventory.placementFingerprint,
      supportedClientContractVersions: ['teacher-units-v2'] });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function filesWith(record) {
  const files = { ...defaultFiles };
  delete files[RA.RUNTIME_BUILD_PATH];
  if (record === null) return files;
  const value = record === undefined ? closedOnlyRecord(files) : typeof record === 'function' ? record(closedOnlyRecord(files)) : record;
  return { ...files, [RA.RUNTIME_BUILD_PATH]: typeof value === 'string' ? value : `${K.canonicalJSON(value)}\n` };
}

function defaultSurfaces(project) {
  const sites = SITES[project];
  return {
    sites: { sites: sites.map(s => ({ name: `projects/${project}/sites/${s}`, defaultUrl: `https://${s}.web.app` })) },
    channels: Object.fromEntries(sites.map(s => [s, { channels: [{ name: `sites/${s}/channels/live`,
      release: { name: `sites/${s}/channels/live/releases/r1`, type: 'DEPLOY',
        version: { name: `sites/${s}/versions/v1`, status: 'FINALIZED', config: { rewrites: [{ glob: '/app/**', path: '/app/index.html' }] } } } }] }])),
    domainMappings: { apiVersion: 'domains.cloudrun.com/v1', kind: 'DomainMappingList', metadata: {}, items: [] },
    negs: { kind: 'compute#networkEndpointGroupAggregatedList', items: { 'regions/us-central1': { warning: { code: 'NO_RESULTS_ON_PAGE' } } } },
    backendServices: { kind: 'compute#backendServiceAggregatedList', items: { global: { warning: { code: 'NO_RESULTS_ON_PAGE' } } } },
    onProbe: null,
  };
}

/**
 * Builds the plan and expected access from a setup observation, then returns a
 * fresh exchange and clock for the capture under test. `drift(state)` edits S4
 * state after the plan is fixed; `mutateAccess(access)` edits IAM; `mutateSurfaces`
 * edits the S6c surfaces; `onExchange(url, n)` may replace any raw response.
 */
async function buildCapture({ project = 'lyfelabz-staging', record, drift = () => {}, mutateAccess = () => {}, mutateSurfaces = () => {}, start, step = 1 } = {}) {
  const f = buildProvider({ project, files: filesWith(record), mutate: state => {
    for (const id of O.ENDPOINTS) {
      const e = state.endpoints[id], u = urlsFor(project, id);
      e.fn.url = u.functionUrl; e.fn.serviceConfig.uri = u.legacy;
      e.service.uri = u.legacy; e.service.urls = [u.deterministic, u.legacy];
    }
  } });
  let setup;
  try { setup = await O.observeA3Backend({ project, get: f.get, now: f.now }); } finally { f.cleanup(); }
  const deploymentPlan = planFor(setup), expected = expectedFor(setup);
  drift(f.state);
  const access = { policies: Object.fromEntries(O.ENDPOINTS.map(id => [id, defaultPolicies()])) };
  mutateAccess(access, f.state);
  const surfaces = defaultSurfaces(project);
  mutateSurfaces(surfaces, project);
  const fixture = { onExchange: null, calls: [] };
  const route = async url => {
    const u = new URL(url);
    if (u.pathname.endsWith(':getIamPolicy')) {
      if (u.host === 'cloudfunctions.googleapis.com') return access.policies[u.pathname.split('/').pop().replace(':getIamPolicy', '')].function;
      return access.policies[O.ENDPOINTS.find(e => u.pathname.endsWith(`/services/${e.toLowerCase()}:getIamPolicy`))].service;
    }
    if (u.host === 'firebasehosting.googleapis.com') {
      if (u.pathname.endsWith('/sites')) return surfaces.sites;
      const site = u.pathname.split('/')[3];
      return surfaces.channels[site] ?? http(404);
    }
    if (u.host === 'us-central1-run.googleapis.com') return surfaces.domainMappings;
    if (u.host === 'compute.googleapis.com') return u.pathname.endsWith('/networkEndpointGroups') ? surfaces.negs : surfaces.backendServices;
    return f.get(url, false);
  };
  const counts = new Map();
  const exchange = async url => {
    fixture.calls.push(url);
    const n = (counts.get(url) || 0) + 1; counts.set(url, n);
    let value = fixture.onExchange ? fixture.onExchange(url, n) : undefined;
    if (value === undefined && surfaces.onProbe) value = surfaces.onProbe(url, n);
    if (value === undefined) value = await route(url);
    if (value instanceof Http) return { status: value.status, bytes: Buffer.from(JSON.stringify(value.body)) };
    if (Buffer.isBuffer(value)) return { status: 200, bytes: Buffer.from(value) };
    return { status: 200, bytes: Buffer.from(JSON.stringify(value)) };
  };
  let tick = 0;
  const base = Date.parse(start || '2026-10-16T12:10:00.000Z');
  const clock = () => new Date(base + step * tick++).toISOString();
  const root = hostingRoot(project);
  return { project, exchange, clock, deploymentPlan, expected, hostingRoot: root, state: f.state, access, surfaces, fixture,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

module.exports = { SYNTHETIC, NOW, SITES, Http, http, closedOnlyRecord, filesWith, defaultSurfaces, buildCapture };
