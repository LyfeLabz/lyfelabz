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

// Hosting analytics boundary (SECURITY_BACKLOG_LAUNCH_URL_ANALYTICS.md, Policy E):
// no third-party analytics runs anywhere in the educational-delivery zone
// (/app/lessons/**: canonical v2 pages, revision renditions, retained variants,
// and the companion pages and shell copy the artifact places beside them), and
// every /app/** response carries an origin-only referrer policy. The policy is
// applied by Hosting response headers, so no lesson HTML, rendition, or retained
// presentation byte changes. Public root pages keep Google Analytics.
const LESSON_DELIVERY_CSP =
  "script-src 'self' 'unsafe-inline' https://apis.google.com https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
const APP_REFERRER_POLICY = 'strict-origin';

// Every external script origin that can run on /app/lessons/** (a <script src> in
// a zone page, or a script URL a same-origin zone script may inject), with an
// explicit policy decision. A new origin, or a new URL on a path-pinned origin,
// fails the guard below until it is decided here AND the CSP is reconciled:
// nothing is silently blocked (a broken page) or silently allowed (an
// analytics/privacy exception).
const EXTERNAL_SCRIPT_DECISIONS = Object.freeze({
  // Google Analytics (gtag.js). The inline snippet in every page is inert under
  // the CSP: gtag.js never loads, so no /g/collect hit is ever sent.
  'https://www.googletagmanager.com': { decision: 'blocked' },
  // Firebase Auth's own gapi loader (js/api.js, then its gapi iframe modules under
  // /_/scs/). The SDK loads it proactively on mobile, Safari, and iOS browsers
  // when getAuth() runs (assessment runtime, and the shell copy's sign-in popup);
  // verified on a mobile user agent against the Hosting emulator. Host-level
  // because the loader chooses its own module paths.
  'https://apis.google.com': { decision: 'allowed', cspSource: 'https://apis.google.com' },
  // jsPDF, pinned to the exact file the Body Systems companion pages use for
  // their PDF export. It loads no further scripts.
  'https://cdnjs.cloudflare.com': {
    decision: 'allowed',
    cspSource: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
  },
  // reCAPTCHA (phone auth / reCAPTCHA Enterprise). Bundled by the Firebase Auth
  // SDK but never invoked: nothing in the zone signs in by phone.
  'https://www.google.com': { decision: 'blocked' }
});

// Same-origin scripts zone pages may load ('self'): the assessment runtime chain
// and, for the shell copy at app/lessons/index.html, the application bundle.
const ZONE_SAME_ORIGIN_SCRIPTS = Object.freeze([
  'app/dist/bundle.js',
  'assets/lyfelabz-assessment-runtime-active.js',
  'assets/lyfelabz-assessment-runtime.js',
  'assets/lyfelabz-firebase-config.js'
]);

// Script features the CSP deliberately does not grant: no 'unsafe-eval', and no
// worker or blob sources.
const UNGRANTED_SCRIPT_FEATURES = /\beval\(|new Function\(|new (?:Shared)?Worker\(/;

// The headers Hosting sends for a request path under the curated config. Only the
// `/prefix/**` glob shape is supported; any other source shape fails so this model
// cannot silently diverge from Hosting's glob semantics (the emulator test below
// verifies the real served headers).
function configuredHeadersFor(requestPath) {
  const firebase = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'firebase.json'), 'utf8'));
  const headers = {};
  for (const rule of firebase.hosting.headers) {
    const match = /^(\/[a-z0-9/-]*?)\/\*\*$/.exec(rule.source);
    assert.ok(match, `unsupported header source shape: ${rule.source}`);
    if (!requestPath.startsWith(`${match[1]}/`)) continue;
    for (const { key, value } of rule.headers) headers[key.toLowerCase()] = value;
  }
  return headers;
}

function lessonDeliveryArtifacts() {
  return result.files.filter((entry) => entry.startsWith('app/lessons/') && entry.endsWith('.html'));
}

function cspScriptSources() {
  const match = /^script-src ([^;]+)$/.exec(LESSON_DELIVERY_CSP);
  assert.ok(match, 'the lesson-delivery CSP is a single script-src directive');
  return match[1].split(' ');
}

test('application Hosting config declares exactly the analytics-boundary headers', () => {
  const firebase = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'firebase.json'), 'utf8'));
  assert.deepEqual(firebase.hosting.headers, [
    { source: '/app/**', headers: [{ key: 'Referrer-Policy', value: APP_REFERRER_POLICY }] },
    { source: '/app/lessons/**', headers: [{ key: 'Content-Security-Policy', value: LESSON_DELIVERY_CSP }] }
  ]);
});

