'use strict';
// A3-6 S6c surface observation tests. SYNTHETIC fixtures only; no provider
// request is made. A denied, missing, disabled or ambiguous read must never be
// recorded as absence.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const PC = require('./provider-capture.cjs');
const SO = require('./surface-observation.cjs');
const K = require('../../platform/functions/lib/teacherUnits/a3-canonical.js');
const { SYNTHETIC, buildCapture, defaultSurfaces, http } = require('./fixtures/synthetic-capture.cjs');

const STAGING = 'lyfelabz-staging';
const roots = [];
test.after(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });

async function capture(options = {}) {
  const c = await buildCapture(options);
  roots.push(c.hostingRoot);
  const r = await PC.captureA3Provider({ project: c.project, exchange: c.exchange, clock: c.clock, deploymentPlan: c.deploymentPlan, expected: c.expected,
    hostingRoot: c.hostingRoot, evidenceClass: 'synthetic' });
  return { c, r };
}
let base;
const honest = async () => (base ||= await capture());

/** Runs only the surface observer against `surfaces` (defaults edited by `edit`), with the honest observation and archive. */
async function surfaces(edit = () => {}, { project = STAGING, override } = {}) {
  const { c, r } = await honest();
  const s = defaultSurfaces(project); edit(s);
  const archives = new Map(PC_reads(r.transcript).filter(e => e.mode === 'binary').map(e => [e.url, Buffer.from(e.body, 'base64')]));
  let tick = 0;
  const probe = async url => {
    const u = new URL(url);
    let value = override ? override(url) : undefined;
    if (value === undefined) {
      if (u.host === 'firebasehosting.googleapis.com') value = u.pathname.endsWith('/sites') ? s.sites : (s.channels[u.pathname.split('/')[3]] ?? http(404));
      else if (u.host === 'us-central1-run.googleapis.com') value = s.domainMappings;
      else value = u.pathname.endsWith('/networkEndpointGroups') ? s.negs : s.backendServices;
    }
    if (value && value.constructor && value.constructor.name === 'Http') return { status: value.status, json: value.body };
    return { status: 200, json: JSON.parse(JSON.stringify(value)) };
  };
  const report = await SO.observeSurfaces({ project, probe, archive: url => archives.get(url), observation: r.observation,
    now: () => new Date(Date.parse(r.observation.observedAt) + 1000 + tick++).toISOString() });
  void c;
  return report;
}
function PC_reads(t) { return t.events.filter(e => e.type === 'read'); }
const rewriteTo = (site, rewrite) => s => { s.channels[site].channels[0].release.version.config.rewrites.push(rewrite); };

test('fixtures are labelled synthetic, never provider-verified', () => {
  assert.equal(SYNTHETIC, 'synthetic, not provider-verified');
  assert.match(fs.readFileSync(path.join(__dirname, 'fixtures/synthetic-capture.cjs'), 'utf8'), /SYNTHETIC FIXTURE - NOT PROVIDER-VERIFIED/);
});

test('default surfaces: observed absence, closed-only build record, inherited IAM not observed', async () => {
  const report = await surfaces();
  assert.equal(report.hosting.status, 'observed-absent');
  assert.deepEqual(report.hosting.missingExpectedSites, []);
  assert.equal(report.domainMappings.status, 'observed-absent');
  assert.equal(report.serverlessNetworkEndpointGroups.status, 'observed-absent');
  assert.equal(report.buildRecord.status, 'observed-present');
  assert.deepEqual(report.buildRecord.deploymentModes, ['closed-only']);
  for (const a of report.buildRecord.archives) assert.equal(a.policyControlled, false, 'a closed-only record is never presented as policy-controlled');
  assert.deepEqual(report.inheritedIam, { ...SO.INHERITED_IAM });
  assert.deepEqual(report.blocking, []);
  assert.equal(report.levelB, 'not-claimed');
  assert.equal(report.authority, SO.AUTHORITY);
  assert.deepEqual(SO.STATUSES, ['observed-absent', 'observed-present', 'incomplete', 'unreadable', 'not-observed', 'inconsistent']);
});

test('Hosting rewrites to Functions or Cloud Run are observed present and blocking', async () => {
  const fn = await surfaces(rewriteTo('lyfelabz-staging', { glob: '/api/**', function: 'teacherUnitsGet', functionRegion: 'us-central1' }));
  assert.equal(fn.hosting.status, 'observed-present');
  assert.match(fn.blocking[0], /rewrites glob:\/api\/\*\* to function teacherUnitsGet \(Teacher Units\)/);
  const run = await surfaces(rewriteTo('lyfelabz-staging-marketing', { regex: '^/x$', run: { serviceId: 'teacherunitslist', region: 'us-central1' } }));
  assert.equal(run.hosting.status, 'observed-present');
  assert.match(run.blocking[0], /to run teacherunitslist \(Teacher Units\)/);
  // Any backend rewrite is exposure, not only a Teacher Units one (S5 refuses the same locally).
  const other = await surfaces(rewriteTo('lyfelabz-staging', { glob: '/x', function: 'assignmentsPublish' }));
  assert.equal(other.hosting.status, 'observed-present');
  assert.equal(other.blocking.length, 1);
  // Preview channels serve too and are inspected.
  const preview = await surfaces(s => { s.channels['lyfelabz-staging'].channels.push({ name: 'sites/lyfelabz-staging/channels/pr-1',
    release: { name: 'r', version: { name: 'v', status: 'FINALIZED', config: { rewrites: [{ glob: '**', run: { serviceId: 'teacherunitsget' } }] } } } }); });
  assert.equal(preview.hosting.status, 'observed-present');
});

