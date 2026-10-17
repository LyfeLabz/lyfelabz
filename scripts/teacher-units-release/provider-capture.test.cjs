'use strict';
// A3-6 S6c provider capture and replay tests. SYNTHETIC fixtures only: every
// exchange is injected; no credential is read and no provider request is made.
// Passing proves capture and replay behavior, never provider origin.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const PC = require('./provider-capture.cjs');
const R = require('./access-review.cjs');
const E = require('./evidence-package.cjs');
const K = require('../../platform/functions/lib/teacherUnits/a3-canonical.js');
const { SYNTHETIC, buildCapture, http: status } = require('./fixtures/synthetic-capture.cjs');
const { RECEIPT_LOCATION } = require('./fixtures/synthetic-access.cjs');
const F = require('./fixtures/synthetic-package.cjs');

const STAGING = 'lyfelabz-staging';
const ID = 'teacherUnitsGet';
const roots = [];
test.after(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });

async function capture(options = {}, { evidenceClass = 'synthetic', principal, clock, exchange } = {}) {
  const c = await buildCapture(options);
  roots.push(c.hostingRoot);
  if (options.hook) options.hook(c);
  const clk = clock ? clock(c) : c.clock, ex = exchange ? exchange(c) : c.exchange;
  const r = await PC.captureA3Provider({ project: c.project, exchange: ex, clock: clk,
    deploymentPlan: c.deploymentPlan, expected: c.expected, hostingRoot: c.hostingRoot, evidenceClass, principal });
  return { c, r };
}
async function refusedCapture(options, pattern, extra) {
  await assert.rejects(capture(options, extra), error => { assert.match(error.message, /REFUSED/); assert.match(error.message, pattern); return true; });
}
const verify = (c, files, project = c.project) => PC.verifyCapture({ project, files, deploymentPlan: c.deploymentPlan, expected: c.expected, hostingRoot: c.hostingRoot });
async function refusedVerify(c, files, pattern, project) {
  await assert.rejects(verify(c, files, project), error => { assert.match(error.message, /REFUSED/); assert.match(error.message, pattern); return true; });
}
const parse = bytes => JSON.parse(bytes.toString('utf8'));
const canonical = value => Buffer.from(K.canonicalJSON(value), 'utf8');
function editFile(r, key, edit) { const v = parse(r.bytes[key]); edit(v); return { ...r.bytes, [key]: canonical(v) }; }
const reads = t => t.events.map((e, i) => [e, i]).filter(([e]) => e.type === 'read');
const indexOf = (t, predicate) => reads(t).find(([e]) => predicate(e.url))[1];
function reseal(event, edit) {
  const body = JSON.parse(Buffer.from(event.body, 'base64').toString('utf8'));
  edit(body);
  const bytes = Buffer.from(JSON.stringify(body));
  event.body = bytes.toString('base64');
  event.sha256 = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
}
function trapNetwork(run) {
  const calls = [], saved = { fetch: globalThis.fetch, http: http.request, https: https.request, hget: http.get, sget: https.get };
  const trap = name => () => { calls.push(name); throw new Error('network attempted'); };
  globalThis.fetch = trap('fetch'); http.request = trap('http'); https.request = trap('https'); http.get = trap('http.get'); https.get = trap('https.get');
  return Promise.resolve().then(run).finally(() => { Object.assign(globalThis, { fetch: saved.fetch }); http.request = saved.http; https.request = saved.https; http.get = saved.hget; https.get = saved.sget; })
    .then(value => ({ value, calls }));
}

let shared;
const honest = async () => (shared ||= await capture());

test('fixtures are labelled synthetic, never provider-verified', () => {
  assert.equal(SYNTHETIC, 'synthetic, not provider-verified');
  assert.match(fs.readFileSync(path.join(__dirname, 'fixtures/synthetic-capture.cjs'), 'utf8'), /SYNTHETIC FIXTURE - NOT PROVIDER-VERIFIED/);
});

