'use strict';
// A3-6 S6f staging discovery tests. Offline: SYNTHETIC fixtures only, injected
// exchange and clock, no provider, no credential. Nothing here is provider-verified.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const SD = require('./staging-discovery.cjs');
const O = require('./provider-observation.cjs');
const R = require('./access-review.cjs');
const PC = require('./provider-capture.cjs');
const EP = require('./evidence-package.cjs');
const RV = require('./revocation-procedure.cjs');
const { LIMITS } = require('../hosting-release/backend-state.cjs');
const { buildDiscovery, http: reply, START } = require('./fixtures/synthetic-discovery.cjs');
const K = require('../../platform/functions/lib/teacherUnits/a3-canonical.js');

const STAGING = 'lyfelabz-staging';
const LIST = `https://cloudfunctions.googleapis.com/v2/projects/${STAGING}/locations/-/functions`;
const FN = id => `https://cloudfunctions.googleapis.com/v2/projects/${STAGING}/locations/us-central1/functions/${id}`;
const isList = url => url.startsWith(LIST);
const forbidden = url => /lyfelabz-prod|182791689935/i.test(decodeURIComponent(url));

async function run(options = {}, { evidenceClass = 'synthetic', principal, activeCredential } = {}) {
  const f = buildDiscovery(options);
  try {
    const d = await SD.discover({ project: STAGING, exchange: f.exchange, clock: f.clock, evidenceClass, principal, activeCredential });
    return { d, f };
  } finally { f.cleanup(); }
}
const verify = files => SD.verifyDiscovery({ project: STAGING, files });
const ep = (d, id) => d.report.endpoints.find(e => e.endpoint === id);
const listings = d => d.report.endpoints.map(e => e.listing.status);
const removeAll = ids => state => { for (const id of ids) delete state.endpoints[id]; };
const transcriptOf = d => JSON.parse(d.bytes.transcript.toString('utf8'));
/** Reseals an edited transcript with canonical bytes, leaving report and bundle as given. */
function reseal(d, edit) {
  const t = transcriptOf(d); edit(t);
  return { ...d.bytes, transcript: Buffer.from(K.canonicalJSON(t), 'utf8') };
}
async function refusesVerify(files, pattern) {
  await assert.rejects(verify(files), e => /REFUSED/.test(e.message) && (!pattern || pattern.test(e.message)));
}
async function withoutNetwork(fn) {
  const calls = [], saved = { fetch: globalThis.fetch, http: http.request, https: https.request };
  const trap = name => () => { calls.push(name); throw new Error('network attempted'); };
  globalThis.fetch = trap('fetch'); http.request = trap('http'); https.request = trap('https');
  try { return { value: await fn(), calls }; } finally { globalThis.fetch = saved.fetch; http.request = saved.http; https.request = saved.https; }
}

test('fixture is labelled synthetic, never provider-verified', () => {
  assert.match(fs.readFileSync(path.join(__dirname, 'fixtures/synthetic-discovery.cjs'), 'utf8'), /SYNTHETIC FIXTURE - NOT PROVIDER-VERIFIED/);
});

test('healthy: nine endpoints present, diagnostics accepted, fixed non-authorizing claims, replay-consistent', async () => {
  const { d, f } = await run();
  assert.deepEqual(listings(d), O.ENDPOINTS.map(() => 'observed-present'));
  assert.equal(d.report.inventory.status, 'observed-present');
  assert.deepEqual(d.report.inventory.extraTeacherUnitsFunctions, []);
  for (const e of d.report.endpoints) {
    for (const k of ['function', 'service', 'revision', 'consistency', 'source']) assert.equal(e[k].status, 'observed-present', `${e.endpoint} ${k}`);
    assert.equal(e.s4Diagnostic.result, 'accepted', e.s4Diagnostic.reason);
    assert.equal(e.s5Diagnostic.functionPolicy.diagnostic, 'accepted');
    assert.equal(e.s5Diagnostic.servicePolicy.diagnostic, 'accepted');
    assert.equal(e.source.bucket, SD.SOURCE_BUCKET);
  }
  assert.equal(d.report.indexes.diagnostic, 'accepted');
  assert.equal(d.report.rules.ruleset.status, 'observed-present');
  assert.equal(d.report.termination, null);
  for (const doc of [d.bundle, d.report.claims]) for (const [k, v] of Object.entries(SD.CLAIMS)) assert.equal(doc[k], v, k);
  assert.deepEqual(d.bundle.gates, { G1: 'not-resolved', G2: 'not-resolved', G3: 'not-resolved', G4: 'not-resolved', G5: 'not-resolved' });
  assert.equal(d.bundle.files.transcript.sha256, K.sha256Bytes(d.bytes.transcript));
  assert.equal(d.bundle.files.report.sha256, K.sha256Bytes(d.bytes.report));
  assert.ok(f.fixture.calls.length <= SD.MAX_READS);
  assert.ok(!f.fixture.calls.some(forbidden));
  assert.ok(f.fixture.calls.every(u => !/hosting|compute|us-central1-run/.test(new URL(u).host)), 'S6c surfaces are deferred');
  const { value, calls } = await withoutNetwork(() => verify(d.bytes));
  assert.deepEqual(calls, []);
  assert.match(value.verified, /not authenticated/);
  assert.equal(value.certifiedEvidence, false);
  // Deterministic: the same provider responses and clock readings reproduce the same bytes.
  // (One fixture instance: separately built synthetic archives differ in zip timestamps.)
  const g = buildDiscovery();
  try {
    const clockAt = () => { let n = 0; return () => new Date(Date.parse(START) + n++).toISOString(); };
    const one = await SD.discover({ project: STAGING, exchange: g.exchange, clock: clockAt(), evidenceClass: 'synthetic' });
    const two = await SD.discover({ project: STAGING, exchange: g.exchange, clock: clockAt(), evidenceClass: 'synthetic' });
    for (const k of Object.keys(SD.FILES)) assert.equal(one.bytes[k].equals(two.bytes[k]), true, k);
  } finally { g.cleanup(); }
  assert.deepEqual(ep(d, 'teacherUnitsGet').observations.g1.revisionEnvironmentNames, ['FIREBASE_CONFIG', 'LOG_EXECUTION_ID']);
});

test('sensitive values: environment values reach only the raw transcript, never the report or bundle', async () => {
  const canary = 'S6F-ENV-VALUE-CANARY-7731';
  const { d } = await run({ mutate: s => {
    s.endpoints.teacherUnitsGet.revision.containers[0].env.push({ name: 'CANARY_SETTING', value: canary });
    s.endpoints.teacherUnitsGet.fn.serviceConfig.environmentVariables = { CANARY_SETTING: canary };
  } });
  const g1 = ep(d, 'teacherUnitsGet').observations.g1;
  assert.ok(g1.revisionEnvironmentNames.includes('CANARY_SETTING'));
  assert.deepEqual(g1.functionEnvironmentNames, ['CANARY_SETTING']);
  for (const key of ['report', 'bundle']) {
    assert.equal(d.bytes[key].includes(canary), false, key);
    assert.equal(d.bytes[key].includes(Buffer.from(canary).toString('base64')), false, key);
  }
  const bodies = transcriptOf(d).events.filter(e => e.type === 'read').map(e => Buffer.from(e.body, 'base64').toString('utf8'));
  assert.ok(bodies.some(b => b.includes(canary)), 'the raw transcript is sensitive by design');
});

test('zero endpoints: each of the nine is observed-absent only from the complete two-pass listing', async () => {
  const { d } = await run({ mutate: removeAll(O.ENDPOINTS) });
  assert.deepEqual(listings(d), O.ENDPOINTS.map(() => 'observed-absent'));
  assert.equal(d.report.endpoints.every(e => e.function.status === 'not-observed'), true);
  assert.deepEqual(d.bundle.summary.endpointListing['observed-absent'], 9);
  await verify(d.bytes);
});

test('five endpoints: four absent and five present', async () => {
  const gone = O.ENDPOINTS.slice(0, 4);
  const { d } = await run({ mutate: removeAll(gone) });
  for (const e of d.report.endpoints) assert.equal(e.listing.status, gone.includes(e.endpoint) ? 'observed-absent' : 'observed-present', e.endpoint);
  await verify(d.bytes);
});

test('an extra Teacher Units endpoint is reported and never read', async () => {
  const extra = `projects/${STAGING}/locations/us-central1/functions/teacherUnitsDebug`;
  const { d, f } = await run({ mutate: s => s.extraFunctions.push({ name: extra, environment: 'GEN_2', state: 'ACTIVE' }) });
  assert.deepEqual(d.report.inventory.extraTeacherUnitsFunctions, ['teacherUnitsDebug']);
  assert.equal(d.bundle.summary.extraTeacherUnitsFunctions, 1);
  assert.deepEqual(listings(d), O.ENDPOINTS.map(() => 'observed-present'));
  assert.equal(f.fixture.calls.some(u => u.includes('teacherUnitsDebug')), false);
});

