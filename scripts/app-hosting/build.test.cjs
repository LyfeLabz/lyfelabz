'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  artifactFiles,
  assertRegularSource,
  buildApplicationArtifact,
  collectApprovedCopies,
  findLeakedDevelopmentPath,
  listApprovedCopies,
  readApplicationManifest,
  readAssessmentRevisionCopies,
  readRetainedVariantCopies,
  validateApprovedCopies,
  validateBundleHygiene,
  validateDestinationPolicy,
  validateOutputDirectory,
  validateRelativePath
} = require('./build.cjs');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const outputDirectory = path.join(repositoryRoot, 'dist', `app-hosting-test-${process.pid}`);
const fixtureRoot = path.join(repositoryRoot, 'dist', `app-hosting-fixture-${process.pid}`);
const marketingDirectory = path.join(repositoryRoot, 'dist', 'marketing');
const emulatorUrl = process.env.APP_HOSTING_EMULATOR_URL || '';
let result;
let marketingBefore;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function directorySnapshot(root) {
  if (!fs.existsSync(root)) return null;
  return Object.fromEntries(
    artifactFiles(root).map((relativePath) => [relativePath, sha256(fs.readFileSync(path.join(root, relativePath)))]),
  );
}

function writeFixture(relativePath, contents) {
  const absolutePath = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
  return absolutePath;
}

function writeVariantManifest(entries) {
  writeFixture('app/lessons/variants/manifest.json', `${JSON.stringify(entries, null, 2)}\n`);
}

function validVariantFixture() {
  const bytes = Buffer.from('<!doctype html><title>retained fixture</title>');
  const digest = sha256(bytes);
  const presentationRevisionId = `pr${digest}`;
  const relativePath = `app/lessons/variants/lesson_fixture-lesson__${presentationRevisionId}.html`;
  writeFixture(relativePath, bytes);
  const entry = {
    lessonSlug: 'fixture-lesson',
    variantKey: 'fixture-key',
    presentationRevisionId,
    path: relativePath,
    sha256: digest,
    publishedAt: '2026-01-01T00:00:00.000Z'
  };
  return { entry, relativePath };
}

test.before(() => {
  marketingBefore = directorySnapshot(marketingDirectory);
  result = buildApplicationArtifact({ outputDirectory });
});