test('Hosting: unreadable, incomplete and ambiguous responses are never absence', async () => {
  const cases = [
    [s => { s.sites = http(403); }, 'unreadable'],
    [s => { s.channels['lyfelabz-staging'] = http(404); }, 'unreadable'],
    [s => { s.sites = http(403, { error: { status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] } }); }, 'unreadable'],
    [s => { s.channels['lyfelabz-staging'].channels[0].release.version.config.rewrites.push({ glob: '/x', function: 'f', unknown: 1 }); }, 'incomplete'],
    [s => { s.channels['lyfelabz-staging'].channels[0].release.version.status = 'CREATED'; }, 'incomplete'],
    [s => { delete s.channels['lyfelabz-staging'].channels[0].release.version.config; }, 'incomplete'],
    [s => { s.sites.sites.push({ name: 'projects/lyfelabz-prod/sites/lyfelabz-prod' }); }, 'incomplete'],
    [s => { s.sites.nextPageToken = 'again'; }, 'incomplete'],
    [s => { s.sites = 'not json'; }, 'incomplete'],
    [s => { s.channels['lyfelabz-staging'].channels[0].name = 'sites/other/channels/live'; }, 'incomplete'],
  ];
  for (const [edit, status] of cases) {
    const report = await surfaces(edit);
    assert.equal(report.hosting.status, status, String(edit));
    assert.notEqual(report.hosting.status, 'observed-absent');
  }
  const missing = await surfaces(s => { s.sites.sites.pop(); });
  assert.deepEqual(missing.hosting.missingExpectedSites, ['lyfelabz-staging-marketing']);
  assert.deepEqual(SO.EXPECTED_SITES['lyfelabz-prod'], ['lyfelabz-marketing', 'lyfelabz-prod']);
});

test('pagination is followed with its token; a repeated token is incomplete', async () => {
  let page = 0;
  const report = await surfaces(() => {}, { override: url => {
    if (!url.includes('domainmappings')) return undefined;
    page++;
    return new URL(url).searchParams.get('continue') === 'p2'
      ? { kind: 'DomainMappingList', items: [{ metadata: { name: 'units.example.org' }, spec: { routeName: 'teacherunitsget' } }], metadata: {} }
      : { kind: 'DomainMappingList', items: [], metadata: { continue: 'p2' } };
  } });
  assert.equal(page, 2);
  assert.equal(report.domainMappings.status, 'observed-present');
  let loops = 0;
  const loop = await surfaces(() => {}, { override: url => (url.includes('domainmappings') ? (loops++, { kind: 'DomainMappingList', items: [], metadata: { continue: 'same' } }) : undefined) });
  assert.equal(loop.domainMappings.status, 'incomplete');
  assert.equal(loops, 2, 'a repeated token stops at once rather than paging to the limit');
});

test('unexpected domain mappings are observed present and blocking; others are recorded', async () => {
  const hit = await surfaces(s => { s.domainMappings.items = [{ metadata: { name: 'units.example.org' }, spec: { routeName: 'teacherunitsupdate' } },
    { metadata: { name: 'www.example.org' }, spec: { routeName: 'website' } }]; });
  assert.equal(hit.domainMappings.status, 'observed-present');
  assert.equal(hit.blocking.length, 1);
  assert.match(hit.blocking[0], /units\.example\.org routes to Teacher Units service teacherunitsupdate/);
  const other = await surfaces(s => { s.domainMappings.items = [{ metadata: { name: 'www.example.org' }, spec: { routeName: 'website' } }]; });
  assert.equal(other.domainMappings.status, 'observed-absent');
  assert.equal(other.domainMappings.mappings.length, 1);
  for (const [edit, status] of [[s => { s.domainMappings = http(403); }, 'unreadable'], [s => { s.domainMappings = http(404); }, 'unreadable'],
    [s => { s.domainMappings.unreachable = ['us-east1']; }, 'incomplete'], [s => { s.domainMappings.items = [{ metadata: { name: 'x' } }]; }, 'incomplete']]) {
    assert.equal((await surfaces(edit)).domainMappings.status, status);
  }
});

test('serverless NEGs and their backend services', async () => {
  const neg = (name, extra) => ({ name, selfLink: `https://www.googleapis.com/compute/v1/projects/${STAGING}/regions/us-central1/networkEndpointGroups/${name}`,
    networkEndpointType: 'SERVERLESS', region: `https://www.googleapis.com/compute/v1/projects/${STAGING}/regions/us-central1`, ...extra });
  const withNegs = (negs, backends = []) => s => {
    s.negs.items = { 'regions/us-central1': { networkEndpointGroups: negs } };
    s.backendServices.items = { global: backends.length ? { backendServices: backends } : { warning: { code: 'NO_RESULTS_ON_PAGE' } } };
  };
  const units = neg('units', { cloudRun: { service: 'teacherunitsget' } });
  const hit = await surfaces(withNegs([units, neg('site', { cloudRun: { service: 'website' } })],
    [{ name: 'lb', selfLink: `https://www.googleapis.com/compute/v1/projects/${STAGING}/global/backendServices/lb`, backends: [{ group: units.selfLink }] },
      { name: 'other', selfLink: `https://www.googleapis.com/compute/v1/projects/${STAGING}/global/backendServices/other`, backends: [] }]));
  assert.equal(hit.serverlessNetworkEndpointGroups.status, 'observed-present');
  assert.equal(hit.serverlessNetworkEndpointGroups.negs.length, 2);
  assert.deepEqual(hit.serverlessNetworkEndpointGroups.backendServices.map(b => b.name), ['lb']);
  assert.equal(hit.blocking.length, 2);
  for (const target of [{ cloudFunction: { function: 'teacherUnitsList' } }, { cloudRun: { urlMask: '<service>.example.org' } }, { serverlessDeployment: { platform: 'apigateway.googleapis.com', resource: 'gateway' } }]) {
    assert.equal((await surfaces(withNegs([neg('n', target)]))).serverlessNetworkEndpointGroups.status, 'observed-present', JSON.stringify(target));
  }
  const unrelated = await surfaces(withNegs([neg('site', { cloudRun: { service: 'website' } }), { name: 'zonal', selfLink: `https://www.googleapis.com/compute/v1/projects/${STAGING}/zones/a/networkEndpointGroups/zonal`, networkEndpointType: 'GCE_VM_IP_PORT' }]));
  assert.equal(unrelated.serverlessNetworkEndpointGroups.status, 'observed-absent');
  for (const [edit, status] of [
    [s => { s.negs = http(403, { error: { message: 'Compute Engine API has not been used in project', status: 'PERMISSION_DENIED' } }); }, 'unreadable'],
    [s => { s.backendServices = http(403); }, 'unreadable'],
    [s => { s.negs.unreachables = ['regions/us-east1']; }, 'incomplete'],
    [s => { s.negs.items['regions/us-east1'] = { warning: { code: 'UNREACHABLE' } }; }, 'incomplete'],
    [withNegs([neg('bad', {})]), 'incomplete'],
    [s => { s.negs.nextPageToken = 7; }, 'incomplete'],
  ]) assert.equal((await surfaces(edit)).serverlessNetworkEndpointGroups.status, status);
});