test('one capture runs S4, S5 and S6c in one window and is non-authorizing', async () => {
  const { c, r } = await honest();
  const b = r.bundle;
  assert.equal(b.kind, PC.CAPTURE_KIND);
  for (const [key, value] of Object.entries({ providerVerified: false, releaseAuthorized: false, activationReady: false, accessReviewLevel: 'A-structural',
    levelB: 'not-claimed', evidenceClass: 'synthetic', declaredReceiptProvenance: 'synthetic-fixture', authority: PC.AUTHORITY, attestation: PC.ATTESTATION,
    freshness: PC.FRESHNESS })) assert.deepEqual(b[key], value, key);
  assert.equal(r.receipt.reviewLevel, 'A-structural');
  assert.equal(r.receipt.provenance, 'synthetic-fixture');
  assert.equal(r.observation.endpoints.length, 9);
  assert.equal(b.surfaces.inheritedIam, 'not-observed');
  assert.equal(r.surfaceReport.inheritedIam.status, 'not-observed');
  assert.match(r.surfaceReport.g3, /^open/);
  assert.deepEqual(b.unresolved, [...PC.UNRESOLVED]);
  assert.ok(b.unresolved.includes('G3'));
  assert.throws(() => R.assertProviderCompleteAccessReview(r.receipt), /not provider-complete/, 'level B stays unavailable');
  // The transcript records the plan and expected-access hashes and the explicit target identity.
  assert.equal(r.transcript.deploymentPlanSha256, c.deploymentPlan.object.sha256);
  assert.equal(r.transcript.expectedAccessSha256, c.expected.object.sha256);
  assert.equal(r.transcript.projectId, STAGING);
  assert.equal(b.reads.total, reads(r.transcript).length);
  for (const [e] of reads(r.transcript)) {
    assert.equal(e.method, 'GET');
    assert.ok(PC.ALLOWED_HOSTS.includes(new URL(e.url).hostname));
    assert.equal(e.sha256, require('node:crypto').createHash('sha256').update(Buffer.from(e.body, 'base64')).digest('hex'));
    assert.ok(e.requestedAt <= e.completedAt);
  }
  // Every S4, S5 and S6c read is in the same transcript.
  const urls = reads(r.transcript).map(([e]) => new URL(e.url));
  for (const h of ['firebase.googleapis.com', 'storage.googleapis.com', 'firebasehosting.googleapis.com', 'us-central1-run.googleapis.com', 'compute.googleapis.com']) {
    assert.ok(urls.some(u => u.hostname === h), h);
  }
  assert.ok(urls.some(u => u.pathname.endsWith(':getIamPolicy')));
});

test('honest replay re-derives every file byte for byte, offline', async () => {
  const { c, r } = await honest();
  const { value, calls } = await trapNetwork(() => verify(c, r.bytes));
  assert.deepEqual(calls, []);
  assert.equal(value.verified, 'replay-consistent: re-derived from the transcript bytes only');
  assert.equal(value.providerVerified, false);
  assert.equal(value.releaseAuthorized, false);
  assert.equal(value.freshness, PC.FRESHNESS);
  // Determinism: replaying the same transcript again yields the same result.
  assert.deepEqual(await verify(c, r.bytes), value);
});

test('a completed capture is historical: verification much later still replays, and claims no freshness', async () => {
  const { c, r } = await honest();
  const later = await verify(c, r.bytes);
  assert.match(later.freshness, /^historical/);
  assert.equal(later.activationReady, false);
});

