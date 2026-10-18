'use strict';

// D13 Part C: provider file-manifest normalization and gzip-hash binding. All
// provider responses are synthetic.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');
const zlib = require('node:zlib');

const M = require('./provider-manifest.cjs');

const ROOT = path.resolve(__dirname, '../..');
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const h = c => c.repeat(64);
const VERSION = 'projects/lyfelabz-staging/sites/lyfelabz-staging/versions/abc123';

// Fixed byte-level vectors: gzip level 9 output of known inputs. Only the header OS
// byte (offset 9) differs between Node's macOS (0x13) and Linux (0x03) builds.
const VECTORS = {
  empty: { input: '', gzip: { 0x13: '1f8b080000000000021303000000000000000000', 0x03: '1f8b080000000000020303000000000000000000' },
    sha256: { 0x13: 'f1b651238a58fe290baec6c5e32f3bdb1943dd2bd582f02569231f7a757c7837', 0x03: 'f61f27bd17de546264aa58f40f3aafaac7021e0ef69c17f6b1b4cd7664a037ec' } },
  hello: { input: 'hello\n', gzip: { 0x13: '1f8b0800000000000213cb48cdc9c9e7020020303a3606000000', 0x03: '1f8b0800000000000203cb48cdc9c9e7020020303a3606000000' },
    sha256: { 0x13: 'bf2e28565987a6a86adafa166f43c1872bd154ee4871b722dcdf2db16faa5246', 0x03: '4925d2d4a2e887f938e428cb8c890c598b485c906ae241975c01be1dcc373c51' } }
};

function page(files, requestPageToken = null, nextPageToken) {
  const response = { files };
  if (nextPageToken !== undefined) response.nextPageToken = nextPageToken;
  return { requestPageToken, response };
}
function entry(p, hash = h('e'), status = 'ACTIVE') { return { path: p, hash, status }; }
function manifestInput() {
  return {
    expected: { project: 'lyfelabz-staging', projectNumber: '293337283840', site: 'lyfelabz-staging', versionName: VERSION },
    version: { name: VERSION, status: 'FINALIZED', fileCount: 3 },
    provenance: { kind: 'synthetic-fixture', tool: 'provider-manifest.test', source: M.PROVIDER_SOURCE, observedAt: '2026-10-18T12:03:30.000Z' },
    pages: [page([entry('/index.html'), entry('/app/dist/bundle.js')], null, 'tok-1'), page([entry('/old.html')], 'tok-1')]
  };
}
function refuses(mutate, reason) {
  const i = manifestInput(); mutate(i);
  assert.throws(() => M.normalizeProviderManifest(i), reason);
}

const BYTES = { 'index.html': Buffer.from('<p>home</p>\n'), 'app/dist/bundle.js': Buffer.from('console.log(1);\n'), 'old.html': Buffer.from('old\n') };
function bindingInput(overrides = {}) {
  const local = M.localGzipManifest(BYTES);
  const providerFiles = Object.entries(local.files).map(([p, e]) => entry(p, e.gzipSha256));
  const mi = manifestInput();
  mi.pages = [page(providerFiles)];
  return { manifest: M.normalizeProviderManifest(mi), uploaded: Object.keys(BYTES), local, deployProfile: clone(local.profile), ...overrides };
}
function clone(v) { return JSON.parse(JSON.stringify(v)); }

test('fixed gzip SHA-256 vectors: hash of known compressed bytes', () => {
  for (const v of Object.values(VECTORS)) for (const os of [0x13, 0x03])
    assert.equal(sha256(Buffer.from(v.gzip[os], 'hex')), v.sha256[os]);
});

test('local gzip reproduces the fixed vectors byte for byte for this runtime header OS', () => {
  const profile = M.compressionProfile();
  assert.ok([0x13, 0x03].includes(profile.header.os), `unexpected gzip header OS ${profile.header.os}`);
  assert.deepEqual({ mtime: profile.header.mtime, xfl: profile.header.xfl }, { mtime: 0, xfl: 2 });
  for (const v of Object.values(VECTORS)) {
    const bytes = zlib.gzipSync(Buffer.from(v.input), { level: 9 });
    assert.equal(bytes.toString('hex'), v.gzip[profile.header.os]);
    assert.equal(M.gzipSha256(Buffer.from(v.input)), v.sha256[profile.header.os]);
  }
  assert.equal(profile.calibration.empty, VECTORS.empty.sha256[profile.header.os]);
  assert.equal(profile.calibration['hello-newline'], VECTORS.hello.sha256[profile.header.os]);
});

