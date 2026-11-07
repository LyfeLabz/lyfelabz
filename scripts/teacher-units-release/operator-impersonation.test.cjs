'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const C = require('./availability-control.cjs');
const req = n => require(require.resolve(n, { paths: [path.resolve(__dirname, '../../platform/functions')] }));
const identity = C.target('lyfelabz-staging', {});
const email = 'lyfelabz-staging@appspot.gserviceaccount.com';
const now = Date.parse('2026-10-27T18:00:00Z');
function config() { return { type: 'impersonated_service_account', delegates: [], quota_project_id: identity.projectId,
  service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${email}:generateAccessToken`,
  source_credentials: { type: 'authorized_user', client_id: 'synthetic-id', client_secret: 'synthetic-secret', refresh_token: 'synthetic-refresh' } }; }
function review() { return { schemaVersion: 1, projectId: identity.projectId, projectNumber: identity.projectNumber,
  databaseId: '(default)', principalSubject: email, permissionCheckScope: 'project', blastRadiusAccepted: true,
  approvalRef: 'synthetic-owner-accepts-existing-Editor', acceptedProjectRoles: ['roles/editor'] }; }
function provider() { return { getAccessToken: async () => ({ token: 'synthetic-token' }),
  getTokenInfo: async () => ({ email, email_verified: true, expiry_date: now + 600000, scopes: ['https://www.googleapis.com/auth/cloud-platform'] }),
  request: async ({ url }) => ({ data: url.includes(':testIamPermissions') ? { permissions: C.WRITE } :
    { projectId: identity.projectId, name: `projects/${identity.projectNumber}`, state: 'ACTIVE' } }) }; }
const verify = (client = provider(), accessReview = review()) => C.verifyCredential({ client, identity, email, accessReview,
  impersonated: true, now: () => now, write: true });

test('explicit impersonation config pins Google endpoint, identity, lifetime and empty delegation chain without RPC', async () => {
  const c = C.operatorCredential(identity, config());
  assert.equal(c.impersonated, true); assert.equal(c.email, email);
  assert.ok(c.client instanceof req('google-auth-library').Impersonated);
  assert.equal(c.client.getTargetPrincipal(), email);
  assert.equal(c.client.lifetime, 600); assert.deepEqual(c.client.delegates, []);
  assert.equal(c.client.endpoint, 'https://iamcredentials.googleapis.com');
  assert.deepEqual(c.client.targetScopes, ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/userinfo.email']);
  assert.deepEqual((await verify()).operator, { principalSubject: email, credentialSubject: email, delegationSubject: null });
});

test('ordinary user OAuth, different targets, endpoint injection, delegates and malformed sources refuse before RPC', () => {
  assert.throws(() => C.operatorCredential(identity, config().source_credentials));
  for (const change of [c => c.service_account_impersonation_url = c.service_account_impersonation_url.replace(email, 'wrong@lyfelabz-staging.iam.gserviceaccount.com'),
    c => c.service_account_impersonation_url = 'https://evil.example/token', c => c.delegates = [email],
    c => c.quota_project_id = 'wrong', c => c.source_credentials.token_uri = 'https://evil.example/token',
    c => c.source_credentials.refresh_token = '', c => c.source_credentials.type = 'service_account',
    c => c.token_url = 'https://evil.example/token']) {
    const c = config(); change(c); assert.throws(() => C.operatorCredential(identity, c));
  }
  assert.throws(() => C.operatorCredential({ ...identity, projectNumber: '0' }, config()));
  assert.throws(() => C.operatorCredential({ ...identity, projectId: 'unapproved' }, config()));
});

test('current Google Cloud SDK source fields are accepted only in their exact known shapes', async () => {
  const sdk = () => { const c = config(); delete c.quota_project_id;
    Object.assign(c.source_credentials, { account: '', universe_domain: 'googleapis.com' }); return c; };
  for (const c of [config(), sdk(), (() => { const c = sdk(); c.source_credentials.account = 'owner@example.test'; return c; })(),
    (() => { const c = config(); c.source_credentials.universe_domain = 'googleapis.com'; return c; })()]) {
    const r = C.operatorCredential(identity, c);
    assert.equal(r.impersonated, true); assert.equal(r.email, email); assert.equal(r.client.getTargetPrincipal(), email);
  }
  assert.deepEqual((await verify()).operator, { principalSubject: email, credentialSubject: email, delegationSubject: null });
  for (const change of [c => c.source_credentials.universe_domain = 'evil.example', c => c.source_credentials.universe_domain = '',
    c => c.source_credentials.universe_domain = null, c => c.source_credentials.account = 42, c => c.source_credentials.account = null,
    c => c.source_credentials.account = 'not an email', c => c.source_credentials.account = 'a@b@c',
    c => c.source_credentials.quota_project_id = identity.projectId, c => c.source_credentials.extra = 'x', c => c.universe_domain = 'googleapis.com',
    c => delete c.source_credentials.client_id, c => delete c.source_credentials.client_secret,
    c => delete c.source_credentials.refresh_token, c => delete c.source_credentials.type, c => delete c.source_credentials,
    c => c.source_credentials = [], c => delete c.service_account_impersonation_url, c => delete c.type,
    c => c.service_account_impersonation_url = c.service_account_impersonation_url.replace(email, 'lyfelabz-prod@appspot.gserviceaccount.com'),
    c => c.service_account_impersonation_url = c.service_account_impersonation_url.replace(email, 'other@lyfelabz-staging.iam.gserviceaccount.com')]) {
    const c = sdk(); change(c); assert.throws(() => C.operatorCredential(identity, c));
  }
});

test('effective token identity, validity, scope, provider target and complete permissions are required', async () => {
  for (const patch of [{ email: 'user@example.test' }, { email: 'wrong@lyfelabz-staging.iam.gserviceaccount.com' },
    { expiry_date: now }, { expiry_date: now + 30000 }, { expiry_date: NaN }, { email_verified: false }, { scopes: [] }]) {
    const client = provider(), original = client.getTokenInfo;
    client.getTokenInfo = async () => ({ ...await original(), ...patch });
    await assert.rejects(verify(client));
  }
  for (const change of [c => c.getAccessToken = async () => ({}),
    c => c.getTokenInfo = async () => { throw new Error('synthetic-invalid-token'); },
    c => c.request = async () => ({ data: { projectId: identity.projectId, name: 'projects/0', state: 'ACTIVE' } }),
    c => c.request = async ({ url }) => ({ data: url.includes(':testIamPermissions') ? { permissions: C.READ } :
      { projectId: identity.projectId, name: `projects/${identity.projectNumber}`, state: 'ACTIVE' } })]) {
    const client = provider(); change(client); await assert.rejects(verify(client));
  }
});

test('owner review must match target and subject and explicitly accept existing Editor scope', async () => {
  for (const change of [r => delete r.acceptedProjectRoles, r => r.acceptedProjectRoles = [], r => r.blastRadiusAccepted = false,
    r => r.principalSubject = 'wrong', r => r.projectId = 'wrong', r => r.projectNumber = '0',
    r => r.databaseId = 'other', r => r.permissionCheckScope = 'database', r => r.approvalRef = '', r => r.unapproved = true]) {
    const r = review(); change(r); await assert.rejects(verify(provider(), r));
  }
  await assert.rejects(verify(provider(), null));
});

test('Firestore SDK transport uses the very same impersonated client with no ADC or source credential fallback', async () => {
  const { client } = C.operatorCredential(identity, config());
  const db = C.impersonatedFirestore(identity, client);
  try {
    assert.equal(db.projectId, identity.projectId); assert.equal(db.databaseId, '(default)');
    assert.equal(await db._settings.auth.getClient(), client);
    assert.ok(!JSON.stringify(db._settings).includes('synthetic-refresh'));
    assert.ok(!JSON.stringify(db._settings).includes('synthetic-secret'));
    assert.equal(db._settings.servicePath, 'firestore.googleapis.com'); assert.equal(db._settings.ssl, true);
    // Exercise Firestore's actual GAPIC/GAX client factory without issuing an RPC.
    await db._clientPool.run(0, false, async transport => {
      assert.equal(await transport.auth.getClient(), client);
    });
  } finally { await db.terminate(); }
});

test('direct-key support remains distinct and does not acquire an impersonation client', () => {
  const { generateKeyPairSync } = require('node:crypto');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const c = C.operatorCredential(identity, { type: 'service_account', project_id: identity.projectId, client_email: email,
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' });
  assert.equal(c.email, email); assert.equal(c.impersonated, false);
  assert.ok(!(c.client instanceof req('google-auth-library').Impersonated));
});

test('real library exchange uses fixed Google issuance and never serves source token as operator token', async () => {
  const { client } = C.operatorCredential(identity, config());
  client.sourceClient.getAccessToken = async () => ({ token: 'synthetic-source-only' });
  const calls = [];
  client.sourceClient.request = async request => {
    calls.push(request);
    return { data: { accessToken: 'synthetic-issued-target', expireTime: new Date(Date.now() + 600000).toISOString() } };
  };
  assert.equal((await client.getAccessToken()).token, 'synthetic-issued-target');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, config().service_account_impersonation_url);
  assert.equal(calls[0].data.lifetime, '600s');
  assert.deepEqual(calls[0].data.delegates, []);
});

test('provider failures never print tokens or credential contents through CLI', async () => {
  let output = '';
  const code = await C.main(['show', '--project', identity.projectId, '--live'], { env: {},
    connect: async () => { throw new Error('synthetic-refresh synthetic-token synthetic-secret'); },
    stdout: { write: v => output += v }, stderr: { write: v => output += v } });
  assert.equal(code, 1); assert.equal(output, 'Option B REFUSED: operation could not be verified\n');
});

test('production pins its own App Engine operator; cross-project identities and reviews refuse', async () => {
  const prod = C.target('lyfelabz-prod', {}), prodEmail = 'lyfelabz-prod@appspot.gserviceaccount.com';
  const prodConfig = () => ({ ...config(), quota_project_id: prod.projectId,
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${prodEmail}:generateAccessToken` });
  const c = C.operatorCredential(prod, prodConfig());
  assert.equal(c.email, prodEmail); assert.equal(c.client.getTargetPrincipal(), prodEmail); assert.equal(c.client.lifetime, 600);
  // Staging operator URL against production, and production URL against staging, refuse before RPC.
  assert.throws(() => C.operatorCredential(prod, { ...config(), quota_project_id: prod.projectId }));
  assert.throws(() => C.operatorCredential(identity, { ...prodConfig(), quota_project_id: identity.projectId }));
  assert.throws(() => C.operatorCredential({ ...prod, projectNumber: identity.projectNumber }, prodConfig()));
  const prodReview = { ...review(), projectId: prod.projectId, projectNumber: prod.projectNumber, principalSubject: prodEmail };
  const prodProvider = () => { const p = provider(); p.getTokenInfo = async () => ({ email: prodEmail, email_verified: true, expiry_date: now + 600000,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    p.request = async ({ url }) => ({ data: url.includes(':testIamPermissions') ? { permissions: C.WRITE } :
      { projectId: prod.projectId, name: `projects/${prod.projectNumber}`, state: 'ACTIVE' } }); return p; };
  const prodVerify = (accessReview, e = prodEmail) => C.verifyCredential({ client: prodProvider(), identity: prod, email: e, accessReview, impersonated: true, now: () => now, write: true });
  assert.equal((await prodVerify(prodReview)).operator.principalSubject, prodEmail);
  await assert.rejects(prodVerify(review()));
  await assert.rejects(prodVerify(prodReview, email));
  await assert.rejects(prodVerify({ ...prodReview, acceptedProjectRoles: ['roles/owner'] }));
});

