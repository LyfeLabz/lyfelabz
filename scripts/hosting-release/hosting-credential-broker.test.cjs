'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const B = require('./hosting-credential-broker.cjs');
const ROOT = path.resolve(__dirname, '../..');
const START = Date.parse('2026-10-18T18:00:00.000Z');
// Invented fixture ID only. No approved operational ID exists.
const ID = '123456789012345678901';
const PIN = { project: B.PROJECT, projectNumber: B.PROJECT_NUMBER, serviceAccountEmail: B.EMAIL, accountId: ID };
const OP = { sourceId: 'fixture-selected-source', subject: 'fixture-operator' };
const OM = 'synthetic-operator:fixture';
const HM = 'synthetic-hosting:fixture';
const URL = `https://firebasehosting.googleapis.com/v1beta1/projects/${B.PROJECT}/sites/lyfelabz-staging/channels/live`;
function setup(edit = () => {}) {
  let elapsed = 0, wallOffset = 0;
  const calls = [];
  const controller = new AbortController();
  const bodies = {
    operator: { ...OP, marker: OM },
    target: { projectId: B.PROJECT, email: B.EMAIL, uniqueId: ID, disabled: false },
    mint: { accessToken: HM, expireTime: new Date(START + 600000).toISOString() },
    inspect: { azp: ID, aud: ID, scope: B.SCOPE, exp: String((START + 600000) / 1000), expires_in: '600' },
    provider: { accepted: true }
  };
  const fixtures = {};
  for (const name of Object.keys(bodies)) fixtures[name] = async input => {
    calls.push({ name, input });
    return { request: input.request, body: bodies[name] };
  };
  const options = { identity: { ...PIN }, operator: { ...OP }, fixtures,
    clock: () => ({ wallMs: START + elapsed + wallOffset, monotonicMs: elapsed }) };
  const state = { options, bodies, calls, controller, advance: n => { elapsed += n; }, skew: n => { wallOffset += n; } };
  edit(state);
  state.broker = B.createFixtureBroker(options);
  state.acquire = () => state.broker.acquire({ signal: controller.signal });
  return state;
}
function flags(result) {
  for (const key of ['deployable', 'certified', 'authorized', 'available', 'trustedLiveProvenance']) assert.equal(result[key], false);
  assert.equal(result.provenance, 'synthetic-fixture');
}
function refused(result) {
  assert.equal(result.outcome, 'refused'); assert.equal(result.capability, null); flags(result);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-operator:|synthetic-hosting:|SECRET|Bearer|ya29/);
}