test('build record: closed-only observed; invalid hashes, schemas and modes are recorded and blocking', async () => {
  const { r } = await honest();
  const closed = r.surfaceReport.buildRecord;
  assert.equal(closed.status, 'observed-present');
  assert.equal(closed.archives[0].recordSha256.length, 64);
  assert.equal(closed.archives[0].archiveSha256, r.observation.sourceArchiveHashes[0]);

  const policy = (await capture({ record: rec => ({ ...rec, deploymentMode: 'policy-controlled' }) })).r.surfaceReport;
  assert.equal(policy.buildRecord.status, 'observed-present');
  assert.deepEqual(policy.buildRecord.deploymentModes, ['policy-controlled']);
  assert.equal(policy.buildRecord.archives[0].policyControlled, true);
  assert.match(policy.blocking[0], /policy-controlled artifacts remain blocking until separately authorized/);

  const cases = [
    [{ record: '{"synthetic":true}\n' }, 'inconsistent', /fails the A3 runtime build schema/],
    [{ record: rec => ({ ...rec, runtimePayloadFingerprint: 'e'.repeat(64) }) }, 'inconsistent', /fingerprints differ from the observed artifact/],
    [{ record: rec => `${JSON.stringify(rec, null, 2)}\n` }, 'inconsistent', /canonical written form/],
    [{ record: 'not json' }, 'inconsistent', /not strict JSON/],
    [{ record: rec => ({ ...rec, deploymentMode: 'policy-controlled', sourceDirty: true }) }, 'inconsistent', /schema/],
    [{ record: null }, 'observed-absent', /absent from the deployed archive/],
  ];
  for (const [options, status, pattern] of cases) {
    const report = (await capture(options)).r.surfaceReport;
    assert.equal(report.buildRecord.status, status, JSON.stringify(options.record && String(options.record)));
    assert.match(report.blocking.join('\n'), pattern);
  }
});

test('build record bytes are checked against the observed archive hash; uncaptured archives are not observed', async () => {
  const { r } = await honest();
  const run = archive => SO.observeSurfaces({ project: STAGING, probe: async () => ({ status: 403, json: {} }), archive, observation: r.observation,
    now: () => new Date(Date.parse(r.observation.observedAt) + 1000).toISOString() });
  assert.equal((await run(() => undefined)).buildRecord.status, 'not-observed');
  const altered = await run(() => Buffer.from('PK not the archive'));
  assert.equal(altered.buildRecord.status, 'inconsistent');
  assert.match(altered.blocking.join('\n'), /do not match the observed archive hash/);
  // An observation whose artifact fingerprint is not the archive's is inconsistent, even with matching archive bytes.
  const archives = new Map(r.transcript.events.filter(e => e.type === 'read' && e.mode === 'binary').map(e => [e.url, Buffer.from(e.body, 'base64')]));
  const forged = await SO.observeSurfaces({ project: STAGING, probe: async () => ({ status: 403, json: {} }), archive: url => archives.get(url),
    observation: { ...r.observation, functionsArtifactFingerprint: 'd'.repeat(64) }, now: () => new Date(Date.parse(r.observation.observedAt) + 1000).toISOString() });
  assert.equal(forged.buildRecord.status, 'inconsistent');
  assert.match(forged.blocking.join('\n'), /artifact fingerprint differs/);
  // Every surface read denied: recorded unreadable, never absent.
  for (const key of ['hosting', 'domainMappings', 'serverlessNetworkEndpointGroups']) assert.equal(altered[key].status, 'unreadable');
  assert.equal(altered.inheritedIam.status, 'not-observed');
});

test('the surface observer requires an explicit cloud project, transports and an S4 observation', async () => {
  const { r } = await honest();
  const ok = { probe: async () => ({ status: 200, json: {} }), archive: () => undefined, now: () => r.observation.observedAt, observation: r.observation };
  await assert.rejects(SO.observeSurfaces({ ...ok, project: 'demo-x' }), /explicit supported --project/);
  await assert.rejects(SO.observeSurfaces({ ...ok, project: STAGING, probe: undefined }), /explicit probe/);
  await assert.rejects(SO.observeSurfaces({ ...ok, project: 'lyfelabz-prod' }), /wrong-project/);
  await assert.rejects(SO.observeSurfaces({ ...ok, project: STAGING, observation: { ...r.observation, endpoints: r.observation.endpoints.slice(1) } }), /nine sorted/);
  assert.equal(SO.readPlan(STAGING).find(p => p.surface === 'inheritedIam').status, 'not-observed');
  assert.doesNotThrow(() => K.canonicalJSON(SO.readPlan(STAGING)));
});