// Short-lived gcloud impersonation (--gcloud-impersonation). Synthetic gcloud
// runner and token-info responses only; no live credential or network access.
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
function gcloudSetup({ project = identity, tokens = ['synthetic-gcloud-token-1', 'synthetic-gcloud-token-2'], info = {}, clock = Date.now } = {}) {
  const pinned = C.target(project.projectId, {}).projectId === 'lyfelabz-prod' ? 'lyfelabz-prod@appspot.gserviceaccount.com' : email;
  const calls = [], infoCalls = [];
  const run = (file, args, options) => { calls.push({ file, args, options }); const t = tokens[calls.length - 1];
    if (t instanceof Error) throw t; return `${t}\n`; };
  const c = C.gcloudOperatorCredential(project, { run, env: {}, now: clock });
  c.client.getTokenInfo = async token => { infoCalls.push(token);
    return { email: pinned, email_verified: true, expiry_date: clock() + 600000, scopes: [SCOPE], ...(typeof info === 'function' ? info(token) : info) }; };
  return { ...c, calls, infoCalls, pinned };
}
const leaks = text => /synthetic-gcloud-token|synthetic-stderr-secret/.test(text);

test('gcloud impersonation pins the approved operator per project and runs a fixed shell-free 600-second command', async () => {
  for (const project of [identity, C.target('lyfelabz-prod', {})]) {
    const s = gcloudSetup({ project });
    assert.equal(s.email, s.pinned); assert.equal(s.impersonated, true);
    assert.ok(!(s.client instanceof req('google-auth-library').Impersonated));
    assert.equal((await s.client.getAccessToken()).token, 'synthetic-gcloud-token-1');
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].file, 'gcloud');
    assert.deepEqual(s.calls[0].args, ['auth', 'print-access-token', `--impersonate-service-account=${s.pinned}`, '--lifetime=600s', '--quiet']);
    assert.equal(C.GCLOUD_TOKEN_LIFETIME_SECONDS, 600);
    assert.equal(s.calls[0].options.shell, undefined); assert.equal(s.calls[0].options.stdio[0], 'ignore');
    assert.ok(s.calls[0].options.timeout > 0);
    // Identity and expiry come from Google's token-info response for the minted token.
    assert.deepEqual(s.infoCalls, ['synthetic-gcloud-token-1']);
    assert.equal(s.client.credentials.refresh_token, undefined);
  }
  assert.equal(C.gcloudOperatorCredential(identity, { run: () => 'x', env: {} }).email, email);
});