test('edited response bytes refuse, and resealed edits refuse through re-derivation', async () => {
  const { c, r } = await honest();
  const t = parse(r.bytes.transcript);
  const i = indexOf(t, u => u.includes('firebase.googleapis.com'));
  const edited = JSON.parse(JSON.stringify(t));
  edited.events[i].body = Buffer.from('{"projectId":"lyfelabz-prod"}').toString('base64');
  await refusedVerify(c, { ...r.bytes, transcript: canonical(edited) }, /response bytes altered/);
  // Resealed (hash updated) wrong-project identity: the certified S4 observer refuses.
  const resealed = JSON.parse(JSON.stringify(t));
  reseal(resealed.events[i], body => { body.projectNumber = '1'; });
  await refusedVerify(c, { ...r.bytes, transcript: canonical(resealed) }, /wrong-project Firebase identity/);
  // Resealed surface response: replay derives a different surface report.
  const surface = JSON.parse(JSON.stringify(t));
  reseal(surface.events[indexOf(t, u => u.includes('domainmappings'))], body => { body.items = [{ metadata: { name: 'x.example.org' }, spec: { routeName: 'other' } }]; });
  await refusedVerify(c, { ...r.bytes, transcript: canonical(surface) }, /surface-report\.json differs/);
  // Noncanonical Base64 and a noncanonical transcript encoding refuse.
  const pad = JSON.parse(JSON.stringify(t)); pad.events[i].body = `${pad.events[i].body} `;
  await refusedVerify(c, { ...r.bytes, transcript: canonical(pad) }, /not Base64/);
  await refusedVerify(c, { ...r.bytes, transcript: Buffer.from(JSON.stringify(t, null, 1)) }, /not canonical/);
});

test('changed URLs, hosts or methods refuse', async () => {
  const { c, r } = await honest();
  const t = parse(r.bytes.transcript);
  const i = indexOf(t, u => u.includes('firebase.googleapis.com'));
  await refusedVerify(c, editFile(r, 'transcript', x => { x.events[i].url = `${x.events[i].url}?x=1`; }), /request differs/);
  await refusedVerify(c, editFile(r, 'transcript', x => { x.events[i].url = 'https://evil.example.com/v1beta1/projects/lyfelabz-staging'; }), /outside the GET allowlist/);
  await refusedVerify(c, editFile(r, 'transcript', x => { x.events[i].url = 'http://firebase.googleapis.com/v1beta1/projects/lyfelabz-staging'; }), /outside the GET allowlist/);
  await refusedVerify(c, editFile(r, 'transcript', x => { x.events[i].method = 'POST'; }), /method is not GET/);
  await refusedVerify(c, editFile(r, 'transcript', x => { x.events[i].mode = 'binary'; }), /request differs/);
  await refusedVerify(c, editFile(r, 'transcript', x => { x.events[i].status = 403; }), /HTTP 403/);
  await refusedVerify(c, editFile(r, 'transcript', x => { x.events[i].authorization = 'Bearer x'; }), /missing or unknown fields/);
});

test('missing, extra and reordered transcript entries refuse', async () => {
  const { c, r } = await honest();
  const t = parse(r.bytes.transcript);
  const [first, second] = reads(t).map(([, i]) => i);
  await refusedVerify(c, editFile(r, 'transcript', x => { x.events.pop(); }), /missing a response or clock reading/);
  await refusedVerify(c, editFile(r, 'transcript', x => { x.events.splice(second, 1); }), /request differs|reordered/);
  await refusedVerify(c, editFile(r, 'transcript', x => { x.events.push({ type: 'clock', at: x.completedAt }); }), /extra entries/);
  await refusedVerify(c, editFile(r, 'transcript', x => { [x.events[first], x.events[second]] = [x.events[second], x.events[first]]; }), /request differs|reordered|backwards/);
  // A clock reading swapped with a read is a reordering.
  await refusedVerify(c, editFile(r, 'transcript', x => { [x.events[0], x.events[first]] = [x.events[first], x.events[0]]; }), /reordered/);
  await refusedVerify(c, editFile(r, 'transcript', x => { x.events = []; }), /no events/);
  await refusedVerify(c, editFile(r, 'transcript', x => { x.events[0].type = 'note'; }), /unknown type/);
  const files = { ...r.bytes }; delete files.receipt;
  await assert.rejects(verify(c, files), /capture files required exactly/);
});