test('lesson-delivery paths receive the analytics-blocking CSP and the referrer policy', () => {
  const zone = lessonDeliveryArtifacts();
  // Canonical v2 pages, revision renditions, every retained variant, and the
  // companion copies.
  assert.ok(zone.some((entry) => /^app\/lessons\/lesson_[a-z0-9-]+\.html$/.test(entry)));
  assert.ok(zone.some((entry) => entry.startsWith('app/lessons/assessment-revisions/')));
  assert.ok(zone.some((entry) => entry.startsWith('app/lessons/variants/')));
  assert.ok(zone.includes('app/lessons/system_nervous.html'));
  for (const entry of zone) {
    assert.deepEqual(configuredHeadersFor(`/${entry}`), {
      'referrer-policy': APP_REFERRER_POLICY,
      'content-security-policy': LESSON_DELIVERY_CSP
    }, entry);
  }
});

test('application shell routes receive only the referrer policy', () => {
  for (const requestPath of ['/app/', '/app/a/test-assignment', '/app/student', '/app/teacher', '/app/signin', '/app/lms-callback.html', '/app/dist/bundle.js']) {
    assert.deepEqual(configuredHeadersFor(requestPath), { 'referrer-policy': APP_REFERRER_POLICY }, requestPath);
  }
});

test('public root pages receive neither header and keep Google Analytics', () => {
  const publicPages = result.files.filter((entry) => !entry.startsWith('app/') && entry.endsWith('.html'));
  assert.ok(publicPages.includes('index.html'));
  assert.ok(publicPages.includes('lesson_what-is-life.html'));
  for (const entry of publicPages) {
    assert.deepEqual(configuredHeadersFor(`/${entry}`), {}, entry);
  }
  for (const entry of ['index.html', 'lesson_what-is-life.html', 'lesson_earths-layers.html', 'system_nervous.html']) {
    assert.match(fs.readFileSync(path.join(outputDirectory, entry), 'utf8'), /googletagmanager\.com\/gtag\/js\?id=G-9QHB5G2B5B/, entry);
  }
});

test('the lesson-delivery CSP blocks analytics and allows exactly the decided script sources', () => {
  const sources = cspScriptSources();
  assert.deepEqual(sources.filter((source) => !source.startsWith('https://')), ["'self'", "'unsafe-inline'"]);
  // No eval, wildcard, scheme-wide, blob:, or data: script source.
  for (const source of sources) assert.doesNotMatch(source, /unsafe-eval|\*|^https?:$|^blob:|^data:/, source);
  const decidedAllowed = Object.values(EXTERNAL_SCRIPT_DECISIONS)
    .filter((entry) => entry.decision === 'allowed')
    .map((entry) => entry.cspSource);
  assert.deepEqual(sources.filter((source) => source.startsWith('https://')), decidedAllowed);
  for (const analyticsOrigin of ['https://www.googletagmanager.com', 'https://www.google-analytics.com', 'https://region1.google-analytics.com']) {
    assert.equal(sources.some((source) => source.startsWith('https://') && new URL(source).origin === analyticsOrigin), false, analyticsOrigin);
  }
});