// --- certification correction F1: malformed HTTP 200 is never absence ---------
test('F1: malformed or incomplete successful listings are incomplete, never observed-absent', async () => {
  const site = 'lyfelabz-staging';
  const cases = {
    hosting: [s => { s.sites = {}; }, s => { s.sites = { sites: 'x' }; }, s => { s.sites = { sites: [], unexpected: 1 }; }, s => { s.sites.nextPageToken = 7; },
      s => { s.sites.nextPageToken = ''; }, s => { s.channels[site] = {}; }, s => { s.channels[site] = { channels: {} }; },
      s => { delete s.channels[site].channels[0].release; }, s => { s.channels[site].channels[0].release = 'r'; },
      s => { s.channels[site].channels[0].release.version.config.rewrites = 'x'; }, s => { s.channels[site].channels[0].release.version.config.rewrites = [7]; },
      s => { s.channels[site].channels[0] = null; }, s => { s.sites.sites = [{ name: 7 }]; }],
    domainMappings: [s => { s.domainMappings = {}; }, s => { s.domainMappings = { items: {} }; }, s => { s.domainMappings.metadata = 'x'; },
      s => { s.domainMappings.metadata = { continue: 5 }; }, s => { s.domainMappings.kind = 'Other'; }, s => { s.domainMappings.extra = true; },
      s => { s.domainMappings.items = [{ metadata: { name: 'a' }, spec: { routeName: 9 } }]; }, s => { s.domainMappings.items = [null]; }],
    serverlessNetworkEndpointGroups: [s => { s.negs = {}; }, s => { s.negs = { items: [] }; }, s => { s.backendServices = { kind: 'x' }; },
      s => { s.negs.items['regions/us-central1'] = { networkEndpointGroups: 'x' }; }, s => { s.negs.items['regions/us-central1'] = 'x'; },
      s => { s.negs.items['regions/us-central1'] = { networkEndpointGroups: [{ name: 'n', selfLink: 'https://x/projects/p/n' }] }; },
      s => { s.backendServices.items.global = { backendServices: [{ name: 'b', selfLink: 'https://x/projects/p/b', backends: 'x' }] }; },
      s => { s.negs.nextPageToken = 3; }, s => { s.negs.unexpected = 1; }],
  };
  for (const [surface, edits] of Object.entries(cases)) {
    for (const edit of edits) {
      const report = await surfaces(edit);
      assert.equal(report[surface].status, 'incomplete', `${surface}: ${edit}`);
      assert.notEqual(report[surface].exposure, 'none');
    }
  }
  // A structurally valid, explicitly empty, complete listing is the only route to observed-absent.
  const empty = await surfaces(s => { s.domainMappings = { apiVersion: 'domains.cloudrun.com/v1', kind: 'DomainMappingList', metadata: {}, items: [] }; });
  assert.equal(empty.domainMappings.status, 'observed-absent');
  assert.equal(empty.domainMappings.exposure, 'none');
  const noRewrites = await surfaces(s => { delete s.channels[site].channels[0].release.version.config.rewrites; });
  assert.equal(noRewrites.hosting.status, 'observed-absent', 'an omitted repeated field inside a valid config is an empty repeated field');
  // An incomplete sites listing does not claim which expected sites are missing.
  assert.equal((await surfaces(s => { s.sites = {}; })).hosting.missingExpectedSites, null);
});

// --- certification correction F2: findings survive later failures --------------
const dangerous = { metadata: { name: 'units.example.org' }, spec: { routeName: 'teacherunitsget' } };
test('F2: a dangerous mapping on page one survives a 403, a malformed page or a repeated token on page two', async () => {
  for (const second of [{ status: 403, json: {} }, { status: 200, json: { kind: 'DomainMappingList', items: 'x' } }, { status: 200, json: { kind: 'DomainMappingList', items: [], metadata: { continue: 'p2' } } }, { status: 200, json: 'nope' }]) {
    const report = await surfaces(() => {}, { override: url => {
      if (!url.includes('domainmappings')) return undefined;
      if (new URL(url).searchParams.get('continue') === 'p2') return second.status === 200 ? second.json : require('./fixtures/synthetic-capture.cjs').http(second.status);
      return { kind: 'DomainMappingList', items: [dangerous], metadata: { continue: 'p2' } };
    } });
    assert.ok(['unreadable', 'incomplete'].includes(report.domainMappings.status), JSON.stringify(second));
    assert.equal(report.domainMappings.exposure, 'observed-present');
    assert.equal(report.domainMappings.mappings.length, 1);
    assert.match(report.blocking.join('\n'), /units\.example\.org routes to Teacher Units service teacherunitsget/);
  }
  // A malformed entry next to a dangerous one keeps the dangerous one.
  const mixed = await surfaces(s => { s.domainMappings.items = [null, dangerous]; });
  assert.equal(mixed.domainMappings.status, 'incomplete');
  assert.equal(mixed.blocking.length, 1);
});

test('F2: a dangerous Hosting rewrite survives malformed pagination, malformed siblings and a failed later sites page', async () => {
  const site = 'lyfelabz-staging';
  const rewrite = { glob: '/api/**', function: 'teacherUnitsGet' };
  const cases = [
    s => { rewriteTo(site, rewrite)(s); s.channels[site].nextPageToken = 5; },
    s => { rewriteTo(site, rewrite)(s); s.channels[site].channels[0].release.version.config.rewrites.push({ glob: '/x', bogus: 1 }); },
    s => { rewriteTo(site, rewrite)(s); s.channels[site].channels.push({ name: `sites/${site}/channels/pr` }); },
    s => { rewriteTo(site, rewrite)(s); s.channels[site].channels[0].release.version.status = 'CREATED'; },
    s => { rewriteTo(site, rewrite)(s); s.channels[site].nextPageToken = 'again'; s.channels[`${site}?again`] = undefined; },
  ];
  for (const edit of cases) {
    const report = await surfaces(edit, { override: url => (url.includes('pageToken=again') ? { channels: [], nextPageToken: 'again' } : undefined) });
    assert.equal(report.hosting.status, 'incomplete', String(edit));
    assert.equal(report.hosting.exposure, 'observed-present');
    assert.match(report.blocking.join('\n'), /rewrites glob:\/api\/\*\* to function teacherUnitsGet/);
  }
  // A sites listing that fails on page two still inspects the site seen on page one.
  const paged = await surfaces(s => { rewriteTo(site, rewrite)(s); s.sites = { sites: [{ name: `projects/lyfelabz-staging/sites/${site}` }], nextPageToken: 'p2' }; },
    { override: url => (url.includes('/sites?pageToken=p2') ? require('./fixtures/synthetic-capture.cjs').http(403) : undefined) });
  assert.equal(paged.hosting.status, 'unreadable');
  assert.equal(paged.hosting.exposure, 'observed-present');
  assert.equal(paged.blocking.length, 1);
});

