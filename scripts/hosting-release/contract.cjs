'use strict';

// The LyfeLabz two-target Hosting contract: reading firebase.json's targets
// and .firebaserc, generating the Hosting-only staging config, modeling the
// files each target actually serves, and the pair parity gate. Everything
// here is offline and deterministic; network checks live in release.cjs.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { minimatch } = require('../../app/node_modules/minimatch');
const { FIREBASE_BUILTIN_IGNORES, isHostingIgnored } = require('../../app/scripts/lessonBuilder/hostingExclusion.cjs');
const { assertCatalogCurrent } = require('../../app/scripts/curriculumCatalog.cjs');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const contractPath = path.join(__dirname, 'hosting-contract.json');
const productionConfigFile = 'firebase.json';
const stagingConfigFile = 'firebase.staging.json';
const TARGETS = Object.freeze(['app', 'marketing']);

function fail(message) {
  throw new Error(`[hosting-release] ${message}`);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isOrigin(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value;
  } catch {
    return false;
  }
}

function loadContract(file = contractPath) {
  const contract = readJson(file);
  if (contract.schemaVersion !== 1) fail('hosting contract schemaVersion must be 1');
  if (JSON.stringify(contract.targets) !== JSON.stringify(TARGETS)) fail('hosting contract must declare exactly the app and marketing targets');
  const environments = contract.environments || {};
  if (JSON.stringify(Object.keys(environments)) !== JSON.stringify(['production', 'staging'])) {
    fail('hosting contract must declare exactly the production and staging environments');
  }
  const projects = new Set();
  for (const [name, environment] of Object.entries(environments)) {
    if (typeof environment.project !== 'string' || projects.has(environment.project)) fail(`environment ${name} needs a unique project`);
    projects.add(environment.project);
    for (const target of TARGETS) {
      if (!isOrigin(environment.origins?.[target])) fail(`environment ${name} needs an exact https origin for ${target}`);
    }
    if (!Array.isArray(environment.entryAliases) || !environment.entryAliases.every(isOrigin)) {
      fail(`environment ${name} entryAliases must be https origins`);
    }
  }
  if (environments.production.config !== productionConfigFile) fail(`production must deploy with ${productionConfigFile}`);
  if (environments.staging.config !== stagingConfigFile) fail(`staging must deploy with ${stagingConfigFile}`);
  const paths = contract.paths || {};
  for (const key of ['marketingOnly', 'appOnly', 'appRequired', 'hostSpecific']) {
    if (!Array.isArray(paths[key])) fail(`hosting contract paths.${key} must be an array`);
  }
  for (const exception of paths.hostSpecific) {
    if (!exception || typeof exception.path !== 'string' || typeof exception.reason !== 'string' || exception.reason.trim() === '') {
      fail('every host-specific exception needs a path and a non-empty reason');
    }
  }
  for (const sample of [...(contract.redirectSamples || []), ...(contract.routeSamples || [])]) {
    if (!TARGETS.includes(sample.target) || typeof sample.path !== 'string' || !sample.path.startsWith('/')) {
      fail(`invalid route sample ${JSON.stringify(sample)}`);
    }
  }
  return contract;
}

// Exactly one environment per explicit project id. The .firebaserc default
// alias is deliberately not consulted: release tooling never infers a project.
function environmentForProject(project, contract = loadContract()) {
  if (typeof project !== 'string' || project.length === 0) fail('an explicit --project is required');
  const match = Object.entries(contract.environments).find(([, environment]) => environment.project === project);
  if (!match) fail(`unsupported project "${project}"; expected one of ${Object.values(contract.environments).map((e) => e.project).join(', ')}`);
  return { name: match[0], ...match[1] };
}

// The two target entries of a Firebase config's hosting array, by name.
function readHostingTargets(config) {
  const hosting = config && config.hosting;
  if (!Array.isArray(hosting) || hosting.length !== TARGETS.length) {
    fail('hosting must be an array of exactly the app and marketing targets');
  }
  const byTarget = {};
  hosting.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`hosting[${index}] must be an object`);
    if ('site' in entry) fail(`hosting[${index}] must not hard-code a site; sites come from .firebaserc targets`);
    if (entry.target !== TARGETS[index]) fail(`hosting[${index}] must be target "${TARGETS[index]}"`);
    byTarget[entry.target] = entry;
  });
  return byTarget;
}

function readConfigFile(relativePath, repoRoot = repositoryRoot) {
  return readJson(path.join(repoRoot, relativePath));
}

