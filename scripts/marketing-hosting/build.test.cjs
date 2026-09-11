'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildMarketingArtifact,
  readManifest,
  repositoryRoot,
  stripLeadingFrontMatter,
  validateManifestEntry,
  validateOutputDirectory
} = require('./build.cjs');

const testOutputDirectory = path.join(repositoryRoot, 'dist', `marketing-test-${process.pid}`);

function artifactFiles(root) {
  const results = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else results.push(path.relative(root, absolutePath).split(path.sep).join('/'));
    }
  }
  visit(root);
  return results.sort();
}

test.before(() => {
  buildMarketingArtifact({ outputDirectory: testOutputDirectory });
});

test.after(() => {
  fs.rmSync(testOutputDirectory, { recursive: true, force: true });
});

test('manifest and output are exact, explicit, and fail closed', () => {
  assert.deepEqual(artifactFiles(testOutputDirectory), readManifest());
  assert.throws(() => validateManifestEntry('../firebase.json'), /Unsafe/);
  assert.throws(() => validateManifestEntry('/etc/passwd'), /Unsafe/);
  assert.throws(() => validateOutputDirectory(repositoryRoot), /must be a child/);
});

test('intentional public routes and representative content are present', () => {
  const required = [
    'index.html',
    'assets/lyfelabz-assessment-runtime.js',
    'favicon.ico',
    'ls-badges.css',
    'privacy.html',
    'terms.html',
    'blog/index.html',
    'blog/teach-what-is-life-6th-grade.html',
    'wonderbox/index.html',
    'lesson_what-is-life.html',
    'robots.txt',
    'sitemap.xml'
  ];

  for (const relativePath of required) {
    assert.equal(fs.existsSync(path.join(testOutputDirectory, relativePath)), true, relativePath);
  }
});

test('only legal-page YAML front matter is removed from marketing output', () => {
  for (const relativePath of ['privacy.html', 'terms.html']) {
    const source = fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
    const output = fs.readFileSync(path.join(testOutputDirectory, relativePath), 'utf8');

    assert.match(source, /^---\r?\n[\s\S]*?\r?\n---\r?\n<!DOCTYPE html>/);
    assert.equal(output.startsWith('---'), false, relativePath);
    assert.match(output, /^<!DOCTYPE html>/);
    assert.match(output, /LyfeLabz/);
    assert.equal(output, stripLeadingFrontMatter(source, relativePath));
  }

  for (const relativePath of ['index.html', 'lesson_what-is-life.html']) {
    const source = fs.readFileSync(path.join(repositoryRoot, relativePath));
    const output = fs.readFileSync(path.join(testOutputDirectory, relativePath));
    assert.deepEqual(output, source, relativePath);
  }
});

test('repository-internal content is absent', () => {
  const forbidden = [
    'platform/functions/src/index.ts',
    'app/src/index.ts',
    'firebase.json',
    'firebase.marketing.json',
    '.firebaserc',
    'package.json',
    'package-lock.json',
    'docs',
    'tests',
    'scripts',
    '.github'
  ];

  for (const relativePath of forbidden) {
    assert.equal(fs.existsSync(path.join(testOutputDirectory, relativePath)), false, relativePath);
  }

  for (const relativePath of artifactFiles(testOutputDirectory)) {
    assert.equal(relativePath.endsWith('.ts'), false, relativePath);
    assert.equal(/(^|\/)\.env(?:\.|$)/.test(relativePath), false, relativePath);
    assert.equal(/(^|\/)(?:test|tests)(?:\/|\.|$)/i.test(relativePath), false, relativePath);
    assert.equal(/(^|\/)package(?:-lock)?\.json$/.test(relativePath), false, relativePath);
  }
});

test('public artifact makes no anonymous GitHub repository API request', () => {
  for (const relativePath of artifactFiles(testOutputDirectory)) {
    const contents = fs.readFileSync(path.join(testOutputDirectory, relativePath));
    assert.equal(contents.includes(Buffer.from('api.github.com/repos/lyfelabz/lyfelabz')), false, relativePath);
  }
});

test('marketing Hosting config is isolated from the existing application config', () => {
  const marketing = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'firebase.marketing.json'), 'utf8'));
  const application = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'firebase.json'), 'utf8'));
  const firebaseRc = JSON.parse(fs.readFileSync(path.join(repositoryRoot, '.firebaserc'), 'utf8'));

  assert.deepEqual(Object.keys(marketing), ['hosting']);
  assert.equal(marketing.hosting.target, 'marketing');
  assert.equal(marketing.hosting.public, 'dist/marketing');
  assert.deepEqual(marketing.hosting.predeploy, ['node scripts/marketing-hosting/build.cjs']);
  assert.equal(marketing.hosting.rewrites.some((rule) => rule.source === '**'), false);
  assert.deepEqual(marketing.hosting.rewrites, [
    { source: '/privacy', destination: '/privacy.html' },
    { source: '/terms', destination: '/terms.html' }
  ]);
  assert.deepEqual(marketing.hosting.redirects, [
    { source: '/app', destination: 'https://app.lyfelabz.com/app/', type: 301 },
    { source: '/app/', destination: 'https://app.lyfelabz.com/app/', type: 301 }
  ]);
  assert.equal(marketing.hosting.redirects.some((rule) => rule.source.includes('*')), false);
  assert.equal(marketing.hosting.redirects.some((rule) => rule.source.includes(':')), false);
  assert.equal(marketing.hosting.redirects.some((rule) => rule.source === '/app/src/index.ts'), false);
  assert.equal(marketing.hosting.redirects.some((rule) => rule.source === '/app/package.json'), false);
  assert.equal(marketing.hosting.redirects.some((rule) => rule.source === '/app/foo/bar'), false);

  assert.equal(application.hosting.public, '.');
  assert.equal(application.hosting.target, undefined);
  assert.deepEqual(application.hosting.rewrites, [{ source: '/app/**', destination: '/app/index.html' }]);
  assert.equal(application.hosting.ignore.includes('firebase.marketing.json'), true);
  assert.equal(application.hosting.ignore.includes('scripts/marketing-hosting/**'), true);
  assert.equal(application.hosting.ignore.includes('dist/marketing/**'), true);
  assert.equal(firebaseRc.projects.default, 'lyfelabz-prod');
  assert.deepEqual(firebaseRc.targets['lyfelabz-prod'].hosting.marketing, ['lyfelabz-marketing']);
});
