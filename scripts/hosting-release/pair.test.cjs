'use strict';

// Pair ownership and parity gate over real app and marketing builds. Builds
// into private dist/ subdirectories so it never disturbs dist/app-hosting or
// dist/marketing (other Hosting suites snapshot those concurrently).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildApplicationArtifact } = require('../app-hosting/build.cjs');
const { buildMarketingArtifact } = require('../marketing-hosting/build.cjs');
const { spliceCatalog } = require('../../app/scripts/curriculumCatalog.cjs');
const { APP_BUNDLE_BUILD } = require('./build-pair.cjs');
const {
  loadContract,
  readConfigFile,
  readHostingTargets,
  repositoryRoot,
  requestPathFor,
  servedFiles,
  verifyPair
} = require('./contract.cjs');

const root = path.join(repositoryRoot, 'dist', `hosting-pair-test-${process.pid}`);
const appDirectory = path.join(root, 'app');
const marketingDirectory = path.join(root, 'marketing');
const config = readConfigFile('firebase.json');
const targets = readHostingTargets(config);

function clone(name) {
  const destination = path.join(root, `${name}-${Math.random().toString(36).slice(2)}`);
  fs.cpSync(name === 'app' ? appDirectory : marketingDirectory, destination, { recursive: true });
  return destination;
}

test.before(() => {
  buildApplicationArtifact({ outputDirectory: appDirectory });
  buildMarketingArtifact({ outputDirectory: marketingDirectory });
});

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test('a coherent pair passes: every shared served path, including the homepage and runtime assets, is byte-identical', () => {
  const result = verifyPair({ appDirectory, marketingDirectory, config });
  assert.ok(result.shared > 100);
  assert.equal(result.identical, result.shared);
  assert.equal(result.hostSpecific, 0);
  for (const file of ['index.html', 'assets/lyfelabz-assessment-runtime.js', 'assets/lyfelabz-assessment-runtime-active.js']) {
    assert.deepEqual(fs.readFileSync(path.join(appDirectory, file)), fs.readFileSync(path.join(marketingDirectory, file)), file);
  }
  assert.deepEqual(fs.readFileSync(path.join(appDirectory, 'index.html')), fs.readFileSync(path.join(repositoryRoot, 'index.html')));
});

test('served inventories model Hosting ignore: blog and Wonder Box are built into the app artifact but never served by it', () => {
  const app = servedFiles(appDirectory, targets.app);
  const marketing = servedFiles(marketingDirectory, targets.marketing);
  assert.ok(fs.existsSync(path.join(appDirectory, 'blog', 'index.html')));
  assert.ok(fs.existsSync(path.join(appDirectory, 'wonderbox', 'index.html')));
  assert.equal(app.some((file) => file.startsWith('blog/') || file.startsWith('wonderbox/')), false);
  assert.ok(marketing.includes('blog/index.html'));
  assert.ok(marketing.includes('wonderbox/index.html'));
  assert.ok(app.includes('app/lms-callback.html'));
  assert.equal(marketing.some((file) => file.startsWith('app/')), false);
});

test('a stale shared runtime asset on one surface fails the pair', () => {
  const marketing = clone('marketing');
  fs.appendFileSync(path.join(marketing, 'assets', 'lyfelabz-assessment-runtime.js'), '\n// stale\n');
  assert.throws(() => verifyPair({ appDirectory, marketingDirectory: marketing, config }), /shared path assets\/lyfelabz-assessment-runtime\.js differs/);
});

test('differing homepage copies fail the pair', () => {
  const app = clone('app');
  fs.appendFileSync(path.join(app, 'index.html'), '\n<!-- drift -->\n');
  assert.throws(() => verifyPair({ appDirectory: app, marketingDirectory, config }), /shared path index\.html differs/);
});

test('a catalog that disagrees with the registry fails even when both copies agree', () => {
  const app = clone('app');
  const marketing = clone('marketing');
  const stale = spliceCatalog(fs.readFileSync(path.join(appDirectory, 'index.html'), 'utf8'), '    <!-- stale -->\n');
  fs.writeFileSync(path.join(app, 'index.html'), stale);
  fs.writeFileSync(path.join(marketing, 'index.html'), stale);
  assert.throws(() => verifyPair({ appDirectory: app, marketingDirectory: marketing, config }), /DRIFT/);
});

test('marketing-only paths exposed by the app target fail the pair', () => {
  const exposed = { hosting: [{ ...targets.app, ignore: targets.app.ignore.filter((glob) => glob !== 'blog/**') }, targets.marketing] };
  assert.throws(() => verifyPair({ appDirectory, marketingDirectory, config: exposed }), /app serves marketing-only path blog\/index\.html/);
});

test('app-only paths served by marketing fail the pair', () => {
  const marketing = clone('marketing');
  fs.mkdirSync(path.join(marketing, 'app'), { recursive: true });
  fs.writeFileSync(path.join(marketing, 'app', 'index.html'), fs.readFileSync(path.join(appDirectory, 'app', 'index.html')));
  assert.throws(() => verifyPair({ appDirectory, marketingDirectory: marketing, config }), /marketing serves app-only path app\/index\.html/);
});

test('a shared marketing path missing from the app artifact fails the pair', () => {
  const app = clone('app');
  fs.rmSync(path.join(app, 'extension_fossil-hunt.html'));
  assert.throws(() => verifyPair({ appDirectory: app, marketingDirectory, config }), /extension_fossil-hunt\.html is served by marketing but not by app/);
});

test('a missing required application path fails the pair', () => {
  const app = clone('app');
  fs.rmSync(path.join(app, 'app', 'lms-callback.html'));
  assert.throws(() => verifyPair({ appDirectory: app, marketingDirectory, config }), /app does not serve required path app\/lms-callback\.html/);
});

test('a declared host-specific exception is the only way two shared copies may differ', () => {
  const marketing = clone('marketing');
  fs.appendFileSync(path.join(marketing, 'robots.txt'), '# marketing host\n');
  const contract = loadContract();
  assert.throws(() => verifyPair({ appDirectory, marketingDirectory: marketing, config, contract }), /robots\.txt differs/);
  const withException = { ...contract, paths: { ...contract.paths, hostSpecific: [{ path: 'robots.txt', reason: 'test' }] } };
  const result = verifyPair({ appDirectory, marketingDirectory: marketing, config, contract: withException });
  assert.equal(result.hostSpecific, 1);
  assert.equal(result.identical, result.shared - 1);
  const stale = { ...contract, paths: { ...contract.paths, hostSpecific: [{ path: 'not-served.txt', reason: 'test' }] } };
  assert.throws(() => verifyPair({ appDirectory, marketingDirectory, config, contract: stale }), /not served by both targets/);
});

test('the pair build runs the application bundle build and both predeploys use it', () => {
  assert.deepEqual(APP_BUNDLE_BUILD, ['npm', ['--prefix', 'app', 'run', 'build']]);
  for (const target of ['app', 'marketing']) assert.deepEqual(targets[target].predeploy, ['node scripts/hosting-release/build-pair.cjs']);
});

test('directory indexes are requested by their directory URL', () => {
  assert.equal(requestPathFor('index.html'), '/');
  assert.equal(requestPathFor('ball1/index.html'), '/ball1/');
  assert.equal(requestPathFor('assets/x.js'), '/assets/x.js');
});