test('gcloud impersonation refuses unsupported projects, mismatched numbers and access-token overrides before running gcloud', () => {
  let ran = false; const run = () => { ran = true; return 'synthetic-gcloud-token'; };
  for (const project of [C.target('demo-lyfelabz', {}), { ...identity, projectId: 'unapproved' }, { ...identity, projectNumber: '0' },
    { ...C.target('lyfelabz-prod', {}), projectNumber: identity.projectNumber }]) {
    assert.throws(() => C.gcloudOperatorCredential(project, { run, env: {} }), C.Refusal);
  }
  assert.throws(() => C.gcloudOperatorCredential(identity, { run, env: { CLOUDSDK_AUTH_ACCESS_TOKEN_FILE: '/tmp/x' } }), C.Refusal);
  assert.equal(ran, false);
});

test('gcloud tokens with wrong identity, missing scope, unverified email or out-of-bounds expiry fail closed', async () => {
  const fixed = Date.parse('2026-11-06T12:00:00Z'), clock = () => fixed;
  for (const info of [{ email: 'cgbreezy-user@example.test' }, { email: 'lyfelabz-prod@appspot.gserviceaccount.com' },
    { email: 'other@lyfelabz-staging.iam.gserviceaccount.com' }, { email_verified: false }, { scopes: [] },
    { scopes: ['https://www.googleapis.com/auth/userinfo.email'] }, { scopes: undefined },
    { expiry_date: fixed }, { expiry_date: fixed + 30000 }, { expiry_date: fixed - 1 }, { expiry_date: NaN },
    { expiry_date: fixed + 3600000 }, { expiry_date: fixed + 661000 }]) {
    const s = gcloudSetup({ info, clock });
    await assert.rejects(s.client.getAccessToken(), C.Refusal);
    assert.equal(s.client.credentials.access_token, undefined);
  }
  const ok = gcloudSetup({ info: { expiry_date: fixed + 600000 }, clock });
  assert.equal((await ok.client.getAccessToken()).token, 'synthetic-gcloud-token-1');
});