test('firebase-tools streaming createGzip({ level: 9 }) equals the reproduction at any chunking', async () => {
  for (const make of Object.values(M.CALIBRATION_VECTORS)) {
    const bytes = make();
    for (const size of [1, 7, 1000, 65536]) {
      const parts = [];
      for (let i = 0; i < bytes.length; i += size) parts.push(bytes.subarray(i, i + size));
      const gzip = zlib.createGzip({ level: 9 });
      Readable.from(parts.length ? parts : [Buffer.alloc(0)]).pipe(gzip);
      const hash = crypto.createHash('sha256');
      for await (const chunk of gzip) hash.update(chunk);
      assert.equal(hash.digest('hex'), M.gzipSha256(bytes));
    }
  }
});

test('the reproduction matches the local firebase-tools uploader, when installed', t => {
  let source;
  try { source = fs.readFileSync(require.resolve('firebase-tools/lib/deploy/hosting/uploader.js', { paths: [path.join(ROOT, 'platform/firebase')] }), 'utf8'); }
  catch { t.skip('firebase-tools not installed locally'); return; }
  assert.match(source, /zlib\.createGzip\(\{ level: this\.gzipLevel \}\)/);
  assert.match(source, /this\.gzipLevel = options\.gzipLevel \|\| 9/);
  assert.match(source, /crypto\.createHash\("sha256"\)/);
  assert.match(source, /this\.populateBatch\["\/" \+ filePath\] = hash/);
});

test('compression profile records runtime provenance and parameters', () => {
  const p = M.compressionProfile();
  assert.equal(p.node, process.versions.node);
  assert.equal(p.zlib, process.versions.zlib);
  assert.deepEqual(p.parameters, { level: 9, windowBits: 15, memLevel: 8, strategy: 0 });
  assert.equal(p.hashAlgorithm, 'sha256');
  assert.equal(p.container, 'gzip');
  assert.match(p.reference, /firebase-tools 15\.22\.4/);
  assert.deepEqual(Object.keys(p.calibration).sort(), Object.keys(M.CALIBRATION_VECTORS).sort());
  assert.ok(Object.isFrozen(p) && Object.isFrozen(p.calibration));
  M.validateProfile(clone(p), 'profile');
});

test('complete paginated manifest normalizes', () => {
  const m = M.normalizeProviderManifest(manifestInput());
  assert.deepEqual(Object.keys(m.files), ['/app/dist/bundle.js', '/index.html', '/old.html']);
  assert.equal(m.pageCount, 2);
  assert.equal(m.fileCount, 3);
  assert.equal(m.hashEncoding, 'sha256-of-gzip');
  assert.deepEqual(m.provenance, { kind: 'synthetic-fixture', tool: 'provider-manifest.test', source: M.PROVIDER_SOURCE, observedAt: '2026-10-18T12:03:30.000Z' });
  assert.ok(Object.isFrozen(m) && Object.isFrozen(m.files));
  const unprefixed = manifestInput(); unprefixed.expected.versionName = unprefixed.version.name = 'sites/lyfelabz-staging/versions/abc123';
  assert.equal(M.normalizeProviderManifest(unprefixed).versionName, 'sites/lyfelabz-staging/versions/abc123');
});

test('pagination must be complete, ordered and terminating', () => {
  refuses(i => { i.pages.pop(); }, /last page has a continuation token/);
  refuses(i => { i.pages.shift(); }, /does not continue the previous page/);
  refuses(i => { i.pages.reverse(); }, /does not continue the previous page/);
  refuses(i => { i.pages[1].requestPageToken = 'tok-2'; }, /does not continue/);
  refuses(i => { i.pages = []; }, /no provider manifest pages/);
  refuses(i => { i.pages[0].response.nextPageToken = ''; }, /malformed pages\[0\] continuation token/);
  refuses(i => { i.pages[0].response.nextPageToken = 7; }, /malformed pages\[0\] continuation token/);
  refuses(i => { i.pages[0].response.nextPageToken = 'bad token'; }, /malformed pages\[0\] continuation token/);
  refuses(i => { i.pages[1].response.nextPageToken = 'tok-1'; i.pages.push(page([], 'tok-1')); }, /repeats a continuation token/);
  refuses(i => { delete i.pages[0].response.nextPageToken; }, /ends pagination but more pages follow/);
  refuses(i => { i.pages[0].response.nextPageToken = undefined; }, /undefined pages\[0\].response field/);
});