test('every external script on /app/lessons/** has an explicit analytics-boundary decision', () => {
  const seen = new Set();
  const decide = (url, where) => {
    const { origin } = new URL(url);
    const entry = EXTERNAL_SCRIPT_DECISIONS[origin];
    assert.ok(entry && Object.hasOwn(EXTERNAL_SCRIPT_DECISIONS, origin),
      `${where} loads a script from ${origin}, which has no analytics-boundary decision: add it to EXTERNAL_SCRIPT_DECISIONS and reconcile the /app/lessons/** CSP in firebase.json`);
    if (entry.decision === 'allowed' && entry.cspSource !== origin) {
      assert.equal(url.split(/[?#]/)[0], entry.cspSource,
        `${where} loads ${url}, but the CSP allows only ${entry.cspSource} from ${origin}: decide the new script and reconcile the CSP`);
    }
    seen.add(origin);
  };
  for (const entry of lessonDeliveryArtifacts()) {
    const html = fs.readFileSync(path.join(outputDirectory, entry), 'utf8');
    for (const [, src] of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
      if (/^\/(?!\/)/.test(src)) {
        assert.ok(ZONE_SAME_ORIGIN_SCRIPTS.includes(src.slice(1)), `${entry} loads unexpected same-origin script ${src}`);
        continue;
      }
      decide(src, entry);
    }
    assert.doesNotMatch(html, UNGRANTED_SCRIPT_FEATURES, entry);
  }
  for (const asset of ZONE_SAME_ORIGIN_SCRIPTS) {
    const source = fs.readFileSync(path.join(outputDirectory, asset), 'utf8');
    for (const [url] of source.matchAll(/https:\/\/[a-z0-9.-]+\/[^"'`\s]*\.js\b/g)) decide(url, asset);
    assert.doesNotMatch(source, UNGRANTED_SCRIPT_FEATURES, asset);
  }
  // The decision table stays exact: every decided origin is still observed.
  assert.deepEqual([...seen].sort(), Object.keys(EXTERNAL_SCRIPT_DECISIONS).sort());
});

// Policy E cache transition. Firebase Hosting omits custom headers on 304 Not
// Modified responses, and Policy E changed only headers, so a browser holding a
// pre-policy copy of a zone page would keep reusing it without the CSP. Product
// navigation into the zone therefore replaces the cached copy first (GET, cache
// 'reload'): the application launcher (app/src/assignments/studentList/
// deliveryNavigation.ts) and, for links between delivery pages, the runtime shim.
// These zone pages load no runtime, so links FROM them are not prepared (the
// documented residual in SECURITY_BACKLOG_LAUNCH_URL_ANALYTICS.md); links TO them
// from runtime-bearing pages are.
const ZONE_PAGES_WITHOUT_LINK_PREPARATION = Object.freeze([
  'app/lessons/about_learning-science.html',
  'app/lessons/about_lyfelabz.html',
  'app/lessons/about_privacy.html',
  'app/lessons/body-system-diseases.html',
  'app/lessons/body-system-interactions.html',
  'app/lessons/disease_circulatory.html',
  'app/lessons/disease_digestive.html',
  'app/lessons/disease_excretory.html',
  'app/lessons/disease_immune.html',
  'app/lessons/disease_muscular.html',
  'app/lessons/disease_nervous.html',
  'app/lessons/disease_respiratory.html',
  'app/lessons/disease_skeletal.html',
  'app/lessons/index.html',
  'app/lessons/system_circulatory.html',
  'app/lessons/system_digestive.html',
  'app/lessons/system_excretory.html',
  'app/lessons/system_immune.html',
  'app/lessons/system_muscular.html',
  'app/lessons/system_nervous.html',
  'app/lessons/system_respiratory.html',
  'app/lessons/system_skeletal.html'
]);

test('Policy E cache transition: the runtime shim prepares in-zone links with an unconditional reload', () => {
  const shim = fs.readFileSync(path.join(outputDirectory, 'assets/lyfelabz-assessment-runtime.js'), 'utf8');
  assert.match(shim, /var DELIVERY_ZONE_PREFIX = '\/app\/lessons\/';/);
  assert.match(shim, /method: 'GET',\s*cache: 'reload',\s*credentials: 'same-origin'/);
  assert.match(shim, /response\.arrayBuffer\(\)/);
  assert.doesNotMatch(shim, /cache: 'no-cache'|cache: 'no-store'|method: 'HEAD'/);
});

test('Policy E cache transition: exactly the documented zone pages load no link preparation', () => {
  const without = lessonDeliveryArtifacts().filter((entry) =>
    !fs.readFileSync(path.join(outputDirectory, entry), 'utf8').includes('/assets/lyfelabz-assessment-runtime.js'));
  assert.deepEqual(without, [...ZONE_PAGES_WITHOUT_LINK_PREPARATION]);
});

test('Policy E: the application shell states the /app/** referrer policy in the document too', () => {
  // A shell copy cached before a header change would otherwise revalidate to a
  // headerless 304 and fall back to the browser default referrer policy.
  for (const entry of ['app/index.html', 'app/lessons/index.html']) {
    const html = fs.readFileSync(path.join(outputDirectory, entry), 'utf8');
    const metas = [...html.matchAll(/<meta\s+name="referrer"\s+content="([^"]+)">/g)].map((m) => m[1]);
    assert.deepEqual(metas, [APP_REFERRER_POLICY], entry);
  }
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

  // Analytics boundary: the served headers (not just firebase.json) compose as
  // designed. Both rules apply to /app/lessons/**; neither applies to public pages.
  for (const relativePath of lessonDeliveryArtifacts()) {
    const { response } = await get(`/${relativePath}`);
    assert.equal(response.status, 200, relativePath);
    assert.equal(response.headers.get('content-security-policy'), LESSON_DELIVERY_CSP, relativePath);
    assert.equal(response.headers.get('referrer-policy'), APP_REFERRER_POLICY, relativePath);
  }
  for (const relativePath of [...shellRoutes, '/app/lms-callback.html', '/app/dist/bundle.js']) {
    const { response } = await get(relativePath);
    assert.equal(response.headers.get('referrer-policy'), APP_REFERRER_POLICY, relativePath);
    assert.equal(response.headers.get('content-security-policy'), null, relativePath);
  }
  const publicAnalyticsPages = ['/', '/index.html', '/lesson_what-is-life.html', '/lesson_earths-layers.html', '/about_lyfelabz.html', '/system_nervous.html'];
  for (const relativePath of [...publicAnalyticsPages, '/about_privacy.html', '/assets/lyfelabz-assessment-runtime.js']) {
    const { response, body } = await get(relativePath);
    assert.equal(response.status, 200, relativePath);
    assert.equal(response.headers.get('content-security-policy'), null, relativePath);
    assert.equal(response.headers.get('referrer-policy'), null, relativePath);
    if (publicAnalyticsPages.includes(relativePath)) assert.match(body, /googletagmanager\.com\/gtag\/js/, relativePath);
  }
});
