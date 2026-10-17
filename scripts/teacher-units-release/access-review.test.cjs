'use strict';
// A3-6 S5 IAM and route review tests. SYNTHETIC fixtures only; no real provider
// request is made. Passing proves fixture correctness (level A), never
// live-provider completeness (level B) or release authorization (level C).
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const A1 = require('../hosting-release/backend-state.cjs');
const O = require('./provider-observation.cjs');
const R = require('./access-review.cjs');
const K = require('../../platform/functions/lib/teacherUnits/a3-canonical.js');
const V = require('../../platform/functions/lib/teacherUnits/a3-validation.js');
const { templateOf, planFor } = require('./fixtures/synthetic-provider.cjs');
const { SYNTHETIC, RECEIPT_LOCATION, buildAccess, expectedFor, hostingRoot, urlsFor } = require('./fixtures/synthetic-access.cjs');

const STAGING = 'lyfelabz-staging';
const ID = 'teacherUnitsGet';
const run = id => id.toLowerCase();
const SERVICE_URL = `https://run.googleapis.com/v2/projects/${STAGING}/locations/us-central1/services/${run(ID)}`;
const FUNCTION_URL = `https://cloudfunctions.googleapis.com/v2/projects/${STAGING}/locations/us-central1/functions/${ID}`;
const TOTAL_READS = 9 * R.READS_PER_ENDPOINT * 2;

async function review(options = {}) {
  const a = await buildAccess(options);
  const expected = options.expected ? options.expected(a.observation) : expectedFor(a.observation, options.plan);
  const result = await R.reviewA3Access({ project: options.target || STAGING, get: a.get, observation: options.observation ? options.observation(a.observation) : a.observation,
    deploymentPlan: a.deploymentPlan, expected, provenance: options.provenance || 'synthetic-fixture', hostingRoot: options.hostingRoot, now: options.now || a.now });
  return { a, expected, ...result };
}
async function refused(options, pattern) {
  await assert.rejects(review(options), error => { assert.match(error.message, /REFUSED/); assert.match(error.message, pattern); return true; });
}
const access = fn => ({ mutateAccess: a => fn(a.policies[ID], a) });
const provider = fn => ({ mutate: s => fn(s.endpoints[ID], s) });
// Persistent drift: S4 state edited after the S4 observation completed.
const drift = fn => ({ mutateAccess: (_a, state) => fn(state.endpoints[ID], state) });
// The Cloud Run service response replaced on every S5 read.
const serveService = edit => ({ mutateAccess: a => { a.onAccessGet = (url, _c, _a, state) => {
  if (url !== SERVICE_URL) return undefined;
  const e = state.endpoints[ID];
  const s = JSON.parse(JSON.stringify({ ...e.service, template: e.service.template ?? templateOf(e.revision) })); edit(s); return s;
}; } });
function reseal(receipt) {
  const bytes = Buffer.from(K.canonicalJSON(receipt), 'utf8');
  return { bytes, object: R.receiptContentObject(bytes, RECEIPT_LOCATION) };
}
async function verified() {
  const r = await review();
  const object = R.receiptContentObject(r.bytes, RECEIPT_LOCATION);
  const context = { project: STAGING, observation: r.a.observation, deploymentPlan: r.a.deploymentPlan, expected: r.expected, now: r.a.now() };
  return { ...r, object, context };
}
function forge(receipt, edit) { const r = JSON.parse(JSON.stringify(receipt)); edit(r, r.endpoints.find(e => e.endpointName === ID)); return reseal(r); }

test('fixtures are labelled synthetic, never provider-verified', () => {
  assert.equal(SYNTHETIC, 'synthetic, not provider-verified');
  assert.match(fs.readFileSync(path.join(__dirname, 'fixtures/synthetic-access.cjs'), 'utf8'), /SYNTHETIC FIXTURE - NOT PROVIDER-VERIFIED/);
});

test('valid review is level A only: nine endpoints, unresolved inheritance and live routes', async () => {
  const { receipt, a } = await review();
  assert.equal(receipt.kind, R.RECEIPT_KIND);
  assert.equal(receipt.reviewLevel, 'A-structural');
  assert.equal(receipt.providerComplete, false);
  assert.equal(receipt.releaseAuthorized, false);
  assert.equal(receipt.provenance, 'synthetic-fixture');
  assert.equal(receipt.deploymentPlanSha256, a.deploymentPlan.object.sha256);
  assert.deepEqual(receipt.endpoints.map(e => e.endpointName), [...V.ENDPOINTS]);
  assert.ok(receipt.endpoints.some(e => e.endpointName === 'teacherUnitsCapabilities'));
  assert.equal(receipt.inheritedIam.status, 'unresolved');
  for (const key of ['hostingReleases', 'domainMappings', 'loadBalancerBackends']) assert.equal(receipt.routes[key].status, 'unresolved');
  assert.deepEqual(receipt.routes.localHostingConfig, { status: 'checked-local-only', path: 'firebase.staging.json',
    sha256: K.sha256Bytes(fs.readFileSync(path.join(__dirname, '../../firebase.staging.json'))) });
  const e = receipt.endpoints.find(x => x.endpointName === ID), u = urlsFor(STAGING, ID);
  assert.equal(e.servicePolicy.resource, `projects/${STAGING}/locations/us-central1/services/${run(ID)}`);
  assert.equal(e.functionPolicy.resource, `projects/${STAGING}/locations/us-central1/functions/${ID}`);
  assert.equal(e.servicePolicy.sha256, K.contentDigest(e.servicePolicy.policy));
  assert.deepEqual(e.access, { invokerIamDisabled: false, defaultUriDisabled: false, iapEnabled: false, customAudiences: [] });
  assert.deepEqual(e.defaultUrls, { functionUrl: u.functionUrl, serviceUris: [u.deterministic, u.legacy].sort() });
  assert.equal(e.runtimeServiceAccountEmail, `${A1.PROJECT_NUMBERS[STAGING]}-compute@developer.gserviceaccount.com`);
});

