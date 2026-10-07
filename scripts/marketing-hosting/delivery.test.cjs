'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { once } = require('node:events');
const test = require('node:test');
const { certifyPublicEntry, lessonLinks } = require('./certify-delivery.cjs');
const { buildMarketingArtifact, repositoryRoot } = require('./build.cjs');
const { buildApplicationArtifact } = require('../app-hosting/build.cjs');

// Use Firebase CLI's actual Hosting emulator implementation, including RE2
// capture substitution, redirect precedence and query-string handling.
const firebaseBin = fs.realpathSync(execFileSync('which', ['firebase'], { encoding: 'utf8' }).trim());
const { server: superstatic } = require(require.resolve('superstatic', { paths: [path.dirname(firebaseBin)] }));
const { readConfigFile, readHostingTargets } = require('../hosting-release/contract.cjs');
const { app: appConfig, marketing: marketingConfig } = readHostingTargets(readConfigFile('firebase.json'));
const directory = path.join(repositoryRoot, 'dist', `delivery-test-${process.pid}`);
const marketingArtifact = path.join(directory, 'marketing');
const appArtifact = path.join(directory, 'app');
const servers = [];
let appOrigin;
let publicOrigin;

async function serve(config, root) {
  const server = superstatic({ config: { ...config, public: '.' }, cwd: root, stack: 'strict', port: 0, hostname: '127.0.0.1' }).listen();
  await once(server, 'listening');
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

function entryConfig(origin) {
  return { ...marketingConfig, redirects: marketingConfig.redirects.map((rule) => ({
    ...rule, destination: rule.destination.replace('https://app.lyfelabz.com',
      // superstatic's path-to-regexp treats an unescaped local port as a capture.
      rule.regex ? origin.replace(/:(\d+)$/, '\\:$1') : origin)
  })) };
}

test.before(async () => {
  buildMarketingArtifact({ outputDirectory: marketingArtifact });
  buildApplicationArtifact({ outputDirectory: appArtifact });
  appOrigin = await serve(appConfig, appArtifact);
  publicOrigin = await serve(entryConfig(appOrigin), marketingArtifact);
});

test.after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); })));
  fs.rmSync(directory, { recursive: true, force: true });
});

test('public catalog navigation reaches current app bytes for every lesson, including Carbon and Renewable', async () => {
  const result = await certifyPublicEntry({ entry: publicOrigin, canonical: appOrigin, artifact: appArtifact });
  assert.equal(result.lessonCount, 50);
  assert.equal(result.checked, 52);
});

test('marketing redirects take precedence over stale static lessons and retain queries', async () => {
  for (const name of ['lesson_carbon-cycle.html', 'lesson_renewable-and-nonrenewable-resources.html']) {
    fs.writeFileSync(path.join(marketingArtifact, name), '<!doctype html><title>STALE</title>');
    const response = await fetch(`${publicOrigin}/${name}?mode=educator&delivery-cert=legacy`, { redirect: 'manual' });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), `${appOrigin}/${name}?mode=educator&delivery-cert=legacy`);
  }
  await certifyPublicEntry({ entry: publicOrigin, canonical: appOrigin, artifact: appArtifact });
});

test('same split-host routing is exercised with a staging destination, never production', async () => {
  const stagingOrigin = 'https://lyfelabz-staging.web.app';
  const stagingEntry = await serve(entryConfig(stagingOrigin), marketingArtifact);
  for (const name of ['lesson_carbon-cycle.html', 'lesson_renewable-and-nonrenewable-resources.html']) {
    const response = await fetch(`${stagingEntry}/${name}`, { redirect: 'manual' });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), `${stagingOrigin}/${name}`);
  }
});

test('lesson rule excludes authenticated/revision routes and unrelated marketing pages', async () => {
  const rule = marketingConfig.redirects.find((entry) => entry.regex);
  assert.equal(rule.destination, 'https://app.lyfelabz.com/:1');
  assert.equal(rule.type, 301);
  for (const route of ['/', '/privacy', '/terms', '/blog/', '/wonderbox/', '/investigation_gray-zone.html',
    '/app/lessons/lesson_carbon-cycle.html', '/app/a/example',
    '/app/lessons/assessment-revisions/lesson_renewable-and-nonrenewable-resources__r1.html',
    '/app/lessons/assessment-revisions/lesson_renewable-and-nonrenewable-resources__r2.html',
    '/lesson_carbon-cycle.html/extra', '/nested/lesson_carbon-cycle.html']) {
    assert.equal(new RegExp(rule.regex).test(route), false, route);
  }
  for (const route of ['/', '/privacy', '/terms', '/blog/', '/wonderbox/', '/investigation_gray-zone.html']) {
    const response = await fetch(publicOrigin + route, { redirect: 'manual' });
    assert.equal(response.status, 200, route);
  }
  for (const revision of ['r1', 'r2']) {
    const route = `/app/lessons/assessment-revisions/lesson_renewable-and-nonrenewable-resources__${revision}.html`;
    const response = await fetch(appOrigin + route);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join(repositoryRoot, route)));
  }
});

test('gate rejects the original split-host bug even when there are 50 valid links', async () => {
  const brokenEntry = await serve({ ...marketingConfig, redirects: [] }, marketingArtifact);
  await assert.rejects(certifyPublicEntry({ entry: brokenEntry, canonical: appOrigin, artifact: appArtifact }), /wrong final origin/);
});

test('gate rejects stale bytes on the correct host', async () => {
  const carbon = path.join(appArtifact, 'lesson_carbon-cycle.html');
  const current = fs.readFileSync(carbon);
  try {
    fs.writeFileSync(carbon, '<!doctype html><title>OLD</title>');
    await assert.rejects(certifyPublicEntry({ entry: publicOrigin, canonical: appOrigin, artifact: repositoryRoot }), /stale or incorrect lesson bytes/);
  } finally {
    fs.writeFileSync(carbon, current);
  }
});

test('catalog parsing uses actual browser URL resolution, including base URLs and absolute links', () => {
  const links = lessonLinks('<base href="https://www.lyfelabz.com/"><a href="lesson_carbon-cycle.html">Lesson</a><a href="https://app.lyfelabz.com/lesson_renewable-and-nonrenewable-resources.html">Lesson</a>', 'https://example.test/catalog/');
  assert.equal(links[0].href, 'https://www.lyfelabz.com/lesson_carbon-cycle.html');
  assert.equal(links[1].origin, 'https://app.lyfelabz.com');
});