// Replace a production origin at the start of an absolute destination with the
// environment's origin. Any other absolute destination fails closed, so a new
// cross-host rule can never silently point staging at production.
function substituteOrigin(destination, originMap) {
  if (typeof destination !== 'string' || !/^[a-z][a-z0-9+.-]*:/i.test(destination)) return destination;
  for (const [from, to] of originMap) {
    if (destination === from || destination.startsWith(`${from}/`)) return to + destination.slice(from.length);
  }
  fail(`absolute redirect destination ${destination} has no environment origin mapping`);
}

function generateStagingConfig(productionConfig, contract = loadContract()) {
  const targets = readHostingTargets(productionConfig);
  const production = contract.environments.production.origins;
  const staging = contract.environments.staging.origins;
  const originMap = TARGETS.map((target) => [production[target], staging[target]]);
  const hosting = TARGETS.map((target) => {
    const entry = JSON.parse(JSON.stringify(targets[target]));
    if (Array.isArray(entry.redirects)) {
      entry.redirects = entry.redirects.map((rule) => ({ ...rule, destination: substituteOrigin(rule.destination, originMap) }));
    }
    for (const rule of entry.rewrites || []) {
      if (typeof rule.destination === 'string' && /^[a-z][a-z0-9+.-]*:/i.test(rule.destination)) {
        fail(`rewrite ${rule.source} has an absolute destination; rewrites must stay same-origin`);
      }
    }
    return entry;
  });
  return { hosting };
}

function serializeConfig(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

// Mappings of the given project in .firebaserc, read as data only.
function readTargetSites(project, repoRoot = repositoryRoot) {
  const rc = readJson(path.join(repoRoot, '.firebaserc'));
  const hosting = rc.targets?.[project]?.hosting;
  if (!hosting) fail(`.firebaserc has no Hosting targets for ${project}`);
  const sites = {};
  for (const target of TARGETS) {
    const mapped = hosting[target];
    if (!Array.isArray(mapped) || mapped.length !== 1 || typeof mapped[0] !== 'string') {
      fail(`.firebaserc must map ${project} target ${target} to exactly one site`);
    }
    sites[target] = mapped[0];
  }
  if (Object.keys(hosting).sort().join() !== [...TARGETS].sort().join()) fail(`.firebaserc ${project} must map only the app and marketing targets`);
  if (sites.app === sites.marketing) fail(`.firebaserc maps both ${project} targets to one site`);
  return sites;
}

function artifactFiles(root) {
  const results = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail(`artifact contains symlink: ${absolutePath}`);
      if (entry.isDirectory()) visit(absolutePath);
      else results.push(path.relative(root, absolutePath).split(path.sep).join('/'));
    }
  }
  if (!fs.existsSync(root)) fail(`artifact directory does not exist: ${root}`);
  visit(root);
  return results.sort();
}

// What Firebase Hosting would upload for a target: every artifact file not
// excluded by the built-in ignores plus the target's own ignore list,
// evaluated with the same minimatch model as hostingExclusion.cjs.
function servedFiles(artifactDirectory, targetEntry) {
  const ignore = FIREBASE_BUILTIN_IGNORES.concat(Array.isArray(targetEntry.ignore) ? targetEntry.ignore : []);
  return artifactFiles(artifactDirectory).filter((relativePath) => !isHostingIgnored(relativePath, ignore));
}

function matchesAny(relativePath, globs) {
  return globs.some((glob) => minimatch(relativePath, glob, { dot: true }));
}