test('composition yields A3-1 endpoints that pass validateEndpoint, still level A', async () => {
  const { object, bytes, context } = await verified();
  const composed = R.composeEndpoints(object, bytes, context);
  assert.equal(composed.endpoints.length, 9);
  assert.equal(composed.providerComplete, false);
  assert.equal(composed.releaseAuthorized, false);
  for (const endpoint of composed.endpoints) {
    assert.equal(V.validateEndpoint(endpoint).ok, true);
    assert.deepEqual(endpoint.invocation.accessReviewReceipt, object);
    assert.deepEqual(endpoint.invocation.serviceAllowPolicy.bindings, [{ role: 'roles/run.invoker', members: ['allUsers'], condition: null }]);
  }
});

// --- F1: level B always refuses ---------------------------------------------
test('F1: level B refuses legitimate level A output', async () => {
  const { object, bytes, context } = await verified();
  const result = R.assertAccessReview(object, bytes, context);
  assert.deepEqual([...result.unresolved], ['inheritedIam', 'routes.hostingReleases', 'routes.domainMappings', 'routes.loadBalancerBackends']);
  assert.throws(() => R.assertProviderCompleteAccessReview(result), /not provider-complete \(G3 open\)/);
  const declared = await review({ provenance: 'provider-get' });
  const o = R.receiptContentObject(declared.bytes, RECEIPT_LOCATION);
  const r = R.assertAccessReview(o, declared.bytes, { ...context, observation: declared.a.observation, deploymentPlan: declared.a.deploymentPlan, expected: declared.expected, now: declared.a.now() });
  assert.throws(() => R.assertProviderCompleteAccessReview(r), /not provider-complete/);
  await refused({ provenance: 'provider-verified' }, /explicit provenance required/);
});

test('F1: level B refuses a forged complete object and direct unvalidated calls', () => {
  const observed = { status: 'observed', reason: 'forged' };
  const forged = { reviewLevel: 'B-provider-complete', providerComplete: true, releaseAuthorized: true, unresolved: [],
    receipt: { provenance: 'provider-get', providerComplete: true, inheritedIam: observed,
      routes: { hostingReleases: observed, domainMappings: observed, loadBalancerBackends: observed } } };
  for (const input of [forged, forged.receipt, {}, null, undefined, true, { providerComplete: true }]) {
    assert.throws(() => R.assertProviderCompleteAccessReview(input), /not provider-complete \(G3 open\)/);
  }
  assert.throws(() => R.assertProviderCompleteAccessReview(), /not provider-complete/);
});

test('F1: level B refuses resealed forgeries and mutation after assertAccessReview', async () => {
  const { receipt, object, bytes, context } = await verified();
  for (const edit of [r => { r.inheritedIam = { status: 'observed', reason: 'none' }; }, r => { r.routes.hostingReleases.status = 'observed'; },
    r => { r.routes.domainMappings.status = 'observed'; }, r => { r.routes.loadBalancerBackends.status = 'observed'; },
    r => { r.providerComplete = true; r.provenance = 'provider-get'; }, r => { r.releaseAuthorized = true; }, r => { r.reviewLevel = 'B-provider-complete'; }]) {
    const f = forge(receipt, edit);
    assert.throws(() => R.assertAccessReview(f.object, f.bytes, context), /access review receipt invalid/);
    const parsed = JSON.parse(f.bytes.toString('utf8'));
    assert.throws(() => R.assertProviderCompleteAccessReview({ providerComplete: true, receipt: parsed, unresolved: [] }), /not provider-complete/);
  }
  const result = R.assertAccessReview(object, bytes, context);
  assert.ok(Object.isFrozen(result));
  // The inner receipt is caller data: editing it never helps.
  result.receipt.providerComplete = true; result.receipt.provenance = 'provider-get';
  result.receipt.inheritedIam.status = 'observed';
  for (const key of ['hostingReleases', 'domainMappings', 'loadBalancerBackends']) result.receipt.routes[key].status = 'observed';
  assert.throws(() => R.assertProviderCompleteAccessReview(result), /not provider-complete/);
  assert.throws(() => R.assertProviderCompleteAccessReview({ ...result, providerComplete: true, unresolved: [] }), /not provider-complete/);
});

// --- IAM posture -------------------------------------------------------------
test('public Cloud Run access despite a restrictive Functions policy', async () => {
  await refused(access(p => { p.service.bindings.push({ role: 'roles/run.developer', members: ['allUsers'] }); }), /grants roles\/run.developer to allUsers/);
  await refused(access(p => { p.service.bindings[0].members.push(`user:outsider@example.com`); }), /exactly the explicit roles\/run.invoker grant to allUsers/);
  await refused(access(p => { p.service.bindings = []; }), /exactly the explicit roles\/run.invoker grant to allUsers/);
});

test('invokerIamDisabled true is refused even with a correct IAM grant', async () => {
  await refused(provider(e => { e.service.invokerIamDisabled = true; }), /Cloud Run invoker IAM check is disabled \(invokerIamDisabled\)/);
  await refused({ plan: { endpoint: e => { e.invokerIamDisabled = true; } } }, /expected-access plan invalid/);
});

