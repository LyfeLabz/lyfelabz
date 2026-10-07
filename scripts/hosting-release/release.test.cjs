'use strict';

// Offline tests for prepare/certify release mechanics: arguments, refusals,
// the exact deploy and rollback commands, live-release parsing, routing
// comparison against Firebase's stored version config, and live byte and
// route checks with an injected fetch.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  environmentForProject,
  loadContract,
  readConfigFile,
  readHostingTargets,
  repositoryRoot,
  sameRouting,
  sha256,
  toApiRouting,
  isRedirected
} = require('./contract.cjs');
const {
  checkSamples,
  compareLiveFiles,
  deployCommand,
  gitState,
  liveRelease,
  parseArgs,
  releaseMessage,
  rollbackCommand,
  shellQuote
} = require('./release.cjs');
const { HOSTING_TEST_FILES, preflight } = require('./prepare.cjs');
const { verifyLocalPair } = require('./certify.cjs');

const SHA = '1169d4db5411697840d080cdd4b6e9d1e66190d1';
const production = environmentForProject('lyfelabz-prod');
const staging = environmentForProject('lyfelabz-staging');
const prodTargets = readHostingTargets(readConfigFile('firebase.json'));
const stagingTargets = readHostingTargets(readConfigFile('firebase.staging.json'));

// Exactly what `firebase hosting:channel:list --json` returned for the live
// production versions on 2026-10-07 (marketing 809b39fe932e23ac, app
// 8f5bb67475554e40): Firebase's stored representation of the routing config.
const LIVE_MARKETING_CONFIG = {
  redirects: [
    { statusCode: 301, location: 'https://app.lyfelabz.com/app/', glob: '/app' },
    { statusCode: 301, location: 'https://app.lyfelabz.com/app/', glob: '/app/' },
    { statusCode: 301, location: 'https://app.lyfelabz.com/:1', regex: '^/(lesson_[a-z0-9-]+\\.html)$' }
  ],
  rewrites: [{ glob: '/privacy', path: '/privacy.html' }, { glob: '/terms', path: '/terms.html' }]
};
const LIVE_APP_CONFIG = {
  headers: [
    { headers: { 'Referrer-Policy': 'strict-origin' }, glob: '/app/**' },
    { headers: { 'Content-Security-Policy': "script-src 'self' 'unsafe-inline' https://apis.google.com https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js" }, glob: '/app/lessons/**' }
  ],
  redirects: [
    { statusCode: 301, location: 'https://lyfelabz.com/privacy', glob: '/privacy' },
    { statusCode: 301, location: 'https://lyfelabz.com/terms', glob: '/terms' }
  ],
  rewrites: ['/app/signin', '/app/onboarding', '/app/pending', '/app/teacher', '/app/student', '/app/a/**'].map((glob) => ({ glob, path: '/app/index.html' }))
};

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url, options });
    const { pathname, search } = new URL(url);
    const origin = new URL(url).origin;
    const key = `${origin}${pathname}${search.startsWith('?hosting-release=') ? '' : search}`;
    const route = routes[key];
    if (!route) return new Response('missing', { status: 404 });
    return new Response(route.body ?? '', { status: route.status ?? 200, headers: route.location ? { location: route.location } : {} });
  };
  impl.calls = calls;
  return impl;
}

test('arguments are explicit: unknown, positional, and valueless arguments are refused', () => {
  assert.deepEqual(parseArgs(['--project', 'lyfelabz-prod', '--offline'], { values: ['project'], flags: ['offline'] }), { project: 'lyfelabz-prod', offline: true });
  assert.throws(() => parseArgs(['--site', 'x'], { values: ['project'], flags: [] }), /unknown argument --site/);
  assert.throws(() => parseArgs(['lyfelabz-prod'], { values: ['project'], flags: [] }), /unexpected argument/);
  assert.throws(() => parseArgs(['--project'], { values: ['project'], flags: [] }), /missing value/);
});

test('the documented deploy commands name both targets, the explicit project, and the source SHA', () => {
  assert.equal(shellQuote(deployCommand(production, releaseMessage(SHA, false))),
    `firebase deploy --only hosting:app,hosting:marketing --project lyfelabz-prod --message 'release ${SHA}' --non-interactive`);
  assert.equal(shellQuote(deployCommand(staging, releaseMessage(SHA, false))),
    `firebase deploy --only hosting:app,hosting:marketing --config firebase.staging.json --project lyfelabz-staging --message 'release ${SHA}' --non-interactive`);
  for (const environment of [production, staging]) {
    const command = deployCommand(environment, releaseMessage(SHA, false));
    assert.equal(command.includes('hosting'), false, 'never a bare --only hosting');
    assert.equal(command[command.indexOf('--only') + 1], 'hosting:app,hosting:marketing');
  }
  assert.equal(releaseMessage(SHA, true), `release ${SHA} uncommitted`);
  assert.throws(() => releaseMessage('1169d4d', false), /full commit SHA/);
});