test('cross-project and cross-environment captures refuse', async () => {
  const { c, r } = await honest();
  await assert.rejects(verify(c, r.bytes, 'lyfelabz-prod'), /REFUSED/);
  await assert.rejects(verify(c, r.bytes, 'demo-a3'), /explicit supported --project/);
  await refusedVerify(c, editFile(r, 'transcript', x => { x.projectId = 'lyfelabz-prod'; }), /cross-project/);
  await refusedVerify(c, editFile(r, 'transcript', x => { x.environment = 'production'; }), /cross-project or cross-environment/);
  await refusedVerify(c, editFile(r, 'transcript', x => { x.projectNumber = '1'; }), /cross-project/);
  // A response from another project during capture refuses in the certified S4 observer.
  await refusedCapture({ drift: s => { s.firebaseProject.projectId = 'lyfelabz-prod'; } }, /wrong-project Firebase identity/);
  // A production capture is not a staging capture.
  const prod = await capture({ project: 'lyfelabz-prod' });
  assert.equal(prod.r.bundle.environment, 'production');
  await assert.rejects(PC.verifyCapture({ project: STAGING, files: prod.r.bytes, deploymentPlan: c.deploymentPlan, expected: c.expected, hostingRoot: c.hostingRoot }), /REFUSED/);
  await assert.rejects(PC.verifyCapture({ project: 'lyfelabz-prod', files: r.bytes, deploymentPlan: prod.c.deploymentPlan, expected: prod.c.expected, hostingRoot: prod.c.hostingRoot }), /cross-project/);
  // The transcript is bound to the plan and expected access it was captured against.
  const other = await buildCapture({ drift: () => {} });
  roots.push(other.hostingRoot);
  const otherExpected = require('./fixtures/synthetic-access.cjs').expectedFor(r.observation, { endpoint: e => { e.customAudiences = ['https://example.invalid']; } });
  await assert.rejects(PC.verifyCapture({ project: STAGING, files: r.bytes, deploymentPlan: c.deploymentPlan, expected: otherExpected, hostingRoot: c.hostingRoot }), /not bound to this deployment plan and expected access/);
});

test('eight-endpoint and inconsistent captures refuse', async () => {
  await refusedCapture({ drift: s => { delete s.endpoints.teacherUnitsCapabilities; } }, /missing or ambiguous Teacher Units endpoint: teacherUnitsCapabilities/);
  const fnUrl = `https://cloudfunctions.googleapis.com/v2/projects/${STAGING}/locations/us-central1/functions/${ID}`;
  await refusedCapture({ hook: c => { c.fixture.onExchange = (url, n) => {
    if (url !== fnUrl || n !== 2) return undefined;
    const fn = JSON.parse(JSON.stringify(c.state.endpoints[ID].fn)); fn.updateTime = '2026-10-16T11:30:00.000Z'; return fn;
  }; } }, /provider state changed during observation/);
});