test('F2: a dangerous NEG survives an unreadable or malformed backend-service listing', async () => {
  const neg = { name: 'units', selfLink: `https://www.googleapis.com/compute/v1/projects/${STAGING}/regions/us-central1/networkEndpointGroups/units`,
    networkEndpointType: 'SERVERLESS', cloudRun: { service: 'teacherunitsget' } };
  for (const backend of [http(403), { kind: 'x' }, { items: { global: 'x' } }]) {
    const report = await surfaces(s => { s.negs.items = { 'regions/us-central1': { networkEndpointGroups: [neg] } }; s.backendServices = backend; });
    assert.ok(['unreadable', 'incomplete'].includes(report.serverlessNetworkEndpointGroups.status));
    assert.equal(report.serverlessNetworkEndpointGroups.exposure, 'observed-present');
    assert.match(report.blocking.join('\n'), /serverless NEG .*units: Cloud Run service teacherunitsget/);
  }
  // A malformed sibling NEG and a repeated token after the dangerous one keep it.
  const sibling = await surfaces(s => { s.negs.items = { 'regions/us-central1': { networkEndpointGroups: [{ name: 'bad' }, neg] } }; s.negs.nextPageToken = 't'; },
    { override: url => (url.includes('networkEndpointGroups?pageToken=t') ? { items: { 'regions/us-central1': { warning: { code: 'NO_RESULTS_ON_PAGE' } } }, nextPageToken: 't' } : undefined) });
  assert.equal(sibling.serverlessNetworkEndpointGroups.status, 'incomplete');
  assert.equal(sibling.blocking.length, 1);
});

test('F2: replay and bundle verification reproduce the retained findings and blocking classification', async () => {
  const c = await buildCapture({ mutateSurfaces: s => {
    s.onProbe = url => {
      if (!url.includes('domainmappings')) return undefined;
      return new URL(url).searchParams.get('continue') === 'p2' ? http(403) : { kind: 'DomainMappingList', items: [dangerous], metadata: { continue: 'p2' } };
    };
  } });
  roots.push(c.hostingRoot);
  const r = await PC.captureA3Provider({ project: c.project, exchange: c.exchange, clock: c.clock, deploymentPlan: c.deploymentPlan, expected: c.expected,
    hostingRoot: c.hostingRoot, evidenceClass: 'synthetic' });
  assert.equal(r.surfaceReport.domainMappings.status, 'unreadable');
  assert.equal(r.surfaceReport.domainMappings.exposure, 'observed-present');
  assert.equal(r.bundle.surfaces.domainMappings, 'unreadable');
  assert.equal(r.bundle.surfaces.blocking, 1);
  const verified = await PC.verifyCapture({ project: c.project, files: r.bytes, deploymentPlan: c.deploymentPlan, expected: c.expected, hostingRoot: c.hostingRoot });
  assert.equal(verified.surfaces.blocking, 1);
  assert.equal(verified.surfaces.domainMappings, 'unreadable');
  // Dropping the retained finding from the report or the count from the bundle refuses.
  const edit = (key, fn) => { const v = JSON.parse(r.bytes[key]); fn(v); return { ...r.bytes, [key]: Buffer.from(K.canonicalJSON(v)) }; };
  await assert.rejects(PC.verifyCapture({ project: c.project, files: edit('surfaceReport', v => { v.blocking = []; v.domainMappings.findings = []; }),
    deploymentPlan: c.deploymentPlan, expected: c.expected, hostingRoot: c.hostingRoot }), /surface-report\.json differs/);
  await assert.rejects(PC.verifyCapture({ project: c.project, files: edit('bundle', v => { v.surfaces.blocking = 0; }),
    deploymentPlan: c.deploymentPlan, expected: c.expected, hostingRoot: c.hostingRoot }), /capture\.json differs/);
});

// --- second certification correction: identity/target, completeness and exposure are independent ---
const NEG_LINK = name => `https://www.googleapis.com/compute/v1/projects/${STAGING}/regions/us-central1/networkEndpointGroups/${name}`;
const BS_LINK = name => `https://www.googleapis.com/compute/v1/projects/${STAGING}/global/backendServices/${name}`;
const dangerousNeg = () => ({ kind: 'compute#networkEndpointGroup', name: 'units', selfLink: NEG_LINK('units'), networkEndpointType: 'SERVERLESS', cloudRun: { service: 'teacherunitsget' } });
const setNegs = (s, negs) => { s.negs.items = { 'regions/us-central1': { networkEndpointGroups: negs } }; };
const setBackends = (s, list) => { s.backendServices.items = { global: { backendServices: list } }; };
const SITE = 'lyfelabz-staging';
const liveRelease = s => s.channels[SITE].channels[0].release;
const rewriteFinding = /Hosting sites\/lyfelabz-staging\/channels\/live rewrites glob:\/api\/\*\* to function teacherUnitsGet/;

test('second correction: the six recertification findings', async () => {
  const negsOf = r => r.serverlessNetworkEndpointGroups;
  // F1-A: a numeric Cloud Run service is malformed: incomplete, and no invented exposure.
  const a = await surfaces(s => setNegs(s, [{ ...dangerousNeg(), cloudRun: { service: 42 } }]));
  assert.equal(negsOf(a).status, 'incomplete'); assert.equal(a.blocking.length, 0);
  // F1-B: an empty Cloud Run target names nothing: incomplete.
  const b = await surfaces(s => setNegs(s, [{ ...dangerousNeg(), cloudRun: {} }]));
  assert.equal(negsOf(b).status, 'incomplete'); assert.equal(b.blocking.length, 0);
  // F1-C: the wrong Compute list kind is incomplete, for either listing.
  assert.equal(negsOf(await surfaces(s => { s.negs.kind = 'compute#somethingElse'; })).status, 'incomplete');
  assert.equal(negsOf(await surfaces(s => { s.backendServices.kind = 'compute#networkEndpointGroupAggregatedList'; })).status, 'incomplete');
  assert.equal(negsOf(await surfaces(s => { delete s.negs.kind; })).status, 'incomplete');
  // F2-A: a dangerous mapping beside malformed unreachable metadata stays blocking.
  const d = await surfaces(s => { s.domainMappings.items = [dangerous]; s.domainMappings.unreachable = 'x'; });
  assert.equal(d.domainMappings.status, 'incomplete'); assert.equal(d.domainMappings.exposure, 'observed-present');
  assert.match(d.blocking.join('\n'), /routes to Teacher Units service teacherunitsget/);
  // F2-B: a dangerous NEG beside malformed unreachables metadata stays blocking.
  const e = await surfaces(s => { setNegs(s, [dangerousNeg()]); s.negs.unreachables = 'x'; });
  assert.equal(negsOf(e).status, 'incomplete'); assert.equal(negsOf(e).exposure, 'observed-present');
  assert.match(e.blocking.join('\n'), /serverless NEG .*units: Cloud Run service teacherunitsget/);
  // F2-C: a dangerous rewrite with missing release metadata stays blocking.
  const f = await surfaces(s => { const rel = liveRelease(s); delete rel.name; rel.version.config.rewrites.push({ glob: '/api/**', function: 'teacherUnitsGet' }); });
  assert.equal(f.hosting.status, 'incomplete'); assert.equal(f.hosting.exposure, 'observed-present');
  assert.match(f.blocking.join('\n'), rewriteFinding);
});