test('rollback uses the verified hosting:clone <site>@<version> <site>:live form', () => {
  assert.deepEqual(rollbackCommand('lyfelabz-prod', 'lyfelabz-marketing', '809b39fe932e23ac'),
    ['firebase', 'hosting:clone', 'lyfelabz-marketing@809b39fe932e23ac', 'lyfelabz-marketing:live', '--project', 'lyfelabz-prod']);
  assert.throws(() => rollbackCommand('lyfelabz-prod', 'lyfelabz-prod', 'live'), /invalid rollback target/);
  assert.throws(() => rollbackCommand('lyfelabz-prod', 'lyfelabz-prod:live', 'abc'), /invalid rollback target/);
});

test('git state reports the SHA and every uncommitted change', () => {
  const run = (command, args) => (args[0] === 'rev-parse' ? `${SHA}\n` : ' M firebase.json\n?? new.txt\n');
  assert.deepEqual(gitState(repositoryRoot, run), { sha: SHA, dirty: true, changes: [' M firebase.json', '?? new.txt'] });
  assert.deepEqual(gitState(repositoryRoot, (c, args) => (args[0] === 'rev-parse' ? SHA : '')), { sha: SHA, dirty: false, changes: [] });
});

test('prepare preflight refuses unsafe release conditions before building anything', () => {
  const clean = () => ({ sha: SHA, dirty: false, changes: [] });
  const dirty = () => ({ sha: SHA, dirty: true, changes: [' M index.html'] });
  assert.throws(() => preflight({ project: undefined }, { git: clean }), /explicit --project/);
  assert.throws(() => preflight({ project: 'default' }, { git: clean }), /unsupported project/);
  assert.throws(() => preflight({ project: 'lyfelabz-prod' }, { git: dirty }), /not clean/);
  assert.throws(() => preflight({ project: 'lyfelabz-prod', allowDirty: true }, { git: dirty }), /not permitted for production/);
  assert.throws(() => preflight({ project: 'lyfelabz-prod', offline: true }, { git: clean }), /must record live baselines/);
  assert.throws(() => preflight({ project: 'lyfelabz-prod', expectSha: 'f'.repeat(40) }, { git: clean }), /expected f{40}/);
  const ok = preflight({ project: 'lyfelabz-prod', expectSha: SHA }, { git: clean });
  assert.deepEqual(ok.sites, { app: 'lyfelabz-prod', marketing: 'lyfelabz-marketing' });
  assert.equal(ok.message, `release ${SHA}`);
  const stagingDirty = preflight({ project: 'lyfelabz-staging', allowDirty: true, offline: true }, { git: dirty });
  assert.equal(stagingDirty.message, `release ${SHA} uncommitted`);
  assert.deepEqual(stagingDirty.sites, { app: 'lyfelabz-staging', marketing: 'lyfelabz-staging-marketing' });
});

test('prepare runs every Hosting suite, including these release tests', () => {
  for (const file of HOSTING_TEST_FILES) assert.ok(fs.existsSync(path.join(repositoryRoot, file)), file);
  const suites = fs.readdirSync(__dirname).filter((name) => name.endsWith('.test.cjs')).map((name) => `scripts/hosting-release/${name}`);
  for (const suite of suites) assert.ok(HOSTING_TEST_FILES.includes(suite), suite);
});

test('the live release is read from hosting:channel:list, with its version, message, and routing config', () => {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    return JSON.stringify({ status: 'success', result: { channels: [
      { name: 'projects/lyfelabz-prod/sites/lyfelabz-marketing/channels/preview', release: null },
      { name: 'projects/lyfelabz-prod/sites/lyfelabz-marketing/channels/live', release: {
        version: { name: 'projects/lyfelabz-prod/sites/lyfelabz-marketing/versions/809b39fe932e23ac', config: LIVE_MARKETING_CONFIG },
        releaseTime: '2026-10-06T12:48:19.898Z' } }
    ] } });
  };
  const live = liveRelease({ project: 'lyfelabz-prod', site: 'lyfelabz-marketing', run });
  assert.deepEqual(calls[0], ['firebase', 'hosting:channel:list', '--site', 'lyfelabz-marketing', '--project', 'lyfelabz-prod', '--json', '--non-interactive']);
  assert.equal(live.version, '809b39fe932e23ac');
  assert.equal(live.message, null);
  assert.deepEqual(live.config, LIVE_MARKETING_CONFIG);
  const failed = () => { const error = new Error('exit 1'); error.stdout = JSON.stringify({ status: 'error', error: 'Not Found' }); throw error; };
  assert.throws(() => liveRelease({ project: 'lyfelabz-staging', site: 'lyfelabz-staging-marketing', run: failed }), /Not Found/);
});