test.after(() => {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

test('approved application inventory is explicit, sorted, exact, and deterministic', () => {
  const manifest = readApplicationManifest();
  assert.deepEqual(manifest.files, [...manifest.files].sort());
  assert.deepEqual(manifest.copies.map((entry) => entry.destination), manifest.copies.map((entry) => entry.destination).sort());
  assert.deepEqual(artifactFiles(outputDirectory), result.files);
  assert.deepEqual(result.files, collectApprovedCopies().map((entry) => entry.destination).sort());
  assert.deepEqual(buildApplicationArtifact({ outputDirectory }).files, result.files);
});

test('the unvalidated approved list is exactly what validated collection returns', () => {
  assert.deepEqual(collectApprovedCopies(), listApprovedCopies());
});

test('bundle hygiene accepts legitimate bundle content', () => {
  const legitimate = [
    '// node_modules/@firebase/util/dist/index.esm2017.js',
    '"node_modules/@firebase/component/dist/esm/index.esm2017.js"() {',
    '// src/assignments/detail/detail.ts',
    'canonicalSourceRelativeToApp: "../index.html",',
    'fetch("https://example.com/Users/profile/avatar.png")',
    'const docs = "https://docs.example.org/home/getting-started/";',
    'history.pushState({}, "", "/app/teacher");',
    'const note = "Users/teachers can reorder classes";',
    'var re = /^[A-Za-z]:$/;',
  ].join('\n');
  assert.equal(findLeakedDevelopmentPath(legitimate), null);
});

test('bundle hygiene rejects leaked absolute development paths', () => {
  const leaks = [
    '// ../../../../../../../../Users/breezy/Documents/GitHub/lyfelabz/app/node_modules/@firebase/util/dist/index.esm2017.js',
    '"../../../../Users/dev/repo/app/node_modules/x/index.js"() {',
    '// /Users/someone/repo/app/node_modules/firebase/app.js',
    '// ../../../home/runner/work/lyfelabz/app/node_modules/x.js',
    '"/home/dev/lyfelabz/app/node_modules/x.js"',
    '// ../../../../private/var/folders/ab/xyz/T/checkout/app/node_modules/x.js',
    '// ../../private/tmp/release-wt/app/node_modules/x.js',
    '"C:\\\\Users\\\\dev\\\\repo\\\\app\\\\node_modules\\\\x.js"',
    '// C:/Users/dev/repo/app/node_modules/x.js',
    '// D:\\Documents and Settings\\dev\\repo\\x.js',
  ];
  for (const sample of leaks) assert.notEqual(findLeakedDevelopmentPath(`var a = 1;\n${sample}\nvar b = 2;`), null, sample);
});

test('bundle hygiene fails the artifact build closed on a leaked path', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'lyfelabz-bundle-hygiene-'));
  try {
    fs.mkdirSync(path.join(dir, 'app/dist'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'app/dist/bundle.js'), '// src/index.ts\nconsole.log(1);\n');
    assert.deepEqual(validateBundleHygiene(dir), { bundlesChecked: 2, clean: true });
    fs.writeFileSync(
      path.join(dir, 'app/dist/bundle.js'),
      '// ../../../../Users/dev/repo/app/node_modules/@firebase/util/dist/index.esm2017.js\n',
    );
    assert.throws(() => validateBundleHygiene(dir), /embeds a local development path/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('unsafe paths, traversal, absolute paths, duplicates, missing files, and symlinks fail closed', () => {
  assert.throws(() => validateRelativePath('../firebase.json'), /unsafe/i);
  assert.throws(() => validateRelativePath('/etc/passwd'), /unsafe/i);
  assert.throws(() => validateRelativePath('app\\src\\index.ts'), /unsafe/i);
  assert.throws(() => validateRelativePath('app//index.html'), /unsafe/i);
  assert.throws(() => validateOutputDirectory(repositoryRoot), /child/i);
  assert.throws(() => validateDestinationPolicy('.git/HEAD'), /forbidden/i);
  assert.throws(() => validateDestinationPolicy('app/src/index.ts'), /forbidden/i);
  assert.throws(() => validateDestinationPolicy('app/dist/index.html'), /stale/i);

  writeFixture('safe.txt', 'safe');
  assert.throws(
    () => validateApprovedCopies([
      { source: 'safe.txt', destination: 'same.txt' },
      { source: 'safe.txt', destination: 'same.txt' }
    ], fixtureRoot),
    /duplicate/i,
  );
  assert.throws(() => assertRegularSource(fixtureRoot, 'missing.txt'), /missing input/i);

  fs.symlinkSync(path.join(fixtureRoot, 'safe.txt'), path.join(fixtureRoot, 'linked.txt'));
  assert.throws(() => assertRegularSource(fixtureRoot, 'linked.txt'), /symlink/i);
});

test('rebuild removes stale files before recreating the approved artifact', () => {
  const stale = path.join(outputDirectory, 'stale-injected-file.txt');
  fs.writeFileSync(stale, 'must disappear');
  assert.equal(fs.existsSync(stale), true);
  buildApplicationArtifact({ outputDirectory });
  assert.equal(fs.existsSync(stale), false);
});

test('retained variants are integrity checked and their private manifest is excluded', () => {
  const { entry, relativePath } = validVariantFixture();
  writeVariantManifest([entry]);
  assert.deepEqual(readRetainedVariantCopies(fixtureRoot).map((copy) => copy.destination), [relativePath]);

  writeVariantManifest([entry, entry]);
  assert.throws(() => readRetainedVariantCopies(fixtureRoot), /duplicate/i);

  writeVariantManifest([{ ...entry, path: '../escaped.html' }]);
  assert.throws(() => readRetainedVariantCopies(fixtureRoot), /unsafe/i);

  writeVariantManifest([{ ...entry, path: relativePath.replace(/\.html$/, '.json') }]);
  assert.throws(() => readRetainedVariantCopies(fixtureRoot), /unexpected/i);

  writeVariantManifest([{
    ...entry,
    lessonSlug: 'missing-lesson',
    path: relativePath.replace('fixture-lesson', 'missing-lesson')
  }]);
  assert.throws(() => readRetainedVariantCopies(fixtureRoot), /missing input/i);

  assert.equal(result.files.includes('app/lessons/variants/manifest.json'), false);
});

// F5.3 Slice 9B: the revision-to-path table ships, and renditions enter the
// artifact only when the table names them.
function writeRevisionTable(lessons) {
  writeFixture(
    'app/lessons/assessment-revisions/revision-paths.json',
    `${JSON.stringify({ schemaVersion: 1, kind: 'lyfelabz.assessmentRevisionPaths', lessons }, null, 2)}\n`,
  );
}

test('the revision path table ships with exactly the Earth\'s Layers r1 and r2 renditions it names', () => {
  assert.equal(result.files.includes('app/lessons/assessment-revisions/revision-paths.json'), true);
  assert.equal(result.assessmentRevisionRenditions, 2);
  assert.deepEqual(result.files.filter((entry) => entry.startsWith('app/lessons/assessment-revisions/')).sort(), [
    'app/lessons/assessment-revisions/lesson_earths-layers__r1.html',
    'app/lessons/assessment-revisions/lesson_earths-layers__r2.html',
    'app/lessons/assessment-revisions/revision-paths.json'
  ]);
  const shipped = JSON.parse(fs.readFileSync(path.join(outputDirectory, 'app/lessons/assessment-revisions/revision-paths.json'), 'utf8'));
  assert.equal(Object.keys(shipped.lessons).length, 49);
  // 48 single-revision lessons map r1 to their unversioned page; Earth's
  // Layers maps r1 and r2 to their renditions, which ship as copies.
  const table = readAssessmentRevisionCopies();
  assert.equal(table.pageTargets.length, 48);
  assert.equal(table.pageTargets.includes('app/lessons/lesson_earths-layers.html'), false);
  assert.deepEqual(table.copies.map((copy) => copy.destination).sort(), [
    'app/lessons/assessment-revisions/lesson_earths-layers__r1.html',
    'app/lessons/assessment-revisions/lesson_earths-layers__r2.html',
    'app/lessons/assessment-revisions/revision-paths.json'
  ]);
});

test('renditions are included only through the revision path table', () => {
  const rendition = 'app/lessons/assessment-revisions/lesson_fixture-lesson__r2.html';
  writeFixture('app/lessons/assessment-revisions/lesson_fixture-lesson__r1.html', '<!doctype html>');
  writeFixture(rendition, '<!doctype html>');
  writeFixture('app/lessons/assessment-revisions/unlisted.html', '<!doctype html>');
  writeRevisionTable({
    'fixture-lesson': {
      'assessment_fixture-lesson__r1': '/app/lessons/assessment-revisions/lesson_fixture-lesson__r1.html',
      'assessment_fixture-lesson__r2': `/${rendition}`
    },
    'other-lesson': { 'assessment_other-lesson__r1': '/app/lessons/lesson_other-lesson.html' }
  });
  const { copies, pageTargets } = readAssessmentRevisionCopies(fixtureRoot);
  assert.deepEqual(copies.map((copy) => copy.destination), [
    'app/lessons/assessment-revisions/revision-paths.json',
    'app/lessons/assessment-revisions/lesson_fixture-lesson__r1.html',
    rendition
  ]);
  assert.deepEqual(pageTargets, ['app/lessons/lesson_other-lesson.html']);

  for (const [lessons, pattern] of [
    [{ 'fixture-lesson': { 'assessment_fixture-lesson__r2': '/app/lessons/variants/x.html' } }, /unexpected path/],
    [{ 'fixture-lesson': { 'assessment_fixture-lesson__r2': '/app/lessons/assessment-revisions/lesson_fixture-lesson__r1.html' } }, /unexpected path/],
    [{ 'fixture-lesson': { 'assessment_other-lesson__r1': '/app/lessons/lesson_other-lesson.html' } }, /invalid revision/],
    [{ 'fixture-lesson': { 'assessment_fixture-lesson__r01': `/${rendition}` } }, /invalid revision/],
    [{ '../x': { 'assessment_x__r1': '/app/lessons/lesson_x.html' } }, /invalid revision path table lesson/],
    [{ 'fixture-lesson': {} }, /at least one revision/]
  ]) {
    writeRevisionTable(lessons);
    assert.throws(() => readAssessmentRevisionCopies(fixtureRoot), pattern);
  }
  writeFixture('app/lessons/assessment-revisions/revision-paths.json', '{"schemaVersion":1,"kind":"other","lessons":{}}');
  assert.throws(() => readAssessmentRevisionCopies(fixtureRoot), /revision path table must be/);
  writeRevisionTable({ 'fixture-lesson': { 'assessment_fixture-lesson__r3': '/app/lessons/assessment-revisions/lesson_fixture-lesson__r3.html' } });
  const missing = readAssessmentRevisionCopies(fixtureRoot).copies;
  assert.throws(() => validateApprovedCopies(missing, fixtureRoot), /missing input/i);
});

test('required application, lesson, root, and runtime files are present', () => {
  const required = [
    'index.html',
    'app/index.html',
    'app/lms-callback.html',
    'app/dist/bundle.js',
    'app/lessons/lesson_what-is-life.html',
    'app/lessons/index.html',
    'app/lessons/favicon.ico',
    'lesson_what-is-life.html',
    'investigation_gray-zone.html',
    'favicon.ico',
    'assets/lyfelabz-firebase-config.js',
    'assets/lyfelabz-assessment-runtime.js',
    'assets/lyfelabz-assessment-runtime-active.js',
    'assets/present-mode-return.js'
  ];
  for (const relativePath of required) assert.equal(result.files.includes(relativePath), true, relativePath);

  const lessonCount = result.files.filter((entry) => /^app\/lessons\/lesson_[^/]+\.html$/.test(entry)).length;
  assert.equal(lessonCount, 49);
  assert.deepEqual(
    fs.readFileSync(path.join(outputDirectory, 'app/dist/bundle.js')),
    fs.readFileSync(path.join(repositoryRoot, 'app/dist/bundle.js')),
  );
  assert.equal(result.dependencyValidation.referencesValid, true);
});

test('repository, source, configuration, tooling, and private files are absent', () => {
  const forbidden = [
    '.git/HEAD',
    '.git/index',
    'app/src/index.ts',
    'app/src/firebase-config.ts',
    'app/package.json',
    'app/package-lock.json',
    'app/tsconfig.json',
    'app/jest.config.js',
    'app/scripts/build-lessons.cjs',
    'platform/functions/src/index.ts',
    'firebase.json',
    '.firebaserc',
    '.github/workflows/platform-ci.yml',
    '.claude/launch.json',
    'firestore-debug.log',
    'ChallengeSeries_GScript.js',
    'app/lessons/variants/manifest.json',
    'app/dist/index.html',
    'app/dist/assets/index-Cn8_kigJ.js'
  ];
  for (const relativePath of forbidden) assert.equal(result.files.includes(relativePath), false, relativePath);
  for (const relativePath of result.files) {
    assert.equal(/(^|\/)\.(?:git|github|claude|firebase)(?:\/|$)/.test(relativePath), false, relativePath);
    assert.equal(relativePath.endsWith('.ts'), false, relativePath);
    assert.equal(/(^|\/)app\/(?:src|scripts)(?:\/|$)/.test(relativePath), false, relativePath);
    assert.equal(/(^|\/)(?:platform|docs|lesson-sources)(?:\/|$)/.test(relativePath), false, relativePath);
    assert.equal(/(^|\/)(?:package(?:-lock)?\.json|(?:firebase|firestore)-debug\.log)$/.test(relativePath), false, relativePath);
  }
});

test('application Hosting config is curated and routes only the certified SPA paths', () => {
  const firebase = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'firebase.json'), 'utf8'));
  assert.equal(firebase.hosting.public, 'dist/app-hosting');
  assert.deepEqual(firebase.hosting.predeploy, ['npm --prefix app run build && node scripts/app-hosting/build.cjs']);
  assert.deepEqual(firebase.hosting.redirects, [
    { source: '/privacy', destination: 'https://lyfelabz.com/privacy', type: 301 },
    { source: '/terms', destination: 'https://lyfelabz.com/terms', type: 301 }
  ]);
  assert.deepEqual(firebase.hosting.rewrites, [
    { source: '/app/signin', destination: '/app/index.html' },
    { source: '/app/onboarding', destination: '/app/index.html' },
    { source: '/app/pending', destination: '/app/index.html' },
    { source: '/app/teacher', destination: '/app/index.html' },
    { source: '/app/student', destination: '/app/index.html' },
    { source: '/app/a/**', destination: '/app/index.html' }
  ]);
  assert.equal(firebase.hosting.rewrites.some((rule) => rule.source === '/app/**' || rule.source === '**'), false);
});