test('unexpected invoker and Functions bindings are refused against the expected contract', async () => {
  await refused(access(p => { p.function.bindings = [{ role: 'roles/cloudfunctions.invoker', members: ['allUsers'] }]; }), /functionAllowPolicy/);
  await refused(access(p => { p.service.bindings.push({ role: 'roles/run.viewer', members: [`serviceAccount:ops@${STAGING}.iam.gserviceaccount.com`] }); }), /serviceAllowPolicy/);
  await refused(access(p => { p.service.bindings.push({ role: 'roles/run.admin', members: ['allUsers'] }); }), /grants roles\/run.admin to allUsers/);
  await refused(access(p => { p.function.bindings = [{ role: 'roles/cloudfunctions.admin', members: ['allUsers'] }]; }), /grants roles\/cloudfunctions.admin to allUsers/);
  const fnGrant = { role: 'roles/cloudfunctions.invoker', members: ['allUsers'] };
  const { receipt } = await review({ mutateAccess: a => { for (const id of O.ENDPOINTS) a.policies[id].function.bindings = [fnGrant]; },
    plan: { endpoint: e => { e.functionAllowPolicy = { version: 1, bindings: [{ ...fnGrant, condition: null }] }; } } });
  assert.deepEqual(receipt.endpoints[0].functionPolicy.policy.bindings, [{ ...fnGrant, condition: null }]);
  await refused({ plan: { endpoint: e => { e.serviceAllowPolicy.bindings[0].members = ['allAuthenticatedUsers']; } } }, /cannot be evaluated safely|allUsers/);
});

test('malformed IAM policies refuse', async () => {
  const cases = [
    [p => { p.service = null; }, /policy missing or not an object/],
    [p => { p.service = []; }, /policy missing or not an object/],
    [p => { delete p.service.etag; }, /etag missing or not canonical Base64/],
    [p => { p.service.etag = 'not base64!'; }, /etag missing or not canonical Base64/],
    [p => { p.service.version = 2; }, /unsupported policy version/],
    [p => { p.service.unknownField = true; }, /unknown provider field: unknownField/],
    [p => { p.service.auditConfigs = [{ service: 'allServices' }]; }, /auditConfigs present/],
    [p => { p.service.bindings = {}; }, /bindings must be an array/],
    [p => { p.service.bindings[0].role = 'run.invoker'; }, /role missing or malformed/],
    [p => { p.service.bindings[0].members = []; }, /no members/],
    [p => { p.service.bindings[0].members = ['allUsers', 'allUsers']; }, /duplicates/],
    [p => { p.service.bindings[0].extra = 1; }, /unknown provider field: extra/],
    [p => { p.service.bindings.push({ role: 'roles/run.invoker', members: ['allUsers'] }); }, /duplicates role/],
    [p => { p.function.bindings = [{ role: 'roles/viewer', members: ['user:Mixed@Example.com'] }]; }, /cannot be evaluated safely/],
  ];
  for (const [edit, pattern] of cases) await refused(access(edit), pattern);
});

// --- F5: canonical Base64 etags ----------------------------------------------
test('F5: malformed or noncanonical Base64 etags refuse; valid provider etags pass', async () => {
  for (const bad of ['a', 'abc==', 'YQ', 'YR==', 'ab=c', '====', '', 'YQ==\n', 'Y-Q_', 'YQ=', 'YWJj====']) {
    assert.throws(() => R.normalizePolicy({ etag: bad }, STAGING, 'policy'), /etag missing or not canonical Base64/, JSON.stringify(bad));
  }
  for (const good of ['ACAB', 'BwXhqDt5f2E=', 'YQ==', 'YWI=', Buffer.from([0xff, 0xfe, 0xfd, 0xfc]).toString('base64')]) {
    assert.equal(R.normalizePolicy({ etag: good }, STAGING, 'policy').etag, good);
  }
  await refused(access(p => { p.service.etag = 'a'; }), /etag missing or not canonical Base64/);
  await refused(access(p => { p.function.etag = 'abc=='; }), /etag missing or not canonical Base64/);
  // Validity is never equality: two valid etags between passes still refuse.
  await refused({ mutateAccess: a => { a.onAccessGet = (url, count, x) => (url === `${SERVICE_URL}:getIamPolicy?options.requestedPolicyVersion=3` && count === 2 ? { ...x.policies[ID].service, etag: 'ACAB' } : undefined); } },
    /changed during the review: teacherUnitsGet/);
  const { receipt, context } = await verified();
  const f = forge(receipt, (_r, e) => { e.servicePolicy.etag = 'abc=='; });
  assert.throws(() => R.assertAccessReview(f.object, f.bytes, context), /canonical Base64 etag required/);
});

test('conditional bindings cannot be evaluated and refuse', async () => {
  const condition = { expression: "request.time < timestamp('2027-01-01T00:00:00Z')", title: 'temporary' };
  await refused(access(p => { p.service.version = 3; p.service.bindings[0].condition = condition; }), /IAM condition; conditional bindings cannot be evaluated safely/);
  await refused(access(p => { p.function.version = 3; p.function.bindings = [{ role: 'roles/viewer', members: [`user:a@example.com`], condition }]; }), /conditional bindings/);
  await refused({ plan: { endpoint: e => { e.serviceAllowPolicy = { version: 3, bindings: [{ role: 'roles/run.invoker', members: ['allUsers'], condition: { ...condition, description: '' } }] }; } } },
    /expected-access plan invalid/);
});