test('401, 403 and 404 Functions listings are unreadable, never absence; provider reasons and raw bodies are preserved', async () => {
  const bodies = {
    401: { error: { code: 401, status: 'UNAUTHENTICATED', message: 'synthetic' } },
    403: { error: { code: 403, status: 'PERMISSION_DENIED', message: 'Permission denied (synthetic)', details: [{ reason: 'IAM_PERMISSION_DENIED' }] } },
    404: { error: { code: 404, status: 'NOT_FOUND', message: 'synthetic' } },
  };
  const kinds = { 401: 'unauthenticated', 403: 'permission-denied', 404: 'not-found' };
  for (const status of [401, 403, 404]) {
    const { d } = await run({ mutate: removeAll(O.ENDPOINTS), onExchange: url => (isList(url) ? reply(status, bodies[status]) : undefined) });
    assert.equal(d.report.inventory.status, 'unreadable');
    assert.deepEqual(listings(d), O.ENDPOINTS.map(() => 'unreadable'), `HTTP ${status}`);
    const reason = d.report.inventory.passes[0].reason;
    assert.equal(reason.kind, kinds[status]); assert.equal(reason.httpStatus, status);
    if (status === 403) assert.deepEqual(reason.reasons, ['IAM_PERMISSION_DENIED']);
    const event = transcriptOf(d).events.find(e => e.type === 'read' && e.url === LIST);
    assert.equal(event.status, status);
    assert.deepEqual(JSON.parse(Buffer.from(event.body, 'base64').toString('utf8')), bodies[status]);
    await verify(d.bytes);
  }
});

test('a disabled API is unreadable (api-disabled); the endpoint stays present and S4 does not run', async () => {
  const disabled = reply(403, { error: { code: 403, status: 'PERMISSION_DENIED', message: 'Cloud Run Admin API has not been used', details: [{ reason: 'SERVICE_DISABLED' }] } });
  const { d } = await run({ onExchange: url => (new URL(url).host === 'run.googleapis.com' ? disabled : undefined) });
  const e = ep(d, 'teacherUnitsCreate');
  assert.equal(e.listing.status, 'observed-present');
  assert.equal(e.service.status, 'unreadable'); assert.equal(e.service.reason.kind, 'api-disabled');
  assert.equal(e.s5Diagnostic.servicePolicy.status, 'unreadable');
  assert.equal(e.s4Diagnostic.result, 'not-run');
  await verify(d.bytes);
});

test('a missing revision is unreadable (not-found), not absence', async () => {
  const { d } = await run({ onExchange: url => (url.includes('/revisions/teacherunitsget-') ? reply(404, { error: { code: 404, status: 'NOT_FOUND' } }) : undefined) });
  const e = ep(d, 'teacherUnitsGet');
  assert.equal(e.revision.status, 'unreadable'); assert.equal(e.revision.reason.kind, 'not-found');
  assert.equal(e.listing.status, 'observed-present');
  assert.equal(e.s4Diagnostic.result, 'not-run');
});

test('transport failures (oversized archive, failed read) are recorded in place, discovery continues, and replay reproduces them', async () => {
  const oversized = new Error('[a3-provider-capture] REFUSED: unverifiable or oversized provider response: storage.googleapis.com');
  const { d } = await run({ onExchange: (url, n) => (new URL(url).host === 'storage.googleapis.com' ? { throws: oversized }
    : url === FN('teacherUnitsList') && n === 1 ? { throws: new TypeError('socket hang up ya29.LEAK') } : undefined) });
  const t = transcriptOf(d);
  const failures = t.events.filter(e => e.type === 'failure');
  assert.equal(failures.length >= 2, true);
  assert.equal(failures.some(e => e.reason === oversized.message), true);
  const generic = failures.find(e => e.url === FN('teacherUnitsList'));
  assert.equal(generic.reason, '[a3-staging-discovery] REFUSED: provider read failed: cloudfunctions.googleapis.com');
  assert.equal(d.bytes.transcript.includes('ya29.LEAK'), false, 'a non-refusal error message is never recorded');
  assert.equal(ep(d, 'teacherUnitsArchive').source.status, 'unreadable');
  assert.equal(ep(d, 'teacherUnitsArchive').source.reason.kind, 'transport');
  assert.equal(ep(d, 'teacherUnitsList').function.status, 'unreadable');
  assert.equal(d.report.rules.ruleset.status, 'observed-present', 'later surfaces are still observed');
  assert.equal(d.report.reads.transportFailures, failures.length);
  await verify(d.bytes);
  // A recorded failure moved to a different position refuses.
  const i = t.events.indexOf(generic);
  await refusesVerify(reseal(d, x => { const e = x.events.splice(i, 1)[0]; x.events.splice(i + 2, 0, e); }));
  // A failure changed into a successful response, or its reason changed, refuses.
  await refusesVerify(reseal(d, x => { x.events[i].reason = '[a3-staging-discovery] REFUSED: provider read failed: other'; }));
  await refusesVerify(reseal(d, x => { const e = x.events[i]; x.events[i] = { type: 'read', method: 'GET', url: e.url, mode: e.mode, status: 200, sha256: K.sha256Bytes(Buffer.from('{}')), body: Buffer.from('{}').toString('base64'), requestedAt: e.requestedAt, completedAt: e.completedAt }; }));
});

test('oversized JSON is a recorded transport failure', async () => {
  const big = Buffer.alloc(LIMITS.jsonBytes + 1, 0x20);
  const { d } = await run({ onExchange: url => (url.includes('/databases/(default)') && !url.includes('collectionGroups') ? big : undefined) });
  assert.equal(d.report.database.status, 'unreadable');
  assert.match(d.report.database.reason.detail, /oversized provider response/);
  await verify(d.bytes);
});

test('unknown provider fields: a listing with undocumented keys is incomplete (never absence); an endpoint with unknown fields fails S4 diagnostics', async () => {
  const a = await run({ mutate: removeAll(O.ENDPOINTS), onExchange: url => (isList(url) ? { functions: [{ name: `projects/${STAGING}/locations/us-central1/functions/assignmentsPublish` }], surprise: true } : undefined) });
  assert.equal(a.d.report.inventory.status, 'incomplete');
  assert.deepEqual(listings(a.d), O.ENDPOINTS.map(() => 'incomplete'));
  const b = await run({ mutate: s => { s.endpoints.teacherUnitsUpdate.fn.surpriseField = 'x'; } });
  const e = ep(b.d, 'teacherUnitsUpdate');
  assert.equal(e.function.status, 'observed-present');
  assert.equal(e.s4Diagnostic.result, 'refused');
  assert.match(e.s4Diagnostic.reason, /surpriseField|unknown|field/i);
  const omitted = await run({ mutate: removeAll(O.ENDPOINTS), onExchange: url => (isList(url) ? {} : undefined) });
  assert.deepEqual(listings(omitted.d), O.ENDPOINTS.map(() => 'incomplete'), 'an omitted collection is never read as empty');
});

test('a repeated pagination token is incomplete and never absence', async () => {
  const { d, f } = await run({ mutate: removeAll(O.ENDPOINTS), onExchange: url => (isList(url) ? { functions: [], nextPageToken: 'repeat' } : undefined) });
  assert.equal(d.report.inventory.status, 'incomplete');
  assert.deepEqual(listings(d), O.ENDPOINTS.map(() => 'incomplete'));
  assert.ok(d.report.inventory.passes[0].issues.includes('malformed or repeated pagination token'));
  assert.ok(f.fixture.calls.filter(isList).length <= 4);
  await verify(d.bytes);
});

test('two-pass drift: a changed listing is inconsistent (no absence); a changed endpoint is inconsistent', async () => {
  const drift = await run({ mutate: removeAll(['teacherUnitsGet']), onExchange: (url, n) => {
    if (url !== LIST || n !== 2) return undefined;
    return { functions: [{ name: `projects/${STAGING}/locations/us-central1/functions/somethingNew` }] };
  } });
  assert.equal(drift.d.report.inventory.status, 'inconsistent');
  assert.equal(ep(drift.d, 'teacherUnitsGet').listing.status, 'inconsistent');
  assert.equal(listings(drift.d).includes('observed-absent'), false);
  const changed = await run({ mutate: s => {
    const fn = s.endpoints.teacherUnitsReorder.fn; let reads = 0;
    s.onGet = (url) => { if (url === FN('teacherUnitsReorder') && ++reads === 2) return { ...fn, updateTime: '2026-10-16T11:30:00.000Z' }; return undefined; };
  } });
  assert.equal(ep(changed.d, 'teacherUnitsReorder').consistency.status, 'inconsistent');
  assert.equal(ep(changed.d, 'teacherUnitsGet').consistency.status, 'observed-present');
  await verify(changed.d.bytes);
});

test('production resource names from the provider are never requested (first layer), and the URL guard refuses them (second layer)', async () => {
  const { d, f } = await run({ mutate: s => {
    s.endpoints.teacherUnitsGet.fn.serviceConfig.service = 'projects/lyfelabz-prod/locations/us-central1/services/teacherunitsget';
    s.endpoints.teacherUnitsList.fn.serviceConfig.service = 'projects/182791689935/locations/us-central1/services/teacherunitslist';
    s.extraFunctions.push({ name: 'projects/lyfelabz-prod/locations/us-central1/functions/teacherUnitsGet' });
  } });
  assert.equal(f.fixture.calls.some(forbidden), false, 'no request names production');
  assert.equal(ep(d, 'teacherUnitsGet').service.status, 'inconsistent');
  assert.equal(ep(d, 'teacherUnitsList').service.status, 'inconsistent');
  assert.equal(d.report.inventory.status, 'inconsistent', 'a listed production name makes the listing inconsistent');
  assert.equal(d.report.termination, null);
  await verify(d.bytes);
});

test('second layer: a provider pagination token naming production ends discovery with guard-refusal; nothing is sent and the evidence is kept', async () => {
  const { d, f } = await run({ onExchange: (url, n) => (url === LIST && n === 1 ? { functions: [], nextPageToken: 'lyfelabz-prod-next' } : undefined) });
  assert.equal(f.fixture.calls.some(forbidden), false);
  assert.equal(d.report.termination.reason, 'guard-refusal');
  assert.match(d.report.termination.detail, /production identity/);
  assert.equal(d.report.inventory.passes[0].status, 'incomplete');
  assert.equal(listings(d).includes('observed-absent'), false);
  await verify(d.bytes);
});