// Pair-level ownership and parity gate over the two built artifacts.
function verifyPair({ appDirectory, marketingDirectory, config, contract = loadContract() }) {
  const targets = readHostingTargets(config);
  const { marketingOnly, appOnly, appRequired, hostSpecific } = contract.paths;
  const exceptions = new Set(hostSpecific.map((entry) => entry.path));
  const app = servedFiles(appDirectory, targets.app);
  const marketing = servedFiles(marketingDirectory, targets.marketing);
  const appSet = new Set(app);
  const marketingSet = new Set(marketing);
  const failures = [];

  for (const glob of marketingOnly) {
    if (!marketing.some((file) => minimatch(file, glob, { dot: true }))) failures.push(`marketing-only glob ${glob} matches no marketing file`);
  }
  for (const file of app) {
    if (matchesAny(file, marketingOnly)) failures.push(`app serves marketing-only path ${file}`);
  }
  for (const file of marketing) {
    if (matchesAny(file, appOnly)) failures.push(`marketing serves app-only path ${file}`);
    else if (!matchesAny(file, marketingOnly) && !appSet.has(file)) failures.push(`shared path ${file} is served by marketing but not by app`);
  }
  for (const file of appRequired) {
    if (!appSet.has(file)) failures.push(`app does not serve required path ${file}`);
  }
  for (const file of exceptions) {
    if (!appSet.has(file) || !marketingSet.has(file)) failures.push(`host-specific exception ${file} is not served by both targets`);
  }
  if (!appSet.has('index.html') || !marketingSet.has('index.html')) failures.push('both targets must serve index.html');

  const shared = marketing.filter((file) => appSet.has(file));
  let identical = 0;
  for (const file of shared) {
    if (exceptions.has(file)) continue;
    const appHash = sha256(fs.readFileSync(path.join(appDirectory, file)));
    const marketingHash = sha256(fs.readFileSync(path.join(marketingDirectory, file)));
    if (appHash !== marketingHash) failures.push(`shared path ${file} differs between targets`);
    else identical += 1;
  }
  for (const [label, directory] of [['app', appDirectory], ['marketing', marketingDirectory]]) {
    try {
      assertCatalogCurrent(fs.readFileSync(path.join(directory, 'index.html'), 'utf8'));
    } catch (error) {
      failures.push(`${label} index.html: ${error.message}`);
    }
  }
  if (failures.length > 0) fail(`pair contract failed:\n${failures.join('\n')}`);
  return { app: app.length, marketing: marketing.length, shared: shared.length, identical, hostSpecific: exceptions.size };
}

// The Hosting REST representation of a target's routing config, matching
// what Firebase stores on a version (`version.config`). Only the rule shapes
// this repository uses are supported; anything else fails closed.
function toApiRouting(entry) {
  const out = {};
  if (Array.isArray(entry.headers) && entry.headers.length > 0) {
    out.headers = entry.headers.map((rule) => {
      if (typeof rule.source !== 'string') fail('only source-glob header rules are supported');
      return { glob: rule.source, headers: Object.fromEntries(rule.headers.map(({ key, value }) => [key, value])) };
    });
  }
  if (Array.isArray(entry.redirects) && entry.redirects.length > 0) {
    out.redirects = entry.redirects.map((rule) => {
      const pattern = typeof rule.regex === 'string' ? { regex: rule.regex } : typeof rule.source === 'string' ? { glob: rule.source } : fail('redirect needs source or regex');
      return { ...pattern, location: rule.destination, statusCode: rule.type };
    });
  }
  if (Array.isArray(entry.rewrites) && entry.rewrites.length > 0) {
    out.rewrites = entry.rewrites.map((rule) => {
      if (typeof rule.source !== 'string' || typeof rule.destination !== 'string') fail('only source-glob path rewrites are supported');
      return { glob: rule.source, path: rule.destination };
    });
  }
  return out;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameRouting(entry, liveConfig) {
  const live = {};
  for (const key of ['headers', 'redirects', 'rewrites']) if (Array.isArray(liveConfig?.[key])) live[key] = liveConfig[key];
  return canonicalJson(toApiRouting(entry)) === canonicalJson(live);
}

// The request path that serves an artifact file: directory indexes are
// requested by their directory URL.
function requestPathFor(relativePath) {
  if (relativePath === 'index.html') return '/';
  if (relativePath.endsWith('/index.html')) return `/${relativePath.slice(0, -'index.html'.length)}`;
  return `/${relativePath}`;
}

// True when a target redirect shadows the request path (exact source globs
// and anchored regexes are the only shapes this repository uses).
function isRedirected(requestPath, entry) {
  return (entry.redirects || []).some((rule) => {
    if (typeof rule.regex === 'string') return new RegExp(rule.regex).test(requestPath);
    if (typeof rule.source === 'string') {
      if (/[*?{}[\]!:]/.test(rule.source)) fail(`unsupported redirect source shape ${rule.source}`);
      return rule.source === requestPath;
    }
    return false;
  });
}

function expandLocation(template, origins) {
  return template.replace(/\{(app|marketing)\}/g, (_, target) => origins[target]);
}

module.exports = {
  TARGETS,
  artifactFiles,
  canonicalJson,
  contractPath,
  environmentForProject,
  expandLocation,
  generateStagingConfig,
  isRedirected,
  loadContract,
  productionConfigFile,
  readConfigFile,
  readHostingTargets,
  readTargetSites,
  repositoryRoot,
  requestPathFor,
  sameRouting,
  serializeConfig,
  servedFiles,
  sha256,
  stagingConfigFile,
  substituteOrigin,
  toApiRouting,
  verifyPair
};
