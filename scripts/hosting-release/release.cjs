'use strict';

// Shared release helpers for prepare.cjs and certify.cjs: argument parsing,
// git source state, read-only Firebase live-release queries, live HTTP byte
// comparison, and the exact deploy and rollback commands. Network and CLI
// access are injectable so the unit tests stay offline.
//
// The two-target deploy is NOT atomic. firebase-tools builds every predeploy,
// creates and uploads every version, and only then finalizes and releases
// both sites concurrently; one site can release while the other fails.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  TARGETS,
  expandLocation,
  isRedirected,
  repositoryRoot,
  requestPathFor,
  sha256
} = require('./contract.cjs');

function fail(message) {
  throw new Error(`[hosting-release] ${message}`);
}

// `--name value` pairs and bare `--flag` booleans, restricted to `allowed`.
function parseArgs(argv, { values = [], flags = [] }) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--')) fail(`unexpected argument ${argv[i]}`);
    if (flags.includes(name)) out[name] = true;
    else if (values.includes(name)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) fail(`missing value for --${name}`);
      out[name] = value;
      i += 1;
    } else fail(`unknown argument --${name}`);
  }
  return out;
}

function gitState(repoRoot = repositoryRoot, run = execFileSync) {
  const sha = run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  const status = run('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: repoRoot, encoding: 'utf8' });
  const changes = status.split('\n').filter(Boolean);
  return { sha, dirty: changes.length > 0, changes };
}

function releaseMessage(sha, dirty) {
  if (!/^[0-9a-f]{40}$/.test(sha || '')) fail(`release source must be a full commit SHA, got ${sha}`);
  return dirty ? `release ${sha} uncommitted` : `release ${sha}`;
}

// The only documented Hosting deploy: both targets, explicit project and
// config, a release message carrying the source SHA. Never `--only hosting`.
function deployCommand(environment, message) {
  const args = ['deploy', '--only', TARGETS.map((target) => `hosting:${target}`).join(',')];
  if (environment.config !== 'firebase.json') args.push('--config', environment.config);
  args.push('--project', environment.project, '--message', message, '--non-interactive');
  return ['firebase', ...args];
}

function rollbackCommand(project, site, version) {
  if (!/^[a-z0-9-]+$/.test(site) || !/^[0-9a-f]+$/.test(version || '')) fail(`invalid rollback target ${site}@${version}`);
  return ['firebase', 'hosting:clone', `${site}@${version}`, `${site}:live`, '--project', project];
}

function shellQuote(args) {
  return args.map((arg) => (/^[A-Za-z0-9_./:@,=-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`)).join(' ');
}

function runFirebaseJson(args, run = execFileSync) {
  let output;
  try {
    output = run('firebase', [...args, '--json', '--non-interactive'], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    output = error.stdout ? String(error.stdout) : '';
    if (!output) fail(`firebase ${args.join(' ')} failed: ${error.message}`);
  }
  const parsed = JSON.parse(output);
  if (parsed.status !== 'success') fail(`firebase ${args.join(' ')} failed: ${parsed.error || output}`);
  return parsed.result;
}

// The live release of one site, read-only (`hosting:channel:list`).
function liveRelease({ project, site, run }) {
  const result = runFirebaseJson(['hosting:channel:list', '--site', site, '--project', project], run);
  const live = (result.channels || []).find((channel) => channel.name.endsWith('/channels/live'));
  const release = live && live.release;
  if (!release || !release.version) fail(`site ${site} has no live release`);
  return {
    site,
    version: release.version.name.split('/').pop(),
    releaseTime: release.releaseTime,
    message: release.message || null,
    config: release.version.config || {}
  };
}

async function fetchStatus(url, { fetchImpl = fetch, redirect = 'manual' } = {}) {
  const response = await fetchImpl(url, { redirect, headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30000) });
  return response;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

// Compare every served, non-redirected artifact path with the live origin.
async function compareLiveFiles({ origin, directory, files, entry, fetchImpl = fetch, concurrency = 8, nonce = Date.now().toString(36) }) {
  const outcome = { unchanged: [], changed: [], missing: [], redirected: [] };
  await mapLimit(files, concurrency, async (file) => {
    const requestPath = requestPathFor(file);
    if (isRedirected(requestPath, entry)) {
      outcome.redirected.push(file);
      return;
    }
    const response = await fetchStatus(`${origin}${requestPath}?hosting-release=${nonce}`, { fetchImpl });
    if (response.status !== 200) {
      outcome.missing.push(`${file} (HTTP ${response.status})`);
      return;
    }
    const live = sha256(Buffer.from(await response.arrayBuffer()));
    const local = sha256(fs.readFileSync(path.join(directory, file)));
    (live === local ? outcome.unchanged : outcome.changed).push(file);
  });
  for (const list of Object.values(outcome)) list.sort();
  return outcome;
}

// Route and redirect samples from the Hosting contract against live origins.
async function checkSamples({ contract, origins, fetchImpl = fetch }) {
  const failures = [];
  for (const sample of contract.redirectSamples) {
    const response = await fetchStatus(`${origins[sample.target]}${sample.path}`, { fetchImpl });
    const expected = expandLocation(sample.location, origins);
    if (response.status !== sample.status || response.headers.get('location') !== expected) {
      failures.push(`${sample.target} ${sample.path}: expected ${sample.status} -> ${expected}, got ${response.status} -> ${response.headers.get('location')}`);
    }
  }
  for (const sample of contract.routeSamples) {
    const response = await fetchStatus(`${origins[sample.target]}${sample.path}`, { fetchImpl });
    if (response.status !== sample.status) failures.push(`${sample.target} ${sample.path}: expected ${sample.status}, got ${response.status}`);
  }
  return failures;
}

function writeRecord(fileName, record) {
  const directory = path.join(repositoryRoot, 'dist', 'hosting-release');
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, fileName);
  fs.writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return target;
}

module.exports = {
  checkSamples,
  compareLiveFiles,
  deployCommand,
  gitState,
  liveRelease,
  parseArgs,
  releaseMessage,
  rollbackCommand,
  runFirebaseJson,
  shellQuote,
  writeRecord
};