test('clock manipulation and the five-minute boundary', async () => {
  const BASE = Date.parse('2026-10-16T12:10:00.000Z');
  const jumping = offset => c => {
    let jumped = false, n = 0;
    const inner = c.exchange;
    c.exchange = async url => { if (url.includes('/aggregated/backendServices')) jumped = true; return inner(url); };
    return () => new Date(jumped ? BASE + offset : BASE + n++).toISOString();
  };
  const exchangeOf = c => c.exchange;
  // Exactly five minutes after the capture start is inside the window; one millisecond more is not.
  const inside = await capture({}, { clock: jumping(300000), exchange: exchangeOf });
  assert.equal(inside.r.bundle.window.completedAt, new Date(BASE + 300000).toISOString());
  await verify(inside.c, inside.r.bytes);
  await refusedCapture({}, /five-minute observation limit/, { clock: jumping(300001), exchange: exchangeOf });
  // Backwards and malformed clocks refuse.
  await refusedCapture({}, /moved backwards/, { clock: () => { let n = 0; return () => new Date(BASE + (n++ === 5 ? -1000 : n)).toISOString(); } });
  await refusedCapture({}, /capture clock|capture start|REFUSED/, { clock: () => () => '2026-10-16 12:10:00' });
  await refusedCapture({}, /REFUSED/, { clock: () => { let n = 0; return () => (n++ > 3 ? '2026-02-30T00:00:00.000Z' : new Date(BASE + n).toISOString()); } });
  // Transcript clock edits refuse.
  const { c, r } = await honest();
  await refusedVerify(c, editFile(r, 'transcript', x => { x.completedAt = new Date(Date.parse(x.startedAt) + 300001).toISOString(); }), /five-minute/);
  await refusedVerify(c, editFile(r, 'transcript', x => { x.events[3].at = x.startedAt.replace('12:10', '12:09'); }), /backwards|unexpected/);
  const t = parse(r.bytes.transcript), i = reads(t)[4][1];
  await refusedVerify(c, editFile(r, 'transcript', x => { x.events[i].completedAt = x.startedAt; }), /backwards/);
  await refusedVerify(c, editFile(r, 'transcript', x => { x.events[i].requestedAt = 'yesterday'; }), /REFUSED/);
  await refusedVerify(c, editFile(r, 'transcript', x => { x.startedAt = new Date(Date.parse(x.startedAt) - 1).toISOString(); }), /differs/);
});

test('synthetic evidence relabelled as live refuses; a consistent relabel never exceeds unattested', async () => {
  const { c, r } = await honest();
  await refusedVerify(c, editFile(r, 'transcript', x => { x.evidenceClass = 'operator-captured-unattested'; }), /receipt\.json differs/);
  await refusedVerify(c, editFile(r, 'transcript', x => { x.evidenceClass = 'provider-verified'; }), /evidence class unsupported/);
  await refusedVerify(c, editFile(r, 'bundle', x => { x.evidenceClass = 'operator-captured-unattested'; }), /capture\.json differs/);
  await refusedVerify(c, editFile(r, 'receipt', x => { x.provenance = 'provider-get'; }), /receipt\.json differs/);
  await refusedVerify(c, editFile(r, 'transcript', x => { x.attestation = 'provider-attested'; }), /authority or attestation literal/);
  // A synthetic exchange captured under the live class is still only unattested and never provider-verified.
  const live = await capture({}, { evidenceClass: 'operator-captured-unattested' });
  assert.equal(live.r.bundle.evidenceClass, 'operator-captured-unattested');
  assert.equal(live.r.bundle.providerVerified, false);
  assert.equal(live.r.receipt.provenance, 'provider-get');
  await verify(live.c, live.r.bytes);
  await assert.rejects(PC.captureA3Provider({ project: STAGING, exchange: c.exchange, clock: c.clock, deploymentPlan: c.deploymentPlan, expected: c.expected,
    hostingRoot: c.hostingRoot, evidenceClass: 'provider-verified' }), /explicit evidence class required/);
});