test('unevaluable and cross-project principals refuse', async () => {
  const add = m => access(p => { p.service.bindings.push({ role: 'roles/run.viewer', members: [m] }); });
  for (const m of ['group:ops@example.com', 'domain:example.com', 'allAuthenticatedUsers', 'deleted:user:a@example.com?uid=1',
    'principalSet://iam.googleapis.com/locations/global/workforcePools/p/*', 'projectOwner:lyfelabz-staging', 'serviceAccount:not-an-email']) {
    await refused(add(m), /cannot be evaluated safely/);
  }
  for (const m of ['serviceAccount:ci@other-project.iam.gserviceaccount.com', 'serviceAccount:1-compute@developer.gserviceaccount.com',
    `serviceAccount:${A1.PROJECT_NUMBERS['lyfelabz-prod']}-compute@developer.gserviceaccount.com`, 'serviceAccount:service-1@gcf-admin-robot.iam.gserviceaccount.com',
    'serviceAccount:lyfelabz-prod@appspot.gserviceaccount.com']) {
    await refused(add(m), /cross-project service account/);
  }
});

test('changing policy etags or content during the review refuse', async () => {
  const policyUrl = host => `${host === 'run' ? SERVICE_URL : FUNCTION_URL}:getIamPolicy?options.requestedPolicyVersion=3`;
  const second = (host, edit) => ({ mutateAccess: a => { a.onAccessGet = (url, count, x) => {
    if (url !== policyUrl(host) || count !== 2) return undefined;
    const copy = JSON.parse(JSON.stringify(host === 'run' ? x.policies[ID].service : x.policies[ID].function)); edit(copy); return copy;
  }; } });
  await refused(second('run', p => { p.etag = Buffer.from('changed').toString('base64'); }), /changed during the review: teacherUnitsGet/);
  await refused(second('run', p => { p.bindings[0].members = ['allUsers', 'user:x@example.com']; }), /changed during the review/);
  await refused(second('fn', p => { p.etag = Buffer.from('other').toString('base64'); }), /changed during the review/);
  await refused({ mutateAccess: a => { a.onAccessGet = (url, count, _a, state) => (url === SERVICE_URL && count === 2 ? { ...state.endpoints[ID].service, iapEnabled: true } : undefined); } },
    /changed during the review/);
});

test('unreadable policies or missing permission refuse', async () => {
  await refused({ mutateAccess: a => { a.onAccessGet = url => { if (url.endsWith(':getIamPolicy?options.requestedPolicyVersion=3')) throw new Error('[backend-state] REFUSED release readiness: deployment API run.googleapis.com HTTP 403 (credentials or read permission missing)'); }; } },
    /HTTP 403 \(credentials or read permission missing\)/);
  await refused({ mutateAccess: a => { a.onAccessGet = url => (url.includes(':getIamPolicy') ? null : undefined); } }, /policy missing or not an object/);
});

test('IAP enabled, unexpected custom audiences and default URI posture', async () => {
  await refused(provider(e => { e.service.iapEnabled = true; }), /IAP is enabled/);
  await refused({ plan: { endpoint: e => { e.iapEnabled = true; } } }, /expected-access plan invalid/);
  await refused(provider(e => { e.service.customAudiences = ['https://audience.example']; }), /customAudiences/);
  await refused(provider(e => { e.service.defaultUriDisabled = true; }), /defaultUriDisabled/);
  await refused({ plan: { endpoint: e => { if (e.endpointName === ID) e.customAudiences = ['https://audience.example']; } } }, /customAudiences/);
});

test('wrong runtime identity or ingress refuse', async () => {
  await refused({ plan: { endpoint: e => { if (e.endpointName === ID) e.runtimeServiceAccountEmail = `teacher-units@${STAGING}.iam.gserviceaccount.com`; } } }, /runtimeServiceAccountEmail/);
  await refused({ plan: { endpoint: e => { if (e.endpointName === ID) e.ingress = 'internal'; } } }, /ingress/);
  // Observed ingress that matches the expected plan but not the S4 observation still refuses.
  await refused({ plan: { endpoint: e => { if (e.endpointName === ID) e.ingress = 'internal'; } }, ...serveService(s => { s.ingress = 'INGRESS_TRAFFIC_INTERNAL_ONLY'; }) },
    /teacherUnitsGet current Function or Cloud Run configuration differs from the S4 observation/);
});

test('missing endpoint, eight-endpoint substitution and incomplete plans refuse', async () => {
  await refused({ observation: o => ({ ...o, endpoints: o.endpoints.filter(e => e.configuration.endpointName !== 'teacherUnitsCapabilities') }) }, /nine sorted A3 endpoints/);
  await refused({ expected: o => { const x = expectedFor(o); x.plan.endpoints = x.plan.endpoints.slice(1);
    const bytes = Buffer.from(K.canonicalJSON(x.plan), 'utf8'); return { plan: x.plan, bytes, object: { ...x.object, sha256: K.sha256Bytes(bytes) } }; } }, /nine sorted A3 endpoints/);
  await refused({ observation: () => ({ kind: 'lyfelabz.backendObservation', schemaVersion: 1, project: STAGING, functions: [] }) }, /not an A3 provider observation/);
  await refused({ mutateAccess: a => { a.onAccessGet = url => { if (url.includes('teacherUnitsCapabilities:getIamPolicy')) throw new Error('synthetic 404'); }; } }, /provider read failed: cloudfunctions.googleapis.com/);
});