// Each surface: a valid dangerous entry, then one independent disturbance at a time.
const MATRIX = {
  hosting: {
    base: s => { liveRelease(s).version.config.rewrites.push({ glob: '/api/**', function: 'teacherUnitsGet' }); },
    finding: rewriteFinding, surface: 'hosting',
    disturb: {
      'malformed sibling rewrite': s => { liveRelease(s).version.config.rewrites.push({ glob: '/x', bogus: 1 }); },
      'malformed sibling channel': s => { s.channels[SITE].channels.push(null, { name: `sites/${SITE}/channels/pr` }); },
      'malformed collection metadata': s => { s.channels[SITE].unexpected = true; },
      'missing release and version metadata': s => { const rel = liveRelease(s); delete rel.name; delete rel.version.name; rel.version.status = 7; rel.type = 3; },
      'failed subsequent page': s => { s.channels[SITE].nextPageToken = 'p2'; },
      'malformed nested target': s => { liveRelease(s).version.config.rewrites.push({ glob: '/y', run: { serviceId: 42 } }, { glob: '/z', run: { serviceId: 'x', region: 5 } }); },
      'valid but incomplete response': s => { liveRelease(s).version.status = 'CREATED'; },
      'malformed pagination token': s => { s.channels[SITE].nextPageToken = 9; },
    },
    page2: url => url.includes(`/sites/${SITE}/channels?pageToken=p2`),
  },
  domainMappings: {
    base: s => { s.domainMappings.items = [JSON.parse(JSON.stringify(dangerous))]; },
    finding: /domain mapping units\.example\.org routes to Teacher Units service teacherunitsget/, surface: 'domainMappings',
    disturb: {
      'malformed sibling': s => { s.domainMappings.items.unshift(null, { metadata: { name: 'z' }, spec: {} }); },
      'malformed collection metadata': s => { s.domainMappings.unreachable = 'x'; s.domainMappings.metadata = 'x'; },
      'wrong list kind': s => { s.domainMappings.kind = 'Other'; },
      'failed subsequent page': s => { s.domainMappings.metadata = { continue: 'p2' }; },
      'malformed nested target': s => { s.domainMappings.items.push({ metadata: { name: 'q' }, spec: { routeName: 7 } }); },
      'valid but incomplete response': s => { s.domainMappings.unreachable = ['us-east1']; },
      'malformed pagination token': s => { s.domainMappings.metadata = { continue: 5 }; },
    },
    page2: url => url.includes('domainmappings?continue=p2'),
  },
  serverlessNetworkEndpointGroups: {
    base: s => setNegs(s, [dangerousNeg()]),
    finding: /serverless NEG \/projects\/lyfelabz-staging\/regions\/us-central1\/networkEndpointGroups\/units: Cloud Run service teacherunitsget/,
    surface: 'serverlessNetworkEndpointGroups',
    disturb: {
      'malformed sibling': s => { s.negs.items['regions/us-central1'].networkEndpointGroups.unshift(null, { name: 'bad' }); },
      'malformed collection metadata': s => { s.negs.unreachables = 'x'; s.negs.unexpected = 1; },
      'wrong list kind': s => { s.negs.kind = 'compute#other'; },
      'missing entry metadata': s => { const n = s.negs.items['regions/us-central1'].networkEndpointGroups[0]; delete n.name; n.kind = 'compute#x'; },
      'failed subsequent page': s => { s.negs.nextPageToken = 'p2'; },
      'malformed nested target': s => { s.negs.items['regions/us-central1'].networkEndpointGroups.push({ name: 'b', selfLink: NEG_LINK('b'), networkEndpointType: 'SERVERLESS', cloudRun: { service: 42 } },
        { name: 'c', selfLink: NEG_LINK('c'), networkEndpointType: 'SERVERLESS', cloudRun: {} }, { name: 'd', selfLink: NEG_LINK('d'), networkEndpointType: 'SERVERLESS', cloudFunction: 'x' }); },
      'valid but incomplete response': s => { s.negs.unreachables = ['regions/us-east1']; },
      'malformed scope beside the dangerous one': s => { s.negs.items['regions/us-east1'] = 'x'; },
    },
    page2: url => url.includes('networkEndpointGroups?pageToken=p2'),
  },
  backendServices: {
    base: s => { setNegs(s, [dangerousNeg()]); setBackends(s, [{ kind: 'compute#backendService', name: 'lb', selfLink: BS_LINK('lb'), backends: [{ group: NEG_LINK('units') }] }]); },
    finding: /backend service \/projects\/lyfelabz-staging\/global\/backendServices\/lb uses a Teacher Units serverless NEG/, surface: 'serverlessNetworkEndpointGroups',
    disturb: {
      'malformed sibling': s => { s.backendServices.items.global.backendServices.unshift(null, { selfLink: 7 }); },
      'malformed sibling backend': s => { s.backendServices.items.global.backendServices[0].backends.unshift('x', { group: 7 }); },
      'malformed collection metadata': s => { s.backendServices.unreachables = 'x'; },
      'wrong list kind': s => { s.backendServices.kind = 'compute#other'; },
      'missing entry metadata': s => { delete s.backendServices.items.global.backendServices[0].name; },
      'failed subsequent page': s => { s.backendServices.nextPageToken = 'p2'; },
      'valid but incomplete response': s => { s.backendServices.unreachables = ['global']; },
    },
    page2: url => url.includes('backendServices?pageToken=p2'),
  },
};
for (const [surfaceName, spec] of Object.entries(MATRIX)) {
  test(`second correction matrix (${surfaceName}): every disturbance keeps the confirmed finding and reports partial coverage`, async () => {
    const control = await surfaces(spec.base);
    assert.equal(control[spec.surface].status, 'observed-present', 'control: valid dangerous entry, complete coverage');
    assert.match(control.blocking.join('\n'), spec.finding);
    for (const [name, disturb] of Object.entries(spec.disturb)) {
      const report = await surfaces(s => { spec.base(s); disturb(s); }, { override: url => (spec.page2(url) ? http(403) : undefined) });
      assert.ok(['incomplete', 'unreadable'].includes(report[spec.surface].status), `${surfaceName} / ${name}: ${report[spec.surface].status}`);
      assert.equal(report[spec.surface].exposure, 'observed-present', `${surfaceName} / ${name}`);
      assert.match(report.blocking.join('\n'), spec.finding, `${surfaceName} / ${name}`);
      assert.match(report[spec.surface].findings.join('\n'), spec.finding, `${surfaceName} / ${name}: surface findings`);
    }
  });
}