test('file set, count, status, paths and hashes', () => {
  refuses(i => { i.pages[1].response.files.push(entry('/index.html')); }, /duplicate provider path: \/index.html/);
  refuses(i => { i.version.fileCount = 4; }, /file count 3 is not the version fileCount 4/);
  refuses(i => { i.version.fileCount = 2; }, /file count 3/);
  refuses(i => { i.version.fileCount = '3'; }, /malformed version fileCount/);
  refuses(i => { i.pages[0].response.files[0].status = 'EXPECTED'; }, /status EXPECTED is not ACTIVE/);
  refuses(i => { i.pages[0].response.files[0].status = 'STATUS_UNSPECIFIED'; }, /is not ACTIVE/);
  for (const bad of ['index.html', '//index.html', '/a//b', '/../x', '/a/./b', '/a\\b', '/', ''])
    refuses(i => { i.pages[0].response.files[0].path = bad; }, /malformed pages\[0\].response.files\[0\].path/);
  for (const bad of ['E'.repeat(64), 'e'.repeat(63), '', null])
    refuses(i => { i.pages[0].response.files[0].hash = bad; }, /malformed pages\[0\].response.files\[0\].hash/);
});

test('identity: project, site and version are explicit', () => {
  refuses(i => { i.version.name = 'projects/lyfelabz-staging/sites/lyfelabz-staging/versions/abc124'; }, /not the expected version/);
  refuses(i => { i.expected.versionName = i.version.name = 'projects/lyfelabz-prod/sites/lyfelabz-staging/versions/abc123'; }, /another site or project/);
  refuses(i => { i.expected.versionName = i.version.name = 'projects/lyfelabz-staging/sites/lyfelabz-prod/versions/abc123'; }, /another site or project/);
  refuses(i => { i.expected.versionName = i.version.name = 'sites/lyfelabz-staging/versions/ABC'; }, /malformed expected version name/);
  refuses(i => { i.expected.projectNumber = 293337283840; }, /malformed expected project number/);
  for (const status of ['CREATED', 'CLONING', 'EXPIRED', 'DELETED', 'ABANDONED'])
    refuses(i => { i.version.status = status; }, /is not FINALIZED/);
  const number = manifestInput(); number.expected.versionName = number.version.name = 'projects/293337283840/sites/lyfelabz-staging/versions/abc123';
  assert.equal(M.normalizeProviderManifest(number).project, 'lyfelabz-staging');
});

test('provenance and unknown or malformed fields refuse', () => {
  refuses(i => { i.provenance.kind = 'live-capture'; }, /unsupported provenance kind/);
  refuses(i => { i.provenance.source = 'firebase-cli'; }, /unsupported provenance source/);
  refuses(i => { i.provenance.observedAt = 'now'; }, /malformed provenance timestamp/);
  refuses(i => { i.extra = 1; }, /unknown provider manifest input field: extra/);
  refuses(i => { i.pages[0].response.files[0].size = 1; }, /unknown pages\[0\].response.files\[0\] field: size/);
  refuses(i => { i.pages[0].response.kind = 'x'; }, /unknown pages\[0\].response field: kind/);
  refuses(i => { i.pages[0].extra = 1; }, /unknown pages\[0\] field/);
  refuses(i => { i.pages.extra = 1; }, /non-index properties/);
  refuses(i => { Object.defineProperty(i.version, 'status', { enumerable: true, get: () => 'FINALIZED' }); }, /enumerable data field/);
  refuses(i => { i.version[Symbol('x')] = 1; }, /symbol keys/);
  refuses(i => { i.pages[0].response.files = {}; }, /must be an array/);
});

test('binding: reproducible matching hashes are bound, and bound grants nothing', () => {
  const r = M.bindProviderManifest(bindingInput());
  assert.equal(r.binding, 'bound');
  assert.equal(r.reason, null);
  assert.equal(r.comparedFiles, 3);
  assert.deepEqual(r.mismatchedPaths, []);
  assert.equal(r.servingEstablished, false);
  assert.equal(r.scope, 'content-to-provider-manifest');
  assert.ok(Object.isFrozen(r));
});

test('binding: reproducible differing hashes are a mismatch', () => {
  const i = bindingInput();
  const mi = manifestInput();
  mi.pages = [page(Object.entries(i.local.files).map(([p, e]) => entry(p, p === '/old.html' ? sha256(BYTES['old.html']) : e.gzipSha256)))];
  i.manifest = M.normalizeProviderManifest(mi);
  const r = M.bindProviderManifest(i);
  assert.equal(r.binding, 'mismatch');
  assert.deepEqual(r.mismatchedPaths, ['/old.html']);
});