test('cross-project and cross-environment substitution refuse', async () => {
  await refused({ target: 'lyfelabz-prod' }, /wrong-project or wrong-environment/);
  await refused({ plan: { top: { projectId: 'lyfelabz-prod' } } }, /wrong-project or wrong-environment identity/);
  await refused({ plan: { top: { environment: 'production' } } }, /wrong-project or wrong-environment identity/);
  await refused({ plan: { top: { projectNumber: A1.PROJECT_NUMBERS['lyfelabz-prod'] } } }, /wrong-project or wrong-environment identity/);
  await refused(serveService(s => { s.name = `projects/lyfelabz-prod/locations/us-central1/services/${run(ID)}`; }), /wrong-project/);
  await assert.rejects(R.reviewA3Access({ project: 'demo-x', get: async () => ({}) }), /explicit supported --project/);
  await assert.rejects(R.reviewA3Access({ project: STAGING, provenance: 'synthetic-fixture' }), /explicit GET transport/);
});

test('the S4 deployment plan is required and compared', async () => {
  const a = await buildAccess();
  await assert.rejects(R.reviewA3Access({ project: STAGING, get: a.get, observation: a.observation, expected: expectedFor(a.observation), provenance: 'synthetic-fixture', now: a.now }),
    /deployment plan content object/);
  await assert.rejects(R.reviewA3Access({ project: STAGING, get: a.get, observation: a.observation, deploymentPlan: planFor(a.observation, { readyIndexesConfigurationHash: 'a'.repeat(64) }),
    expected: expectedFor(a.observation), provenance: 'synthetic-fixture', now: a.now }), /differs from the approved plan: readyIndexesConfigurationHash/);
});

// --- F2: current provider configuration drift --------------------------------
test('F2: persistent drift in the current Function or Cloud Run service refuses', async () => {
  const other = e => `${e.service.name}/revisions/teacherunitsget-00002-new`;
  const cases = [
    ['service template', drift(e => { e.service.template = { ...templateOf(e.revision), timeout: '30s' }; }), /service template differs from the serving revision/],
    ['template names another revision', drift(e => { e.service.template = { ...templateOf(e.revision), revision: 'teacherunitsget-00009-new' }; }), /template names a different revision/],
    ['reconciling', drift(e => { e.service.reconciling = true; }), /reconciling must be absent or false/],
    ['latestReadyRevision', drift(e => { e.service.latestReadyRevision = other(e); }), /revision mismatch between Functions and Cloud Run/],
    ['latestCreatedRevision', drift(e => { e.service.latestCreatedRevision = other(e); }), /revision mismatch between Functions and Cloud Run/],
    ['function state', drift(e => { e.fn.state = 'DEPLOYING'; }), /function generation or state is not GEN_2 ACTIVE/],
    ['function state messages', drift(e => { e.fn.stateMessages = [{ severity: 'WARNING', message: 'x' }]; }), /function reports state messages/],
    ['service not ready', drift(e => { e.service.terminalCondition = { type: 'Ready', state: 'CONDITION_FAILED' }; }), /REFUSED/],
    ['revision not ready', drift(e => { e.revision.conditions = [{ type: 'Ready', state: 'CONDITION_RECONCILING' }]; }), /REFUSED/],
    ['revision reconciling', drift(e => { e.revision.reconciling = true; }), /reconciling must be absent or false/],
    ['nested memory', drift(e => { e.revision.containers[0].resources.limits.memory = '512Mi'; }), /current Function or Cloud Run configuration differs from the S4 observation/],
    ['nested unknown probe field', drift(e => { e.revision.containers[0].startupProbe = { periodSeconds: 10, unknownField: 1 }; }), /unknown provider field|unsupported/],
    ['nested functions serviceConfig', drift(e => { e.fn.serviceConfig.maxInstanceCount = 99; }), /current Function or Cloud Run configuration differs from the S4 observation/],
    ['function updateTime', drift(e => { e.fn.updateTime = '2026-10-16T11:30:00.000Z'; }), /current Function or Cloud Run configuration differs from the S4 observation/],
    ['source generation', drift(e => { e.fn.buildConfig.sourceProvenance.resolvedStorageSource.generation = '1760000000000002'; }), /source archive does not match the generation-pinned source/],
    ['serving revision', drift(e => { e.fn.serviceConfig.revision = 'teacherunitsget-00002-new'; }), /REFUSED/],
    ['access flag', drift(e => { e.service.customAudiences = ['https://late.example']; }), /current Function or Cloud Run configuration differs from the S4 observation/],
  ];
  for (const [name, options, pattern] of cases) await assert.rejects(review(options), e => { assert.match(e.message, /REFUSED/, name); assert.match(e.message, pattern, name); return true; });
});

test('F2: missing template, revision or service URIs refuse', async () => {
  await refused({ mutateAccess: a => { a.onAccessGet = (url, _c, _a, state) => (url === SERVICE_URL ? { ...state.endpoints[ID].service } : undefined); } },
    /Cloud Run service template/);
  await refused({ mutateAccess: a => { a.onAccessGet = url => (url.includes('/revisions/teacherunitsget-') ? null : undefined); } }, /revision/);
  await refused(drift(e => { delete e.service.uri; delete e.service.urls; }), /Cloud Run default URI missing/);
  await refused(drift(e => { delete e.service.uri; }), /Cloud Run default URI missing/);
  await refused(drift(e => { delete e.fn.url; }), /Functions default URL is missing/);
  await refused(drift(e => { e.service.uri = 'https://teacherunitsget-other0001-uc.a.run.app'; }), /uri is not among its urls/);
});

test('tagged or old revision routes refuse', async () => {
  await refused(serveService(s => { s.traffic[0].tag = 'canary'; }), /traffic split or tagged route present/);
  await refused(serveService(s => { s.trafficStatuses[0].tag = 'old'; }), /traffic split or tagged route present/);
  await refused(serveService(s => { s.trafficStatuses[0].uri = 'https://old---x.a.run.app'; }), /revision route URL present/);
  await refused(serveService(s => { s.trafficStatuses = [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: 'teacherunitsget-00000-old', percent: 100 }]; }), /serving revision mismatch/);
  await refused(serveService(s => { s.traffic.push({ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 0 }); }), /traffic split or tagged route present/);
});