test('forged readiness, level B, authorization and surface claims refuse even when re-encoded', async () => {
  const { c, r } = await honest();
  for (const [key, value] of [['providerVerified', true], ['releaseAuthorized', true], ['activationReady', true], ['accessReviewLevel', 'B-provider-complete'],
    ['levelB', 'complete'], ['g3', 'resolved'], ['freshness', 'fresh'], ['unresolved', []], ['authority', 'approved']]) {
    await refusedVerify(c, editFile(r, 'bundle', x => { x[key] = value; }), /capture\.json differs/);
  }
  await refusedVerify(c, editFile(r, 'bundle', x => { x.surfaces.inheritedIam = 'observed-absent'; }), /capture\.json differs/);
  await refusedVerify(c, editFile(r, 'surfaceReport', x => { x.inheritedIam = { status: 'observed-absent', reason: 'none' }; }), /surface-report\.json differs/);
  await refusedVerify(c, editFile(r, 'surfaceReport', x => { x.levelB = 'complete'; }), /surface-report\.json differs/);
  await refusedVerify(c, editFile(r, 'receipt', x => { x.reviewLevel = 'B'; x.providerComplete = true; }), /receipt\.json differs/);
  await refusedVerify(c, editFile(r, 'observation', x => { x.endpoints.pop(); }), /observation\.json differs/);
  await refusedVerify(c, editFile(r, 'bundle', x => { x.files.receipt.sha256 = 'f'.repeat(64); }), /capture\.json differs/);
});

test('unreadable IAM refuses the capture (S5); a failed read never falls back', async () => {
  await refusedCapture({ hook: c => { c.fixture.onExchange = url => (url.endsWith(`${ID.toLowerCase()}:getIamPolicy?options.requestedPolicyVersion=3`) ? status(403) : undefined); } }, /HTTP 403/);
  await refusedCapture({ hook: c => { c.fixture.onExchange = url => (url.includes('firebaserules') ? status(404) : undefined); } }, /HTTP 404/);
  await refusedCapture({}, /provider read failed/, { exchange: c => async url => { if (url.includes('firestore.googleapis.com')) throw new Error('ECONNRESET'); return c.exchange(url); } });
  await refusedCapture({}, /malformed exchange result/, { exchange: () => async () => ({ status: 200, bytes: 'not a buffer' }) });
});

test('principal is an operator declaration, never verification', async () => {
  const { r } = await capture({}, { principal: 'operator@example.org' });
  assert.deepEqual(r.bundle.principal, { status: 'operator-declared-unverified', value: 'operator@example.org' });
  await refusedCapture({}, /--principal/, { principal: 'Operator <x>' });
  const { c, r: plain } = await honest();
  assert.deepEqual(plain.bundle.principal, { status: 'not-recorded' });
  await refusedVerify(c, editFile(plain, 'transcript', x => { x.principal = { status: 'provider-verified', value: 'a@b.org' }; }), /principal is malformed/);
});