test('binding: incompatible or unrecorded compression profiles are unreproducible', () => {
  assert.equal(M.bindProviderManifest(bindingInput({ deployProfile: null })).reason, 'deploy compression profile was not recorded');
  const cases = [
    [p => { p.header.os = p.header.os === 0x13 ? 0x03 : 0x13; }, /gzip header os differs/],
    [p => { p.calibration['patterned-300000'] = h('0'); }, /calibration vector patterned-300000 differs/],
    [p => { p.parameters.level = 6; }, /deploy profile level is 6, not 9/],
    [p => { p.parameters.strategy = 1; }, /strategy/]
  ];
  for (const [mutate, reason] of cases) {
    const i = bindingInput(); mutate(i.deployProfile);
    const r = M.bindProviderManifest(i);
    assert.equal(r.binding, 'unreproducible'); assert.match(r.reason, reason);
    assert.equal(r.comparedFiles, 0); assert.deepEqual(r.mismatchedPaths, []);
  }
  // Identical version strings never prove identical output.
  const same = bindingInput(); same.deployProfile.calibration['all-bytes'] = h('1');
  assert.equal(same.deployProfile.node, same.local.profile.node);
  assert.equal(M.bindProviderManifest(same).binding, 'unreproducible');
  // Differing version strings with byte-identical calibration remain comparable.
  const other = bindingInput(); other.deployProfile.node = '0.0.0'; other.deployProfile.zlib = 'other';
  assert.equal(M.bindProviderManifest(other).binding, 'bound');
});

test('binding: incomplete or ambiguous evidence refuses', () => {
  const t = (mutate, reason) => { const i = bindingInput(); mutate(i); assert.throws(() => M.bindProviderManifest(i), reason); };
  t(i => { i.uploaded.pop(); }, /provider manifest unexpected/);
  t(i => { i.uploaded.push('new.html'); }, /provider manifest missing: \/new.html/);
  t(i => { i.uploaded.push('index.html'); }, /duplicate uploaded path/);
  t(i => { i.local = { profile: i.local.profile, files: { ...i.local.files } }; delete i.local.files['/old.html']; }, /local gzip evidence missing: \/old.html/);
  t(i => { i.manifest = { ...i.manifest, fileCount: 4 }; }, /manifest file count differs/);
  t(i => { i.manifest = { ...i.manifest, versionStatus: 'CREATED' }; }, /unsupported manifest/);
  t(i => { i.deployProfile.kind = 'other'; }, /unsupported deploy profile/);
  t(i => { delete i.deployProfile.calibration.empty; }, /missing deploy profile.calibration field: empty/);
  t(i => { i.deployProfile.extra = 1; }, /unknown deploy profile field/);
  t(i => { delete i.deployProfile; }, /missing binding input field: deployProfile/);
});

test('local gzip evidence never uses modification times or the Firebase hash cache', () => {
  const source = fs.readFileSync(path.join(__dirname, 'provider-manifest.cjs'), 'utf8');
  assert.doesNotMatch(source, /\.mtime|mtimeMs|hashcache|\.firebase\/|statSync|require\('node:(fs|http|https|net|child_process)'\)|fetch\(|process\.env|Date\.now\(|new Date\(/);
  assert.throws(() => M.localGzipManifest({ 'a.html': 'text' }), /must be a Buffer/);
  assert.throws(() => M.localGzipManifest({ '/a.html': Buffer.alloc(0) }), /malformed local file path/);
});

test('no release, deployment, activation or Functions path consumes this module', () => {
  const consumers = [];
  function walk(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'lib', 'dist', '.git'].includes(item.name)) continue;
      const file = path.join(directory, item.name);
      if (item.isDirectory()) walk(file);
      else if (/\.(c?js|ts|json|ya?ml)$/.test(item.name)) {
        const rel = path.relative(ROOT, file);
        let source = fs.readFileSync(file, 'utf8');
        // prepare.cjs may only list this test suite in HOSTING_TEST_FILES; it never requires the module.
        if (rel === 'scripts/hosting-release/prepare.cjs') {
          const listing = "  'scripts/hosting-release/provider-manifest.test.cjs',\n";
          assert.equal(source.split(listing).length, 2, 'prepare.cjs lists the suite exactly once');
          source = source.replace(listing, '');
        }
        if (source.includes('provider-manifest')) consumers.push(rel);
      }
    }
  }
  for (const directory of ['scripts', 'app/scripts', 'app/src', 'platform', '.github']) walk(path.join(ROOT, directory));
  // The Part B verifier is the only consumer, and it is itself unconsumed.
  assert.deepEqual(consumers.sort(), ['scripts/hosting-release/hosting-deployment.cjs', 'scripts/hosting-release/hosting-deployment.test.cjs',
    'scripts/hosting-release/provider-manifest.cjs', 'scripts/hosting-release/provider-manifest.test.cjs']);
});