test('gcloud failures, empty or malformed output and token-info errors refuse without leaking token or stderr', async () => {
  const failure = Object.assign(new Error('synthetic-stderr-secret synthetic-gcloud-token'), { stdout: 'synthetic-gcloud-token', stderr: 'synthetic-stderr-secret' });
  for (const setup of [() => gcloudSetup({ tokens: [failure] }), () => gcloudSetup({ tokens: [''] }),
    () => gcloudSetup({ tokens: ['synthetic-gcloud-token two'] }),
    () => { const s = gcloudSetup(); s.client.getTokenInfo = async () => { throw new Error('synthetic-gcloud-token rejected'); }; return s; }]) {
    const s = setup();
    const error = await s.client.getAccessToken().then(() => null, e => e);
    assert.ok(error instanceof C.Refusal);
    assert.ok(!leaks(`${error.message} ${error.code} ${error.stack} ${JSON.stringify(error)}`));
  }
  let output = '';
  const s = gcloudSetup({ tokens: [failure] });
  const code = await C.main(['show', '--project', identity.projectId, '--live', '--gcloud-impersonation', '--access-review', 'unused.json'], { env: {},
    connect: async () => { await s.client.getAccessToken(); },
    stdout: { write: v => output += v }, stderr: { write: v => output += v } });
  assert.equal(code, 1); assert.equal(output, 'Option B REFUSED: gcloud impersonation token unavailable\n'); assert.ok(!leaks(output));
});