test('missing route evidence refuses', async () => {
  await refused(serveService(s => { delete s.traffic; }), /traffic split or tagged route present/);
  await refused(serveService(s => { delete s.trafficStatuses; }), /traffic split or tagged route present/);
  await refused(serveService(s => { delete s.ingress; }), /ingress is missing or unknown/);
  await refused(serveService(s => { s.unknownRouteField = 1; }), /unknown provider field|unsupported/);
});

// --- F3: default URL and local Hosting binding ---------------------------------
test('F3: provider default URLs must be https, bound to the environment and resource', async () => {
  await refused(drift(e => { e.fn.url = 'http://attacker.invalid'; }), /Functions default URL is missing or not bound/);
  await refused(drift(e => { e.fn.url = `https://us-central1-other-project.cloudfunctions.net/${ID}`; }), /not bound to lyfelabz-staging/);
  await refused(drift(e => { e.fn.url = `https://us-central1-${STAGING}.cloudfunctions.net/teacherUnitsList`; }), /not bound/);
  const u = urlsFor(STAGING, ID);
  await refused(drift(e => { e.service.uri = u.legacy.replace('https:', 'http:'); e.service.urls = [u.deterministic, e.service.uri]; }), /Cloud Run URI is not bound/);
  await refused(drift(e => { e.service.urls = [u.deterministic.replace(A1.PROJECT_NUMBERS[STAGING], '999'), u.legacy]; }), /Cloud Run URI is not bound/);
  await refused(drift(e => { e.service.urls = [u.legacy, 'https://attacker.invalid']; }), /Cloud Run URI is not bound/);
  await refused(drift(e => { e.fn.serviceConfig.uri = 'https://other-synth0001-uc.a.run.app'; }), /Functions service URI differs from the Cloud Run URIs/);
});

test('F3: resealed receipts with substituted or removed URLs or Hosting evidence refuse', async () => {
  const { receipt, context, object, bytes } = await verified();
  const cases = [
    [(_r, e) => { e.defaultUrls.functionUrl = 'http://attacker.invalid'; }, /Functions default URL is missing or not bound/],
    [(_r, e) => { e.defaultUrls.functionUrl = null; }, /access review receipt invalid/],
    [(_r, e) => { delete e.defaultUrls.functionUrl; }, /access review receipt invalid/],
    [(_r, e) => { e.defaultUrls.functionUrl = `https://us-central1-other-project.cloudfunctions.net/${ID}`; }, /not bound to lyfelabz-staging/],
    [(_r, e) => { e.defaultUrls.serviceUris = []; }, /Cloud Run default URI missing/],
    [(_r, e) => { e.defaultUrls.serviceUris = ['http://attacker.invalid']; }, /Cloud Run URI is not bound/],
    [(_r, e) => { e.defaultUrls.serviceUris = [`https://${run(ID)}-${A1.PROJECT_NUMBERS['lyfelabz-prod']}.us-central1.run.app`]; }, /Cloud Run URI is not bound/],
    [(_r, e) => { e.defaultUrls.serviceUris = ['https://teacherunitslist-synth0001-uc.a.run.app']; }, /Cloud Run URI is not bound/],
    [r => { r.routes.localHostingConfig.path = 'firebase.json'; }, /local Hosting binding altered/],
    [r => { r.routes.localHostingConfig.path = 'invented.json'; }, /local Hosting binding altered/],
    [r => { r.routes.localHostingConfig.sha256 = 'a'.repeat(64); }, /local Hosting binding altered/],
    [r => { r.routes.hostingReleases.reason = 'checked'; }, /route evidence or local Hosting binding altered/],
    [r => { r.inheritedIam.reason = 'observed elsewhere'; }, /inheritance status altered/],
  ];
  for (const [edit, pattern] of cases) { const f = forge(receipt, edit); assert.throws(() => R.assertAccessReview(f.object, f.bytes, context), pattern); }
  // A different checked file than the one reviewed no longer binds.
  assert.throws(() => R.assertAccessReview(object, bytes, { ...context, hostingRoot: hostingRoot(STAGING) }), /local Hosting binding altered/);
});

test('F3: local Hosting rewrites refuse; path and hash come only from the checked file', async () => {
  const root = r => hostingRoot(STAGING, { hosting: [{ target: 'app', rewrites: [r] }] });
  await refused({ hostingRoot: root({ source: '/api/units', function: ID }) }, /routes to Functions or Cloud Run/);
  await refused({ hostingRoot: root({ source: '/api/units', function: { functionId: ID, region: 'us-central1' } }) }, /routes to Functions or Cloud Run/);
  await refused({ hostingRoot: root({ source: '/api/units', run: { serviceId: run(ID), region: 'us-central1' } }) }, /routes to Functions or Cloud Run/);
  await refused({ hostingRoot: root({ source: '/x', destination: '/y', unreviewed: true }) }, /unknown provider field: unreviewed/);
  await refused({ hostingRoot: hostingRoot('lyfelabz-prod') }, /local Hosting configuration firebase.staging.json unreadable/);
  await refused({ hostingRoot: hostingRoot(STAGING, null, '{not json') }, /is not strict JSON/);
  const scratch = hostingRoot(STAGING);
  const { receipt } = await review({ hostingRoot: scratch });
  assert.deepEqual(receipt.routes.localHostingConfig, { status: 'checked-local-only', path: 'firebase.staging.json',
    sha256: K.sha256Bytes(fs.readFileSync(path.join(scratch, 'firebase.staging.json'))) });
  assert.equal(receipt.routes.hostingReleases.status, 'unresolved');
  for (const file of ['firebase.json', 'firebase.staging.json']) R.localHostingExposure(fs.readFileSync(path.join(__dirname, '../..', file)), file);
  assert.equal(R.checkLocalHosting('lyfelabz-prod').path, 'firebase.json');
});