test('live exchange: GET only, allowlisted hosts, redirects refused, no credential leakage', async () => {
  const TOKEN = 'ya29.SYNTHETIC-SECRET-TOKEN-0123456789';
  const seen = [];
  const { c, r } = await capture({}, { evidenceClass: 'operator-captured-unattested', exchange: c => PC.createLiveExchange({ token: TOKEN, fetchImpl: async (url, init) => {
    seen.push({ url, init });
    const { status: code, bytes } = await c.exchange(url);
    return new Response(bytes, { status: code });
  } }) });
  assert.ok(seen.length > 100);
  for (const { init } of seen) {
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(init.body, undefined);
  }
  for (const [key, bytes] of Object.entries(r.bytes)) {
    assert.equal(bytes.includes(TOKEN), false, `${key} leaks the token`);
    assert.equal(bytes.includes(Buffer.from(TOKEN).toString('base64')), false, `${key} leaks the encoded token`);
    assert.equal(/"authorization"|bearer/i.test(bytes.toString('utf8').replace(/"body":"[^"]*"/g, '')), false, `${key} records a header`);
  }
  await verify(c, r.bytes);

  const respond = response => PC.createLiveExchange({ token: TOKEN, fetchImpl: async () => response });
  const url = `https://firebase.googleapis.com/v1beta1/projects/${STAGING}`;
  const failed = async (exchange, pattern, target = url) => {
    await assert.rejects(exchange(target, 1024), e => { assert.match(e.message, pattern); assert.equal(e.message.includes(TOKEN), false); return true; });
  };
  await failed(respond(new Response('{}', { status: 302, headers: { location: 'https://evil.example.com/' } })), /redirect refused/);
  const redirected = new Response('{}', { status: 200 }); Object.defineProperty(redirected, 'redirected', { value: true });
  await failed(respond(redirected), /redirect refused/);
  const moved = new Response('{}', { status: 200 }); Object.defineProperty(moved, 'url', { value: 'https://compute.googleapis.com/other' });
  await failed(respond(moved), /response URL differs/);
  await failed(PC.createLiveExchange({ token: TOKEN, fetchImpl: async () => { throw new TypeError('redirect mode is set to error'); } }), /unavailable or redirected/);
  await failed(respond(new Response('x'.repeat(2048), { status: 200 })), /oversized/);
  for (const bad of ['https://evil.example.com/x', 'http://firebase.googleapis.com/x', 'https://firebase.googleapis.com:8443/x', 'https://u:p@firebase.googleapis.com/x',
    'https://storage.googleapis.com.evil.example/x', `https://run.googleapis.com/v2/projects/${STAGING}/locations/us-central1/services/x:setIamPolicy`, 'not a url']) {
    let fetched = false;
    await failed(PC.createLiveExchange({ token: TOKEN, fetchImpl: async () => { fetched = true; return new Response('{}'); } }), /allowlist|malformed request URL|custom method/, bad);
    assert.equal(fetched, false, `${bad} must be refused before any request`);
  }
  assert.throws(() => PC.createLiveExchange({ token: 'has space' }), /invalid access token/);
  assert.throws(() => PC.createLiveExchange({}), /invalid access token/);
});

test('the capture feeds S6b unchanged and stays non-authorizing there', async () => {
  for (const evidenceClass of ['synthetic', 'operator-captured-unattested']) {
    const { c, r } = await capture({}, { evidenceClass });
    const candidate = { sourceSha: '1'.repeat(40), sourceTree: '2'.repeat(40), ...c.deploymentPlan.plan.candidate, enforcementVersion: 'teacher-units-a3-v1',
      clientContractVersion: 'teacher-units-v2', deploymentMode: 'policy-controlled', deploymentPlan: c.deploymentPlan.object };
    const deployment = F.signed('deployment-approval', { candidate }, null, STAGING, F.ISSUED);
    const assembled = E.assembleEvidencePackage({ project: STAGING, plan: { object: c.deploymentPlan.object, bytes: c.deploymentPlan.bytes },
      expected: { object: c.expected.object, bytes: c.expected.bytes }, observation: r.observation,
      receipt: { object: R.receiptContentObject(r.bytes.receipt, RECEIPT_LOCATION), bytes: r.bytes.receipt },
      deploymentApproval: { document: deployment.document, statementBytes: deployment.statementBytes }, hostingRoot: c.hostingRoot,
      assembledAt: new Date(Date.parse(r.bundle.window.completedAt) + 1000).toISOString() });
    assert.equal(assembled.package.evidenceClass, evidenceClass === 'synthetic' ? 'synthetic' : 'operator-supplied-unverified');
    assert.equal(assembled.package.providerVerified, false);
    assert.equal(assembled.package.releaseAuthorized, false);
  }
});

test('observe plan is offline and reads no credentials', async () => {
  const { value, calls } = await trapNetwork(() => PC.capturePlan(STAGING));
  assert.deepEqual(calls, []);
  assert.equal(value.method, 'GET only');
  assert.ok(value.s6c.some(s => s.surface === 'inheritedIam' && s.status === 'not-observed'));
  assert.throws(() => PC.capturePlan('demo-x'), /explicit supported --project/);
});

test('static: S6c modules hold no write verbs, never read the alias file or load fixtures', () => {
  const codeOnly = file => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const file of ['provider-capture.cjs', 'surface-observation.cjs']) {
    const code = codeOnly(file);
    for (const pattern of [/firebaserc/i, /fixtures\//, /method:\s*['"](?!GET)/, /['"](?:POST|PUT|PATCH|DELETE)['"]/, /setIamPolicy|:set[A-Z]|:delete|:create/,
      /generateKeyPair|createPrivateKey|\bsign\(|kms/i, /\.(?:set|update|delete|create)\(\s*db|firestore\(\)/i]) {
      assert.equal(pattern.test(code), false, `${file} matches ${pattern}`);
    }
  }
  // Exactly one network entry point, in the live exchange.
  assert.equal((codeOnly('provider-capture.cjs').match(/fetchImpl\(/g) || []).length, 1);
  assert.equal(/fetch|https?\.request/.test(codeOnly('surface-observation.cjs').replace(/https:\/\/[^`'"]+/g, '')), false);
});

// --- certification correction F3: local preflight before any provider access ---
test('F3: missing, unreadable or malformed local Hosting configuration refuses with zero reads and zero clock readings', async () => {
  const c = await buildCapture();
  roots.push(c.hostingRoot);
  const os = require('node:os');
  const scratchRoot = files => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lyfelabz-s6c-f3-')); roots.push(d); files(d); return d; };
  const cases = [
    [scratchRoot(() => {}), /firebase\.staging\.json unreadable/],
    [path.join(c.hostingRoot, 'does-not-exist'), /unreadable/],
    [scratchRoot(d => fs.mkdirSync(path.join(d, 'firebase.staging.json'))), /unreadable/],
    [scratchRoot(d => fs.writeFileSync(path.join(d, 'firebase.staging.json'), '{not json')), /not strict JSON/],
    [scratchRoot(d => fs.writeFileSync(path.join(d, 'firebase.staging.json'), JSON.stringify({ hosting: { rewrites: [{ source: '/api', function: 'teacherUnitsGet' }] } }))), /REFUSED/],
    [scratchRoot(d => fs.writeFileSync(path.join(d, 'firebase.staging.json'), JSON.stringify({ hosting: { rewrites: 'x' } }))), /rewrites malformed/],
  ];
  for (const [hostingRoot, pattern] of cases) {
    let reads = 0, clocks = 0;
    await assert.rejects(PC.captureA3Provider({ project: STAGING, exchange: async url => { reads++; return c.exchange(url); }, clock: () => { clocks++; return c.clock(); },
      deploymentPlan: c.deploymentPlan, expected: c.expected, hostingRoot, evidenceClass: 'synthetic' }), pattern);
    assert.equal(reads, 0, `${hostingRoot}: no provider read`);
    assert.equal(clocks, 0, `${hostingRoot}: the capture never started`);
  }
  // Every other local prerequisite also refuses before any read.
  const bad = [
    { deploymentPlan: { ...c.deploymentPlan, bytes: Buffer.concat([c.deploymentPlan.bytes, Buffer.from(' ')]) } },
    { expected: { ...c.expected, object: { ...c.expected.object, sha256: 'f'.repeat(64) } } },
    { project: 'demo-a3' }, { project: undefined }, { principal: 'NOT AN EMAIL' }, { evidenceClass: 'provider-verified' },
  ];
  for (const override of bad) {
    let reads = 0;
    await assert.rejects(PC.captureA3Provider({ project: STAGING, exchange: async url => { reads++; return c.exchange(url); }, clock: c.clock,
      deploymentPlan: c.deploymentPlan, expected: c.expected, hostingRoot: c.hostingRoot, evidenceClass: 'synthetic', ...override }), /REFUSED/);
    assert.equal(reads, 0, JSON.stringify(Object.keys(override)));
  }
  // Valid inputs still complete an honest capture and replay.
  const good = await PC.captureA3Provider({ project: STAGING, exchange: c.exchange, clock: c.clock, deploymentPlan: c.deploymentPlan, expected: c.expected,
    hostingRoot: c.hostingRoot, evidenceClass: 'synthetic' });
  await verify(c, good.bytes);
});