test('gcloud tokens refresh through gcloud only when missing or near expiry, and are never persisted', async () => {
  const s = gcloudSetup();
  assert.equal((await s.client.getAccessToken()).token, 'synthetic-gcloud-token-1');
  assert.equal((await s.client.getAccessToken()).token, 'synthetic-gcloud-token-1');
  assert.equal(s.calls.length, 1);
  s.client.credentials.expiry_date = Date.now() + 1000; // inside the library's eager-refresh window
  assert.equal((await s.client.getAccessToken()).token, 'synthetic-gcloud-token-2');
  assert.equal(s.calls.length, 2); assert.deepEqual(s.infoCalls, ['synthetic-gcloud-token-1', 'synthetic-gcloud-token-2']);
  // A refresh that fails verification fails closed rather than reusing a stale token.
  s.client.credentials.expiry_date = Date.now() - 1;
  s.client.getTokenInfo = async () => ({ email: 'wrong@example.test', email_verified: true, expiry_date: Date.now() + 600000, scopes: [SCOPE] });
  await assert.rejects(s.client.getAccessToken(), C.Refusal);
});

test('gcloud credential passes the unchanged operator verification and binds the same client to Firestore', async () => {
  const s = gcloudSetup();
  s.client.request = provider().request;
  const r = await C.verifyCredential({ client: s.client, identity, email: s.email, accessReview: review(), impersonated: true, write: true });
  assert.deepEqual(r.operator, { principalSubject: email, credentialSubject: email, delegationSubject: null });
  assert.equal(r.source, 'verified-provider');
  // Existing access-review, Editor acceptance and permission checks still apply.
  for (const accessReview of [null, { ...review(), acceptedProjectRoles: [] }, { ...review(), principalSubject: 'wrong' }]) {
    await assert.rejects(C.verifyCredential({ client: s.client, identity, email: s.email, accessReview, impersonated: true, write: true }));
  }
  const readOnly = gcloudSetup(); readOnly.client.request = async ({ url }) => ({ data: url.includes(':testIamPermissions') ? { permissions: C.READ } :
    { projectId: identity.projectId, name: `projects/${identity.projectNumber}`, state: 'ACTIVE' } });
  await assert.rejects(C.verifyCredential({ client: readOnly.client, identity, email, accessReview: review(), impersonated: true, write: true }));
  const db = C.impersonatedFirestore(identity, s.client);
  try { assert.equal(await db._settings.auth.getClient(), s.client); assert.ok(!leaks(JSON.stringify(db._settings))); }
  finally { await db.terminate(); }
});

test('conflicting or incomplete authentication flags refuse before gcloud runs or any credential file is read', async () => {
  const base = ['show', '--project', identity.projectId, '--live'];
  assert.throws(() => C.parse([...base, '--gcloud-impersonation', '--credentials', 'key.json']), C.Refusal);
  assert.throws(() => C.parse([...base, '--credentials', 'key.json', '--gcloud-impersonation']), C.Refusal);
  assert.throws(() => C.parse([...base, '--gcloud-impersonation', 'value']), C.Refusal);
  assert.throws(() => C.parse([...base, '--gcloud-impersonation', '--gcloud-impersonation']), C.Refusal);
  assert.equal(C.parse([...base, '--gcloud-impersonation']).flags['gcloud-impersonation'], true);
  let ran = 0; const runGcloud = () => { ran++; return 'synthetic-gcloud-token'; };
  const flags = { project: identity.projectId, live: true, 'gcloud-impersonation': true, 'access-review': '/nonexistent/review.json' };
  for (const [id, f] of [[identity, { ...flags, live: undefined }], [identity, { ...flags, credentials: '/nonexistent/key.json' }],
    [identity, { ...flags, 'access-review': undefined }], [C.target('demo-lyfelabz', {}), flags]]) {
    await assert.rejects(C.connect(id, f, 'show', { runGcloud }), C.Refusal);
  }
  await assert.rejects(C.connect(identity, flags, 'show', { runGcloud }));
  assert.equal(ran, 0);
  // Read-only commands still refuse execution flags with the new source.
  assert.throws(() => C.parse(['show', '--project', identity.projectId, '--live', '--gcloud-impersonation', '--execute', '--confirm', 'x', '--plan', 'p']), C.Refusal);
  assert.throws(() => C.parse(['close', '--project', identity.projectId, '--live', '--gcloud-impersonation', '--execute']), C.Refusal);
});