test('a production-number or foreign source bucket is never read', async () => {
  for (const bucket of ['gcf-v2-sources-182791689935-us-central1', 'gcf-v2-sources-synthetic-us-central1', 'attacker-bucket']) {
    const { d, f } = await run({ mutate: s => { s.endpoints.teacherUnitsCreate.fn.buildConfig.sourceProvenance.resolvedStorageSource.bucket = bucket; } });
    assert.equal(ep(d, 'teacherUnitsCreate').source.status, 'inconsistent', bucket);
    assert.equal(f.fixture.calls.some(u => u.includes(bucket)), false, bucket);
    assert.equal(ep(d, 'teacherUnitsCreate').s4Diagnostic.result, 'not-run');
  }
});

test('URL guard: staging paths only, no production identity, no credential or unknown query, canonical form', () => {
  const ok = [
    `https://firebase.googleapis.com/v1beta1/projects/${STAGING}`,
    `${LIST}?pageToken=abc`,
    FN('teacherUnitsGet'),
    `${FN('teacherUnitsGet')}:getIamPolicy?options.requestedPolicyVersion=3`,
    `https://run.googleapis.com/v2/projects/293337283840/locations/us-central1/services/teacherunitsget/revisions/teacherunitsget-00001-abc`,
    `https://storage.googleapis.com/storage/v1/b/${SD.SOURCE_BUCKET}/o/source.zip?alt=media&generation=17`,
    `https://firestore.googleapis.com/v1/projects/${STAGING}/databases/(default)/collectionGroups/-/fields?filter=ttlConfig%3A*`,
  ];
  for (const url of ok) assert.doesNotThrow(() => SD.assertDiscoveryUrl(url), url);
  const bad = [
    'https://firebase.googleapis.com/v1beta1/projects/lyfelabz-prod',
    'https://run.googleapis.com/v2/projects/182791689935/locations/us-central1/services/teacherunitsget',
    `https://run.googleapis.com/v2/projects/${STAGING}/locations/us-central1/services/x%2Flyfelabz-prod`,
    `https://storage.googleapis.com/storage/v1/b/gcf-v2-sources-182791689935-us-central1/o/source.zip?alt=media&generation=1`,
    `https://storage.googleapis.com/storage/v1/b/other/o/source.zip?alt=media&generation=1`,
    `https://storage.googleapis.com/storage/v1/b/${SD.SOURCE_BUCKET}/o/..%2Fsecret?alt=media&generation=1`,
    `https://storage.googleapis.com/storage/v1/b/${SD.SOURCE_BUCKET}/o/source.zip?alt=media`,
    `${LIST}?pageToken=lyfelabz-prod-page`, `${LIST}?pageToken=182791689935`,
    `https://storage.googleapis.com/storage/v1/b/${SD.SOURCE_BUCKET}/o/lyfelabz-prod%2Fsource.zip?alt=media&generation=1`,
    `${LIST}?access_token=x`, `${LIST}?key=x`, `${LIST}?fields=x`, `${LIST}?pageToken=a&pageToken=b`, `${LIST}?`,
    `${FN('teacherUnitsGet')}:getIamPolicy`, `${FN('teacherUnitsGet')}:setIamPolicy?options.requestedPolicyVersion=3`,
    `http://cloudfunctions.googleapis.com/v2/projects/${STAGING}/locations/-/functions`,
    `https://user:pw@cloudfunctions.googleapis.com/v2/projects/${STAGING}/locations/-/functions`,
    `https://example.com/v2/projects/${STAGING}/locations/-/functions`,
    `https://firebasehosting.googleapis.com/v1beta1/projects/${STAGING}/sites`,
    `https://compute.googleapis.com/compute/v1/projects/${STAGING}/aggregated/networkEndpointGroups`,
    `https://cloudfunctions.googleapis.com/v2/projects/${STAGING}/locations/europe-west1/functions/teacherUnitsGet`,
    `https://cloudfunctions.googleapis.com/v2/projects/other-project/locations/us-central1/functions/teacherUnitsGet`,
    `https://cloudfunctions.googleapis.com/v2/projects/${STAGING}/locations/us-central1/functions/../functions/x`,
    `https://cloudfunctions.googleapis.com:443/v2/projects/${STAGING}/locations/-/functions`,
  ];
  for (const url of bad) assert.throws(() => SD.assertDiscoveryUrl(url), /REFUSED/, url);
  for (const key of ['access_token', 'key', 'oauth_token', 'X-Goog-Signature']) assert.throws(() => SD.assertDiscoveryUrl(`${LIST}?${key}=x`), /credential-bearing query parameter/, key);
});

test('staging only in the module: production, other and missing projects refuse before any clock reading or request', async () => {
  for (const project of ['lyfelabz-prod', 'demo-a3', undefined, 'LYFELABZ-STAGING']) {
    let reads = 0, ticks = 0;
    await assert.rejects(SD.discover({ project, exchange: async () => { reads++; return { status: 200, bytes: Buffer.from('{}') }; }, clock: () => { ticks++; return START; }, evidenceClass: 'synthetic' }), /explicit project lyfelabz-staging/);
    assert.equal(reads, 0); assert.equal(ticks, 0);
    assert.throws(() => SD.discoveryPlan(project), /REFUSED/);
  }
  const { d } = await run();
  await assert.rejects(SD.verifyDiscovery({ project: 'lyfelabz-prod', files: d.bytes }), /explicit project lyfelabz-staging/);
  assert.throws(() => SD.stagingOnly('lyfelabz-prod'), /REFUSED/);
});

test('evidence class and principal: never a capture class; principal is a declaration only', async () => {
  for (const evidenceClass of ['operator-captured-unattested', 'provider-verified', undefined]) {
    const f = buildDiscovery();
    try { await assert.rejects(SD.discover({ project: STAGING, exchange: f.exchange, clock: f.clock, evidenceClass }), /evidence class/); assert.equal(f.fixture.calls.length, 0); } finally { f.cleanup(); }
  }
  await assert.rejects(run({}, { principal: 'Not An Email' }), /--principal/);
  const { d } = await run({}, { evidenceClass: 'operator-discovered-unattested', principal: 'operator@example.org' });
  assert.deepEqual(d.bundle.principal, { status: 'operator-declared-unverified', value: 'operator@example.org' });
  assert.equal(d.bundle.evidenceClass, 'operator-discovered-unattested');
  await verify(d.bytes);
});

test('budget: time margin stops new requests, records the termination, marks the rest not-observed, and keeps the evidence', async () => {
  // The margin must exceed the 30 s S6c exchange timeout, so a started read completes inside the window.
  assert.equal(SD.MARGIN_MS, 45000);
  const { d, f } = await run({ jumps: t => (t === 40 ? 300000 - 45000 : 0) });
  assert.equal(d.report.termination.reason, 'time-budget');
  assert.equal(d.bundle.termination, 'time-budget');
  assert.ok(d.report.endpoints.some(e => e.function.status === 'not-observed'));
  assert.equal(d.report.indexes.status, 'not-observed');
  assert.equal(d.report.inventory.passes[1].status, 'not-observed');
  assert.equal(listings(d).includes('observed-absent'), false);
  assert.ok(f.fixture.calls.length < 82);
  await verify(d.bytes);
  await refusesVerify(reseal(d, t => { t.termination.reason = 'read-limit'; }));
  await refusesVerify(reseal(d, t => { t.termination = null; }));
});

test('budget: the 400-read limit stops new requests and keeps the evidence', async () => {
  let page = 0;
  const { d, f } = await run({ onExchange: url => {
    const u = new URL(url);
    if (isList(url)) return { functions: [], nextPageToken: `p${page++}` };
    if (u.pathname.endsWith('/indexes')) return { indexes: [], nextPageToken: `i${page++}` };
    if (u.pathname.endsWith('/fields')) return { fields: [], nextPageToken: `f${page++}` };
    return undefined;
  } });
  assert.equal(f.fixture.calls.length, SD.MAX_READS);
  assert.equal(d.report.termination.reason, 'read-limit');
  assert.equal(d.report.reads.total, SD.MAX_READS);
  await verify(d.bytes);
});

test('budget: a read completing after the five-minute window ends discovery; replay reproduces it', async () => {
  // Ticks: 0 start; 1-3 project (budget, request, completion); 4-6 database. Tick 6 jumps past the window.
  const { d } = await run({ jumps: t => (t === 6 ? SD.WINDOW_MS + 1 : 0) });
  assert.equal(d.report.termination.reason, 'window-exceeded');
  assert.equal(d.report.database.status, 'observed-present');
  assert.equal(d.report.inventory.status, 'not-observed');
  await verify(d.bytes);
});