test('local routing config matches Firebase\'s stored version config exactly, for both production targets', () => {
  assert.equal(sameRouting(prodTargets.marketing, LIVE_MARKETING_CONFIG), true);
  assert.equal(sameRouting(prodTargets.app, LIVE_APP_CONFIG), true);
  // The staging config intentionally differs in redirect destinations only.
  assert.equal(sameRouting(stagingTargets.marketing, LIVE_MARKETING_CONFIG), false);
  const changed = { ...LIVE_MARKETING_CONFIG, redirects: LIVE_MARKETING_CONFIG.redirects.slice(0, 2) };
  assert.equal(sameRouting(prodTargets.marketing, changed), false);
  assert.throws(() => toApiRouting({ rewrites: [{ source: '/x', function: 'f' }] }), /path rewrites/);
});

test('redirect shadowing follows the exact source and anchored regex rules', () => {
  assert.equal(isRedirected('/lesson_carbon-cycle.html', prodTargets.marketing), true);
  assert.equal(isRedirected('/app/', prodTargets.marketing), true);
  assert.equal(isRedirected('/', prodTargets.marketing), false);
  assert.equal(isRedirected('/app/lessons/lesson_carbon-cycle.html', prodTargets.marketing), false);
  assert.equal(isRedirected('/lesson_carbon-cycle.html', prodTargets.app), false);
  assert.throws(() => isRedirected('/x', { redirects: [{ source: '/blog/**', destination: '/', type: 301 }] }), /unsupported redirect source/);
});

test('live byte comparison is cache-busted and classifies unchanged, changed, missing, and redirected paths', async () => {
  const directory = fs.mkdtempSync(path.join(repositoryRoot, 'dist', 'hosting-release-test-'));
  try {
    fs.mkdirSync(path.join(directory, 'blog'));
    fs.writeFileSync(path.join(directory, 'index.html'), 'home');
    fs.writeFileSync(path.join(directory, 'blog', 'index.html'), 'blog');
    fs.writeFileSync(path.join(directory, 'asset.js'), 'new');
    fs.writeFileSync(path.join(directory, 'lesson_x.html'), 'lesson');
    fs.writeFileSync(path.join(directory, 'added.html'), 'added');
    const fetchImpl = fakeFetch({
      'https://site.test/': { body: 'home' },
      'https://site.test/blog/': { body: 'blog' },
      'https://site.test/asset.js': { body: 'old' }
    });
    const result = await compareLiveFiles({
      origin: 'https://site.test', directory, files: ['added.html', 'asset.js', 'blog/index.html', 'index.html', 'lesson_x.html'], entry: prodTargets.marketing, fetchImpl, nonce: 'n'
    });
    assert.deepEqual(result, { unchanged: ['blog/index.html', 'index.html'], changed: ['asset.js'], missing: ['added.html (HTTP 404)'], redirected: ['lesson_x.html'] });
    assert.ok(fetchImpl.calls.every((call) => call.url.endsWith('?hosting-release=n') && call.options.redirect === 'manual'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('route and redirect samples expand the environment origins and report every mismatch', async () => {
  const contract = loadContract();
  const origins = staging.origins;
  const routes = {};
  for (const sample of contract.redirectSamples) {
    routes[`${origins[sample.target]}${sample.path}`] = { status: sample.status, location: sample.location.replace('{app}', origins.app).replace('{marketing}', origins.marketing) };
  }
  for (const sample of contract.routeSamples) routes[`${origins[sample.target]}${sample.path}`] = { status: sample.status };
  assert.deepEqual(await checkSamples({ contract, origins, fetchImpl: fakeFetch(routes) }), []);
  assert.equal(routes['https://lyfelabz-staging-marketing.web.app/lesson_carbon-cycle.html'].location, 'https://lyfelabz-staging.web.app/lesson_carbon-cycle.html');
  delete routes['https://lyfelabz-staging.web.app/blog/'];
  routes['https://lyfelabz-staging.web.app/blog/'] = { status: 200 };
  routes['https://lyfelabz-staging-marketing.web.app/app/'] = { status: 301, location: 'https://app.lyfelabz.com/app/' };
  const failures = await checkSamples({ contract, origins, fetchImpl: fakeFetch(routes) });
  assert.equal(failures.length, 2);
  assert.match(failures.join('\n'), /marketing \/app\/: expected 301 -> https:\/\/lyfelabz-staging\.web\.app\/app\//);
  assert.match(failures.join('\n'), /app \/blog\/: expected 404, got 200/);
});

test('certification refuses artifacts that changed after the recorded pair build', () => {
  const root = fs.mkdtempSync(path.join(repositoryRoot, 'dist', 'hosting-certify-test-'));
  try {
    const directories = { app: path.join(root, 'app'), marketing: path.join(root, 'marketing') };
    for (const directory of Object.values(directories)) {
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, 'index.html'), 'home');
    }
    const record = { kind: 'lyfelabz.hostingPairBuild', files: { app: { 'index.html': sha256('home') }, marketing: { 'index.html': sha256('home') } } };
    verifyLocalPair(record, directories);
    fs.writeFileSync(path.join(directories.marketing, 'index.html'), 'changed');
    assert.throws(() => verifyLocalPair(record, directories), /marketing artifact changed/);
    assert.throws(() => verifyLocalPair(null, directories), /no pair-build record/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
