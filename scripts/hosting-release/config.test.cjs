'use strict';

// Configuration contract for the two-target Hosting release: firebase.json
// targets, .firebaserc mappings, the generated Hosting-only staging config,
// and the actual firebase-tools target-to-site resolution (offline).

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  environmentForProject,
  generateStagingConfig,
  loadContract,
  readConfigFile,
  readHostingTargets,
  readTargetSites,
  repositoryRoot,
  serializeConfig,
  substituteOrigin
} = require('./contract.cjs');
const { checkStagingConfig, renderStagingConfig } = require('./staging-config.cjs');

const production = readConfigFile('firebase.json');
const stagingText = fs.readFileSync(path.join(repositoryRoot, 'firebase.staging.json'), 'utf8');
const staging = JSON.parse(stagingText);

function firebaseTools() {
  const bin = fs.realpathSync(execFileSync('which', ['firebase'], { encoding: 'utf8' }).trim());
  const root = path.dirname(require.resolve('firebase-tools/package.json', { paths: [path.dirname(bin)] }));
  return {
    Config: require(path.join(root, 'lib', 'config.js')).Config,
    loadRC: require(path.join(root, 'lib', 'rc.js')).loadRC,
    hostingConfig: require(path.join(root, 'lib', 'hosting', 'config.js')).hostingConfig
  };
}

function resolveSites(configPath, project, only) {
  const { Config, loadRC, hostingConfig } = firebaseTools();
  const options = { cwd: repositoryRoot, configPath, project, only };
  options.config = Config.load(options);
  options.rc = loadRC(options);
  return hostingConfig(options).map((entry) => `${entry.target}:${entry.site}`);
}

test('firebase.json declares exactly the app and marketing targets and no hard-coded site', () => {
  assert.deepEqual(production.hosting.map((entry) => entry.target), ['app', 'marketing']);
  for (const entry of production.hosting) assert.equal('site' in entry, false, entry.target);
  const targets = readHostingTargets(production);
  assert.equal(targets.app.public, 'dist/app-hosting');
  assert.equal(targets.marketing.public, 'dist/marketing');
  assert.deepEqual(targets.app.predeploy, ['node scripts/hosting-release/build-pair.cjs']);
  assert.deepEqual(targets.marketing.predeploy, ['node scripts/hosting-release/build-pair.cjs']);
  // Non-Hosting resources stay where they were; only the Hosting shape changed.
  assert.deepEqual(Object.keys(production).sort(), ['firestore', 'functions', 'hosting', 'storage']);
});

test('the target reader rejects a single object, a hard-coded site, and a wrong target order', () => {
  const [app, marketing] = production.hosting;
  assert.throws(() => readHostingTargets({ hosting: app }), /array/);
  assert.throws(() => readHostingTargets({ hosting: [app] }), /array/);
  assert.throws(() => readHostingTargets({ hosting: [{ ...app, site: 'lyfelabz-prod' }, marketing] }), /hard-code a site/);
  assert.throws(() => readHostingTargets({ hosting: [marketing, app] }), /target "app"/);
});

test('the old independent marketing config no longer exists', () => {
  assert.equal(fs.existsSync(path.join(repositoryRoot, 'firebase.marketing.json')), false);
});

test('.firebaserc keeps the project aliases and pins every target to exactly one site', () => {
  const rc = JSON.parse(fs.readFileSync(path.join(repositoryRoot, '.firebaserc'), 'utf8'));
  assert.deepEqual(rc.projects, { default: 'lyfelabz-prod', staging: 'lyfelabz-staging' });
  assert.deepEqual(rc.targets, {
    'lyfelabz-prod': { hosting: { app: ['lyfelabz-prod'], marketing: ['lyfelabz-marketing'] } },
    'lyfelabz-staging': { hosting: { app: ['lyfelabz-staging'], marketing: ['lyfelabz-staging-marketing'] } }
  });
  assert.deepEqual(readTargetSites('lyfelabz-prod'), { app: 'lyfelabz-prod', marketing: 'lyfelabz-marketing' });
  assert.deepEqual(readTargetSites('lyfelabz-staging'), { app: 'lyfelabz-staging', marketing: 'lyfelabz-staging-marketing' });
  assert.throws(() => readTargetSites('lyfelabz-unknown'), /no Hosting targets/);
});

test('release tooling requires an explicit supported project and never uses the default alias', () => {
  assert.equal(environmentForProject('lyfelabz-prod').name, 'production');
  assert.equal(environmentForProject('lyfelabz-staging').name, 'staging');
  assert.throws(() => environmentForProject(undefined), /explicit --project/);
  assert.throws(() => environmentForProject('default'), /unsupported project/);
  assert.throws(() => environmentForProject('staging'), /unsupported project/);
});

