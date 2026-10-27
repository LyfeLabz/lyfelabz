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