test('second correction negative controls: malformed targets are never invented as exposures; ordinary resources are not blocking', async () => {
  const malformed = [
    s => setNegs(s, [{ ...dangerousNeg(), cloudRun: { service: 42 } }]),
    s => setNegs(s, [{ ...dangerousNeg(), cloudRun: { service: '' } }]),
    s => setNegs(s, [{ ...dangerousNeg(), cloudRun: { tag: 'x' } }]),
    s => setNegs(s, [{ ...dangerousNeg(), cloudRun: 'teacherunitsget' }]),
    s => setNegs(s, [{ ...dangerousNeg(), cloudRun: undefined, cloudFunction: { function: ['teacherUnitsGet'] } }]),
    s => setNegs(s, [{ ...dangerousNeg(), cloudRun: { service: 'teacherunitsget', urlMask: 5 }, networkEndpointType: undefined }]),
    s => { liveRelease(s).version.config.rewrites.push({ glob: '/y', run: { serviceId: 42 } }); },
    s => { liveRelease(s).version.config.rewrites.push({ glob: '/y', function: { name: 'teacherUnitsGet' } }); },
    s => { s.domainMappings.items = [{ metadata: { name: 'x' }, spec: { routeName: 7 } }]; },
    s => { s.domainMappings.items = [{ metadata: { name: 'x' } }]; },
  ];
  for (const edit of malformed) {
    const report = await surfaces(edit);
    const statuses = [report.hosting.status, report.domainMappings.status, report.serverlessNetworkEndpointGroups.status];
    assert.ok(statuses.includes('incomplete'), String(edit));
    assert.ok(!statuses.includes('observed-present'), String(edit));
  }
  // A valid target that is well formed but carries an invalid optional field still counts: its primary is valid.
  const kept = await surfaces(s => setNegs(s, [{ ...dangerousNeg(), cloudRun: { service: 'teacherunitsget', tag: 5 } }]));
  assert.equal(kept.serverlessNetworkEndpointGroups.status, 'incomplete');
  assert.equal(kept.blocking.length, 1);
  // Ordinary valid, complete, non-dangerous resources: observed-absent and nothing blocking.
  const ordinary = await surfaces(s => {
    liveRelease(s).version.config.rewrites.push({ glob: '/docs/**', destination: '/docs/index.html' }, { glob: '/l', dynamicLinks: true });
    s.domainMappings.items = [{ metadata: { name: 'www.example.org' }, spec: { routeName: 'website' } }];
    setNegs(s, [{ kind: 'compute#networkEndpointGroup', name: 'site', selfLink: NEG_LINK('site'), networkEndpointType: 'SERVERLESS', cloudRun: { service: 'website', tag: 'blue' } },
      { name: 'vm', selfLink: NEG_LINK('vm'), networkEndpointType: 'GCE_VM_IP_PORT' }]);
    setBackends(s, [{ kind: 'compute#backendService', name: 'web', selfLink: BS_LINK('web'), backends: [{ group: NEG_LINK('site') }] }]);
  });
  for (const key of ['hosting', 'domainMappings', 'serverlessNetworkEndpointGroups']) assert.equal(ordinary[key].status, 'observed-absent', key);
  assert.deepEqual(ordinary.blocking, []);
  // The fully observed default (explicit empty listings) remains observed-absent.
  const empty = await surfaces();
  for (const key of ['hosting', 'domainMappings', 'serverlessNetworkEndpointGroups']) assert.equal(empty[key].status, 'observed-absent', key);
});

test('second correction: a complete capture and offline replay keep the same findings under metadata failures', async () => {
  const c = await buildCapture({ mutateSurfaces: s => {
    s.domainMappings.items = [JSON.parse(JSON.stringify(dangerous))]; s.domainMappings.unreachable = 'x';
    setNegs(s, [dangerousNeg()]); s.negs.unreachables = 'x';
    setBackends(s, [{ name: 'lb', selfLink: BS_LINK('lb'), backends: ['x', { group: NEG_LINK('units') }] }]);
    const rel = liveRelease(s); delete rel.name; rel.version.config.rewrites.push({ glob: '/api/**', function: 'teacherUnitsGet' });
  } });
  roots.push(c.hostingRoot);
  const r = await PC.captureA3Provider({ project: c.project, exchange: c.exchange, clock: c.clock, deploymentPlan: c.deploymentPlan, expected: c.expected,
    hostingRoot: c.hostingRoot, evidenceClass: 'synthetic' });
  assert.equal(r.surfaceReport.blocking.length, 4);
  for (const key of ['hosting', 'domainMappings', 'serverlessNetworkEndpointGroups']) {
    assert.equal(r.surfaceReport[key].status, 'incomplete', key);
    assert.equal(r.bundle.surfaces[key], 'incomplete', key);
  }
  assert.equal(r.bundle.surfaces.blocking, 4);
  const verified = await PC.verifyCapture({ project: c.project, files: r.bytes, deploymentPlan: c.deploymentPlan, expected: c.expected, hostingRoot: c.hostingRoot });
  assert.equal(verified.surfaces.blocking, 4);
});