test('domain mapping and load balancer exposure cannot be ruled out in v1', async () => {
  const { receipt, object, context, bytes } = await verified();
  assert.match(receipt.routes.domainMappings.reason, /not observed/);
  assert.match(receipt.routes.loadBalancerBackends.reason, /not observed/);
  const result = R.assertAccessReview(object, bytes, context);
  assert.ok(result.unresolved.includes('routes.domainMappings') && result.unresolved.includes('routes.loadBalancerBackends'));
  assert.throws(() => R.assertProviderCompleteAccessReview(result), /domainMappings.*loadBalancerBackends/);
});

// --- F4: A3-1 bounds at the S5 boundary --------------------------------------
test('F4: generation above the signed 64-bit maximum and empty IAM bindings refuse before composition', async () => {
  const bytes = Buffer.from('{}');
  assert.equal(R.receiptContentObject(bytes, { ...RECEIPT_LOCATION, generation: '9223372036854775807' }).generation, '9223372036854775807');
  for (const generation of ['9223372036854775808', '99999999999999999999', '0', '-1', '01', '1.0']) {
    assert.throws(() => R.receiptContentObject(bytes, { ...RECEIPT_LOCATION, generation }), /receipt content object invalid/, generation);
  }
  const { context, receipt } = await verified();
  const empty = { version: 1, bindings: [{ role: 'roles/viewer', members: [], condition: null }] };
  // A3-1 rejects the empty binding downstream...
  const composed = { ...context.observation.endpoints[0].configuration, invocation: { invokerIamDisabled: false, defaultUriDisabled: false, iapEnabled: false,
    customAudiences: [], functionAllowPolicy: empty, serviceAllowPolicy: empty, accessReviewReceipt: { ...RECEIPT_LOCATION, sha256: 'a'.repeat(64) } } };
  assert.equal(V.validateEndpoint(composed).ok, false);
  // ...and S5 now refuses it at its own boundary first.
  await refused({ plan: { endpoint: e => { e.functionAllowPolicy = empty; } } }, /expected-access plan invalid.*IAM binding requires members/);
  await refused({ plan: { endpoint: e => { e.serviceAllowPolicy.bindings.push({ role: 'roles/viewer', members: [], condition: null }); } } }, /IAM binding requires members/);
  await refused({ expected: o => { const x = expectedFor(o); return { ...x, object: { ...x.object, generation: '9223372036854775808' } }; } }, /expected-access plan content object invalid/);
  const f = forge(receipt, (_r, e) => { e.functionPolicy.policy.bindings = [{ role: 'roles/viewer', members: [], condition: null }]; e.functionPolicy.sha256 = K.contentDigest(e.functionPolicy.policy); });
  assert.throws(() => R.composeEndpoints(f.object, f.bytes, context), /access review receipt invalid.*IAM binding requires members/);
});

test('forged or altered receipt content refuses', async () => {
  const { receipt, bytes, object, context } = await verified();
  const tampered = Buffer.from(bytes.toString('utf8').replace('"allUsers"', '"allUsers","user:x@example.com"'));
  assert.throws(() => R.assertAccessReview(object, tampered, context), /do not match the content object hash/);
  const spaced = Buffer.from(JSON.stringify(receipt, null, 1));
  assert.throws(() => R.assertAccessReview({ ...object, sha256: K.sha256Bytes(spaced) }, spaced, context), /not canonical JSON/);
  const cases = [
    [(r, e) => { e.servicePolicy.policy.bindings[0].members = ['allUsers', 'user:x@example.com']; e.servicePolicy.sha256 = K.contentDigest(e.servicePolicy.policy); }, /exactly the explicit roles\/run.invoker grant/],
    [(r, e) => { e.functionPolicy.policy.bindings = [{ role: 'roles/viewer', members: ['user:x@example.com'], condition: null }]; }, /functionPolicy hash does not match/],
    [(r, e) => { e.runtimeServiceAccountEmail = `x@${STAGING}.iam.gserviceaccount.com`; }, /runtime service identity differs/],
    [(r, e) => { e.serviceResource = e.serviceResource.replace(run(ID), 'other'); }, /resource identity differs/],
    [(r, e) => { e.servicePolicy.resource = e.functionResource; }, /not bound to the observed resource/],
    [(r, e) => { e.access.customAudiences = ['https://forged.example']; }, /access flags differ from the S4 observation/],
    [r => { r.s4ObservationFingerprint = 'a'.repeat(64); }, /not bound to this S4 observation/],
    [r => { r.deploymentPlanSha256 = 'a'.repeat(64); }, /not bound to this deployment plan/],
    [r => { r.expectedAccessSha256 = 'a'.repeat(64); }, /not bound to this expected-access plan/],
    [r => { r.projectId = 'lyfelabz-prod'; }, /wrong-project or wrong-environment/],
    [r => { r.authority = 'release approval'; }, /authority or sources altered/],
    [r => { r.endpoints.pop(); }, /nine sorted A3 endpoints/],
  ];
  for (const [edit, pattern] of cases) { const f = forge(receipt, edit); assert.throws(() => R.assertAccessReview(f.object, f.bytes, context), pattern); }
  const other = { ...context.observation, endpoints: context.observation.endpoints.map(e => JSON.parse(JSON.stringify(e))) };
  other.endpoints[0].provider.metadata.buildId = 'synthetic-other-build';
  assert.throws(() => R.assertAccessReview(object, bytes, { ...context, observation: other }), /not bound to this S4 observation/);
});