test('pure builder constructs exactly the documented fixed request and freezes it', () => {
  const r = B.buildMintRequest(PIN);
  assert.deepEqual(r, { method: 'POST', url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${ID}:generateAccessToken`,
    body: { scope: [B.SCOPE], lifetime: '600s' } });
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.body) && Object.isFrozen(r.body.scope));
  for (const extra of [{ scope: ['other'] }, { lifetime: '3600s' }, { delegates: [] }, { endpoint: 'https://other' }, { accessToken: HM }])
    assert.throws(() => B.buildMintRequest({ ...PIN, ...extra }));
});

test('identity pins are mandatory, exact and never email-only or the project number', () => {
  for (const change of [p => { delete p.accountId; }, p => { p.accountId = B.PROJECT_NUMBER; },
    p => { p.accountId = 'unknown'; }, p => { p.project = 'lyfelabz-prod'; }, p => { p.projectNumber = '182791689935'; },
    p => { p.serviceAccountEmail = 'other@lyfelabz-staging.iam.gserviceaccount.com'; }]) {
    const p = { ...PIN }; change(p); assert.throws(() => B.buildMintRequest(p));
  }
});

test('successful fixture flow keeps markers private, separated and synthetic', async () => {
  const s = setup(); const r = await s.acquire(); flags(r);
  assert.equal(r.productionDependencies, 'not-implemented'); assert.equal(r.safetyMarginMs, 30000);
  assert.equal(r.captureWindowMs, 300000); assert.equal(r.expiresAt, new Date(START + 600000).toISOString());
  assert.deepEqual(s.calls.map(c => c.name), ['operator', 'target', 'mint', 'inspect']);
  assert.deepEqual(s.calls.map(c => c.input.marker), [null, OM, OM, HM]);
  assert.equal(s.calls[1].input.request.url, `https://iam.googleapis.com/v1/projects/${B.PROJECT}/serviceAccounts/${ID}`);
  assert.deepEqual(s.calls[3].input.request, { method: 'POST', url: 'https://oauth2.googleapis.com/tokeninfo' });
  assert.equal(JSON.stringify(r.capability), '{}');
  assert.doesNotMatch(JSON.stringify(r), /synthetic-hosting:|synthetic-operator:/);
  const answer = await r.capability.request({ method: 'GET', url: URL });
  assert.equal(answer.accepted, true); assert.equal(answer.provenance, 'synthetic-fixture');
  assert.equal(s.calls.at(-1).input.marker, HM); assert.equal(s.calls.at(-1).name, 'provider');
  r.capability.close();
  await assert.rejects(r.capability.request({ method: 'GET', url: URL }), /Offline credential broker refused/);
  refused(await s.acquire());
});

for (const [name, change] of [
  ['wrong email', s => { s.bodies.target.email = 'other@example.com'; }],
  ['recreated account', s => { s.bodies.target.uniqueId = '999999999999999999999'; }],
  ['wrong project', s => { s.bodies.target.projectId = 'lyfelabz-prod'; }],
  ['disabled account', s => { s.bodies.target.disabled = true; }],
  ['missing account identity', s => { delete s.bodies.target.uniqueId; }],
  ['wrong operator', s => { s.bodies.operator.subject = 'other'; }],
  ['wrong source', s => { s.bodies.operator.sourceId = 'ambient'; }],
  ['missing operator identity', s => { delete s.bodies.operator.subject; }],
  ['conflicting azp', s => { s.bodies.inspect.azp = '999999999999999999999'; }],
  ['conflicting aud', s => { s.bodies.inspect.aud = '999999999999999999999'; }],
  ['missing azp', s => { delete s.bodies.inspect.azp; }],
  ['missing aud', s => { delete s.bodies.inspect.aud; }],
  ['optional conflicting email', s => { s.bodies.inspect.email = 'other@example.com'; }],
  ['unverified optional email', s => { s.bodies.inspect.email_verified = false; }],
  ['user-token metadata shape', s => { s.bodies.inspect.sub = ID; }],
  ['extra scope', s => { s.bodies.inspect.scope += ' openid'; }],
  ['missing scope', s => { delete s.bodies.inspect.scope; }],
  ['wrong scope', s => { s.bodies.inspect.scope = 'openid'; }],
  ['invalid expiry', s => { s.bodies.mint.expireTime = 'invalid'; }],
  ['invalid calendar expiry', s => { s.bodies.mint.expireTime = '2026-02-30T18:10:00.000Z'; }],
  ['expired mint', s => { s.bodies.mint.expireTime = new Date(START - 1).toISOString(); }],
  ['extended mint lifetime', s => { s.bodies.mint.expireTime = new Date(START + 600001).toISOString(); }],
  ['short mint lifetime', s => { s.bodies.mint.expireTime = new Date(START + 599999).toISOString(); }],
  ['extended inspection expiry', s => { s.bodies.inspect.exp = String((START + 601000) / 1000); }],
  ['disagreeing expiry', s => { s.bodies.inspect.exp = String((START + 599000) / 1000); }],
  ['missing expiry', s => { delete s.bodies.inspect.expires_in; }],
  ['invalid remaining lifetime', s => { s.bodies.inspect.expires_in = '-1'; }],
  ['inconsistent remaining lifetime', s => { s.bodies.inspect.expires_in = '300'; }],
  ['operator fallback', s => { s.bodies.mint.accessToken = OM; }],
  ['real token refused', s => { s.bodies.mint.accessToken = 'ya29.SECRET'; }],
  ['real operator token refused', s => { s.bodies.operator.marker = 'Bearer SECRET'; }]
]) test(`refuses ${name} without releasing a capability`, async () => {
  const s = setup(change); refused(await s.acquire());
  assert.equal(s.calls.some(c => c.name === 'provider'), false);
});

test('request association refuses substituted responses at every stage', async () => {
  for (const stage of ['operator', 'target', 'mint', 'inspect']) {
    const s = setup(s => { s.options.fixtures[stage] = async input => ({ request: { ...input.request }, body: s.bodies[stage] }); });
    const r = await s.acquire(); refused(r); assert.equal(r.code, 'E_ASSOCIATION');
  }
});

test('configuration has no live, credential, endpoint, scope, lifetime or delegate overrides', () => {
  for (const key of ['live', 'trusted', 'provenance', 'accessToken', 'endpoint', 'scope', 'lifetime', 'delegates'])
    assert.throws(() => setup(s => { s.options[key] = 'unexpected'; }));
  assert.throws(() => setup(s => { delete s.options.fixtures; }));
  assert.throws(() => setup(s => { s.options.fixtures.mint = null; }));
});

test('accessor-backed and extra metadata refuse with fixed errors', async () => {
  const s = setup(s => { Object.defineProperty(s.bodies.mint, 'accessToken', { enumerable: true, get() { throw Error('SECRET'); } }); });
  refused(await s.acquire());
  const x = setup(s => { s.bodies.target.credential = 'SECRET'; }); refused(await x.acquire());
});

test('clock skew, backwards clocks and insufficient conservative validity refuse', async () => {
  for (const move of [s => s.skew(1), s => s.advance(-1), s => s.advance(280000)]) {
    const s = setup(s => { s.options.fixtures.inspect = async input => {
      move(s); return { request: input.request, body: { ...s.bodies.inspect, expires_in: '320' } };
    }; });
    refused(await s.acquire());
  }
});

test('metadata supports absent email, documented numeric strings and second rounding', async () => {
  const s = setup(s => { s.advance(100); s.bodies.mint.expireTime = new Date(START + 600100).toISOString(); });
  const r = await s.acquire(); flags(r); assert.ok(r.capability); r.capability.close();
});

test('deadline cancels hung dependencies and ignores late results', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let late, signal;
  const s = setup(s => { s.options.fixtures.mint = input => { signal = input.signal; return new Promise(resolve => {
    late = () => resolve({ request: input.request, body: s.bodies.mint });
  }); }; });
  const pending = s.acquire(); for (let i = 0; i < 30; i++) await Promise.resolve();
  t.mock.timers.tick(30000); const r = await pending; refused(r); assert.equal(signal.aborted, true);
  late(); await Promise.resolve(); assert.equal(r.capability, null); assert.equal(s.calls.some(c => c.name === 'inspect'), false);
});

test('pre-abort and caller cancellation stop without fallback or retry', async () => {
  const s = setup(); s.controller.abort(); refused(await s.acquire()); assert.equal(s.calls.length, 0);
  let entered;
  const gate = new Promise(resolve => { entered = resolve; });
  const x = setup(s => { s.options.fixtures.target = () => { entered(); return new Promise(() => {}); }; });
  const pending = x.acquire(); await gate; x.controller.abort('SECRET'); refused(await pending);
  assert.equal(x.calls.filter(c => c.name === 'operator').length, 1);
});

test('dependency errors cannot leak markers or secret-bearing diagnostics', async () => {
  for (const stage of ['operator', 'target', 'mint', 'inspect']) {
    let count = 0;
    const s = setup(s => { s.options.fixtures[stage] = () => { count++; throw Object.assign(Error(`SECRET ${OM} ${HM}`), { code: 'SECRET' }); }; });
    const r = await s.acquire(); refused(r); assert.equal(r.code, 'E_DEPENDENCY'); assert.equal(count, 1);
  }
});

test('private provider capability permits only the exact staging GET resources', async () => {
  const invalid = [
    { method: 'POST', url: URL }, { method: 'GET', url: 'https://lyfelabz-staging.web.app/' },
    { method: 'GET', url: URL.replace('lyfelabz-staging/sites', 'lyfelabz-prod/sites') },
    { method: 'GET', url: URL.replace('channels/live', 'releases') },
    { method: 'GET', url: URL + '?access_token=SECRET' }, { method: 'GET', url: URL, headers: { authorization: OM } },
    { method: 'GET', url: URL + '#x' }, { method: 'GET', url: URL.replace('https:', 'http:') }
  ];
  for (const request of invalid) {
    const s = setup(); const r = await s.acquire();
    await assert.rejects(r.capability.request(request), /Offline credential broker refused/);
    assert.equal(s.calls.some(c => c.name === 'provider'), false);
  }
  for (const site of ['lyfelabz-staging', 'lyfelabz-staging-marketing']) {
    const s = setup(); const r = await s.acquire();
    await r.capability.request({ method: 'GET', url: `https://firebasehosting.googleapis.com/v1beta1/projects/${B.PROJECT}/sites/${site}/versions/abc/files?pageToken=abc` });
    r.capability.close();
  }
});

test('expired, cancelled and failing provider capabilities cannot release responses or markers', async () => {
  for (const change of [s => s.advance(600000), s => s.controller.abort(), s => s.skew(1)]) {
    const s = setup(); const r = await s.acquire(); change(s);
    await assert.rejects(r.capability.request({ method: 'GET', url: URL }), e => e.message === 'Offline credential broker refused');
    assert.equal(s.calls.some(c => c.name === 'provider'), false);
  }
  const s = setup(s => { s.options.fixtures.provider = () => { throw Error(`SECRET ${HM}`); }; });
  const r = await s.acquire();
  await assert.rejects(r.capability.request({ method: 'GET', url: URL }), e => !/SECRET|synthetic-hosting/.test(e.message));
});

test('import and fixture acquisition run with network, credential reads and auth modules trapped', () => {
  const probe = `const fs=require('node:fs'),Module=require('node:module');
    const load=Module._load; Module._load=function(id,...args){if(/google-auth|googleapis|firebase-admin/.test(id))throw Error('auth');return load.call(this,id,...args)};
    for(const name of ['http','https','net','tls','dns']){const m=require('node:'+name);for(const key of ['request','get','connect','createConnection','lookup','resolve'])if(m[key])m[key]=()=>{throw Error('network')}};
    global.fetch=()=>{throw Error('network')};
    const read=fs.readFileSync;fs.readFileSync=function(p,...args){if(/gcloud|credentials|configstore|firebase-tools/.test(String(p)))throw Error('credential');return read.call(this,p,...args)};
    const B=require('./scripts/hosting-release/hosting-credential-broker.cjs');
    B.buildMintRequest(${JSON.stringify(PIN)});
    const broker=B.createFixtureBroker({identity:${JSON.stringify(PIN)},operator:${JSON.stringify(OP)},clock:()=>({wallMs:${START},monotonicMs:0}),
      fixtures:Object.fromEntries(['operator','target','mint','inspect','provider'].map(k=>[k,()=>{throw Error('fixture stop')}]))});
    broker.acquire({signal:new AbortController().signal}).then(r=>{if(r.code!=='E_DEPENDENCY')process.exitCode=1});`;
  const r = spawnSync(process.execPath, ['-e', probe], { cwd: ROOT, env: {}, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const source = fs.readFileSync(path.join(__dirname, 'hosting-credential-broker.cjs'), 'utf8');
  assert.doesNotMatch(source, /require\(|process\.|Date\.now|fetch\(|console\.|writeFile|readFile|require\.main/);
});

test('no production consumer, operational CLI, executor integration or provenance upgrade', async () => {
  const hits = [];
  function walk(dir) {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'lib', 'dist', '.git'].includes(d.name)) continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (/\.(c?js|ts|json|ya?ml)$/.test(d.name)) {
        let s = fs.readFileSync(p, 'utf8');
        if (path.relative(ROOT, p) === 'scripts/hosting-release/prepare.cjs') s = s.replace("  'scripts/hosting-release/hosting-credential-broker.test.cjs',\n", '');
        if (s.includes('hosting-credential-broker')) hits.push(path.relative(ROOT, p));
      }
    }
  }
  for (const dir of ['scripts', 'app/scripts', 'app/src', 'platform', '.github']) walk(path.join(ROOT, dir));
  assert.deepEqual(hits.sort(), ['scripts/hosting-release/hosting-credential-broker.test.cjs']);
  const s = setup(); const r = await s.acquire(); flags(r); r.capability.close();
  assert.equal(r.trustedLiveProvenance, false);
  assert.throws(() => setup(s => { s.options.provenance = 'live-staging-capture'; }));
});


test('public builder sanitizes hostile identity objects and reused internal errors stay redacted', async () => {
  const hostile = new Proxy({}, { getPrototypeOf() { throw Error('SECRET'); } });
  assert.throws(() => B.buildMintRequest(hostile), e => e.message === 'Offline credential broker refused');
  const s = setup(s => { s.options.fixtures.mint = () => {
    try { B.buildMintRequest({}); } catch (e) { e.code = 'SECRET'; e.message = `SECRET ${OM}`; throw e; }
  }; });
  refused(await s.acquire());
});

test('first provider dispatch rechecks the full capture window plus margin', async () => {
  const s = setup(); const r = await s.acquire(); s.advance(270001);
  await assert.rejects(r.capability.request({ method: 'GET', url: URL }));
  assert.equal(s.calls.some(c => c.name === 'provider'), false);
  const x = setup(); const ok = await x.acquire(); x.advance(270000);
  assert.equal((await ok.capability.request({ method: 'GET', url: URL })).accepted, true);
  ok.capability.close();
});

test('provider deadline and concurrent use close the capability without late release', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let entered, late, signal;
  let gate = new Promise(resolve => { entered = resolve; });
  const s = setup(s => { s.options.fixtures.provider = input => {
    signal = input.signal; entered(); return new Promise(resolve => { late = () => resolve({ request: input.request, body: { accepted: true } }); });
  }; });
  const r = await s.acquire();
  const pending = r.capability.request({ method: 'GET', url: URL });
  const rejection = assert.rejects(pending); await gate; t.mock.timers.tick(30000); await rejection;
  assert.equal(signal.aborted, true); late(); await Promise.resolve();
  await assert.rejects(r.capability.request({ method: 'GET', url: URL }));
  gate = new Promise(resolve => { entered = resolve; });
  const x = setup(s => { s.options.fixtures.provider = () => { entered(); return new Promise(() => {}); }; });
  const c = await x.acquire(); const first = c.capability.request({ method: 'GET', url: URL });
  const firstRefused = assert.rejects(first); await gate;
  await assert.rejects(c.capability.request({ method: 'GET', url: URL })); await firstRefused;
});