test('tamper: edited, resealed, reordered, re-statused, re-bodied, re-identified or re-claimed evidence refuses', async () => {
  const { d } = await run();
  await verify(d.bytes);
  const t = transcriptOf(d);
  const flip = buf => { const b = Buffer.from(buf); b[b.length - 3] ^= 1; return b; };
  await refusesVerify({ ...d.bytes, transcript: flip(d.bytes.transcript) });
  await refusesVerify({ ...d.bytes, report: flip(d.bytes.report) });
  await refusesVerify({ ...d.bytes, bundle: flip(d.bytes.bundle) });
  await refusesVerify({ ...d.bytes, transcript: Buffer.from(`${d.bytes.transcript} `) }, /canonical|strict/);
  const readAt = t.events.findIndex(e => e.type === 'read' && e.url === FN('teacherUnitsGet'));
  await refusesVerify(reseal(d, x => { x.events[readAt].status = 503; }));
  await refusesVerify(reseal(d, x => { const a = x.events[readAt]; x.events[readAt] = x.events[readAt + 2]; x.events[readAt + 2] = a; }));
  const binAt = t.events.findIndex(e => e.mode === 'binary');
  await refusesVerify(reseal(d, x => { const b = Buffer.from(x.events[binAt].body, 'base64'); b[10] ^= 1; x.events[binAt].body = b.toString('base64'); }), /altered/);
  await refusesVerify(reseal(d, x => { const b = Buffer.from(x.events[binAt].body, 'base64'); b[10] ^= 1; x.events[binAt].body = b.toString('base64'); x.events[binAt].sha256 = K.sha256Bytes(b); }));
  await refusesVerify(reseal(d, x => { x.projectId = 'lyfelabz-prod'; x.projectNumber = '182791689935'; }), /cross-project/);
  await refusesVerify(reseal(d, x => { x.evidenceClass = 'operator-captured-unattested'; }), /evidence class/);
  await refusesVerify(reseal(d, x => { x.attestation = 'provider verified'; }), /authority or attestation literal/);
  // An event URL rebound to another allowed request refuses, even though the derived report would not change.
  await refusesVerify(reseal(d, x => { x.events[readAt].url = FN('teacherUnitsList'); }), /differs from the replayed request/);
  await refusesVerify(reseal(d, x => { x.events.pop(); }));
  await refusesVerify(reseal(d, x => { x.events.push({ type: 'clock', at: x.completedAt }); }));
  // Resealed inconsistent evidence: a claim edited in the bundle, or a status edited in the report, with hashes recomputed.
  const bundle = JSON.parse(d.bytes.bundle.toString('utf8'));
  for (const edit of [b => { b.certifiedEvidence = true; }, b => { b.releaseAuthorized = true; }, b => { b.gates.G1 = 'resolved'; }, b => { b.providerVerified = true; }]) {
    const copy = JSON.parse(JSON.stringify(bundle)); edit(copy);
    await refusesVerify({ ...d.bytes, bundle: Buffer.from(K.canonicalJSON(copy), 'utf8') }, /discovery\.json differs/);
  }
  const report = JSON.parse(d.bytes.report.toString('utf8'));
  report.endpoints[0].listing.status = 'observed-absent';
  const reportBytes = Buffer.from(K.canonicalJSON(report), 'utf8');
  const resealed = JSON.parse(K.canonicalJSON(bundle)); resealed.files.report.sha256 = K.sha256Bytes(reportBytes);
  await refusesVerify({ ...d.bytes, report: reportBytes, bundle: Buffer.from(K.canonicalJSON(resealed), 'utf8') }, /discovery-report\.json differs/);
  await assert.rejects(verify({ ...d.bytes, extra: Buffer.from('x') }), /files required exactly/);
  await assert.rejects(verify({ transcript: d.bytes.transcript, report: d.bytes.report }), /files required exactly/);
});