test('stale observation or review refuses', async () => {
  let late = false, tick = 0;
  const clock = () => new Date(Date.parse('2026-10-16T12:00:00.000Z') + (late ? A1.MAX_AGE_MS + 1 : 0) + tick++).toISOString();
  const a = await buildAccess({ clock });
  late = true;
  await assert.rejects(R.reviewA3Access({ project: STAGING, get: a.get, observation: a.observation, deploymentPlan: a.deploymentPlan, expected: expectedFor(a.observation),
    provenance: 'synthetic-fixture', now: clock }), /stale or future observation/);
  let reads = 0, offset = 0, expiredAt = null, built;
  const clock2 = () => new Date(Date.parse('2026-10-16T12:00:00.000Z') + offset + reads++).toISOString();
  built = await buildAccess({ clock: clock2, mutateAccess: x => { x.onAccessGet = url => { if (expiredAt === null && url.includes('teacherUnitsUpdate')) { offset = A1.MAX_AGE_MS; expiredAt = built.calls.length; } }; } });
  await assert.rejects(R.reviewA3Access({ project: STAGING, get: built.get, observation: built.observation, deploymentPlan: built.deploymentPlan, expected: expectedFor(built.observation),
    provenance: 'synthetic-fixture', now: clock2 }), /stale review; the S4 observation window has expired/);
  assert.equal(built.calls.length, expiredAt, 'no provider read after the window expired');
  const { object, bytes, context } = await verified();
  const later = new Date(Date.parse(context.observation.startedAt) + A1.MAX_AGE_MS + 1).toISOString();
  assert.throws(() => R.assertAccessReview(object, bytes, { ...context, now: later }), /stale/);
  const earlier = new Date(Date.parse(context.now) - 60000).toISOString();
  assert.throws(() => R.assertAccessReview(object, bytes, { ...context, now: earlier }), /window is inconsistent|stale or future/);
});

// --- F6: final deadline guard --------------------------------------------------
test('F6: the window expiring after the last provider read yields no receipt', async () => {
  // The clock jumps past the S4 window only once every provider read is done, so
  // only the final deadline check stands between the reads and a receipt.
  const start = Date.parse('2026-10-16T12:00:00.000Z');
  let built, tick = 0;
  const clock = () => new Date(start + tick++ + (built && built.calls.length >= TOTAL_READS ? A1.MAX_AGE_MS : 0)).toISOString();
  built = await buildAccess({ clock });
  const outcome = await R.reviewA3Access({ project: STAGING, get: built.get, observation: built.observation, deploymentPlan: built.deploymentPlan,
    expected: expectedFor(built.observation), provenance: 'synthetic-fixture', now: clock }).then(r => ({ receipt: r.receipt }), error => ({ error }));
  assert.equal(built.calls.length, TOTAL_READS, 'every provider read completed inside the window');
  assert.equal(outcome.receipt, undefined, 'no receipt may be produced after the window expired');
  assert.ok(outcome.error instanceof Error);
  // Control: the same flow without the jump produces a receipt.
  let t2 = 0;
  const control = await buildAccess({ clock: () => new Date(start + t2++).toISOString() });
  const ok = await R.reviewA3Access({ project: STAGING, get: control.get, observation: control.observation, deploymentPlan: control.deploymentPlan,
    expected: expectedFor(control.observation), provenance: 'synthetic-fixture', now: control.now });
  assert.equal(ok.receipt.kind, R.RECEIPT_KIND);
});

test('GET-only transport: only documented read URLs, version 3 policies, through A1 readApi', async () => {
  const { a } = await review();
  const s5 = a.calls.map(c => c.url);
  assert.ok(a.calls.every(c => c.binary === false));
  for (const url of s5) {
    const u = new URL(url);
    assert.ok(['cloudfunctions.googleapis.com', 'run.googleapis.com'].includes(u.host), url);
    assert.ok(!/:(setIamPolicy|testIamPermissions)/.test(u.pathname), url);
    if (u.pathname.endsWith(':getIamPolicy')) assert.equal(u.searchParams.get('options.requestedPolicyVersion'), '3');
  }
  // Each endpoint: function, function policy, service, revision and service policy, read twice.
  assert.equal(s5.length, TOTAL_READS);
  const methods = [];
  const b = await buildAccess();
  const fetchImpl = async (url, init) => {
    methods.push(init);
    const bytes = Buffer.from(JSON.stringify(await b.get(url)));
    return { ok: true, status: 200, headers: new Map(), body: (async function* () { yield bytes; })() };
  };
  await R.reviewA3Access({ project: STAGING, get: A1.readApi({ token: 'synthetic-token', fetchImpl }), observation: b.observation, deploymentPlan: b.deploymentPlan,
    expected: expectedFor(b.observation), provenance: 'synthetic-fixture', now: b.now });
  assert.ok(methods.length === TOTAL_READS && methods.every(m => m.method === 'GET' && m.redirect === 'error'));
});

test('S5 is outside production Functions and leaves S4 and A1 unchanged', () => {
  const index = fs.readFileSync(path.join(__dirname, '../../platform/functions/src/index.ts'), 'utf8');
  assert.doesNotMatch(index, /teacher-units-release|access-review/);
  assert.equal(A1.REQUIRED_FUNCTIONS.length, 8);
  assert.equal(O.ENDPOINTS.length, 9);
});