test('second correction: a dangerous NEG with missing selfLink or endpoint type metadata stays blocking', async () => {
  const noLink = await surfaces(s => { const n = dangerousNeg(); delete n.selfLink; setNegs(s, [n]); });
  assert.equal(noLink.serverlessNetworkEndpointGroups.status, 'incomplete');
  assert.match(noLink.blocking.join('\n'), /serverless NEG \(no selfLink\) units: Cloud Run service teacherunitsget/);
  for (const type of [undefined, 7, 'GCE_VM_IP_PORT']) {
    const report = await surfaces(s => setNegs(s, [{ ...dangerousNeg(), networkEndpointType: type }]));
    assert.equal(report.serverlessNetworkEndpointGroups.status, 'incomplete', String(type));
    assert.match(report.blocking.join('\n'), /Cloud Run service teacherunitsget/, String(type));
  }
});

test('second correction: undocumented nested target fields are never ignored', async () => {
  const ordinary = await surfaces(s => setNegs(s, [{ name: 'site', selfLink: NEG_LINK('site'), networkEndpointType: 'SERVERLESS', cloudRun: { service: 'website', routeAll: true } }]));
  assert.equal(ordinary.serverlessNetworkEndpointGroups.status, 'incomplete');
  assert.equal(ordinary.blocking.length, 0);
  const dangerousExtra = await surfaces(s => setNegs(s, [{ ...dangerousNeg(), cloudRun: { service: 'teacherunitsget', routeAll: true } }]));
  assert.equal(dangerousExtra.serverlessNetworkEndpointGroups.status, 'incomplete');
  assert.equal(dangerousExtra.blocking.length, 1);
});

test('second correction: a listing with the right kind but no collection is incomplete', async () => {
  assert.equal((await surfaces(s => { s.negs = { kind: 'compute#networkEndpointGroupAggregatedList' }; })).serverlessNetworkEndpointGroups.status, 'incomplete');
  assert.equal((await surfaces(s => { s.backendServices = { kind: 'compute#backendServiceAggregatedList', items: [] }; })).serverlessNetworkEndpointGroups.status, 'incomplete');
  assert.equal((await surfaces(s => { s.domainMappings = { kind: 'DomainMappingList', metadata: {} }; })).domainMappings.status, 'incomplete');
});

// --- third correction: whitespace-only and wrong-typed target values ---------
test('third correction: blank or wrong-typed target values are incomplete and never an exposure', async () => {
  const negWith = target => s => setNegs(s, [{ ...dangerousNeg(), cloudRun: undefined, ...target }]);
  const invalid = [];
  for (const v of [' ', '\t', '\n', ' \t ', '', 42, null, ['teacherunitsget'], {}]) {
    invalid.push({ cloudRun: { service: v } }, { cloudRun: { urlMask: v } }, { cloudFunction: { function: v } }, { serverlessDeployment: { platform: 'p', resource: v } });
  }
  for (const target of invalid) {
    const report = await surfaces(negWith(target));
    assert.equal(report.serverlessNetworkEndpointGroups.status, 'incomplete', JSON.stringify(target));
    assert.notEqual(report.serverlessNetworkEndpointGroups.exposure, 'observed-present', JSON.stringify(target));
    assert.deepEqual(report.blocking, [], JSON.stringify(target));
  }
  for (const v of [' ', '\t']) {
    const run = await surfaces(s => { liveRelease(s).version.config.rewrites.push({ glob: '/y', run: { serviceId: v } }); });
    assert.equal(run.hosting.status, 'incomplete'); assert.deepEqual(run.blocking, []);
    const dm = await surfaces(s => { s.domainMappings.items = [{ metadata: { name: 'x' }, spec: { routeName: v } }]; });
    assert.equal(dm.domainMappings.status, 'incomplete'); assert.deepEqual(dm.blocking, []);
  }
  // Valid targets keep their exact strings: dangerous ones block, harmless ones do not.
  const svc = await surfaces(negWith({ cloudRun: { service: 'teacherunitsget' } }));
  assert.equal(svc.serverlessNetworkEndpointGroups.status, 'observed-present'); assert.equal(svc.blocking.length, 1);
  const mask = await surfaces(negWith({ cloudRun: { urlMask: '<service>.example.org' } }));
  assert.equal(mask.serverlessNetworkEndpointGroups.status, 'observed-present'); assert.equal(mask.blocking.length, 1);
  const harmless = await surfaces(negWith({ cloudRun: { service: 'website', tag: 'blue' } }));
  assert.equal(harmless.serverlessNetworkEndpointGroups.status, 'observed-absent'); assert.deepEqual(harmless.blocking, []);
  // A confirmed dangerous NEG survives a whitespace-target sibling.
  const sibling = await surfaces(s => setNegs(s, [dangerousNeg(), { name: 'w', selfLink: NEG_LINK('w'), networkEndpointType: 'SERVERLESS', cloudRun: { urlMask: ' ' } }]));
  assert.equal(sibling.serverlessNetworkEndpointGroups.status, 'incomplete');
  assert.equal(sibling.blocking.length, 1);
  assert.match(sibling.blocking[0], /Cloud Run service teacherunitsget/);
});

test('third correction: whitespace targets through a full capture and offline replay', async () => {
  for (const target of [{ service: ' ' }, { urlMask: ' ' }]) {
    const c = await buildCapture({ mutateSurfaces: s => setNegs(s, [{ name: 'a', selfLink: NEG_LINK('a'), networkEndpointType: 'SERVERLESS', cloudRun: target }]) });
    roots.push(c.hostingRoot);
    const r = await PC.captureA3Provider({ project: c.project, exchange: c.exchange, clock: c.clock, deploymentPlan: c.deploymentPlan, expected: c.expected,
      hostingRoot: c.hostingRoot, evidenceClass: 'synthetic' });
    assert.equal(r.surfaceReport.serverlessNetworkEndpointGroups.status, 'incomplete');
    assert.notEqual(r.surfaceReport.serverlessNetworkEndpointGroups.exposure, 'observed-present');
    assert.equal(r.bundle.surfaces.blocking, 0);
    const v = await PC.verifyCapture({ project: c.project, files: r.bytes, deploymentPlan: c.deploymentPlan, expected: c.expected, hostingRoot: c.hostingRoot });
    assert.equal(v.surfaces.serverlessNetworkEndpointGroups, 'incomplete');
    assert.equal(v.surfaces.blocking, 0);
  }
});