test('cross-consumer isolation: discovery artifacts are refused by every certified consumer', async () => {
  const { d } = await run();
  const parse = b => JSON.parse(b.toString('utf8'));
  // S4 observation consumers.
  for (const doc of [d.report, d.transcript, d.bundle]) assert.throws(() => O.assertA3Observation(doc, STAGING), /not an A3 provider observation/);
  // S6c observe verify: the discovery file set, and discovery bytes under capture names.
  const { buildCapture } = require('./fixtures/synthetic-capture.cjs');
  const c = await buildCapture();
  try {
    await assert.rejects(PC.verifyCapture({ project: STAGING, files: d.bytes, deploymentPlan: c.deploymentPlan, expected: c.expected, hostingRoot: c.hostingRoot }), /capture files required exactly/);
    const disguised = { transcript: d.bytes.transcript, observation: d.bytes.report, receipt: d.bytes.bundle, surfaceReport: d.bytes.report, bundle: d.bytes.bundle };
    await assert.rejects(PC.verifyCapture({ project: STAGING, files: disguised, deploymentPlan: c.deploymentPlan, expected: c.expected, hostingRoot: c.hostingRoot }), /REFUSED/);
  } finally { c.cleanup(); }
  // S5 access-review consumers, S6b release and package assembly.
  const P6 = require('./fixtures/synthetic-package.cjs');
  const ev = await P6.buildEvidence();
  const context = { project: STAGING, observation: ev.base.observation, deploymentPlan: ev.a.deploymentPlan, expected: ev.base.expected, hostingRoot: ev.base.hostingRoot };
  for (const [obj, bytes] of [[parse(d.bytes.report), d.bytes.report], [parse(d.bytes.bundle), d.bytes.bundle], [ev.base.receipt.object, d.bytes.report]]) {
    assert.throws(() => R.assertAccessReview(obj, bytes, context), /REFUSED/);
    assert.throws(() => R.composeEndpoints(obj, bytes, context), /REFUSED/);
  }
  const { hostingRoot, ...release } = ev.base;
  const substitutes = [{ observation: d.report }, { observation: d.transcript }, { receipt: { object: ev.base.receipt.object, bytes: d.bytes.bundle } },
    { receipt: { object: { ...ev.base.receipt.object, sha256: K.sha256Bytes(d.bytes.report) }, bytes: d.bytes.report } }];
  for (const sub of substitutes) {
    assert.throws(() => EP.assembleRelease({ ...release, ...sub }), /REFUSED/);
    assert.throws(() => EP.assembleEvidencePackage({ ...release, ...sub, assembledAt: '2026-10-16T12:30:00.000Z' }), /REFUSED/);
  }
  // S6d rollout-check never accepts discovery files as a capture.
  await assert.rejects(RV.checkRollout({ project: STAGING, planBytes: Buffer.from('{}'), planInputs: {}, now: '2026-10-16T12:30:00.000Z', capture: d.bytes,
    deploymentPlan: ev.a.deploymentPlan, expected: ev.base.expected }), /REFUSED/);
  // No discovery file carries a certified kind.
  for (const key of Object.keys(SD.FILES)) assert.equal(/teacherUnitsA3(ProviderObservation|ProviderCapture|ProviderTranscript|AccessReviewReceipt|DeploymentPlan|EvidencePackage)"/.test(d.bytes[key].toString('utf8')), false, key);
});

test('output: outside the repository only, never overwritten, 0700 directory and 0600 files, incomplete never complete', async () => {
  const { d } = await run();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lyfelabz-s6f-out-'));
  try {
    assert.throws(() => SD.prepareOutput(path.join(SD.REPOSITORY_ROOT, 'no-such-s6f-parent', 'discovery-out')), /inside the repository/);
    assert.throws(() => SD.prepareOutput('discovery-out', { cwd: path.join(SD.REPOSITORY_ROOT, 'scripts') }), /inside the repository/);
    assert.throws(() => SD.prepareOutput(SD.REPOSITORY_ROOT), /inside the repository/);
    // A symlink outside the repository that resolves into it is refused too.
    fs.symlinkSync(path.join(SD.REPOSITORY_ROOT, 'scripts'), path.join(root, 'into-repo'));
    assert.throws(() => SD.prepareOutput(path.join(root, 'into-repo', 'no-such-s6f-output')), /inside the repository/);
    assert.throws(() => SD.prepareOutput(path.join(root, 'missing', 'out')), /parent directory does not exist/);
    fs.mkdirSync(path.join(root, 'taken'));
    assert.throws(() => SD.prepareOutput(path.join(root, 'taken')), /already exists/);
    fs.mkdirSync(path.join(root, 'half.incomplete'));
    assert.throws(() => SD.prepareOutput(path.join(root, 'half')), /already exists/);
    fs.symlinkSync(path.join(root, 'nowhere'), path.join(root, 'link'));
    assert.throws(() => SD.prepareOutput(path.join(root, 'link')), /already exists/);
    const final = SD.prepareOutput(path.join(root, 'disc'));
    SD.writeOutput(final, d.bytes);
    assert.equal(fs.statSync(final).mode & 0o777, 0o700);
    for (const file of Object.values(SD.FILES)) assert.equal(fs.statSync(path.join(final, file)).mode & 0o777, 0o600, file);
    assert.equal(fs.existsSync(`${final}.incomplete`), false);
    await verify(SD.readOutput(final));
    assert.throws(() => SD.writeOutput(final, d.bytes), /already exists|could not be created|appeared/);
    // A directory that was never finalized is refused, and a missing bundle refuses.
    fs.mkdirSync(path.join(root, 'cut.incomplete'));
    fs.writeFileSync(path.join(root, 'cut.incomplete', SD.FILES.transcript), d.bytes.transcript);
    assert.throws(() => SD.readOutput(path.join(root, 'cut.incomplete')), /never a complete discovery/);
    fs.mkdirSync(path.join(root, 'cut2'));
    fs.writeFileSync(path.join(root, 'cut2', SD.FILES.transcript), d.bytes.transcript);
    assert.throws(() => SD.readOutput(path.join(root, 'cut2')), /unreadable/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('static: the module holds no credential source, makes no direct request, never signs, never reads the alias file or fixtures', () => {
  const source = fs.readFileSync(path.join(__dirname, 'staging-discovery.cjs'), 'utf8');
  const open = 'const HELPER_SOURCE = String.raw`', from = source.indexOf(open), to = source.indexOf('`;\n', from);
  assert.ok(from > 0 && to > from);
  assert.equal(source.slice(from + open.length, to), SD.HELPER_SOURCE, 'the exported helper source is the literal in the module');
  // The caller-side code: no process-global working-directory change; one local helper spawn of this Node binary.
  const code = (source.slice(0, from) + source.slice(to + 2)).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const pattern of [/\bfetch\(/, /readApi|tokenFromGcloud|gcloud|liveAccessToken|createLiveExchange/, /firebaserc/i, /\bsign\(|privateKey|kms/i, /fixtures\//, /execFile|execSync|\.fork\(|\bspawn\(|\bexec\('/,
    /process\.chdir/, /method:\s*'(?:POST|PUT|PATCH|DELETE)'/, /appendFileSync|createWriteStream|copyFileSync|rmSync|unlinkSync/]) assert.equal(pattern.test(code), false, String(pattern));
  assert.equal(code.match(/child_process/g).length, 1);
  assert.equal(code.match(/spawnSync\(/g).length, 1);
  assert.match(code, /spawnSync\(process\.execPath, \['-e', source, target\], \{ cwd: path\.parse\(target\)\.root \|\| '\/', env: \{\}, shell: false/);
  // The helper: fs and path only, no network, process, environment or dynamic-code access.
  assert.deepEqual(SD.HELPER_SOURCE.match(/require\('[^']+'\)/g), ["require('fs')", "require('path')"]);
  for (const pattern of [/http|https|net|dgram|tls|dns|fetch|child_process|worker|process\.env|\beval\(|Function\(|import\(/]) assert.equal(pattern.test(SD.HELPER_SOURCE), false, String(pattern));
  assert.equal(SD.HELPER_SOURCE.match(/process\.chdir/g).length, 1);
  const writes = code.split('\n').filter(line => /writeFileSync\(/.test(line));
  assert.equal(writes.length, 1);
  assert.match(writes[0], /flag: 'wx', mode: 0o600/);
  for (const certified of ['provider-observation.cjs', 'access-review.cjs', 'provider-capture.cjs', 'surface-observation.cjs']) {
    assert.equal(/staging-discovery/.test(fs.readFileSync(path.join(__dirname, certified), 'utf8')), false, `${certified} unchanged by S6f`);
  }
});

// --- Certification corrections (Sol F1 to F4) ------------------------------------

test('F1: inherited JavaScript property names and their encodings are never query rules; legitimate queries still pass', () => {
  const inherited = ['toString', '__proto__', 'hasOwnProperty', 'constructor', 'valueOf', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__defineGetter__', '__lookupSetter__'];
  const encoded = ['%74oString', 'toStrin%67', '%5F%5Fproto%5F%5F', '__%70roto__', 'hasOwn%50roperty', '%68asOwnProperty'];
  for (const key of [...inherited, ...encoded]) {
    for (const url of [`${LIST}?${key}=x`, `${LIST}?pageToken=abc&${key}=1`, `${FN('teacherUnitsGet')}:getIamPolicy?options.requestedPolicyVersion=3&${key}=3`,
      `https://storage.googleapis.com/storage/v1/b/${SD.SOURCE_BUCKET}/o/source.zip?alt=media&generation=17&${key}=media`]) {
      assert.throws(() => SD.assertDiscoveryUrl(url), /unknown query parameter refused/, url);
    }
  }
  // Duplicates, including an encoded duplicate, and credential keys still refuse; production guards stay.
  assert.throws(() => SD.assertDiscoveryUrl(`${LIST}?pageToken=a&page%54oken=b`), /duplicate query parameter/);
  assert.throws(() => SD.assertDiscoveryUrl(`${LIST}?%61ccess_token=x`), /credential-bearing/);
  assert.throws(() => SD.assertDiscoveryUrl(`${LIST}?pageToken=lyfelabz-prod`), /production identity/);
  for (const url of [`${LIST}?pageToken=abc`, `${FN('teacherUnitsGet')}:getIamPolicy?options.requestedPolicyVersion=3`,
    `https://storage.googleapis.com/storage/v1/b/${SD.SOURCE_BUCKET}/o/source.zip?alt=media&generation=17`,
    `https://firestore.googleapis.com/v1/projects/${STAGING}/databases/(default)/collectionGroups/-/fields?filter=indexConfig.usesAncestorConfig%3Dfalse&pageToken=p`]) {
    assert.doesNotThrow(() => SD.assertDiscoveryUrl(url), url);
  }
});

// `>>>` and `???` make the Base64 forms contain `+` and `/`, so Base64 and Base64url differ.
const TOKEN = `ya29.a0AfB_S6F-ECHO-CANARY-${'Zq9'.repeat(20)}>>>???/x+y`;
function tokenForms(token) {
  const raw = Buffer.from(token);
  return { raw: token, percent: encodeURIComponent(token), jsonEscaped: token.replace(/\//g, '\\/'), hex: raw.toString('hex'), HEX: raw.toString('hex').toUpperCase(),
    base64: raw.toString('base64'), base64url: raw.toString('base64url'), bearerBase64: Buffer.from(`Bearer ${token}`).toString('base64'),
    headerBase64url: Buffer.from(`Authorization: Bearer ${token}`).toString('base64url'), offset1: Buffer.from(`x${token}yz`).toString('base64'),
    offset2: Buffer.from(`xy${token}`).toString('base64') };
}
function assertNoToken(texts, token = TOKEN) {
  const forms = tokenForms(token);
  assert.notEqual(forms.base64.replace(/=+$/, ''), forms.base64url, 'the canary exercises the Base64 and Base64url alphabet difference');
  for (const [i, text] of texts.entries()) for (const [name, form] of Object.entries(forms)) assert.equal(text.includes(form), false, `${name} in text ${i}`);
  // The token's own characters (long enough to be unambiguous) never survive either.
  for (const text of texts) assert.equal(text.includes(token.slice(5, 40)), false);
}
const evidenceTexts = d => {
  const t = transcriptOf(d);
  return [d.bytes.transcript.toString('latin1'), d.bytes.report.toString('latin1'), d.bytes.bundle.toString('latin1'),
    ...t.events.filter(e => e.body).map(e => Buffer.from(e.body, 'base64').toString('latin1')), ...t.events.filter(e => e.reason).map(e => e.reason)];
};

test('F2: a provider error echoing the active token, plain and encoded, never reaches the transcript, report or bundle; replay holds', async () => {
  const forms = tokenForms(TOKEN);
  // Exact provider bytes (not re-serialized), so the JSON slash-escaped form is a real `\/` escape.
  const echo = { status: 403, raw: Buffer.from(`{"error":{"code":403,"status":"PERMISSION_DENIED","message":"token ${Object.values(forms).join(' | ')} rejected",`
    + `"details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"${TOKEN}","metadata":{"header":"Bearer ${TOKEN}"}},{"reason":"IAM_PERMISSION_DENIED"}],`
    + `"stack":"at ${TOKEN}"}}`) };
  assert.equal(JSON.parse(echo.raw.toString()).error.message.includes(TOKEN), true, 'the echo is valid JSON carrying the token');
  const { d } = await run({ onExchange: (url, n) => {
    if (url === LIST && n === 1) return echo;
    if (url.endsWith('/releases/cloud.firestore') && n === 1) return { throws: new Error(`[a3-provider-capture] REFUSED: provider echoed ${TOKEN} and ${forms.base64}`) };
    if (url.endsWith('/databases/(default)')) return Buffer.from(JSON.stringify({ name: `projects/${STAGING}/databases/(default)`, type: 'FIRESTORE_NATIVE', note: forms.offset2 }));
    return undefined;
  } }, { activeCredential: TOKEN });
  assertNoToken(evidenceTexts(d));
  // Sanitization is a declaration plus a diagnostic marker count derived from the recorded bytes.
  assert.equal(d.report.sanitization.activeCredential, 'active-credential-removed-before-recording');
  assert.match(d.report.sanitization.declaration, /cannot confirm/);
  assert.ok(d.report.sanitization.markersInRecordedEvidence >= Object.keys(forms).length);
  assert.ok(evidenceTexts(d).some(x => x.includes(SD.REDACTED.toString())));
  const reason = d.report.inventory.passes[0].reason;
  assert.deepEqual({ kind: reason.kind, httpStatus: reason.httpStatus, providerCode: reason.providerCode, providerStatus: reason.providerStatus, reasons: reason.reasons },
    { kind: 'permission-denied', httpStatus: 403, providerCode: 403, providerStatus: 'PERMISSION_DENIED', reasons: ['IAM_PERMISSION_DENIED'] });
  assert.equal(reason.unrecognizedReasons, 1);
  assert.match(reason.message, /not copied/);
  const failure = transcriptOf(d).events.find(e => e.type === 'failure');
  assert.equal(failure.reason.split(SD.REDACTED.toString()).length - 1, 2);
  const { value, calls } = await withoutNetwork(() => verify(d.bytes));
  assert.deepEqual(calls, []); assert.match(value.verified, /replay-consistent/);
  // There is no separate count field to edit: the marker count is re-derived from the recorded bytes,
  // and an edited declaration changes the re-derived report and bundle.
  await refusesVerify(reseal(d, t => { t.sanitization = 'not-applied'; }), /discovery-report\.json differs/);
  await refusesVerify(reseal(d, t => { t.sanitization = 'verified-clean'; }), /sanitization declaration unsupported/);
  const at = transcriptOf(d).events.findIndex(e => e.type === 'read' && e.url === LIST);
  await refusesVerify(reseal(d, t => { t.events[at].redactions = 0; }), /missing or unknown fields/);
});

test('F2: free-text provider messages are never copied into the report, even without an active credential', async () => {
  const canary = 'FREE-TEXT-MESSAGE-CANARY-41d7';
  const { d } = await run({ onExchange: url => (url === LIST ? reply(500, { error: { code: 500, status: 'INTERNAL', message: canary, details: [{ reason: `${canary} bad reason` }] } }) : undefined) });
  assert.equal(d.bytes.report.includes(canary), false);
  assert.equal(d.bytes.bundle.includes(canary), false);
  assert.equal(d.report.inventory.passes[0].reason.unrecognizedReasons, 1);
  await verify(d.bytes);
});

test('F2: an archive carrying the active token is redacted before hashing (and then honestly unverifiable); short or malformed credentials refuse', async () => {
  const { d } = await run({ onExchange: url => (new URL(url).host === 'storage.googleapis.com' ? Buffer.concat([Buffer.from('PK'), Buffer.from(TOKEN), Buffer.alloc(16)]) : undefined) }, { activeCredential: TOKEN });
  assertNoToken(evidenceTexts(d));
  assert.equal(ep(d, 'teacherUnitsGet').source.status, 'incomplete');
  await verify(d.bytes);
  for (const bad of ['short', '', 'has space in it 0123456789', 42]) await assert.rejects(run({}, { activeCredential: bad }), /active credential is malformed/);
  assert.equal(SD.redactText(`x ${TOKEN} ${tokenForms(TOKEN).base64}`, TOKEN).includes(TOKEN.slice(5, 40)), false);
});

test('F3: an unfinished .incomplete directory is refused through every alias; a finalized directory and its alias verify', async () => {
  const { d } = await run();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lyfelabz-s6f-f3-'));
  try {
    const pending = path.join(root, 'disc.incomplete');
    fs.mkdirSync(pending);
    for (const [key, file] of Object.entries(SD.FILES)) fs.writeFileSync(path.join(pending, file), d.bytes[key]);
    fs.symlinkSync(pending, path.join(root, 'alias'));
    fs.mkdirSync(path.join(root, 'sub'));
    for (const alias of [pending, `${pending}/`, `${pending}/.`, `${pending}//`, `${pending}/./`, `${root}//disc.incomplete`, path.join(root, 'sub', '..', 'disc.incomplete'),
      `${root}/sub/../disc.incomplete/.`, path.join(root, 'alias'), `${path.join(root, 'alias')}/.`]) {
      assert.throws(() => SD.readOutput(alias), /\.incomplete directory is never a complete discovery/, alias);
    }
    // Relative aliases from a working directory, and a symlink chain.
    assert.throws(() => SD.readOutput('./disc.incomplete/.', { cwd: root }), /never a complete discovery/);
    fs.symlinkSync(path.join(root, 'alias'), path.join(root, 'alias2'));
    assert.throws(() => SD.readOutput('alias2', { cwd: root }), /never a complete discovery/);
    // A finalized directory whose files are symlinks into unfinished output is refused.
    const linked = path.join(root, 'linked'); fs.mkdirSync(linked);
    for (const file of Object.values(SD.FILES)) fs.symlinkSync(path.join(pending, file), path.join(linked, file));
    assert.throws(() => SD.readOutput(linked), /not a regular file/);
    // A FIFO in place of a file is refused without blocking.
    const fifo = path.join(root, 'fifo'); fs.mkdirSync(fifo);
    for (const [key, file] of Object.entries(SD.FILES)) if (key !== 'bundle') fs.writeFileSync(path.join(fifo, file), d.bytes[key]);
    require('node:child_process').execFileSync('mkfifo', [path.join(fifo, SD.FILES.bundle)]);
    assert.throws(() => SD.readOutput(fifo), /not a regular file/);
    // Valid finalized controls: the directory itself, `/.`, `//` and a symlink to it.
    const final = SD.prepareOutput(path.join(root, 'final'));
    SD.writeOutput(final, d.bytes);
    fs.symlinkSync(final, path.join(root, 'final-alias'));
    for (const ok of [final, `${final}/.`, `${final}//`, path.join(root, 'final-alias')]) await verify(SD.readOutput(ok));
    // Files nested anywhere under an unfinished directory are refused too.
    const nested = path.join(pending, 'inner'); fs.mkdirSync(nested);
    for (const [key, file] of Object.entries(SD.FILES)) fs.writeFileSync(path.join(nested, file), d.bytes[key]);
    assert.throws(() => SD.readOutput(nested), /never a complete discovery/);
    assert.throws(() => SD.readOutput(path.join(root, 'missing')), /unreadable/);
    assert.throws(() => SD.readOutput(path.join(final, SD.FILES.bundle)), /not a directory/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('F4: a backwards clock refuses discovery with no evidence, and a resealed backwards transcript time refuses replay', async () => {
  for (const at of [1, 2, 3, 20, 60]) {
    const f = buildDiscovery({ jumps: t => (t === at ? -1 : 0), step: 0 });
    try {
      await assert.rejects(SD.discover({ project: STAGING, exchange: f.exchange, clock: f.clock, evidenceClass: 'synthetic' }), /discovery clock moved backwards/, `tick ${at}`);
    } finally { f.cleanup(); }
  }
  // Equal readings are not a rollback (non-decreasing contract).
  const flat = await run({ step: 0 });
  await verify(flat.d.bytes);
  const { d } = await run();
  const t = transcriptOf(d);
  const i = t.events.findIndex((e, n) => n > 4 && e.type === 'read');
  const earlier = new Date(Date.parse(t.events[i - 1].at) - 1).toISOString();
  await refusesVerify(reseal(d, x => { x.events[i].requestedAt = earlier; }), /moved backwards/);
  await refusesVerify(reseal(d, x => { x.events[i].completedAt = earlier; }), /moved backwards/);
  await refusesVerify(reseal(d, x => { x.events[2].at = new Date(Date.parse(x.startedAt) - 1).toISOString(); }), /moved backwards/);
  await refusesVerify(reseal(d, x => { x.completedAt = x.startedAt; }), /moved backwards/);
});

// --- Second recertification corrections (Sol F2 lowercase percent; F3 concurrent substitution) ---

test('F2 (second): percent escapes in lowercase, uppercase and mixed case, and JSON \\u escapes, are removed; no-scan stays declared', async () => {
  const token = `ya29.a0Ab/CD+ef=gh~${'Lp7'.repeat(15)}`;
  const upper = encodeURIComponent(token), lower = upper.replace(/%[0-9A-F]{2}/g, m => m.toLowerCase());
  let flip = 0;
  const mixed = upper.replace(/%([0-9A-F])([0-9A-F])/g, (m, a, b) => `%${(flip++ % 2) ? a.toLowerCase() : a}${(flip % 3) ? b.toLowerCase() : b}`);
  const overEncoded = [...token].map((c, i) => (i % 3 === 0 ? `%${c.charCodeAt(0).toString(16)}` : c)).join('');
  const jsonUnicode = [...token].map((c, i) => (i % 4 === 1 ? `\\u00${c.charCodeAt(0).toString(16).toUpperCase()}` : c === '/' ? '\\/' : c)).join('');
  const hexMixed = [...Buffer.from(token).toString('hex')].map((c, i) => (i % 2 ? c.toUpperCase() : c)).join('');
  assert.notEqual(lower, upper); assert.notEqual(mixed, upper); assert.notEqual(mixed, lower);
  const variants = { lower, upper, mixed, overEncoded, jsonUnicode, hexMixed };
  const body = Buffer.from(`{"error":{"code":401,"status":"UNAUTHENTICATED","message":"${Object.values(variants).join(' ')}"}}`);
  assert.equal(JSON.parse(body.toString()).error.message.includes(token), true, 'the JSON escapes decode to the token');
  const { d } = await run({ onExchange: (url, n) => (url === LIST && n === 1 ? { status: 401, raw: body }
    : url.endsWith('/releases/cloud.firestore') && n === 1 ? { throws: new Error(`[a3-provider-capture] REFUSED: echo ${lower} ${mixed}`) } : undefined) }, { activeCredential: token });
  const texts = evidenceTexts(d);
  for (const [name, form] of Object.entries(variants)) for (const text of texts) assert.equal(text.includes(form), false, name);
  for (const text of texts) assert.equal(text.includes('Lp7Lp7Lp7'), false, 'no recognizable token fragment survives');
  assert.ok(d.report.sanitization.markersInRecordedEvidence >= Object.keys(variants).length + 2);
  await verify(d.bytes);
  // Without an active credential nothing is scanned, and the evidence says so.
  const plainRun = await run({ onExchange: (url, n) => (url === LIST && n === 1 ? { status: 401, raw: body } : undefined) });
  assert.equal(plainRun.d.report.sanitization.activeCredential, 'not-applied');
  assert.equal(plainRun.d.bundle.summary.sanitization.markersInRecordedEvidence, 0);
});

// --- Working-directory correction: the bound read runs only in the helper process ---
// `hooked(actions)` prefixes the identical helper source with deterministic filesystem actions
// that run inside the helper at its Nth file open or at its chdir; no timing is involved.
function hooked(actions) {
  return `const __fs = require('fs'), __cp = require('child_process'); const __A = ${JSON.stringify(actions)};
const __wait = p => { const start = Date.now(); while (!__fs.existsSync(p)) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); if (Date.now() - start > 20000) { process.stderr.write('handshake-timeout'); process.exit(4); } } };
const __do = list => { for (const [op, a, b] of list || []) {
  if (op === 'rename') __fs.renameSync(a, b); else if (op === 'mkdir') __fs.mkdirSync(a); else if (op === 'symlink') __fs.symlinkSync(a, b);
  else if (op === 'unlink') __fs.unlinkSync(a); else if (op === 'rm') __fs.rmSync(a, { recursive: true }); else if (op === 'mkfifo') __cp.execFileSync('/usr/bin/mkfifo', [a]);
  else if (op === 'touch') __fs.writeFileSync(a, ''); else if (op === 'await') __wait(a); } };
let __n = 0; const __open = __fs.openSync; __fs.openSync = function (...x) { __n++; __do(__A.open && __A.open[__n]); return __open.apply(this, x); };
const __chdir = process.chdir; process.chdir = function (t) { __do(__A.chdir); return __chdir.call(process, t); };
`;
}
const helperRead = (actions, target) => SD.interpretHelper(SD.spawnHelper(hooked(actions) + SD.HELPER_SOURCE, target));
function evidenceTree(d, other) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lyfelabz-s6f-cwd-')));
  const fresh = (name, bytes) => { const dir = path.join(root, name); fs.mkdirSync(dir); for (const [k, f] of Object.entries(SD.FILES)) fs.writeFileSync(path.join(dir, f), bytes[k]); return dir; };
  return { root, final: fresh('disc', d.bytes), unfinished: fresh('sub.incomplete', other.bytes), caller: (fs.mkdirSync(path.join(root, 'caller')), path.join(root, 'caller')) };
}
const same = (files, d) => Object.keys(SD.FILES).every(k => files[k].equals(d.bytes[k]));

test('working directory: the caller never changes directory; renamed, removed or replaced caller directories are unaffected', async () => {
  const { d } = await run(), other = (await run({ mutate: removeAll(O.ENDPOINTS) })).d;
  const t = evidenceTree(d, other), home = process.cwd(), realChdir = process.chdir;
  try {
    const scenarios = {
      renamed: [['rename', t.caller, `${t.caller}.moved`]],
      removed: [['rm', t.caller]],
      replaced: [['rename', t.caller, `${t.caller}.old`], ['mkdir', t.caller]],
    };
    for (const [name, actions] of Object.entries(scenarios)) {
      if (!fs.existsSync(t.caller)) fs.mkdirSync(t.caller);
      process.chdir(t.caller);
      const ino = fs.statSync('.').ino;
      let chdirCalls = 0;
      process.chdir = () => { chdirCalls++; throw new Error('S6f must not change the caller working directory'); };
      let files;
      try { files = helperRead({ open: { 1: actions } }, t.final); } finally { process.chdir = realChdir; }
      assert.equal(chdirCalls, 0, name);
      assert.equal(fs.statSync('.').ino, ino, `${name}: the caller stays in its own directory inode`);
      assert.equal(same(files, d), true, name);
      await verify(files);
      realChdir.call(process, home);
      for (const leftover of [`${t.caller}.moved`, `${t.caller}.old`]) if (fs.existsSync(leftover)) fs.rmSync(leftover, { recursive: true });
    }
    // The production reader too: with the caller's directory removed before the call, it reads and never changes directory.
    if (!fs.existsSync(t.caller)) fs.mkdirSync(t.caller);
    process.chdir(t.caller);
    const ino = fs.statSync('.').ino;
    fs.rmSync(t.caller, { recursive: true });
    process.chdir = () => { throw new Error('S6f must not change the caller working directory'); };
    let files;
    try { files = SD.readOutput(t.final); } finally { process.chdir = realChdir; }
    assert.equal(fs.statSync('.').ino, ino);
    assert.equal(same(files, d), true);
  } finally { process.chdir = realChdir; realChdir.call(process, home); fs.rmSync(t.root, { recursive: true, force: true }); }
});

test('working directory: a concurrent worker reading relative paths never observes an S6f working-directory change', async () => {
  const { Worker } = require('node:worker_threads');
  const { d } = await run(), other = (await run({ mutate: removeAll(O.ENDPOINTS) })).d;
  const t = evidenceTree(d, other), home = process.cwd();
  const started = path.join(t.root, 'helper-reading'), done = path.join(t.root, 'worker-done');
  process.chdir(t.caller);
  const worker = new Worker(`const { workerData, parentPort } = require('node:worker_threads'); const fs = require('node:fs');
    const sleep = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    const start = Date.now(); while (!fs.existsSync(workerData.started)) { sleep(); if (Date.now() - start > 20000) break; }
    const result = { saw: fs.existsSync(workerData.started), cwd: fs.realpathSync.native('.') };
    try { fs.readFileSync('discovery.json'); result.relative = 'read'; } catch (e) { result.relative = e.code; }
    fs.writeFileSync(workerData.done, ''); parentPort.postMessage(result);`, { eval: true, workerData: { started, done } });
  try {
    await new Promise(resolve => worker.once('online', resolve));
    const message = new Promise(resolve => worker.once('message', resolve));
    // The helper pauses mid-read (between its first and second file) until the worker has looked.
    const files = helperRead({ open: { 2: [['touch', started], ['await', done]] } }, t.final);
    const seen = await message;
    assert.equal(seen.saw, true, 'the worker looked while the helper was mid-read');
    assert.equal(seen.cwd, t.caller, 'the worker sees the caller working directory');
    assert.equal(seen.relative, 'ENOENT', 'relative reads never resolve inside the evidence directory');
    assert.equal(same(files, d), true);
  } finally { await worker.terminate(); process.chdir(home); fs.rmSync(t.root, { recursive: true, force: true }); }
});

test('F3 (helper): substitution races, restoration, binding-time swaps, promotion, symlinks and FIFOs cannot select unfinished evidence', async () => {
  const { d } = await run(), other = (await run({ mutate: removeAll(O.ENDPOINTS) })).d;
  assert.equal(other.bytes.bundle.equals(d.bytes.bundle), false, 'the substitute is different, valid evidence');
  const t = evidenceTree(d, other), { final, unfinished } = t, home = process.cwd();
  const swapIn = [['rename', final, `${final}.orig`], ['rename', unfinished, final]], swapBack = [['rename', final, unfinished], ['rename', `${final}.orig`, final]];
  const reset = () => { if (fs.existsSync(`${final}.orig`)) { if (fs.lstatSync(final).isSymbolicLink()) fs.unlinkSync(final); else fs.renameSync(final, unfinished); fs.renameSync(`${final}.orig`, final); } };
  try {
    // Sol's interleaving: swapped in during the reads, restored before the final check -> the validated directory's bytes.
    let files = helperRead({ open: { 1: swapIn, 3: swapBack } }, final);
    assert.equal(same(files, d), true); await verify(files); reset();
    // Swap left in place for the whole read -> still the validated directory.
    files = helperRead({ open: { 1: swapIn } }, final);
    assert.equal(same(files, d), true); reset();
    // Binding-time substitution restored before the reads -> the bound directory is now named .incomplete: refused.
    assert.throws(() => helperRead({ chdir: swapIn, open: { 1: swapBack } }, final), /never a complete discovery/); reset();
    // Pathname replaced by a symlink to unfinished output during the reads -> still the validated directory.
    files = helperRead({ open: { 1: [['rename', final, `${final}.orig`], ['symlink', unfinished, final]] } }, final);
    assert.equal(same(files, d), true); reset();
    // A bound unfinished directory renamed to a finalized name during the reads -> refused at binding.
    assert.throws(() => helperRead({ open: { 1: [['rename', unfinished, path.join(t.root, 'promoted')]] } }, unfinished), /never a complete discovery/);
    if (fs.existsSync(path.join(t.root, 'promoted'))) fs.renameSync(path.join(t.root, 'promoted'), unfinished);
    // A file replaced by a symlink, or by a FIFO, during the reads -> refused.
    const bundle = path.join(final, SD.FILES.bundle);
    for (const replace of [['symlink', path.join(unfinished, SD.FILES.bundle), bundle], ['mkfifo', bundle]]) {
      assert.throws(() => helperRead({ open: { 1: [['rename', bundle, `${bundle}.orig`], replace] } }, final), /not a regular file/, replace[0]);
      fs.unlinkSync(bundle); fs.renameSync(`${bundle}.orig`, bundle);
    }
    // Nested and aliased unfinished paths, symlink aliases, and a finalized control with replay, through the production reader.
    const nested = path.join(unfinished, 'inner'); fs.mkdirSync(nested);
    for (const [k, f] of Object.entries(SD.FILES)) fs.writeFileSync(path.join(nested, f), other.bytes[k]);
    fs.symlinkSync(unfinished, path.join(t.root, 'link'));
    for (const alias of [unfinished, `${unfinished}/.`, `${unfinished}//`, path.join(final, '..', 'sub.incomplete'), nested, path.join(t.root, 'link'), path.join(t.root, 'link', 'inner')]) {
      assert.throws(() => SD.readOutput(alias), /never a complete discovery/, alias);
    }
    assert.throws(() => SD.readOutput('sub.incomplete/.', { cwd: t.root }), /never a complete discovery/);
    await verify(SD.readOutput(final)); await verify(SD.readOutput(`${final}//`));
    assert.equal(process.cwd(), home);
    // The helper runs with an empty environment: a hostile NODE_OPTIONS or credential variable in the caller never reaches it.
    const saved = { options: process.env.NODE_OPTIONS, token: process.env.GOOGLE_OAUTH_ACCESS_TOKEN };
    const probe = path.join(t.root, 'probe.cjs');
    fs.writeFileSync(probe, `require('fs').writeFileSync(${JSON.stringify(path.join(t.root, 'injected'))}, String(process.env.GOOGLE_OAUTH_ACCESS_TOKEN));`);
    process.env.NODE_OPTIONS = `--require ${probe}`; process.env.GOOGLE_OAUTH_ACCESS_TOKEN = 'ya29.ENV-CANARY';
    try { await verify(SD.readOutput(final)); } finally {
      if (saved.options === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = saved.options;
      if (saved.token === undefined) delete process.env.GOOGLE_OAUTH_ACCESS_TOKEN; else process.env.GOOGLE_OAUTH_ACCESS_TOKEN = saved.token;
    }
    assert.equal(fs.existsSync(path.join(t.root, 'injected')), false, 'NODE_OPTIONS did not reach the helper');
    // Helper failure is fail-closed: a malformed or failing helper never yields evidence.
    for (const result of [{ status: 1, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.from('?') }, { status: null, signal: 'SIGKILL', stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) },
      { status: 0, signal: null, stdout: Buffer.from('S6F1'), stderr: Buffer.alloc(0) }, { status: 0, signal: null, stdout: Buffer.from('XXXX'), stderr: Buffer.alloc(0) }, { error: new Error('spawn failed') }]) {
      assert.throws(() => SD.interpretHelper(result), /REFUSED/);
    }
    const frame = n => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
    assert.throws(() => SD.interpretHelper({ status: 0, signal: null, stderr: Buffer.alloc(0), stdout: Buffer.concat([Buffer.from('S6F1'), frame(1), Buffer.from('x'), frame(1), Buffer.from('y'), frame(5), Buffer.from('z')]) }), /malformed/);
    assert.throws(() => SD.interpretHelper({ status: 0, signal: null, stderr: Buffer.alloc(0), stdout: Buffer.concat([Buffer.from('S6F1'), frame(0), frame(0), frame(0), Buffer.from('extra')]) }), /malformed/);
    assert.throws(() => SD.interpretHelper(SD.spawnHelper(SD.HELPER_SOURCE, 'relative/path')), /refused its arguments/);
  } finally { process.chdir(home); fs.rmSync(t.root, { recursive: true, force: true }); }
});

// --- Bounded file read (resource correction) ---
test('bounded read: limit exact and exceeded, growth after fstat and shrinkage during the read refuse without allocating past the limit', () => {
  assert.equal(SD.HELPER_SOURCE.match(/const LIMIT = (\d+);/)[1], '268435456', 'production helper limit is 256 MiB');
  const LIMIT = 4096;
  const small = SD.HELPER_SOURCE.replace('const LIMIT = 268435456;', `const LIMIT = ${LIMIT};`);
  assert.notEqual(small, SD.HELPER_SOURCE);
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lyfelabz-s6f-bound-')));
  // Records the largest Buffer the helper allocates and the largest read it requests; optional growth at the Nth fstat
  // and truncation at the first read of a file, all inside the helper, deterministically.
  const instrumented = ({ growAt, growPath, shrinkPath, record }) => `const __fs = require('fs'); let __max = 0, __read = 0; const __growth = Buffer.alloc(1048576, 65);
for (const k of ['alloc', 'allocUnsafe', 'allocUnsafeSlow']) { const f = Buffer[k]; Buffer[k] = function (n, ...r) { if (n > __max) __max = n; return f.call(Buffer, n, ...r); }; }
const __rs = __fs.readSync; __fs.readSync = function (fd, b, o, len, p) { if (len > __read) __read = len; ${shrinkPath ? `if (!globalThis.__shrunk) { globalThis.__shrunk = 1; __fs.truncateSync(${JSON.stringify(shrinkPath)}, 3); }` : ''} return __rs.call(this, fd, b, o, len, p); };
let __n = 0; const __st = __fs.fstatSync; __fs.fstatSync = function (fd) { const s = __st(fd); __n++; ${growAt ? `if (__n === ${growAt}) __fs.appendFileSync(${JSON.stringify(growPath)}, __growth);` : ''} return s; };
process.on('exit', () => __fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ alloc: __max, read: __read })));
`;
  const dir = (name, sizes) => { const d = path.join(root, name); fs.mkdirSync(d); Object.values(SD.FILES).forEach((f, i) => fs.writeFileSync(path.join(d, f), Buffer.alloc(sizes[i], 97 + i))); return d; };
  const run = (target, hooks = {}) => {
    const record = path.join(root, `record-${Math.random().toString(16).slice(2)}.json`);
    const result = SD.spawnHelper(instrumented({ ...hooks, record }) + small, target);
    return { result, measured: JSON.parse(fs.readFileSync(record, 'utf8')) };
  };
  try {
    // Exactly at the limit: accepted, bytes exact.
    const exact = dir('exact', [LIMIT, 10, 0]);
    const ok = run(exact);
    const files = SD.interpretHelper(ok.result);
    assert.equal(files.transcript.length, LIMIT); assert.equal(files.report.length, 10); assert.equal(files.bundle.length, 0);
    assert.ok(ok.measured.read <= LIMIT + 1);
    // One byte over: refused before any read.
    const over = run(dir('over', [LIMIT + 1, 10, 10]));
    assert.throws(() => SD.interpretHelper(over.result), /exceeds the evidence size limit/);
    assert.equal(over.measured.read, 0); assert.equal(over.result.stdout.length, 0, 'no partial evidence is emitted');
    // Growth by 1 MiB between fstat and read: refused; nothing larger than size + 1 is requested or allocated.
    const growing = dir('grow', [100, 10, 10]);
    const grown = run(growing, { growAt: 1, growPath: path.join(growing, SD.FILES.transcript) });
    assert.throws(() => SD.interpretHelper(grown.result), /changed size while it was read/);
    assert.ok(grown.measured.read <= 101, `requested ${grown.measured.read}`);
    assert.ok(grown.measured.alloc <= LIMIT + 1, `allocated ${grown.measured.alloc}`);
    assert.equal(fs.statSync(path.join(growing, SD.FILES.transcript)).size, 100 + 1048576, 'the file really grew');
    // Growth of a file at the limit: still bounded by the limit + 1.
    const atLimit = dir('grow-limit', [LIMIT, 10, 10]);
    const grownLimit = run(atLimit, { growAt: 1, growPath: path.join(atLimit, SD.FILES.transcript) });
    assert.throws(() => SD.interpretHelper(grownLimit.result), /changed size/);
    assert.ok(grownLimit.measured.read <= LIMIT + 1 && grownLimit.measured.alloc <= LIMIT + 1, JSON.stringify(grownLimit.measured));
    // Shrinkage during the read: refused.
    const shrinking = dir('shrink', [200, 10, 10]);
    const shrunk = run(shrinking, { shrinkPath: path.join(shrinking, SD.FILES.transcript) });
    assert.throws(() => SD.interpretHelper(shrunk.result), /changed size while it was read/);
    assert.equal(shrunk.result.stdout.length, 0);
    // Malformed or truncated helper output refuses.
    const frame = n => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
    for (const stdout of [Buffer.alloc(0), Buffer.from('S6F'), Buffer.concat([Buffer.from('S6F1'), frame(4), Buffer.from('ab')]),
      Buffer.concat([Buffer.from('S6F1'), frame(0), frame(0)]), Buffer.concat([Buffer.from('S6F1'), frame(2 ** 40)])]) {
      assert.throws(() => SD.interpretHelper({ status: 0, signal: null, stderr: Buffer.alloc(0), stdout }), /malformed/);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('bounded read: valid evidence through the production reader still verifies offline', async () => {
  const { d } = await run();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lyfelabz-s6f-valid-')));
  try {
    const final = SD.prepareOutput(path.join(root, 'disc'));
    SD.writeOutput(final, d.bytes);
    const files = SD.readOutput(final);
    for (const k of Object.keys(SD.FILES)) assert.equal(files[k].equals(d.bytes[k]), true, k);
    await verify(files);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('bounded read: a size change after the final positive read is refused by the same-descriptor recheck', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lyfelabz-s6f-late-')));
  // At the transcript's first end-of-file read (after its last positive read, before acceptance),
  // shrink or grow the file deterministically inside the production helper source.
  const late = (file, action) => `const __fs = require('fs'); const __rs = __fs.readSync; let __done = false;
__fs.readSync = function (...a) { const got = __rs.apply(this, a); if (got === 0 && !__done) { __done = true; ${action === 'shrink'
    ? `__fs.truncateSync(${JSON.stringify(file)}, 3);` : `__fs.appendFileSync(${JSON.stringify(file)}, 'GROWN');`} } return got; };
`;
  const dir = name => { const d = path.join(root, name); fs.mkdirSync(d); Object.values(SD.FILES).forEach((f, i) => fs.writeFileSync(path.join(d, f), Buffer.alloc(500 + i, 97 + i))); return d; };
  try {
    for (const action of ['shrink', 'grow']) {
      const d = dir(action), transcript = path.join(d, SD.FILES.transcript);
      const result = SD.spawnHelper(late(transcript, action) + SD.HELPER_SOURCE, d);
      assert.throws(() => SD.interpretHelper(result), /changed size while it was read/, action);
      assert.equal(result.stdout.length, 0, 'no partial evidence is emitted');
      assert.equal(fs.statSync(transcript).size, action === 'shrink' ? 3 : 505, `${action} really happened late`);
    }
    // Unchanged control through the same hook point: accepted with exact bytes.
    const d = dir('unchanged');
    const files = SD.interpretHelper(SD.spawnHelper(late(path.join(root, 'elsewhere'), 'grow').replace(/__fs\.appendFileSync\([^;]*;/, '') + SD.HELPER_SOURCE, d));
    assert.equal(files.transcript.length, 500); assert.equal(files.report.length, 501); assert.equal(files.bundle.length, 502);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