test('application artifact build leaves the certified marketing artifact and config unchanged', () => {
  assert.deepEqual(directorySnapshot(marketingDirectory), marketingBefore);
  const marketing = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'firebase.marketing.json'), 'utf8'));
  assert.equal(marketing.hosting.target, 'marketing');
  assert.equal(marketing.hosting.public, 'dist/marketing');
  assert.deepEqual(marketing.hosting.predeploy, ['node scripts/marketing-hosting/build.cjs']);
});

test('Firebase Hosting emulator serves certified routes and rejects forbidden paths', { skip: !emulatorUrl }, async () => {
  async function get(relativePath) {
    const response = await fetch(new URL(relativePath, emulatorUrl), { redirect: 'manual' });
    return { response, body: await response.text() };
  }

  const shellRoutes = ['/app/', '/app/signin', '/app/onboarding', '/app/pending', '/app/teacher', '/app/student', '/app/a/test-assignment'];
  for (const relativePath of shellRoutes) {
    const { response, body } = await get(relativePath);
    assert.equal(response.status, 200, relativePath);
    assert.match(body, /id="app-root"/, relativePath);
    assert.match(body, /\/app\/dist\/bundle\.js/, relativePath);
  }

  const staticRoutes = [
    '/',
    '/app/lms-callback.html',
    '/app/dist/bundle.js',
    '/app/lessons/lesson_what-is-life.html',
    '/lesson_what-is-life.html',
    '/assets/lyfelabz-firebase-config.js',
    '/assets/lyfelabz-assessment-runtime.js',
    '/assets/lyfelabz-assessment-runtime-active.js',
    '/assets/present-mode-return.js'
  ];
  for (const relativePath of staticRoutes) {
    const { response } = await get(relativePath);
    assert.equal(response.status, 200, relativePath);
  }

  const normalized = await get('/app');
  assert.equal(normalized.response.status, 301);
  assert.equal(normalized.response.headers.get('location'), '/app/');

  const forbiddenRoutes = [
    '/app/not-a-real-route',
    '/app/lessons/not-a-real-lesson.html',
    '/app/src/index.ts',
    '/app/package.json',
    '/app/scripts/build-lessons.cjs',
    '/.git/HEAD',
    '/.git/index',
    '/.github/workflows/platform-ci.yml',
    '/.claude/launch.json',
    '/firestore-debug.log',
    '/platform/functions/src/index.ts',
    '/firebase.json',
    '/.firebaserc',
    '/app/lessons/variants/manifest.json',
    '/definitely-not-a-real-path'
  ];
  for (const relativePath of forbiddenRoutes) {
    const { response, body } = await get(relativePath);
    assert.equal(response.status, 404, relativePath);
    assert.doesNotMatch(body, /id="app-root"/, relativePath);
  }

  for (const relativePath of result.files.filter((entry) => entry.startsWith('app/lessons/variants/') && entry.endsWith('.html'))) {
    const { response } = await get(`/${relativePath}`);
    assert.equal(response.status, 200, relativePath);
  }
});