test('firebase-tools resolves the documented release command to exactly the two production sites', () => {
  assert.deepEqual(resolveSites('firebase.json', 'lyfelabz-prod', 'hosting:app,hosting:marketing'),
    ['app:lyfelabz-prod', 'marketing:lyfelabz-marketing']);
  assert.deepEqual(resolveSites('firebase.json', 'lyfelabz-prod', 'hosting:app'), ['app:lyfelabz-prod']);
});

test('firebase-tools resolves the staging config to the two staging sites', () => {
  assert.deepEqual(resolveSites('firebase.staging.json', 'lyfelabz-staging', 'hosting:app,hosting:marketing'),
    ['app:lyfelabz-staging', 'marketing:lyfelabz-staging-marketing']);
  assert.deepEqual(resolveSites('firebase.staging.json', 'lyfelabz-staging', 'hosting:app'), ['app:lyfelabz-staging']);
});

test('a bare --only hosting now means both sites, and an unmapped project fails closed', () => {
  // Why runbooks and publish-variant must name hosting:app explicitly.
  assert.deepEqual(resolveSites('firebase.json', 'lyfelabz-prod', 'hosting'), ['app:lyfelabz-prod', 'marketing:lyfelabz-marketing']);
  assert.throws(() => resolveSites('firebase.json', 'demo-unmapped', 'hosting:app'), /Deploy target app not configured for project demo-unmapped/);
});

test('firebase.staging.json is the committed deterministic output and is Hosting-only', () => {
  assert.equal(checkStagingConfig().ok, true, 'regenerate with node scripts/hosting-release/staging-config.cjs');
  assert.equal(stagingText, renderStagingConfig());
  assert.equal(stagingText, serializeConfig(generateStagingConfig(production)));
  assert.deepEqual(Object.keys(staging), ['hosting']);
  assert.equal(/lyfelabz\.com/.test(stagingText), false, 'staging config must not reference a production origin');
});

test('staging differs from production only by origin substitution in redirect destinations', () => {
  const contract = loadContract();
  const prod = readHostingTargets(production);
  const stage = readHostingTargets(staging);
  for (const target of ['app', 'marketing']) {
    const { redirects: prodRedirects, ...prodRest } = prod[target];
    const { redirects: stageRedirects, ...stageRest } = stage[target];
    assert.deepEqual(stageRest, prodRest, target);
    assert.equal(stageRedirects.length, prodRedirects.length, target);
    stageRedirects.forEach((rule, index) => {
      const original = prodRedirects[index];
      assert.deepEqual({ ...rule, destination: undefined }, { ...original, destination: undefined });
      let expected = original.destination;
      for (const name of ['app', 'marketing']) {
        const from = contract.environments.production.origins[name];
        if (expected.startsWith(`${from}/`)) expected = contract.environments.staging.origins[name] + expected.slice(from.length);
      }
      assert.equal(rule.destination, expected);
    });
  }
  assert.equal(stage.marketing.redirects.find((rule) => rule.regex).destination, 'https://lyfelabz-staging.web.app/:1');
  assert.equal(stage.app.redirects.find((rule) => rule.source === '/privacy').destination, 'https://lyfelabz-staging-marketing.web.app/privacy');
});

test('origin substitution fails closed on any unmapped absolute destination', () => {
  const map = [['https://app.lyfelabz.com', 'https://stage-app.example'], ['https://lyfelabz.com', 'https://stage.example']];
  assert.equal(substituteOrigin('https://app.lyfelabz.com/:1', map), 'https://stage-app.example/:1');
  assert.equal(substituteOrigin('https://lyfelabz.com/privacy', map), 'https://stage.example/privacy');
  assert.equal(substituteOrigin('/app/index.html', map), '/app/index.html');
  assert.throws(() => substituteOrigin('https://www.lyfelabz.com/blog/', map), /no environment origin mapping/);
  assert.throws(() => substituteOrigin('https://app.lyfelabz.com.evil.example/', map), /no environment origin mapping/);
  const [app, marketing] = production.hosting;
  assert.throws(() => generateStagingConfig({ hosting: [app, { ...marketing, redirects: [{ source: '/x', destination: 'https://example.com/', type: 301 }] }] }), /no environment origin mapping/);
});

test('the hosting contract is well formed and owns no site mappings or file inventories', () => {
  const contract = loadContract();
  assert.deepEqual(contract.paths.hostSpecific, [], 'Phase 1 has no host-specific differences');
  assert.deepEqual(contract.paths.marketingOnly, ['blog/**', 'wonderbox/**']);
  assert.deepEqual(Object.keys(contract), ['$comment', 'schemaVersion', 'targets', 'environments', 'paths', 'redirectSamples', 'routeSamples']);
  assert.deepEqual(Object.keys(contract.paths), ['marketingOnly', 'appOnly', 'appRequired', 'hostSpecific']);
  for (const environment of Object.values(contract.environments)) {
    assert.deepEqual(Object.keys(environment), ['project', 'config', 'origins', 'entryAliases']);
  }
});
